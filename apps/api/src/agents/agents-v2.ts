// apps/api/src/agents/agents-v2.ts
// 9 AI Agents — OpenAI + Anthropic trực tiếp, không cần CakeAI

import { callLLM, callLLMJson } from './llm.js';
import { memoryService }        from '../services/memory/memory-service.js';
import type {
  AgentInput, AgentOutput, AgentIntent,
  AgentContext, ContentBundle, Platform,
} from '../../../packages/shared/src/types.js';

// ════════════════ AGENT 1: ORCHESTRATOR ═════════════════════════════
interface Plan {
  intent: AgentIntent; primary_agent: string;
  support_agents: string[]; auto_execute: boolean; cleaned_message: string;
}

async function runOrchestrator(input: AgentInput): Promise<Plan> {
  try {
    return await callLLMJson<Plan>({ agent: 'orchestrator', userMessage: input.user_message, json: true });
  } catch {
    return { intent: detectIntentFallback(input.user_message), primary_agent: 'content',
             support_agents: ['evaluator'], auto_execute: true, cleaned_message: input.user_message };
  }
}

// ════════════════ AGENT 2: CONTENT GENERATOR ════════════════════════
interface ContentResult {
  results: Array<{
    platform: string; content: string; hashtags?: string[];
    cta: string; best_posting_time?: string; quality_notes?: string;
  }>;
}

export async function contentAgent(input: AgentInput): Promise<AgentOutput> {
  const platforms   = detectPlatforms(input.user_message);
  const contextStr  = buildContextStr(input.context);

  const result = await callLLMJson<ContentResult>({
    agent:        'content',
    userMessage:  `${input.user_message}\n\nPlatforms cần tạo: ${platforms.join(', ')}`,
    extraContext: contextStr || undefined,
    json:         true,
  });

  const bundle: ContentBundle = {};
  for (const item of result.results ?? []) {
    bundle[item.platform as Platform] = {
      platform: item.platform as Platform, content: item.content,
      hashtags: item.hashtags, cta: item.cta, best_posting_time: item.best_posting_time,
    };
  }

  return {
    success: true, intent: 'content_create',
    structured_data: bundle,
    content: Object.entries(bundle)
      .map(([p, c]) => `## ${p.toUpperCase()}\n${c.content}\n🎯 ${c.cta}${c.best_posting_time ? `\n⏰ ${c.best_posting_time}` : ''}`)
      .join('\n\n---\n\n'),
  };
}

// ════════════════ AGENT 3: SELF EVALUATOR ═══════════════════════════
interface EvalResult {
  total_score: number; max_score: number; passed: boolean; content_type: string;
  scores: Record<string, number>; strengths: string[]; weaknesses: string[];
  specific_fixes: string[]; regenerate_instruction: string | null;
}

export async function evaluatorAgent(prev: AgentOutput, context?: AgentContext, contentType = 'tiktok'): Promise<AgentOutput> {
  if (!prev.success || !prev.content) return prev;
  try {
    const eval_ = await callLLMJson<EvalResult>({
      agent:        'evaluator',
      userMessage:  `Chấm điểm content:\n\n${prev.content.slice(0, 3000)}\n\nContent type: ${contentType}`,
      extraContext: context?.user_profile?.niche_primary ? `Target niche: ${context.user_profile.niche_primary}` : undefined,
      json:         true,
    });
    return {
      ...prev,
      quality_score:   Math.round((eval_.total_score / eval_.max_score) * 100),
      error:           eval_.passed ? undefined : eval_.specific_fixes.slice(0, 3).join('; '),
      structured_data: { ...(prev.structured_data ?? {}), eval: eval_ },
    };
  } catch { return { ...prev, quality_score: 72 }; }
}

// ════════════════ AGENT 4: SOCIAL LISTENING ═════════════════════════
interface TrendResult {
  trends: Array<{
    rank: number; product_name: string; trend_score: number;
    why_trending: string; best_platforms: string[];
    content_angle: string; est_commission_pct: number;
  }>;
}

export async function trendAgent(input: AgentInput): Promise<AgentOutput> {
  const niche  = input.context?.user_profile?.niche_primary ?? 'beauty';
  const result = await callLLMJson<TrendResult>({
    agent:       'social',
    userMessage: `Top 5 trends đang hot nhất hôm nay.\nNiche: ${niche}\nThị trường: Việt Nam\nNgày: ${new Date().toLocaleDateString('vi-VN')}`,
    json:        true,
  });
  const content = (result.trends ?? [])
    .map(t => `${t.rank}. **${t.product_name}** (Score: ${t.trend_score})\n   → ${t.why_trending}\n   → Angle: ${t.content_angle}`)
    .join('\n\n');
  return { success: true, intent: 'trend_research', structured_data: result,
           content: `🔥 Top ${result.trends?.length ?? 0} trends:\n\n${content}` };
}

// ════════════════ AGENT 5: OFFER MATCHING ═══════════════════════════
interface OfferResult {
  offers: Array<{
    rank: number; product_name: string; network: string;
    commission_pct: number; epc_estimate_vnd: number;
    match_score: number; why_recommended: string;
  }>;
}

export async function offerAgent(input: AgentInput): Promise<AgentOutput> {
  const niche    = input.context?.user_profile?.niche_primary ?? 'beauty';
  const networks = input.context?.user_profile?.active_networks?.join(', ') ?? 'shopee, accesstrade';
  const result   = await callLLMJson<OfferResult>({
    agent:       'offer',
    userMessage: `Top 5 offers tốt nhất.\nNiche: ${niche}\nNetworks: ${networks}\nYêu cầu: ${input.user_message}`,
    json:        true,
  });
  const content = (result.offers ?? [])
    .map(o => `${o.rank}. **${o.product_name}** (${o.network})\n   HH: ${o.commission_pct}% | EPC: ${(o.epc_estimate_vnd/1000).toFixed(1)}K đ | Match: ${o.match_score}%\n   → ${o.why_recommended}`)
    .join('\n\n');
  return { success: true, intent: 'offer_find', structured_data: result,
           content: `🎯 Top ${result.offers?.length ?? 0} offers:\n\n${content}` };
}

// ════════════════ AGENT 6: PERFORMANCE ANALYST ══════════════════════
export async function analystAgent(input: AgentInput): Promise<AgentOutput> {
  const ctxStr = input.context?.user_profile
    ? `User: niche=${input.context.user_profile.niche_primary}, avg_score=${input.context.user_profile.avg_quality_score ?? 'N/A'}`
    : '';
  const result = await callLLM({ agent: 'analyst', userMessage: input.user_message,
                                  extraContext: ctxStr || undefined });
  return { success: true, intent: 'performance_review', content: result.text };
}

// ════════════════ AGENT 7: CUSTOMER ENGAGE ══════════════════════════
export async function engageAgent(input: AgentInput): Promise<AgentOutput> {
  const knowledge = input.context?.retrieved_knowledge
    ?.map(k => k.chunk_text).join('\n\n').slice(0, 1500);
  const result = await callLLM({
    agent:        'engage',
    userMessage:  `Tin nhắn từ khách: "${input.user_message}"`,
    extraContext: knowledge ? `Thông tin sản phẩm:\n${knowledge}` : undefined,
  });
  return { success: true, intent: 'customer_reply', content: result.text };
}

// ════════════════ AGENT 8: RAG AGENT ════════════════════════════════
export async function ragAgent(input: AgentInput, chunks: string[]): Promise<AgentOutput> {
  if (chunks.length === 0) return {
    success: true, intent: 'product_research',
    content: 'Không tìm thấy trong knowledge base. Upload tài liệu vào phần Knowledge Base để AI học.',
  };
  const result = await callLLM({
    agent:        'rag',
    userMessage:  input.user_message,
    extraContext: `Knowledge base:\n\n${chunks.join('\n\n---\n\n').slice(0, 4000)}`,
  });
  return { success: true, intent: 'product_research', content: result.text };
}

// ════════════════ AGENT 9: SCHEDULER ════════════════════════════════
interface ScheduleResult {
  calendar: Array<{ date: string; day_of_week: string;
    posts: Array<{ platform: string; scheduled_time: string; content_type: string;
                   product: string; angle: string; priority: string }> }>;
  weekly_summary: { total_posts: number; by_platform: Record<string, number>; estimated_weekly_reach: string };
}

export async function schedulerAgent(input: AgentInput): Promise<AgentOutput> {
  const niche  = input.context?.user_profile?.niche_primary ?? 'beauty';
  const result = await callLLMJson<ScheduleResult>({
    agent:       'scheduler',
    userMessage: `Lên kế hoạch content tuần tới.\nNiche: ${niche}\nHôm nay: ${new Date().toLocaleDateString('vi-VN')}\nYêu cầu: ${input.user_message}`,
    json:        true,
  });
  const s = result.weekly_summary;
  const content = `📅 Kế hoạch tuần tới: ${s?.total_posts ?? 0} bài | `
    + Object.entries(s?.by_platform ?? {}).map(([k,v]) => `${k}:${v}`).join(' ')
    + ` | Reach dự kiến: ${s?.estimated_weekly_reach ?? 'N/A'}`;
  return { success: true, intent: 'schedule_task', structured_data: result, content };
}

// ════════════════ MAIN ORCHESTRATOR ═════════════════════════════════
export async function orchestrate(input: AgentInput): Promise<AgentOutput> {
  const t0 = Date.now();
  const { user_id, user_message } = input;

  // Load context
  let context: AgentContext = {};
  try {
    const [profile, brandKit, episodes] = await Promise.all([
      memoryService.getSemanticProfile(user_id),
      memoryService.getBrandKit(user_id),
      memoryService.getRecentEpisodes(user_id, 5),
    ]);
    context = { user_profile: profile ?? undefined, brand_kit: brandKit ?? undefined, recent_episodes: episodes };
  } catch (e) { console.warn('[Orch] Context load failed:', e); }

  const ai = { ...input, context };

  // Get plan from orchestrator
  const plan = await runOrchestrator(ai);
  console.info(`[Orch] intent=${plan.intent} (${Date.now()-t0}ms)`);

  // Dispatch
  let result: AgentOutput;
  try { result = await dispatch(plan.intent, ai); }
  catch (e) { result = { success: false, intent: plan.intent, error: (e as Error).message }; }

  // Save memory
  if (result.success) {
    memoryService.saveEpisodicEvent(user_id, {
      event_type: 'content_created',
      event_data: { intent: plan.intent, message: user_message.slice(0, 200) },
      outcome:    { quality_score: result.quality_score },
    }).catch(console.error);
  }

  console.info(`[Orch] Total ${Date.now()-t0}ms`);
  return result;
}

async function dispatch(intent: AgentIntent, input: AgentInput): Promise<AgentOutput> {
  switch (intent) {
    case 'content_create': {
      const raw    = await contentAgent(input);
      const scored = await evaluatorAgent(raw, input.context);
      if ((scored.quality_score ?? 100) < 65 && scored.error) {
        const improved = await contentAgent({ ...input,
          user_message: `${input.user_message}\n\nCải thiện: ${scored.error}` });
        return evaluatorAgent(improved, input.context);
      }
      return scored;
    }
    case 'trend_research': {
      const [t, o] = await Promise.all([trendAgent(input), offerAgent(input)]);
      return { success: true, intent, content: `${t.content ?? ''}\n\n---\n\n${o.content ?? ''}`,
               structured_data: { trends: t.structured_data, offers: o.structured_data } };
    }
    case 'offer_find':         return offerAgent(input);
    case 'performance_review': return analystAgent(input);
    case 'customer_reply':     {
      const reply = await engageAgent(input);
      return evaluatorAgent(reply, input.context, 'facebook');
    }
    case 'schedule_task':  return schedulerAgent(input);
    case 'product_research': {
      try {
        const { ragService } = await import('../services/memory/rag-service.js') as any;
        const chunks = await ragService.search(input.user_id, input.user_message);
        return ragAgent(input, (chunks ?? []).map((c: any) => c.chunk_text));
      } catch { return ragAgent(input, []); }
    }
    default: return contentAgent(input);
  }
}

// ════════════════ UTILITIES ══════════════════════════════════════════
function detectIntentFallback(msg: string): AgentIntent {
  const lower = msg.toLowerCase();
  if (/viết|tạo|review|caption|script/.test(lower)) return 'content_create';
  if (/trend|hot|viral|nổi/.test(lower))             return 'trend_research';
  if (/offer|hoa hồng|commission/.test(lower))       return 'offer_find';
  if (/báo cáo|hiệu suất|ctr|doanh thu/.test(lower)) return 'performance_review';
  if (/trả lời|inbox|comment|khách/.test(lower))     return 'customer_reply';
  if (/lịch|kế hoạch|calendar/.test(lower))          return 'schedule_task';
  return 'content_create';
}

function detectPlatforms(msg: string): Platform[] {
  const lower = msg.toLowerCase();
  const map: Record<string, Platform> = {
    tiktok:'tiktok', facebook:'facebook', fb:'facebook',
    instagram:'instagram', ig:'instagram', blog:'blog',
    youtube:'youtube', zalo:'zalo', email:'email',
  };
  const found = Object.entries(map).filter(([kw]) => lower.includes(kw)).map(([,p]) => p);
  return found.length ? [...new Set(found)] : ['tiktok','facebook','instagram'];
}

function buildContextStr(ctx?: AgentContext): string {
  if (!ctx?.user_profile) return '';
  const p = ctx.user_profile;
  const parts = [
    `Niche: ${p.niche_primary}, Tone: ${p.preferred_tone}, Style: ${p.language_style}`,
  ];
  if (p.avoided_words?.length)  parts.push(`Tránh dùng: ${p.avoided_words.join(', ')}`);
  if (p.avg_quality_score)      parts.push(`Avg score: ${p.avg_quality_score}`);
  if (ctx.brand_kit?.style_keywords?.length) parts.push(`Brand style: ${ctx.brand_kit.style_keywords.join(', ')}`);
  return parts.join('\n');
}

// Re-exports for backward compat
export { callLLM, callLLMJson } from './llm.js';
export const AGENTS = null; // không còn dùng CakeAI agent IDs
