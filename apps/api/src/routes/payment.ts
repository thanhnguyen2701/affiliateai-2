// apps/api/src/routes/payment.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createZaloPayOrder, verifyZaloPayCallback,
  handlePaymentSuccess, PLAN_PRICES,
} from '../services/credits.js';
import { ingestDocument, ingestProductUrl } from '../services/memory/rag-service.js';
import { getTopOffersForUser } from '../services/integrations/offer-aggregator.js';
import type { Plan, AffiliateNetwork, Niche } from '../../../packages/shared/src/types.js';

// ─── Payment Routes ────────────────────────────────────────────────────────────
export async function paymentRoutes(app: FastifyInstance) {

  // POST /api/payment/create — tạo đơn hàng ZaloPay
  app.post('/api/payment/create', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId    = (req as any).userId as string;
    const userEmail = (req as any).userEmail as string;
    const schema    = z.object({ plan: z.enum(['starter', 'pro', 'business']) });
    const { plan }  = schema.parse(req.body);

    const order = await createZaloPayOrder({ userId, plan: plan as Plan, userEmail });

    if (!order) {
      return reply.status(500).send({
        success: false,
        error: { code: 'payment_error', message: 'Không thể tạo đơn hàng. Thử lại sau.' }
      });
    }

    return {
      success: true,
      data: {
        order_url:    order.order_url,
        app_trans_id: order.app_trans_id,
        amount:       PLAN_PRICES[plan as Plan],
        plan,
      }
    };
  });

  // POST /api/payment/callback — ZaloPay gọi sau khi thanh toán thành công
  app.post('/api/payment/callback', async (req, reply) => {
    const body    = req.body as Record<string, string>;
    const mac     = body.mac ?? '';
    const data    = body.data ? JSON.parse(body.data) : {};

    if (!verifyZaloPayCallback(data, mac)) {
      return reply.status(400).send({ return_code: -1, return_message: 'Invalid mac' });
    }

    if (data.return_code === 1) {
      const embedData = JSON.parse(data.embed_data ?? '{}');
      if (embedData.user_id && embedData.plan) {
        await handlePaymentSuccess(embedData.user_id, embedData.plan);
      }
    }

    return { return_code: 1, return_message: 'success' };
  });

  // GET /api/payment/plans — danh sách gói và giá
  app.get('/api/payment/plans', async () => ({
    success: true,
    data: [
      { plan: 'starter', price: 149_000, credits: 100,  features: ['Content AI', 'Trend Scanner', '50 ảnh/tháng', '10 video/tháng'] },
      { plan: 'pro',     price: 399_000, credits: 500,  features: ['Tất cả Starter', 'Voice AI', 'Agentic Loop 24/7', '200 ảnh', '50 video'] },
      { plan: 'business',price: 999_000, credits: -1,   features: ['Không giới hạn', 'White-label', 'API access', 'Priority support'] },
    ]
  }));
}

// ─── Knowledge Base Routes ─────────────────────────────────────────────────────
export async function knowledgeRoutes(app: FastifyInstance) {

  // POST /api/knowledge/upload-text — upload text/review trực tiếp
  app.post('/api/knowledge/upload-text', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req as any).userId as string;
    const schema = z.object({
      kb_type:     z.enum(['product', 'brand', 'review', 'policy', 'content', 'competitor']),
      source_name: z.string().min(1),
      content:     z.string().min(50).max(50_000),
      metadata:    z.record(z.unknown()).optional(),
    });

    const { kb_type, source_name, content, metadata } = schema.parse(req.body);

    const chunks = await ingestDocument({
      userId, kbType: kb_type, sourceName: source_name, content, metadata,
    });

    return { success: true, data: { chunks_stored: chunks, message: `Đã lưu ${chunks} đoạn văn` } };
  });

  // POST /api/knowledge/ingest-url — crawl URL và embed
  app.post('/api/knowledge/ingest-url', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req as any).userId as string;
    const schema = z.object({
      url:     z.string().url(),
      kb_type: z.string().default('product'),
    });
    const { url, kb_type } = schema.parse(req.body);

    const result = await ingestProductUrl({ userId, url, kbType: kb_type });
    return {
      success: result.success,
      data: { chunks_stored: result.chunks, url },
      ...(result.success ? {} : { error: { code: 'ingest_failed', message: 'Không thể đọc URL' } })
    };
  });

  // GET /api/knowledge/list — danh sách documents trong KB
  app.get('/api/knowledge/list', { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req as any).userId as string;
    const { data } = await (app as any).db()
      .from('knowledge_chunks')
      .select('kb_type, source_name, source_url, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    // Dedupe by source_name
    const seen = new Set<string>();
    const sources = (data ?? []).filter((r: any) => {
      if (seen.has(r.source_name)) return false;
      seen.add(r.source_name);
      return true;
    });

    return { success: true, data: sources };
  });

  // DELETE /api/knowledge/:source — xóa 1 document
  app.delete('/api/knowledge/:source', { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req as any).userId as string;
    const source = (req.params as { source: string }).source;

    await (app as any).db()
      .from('knowledge_chunks')
      .delete()
      .eq('user_id', userId)
      .eq('source_name', source);

    return { success: true, message: `Đã xóa: ${source}` };
  });
}

// ─── Offers Routes ─────────────────────────────────────────────────────────────
export async function offersRoutes(app: FastifyInstance) {

  // GET /api/offers/top — top offers phù hợp với user
  app.get('/api/offers/top', { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req as any).userId as string;
    const { data: profile } = await (app as any).db()
      .from('affiliate_profiles')
      .select('niche_primary, active_networks')
      .eq('user_id', userId).single();

    const offers = await getTopOffersForUser({
      niche:    (profile?.niche_primary ?? null) as Niche | null,
      networks: (profile?.active_networks ?? ['shopee']) as AffiliateNetwork[],
      limit:    10,
    });

    return { success: true, data: offers };
  });
}
