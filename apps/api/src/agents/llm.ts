// apps/api/src/agents/llm.ts
// Direct LLM calls — OpenAI + Anthropic, không cần CakeAI

import { withRetry, withTimeout, breakers } from '../lib/resilience.js';
import { PROMPTS, AGENT_MODELS, type AgentName } from './prompts/index.js';

// ── Lazy-init clients ──────────────────────────────────────────────
let _openai: any = null;
let _anthropic: any = null;

function getOpenAI() {
  if (!_openai) {
    const { default: OpenAI } = require('openai');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

function getAnthropic() {
  if (!_anthropic) {
    const { default: Anthropic } = require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

// ── Types ──────────────────────────────────────────────────────────
export interface LLMCallOptions {
  agent:      AgentName;
  userMessage: string;
  extraContext?: string;   // injected vào system prompt
  timeoutMs?:  number;
  json?:       boolean;    // expect JSON output
}

export interface LLMResult {
  text:        string;
  model:       string;
  provider:    string;
  tokens_used: number;
  cost_usd?:   number;
}

// ── Cost estimation (USD per 1M tokens, April 2026) ───────────────
const COST_PER_M: Record<string, { input: number; output: number }> = {
  'gpt-5.5':           { input: 5.00,  output: 30.00 },
  'claude-sonnet-4-5': { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5':  { input: 0.25,  output: 1.25  },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_M[model];
  if (!rates) return 0;
  return (inputTokens / 1_000_000 * rates.input) + (outputTokens / 1_000_000 * rates.output);
}

// ── OpenAI call ────────────────────────────────────────────────────
async function callOpenAI(
  model: string,
  systemPrompt: string,
  userMessage: string,
  temp: number,
  json: boolean
): Promise<LLMResult> {
  return breakers.openai.call(() =>
    withRetry(() =>
      withTimeout(async () => {
        const openai = getOpenAI();
        const res = await openai.chat.completions.create({
          model,
          temperature: temp,
          max_tokens: 2500,
          response_format: json ? { type: 'json_object' } : { type: 'text' },
          messages: [
            { role: 'system',   content: systemPrompt },
            { role: 'user',     content: userMessage  },
          ],
        });

        const text       = res.choices[0]?.message?.content ?? '';
        const inputTok   = res.usage?.prompt_tokens    ?? 0;
        const outputTok  = res.usage?.completion_tokens ?? 0;

        return {
          text,
          model,
          provider:    'openai',
          tokens_used: inputTok + outputTok,
          cost_usd:    estimateCost(model, inputTok, outputTok),
        };
      }, 30_000),
      { maxAttempts: 3, baseDelayMs: 1000,
        onRetry: (e, n) => console.warn(`[OpenAI:${model}] Retry ${n}: ${e.message}`) }
    )
  );
}

// ── Anthropic call ─────────────────────────────────────────────────
async function callAnthropic(
  model: string,
  systemPrompt: string,
  userMessage: string,
  temp: number
): Promise<LLMResult> {
  return breakers.anthropic.call(() =>
    withRetry(() =>
      withTimeout(async () => {
        const anthropic = getAnthropic();
        const res = await anthropic.messages.create({
          model,
          max_tokens: 2500,
          temperature: temp,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        });

        const text      = res.content[0]?.type === 'text' ? res.content[0].text : '';
        const inputTok  = res.usage?.input_tokens  ?? 0;
        const outputTok = res.usage?.output_tokens ?? 0;

        return {
          text,
          model,
          provider:    'anthropic',
          tokens_used: inputTok + outputTok,
          cost_usd:    estimateCost(model, inputTok, outputTok),
        };
      }, 35_000),
      { maxAttempts: 3, baseDelayMs: 1200,
        onRetry: (e, n) => console.warn(`[Anthropic:${model}] Retry ${n}: ${e.message}`) }
    )
  );
}

// ── Main call ──────────────────────────────────────────────────────
export async function callLLM(opts: LLMCallOptions): Promise<LLMResult> {
  const { agent, userMessage, extraContext, timeoutMs = 35_000, json = false } = opts;
  const cfg = AGENT_MODELS[agent];

  // Build system prompt với optional extra context
  let systemPrompt = PROMPTS[agent];
  if (extraContext) {
    systemPrompt += `\n\n## CONTEXT BỔ SUNG:\n${extraContext}`;
  }

  console.info(`[LLM] agent=${agent} provider=${cfg.provider} model=${cfg.model}`);

  if (cfg.provider === 'anthropic') {
    return callAnthropic(cfg.model, systemPrompt, userMessage, cfg.temp);
  } else {
    return callOpenAI(cfg.model, systemPrompt, userMessage, cfg.temp, json);
  }
}

// ── JSON helper ────────────────────────────────────────────────────
export async function callLLMJson<T>(opts: LLMCallOptions): Promise<T> {
  const result = await callLLM({ ...opts, json: true });
  try {
    const clean = result.text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(clean) as T;
  } catch {
    console.error(`[LLM:${opts.agent}] JSON parse failed:`, result.text.slice(0, 200));
    throw new Error(`Agent ${opts.agent} trả về JSON không hợp lệ`);
  }
}
