// apps/api/src/agents/llm.ts
// Direct LLM calls for AffiliateAI agents.

import { withRetry, withTimeout, breakers } from '../lib/resilience.js';
import { PROMPTS, AGENT_MODELS, type AgentName } from './prompts/index.js';

let openaiClient: any = null;
let anthropicClient: any = null;

async function getOpenAI() {
  if (!openaiClient) {
    const { default: OpenAI } = await import('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

async function getAnthropic() {
  if (!anthropicClient) {
    // The Anthropic SDK can select web shims under some ESM runners; force node shims first.
    await import('@anthropic-ai/sdk/shims/node').catch(() => undefined);
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

export interface LLMCallOptions {
  agent: AgentName;
  userMessage: string;
  extraContext?: string;
  timeoutMs?: number;
  json?: boolean;
}

export interface LLMResult {
  text: string;
  model: string;
  provider: string;
  tokens_used: number;
  cost_usd?: number;
}

type ChatRequest = {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  response_format?: { type: 'json_object' };
};

const COST_PER_M: Record<string, { input: number; output: number }> = {
  'gpt-5.5': { input: 5.0, output: 30.0 },
  'gpt-5.2': { input: 1.25, output: 10.0 },
  'gpt-5.1': { input: 1.25, output: 10.0 },
  'gpt-5': { input: 1.25, output: 10.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 0.25, output: 1.25 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_M[model];
  if (!rates) return 0;
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

function usesMaxCompletionTokens(model: string): boolean {
  return /^(gpt-5|o\d|o\d-)/i.test(model);
}

function supportsCustomTemperature(model: string): boolean {
  return !usesMaxCompletionTokens(model);
}

function buildOpenAIRequest(
  model: string,
  systemPrompt: string,
  userMessage: string,
  temp: number,
  json: boolean
): ChatRequest {
  const request: ChatRequest = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  };

  if (usesMaxCompletionTokens(model)) {
    request.max_completion_tokens = 2500;
  } else {
    request.max_tokens = 2500;
  }

  if (supportsCustomTemperature(model)) {
    request.temperature = temp;
  }

  if (json) {
    request.response_format = { type: 'json_object' };
  }

  return request;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function createOpenAICompletion(request: ChatRequest): Promise<any> {
  const openai = await getOpenAI();
  return openai.chat.completions.create(request as any);
}

async function callOpenAI(
  model: string,
  systemPrompt: string,
  userMessage: string,
  temp: number,
  json: boolean,
  timeoutMs: number
): Promise<LLMResult> {
  return breakers.openai.call(() =>
    withRetry(
      () =>
        withTimeout(async () => {
          const request = buildOpenAIRequest(model, systemPrompt, userMessage, temp, json);
          let res: any;

          try {
            res = await createOpenAICompletion(request);
          } catch (error) {
            const message = errorMessage(error);
            if (json && /response_format|json_object/i.test(message)) {
              const retryRequest = buildOpenAIRequest(
                model,
                systemPrompt,
                `${userMessage}\n\nReturn valid JSON only.`,
                temp,
                false
              );
              res = await createOpenAICompletion(retryRequest);
            } else {
              throw new Error(message || `OpenAI ${model} request failed`);
            }
          }

          const text = res.choices?.[0]?.message?.content ?? '';
          if (!text.trim()) throw new Error(`OpenAI ${model} returned empty content`);

          const inputTokens = res.usage?.prompt_tokens ?? 0;
          const outputTokens = res.usage?.completion_tokens ?? 0;
          return {
            text,
            model,
            provider: 'openai',
            tokens_used: inputTokens + outputTokens,
            cost_usd: estimateCost(model, inputTokens, outputTokens),
          };
        }, timeoutMs, `OpenAI ${model} timed out after ${timeoutMs}ms`),
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        onRetry: (e, n) => console.warn(`[OpenAI:${model}] Retry ${n}: ${e.message}`),
      }
    )
  );
}

async function callAnthropic(
  model: string,
  systemPrompt: string,
  userMessage: string,
  temp: number,
  timeoutMs: number
): Promise<LLMResult> {
  return breakers.anthropic.call(() =>
    withRetry(
      () =>
        withTimeout(async () => {
          const anthropic = await getAnthropic();
          const res = await anthropic.messages.create({
            model,
            max_tokens: 2500,
            temperature: temp,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
          });

          const text = res.content?.[0]?.type === 'text' ? res.content[0].text : '';
          if (!text.trim()) throw new Error(`Anthropic ${model} returned empty content`);

          const inputTokens = res.usage?.input_tokens ?? 0;
          const outputTokens = res.usage?.output_tokens ?? 0;
          return {
            text,
            model,
            provider: 'anthropic',
            tokens_used: inputTokens + outputTokens,
            cost_usd: estimateCost(model, inputTokens, outputTokens),
          };
        }, timeoutMs, `Anthropic ${model} timed out after ${timeoutMs}ms`),
      {
        maxAttempts: 3,
        baseDelayMs: 1200,
        onRetry: (e, n) => console.warn(`[Anthropic:${model}] Retry ${n}: ${e.message}`),
      }
    )
  );
}

export async function callLLM(opts: LLMCallOptions): Promise<LLMResult> {
  const { agent, userMessage, extraContext, timeoutMs = 45_000, json = false } = opts;
  const cfg = AGENT_MODELS[agent];
  if (!cfg) throw new Error(`Unknown agent: ${String(agent)}`);

  let systemPrompt = PROMPTS[agent];
  if (extraContext) {
    systemPrompt += `\n\n## CONTEXT BO SUNG:\n${extraContext}`;
  }

  const provider = cfg.provider as string;
  console.info(`[LLM] agent=${agent} provider=${provider} model=${cfg.model}`);

  if (provider === 'anthropic') {
    return callAnthropic(cfg.model, systemPrompt, userMessage, cfg.temp, timeoutMs);
  }
  return callOpenAI(cfg.model, systemPrompt, userMessage, cfg.temp, json, timeoutMs);
}

export async function callLLMJson<T>(opts: LLMCallOptions): Promise<T> {
  const result = await callLLM({ ...opts, json: true });
  try {
    return JSON.parse(extractJsonText(result.text)) as T;
  } catch {
    console.error(`[LLM:${opts.agent}] JSON parse failed:`, result.text.slice(0, 300));
    throw new Error(`Agent ${opts.agent} returned invalid JSON`);
  }
}

function extractJsonText(text: string): string {
  const clean = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (clean.startsWith('{') || clean.startsWith('[')) return clean;

  const objectStart = clean.indexOf('{');
  const objectEnd = clean.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) return clean.slice(objectStart, objectEnd + 1);

  const arrayStart = clean.indexOf('[');
  const arrayEnd = clean.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) return clean.slice(arrayStart, arrayEnd + 1);

  return clean;
}