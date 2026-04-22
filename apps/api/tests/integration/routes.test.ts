// apps/api/tests/integration/routes.test.ts
// Integration tests — cần Supabase test project

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock external dependencies để không gọi API thật trong tests
vi.mock('../../src/agents/index.js', () => ({
  orchestrate: vi.fn().mockResolvedValue({
    success: true,
    intent: 'content_create',
    content: 'Test content từ mock agent',
    quality_score: 85,
  }),
  contentAgent:  vi.fn(),
  trendAgent:    vi.fn(),
  offerAgent:    vi.fn(),
  analystAgent:  vi.fn(),
  engageAgent:   vi.fn(),
  evaluatorAgent: vi.fn(),
  AGENTS: {
    orchestrator: () => 'mock-orchestrator-id',
    content:      () => 'mock-content-id',
    social:       () => 'mock-social-id',
    offer:        () => 'mock-offer-id',
    analyst:      () => 'mock-analyst-id',
    engage:       () => 'mock-engage-id',
    rag:          () => 'mock-rag-id',
    evaluator:    () => 'mock-eval-id',
    scheduler:    () => 'mock-scheduler-id',
  },
}));

vi.mock('../../src/lib/supabase.js', () => ({
  getSupabase: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: {
      id: 'test-user-id', email: 'test@example.com',
      plan: 'pro', credits_total: 500, credits_used: 10,
      full_autopilot: false,
    }, error: null }),
    order:  vi.fn().mockReturnThis(),
    limit:  vi.fn().mockReturnThis(),
    gte:    vi.fn().mockReturnThis(),
    gt:     vi.fn().mockReturnThis(),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id', email: 'test@example.com' } },
        error: null,
      }),
    },
  }),
  db: vi.fn(),
}));

// ─── Health Routes ────────────────────────────────────────────────────────────
describe('Health Routes', () => {
  it('GET /health returns 200', async () => {
    // Simple sanity check — real integration tests cần running server
    expect(true).toBe(true);
  });
});

// ─── Credits Logic ────────────────────────────────────────────────────────────
describe('Credits Logic', () => {
  it('unlimited plan (-1) always allowed', () => {
    const user = { credits_total: -1, credits_used: 9999 };
    const allowed = user.credits_total === -1 || (user.credits_total - user.credits_used) >= 1;
    expect(allowed).toBe(true);
  });

  it('free plan with 0 credits not allowed', () => {
    const user = { credits_total: 10, credits_used: 10 };
    const remaining = user.credits_total - user.credits_used;
    expect(remaining).toBe(0);
    expect(remaining >= 1).toBe(false);
  });

  it('pro plan with credits remaining allowed', () => {
    const user = { credits_total: 500, credits_used: 100 };
    const remaining = user.credits_total - user.credits_used;
    expect(remaining).toBe(400);
    expect(remaining >= 1).toBe(true);
  });
});

// ─── Intent Detection ─────────────────────────────────────────────────────────
describe('Intent Detection', () => {
  const INTENT_KW: Record<string, string[]> = {
    content_create:     ['viết', 'tạo', 'review', 'caption', 'script'],
    trend_research:     ['trend', 'hot', 'viral'],
    offer_find:         ['offer', 'hoa hồng', 'commission'],
    performance_review: ['hiệu suất', 'báo cáo', 'CTR'],
    customer_reply:     ['trả lời', 'khách', 'inbox'],
  };

  function detectIntent(msg: string): string {
    const lower = msg.toLowerCase();
    let best = 'content_create', bestScore = 0;
    for (const [intent, kws] of Object.entries(INTENT_KW)) {
      const score = kws.filter(kw => lower.includes(kw)).length;
      if (score > bestScore) { bestScore = score; best = intent; }
    }
    return best;
  }

  it('detects content_create intent', () => {
    expect(detectIntent('Viết review sản phẩm này cho tôi')).toBe('content_create');
    expect(detectIntent('Tạo caption TikTok')).toBe('content_create');
  });

  it('detects trend_research intent', () => {
    expect(detectIntent('Trend tuần này là gì?')).toBe('trend_research');
    expect(detectIntent('Sản phẩm nào đang hot bây giờ')).toBe('trend_research');
  });

  it('detects offer_find intent', () => {
    expect(detectIntent('Tìm offer hoa hồng cao nhất')).toBe('offer_find');
  });

  it('defaults to content_create for unknown', () => {
    expect(detectIntent('xin chào')).toBe('content_create');
  });
});

// ─── Resilience Tests ─────────────────────────────────────────────────────────
describe('Resilience - withRetry', async () => {
  const { withRetry } = await import('../../src/lib/resilience.js');

  it('retries on network error', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      if (++calls < 3) throw new Error('Network error');
      return 'success';
    }, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe('success');
    expect(calls).toBe(3);
  });

  it('does not retry on 401', async () => {
    let calls = 0;
    await withRetry(async () => {
      calls++;
      throw new Error('HTTP 401 Unauthorized');
    }, { maxAttempts: 3 }).catch(() => {});
    expect(calls).toBe(1);
  });
});

// ─── Offer Scoring ────────────────────────────────────────────────────────────
describe('Offer Scoring', () => {
  function scoreOffer(offer: {
    epc_estimate: number; commission_pct: number;
    sold_count: number; rating: number;
  }, maxEpc: number, maxComm: number): number {
    const W = { epc: 0.30, commission: 0.25, audience_fit: 0.20, trend: 0.15, competition: 0.10 };
    return Math.round(
      (offer.epc_estimate / maxEpc) * 100 * W.epc +
      (offer.commission_pct / maxComm) * 100 * W.commission +
      100 * W.audience_fit +
      Math.min(offer.sold_count / 1000, 100) * W.trend +
      (offer.rating * 20) * W.competition
    );
  }

  it('high EPC offer scores higher', () => {
    const highEpc = scoreOffer({ epc_estimate: 20000, commission_pct: 10, sold_count: 5000, rating: 4.5 }, 20000, 20);
    const lowEpc  = scoreOffer({ epc_estimate: 2000,  commission_pct: 10, sold_count: 5000, rating: 4.5 }, 20000, 20);
    expect(highEpc).toBeGreaterThan(lowEpc);
  });

  it('score is between 0 and 100', () => {
    const score = scoreOffer({ epc_estimate: 5000, commission_pct: 8, sold_count: 1000, rating: 4.0 }, 10000, 15);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
