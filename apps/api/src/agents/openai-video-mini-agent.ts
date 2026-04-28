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
        model: process.env.OPENAI_VIDEO_AGENT_MODEL || 'gpt-4o',
        response_format: { type: 'json_object' },
        max_tokens: 260,
        messages: [
          {
            role: 'system',
            content: [
              'You are a short-form video editing planner for affiliate videos.',
              'Choose the strongest highlight window for a vertical clip.',
              'Favor segments with an early hook, concrete value, demo/review intent, and a clean ending.',
              'Return JSON only.',
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              `Clip duration target: ${input.clipDuration} seconds.`,
              `Source duration: ${round2(input.videoDuration)} seconds.`,
              'Select one highlight for a TikTok/Reels style clip.',
              'Avoid weak intros if possible.',
              'Transcript segments:',
              segmentSummary,
              'Return valid JSON:',
              '{"start": 12.5, "end": 52.5, "hook_text": "short opening hook", "hook_frame_time": 14.0, "opening_caption": "optional 3-6 word caption"}',
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
