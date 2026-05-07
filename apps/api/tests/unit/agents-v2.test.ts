import { beforeEach, describe, expect, it, vi } from 'vitest';

const callLLMJsonMock = vi.fn();

vi.mock('../../src/agents/llm.js', () => ({
  callLLM: vi.fn(),
  callLLMJson: callLLMJsonMock,
}));

vi.mock('../../src/services/memory/memory-service.js', () => ({
  memoryService: {
    getSemanticProfile: vi.fn().mockResolvedValue(null),
    getBrandKit: vi.fn().mockResolvedValue(null),
    getRecentEpisodes: vi.fn().mockResolvedValue([]),
    saveEpisodicEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('trendAgent', () => {
  beforeEach(() => {
    callLLMJsonMock.mockReset();
  });

  it('falls back instead of throwing when the LLM returns no trends', async () => {
    callLLMJsonMock.mockResolvedValue({ trends: [] });
    const { trendAgent } = await import('../../src/agents/agents-v2.js');

    const result = await trendAgent({
      user_id: 'user-1',
      user_message: 'Trend hom nay la gi?',
      context: { user_profile: { niche_primary: 'beauty' } },
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Top 5 trends');
    expect(result.structured_data?.source).toBe('fallback');
  });

  it('normalizes array responses from the LLM', async () => {
    callLLMJsonMock.mockResolvedValue([
      {
        name: 'Kem chong nang hot',
        score: '91',
        reason: 'Nhieu creator dang review',
        platforms: 'tiktok, facebook',
        angle: 'So sanh truoc/sau khi dung',
      },
    ]);
    const { trendAgent } = await import('../../src/agents/agents-v2.js');

    const result = await trendAgent({
      user_id: 'user-1',
      user_message: 'Trend hom nay la gi?',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Kem chong nang hot');
    expect(result.structured_data?.source).toBe('llm');
  });
});

describe('orchestrate content quality loop', () => {
  beforeEach(() => {
    callLLMJsonMock.mockReset();
  });

  it('regenerates content when evaluator score is below target', async () => {
    callLLMJsonMock
      .mockResolvedValueOnce({
        results: [{ platform: 'tiktok', content: 'Generic draft', hashtags: ['#test'], cta: 'Link bio' }],
      })
      .mockResolvedValueOnce({
        total_score: 52,
        max_score: 80,
        passed: false,
        content_type: 'tiktok',
        scores: {},
        strengths: [],
        weaknesses: ['Hook weak'],
        specific_fixes: ['Add stronger hook and clearer proof'],
        regenerate_instruction: null,
      })
      .mockResolvedValueOnce({
        results: [{ platform: 'tiktok', content: 'Stronger hook draft with proof and CTA', hashtags: ['#test'], cta: 'Link bio' }],
      })
      .mockResolvedValueOnce({
        total_score: 70,
        max_score: 80,
        passed: true,
        content_type: 'tiktok',
        scores: {},
        strengths: ['Strong hook'],
        weaknesses: [],
        specific_fixes: [],
        regenerate_instruction: null,
      });

    const { orchestrate } = await import('../../src/agents/agents-v2.js');
    const result = await orchestrate({
      user_id: 'user-1',
      user_message: 'Viet script TikTok review kem chong nang',
      intent: 'content_create',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Stronger hook draft');
    expect(result.quality_score).toBe(88);
    expect(callLLMJsonMock).toHaveBeenCalledTimes(4);
  });
});
