// apps/api/src/agents/agents-v2.ts
// AffiliateAI chat agents: orchestrator + specialized agents.

import { callLLM, callLLMJson } from './llm.js';
import { memoryService } from '../services/memory/memory-service.js';

type Platform = 'tiktok' | 'facebook' | 'instagram' | 'blog' | 'youtube' | 'zalo' | 'email';
type AgentIntent =
  | 'content_create' | 'trend_research' | 'offer_find'
  | 'performance_review' | 'customer_reply' | 'schedule_task'
  | 'product_research' | 'bulk_content' | 'voice_query'
  | 'optimize_channel' | 'competitor_analysis' | 'onboarding';

interface AgentContext {
  user_profile?: {
    niche_primary?: string | null;
    preferred_tone?: string | null;
    language_style?: string | null;
    active_networks?: string[] | null;
    avoided_words?: string[] | null;
    avg_quality_score?: number | null;
  } | null;
  brand_kit?: { style_keywords?: string[] | null } | null;
  recent_episodes?: unknown[];
  retrieved_knowledge?: Array<{ chunk_text: string }>;
}

interface AgentInput {
  user_id: string;
  user_message: string;
  intent?: AgentIntent;
  context?: AgentContext;
  metadata?: Record<string, unknown>;
}

interface AgentOutput {
  success: boolean;
  intent: AgentIntent;
  content?: string;
  structured_data?: Record<string, unknown>;
  quality_score?: number;
  tokens_used?: number;
  error?: string;
}

type ContentBundle = Partial<Record<Platform, {
  platform: Platform;
  content: string;
  hashtags?: string[];
  cta: string;
  best_posting_time?: string;
}>>;

interface Plan {
  intent: AgentIntent;
  primary_agent: string;
  support_agents: string[];
  auto_execute: boolean;
  cleaned_message: string;
}

interface ContentResult {
  results: Array<{
    platform: string;
    content: string;
    hashtags?: string[];
    cta?: string;
    best_posting_time?: string;
    quality_notes?: string;
  }>;
}

interface EvalResult {
  total_score: number;
  max_score: number;
  passed: boolean;
  content_type: string;
  scores: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
  specific_fixes: string[];
  regenerate_instruction: string | null;
}

interface TrendResult {
  trends: Array<{
    rank: number;
    product_name: string;
    trend_score: number;
    why_trending: string;
    best_platforms: string[];
    content_angle: string;
    est_commission_pct: number;
  }>;
}

type TrendItem = TrendResult['trends'][number];

const TARGET_CONTENT_QUALITY_SCORE = 80;
const MAX_CONTENT_IMPROVEMENT_PASSES = 2;

interface OfferResult {
  offers: Array<{
    rank: number;
    product_name: string;
    network: string;
    commission_pct: number;
    epc_estimate_vnd: number;
    match_score: number;
    why_recommended: string;
  }>;
}

interface ScheduleResult {
  calendar: Array<{
    date: string;
    day_of_week: string;
    posts: Array<{
      platform: string;
      scheduled_time: string;
      content_type: string;
      product: string;
      angle: string;
      priority: string;
    }>;
  }>;
  weekly_summary: {
    total_posts: number;
    by_platform: Record<string, number>;
    estimated_weekly_reach: string;
  };
}

const VALID_INTENTS = new Set<AgentIntent>([
  'content_create',
  'trend_research',
  'offer_find',
  'performance_review',
  'customer_reply',
  'schedule_task',
  'product_research',
  'bulk_content',
  'voice_query',
  'optimize_channel',
  'competitor_analysis',
  'onboarding',
]);

function isAgentIntent(value: unknown): value is AgentIntent {
  return typeof value === 'string' && VALID_INTENTS.has(value as AgentIntent);
}

async function runOrchestrator(input: AgentInput): Promise<Plan> {
  if (isAgentIntent(input.intent)) {
    return {
      intent: input.intent,
      primary_agent: input.intent,
      support_agents: input.intent === 'content_create' ? ['evaluator'] : [],
      auto_execute: true,
      cleaned_message: input.user_message,
    };
  }

  try {
    const plan = await callLLMJson<Partial<Plan>>({
      agent: 'orchestrator',
      userMessage: input.user_message,
      json: true,
      timeoutMs: 25_000,
    });
    const intent = isAgentIntent(plan.intent) ? plan.intent : detectIntentFallback(input.user_message);
    return {
      intent,
      primary_agent: plan.primary_agent || intent,
      support_agents: Array.isArray(plan.support_agents) ? plan.support_agents : [],
      auto_execute: plan.auto_execute !== false,
      cleaned_message: plan.cleaned_message || input.user_message,
    };
  } catch (error) {
    console.warn(`[Orch] Intent fallback: ${(error as Error).message}`);
    const intent = detectIntentFallback(input.user_message);
    return {
      intent,
      primary_agent: intent,
      support_agents: intent === 'content_create' ? ['evaluator'] : [],
      auto_execute: true,
      cleaned_message: input.user_message,
    };
  }
}

export async function contentAgent(input: AgentInput): Promise<AgentOutput> {
  const platforms = detectPlatforms(input.user_message);
  const contextStr = buildContextStr(input.context);

  const result = await callLLMJson<ContentResult>({
    agent: 'content',
    userMessage: [
      input.user_message,
      '',
      `Platforms cần tạo: ${platforms.join(', ')}`,
      '',
      'QUALITY BAR: Produce publish-ready affiliate content that should score at least 85/100 under the evaluator rubric.',
      'For every platform, include: a strong first-line hook, relatable pain point, clear solution/demo, concrete but non-fabricated proof, natural CTA, and relevant keywords/hashtags.',
      'Each result must have one clear platform tag from this exact set only: tiktok, facebook, instagram, blog, youtube, zalo, email. Never use "multi" as a platform.',
      'If exact product data is missing, use honest phrasing such as "kiểm tra thêm rating/giá hiện tại" instead of inventing numbers.',
      'Avoid generic filler, robotic wording, aggressive sales language, and vague claims.',
      'Return JSON exactly as {"results":[{"platform":"tiktok","content":"...","hashtags":["#tag"],"cta":"...","best_posting_time":"..."}]}.',
    ].join('\n'),
    extraContext: contextStr || undefined,
    json: true,
    timeoutMs: 45_000,
  });

  const bundle: ContentBundle = {};
  for (const item of result.results ?? []) {
    const platform = normalizePlatform(item.platform);
    if (!platform || !item.content?.trim()) continue;
    if (!platforms.includes(platform)) continue;
    bundle[platform] = {
      platform,
      content: item.content.trim(),
      hashtags: Array.isArray(item.hashtags) ? item.hashtags : undefined,
      cta: item.cta?.trim() || 'Xem thêm trong link bio.',
      best_posting_time: item.best_posting_time,
    };
  }

  if (Object.keys(bundle).length === 0) {
    throw new Error('Content agent returned no usable content');
  }

  const content = Object.entries(bundle as Record<string, NonNullable<ContentBundle[Platform]>>)
    .map(([platform, item]) => [
      `## ${platform.toUpperCase()}`,
      item.content,
      item.cta ? `CTA: ${item.cta}` : '',
      item.best_posting_time ? `Best time: ${item.best_posting_time}` : '',
      item.hashtags?.length ? `Hashtags: ${item.hashtags.join(' ')}` : '',
    ].filter(Boolean).join('\n'))
    .join('\n\n---\n\n');

  return {
    success: true,
    intent: 'content_create',
    structured_data: bundle as unknown as Record<string, unknown>,
    content,
  };
}

export async function evaluatorAgent(prev: AgentOutput, context?: AgentContext, contentType = 'tiktok'): Promise<AgentOutput> {
  if (!prev.success || !prev.content) return prev;
  try {
    const evalResult = await callLLMJson<EvalResult>({
      agent: 'evaluator',
      userMessage: `Chấm điểm content:\n\n${prev.content.slice(0, 3000)}\n\nContent type: ${contentType}`,
      extraContext: context?.user_profile?.niche_primary ? `Target niche: ${context.user_profile.niche_primary}` : undefined,
      json: true,
      timeoutMs: 30_000,
    });
    const maxScore = Number(evalResult.max_score) || 100;
    const totalScore = Number(evalResult.total_score) || 0;
    const qualityScore = Math.max(0, Math.min(100, Math.round((totalScore / maxScore) * 100)));
    const improvementFeedback = [
      ...(evalResult.specific_fixes ?? []),
      ...(evalResult.weaknesses ?? []),
    ].filter(Boolean).slice(0, 5).join('; ');
    return {
      ...prev,
      quality_score: qualityScore,
      error: qualityScore >= TARGET_CONTENT_QUALITY_SCORE ? undefined : improvementFeedback,
      structured_data: { ...(prev.structured_data ?? {}), eval: evalResult },
    };
  } catch (error) {
    console.warn(`[Evaluator] skipped: ${(error as Error).message}`);
    return { ...prev, quality_score: prev.quality_score ?? 72 };
  }
}

export async function trendAgent(input: AgentInput): Promise<AgentOutput> {
  const niche = input.context?.user_profile?.niche_primary ?? 'beauty';
  let fallbackReason: string | undefined;
  const result = await callLLMJson<unknown>({
    agent: 'social',
    userMessage: [
      'Top 5 trends đang hot nhất hôm nay.',
      `Niche: ${niche}`,
      'Thị trường: Việt Nam',
      `Ngày: ${new Date().toLocaleDateString('vi-VN')}`,
      `Yêu cầu người dùng: ${input.user_message}`,
    ].join('\n'),
    json: true,
    timeoutMs: 45_000,
  }).catch((error: Error) => {
    fallbackReason = error.message;
    console.warn(`[Trend] fallback: ${fallbackReason}`);
    return null;
  });

  const trends = normalizeTrends(result, niche);
  const usedFallback = trends.length === 0;
  const usableTrends = usedFallback ? fallbackTrends(niche) : trends;
  const content = usableTrends
    .map(t => `${t.rank}. **${t.product_name}** (Score: ${t.trend_score})\n   - ${t.why_trending}\n   - Angle: ${t.content_angle}`)
    .join('\n\n');
  return {
    success: true,
    intent: 'trend_research',
    structured_data: {
      trends: usableTrends,
      source: usedFallback ? 'fallback' : 'llm',
      fallback_reason: fallbackReason,
      raw: result,
    },
    content: `Top ${usableTrends.length} trends:\n\n${content}`,
  };
}

function normalizeTrends(result: unknown, niche: string): TrendItem[] {
  const candidates = extractTrendCandidates(result);
  return candidates
    .map((item, index) => normalizeTrendItem(item, index, niche))
    .filter((item): item is TrendItem => Boolean(item))
    .slice(0, 5);
}

function extractTrendCandidates(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];

  const data = result as Record<string, unknown>;
  const keys = ['trends', 'items', 'products', 'topics', 'results', 'top_trends'];
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

function normalizeTrendItem(item: unknown, index: number, niche: string): TrendItem | null {
  if (!item || typeof item !== 'object') return null;
  const data = item as Record<string, unknown>;
  const productName = firstString(data.product_name, data.product, data.name, data.topic, data.keyword, data.title);
  if (!productName) return null;

  const score = firstNumber(data.trend_score, data.score, data.viral_score, data.popularity_score);
  const rank = firstNumber(data.rank, data.position) ?? index + 1;
  const why = firstString(data.why_trending, data.reason, data.insight, data.summary, data.description);
  const angle = firstString(data.content_angle, data.angle, data.hook, data.idea);
  const platforms = normalizeStringArray(data.best_platforms, data.platforms, data.channels);

  return {
    rank: Math.max(1, Math.round(rank)),
    product_name: productName,
    trend_score: Math.max(0, Math.min(100, Math.round(score ?? 75))),
    why_trending: why || `Đang có tín hiệu nhu cầu cao trong niche ${niche}.`,
    best_platforms: platforms.length ? platforms : ['tiktok', 'facebook'],
    content_angle: angle || 'Review nhanh vấn đề, demo cách dùng, kết thúc bằng CTA tự nhiên.',
    est_commission_pct: firstNumber(data.est_commission_pct, data.commission_pct, data.commission) ?? 8,
  };
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace('%', '').trim()) : NaN;
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function normalizeStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value.map(item => String(item).trim()).filter(Boolean).slice(0, 4);
    }
    if (typeof value === 'string' && value.trim()) {
      return value.split(/[,\n]/).map(item => item.trim()).filter(Boolean).slice(0, 4);
    }
  }
  return [];
}

function fallbackTrends(niche: string): TrendItem[] {
  const normalized = niche.toLowerCase();
  const byNiche: Record<string, string[]> = {
    beauty: ['Kem chống nắng SPF50+', 'Serum phục hồi da', 'Son tint lâu trôi', 'Mặt nạ dưỡng ẩm', 'Dầu tẩy trang dịu nhẹ'],
    fashion: ['Áo khoác chống nắng', 'Túi đeo chéo mini', 'Giày sneaker trắng', 'Set đồ công sở tối giản', 'Kính râm UV400'],
    tech: ['Sạc nhanh GaN', 'Tai nghe chống ồn', 'Bàn phím cơ mini', 'Đèn livestream', 'Camera hành trình'],
    food: ['Đồ ăn vặt ít calo', 'Bình giữ nhiệt', 'Cà phê đóng chai', 'Nồi chiên không dầu', 'Hộp cơm văn phòng'],
    home: ['Máy hút bụi cầm tay', 'Đèn ngủ cảm biến', 'Kệ để đồ gấp gọn', 'Tinh dầu phòng', 'Máy lọc không khí mini'],
    health: ['Vitamin tổng hợp', 'Bình nước tập gym', 'Dây kháng lực', 'Gối ngủ công thái học', 'Cân sức khoẻ thông minh'],
  };
  const names = byNiche[normalized] ?? byNiche.beauty;

  return names.map((name, index) => ({
    rank: index + 1,
    product_name: name,
    trend_score: 88 - index * 4,
    why_trending: 'Được chọn từ fallback theo niche vì AI không trả về danh sách trend hợp lệ.',
    best_platforms: index < 3 ? ['tiktok', 'facebook'] : ['facebook', 'instagram'],
    content_angle: 'Mở đầu bằng pain point thực tế, demo lợi ích chính, so sánh trước/sau và CTA nhẹ.',
    est_commission_pct: 8,
  }));
}

export async function offerAgent(input: AgentInput): Promise<AgentOutput> {
  const niche = input.context?.user_profile?.niche_primary ?? 'beauty';
  const networks = input.context?.user_profile?.active_networks?.join(', ') || 'shopee, accesstrade';
  const result = await callLLMJson<OfferResult>({
    agent: 'offer',
    userMessage: `Top 5 offers tốt nhất.\nNiche: ${niche}\nNetworks: ${networks}\nYêu cầu: ${input.user_message}`,
    json: true,
    timeoutMs: 45_000,
  });

  const offers = result.offers ?? [];
  if (offers.length === 0) throw new Error('Offer agent returned no offers');
  const content = offers
    .map(o => `${o.rank}. **${o.product_name}** (${o.network})\n   HH: ${o.commission_pct}% | EPC: ${(o.epc_estimate_vnd / 1000).toFixed(1)}K đ | Match: ${o.match_score}%\n   - ${o.why_recommended}`)
    .join('\n\n');
  return {
    success: true,
    intent: 'offer_find',
    structured_data: result as unknown as Record<string, unknown>,
    content: `Top ${offers.length} offers:\n\n${content}`,
  };
}

export async function analystAgent(input: AgentInput): Promise<AgentOutput> {
  const ctxStr = input.context?.user_profile
    ? `User: niche=${input.context.user_profile.niche_primary}, avg_score=${input.context.user_profile.avg_quality_score ?? 'N/A'}`
    : '';
  const result = await callLLM({
    agent: 'analyst',
    userMessage: input.user_message,
    extraContext: ctxStr || undefined,
    timeoutMs: 45_000,
  });
  return { success: true, intent: 'performance_review', content: result.text };
}

export async function engageAgent(input: AgentInput): Promise<AgentOutput> {
  const knowledge = input.context?.retrieved_knowledge
    ?.map(k => k.chunk_text)
    .join('\n\n')
    .slice(0, 1500);
  const result = await callLLM({
    agent: 'engage',
    userMessage: `Tin nhắn từ khách: "${input.user_message}"`,
    extraContext: knowledge ? `Thông tin sản phẩm:\n${knowledge}` : undefined,
    timeoutMs: 35_000,
  });
  return { success: true, intent: 'customer_reply', content: result.text };
}

export async function ragAgent(input: AgentInput, chunks: string[]): Promise<AgentOutput> {
  if (chunks.length === 0) {
    return {
      success: true,
      intent: 'product_research',
      content: 'Không tìm thấy trong Knowledge Base. Hãy upload tài liệu sản phẩm để AI có dữ liệu trả lời chính xác hơn.',
    };
  }
  const result = await callLLM({
    agent: 'rag',
    userMessage: input.user_message,
    extraContext: `Knowledge base:\n\n${chunks.join('\n\n---\n\n').slice(0, 4000)}`,
    timeoutMs: 45_000,
  });
  return { success: true, intent: 'product_research', content: result.text };
}

export async function schedulerAgent(input: AgentInput): Promise<AgentOutput> {
  const niche = input.context?.user_profile?.niche_primary ?? 'beauty';
  const result = await callLLMJson<ScheduleResult>({
    agent: 'scheduler',
    userMessage: [
      'Lên kế hoạch content tuần tới.',
      `Niche: ${niche}`,
      `Hôm nay: ${new Date().toLocaleDateString('vi-VN')}`,
      `Yêu cầu: ${input.user_message}`,
    ].join('\n'),
    json: true,
    timeoutMs: 45_000,
  });
  const summary = result.weekly_summary;
  const content = [
    `Kế hoạch tuần tới: ${summary?.total_posts ?? 0} bài`,
    `Theo platform: ${Object.entries(summary?.by_platform ?? {}).map(([k, v]) => `${k}:${v}`).join(' ') || 'N/A'}`,
    `Reach dự kiến: ${summary?.estimated_weekly_reach ?? 'N/A'}`,
  ].join('\n');
  return {
    success: true,
    intent: 'schedule_task',
    structured_data: result as unknown as Record<string, unknown>,
    content,
  };
}

export async function orchestrate(input: AgentInput): Promise<AgentOutput> {
  const t0 = Date.now();
  const { user_id, user_message } = input;

  let context: AgentContext = {};
  try {
    const [profile, brandKit, episodes] = await Promise.all([
      memoryService.getSemanticProfile(user_id),
      memoryService.getBrandKit(user_id),
      memoryService.getRecentEpisodes(user_id, 5),
    ]);
    context = {
      user_profile: profile ?? undefined,
      brand_kit: brandKit ?? undefined,
      recent_episodes: episodes,
    };
  } catch (error) {
    console.warn(`[Orch] Context load failed: ${(error as Error).message}`);
  }

  const ai = { ...input, context };
  const plan = await runOrchestrator(ai);
  console.info(`[Orch] intent=${plan.intent} (${Date.now() - t0}ms)`);

  let result: AgentOutput;
  try {
    result = await dispatch(plan.intent, { ...ai, user_message: plan.cleaned_message || user_message });
  } catch (error) {
    const message = (error as Error).message || 'Agent không tạo được phản hồi';
    console.error(`[Orch] Dispatch failed for ${plan.intent}: ${message}`);
    result = { success: false, intent: plan.intent, error: message };
  }

  if (result.success) {
    memoryService.saveEpisodicEvent(user_id, {
      event_type: 'agent_response',
      event_data: { intent: plan.intent, message: user_message.slice(0, 200) },
      outcome: { quality_score: result.quality_score },
    }).catch(console.error);
  }

  console.info(`[Orch] Total ${Date.now() - t0}ms`);
  return result;
}

function getEvaluationFeedback(output: AgentOutput): string {
  if (output.error?.trim()) return output.error.trim();

  const evalResult = output.structured_data?.eval as Partial<EvalResult> | undefined;
  return [
    ...(evalResult?.specific_fixes ?? []),
    ...(evalResult?.weaknesses ?? []),
  ].filter(Boolean).slice(0, 5).join('; ');
}

function buildContentImprovementPrompt(originalRequest: string, previousContent: string, score: number, feedback: string): string {
  return [
    originalRequest,
    '',
    `The previous draft scored ${score}/100. Rewrite it to reach at least ${TARGET_CONTENT_QUALITY_SCORE}/100.`,
    `Evaluator feedback to fix: ${feedback}`,
    '',
    'Previous draft:',
    previousContent.slice(0, 2500),
    '',
    'Rewrite requirements:',
    '- Keep the same requested platform(s) and product/niche.',
    '- Strengthen the first 3 seconds / first line hook.',
    '- Add a clearer audience pain point and specific use case.',
    '- Add concrete proof only when available; otherwise use honest verification wording.',
    '- Make the CTA natural and actionable.',
    '- Remove filler, vague claims, and robotic wording.',
  ].join('\n');
}

async function dispatch(intent: AgentIntent, input: AgentInput): Promise<AgentOutput> {
  switch (intent) {
    case 'content_create': {
      let candidate = await evaluatorAgent(await contentAgent(input), input.context);
      for (let pass = 1; pass <= MAX_CONTENT_IMPROVEMENT_PASSES; pass += 1) {
        const score = candidate.quality_score ?? 0;
        const feedback = getEvaluationFeedback(candidate);
        if (score >= TARGET_CONTENT_QUALITY_SCORE || !feedback) break;
        const improved = await contentAgent({
          ...input,
          user_message: buildContentImprovementPrompt(input.user_message, candidate.content ?? '', score, feedback),
        });
        const improvedScored = await evaluatorAgent(improved, input.context);
        if ((improvedScored.quality_score ?? 0) >= score) candidate = improvedScored;
      }
      return candidate;
    }
    case 'trend_research': {
      const [trends, offers] = await Promise.all([trendAgent(input), offerAgent(input)]);
      return {
        success: true,
        intent,
        content: `${trends.content ?? ''}\n\n---\n\n${offers.content ?? ''}`.trim(),
        structured_data: { trends: trends.structured_data, offers: offers.structured_data },
      };
    }
    case 'offer_find':
      return offerAgent(input);
    case 'performance_review':
      return analystAgent(input);
    case 'customer_reply': {
      const reply = await engageAgent(input);
      return evaluatorAgent(reply, input.context, 'facebook');
    }
    case 'schedule_task':
      return schedulerAgent(input);
    case 'product_research': {
      try {
        const { ragService } = await import('../services/memory/rag-service.js') as any;
        const chunks = await ragService.search(input.user_id, input.user_message);
        return ragAgent(input, (chunks ?? []).map((chunk: { chunk_text: string }) => chunk.chunk_text));
      } catch {
        return ragAgent(input, []);
      }
    }
    default:
      return contentAgent(input);
  }
}

function detectIntentFallback(msg: string): AgentIntent {
  const lower = msg.toLowerCase();
  if (/viết|viet|tạo|tao|review|caption|script|content/.test(lower)) return 'content_create';
  if (/trend|hot|viral|nổi|noi|đang bán|dang ban/.test(lower)) return 'trend_research';
  if (/offer|hoa hồng|hoa hong|commission|nên quảng cáo|nen quang cao/.test(lower)) return 'offer_find';
  if (/báo cáo|bao cao|hiệu suất|hieu suat|ctr|doanh thu/.test(lower)) return 'performance_review';
  if (/trả lời|tra loi|inbox|comment|khách|khach|reply/.test(lower)) return 'customer_reply';
  if (/lịch|lich|kế hoạch|ke hoach|calendar/.test(lower)) return 'schedule_task';
  if (/knowledge|tài liệu|tai lieu|nghiên cứu|nghien cuu/.test(lower)) return 'product_research';
  return 'content_create';
}

function normalizePlatform(value: string): Platform | null {
  const lower = value.toLowerCase().trim();
  if (lower === 'fb') return 'facebook';
  if (lower === 'ig') return 'instagram';
  if (['tiktok', 'facebook', 'instagram', 'blog', 'youtube', 'zalo', 'email'].includes(lower)) {
    return lower as Platform;
  }
  return null;
}

function detectPlatforms(msg: string): Platform[] {
  const lower = msg
    .toLowerCase()
    .replace(/\btiktok\s*shop\b/g, 'marketplace')
    .replace(/\bshop\s*tiktok\b/g, 'marketplace');
  const patterns: Array<[Platform, RegExp]> = [
    ['facebook', /\b(facebook|fb|caption facebook|bài đăng facebook|post facebook)\b/i],
    ['tiktok', /\b(tiktok|tik tok|kịch bản tiktok|video tiktok|script tiktok)\b/i],
    ['instagram', /\b(instagram|insta|ig|reels|story instagram|caption instagram)\b/i],
    ['youtube', /\b(youtube|yt|shorts|youtube shorts)\b/i],
    ['zalo', /\b(zalo|zalo oa|oa)\b/i],
    ['email', /\b(email|newsletter|subject line)\b/i],
    ['blog', /\b(blog|bài viết|article|seo article)\b/i],
  ];
  const found = patterns
    .filter(([, pattern]) => pattern.test(lower))
    .map(([platform]) => platform);
  return found.length ? [...new Set(found)] : ['tiktok', 'facebook', 'instagram'];
}

function buildContextStr(ctx?: AgentContext): string {
  if (!ctx?.user_profile) return '';
  const profile = ctx.user_profile;
  const parts = [
    `Niche: ${profile.niche_primary ?? 'unknown'}, Tone: ${profile.preferred_tone ?? 'neutral'}, Style: ${profile.language_style ?? 'neutral'}`,
  ];
  if (profile.avoided_words?.length) parts.push(`Tránh dùng: ${profile.avoided_words.join(', ')}`);
  if (profile.avg_quality_score) parts.push(`Avg score: ${profile.avg_quality_score}`);
  if (ctx.brand_kit?.style_keywords?.length) parts.push(`Brand style: ${ctx.brand_kit.style_keywords.join(', ')}`);
  return parts.join('\n');
}

export { callLLM, callLLMJson };
export const AGENTS = null;
