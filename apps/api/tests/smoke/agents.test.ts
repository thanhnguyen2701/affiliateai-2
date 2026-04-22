// apps/api/tests/smoke/agents.test.ts
// Smoke tests — chạy sau mỗi deploy để verify agents còn sống

import { describe, it, expect, vi } from 'vitest';
import { withRetry, CircuitBreaker, withTimeout } from '../../src/lib/resilience.js';

// NOTE: Smoke tests thực sự gọi CakeAI API
// Để chạy: CAKEAI_API_KEY=xxx vitest run tests/smoke
// Trong CI: chạy với real credentials từ secrets

const SMOKE_USER_ID = 'smoke-test-user-00000000';
const IS_REAL_RUN   = Boolean(process.env.CAKEAI_API_KEY && process.env.CAKEAI_CONTENT_ID);

// ─── Mock khi không có real credentials ──────────────────────────────────────
vi.mock('../../src/agents/index.js', async (importOriginal) => {
  if (IS_REAL_RUN) return importOriginal();

  return {
    callAgent: vi.fn().mockImplementation(async (opts: { agentId: string }) => {
      // Simulate valid agent responses
      if (opts.agentId.includes('eval')) {
        return JSON.stringify({
          total_score: 74, max_score: 80, passed: true,
          scores: { hook: 8, problem: 9 },
          strengths: ['Hook tốt'], weaknesses: [],
          specific_fixes: [], regenerate_instruction: null,
        });
      }
      return JSON.stringify({
        results: [{
          platform: 'tiktok',
          content: 'Hook: Bạn có biết kem này giúp da sáng sau 7 ngày không? Demo thực tế...',
          hashtags: ['#skincare', '#beauty', '#review'],
          cta: 'Link trong bio nhé!',
          best_posting_time: '19:00-21:00',
        }]
      });
    }),
    callAgentJSON: vi.fn().mockImplementation(async (opts: { agentId: string }) => {
      if (opts.agentId.includes('eval')) {
        return { total_score: 74, max_score: 80, passed: true, scores: {}, strengths: [], weaknesses: [], specific_fixes: [], regenerate_instruction: null };
      }
      return { results: [{ platform: 'tiktok', content: 'Test content', hashtags: [], cta: 'Link bio' }] };
    }),
    orchestrate: vi.fn().mockResolvedValue({
      success: true, intent: 'content_create',
      content: 'Test orchestrated content', quality_score: 78,
    }),
    AGENTS: {
      orchestrator: () => 'ag_mock_orch',
      content:      () => 'ag_mock_content',
      evaluator:    () => 'ag_mock_eval',
      social:       () => 'ag_mock_social',
      offer:        () => 'ag_mock_offer',
      analyst:      () => 'ag_mock_analyst',
      engage:       () => 'ag_mock_engage',
      rag:          () => 'ag_mock_rag',
      scheduler:    () => 'ag_mock_scheduler',
    },
  };
});

vi.mock('../../src/services/memory/memory-service.js', () => ({
  memoryService: {
    getSemanticProfile:  vi.fn().mockResolvedValue(null),
    getBrandKit:         vi.fn().mockResolvedValue(null),
    getRecentEpisodes:   vi.fn().mockResolvedValue([]),
    saveEpisodicEvent:   vi.fn().mockResolvedValue(undefined),
    learnFromFeedback:   vi.fn().mockResolvedValue(undefined),
    searchKnowledge:     vi.fn().mockResolvedValue([]),
    addKnowledgeChunk:   vi.fn().mockResolvedValue('chunk-id-123'),
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('Agent Smoke Tests', () => {

  it('content agent returns valid bundle structure', async () => {
    const { contentAgent } = await import('../../src/agents/index.js');
    const result = await (contentAgent as Function)({
      user_id:      SMOKE_USER_ID,
      user_message: 'Viết review TikTok cho kem dưỡng da Innisfree, link https://shp.ee/test',
    });

    expect(result.success).toBe(true);
    expect(result.intent).toBe('content_create');
    expect(result.structured_data ?? result.content).toBeTruthy();
  }, 40_000);

  it('evaluator returns score between 0-100', async () => {
    const { evaluatorAgent } = await import('../../src/agents/index.js');
    const mockOutput = {
      success: true, intent: 'content_create' as const,
      content: 'Bạn đang tìm kem dưỡng da tốt? Tôi đã thử 10 loại và đây là loại hiệu quả nhất...',
    };

    const result = await (evaluatorAgent as Function)(mockOutput, undefined, 'tiktok_script');

    expect(result.success).toBe(true);
    expect(result.quality_score).toBeGreaterThanOrEqual(0);
    expect(result.quality_score).toBeLessThanOrEqual(100);
  }, 30_000);

  it('orchestrate returns success for content intent', async () => {
    const { orchestrate } = await import('../../src/agents/index.js');
    const result = await (orchestrate as Function)({
      user_id:      SMOKE_USER_ID,
      user_message: 'Tạo content TikTok review sản phẩm dưỡng da',
    });

    expect(result.success).toBe(true);
    expect(result.intent).toBeTruthy();
    expect(result.content || result.structured_data).toBeTruthy();
  }, 60_000);

  it('orchestrate returns success for trend intent', async () => {
    const { orchestrate } = await import('../../src/agents/index.js');
    const result = await (orchestrate as Function)({
      user_id:      SMOKE_USER_ID,
      user_message: 'Trend hôm nay là gì? Sản phẩm nào đang hot?',
      intent:       'trend_research',
    });

    expect(result.success).toBe(true);
  }, 40_000);
});

// ─── Resilience Smoke ─────────────────────────────────────────────────────────
describe('Resilience Smoke', () => {
  it('CircuitBreaker opens and provides fallback', async () => {
    const cb = new CircuitBreaker('smoke-test', 2, 1000);
    const failing = () => Promise.reject(new Error('service down'));
    await cb.call(failing).catch(() => {});
    await cb.call(failing).catch(() => {});
    expect(cb.status().state).toBe('open');

    const result = await cb.call(failing, () => 'fallback');
    expect(result).toBe('fallback');
  });

  it('withTimeout rejects slow operations', async () => {
    const slow = () => new Promise<string>(r => setTimeout(() => r('slow'), 200));
    await expect(withTimeout(slow, 50, 'too slow')).rejects.toThrow('too slow');
  });
});
