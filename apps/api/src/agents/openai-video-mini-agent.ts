import OpenAI from 'openai';
import { withRetry, withTimeout } from '../lib/resilience.js';

export interface VideoTranscriptSegment {
  text: string;
  start: number;
  end: number;
}

export interface OpenAiVideoMiniAgentInput {
  transcriptText: string;
  segments: VideoTranscriptSegment[];
  clipDuration: number;
  videoDuration: number;
}

export interface OpenAiVideoEditPlan {
  start?: number;
  end?: number;
  hook_text?: string;
  hook_frame_time?: number;
  opening_caption?: string;
}

let openaiClient: OpenAI | null = null;

export async function generateVideoEditPlan(input: OpenAiVideoMiniAgentInput): Promise<OpenAiVideoEditPlan> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  const cleanedSegments = input.segments
    .filter(segment => segment.text?.trim())
    .map(segment => ({
      start: round2(segment.start),
      end: round2(segment.end),
      text: segment.text.trim().replace(/\s+/g, ' '),
    }));

  if (cleanedSegments.length === 0) {
    throw new Error('Transcript has no usable segments');
  }

  const segmentSummary = cleanedSegments
    .slice(0, 140)
    .map((segment, index) => `${index + 1}. [${segment.start}-${segment.end}] ${segment.text}`)
    .join('\n')
    .slice(0, 14_000);

  const response = await withRetry(
    () => withTimeout(
      () => getOpenAiClient().chat.completions.create({
        model: process.env.OPENAI_VIDEO_AGENT_MODEL || 'gpt-5.5',
        response_format: { type: 'json_object' },
        max_tokens: 260,
        messages: [
          {
            role: 'system',
            content: [
              'You are a senior short-form video editor for Vietnamese affiliate content.',
              'Your job is to choose one contiguous highlight window that can stand alone as a TikTok/Reels/Shorts clip.',
              'Optimize for retention and conversion without sounding spammy.',
              'Prefer a window with: an immediate curiosity hook, a clear product problem or desire, proof/demo/review value, a visible result or reason to care, and a clean ending.',
              'Avoid: greetings, long setup, repeated filler, dead air, off-topic talk, pure price-only selling, claims without context, and clips that begin mid-sentence unless the hook is still clear.',
              'Return strict JSON only. Do not include markdown, explanation, comments, or extra keys.',
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              `Clip duration target: ${input.clipDuration} seconds.`,
              `Source duration: ${round2(input.videoDuration)} seconds.`,
              'Select the best highlight window for a vertical affiliate clip.',
              'Rules:',
              `- Duration must be close to ${input.clipDuration} seconds, never longer than the target unless the transcript requires a natural sentence ending.`,
              '- Start at the strongest natural hook, usually after weak greetings or setup.',
              '- Keep the first 1-3 seconds understandable without extra context.',
              '- Prefer review/demo/problem-solution/proof moments over generic descriptions.',
              '- End on a complete idea, mini-payoff, recommendation, or soft CTA.',
              '- hook_frame_time must point to the best frame or moment for the thumbnail/opening title inside the selected window.',
              '- hook_text must be Vietnamese, punchy, natural, and at most 80 characters.',
              '- opening_caption must be Vietnamese, 3-8 words, suitable as large on-screen text.',
              'Transcript segments:',
              segmentSummary,
              'Return exactly this JSON shape:',
              '{"start": 12.5, "end": 52.5, "hook_text": "Da dầu nên xem đoạn này", "hook_frame_time": 14.0, "opening_caption": "Đừng mua vội"}',
            ].join('\n'),
          },
        ],
      }),
      30_000,
      'OpenAI video mini-agent timed out after 30000ms'
    ),
    { maxAttempts: 2, baseDelayMs: 1200 }
  );

  const content = response.choices[0]?.message?.content ?? '{}';
  return JSON.parse(content) as OpenAiVideoEditPlan;
}

function getOpenAiClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing');
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
