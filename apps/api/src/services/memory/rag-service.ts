// apps/api/src/services/memory/rag-service.ts
// RAG: embed documents → store vectors → semantic search

import OpenAI from 'openai';
import { getSupabase } from '../../lib/supabase.js';
import { withRetry } from '../../lib/resilience.js';
import type { KnowledgeChunk } from '../../../../packages/shared/src/types.js';

const db     = () => getSupabase();
let _openai: OpenAI | null = null;
const openai = () => {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
};

// ─── Embedding ────────────────────────────────────────────────────────────────
export async function embed(text: string): Promise<number[]> {
  const res = await withRetry(
    () => openai().embeddings.create({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000),
    }),
    { maxAttempts: 3, baseDelayMs: 1000 }
  );
  return res.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await withRetry(
    () => openai().embeddings.create({
      model: 'text-embedding-3-small',
      input: texts.map(t => t.slice(0, 8000)),
    }),
    { maxAttempts: 3, baseDelayMs: 1000 }
  );
  return res.data.map(d => d.embedding);
}

// ─── Chunking ─────────────────────────────────────────────────────────────────
function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const words  = text.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;

  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim()) chunks.push(chunk.trim());
    i += chunkSize - overlap;
  }

  return chunks;
}

// ─── Ingest document ─────────────────────────────────────────────────────────
export async function ingestDocument(params: {
  userId:      string;
  kbType:      string;
  sourceName:  string;
  sourceUrl?:  string;
  content:     string;
  metadata?:   Record<string, unknown>;
}): Promise<number> {
  const { userId, kbType, sourceName, sourceUrl, content, metadata = {} } = params;

  // Delete old chunks từ same source
  await db().from('knowledge_chunks')
    .delete()
    .eq('user_id', userId)
    .eq('source_name', sourceName);

  const chunks = chunkText(content, 400, 40);
  if (chunks.length === 0) return 0;

  // Embed all chunks in batches of 100
  let stored = 0;
  const batchSize = 100;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch     = chunks.slice(i, i + batchSize);
    const embeddings = await embedBatch(batch);

    const rows = batch.map((text, idx) => ({
      user_id:     userId,
      kb_type:     kbType,
      source_name: sourceName,
      source_url:  sourceUrl,
      chunk_text:  text,
      embedding:   embeddings[idx],
      metadata:    { ...metadata, chunk_index: i + idx, total_chunks: chunks.length },
    }));

    const { error } = await db().from('knowledge_chunks').insert(rows);
    if (error) console.error('[RAG] Insert chunks failed:', error.message);
    else stored += batch.length;
  }

  console.info(`[RAG] Ingested "${sourceName}": ${stored} chunks`);
  return stored;
}

// ─── Search ───────────────────────────────────────────────────────────────────
export async function searchKnowledge(params: {
  userId:     string;
  query:      string;
  kbType?:    string;
  limit?:     number;
  threshold?: number;
}): Promise<KnowledgeChunk[]> {
  const { userId, query, kbType, limit = 5, threshold = 0.4 } = params;

  let embedding: number[];
  try {
    embedding = await embed(query);
  } catch (err) {
    console.error('[RAG] Embed failed:', (err as Error).message);
    return [];
  }

  const { data, error } = await db().rpc('search_knowledge', {
    p_user_id:   userId,
    p_embedding: embedding,
    p_kb_type:   kbType ?? null,
    p_limit:     limit,
    p_threshold: threshold,
  });

  if (error) { console.error('[RAG] Search failed:', error.message); return []; }
  return (data ?? []) as KnowledgeChunk[];
}

// ─── Ingest product URL (scrape + embed) ──────────────────────────────────────
export async function ingestProductUrl(params: {
  userId:   string;
  url:      string;
  kbType?:  string;
}): Promise<{ success: boolean; chunks: number }> {
  try {
    const res  = await fetch(params.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
    const html = await res.text();

    // Extract text content từ HTML (basic)
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 20_000);

    const sourceName = new URL(params.url).hostname + new URL(params.url).pathname.slice(0, 50);
    const chunks = await ingestDocument({
      userId:     params.userId,
      kbType:     params.kbType ?? 'product',
      sourceName,
      sourceUrl:  params.url,
      content:    text,
    });

    return { success: true, chunks };
  } catch (err) {
    console.error('[RAG] ingestUrl failed:', (err as Error).message);
    return { success: false, chunks: 0 };
  }
}

// ─── Build RAG context string for agent prompts ───────────────────────────────
export async function buildRagContext(
  userId: string, query: string, kbType?: string
): Promise<string> {
  const chunks = await searchKnowledge({ userId, query, kbType, limit: 4 });
  if (chunks.length === 0) return '';

  const context = chunks
    .map((c, i) => `[${i + 1}] (${c.kb_type}/${c.source_name ?? 'unknown'}) ${c.chunk_text}`)
    .join('\n\n');

  return `## THÔNG TIN TỪ KNOWLEDGE BASE:\n${context}\n`;
}
