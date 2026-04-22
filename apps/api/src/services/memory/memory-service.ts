// apps/api/src/services/memory/memory-service.ts
// Memory System: M1 Episodic + M2 Semantic + M3 Procedural

import { getSupabase } from '../../lib/supabase.js';
import type {
  AffiliateProfile, BrandKit, EpisodicEvent, EpisodicEventType,
  KnowledgeChunk, Platform,
} from '../../../../packages/shared/src/types.js';

const db = () => getSupabase();

// ═══════════════════════════════════════════════════════════════════════════════
// M1 — EPISODIC MEMORY
// ═══════════════════════════════════════════════════════════════════════════════
export const episodicMemory = {

  async save(userId: string, event: {
    event_type: EpisodicEventType;
    event_data: Record<string, unknown>;
    outcome?: Record<string, unknown>;
  }): Promise<void> {
    const { error } = await db()
      .from('episodic_memory')
      .insert({
        user_id:    userId,
        event_type: event.event_type,
        event_data: event.event_data,
        outcome:    event.outcome ?? {},
      });
    if (error) console.error('[Memory:M1] Save failed:', error.message);
  },

  async getRecent(
    userId: string,
    limit = 10,
    eventType?: EpisodicEventType
  ): Promise<EpisodicEvent[]> {
    let q = db()
      .from('episodic_memory')
      .select('*')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(limit);

    if (eventType) q = q.eq('event_type', eventType);

    const { data, error } = await q;
    if (error) { console.error('[Memory:M1] Read failed:', error.message); return []; }
    return (data ?? []) as EpisodicEvent[];
  },

  async getTopRated(userId: string, limit = 5): Promise<EpisodicEvent[]> {
    const { data, error } = await db()
      .from('episodic_memory')
      .select('*')
      .eq('user_id', userId)
      .eq('event_type', 'content_approved')
      .gte('outcome->>user_rating', '4')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return (data ?? []) as EpisodicEvent[];
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// M2 — SEMANTIC MEMORY (profile, learned preferences)
// ═══════════════════════════════════════════════════════════════════════════════
export const semanticMemory = {

  async getProfile(userId: string): Promise<AffiliateProfile | null> {
    const { data, error } = await db()
      .from('affiliate_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (error) return null;
    return data as AffiliateProfile;
  },

  async upsertProfile(
    userId: string,
    updates: Partial<Omit<AffiliateProfile, 'user_id'>>
  ): Promise<void> {
    const { error } = await db()
      .from('affiliate_profiles')
      .upsert({ user_id: userId, ...updates, updated_at: new Date().toISOString() });
    if (error) console.error('[Memory:M2] Upsert failed:', error.message);
  },

  async getBrandKit(userId: string): Promise<BrandKit | null> {
    const { data } = await db()
      .from('brand_kits')
      .select('*')
      .eq('user_id', userId)
      .single();
    return data as BrandKit | null;
  },

  // Học từ feedback user: rate cao → reinforce preferences
  async learnFromFeedback(userId: string, event: EpisodicEvent): Promise<void> {
    const profile = await this.getProfile(userId);
    if (!profile) return;

    const rating = event.outcome.user_rating ?? 0;
    const wasEdited = event.outcome.was_edited ?? false;

    const updates: Partial<AffiliateProfile> = {};

    if (rating >= 4 && !wasEdited) {
      // Nội dung tốt — học platform và format
      const platform = (event.event_data as Record<string, string>).platform as Platform;
      if (platform) {
        const content = (event.event_data as Record<string, string>).content ?? '';
        const fmt = inferFormat(content);
        updates.top_formats = { ...profile.top_formats, [platform]: fmt };
      }

      // Cập nhật avg quality score
      const prevAvg = profile.avg_quality_score ?? 70;
      updates.avg_quality_score = (prevAvg * 0.8) + ((event.outcome.ctr ?? 70) * 0.2);
    }

    if (rating <= 2) {
      // Nội dung kém — note để tránh
      const platform = (event.event_data as Record<string, string>).platform as Platform;
      if (platform) {
        // Xóa format này khỏi top_formats
        const newFormats = { ...profile.top_formats };
        delete newFormats[platform];
        updates.top_formats = newFormats;
      }
    }

    // Update total content count
    updates.total_content_made = (profile.total_content_made ?? 0) + 1;

    if (Object.keys(updates).length > 0) {
      await this.upsertProfile(userId, updates);
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// RAG — Knowledge Base (vector search)
// ═══════════════════════════════════════════════════════════════════════════════
export const ragMemory = {

  async search(
    userId: string,
    embedding: number[],
    options: { kb_type?: string; limit?: number; threshold?: number } = {}
  ): Promise<KnowledgeChunk[]> {
    const { data, error } = await db().rpc('search_knowledge', {
      p_user_id:   userId,
      p_embedding: embedding,
      p_kb_type:   options.kb_type ?? null,
      p_limit:     options.limit ?? 5,
      p_threshold: options.threshold ?? 0.4,
    });

    if (error) { console.error('[RAG] Search failed:', error.message); return []; }
    return (data ?? []) as KnowledgeChunk[];
  },

  async addChunk(userId: string, chunk: {
    kb_type: string;
    source_name?: string;
    chunk_text: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }): Promise<string | null> {
    const { data, error } = await db()
      .from('knowledge_chunks')
      .insert({
        user_id:     userId,
        kb_type:     chunk.kb_type,
        source_name: chunk.source_name,
        chunk_text:  chunk.chunk_text,
        embedding:   chunk.embedding,
        metadata:    chunk.metadata ?? {},
      })
      .select('id')
      .single();

    if (error) { console.error('[RAG] Add chunk failed:', error.message); return null; }
    return data?.id ?? null;
  },

  async deleteBySource(userId: string, sourceName: string): Promise<void> {
    await db()
      .from('knowledge_chunks')
      .delete()
      .eq('user_id', userId)
      .eq('source_name', sourceName);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED MEMORY SERVICE — dùng trong Orchestrator
// ═══════════════════════════════════════════════════════════════════════════════
export const memoryService = {
  saveEpisodicEvent:  episodicMemory.save.bind(episodicMemory),
  getRecentEpisodes:  episodicMemory.getRecent.bind(episodicMemory),
  getSemanticProfile: semanticMemory.getProfile.bind(semanticMemory),
  updateProfile:      semanticMemory.upsertProfile.bind(semanticMemory),
  getBrandKit:        semanticMemory.getBrandKit.bind(semanticMemory),
  learnFromFeedback:  semanticMemory.learnFromFeedback.bind(semanticMemory),
  searchKnowledge:    ragMemory.search.bind(ragMemory),
  addKnowledgeChunk:  ragMemory.addChunk.bind(ragMemory),
};

// ─── Helper ───────────────────────────────────────────────────────────────────
function inferFormat(content: string): string {
  if (content.length < 200) return 'short_hook';
  if (content.includes('hook') || content.includes('Hook')) return 'hook+problem+solution';
  if (content.includes('AIDA') || content.includes('Attention')) return 'AIDA';
  return 'storytelling';
}
