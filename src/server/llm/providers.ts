import Anthropic from '@anthropic-ai/sdk';
import type { ObjectRequest } from '../../shared/types';
import { OUTPUT_SCHEMA, SYSTEM_PROMPT, parseAnswer, userPrompt } from './prompt';

export type ProviderName = 'anthropic' | 'deepseek';

export interface ProviderResult {
  provider: ProviderName;
  model: string;
  objects: ObjectRequest[];
  inputTokens: number;
  outputTokens: number;
  /** Estimated cost in USD from the configured prices. */
  costUsd: number;
  latencyMs: number;
  raw: string;
}

export interface Provider {
  name: ProviderName;
  model: string;
  configured(): boolean;
  /** `signal` aborts the call when the interpreter's overall deadline runs out. */
  interpret(phrase: string, signal?: AbortSignal): Promise<ProviderResult>;
}

export interface ProviderEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_BASE_URL?: string;
  /** Cap for a single provider call. */
  LLM_TIMEOUT_MS?: string;
  /** USD per 1M tokens, input/output. */
  ANTHROPIC_PRICE_IN?: string;
  ANTHROPIC_PRICE_OUT?: string;
  DEEPSEEK_PRICE_IN?: string;
  DEEPSEEK_PRICE_OUT?: string;
}

/** Output token cap: the answer is a short JSON list of at most 5 ids (~80 tokens). */
export const MAX_OUTPUT_TOKENS = 150;

/** The answer was cut at the token cap; the chain stops instead of paying for the fallback. */
export class TruncatedAnswerError extends Error {}

const price = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export function anthropicProvider(env: ProviderEnv): Provider {
  const model = env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
  const timeout = Number(env.LLM_TIMEOUT_MS) || 12000;
  let client: Anthropic | null = null;
  return {
    name: 'anthropic',
    model,
    configured: () => Boolean(env.ANTHROPIC_API_KEY),
    async interpret(phrase, signal) {
      // No retries: the interpreter has one deadline for the whole chain and
      // moves on to the fallback provider instead.
      client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout, maxRetries: 0 });
      const t0 = Date.now();
      const response = await client.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        // A short classification: no extended thinking, lowest effort.
        thinking: { type: 'disabled' },
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> },
        },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt(phrase) }],
      }, { signal });
      const latencyMs = Date.now() - t0;
      if (response.stop_reason === 'refusal') throw new Error('anthropic: refusal');
      if (response.stop_reason === 'max_tokens') throw new TruncatedAnswerError(`anthropic: answer cut at ${MAX_OUTPUT_TOKENS} tokens`);
      const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      return {
        provider: 'anthropic',
        model,
        objects: parseAnswer(text),
        inputTokens,
        outputTokens,
        costUsd: (inputTokens * price(env.ANTHROPIC_PRICE_IN, 0.1) + outputTokens * price(env.ANTHROPIC_PRICE_OUT, 0.5)) / 1e6,
        latencyMs,
        raw: text,
      };
    },
  };
}

interface DeepSeekResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** DeepSeek through its OpenAI-compatible chat endpoint, JSON output mode. */
export function deepseekProvider(env: ProviderEnv, fetchImpl: typeof fetch = fetch): Provider {
  const model = env.DEEPSEEK_MODEL || 'deepseek-chat';
  const base = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const timeout = Number(env.LLM_TIMEOUT_MS) || 12000;
  return {
    name: 'deepseek',
    model,
    configured: () => Boolean(env.DEEPSEEK_API_KEY),
    async interpret(phrase, signal) {
      const t0 = Date.now();
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt(phrase) + '\nОтвет — JSON.' },
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: MAX_OUTPUT_TOKENS,
          stream: false,
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`deepseek: HTTP ${res.status}`);
      const data = (await res.json()) as DeepSeekResponse;
      const latencyMs = Date.now() - t0;
      if (data.choices?.[0]?.finish_reason === 'length') throw new TruncatedAnswerError(`deepseek: answer cut at ${MAX_OUTPUT_TOKENS} tokens`);
      const text = data.choices?.[0]?.message?.content ?? '';
      const inputTokens = data.usage?.prompt_tokens ?? 0;
      const outputTokens = data.usage?.completion_tokens ?? 0;
      return {
        provider: 'deepseek',
        model,
        objects: parseAnswer(text),
        inputTokens,
        outputTokens,
        costUsd: (inputTokens * price(env.DEEPSEEK_PRICE_IN, 0.28) + outputTokens * price(env.DEEPSEEK_PRICE_OUT, 0.42)) / 1e6,
        latencyMs,
        raw: text,
      };
    },
  };
}

/** Primary first, then the other one; unconfigured providers are skipped. */
export function providerChain(env: ProviderEnv & { LLM_PRIMARY?: string; LLM_FALLBACK?: string }, all = { anthropic: anthropicProvider(env), deepseek: deepseekProvider(env) }): Provider[] {
  const primary = (env.LLM_PRIMARY === 'deepseek' ? 'deepseek' : 'anthropic') as ProviderName;
  const fallbackRaw = env.LLM_FALLBACK ?? (primary === 'anthropic' ? 'deepseek' : 'anthropic');
  const order: ProviderName[] = [primary];
  if ((fallbackRaw === 'anthropic' || fallbackRaw === 'deepseek') && fallbackRaw !== primary) order.push(fallbackRaw);
  return order.map((n) => all[n]).filter((p) => p.configured());
}
