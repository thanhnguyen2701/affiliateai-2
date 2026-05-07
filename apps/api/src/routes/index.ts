// apps/api/src/routes/index.ts
// Tất cả API routes

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { z } from 'zod';
import { orchestrate } from '../agents/index.js';
import { memoryService } from '../services/memory/memory-service.js';
import { getSupabase } from '../lib/supabase.js';
import { visualQueue } from '../services/visual/visual-queue.js';

function multipartFieldValues(input: unknown): string[] {
  if (Array.isArray(input)) return input.flatMap(multipartFieldValues);
  if (!input || typeof input !== 'object') return [];
  const value = (input as { value?: unknown }).value;
  if (Array.isArray(value)) return value.map(item => String(item));
  if (value === undefined || value === null) return [];
  return [String(value)];
}

function extensionFromMime(mimeType: string): string {
  if (mimeType.includes('png')) return '.png';
  if (mimeType.includes('webp')) return '.webp';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg';
  if (mimeType.includes('mp4')) return '.mp4';
  if (mimeType.includes('quicktime')) return '.mov';
  return '';
}

const CONTENT_PLATFORMS = ['tiktok', 'facebook', 'instagram', 'blog', 'youtube', 'zalo', 'email'] as const;
type ContentPlatform = typeof CONTENT_PLATFORMS[number];
type HistoryPlatform = ContentPlatform | 'trends' | 'offers';

function normalizeContentPlatform(value: unknown): ContentPlatform | null {
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  const aliases: Record<string, ContentPlatform> = {
    fb: 'facebook',
    face: 'facebook',
    ig: 'instagram',
    insta: 'instagram',
    reels: 'instagram',
    reel: 'instagram',
    shorts: 'youtube',
    short: 'youtube',
    yt: 'youtube',
    article: 'blog',
    post: 'blog',
  };
  const normalized = aliases[lower] ?? lower;
  return (CONTENT_PLATFORMS as readonly string[]).includes(normalized)
    ? normalized as ContentPlatform
    : null;
}

function inferContentPlatform(message: string, content: string): ContentPlatform {
  const source = `${message}\n${content.slice(0, 1200)}`.toLowerCase();
  const patterns: Array<[ContentPlatform, RegExp]> = [
    ['tiktok', /\b(tiktok|tik tok|kịch bản video|script|viral|fyp|link bio)\b/i],
    ['facebook', /\b(facebook|fb|caption facebook|bài đăng facebook|comment|inbox)\b/i],
    ['instagram', /\b(instagram|insta|ig|reels|story|bio|carousel)\b/i],
    ['youtube', /\b(youtube|shorts|yt|video dài|thumbnail)\b/i],
    ['zalo', /\b(zalo|oa|broadcast)\b/i],
    ['email', /\b(email|newsletter|subject line|tiêu đề email)\b/i],
    ['blog', /\b(blog|bài viết|article|seo|h2|h3|mục lục)\b/i],
  ];
  return patterns.find(([, pattern]) => pattern.test(source))?.[0] ?? 'tiktok';
}

function detectRequestedHistoryPlatforms(message: string): ContentPlatform[] {
  const source = message
    .toLowerCase()
    .replace(/\btiktok\s*shop\b/g, 'marketplace')
    .replace(/\bshop\s*tiktok\b/g, 'marketplace');
  const patterns: Array<[ContentPlatform, RegExp]> = [
    ['facebook', /\b(facebook|fb|caption facebook|bài đăng facebook|post facebook)\b/i],
    ['tiktok', /\b(tiktok|tik tok|kịch bản tiktok|video tiktok|script tiktok)\b/i],
    ['instagram', /\b(instagram|insta|ig|reels|story instagram|caption instagram)\b/i],
    ['youtube', /\b(youtube|yt|shorts|youtube shorts)\b/i],
    ['zalo', /\b(zalo|zalo oa|oa)\b/i],
    ['email', /\b(email|newsletter|subject line)\b/i],
    ['blog', /\b(blog|bài viết|article|seo article)\b/i],
  ];
  return [...new Set(patterns.filter(([, pattern]) => pattern.test(source)).map(([platform]) => platform))];
}

function contentRowsForHistory(params: {
  userId: string;
  message: string;
  content: string;
  structured?: Record<string, unknown>;
  qualityScore?: number;
}): Array<Record<string, unknown>> {
  const structured = params.structured ?? {};
  const platforms: ContentPlatform[] = [];
  const hashtags: string[] = [];

  for (const [key, value] of Object.entries(structured)) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const platform = normalizeContentPlatform(item.platform) ?? normalizeContentPlatform(key);
    if (platform) platforms.push(platform);
    if (Array.isArray(item.hashtags)) {
      hashtags.push(...item.hashtags.map(tag => String(tag).trim()).filter(Boolean));
    }
  }

  const requestedPlatforms = detectRequestedHistoryPlatforms(params.message);
  const platform = requestedPlatforms[0] ?? platforms[0] ?? inferContentPlatform(params.message, params.content);
  const uniqueHashtags = [...new Set(hashtags)].slice(0, 30);

  return [{
    user_id: params.userId,
    content: params.content.slice(0, 10000),
    platform,
    content_type: platforms.length > 1 ? 'multi_platform_content' : platform,
    hashtags: uniqueHashtags,
    quality_score: params.qualityScore,
  }];
}

function normalizeQualityScore(value: unknown): number | null {
  const score = Number(value);
  return Number.isFinite(score)
    ? Math.max(0, Math.min(100, Math.round(score)))
    : null;
}

function normalizeHistoryRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows
    .map(row => {
      const platform = typeof row.platform === 'string' && row.platform.trim()
        ? row.platform.trim().slice(0, 50)
        : '';
      const content = typeof row.content === 'string' ? row.content.trim().slice(0, 10000) : '';
      if (!platform || !content) return null;

      return {
        user_id: row.user_id,
        product_name: typeof row.product_name === 'string' ? row.product_name.slice(0, 500) : null,
        affiliate_network: typeof row.affiliate_network === 'string' ? row.affiliate_network.slice(0, 50) : null,
        affiliate_link: typeof row.affiliate_link === 'string' ? row.affiliate_link : null,
        platform,
        content_type: typeof row.content_type === 'string' ? row.content_type.slice(0, 50) : platform,
        content,
        hashtags: Array.isArray(row.hashtags) ? row.hashtags.map(tag => String(tag).trim()).filter(Boolean) : [],
        quality_score: normalizeQualityScore(row.quality_score),
      };
    })
    .filter((row): row is Record<string, unknown> => Boolean(row));
}

async function saveContentHistoryRows(
  db: ReturnType<typeof getSupabase>,
  rows: Array<Record<string, unknown>>,
  log: { error: (payload: unknown, message?: string) => void }
): Promise<string | null> {
  const normalizedRows = normalizeHistoryRows(rows);
  if (normalizedRows.length === 0) return null;

  const { data, error } = await db
    .from('content_history')
    .insert(normalizedRows)
    .select('id')
    .limit(1);

  if (!error) return data?.[0]?.id ?? null;

  log.error({ err: error, rows: normalizedRows.map(row => ({ platform: row.platform, content_type: row.content_type })) }, 'Failed to save content_history rows');

  if (normalizedRows.length === 1) return null;

  const fallback = {
    ...normalizedRows[0],
    content: normalizedRows.map(row => String(row.content)).join('\n\n---\n\n').slice(0, 10000),
  };
  const retry = await db
    .from('content_history')
    .insert(fallback)
    .select('id')
    .single();

  if (retry.error) {
    log.error({ err: retry.error, platform: fallback.platform }, 'Failed to save content_history fallback row');
    return null;
  }
  return retry.data?.id ?? null;
}

function researchRowsForHistory(params: {
  userId: string;
  intent: string;
  content: string;
}): Array<Record<string, unknown>> {
  if (params.intent === 'offer_find') {
    return [{
      user_id: params.userId,
      content: params.content.slice(0, 10000),
      platform: 'offers' satisfies HistoryPlatform,
      content_type: 'top_offers',
    }];
  }

  if (params.intent !== 'trend_research') return [];

  return [{
    user_id: params.userId,
    content: params.content.slice(0, 10000),
    platform: 'trends' satisfies HistoryPlatform,
    content_type: params.content.toLowerCase().includes('top offers')
      ? 'trend_research_with_offers'
      : 'trend_research',
  }];
}

function visualUrlSourceType(productUrl: string): 'shopee_url' | 'lazada_url' | null {
  try {
    const host = new URL(productUrl).hostname.toLowerCase();
    if (host.includes('shopee.vn') || host.includes('shp.ee')) return 'shopee_url';
    if (host.includes('lazada.vn') || host.includes('lzd.co')) return 'lazada_url';
  } catch {
    const lower = productUrl.toLowerCase();
    if (lower.includes('shopee.vn') || lower.includes('shp.ee')) return 'shopee_url';
    if (lower.includes('lazada.vn') || lower.includes('lzd.co')) return 'lazada_url';
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════════════════════
export async function healthRoutes(app: FastifyInstance) {

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  }));

  app.get('/health/deep', async (req, reply) => {
    const checks = await Promise.allSettled([
      // Database
      getSupabase().from('users').select('count').limit(1)
        .then(() => ({ service: 'database', status: 'ok' })),

      // CakeAI
      fetch(`${process.env.CAKEAI_BASE_URL}/health`, {
        headers: { Authorization: `Bearer ${process.env.CAKEAI_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      }).then(r => ({ service: 'cakeai', status: r.ok ? 'ok' : 'degraded' }))
        .catch(() => ({ service: 'cakeai', status: 'down' })),
    ]);

    const results = checks.map(r =>
      r.status === 'fulfilled' ? r.value : { service: 'unknown', status: 'error' }
    );

    const healthy = results.every(r => r.status === 'ok');
    return reply.status(healthy ? 200 : 207).send({
      status: healthy ? 'healthy' : 'degraded',
      checks: results,
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════
export async function authRoutes(app: FastifyInstance) {
  const db = getSupabase();

  // Register / Login via Supabase Auth
  const loginSchema = z.object({
    email:    z.string().email(),
    password: z.string().min(8),
  });

  app.post('/auth/register', async (req, reply) => {
    const { email, password } = loginSchema.parse(req.body);

    const { data, error } = await db.auth.signUp({ email, password });
    if (error) return reply.status(400).send({ success: false, error: { code: 'auth_error', message: error.message } });

    // Create user record + default profile
    if (data.user) {
      await db.from('users').upsert({
        id: data.user.id, email, plan: 'free',
        credits_total: 10, credits_used: 0,
      });
      await db.from('affiliate_profiles').upsert({ user_id: data.user.id });
      await db.from('brand_kits').upsert({ user_id: data.user.id });
    }

    return { success: true, data: { user: data.user, session: data.session } };
  });

  app.post('/auth/login', async (req, reply) => {
    const { email, password } = loginSchema.parse(req.body);
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) return reply.status(401).send({ success: false, error: { code: 'invalid_credentials', message: 'Email hoặc mật khẩu không đúng' } });

    await db.from('users').upsert({
      id: data.user.id,
      email: data.user.email ?? email,
      plan: 'free',
      credits_total: 10,
      credits_used: 0,
    }, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
    await db.from('affiliate_profiles').upsert({ user_id: data.user.id });
    await db.from('brand_kits').upsert({ user_id: data.user.id });

    // Update last_seen
    await db.from('users').update({ last_seen_at: new Date().toISOString() })
      .eq('id', data.user.id);

    return { success: true, data: { user: data.user, session: data.session } };
  });

  app.post('/auth/logout', { preHandler: [app.authenticate] }, async (req) => {
    await db.auth.signOut();
    return { success: true };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT — main endpoint
// ═══════════════════════════════════════════════════════════════════════════════
export async function agentRoutes(app: FastifyInstance) {
  const db = getSupabase();

  const chatSchema = z.object({
    message:    z.string().min(1).max(2000),
    intent:     z.string().optional(),
    product_url: z.string().url().optional(),
  });

  // POST /api/agent/chat — main entry point
  app.post('/api/agent/chat', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req as any).userId as string;
    const { message, intent, product_url } = chatSchema.parse(req.body);

    // Check credits
    const { data: user } = await db.from('users').select('*').eq('id', userId).single();
    if (!user) return reply.status(404).send({ success: false, error: { code: 'user_not_found', message: 'User không tồn tại' } });

    const creditsLeft = user.credits_total === -1 ? 999 : user.credits_total - user.credits_used;
    if (creditsLeft <= 0) {
      return reply.status(402).send({
        success: false,
        error: { code: 'insufficient_credits', message: 'Hết credits. Nâng cấp gói để tiếp tục.' }
      });
    }

    const t0 = Date.now();
    const result = await orchestrate({
      user_id: userId,
      user_message: product_url ? `${message} | URL: ${product_url}` : message,
      intent: intent as any,
    });

    if (!result.success) {
      return reply.status(502).send({
        success: false,
        error: {
          code: 'agent_failed',
          message: result.error || result.content || 'AI không tạo được phản hồi',
        },
      });
    }

    if (!result.content?.trim()) {
      return reply.status(502).send({
        success: false,
        error: {
          code: 'agent_empty_response',
          message: 'AI không trả về nội dung hiển thị',
        },
      });
    }

    // Deduct 1 credit
    await db.from('users').update({ credits_used: user.credits_used + 1 }).eq('id', userId);

    let savedContentId: string | null = null;

    // Save generated outputs to history so /dashboard/content can show drafts, trends, and offers.
    if (result.success && result.content && ['content_create', 'trend_research', 'offer_find'].includes(result.intent)) {
      const rows = result.intent === 'content_create'
        ? contentRowsForHistory({
            userId,
            message,
            content: result.content,
            structured: result.structured_data,
            qualityScore: result.quality_score,
          })
        : researchRowsForHistory({
            userId,
            intent: result.intent,
            content: result.content,
          });
      savedContentId = await saveContentHistoryRows(db, rows, req.log);
    }

    return {
      success: result.success,
      data: {
        intent:        result.intent,
        content:       result.content,
        structured:    result.structured_data,
        quality_score: result.quality_score,
        content_id:    savedContentId,
      },
      meta: {
        credits_used:      1,
        credits_remaining: creditsLeft - 1,
        duration_ms:       Date.now() - t0,
      },
    };
  });

  // POST /api/content/rate — user đánh giá content
  app.post('/api/content/rate', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req as any).userId as string;
    const schema = z.object({ content_id: z.string().uuid(), rating: z.number().min(1).max(5) });
    const { content_id, rating } = schema.parse(req.body);

    await db.from('content_history')
      .update({ user_rating: rating })
      .eq('id', content_id)
      .eq('user_id', userId);

    // Update semantic memory từ feedback
    const { data: content } = await db.from('content_history').select('*').eq('id', content_id).single();
    if (content) {
      await memoryService.learnFromFeedback(userId, {
        id: content_id, user_id: userId,
        event_type: rating >= 4 ? 'content_approved' : 'content_rejected',
        event_data: { platform: content.platform, content: content.content },
        outcome: { user_rating: rating },
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
      });
    }

    return { success: true };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// VISUAL — image/video generation
// ═══════════════════════════════════════════════════════════════════════════════
export async function visualRoutes(app: FastifyInstance) {
  const db = getSupabase();

  app.post('/api/visual/upload', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req as any).userId as string;
    const file = await req.file();

    if (!file) {
      return reply.status(400).send({ success: false, error: { code: 'file_required', message: 'Cần upload file ảnh hoặc video' } });
    }

    const requestedPipeline = String((file.fields?.pipeline as { value?: unknown } | undefined)?.value ?? '').toUpperCase();
    const pipeline = file.mimetype.startsWith('video/') ? 'C' : (requestedPipeline || 'A');
    const platforms = multipartFieldValues(file.fields?.platforms);
    const niche = String((file.fields?.niche as { value?: unknown } | undefined)?.value ?? '');
    const productDescription = String((file.fields?.product_description as { value?: unknown } | undefined)?.value ?? '').slice(0, 1200);
    const headline = String((file.fields?.headline as { value?: unknown } | undefined)?.value ?? '');
    const subline = String((file.fields?.subline as { value?: unknown } | undefined)?.value ?? '');
    const cta = String((file.fields?.cta as { value?: unknown } | undefined)?.value ?? '');
    const badge = String((file.fields?.badge as { value?: unknown } | undefined)?.value ?? '');
    const subStyle = String((file.fields?.sub_style as { value?: unknown } | undefined)?.value ?? '');
    const clipDurationValue = String((file.fields?.clip_duration as { value?: unknown } | undefined)?.value ?? '');
    const clipDuration = Number(clipDurationValue);

    const { data: user } = await db.from('users').select('plan').eq('id', userId).single();
    if (user?.plan === 'free') {
      return reply.status(403).send({ success: false, error: { code: 'plan_required', message: 'Visual AI cần gói Starter trở lên' } });
    }

    const buffer = await file.toBuffer();
    const originalExt = extname(file.filename ?? '').toLowerCase();
    const ext = originalExt || extensionFromMime(file.mimetype) || (pipeline === 'C' ? '.mp4' : '.jpg');
    const tempDir = resolve(process.cwd(), '.tmp', 'visual');
    mkdirSync(tempDir, { recursive: true });
    const sourcePath = resolve(tempDir, `${userId}_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`);
    await writeFile(sourcePath, buffer);

    const { data: job, error: jobError } = await db.from('visual_jobs').insert({
      user_id: userId,
      pipeline,
      status: 'queued',
      source_type: pipeline === 'C' ? 'raw_video' : 'photo_upload',
      source_url: null,
      product_info: {
        ...(niche ? { niche } : {}),
        ...(productDescription ? { product_description: productDescription } : {}),
        ...(headline ? { headline } : {}),
        ...(subline ? { subline } : {}),
        ...(cta ? { cta } : {}),
        ...(badge ? { badge } : {}),
        ...(subStyle ? { subStyle } : {}),
        ...(Number.isFinite(clipDuration) && clipDuration > 0 ? { clipDuration } : {}),
      },
    }).select().single();

    if (jobError || !job?.id) {
      return reply.status(500).send({
        success: false,
        error: { code: 'job_create_failed', message: jobError?.message ?? 'Không tạo được visual job' },
      });
    }

    visualQueue.add(job.id, userId, {
      source_path: sourcePath,
      platforms: platforms.length > 0 ? platforms : ['tiktok', 'facebook', 'instagram'],
      pipeline,
      ...(niche ? { niche } : {}),
      copy: { productDescription, headline, subline, cta, badge },
      ...(subStyle ? { subStyle } : {}),
      ...(Number.isFinite(clipDuration) && clipDuration > 0 ? { clipDuration } : {}),
    }).catch(console.error);

    return {
      success: true,
      data: { job_id: job.id, status: 'queued', message: 'Đã upload thành công, đang xử lý' },
    };
  });

  // POST /api/visual/from-url — Pipeline B: Shopee/Lazada URL
  app.post('/api/visual/from-url', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req as any).userId as string;
    const schema = z.object({
      product_url: z.string().url(),
      platforms:   z.array(z.string()).default(['tiktok', 'facebook']),
      pipeline:    z.enum(['A', 'B', 'C', 'A+C']).default('B'),
    });
    const { product_url, platforms } = schema.parse(req.body);
    const pipeline = 'B';
    const sourceType = visualUrlSourceType(product_url);
    if (!sourceType) {
      return reply.status(400).send({
        success: false,
        error: { code: 'unsupported_product_url', message: 'Chỉ hỗ trợ link sản phẩm Shopee hoặc Lazada cho luồng URL' },
      });
    }

    // Check plan
    const { data: user } = await db.from('users').select('plan').eq('id', userId).single();
    if (user?.plan === 'free') {
      return reply.status(403).send({ success: false, error: { code: 'plan_required', message: 'Visual AI cần gói Starter trở lên' } });
    }

    // Create job
    const { data: job } = await db.from('visual_jobs').insert({
      user_id:    userId,
      pipeline,
      source_type: sourceType,
      source_url:  product_url,
      product_info: { affiliate_link: product_url },
    }).select().single();

    // Queue processing (async)
    if (job) {
      visualQueue.add(job.id, userId, { product_url, platforms, pipeline }).catch(console.error);
    }

    return {
      success: true,
      data: { job_id: job?.id, status: 'queued', message: 'Đang xử lý, khoảng 3-5 phút' },
    };
  });

  // GET /api/visual/job/:id — check job status
  app.get('/api/visual/job/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req as any).userId as string;
    const { id } = req.params as { id: string };

    const { data: job } = await db.from('visual_jobs').select('*')
      .eq('id', id).eq('user_id', userId).single();

    if (!job) return reply.status(404).send({ success: false, error: { code: 'not_found', message: 'Job không tồn tại' } });

    return { success: true, data: job };
  });

  // GET /api/visual/history — lịch sử visual jobs
  app.get('/api/visual/history', { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req as any).userId as string;
    const { data } = await db.from('visual_jobs').select('id,pipeline,status,assets,api_cost_vnd,created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(20);
    return { success: true, data: data ?? [] };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════════════════════════
export async function profileRoutes(app: FastifyInstance) {
  const db = getSupabase();

  app.get('/api/profile', { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req as any).userId as string;
    const [{ data: user }, { data: profile }, { data: brandKit }] = await Promise.all([
      db.from('users').select('id,email,plan,credits_total,credits_used,full_autopilot').eq('id', userId).single(),
      db.from('affiliate_profiles').select('*').eq('user_id', userId).single(),
      db.from('brand_kits').select('*').eq('user_id', userId).single(),
    ]);
    return { success: true, data: { user, profile, brand_kit: brandKit } };
  });

  const updateProfileSchema = z.object({
    niche_primary:    z.string().optional(),
    niche_secondary:  z.array(z.string()).optional(),
    preferred_tone:   z.enum(['friendly','professional','funny','inspiring']).optional(),
    language_style:   z.enum(['bắc','nam','trung','neutral']).optional(),
    active_networks:  z.array(z.string()).optional(),
    full_autopilot:   z.boolean().optional(),
  });

  app.patch('/api/profile', { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req as any).userId as string;
    const body = updateProfileSchema.parse(req.body);

    const { full_autopilot, ...profileUpdates } = body;

    await Promise.all([
      Object.keys(profileUpdates).length > 0
        ? db.from('affiliate_profiles').upsert({ user_id: userId, ...profileUpdates })
        : Promise.resolve(),
      full_autopilot !== undefined
        ? db.from('users').update({ full_autopilot }).eq('id', userId)
        : Promise.resolve(),
    ]);

    return { success: true, message: 'Profile đã cập nhật' };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════════
export async function performanceRoutes(app: FastifyInstance) {
  const db = getSupabase();

  app.get('/api/performance/summary', { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req as any).userId as string;
    const { from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0] } = req.query as Record<string, string>;

    const { data } = await db.from('performance_data')
      .select('network, platform, clicks, conversions, revenue_vnd, date')
      .eq('user_id', userId)
      .gte('date', from)
      .order('date', { ascending: false });

    const summary = (data ?? []).reduce((acc, row) => {
      acc.total_clicks       = (acc.total_clicks ?? 0)       + row.clicks;
      acc.total_conversions  = (acc.total_conversions ?? 0)  + row.conversions;
      acc.total_revenue_vnd  = (acc.total_revenue_vnd ?? 0)  + Number(row.revenue_vnd);
      return acc;
    }, {} as Record<string, number>);

    return { success: true, data: { summary, rows: data ?? [] } };
  });
}
