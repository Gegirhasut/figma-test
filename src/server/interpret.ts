// Phrase → library objects on the server: cache, AI quota, provider chain and
// the dictionary as the last resort, so a request always gets an answer.

import { applyExplicitBackground, interpretByTags, normalize } from '../shared/matcher';
import type { ObjectRequest } from '../shared/types';
import { TruncatedAnswerError, type Provider, type ProviderName } from './llm/providers';

export type Source = ProviderName | 'dictionary';

export interface QuotaState {
  /** AI requests left for this browser in the current 24-hour window. */
  aiLeft: number;
  /** AI requests per browser per window. */
  aiLimit: number;
  /** When aiLeft is 0: the moment (epoch ms) the next AI request becomes available. */
  aiResetAt?: number;
}

export interface InterpretResponse extends QuotaState {
  objects: ObjectRequest[];
  source: Source;
  cached: boolean;
  /** Set when the AI limit was the reason for the dictionary answer. */
  limited?: boolean;
  /** AI is not configured on this server at all. */
  aiUnavailable?: boolean;
  /** The providers did not answer within the deadline. */
  timedOut?: boolean;
  note?: string;
}

export interface QuotaOptions {
  perBrowser: number;
  perIp: number;
  /** AI requests for the whole service (all visitors together) per window. */
  global?: number;
  /** Rolling window for both counters, 24 hours by default. */
  windowMs?: number;
}

export interface InterpreterOptions {
  /** One deadline for the whole provider chain; the fallback only gets what is left. */
  deadlineMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

const DAY = 24 * 60 * 60 * 1000;
/** Default ceiling for AI calls of the whole service per 24 hours. */
export const DEFAULT_GLOBAL_LIMIT = 300;
const GLOBAL_KEY = '*';
/** A fallback provider is not started with less time left than this. */
const MIN_ATTEMPT_MS = 1000;

class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: V) {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}

/**
 * Rolling-window counter: a key keeps the timestamps of its hits inside the
 * window (at most `limit` of them — nothing is recorded past the limit).
 * Expired keys are swept periodically and the map never grows past `maxKeys`.
 */
export class WindowCounter {
  private hits = new Map<string, number[]>();
  private lastSweep = 0;
  constructor(
    readonly limit: number,
    private windowMs: number,
    private now: () => number = Date.now,
    private maxKeys = 50_000,
  ) {}

  private live(key: string, t: number): number[] {
    const h = this.hits.get(key);
    if (!h) return [];
    const kept = h.filter((x) => t - x < this.windowMs);
    if (!kept.length) this.hits.delete(key);
    else if (kept.length !== h.length) this.hits.set(key, kept);
    return kept;
  }

  left(key: string): number {
    return Math.max(0, this.limit - this.live(key, this.now()).length);
  }

  /** With no requests left: the moment the hit that frees a slot leaves the window. */
  resetAt(key: string): number | undefined {
    const h = this.live(key, this.now());
    if (h.length < this.limit) return undefined;
    return h[h.length - this.limit] + this.windowMs;
  }

  record(key: string) {
    const t = this.now();
    const h = this.live(key, t);
    this.hits.delete(key); // re-insert: the map stays ordered by last use
    this.hits.set(key, [...h, t]);
    if (t - this.lastSweep >= Math.min(this.windowMs, 10 * 60_000) || this.hits.size > this.maxKeys) this.sweep(t);
  }

  get size(): number {
    return this.hits.size;
  }

  private sweep(t: number) {
    this.lastSweep = t;
    for (const [k, h] of this.hits) if (t - h[h.length - 1] >= this.windowMs) this.hits.delete(k);
    // Still too many live keys: forget the least recently used ones.
    for (const k of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(k);
    }
  }
}

class DeadlineError extends Error {}

export class Interpreter {
  private cache = new LruCache<{ objects: ObjectRequest[]; source: ProviderName }>(1000);
  private byBrowser: WindowCounter;
  private byIp: WindowCounter;
  private global: WindowCounter;
  private deadlineMs: number;
  private now: () => number;
  private log: (msg: string) => void;

  /** `providers` is built once at startup and reused for every request. */
  constructor(
    private providers: Provider[],
    quota: QuotaOptions,
    opts: InterpreterOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.deadlineMs = opts.deadlineMs ?? 12_000;
    const windowMs = quota.windowMs ?? DAY;
    this.byBrowser = new WindowCounter(quota.perBrowser, windowMs, this.now);
    this.byIp = new WindowCounter(quota.perIp, windowMs, this.now);
    this.global = new WindowCounter(quota.global ?? DEFAULT_GLOBAL_LIMIT, windowMs, this.now);
  }

  get aiConfigured(): boolean {
    return this.providers.length > 0;
  }

  aiLeft(browserId: string, ip: string): number {
    return Math.min(this.byBrowser.left(browserId), this.byIp.left(ip), this.global.left(GLOBAL_KEY));
  }

  /** Requests left and, when none are, the moment the next one comes back. */
  quota(browserId: string, ip: string): QuotaState {
    const aiLeft = this.aiLeft(browserId, ip);
    const out: QuotaState = { aiLeft, aiLimit: this.byBrowser.limit };
    if (aiLeft === 0) {
      // Every counter must have a free slot again.
      const at = [this.byBrowser.resetAt(browserId), this.byIp.resetAt(ip), this.global.resetAt(GLOBAL_KEY)].filter((x): x is number => x !== undefined);
      if (at.length) out.aiResetAt = Math.max(...at);
    }
    return out;
  }

  /** Keys the AI counters currently hold (memory stays bounded). */
  trackedKeys(): { browsers: number; ips: number } {
    return { browsers: this.byBrowser.size, ips: this.byIp.size };
  }

  async interpret(phrase: string, browserId: string, ip: string): Promise<InterpretResponse> {
    // The cache is shared by all visitors, so the model gets exactly the string
    // the cache key is made of: lower-case letters, digits and single spaces —
    // no line breaks, quotes or control characters that could smuggle extra
    // instructions past a key that only looks like an innocent phrase.
    const key = normalize(phrase);
    const cached = this.cache.get(key);
    // The cache holds what the provider said; an explicit «на фоне» in this
    // phrase is applied on the way out (the cache key drops punctuation).
    if (cached) return { objects: applyExplicitBackground(phrase, cached.objects), source: cached.source, cached: true, ...this.quota(browserId, ip) };

    const dictionary = (extra: Partial<InterpretResponse>): InterpretResponse => {
      const d = interpretByTags(phrase);
      return { objects: d.objects, source: 'dictionary', cached: false, ...this.quota(browserId, ip), note: d.reason, ...extra };
    };
    if (!this.providers.length) return dictionary({ aiUnavailable: true });
    if (!key) return dictionary({});
    if (this.aiLeft(browserId, ip) <= 0) return dictionary({ limited: true });

    // The quota counts attempts that reach a provider, successful or not.
    this.byBrowser.record(browserId);
    this.byIp.record(ip);
    this.global.record(GLOBAL_KEY);

    const started = this.now();
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new DeadlineError(`deadline ${this.deadlineMs}ms`));
      }, this.deadlineMs);
    });
    deadline.catch(() => {});
    let timedOut = false;
    let truncated = false;
    try {
      for (const [k, p] of this.providers.entries()) {
        if (k > 0 && this.deadlineMs - (this.now() - started) < MIN_ATTEMPT_MS) {
          timedOut = true;
          break;
        }
        try {
          // A provider that ignores the signal still cannot hold the request past the deadline.
          const r = await Promise.race([p.interpret(key, ctrl.signal), deadline]);
          this.log(`[interpret] ${p.name} ${r.latencyMs}ms in=${r.inputTokens} out=${r.outputTokens} → ${r.objects.map((o) => o.id).join(',')}`);
          this.cache.set(key, { objects: r.objects, source: p.name });
          return { objects: applyExplicitBackground(phrase, r.objects), source: p.name, cached: false, ...this.quota(browserId, ip) };
        } catch (e) {
          if (e instanceof DeadlineError || ctrl.signal.aborted) {
            this.log(`[interpret] ${p.name}: deadline ${this.deadlineMs}ms reached`);
            timedOut = true;
            break;
          }
          if (e instanceof TruncatedAnswerError) {
            // The answer hit the token cap: a second provider would most likely
            // do the same and double the cost, so the dictionary answers.
            this.log(`[interpret] ${p.name}: ${e.message}`);
            truncated = true;
            break;
          }
          this.log(`[interpret] ${p.name} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      clearTimeout(timer);
      ctrl.abort();
    }
    if (truncated) return dictionary({ note: 'AI ответил слишком длинно — фразу разобрали по словарю' });
    if (timedOut) return dictionary({ timedOut: true, note: 'AI не ответил вовремя — фразу разобрали по словарю' });
    return dictionary({ note: 'AI недоступен — фразу разобрали по словарю' });
  }
}

/** Fixed-window per-IP request limiter. */
export class RateLimiter {
  private hits = new Map<string, { start: number; count: number }>();
  constructor(private perMinute: number, private now: () => number = Date.now) {}
  allow(ip: string): boolean {
    const t = this.now();
    const h = this.hits.get(ip);
    if (!h || t - h.start >= 60_000) {
      this.hits.set(ip, { start: t, count: 1 });
      if (this.hits.size > 10_000) this.sweep(t);
      return true;
    }
    h.count++;
    return h.count <= this.perMinute;
  }
  private sweep(t: number) {
    for (const [k, v] of this.hits) if (t - v.start >= 60_000) this.hits.delete(k);
  }
}
