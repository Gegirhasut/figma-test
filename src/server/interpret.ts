// Phrase → library objects on the server: cache, AI quota, provider chain and
// the dictionary as the last resort, so a request always gets an answer.

import { applyExplicitBackground, interpretByTags, normalize } from '../shared/matcher';
import type { ObjectRequest } from '../shared/types';
import type { Provider, ProviderName } from './llm/providers';

export type Source = ProviderName | 'dictionary';

export interface InterpretResponse {
  objects: ObjectRequest[];
  source: Source;
  cached: boolean;
  /** AI requests left for this browser. */
  aiLeft: number;
  /** Set when the AI limit was the reason for the dictionary answer. */
  limited?: boolean;
  /** AI is not configured on this server at all. */
  aiUnavailable?: boolean;
  note?: string;
}

export interface QuotaOptions {
  perBrowser: number;
  perIp: number;
}

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

export class Interpreter {
  private cache = new LruCache<{ objects: ObjectRequest[]; source: ProviderName }>(1000);
  private byBrowser = new Map<string, number>();
  private byIp = new Map<string, number>();

  constructor(
    private providers: () => Provider[],
    private quota: QuotaOptions,
    private log: (msg: string) => void = () => {},
  ) {}

  aiLeft(browserId: string, ip: string): number {
    const b = this.quota.perBrowser - (this.byBrowser.get(browserId) ?? 0);
    const i = this.quota.perIp - (this.byIp.get(ip) ?? 0);
    return Math.max(0, Math.min(b, i));
  }

  async interpret(phrase: string, browserId: string, ip: string): Promise<InterpretResponse> {
    const key = normalize(phrase);
    const cached = this.cache.get(key);
    // The cache holds what the provider said; an explicit «на фоне» in this
    // phrase is applied on the way out (the cache key drops punctuation).
    if (cached) return { objects: applyExplicitBackground(phrase, cached.objects), source: cached.source, cached: true, aiLeft: this.aiLeft(browserId, ip) };

    const chain = this.providers();
    const dictionary = (extra: Partial<InterpretResponse>): InterpretResponse => {
      const d = interpretByTags(phrase);
      return { objects: d.objects, source: 'dictionary', cached: false, aiLeft: this.aiLeft(browserId, ip), note: d.reason, ...extra };
    };
    if (!chain.length) return dictionary({ aiUnavailable: true });
    if (this.aiLeft(browserId, ip) <= 0) return dictionary({ limited: true });

    // The quota counts attempts that reach a provider, successful or not.
    this.byBrowser.set(browserId, (this.byBrowser.get(browserId) ?? 0) + 1);
    this.byIp.set(ip, (this.byIp.get(ip) ?? 0) + 1);
    for (const p of chain) {
      try {
        const r = await p.interpret(phrase);
        this.log(`[interpret] ${p.name} ${r.latencyMs}ms in=${r.inputTokens} out=${r.outputTokens} → ${r.objects.map((o) => o.id).join(',')}`);
        this.cache.set(key, { objects: r.objects, source: p.name });
        return { objects: applyExplicitBackground(phrase, r.objects), source: p.name, cached: false, aiLeft: this.aiLeft(browserId, ip) };
      } catch (e) {
        this.log(`[interpret] ${p.name} failed: ${(e as Error).message}`);
      }
    }
    return dictionary({ note: 'AI недоступен, собрали по словарю' });
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
