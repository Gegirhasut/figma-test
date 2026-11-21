import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_DEADLINE_MS, Interpreter, WindowCounter } from '../src/server/interpret';
import { DEFAULT_PROVIDER_TIMEOUT_MS } from '../src/server/llm/providers';
import { deepseekProvider, type Provider, type ProviderResult } from '../src/server/llm/providers';

function fake(name: 'anthropic' | 'deepseek', impl: () => Promise<Partial<ProviderResult>>): Provider & { calls: number; signals: (AbortSignal | undefined)[] } {
  const p = {
    name,
    model: name + '-test',
    calls: 0,
    signals: [] as (AbortSignal | undefined)[],
    configured: () => true,
    async interpret(_phrase: string, signal?: AbortSignal) {
      p.calls++;
      p.signals.push(signal);
      const r = await impl();
      return { provider: name, model: 'm', objects: [], inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 1, raw: '', ...r } as ProviderResult;
    },
  };
  return p;
}

const H = 60 * 60 * 1000;
const ok = async () => ({ objects: [{ id: 'coin', role: 'main' }] as ProviderResult['objects'] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('AI quota: rolling 24-hour window', () => {
  it('requests come back 24 hours after they were made, and the answer says when', async () => {
    let t = 1_000_000;
    const a = fake('anthropic', ok);
    const it = new Interpreter([a], { perBrowser: 3, perIp: 10 }, { now: () => t });
    const first = await it.interpret('раз', 'b', 'ip');
    expect(first.aiLeft).toBe(2);
    expect(first.aiLimit).toBe(3);
    expect(first.aiResetAt).toBeUndefined();
    t += 2 * H;
    await it.interpret('два', 'b', 'ip');
    t += 2 * H;
    const last = await it.interpret('три', 'b', 'ip');
    expect(last.aiLeft).toBe(0);
    // The first request frees the next slot.
    expect(last.aiResetAt).toBe(1_000_000 + 24 * H);
    t += H;
    const limited = await it.interpret('четыре', 'b', 'ip');
    expect(limited.limited).toBe(true);
    expect(limited.aiResetAt).toBe(1_000_000 + 24 * H);

    t = 1_000_000 + 24 * H;
    const again = await it.interpret('пять', 'b', 'ip');
    expect(again.source).toBe('anthropic');
    expect(again.aiLeft).toBe(0);
    // Next slot: the request made two hours after the first one.
    expect(again.aiResetAt).toBe(1_000_000 + 2 * H + 24 * H);
    expect(a.calls).toBe(4);
  });

  it('the IP limit rolls over too', async () => {
    let t = 0;
    const it = new Interpreter([fake('anthropic', ok)], { perBrowser: 3, perIp: 2 }, { now: () => t });
    await it.interpret('раз', 'b1', 'ip');
    await it.interpret('два', 'b2', 'ip');
    const limited = await it.interpret('три', 'b3', 'ip');
    expect(limited.limited).toBe(true);
    expect(limited.aiResetAt).toBe(24 * H);
    t = 24 * H;
    expect((await it.interpret('четыре', 'b3', 'ip')).source).toBe('anthropic');
  });

  it('old entries are swept, so memory stays bounded', async () => {
    let t = 0;
    const it = new Interpreter([fake('anthropic', ok)], { perBrowser: 3, perIp: 10 }, { now: () => t });
    for (let k = 0; k < 50; k++) await it.interpret(`фраза ${k}`, `b${k}`, `ip${k}`);
    expect(it.trackedKeys()).toEqual({ browsers: 50, ips: 50 });
    t = 25 * H;
    await it.interpret('новая фраза', 'fresh', 'fresh-ip');
    expect(it.trackedKeys()).toEqual({ browsers: 1, ips: 1 });
  });

  it('a window counter never holds much more than maxKeys keys', () => {
    let t = 0;
    const c = new WindowCounter(3, 24 * H, () => t, 100);
    for (let k = 0; k < 1000; k++) {
      t++;
      c.record(`k${k}`);
    }
    expect(c.size).toBeLessThanOrEqual(100);
    expect(c.left('k999')).toBe(2);
  });
});

describe('one deadline for the whole provider chain', () => {
  it('a hanging primary is cut at the deadline and the dictionary answers', async () => {
    const a = fake('anthropic', () => new Promise(() => {}));
    const d = fake('deepseek', async () => ({ objects: [{ id: 'lamp', role: 'main' }] }));
    const it = new Interpreter([a, d], { perBrowser: 3, perIp: 10 }, { deadlineMs: 80 });
    const t0 = Date.now();
    const r = await it.interpret('копим на отпуск', 'b', 'ip');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.source).toBe('dictionary');
    expect(r.timedOut).toBe(true);
    expect(r.note).toMatch(/не ответил вовремя/);
    expect(r.objects.map((o) => o.id)).toEqual(expect.arrayContaining(['wallet', 'coin']));
    // The fallback does not get a fresh deadline of its own; the primary is told to stop.
    expect(d.calls).toBe(0);
    expect(a.signals[0]?.aborted).toBe(true);
  });

  it('the fallback only gets the time that is left', async () => {
    const slowFail = fake('anthropic', async () => {
      await sleep(900);
      throw new Error('500');
    });
    const slowOk = fake('deepseek', async () => {
      await sleep(1500);
      return { objects: [{ id: 'lamp', role: 'main' }] };
    });
    const it = new Interpreter([slowFail, slowOk], { perBrowser: 3, perIp: 10 }, { deadlineMs: 2000 });
    const t0 = Date.now();
    const r = await it.interpret('идея', 'b', 'ip');
    const took = Date.now() - t0;
    // 0.9 s + 1.5 s would be 2.4 s; the shared deadline stops it at 2 s.
    expect(slowOk.calls).toBe(1);
    expect(r.timedOut).toBe(true);
    expect(took).toBeGreaterThanOrEqual(1900);
    expect(took).toBeLessThan(2250);
  });

  it('a hanging primary is cut at the per-call timeout and the fallback answers within the deadline', async () => {
    const hang = fake('anthropic', () => new Promise(() => {}));
    const d = fake('deepseek', async () => {
      await sleep(100);
      return { objects: [{ id: 'lamp', role: 'main' }] };
    });
    // Shorter than the defaults (7 s per call, 12 s in all), with more than the 1 s minimum left for the fallback.
    const it = new Interpreter([hang, d], { perBrowser: 3, perIp: 10 }, { deadlineMs: 1600, callTimeoutMs: 300 });
    const t0 = Date.now();
    const r = await it.interpret('копим на отпуск', 'b', 'ip');
    const took = Date.now() - t0;
    expect(r.source).toBe('deepseek');
    expect(r.timedOut).toBeUndefined();
    expect(r.objects).toEqual([{ id: 'lamp', role: 'main' }]);
    expect(hang.signals[0]?.aborted).toBe(true);
    // 0.3 s for the hanging primary + 0.1 s for the fallback, far from the 1.6 s deadline.
    expect(took).toBeGreaterThanOrEqual(390);
    expect(took).toBeLessThan(1000);
  });

  it('by default one call is well below the chain deadline, leaving the fallback time', () => {
    expect(DEFAULT_DEADLINE_MS).toBe(12_000);
    expect(DEFAULT_CALL_TIMEOUT_MS).toBe(7_000);
    expect(DEFAULT_PROVIDER_TIMEOUT_MS).toBe(DEFAULT_CALL_TIMEOUT_MS);
    expect(DEFAULT_DEADLINE_MS - DEFAULT_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
  });

  it('when the fallback hangs too, the dictionary answers at the deadline', async () => {
    const h1 = fake('anthropic', () => new Promise(() => {}));
    const h2 = fake('deepseek', () => new Promise(() => {}));
    const it = new Interpreter([h1, h2], { perBrowser: 3, perIp: 10 }, { deadlineMs: 1500, callTimeoutMs: 300 });
    const t0 = Date.now();
    const r = await it.interpret('копим на отпуск', 'b', 'ip');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.source).toBe('dictionary');
    expect(r.timedOut).toBe(true);
    expect(h2.calls).toBe(1);
  });

  it('does not start the fallback with almost no time left', async () => {
    const slowFail = fake('anthropic', async () => {
      await sleep(150);
      throw new Error('500');
    });
    const d = fake('deepseek', ok);
    const it = new Interpreter([slowFail, d], { perBrowser: 3, perIp: 10 }, { deadlineMs: 400 });
    const r = await it.interpret('идея', 'b', 'ip');
    expect(r.timedOut).toBe(true);
    expect(d.calls).toBe(0);
  });

  it('a fast failure leaves the fallback enough time', async () => {
    const fail = fake('anthropic', async () => {
      throw new Error('500');
    });
    const d = fake('deepseek', ok);
    const it = new Interpreter([fail, d], { perBrowser: 3, perIp: 10 }, { deadlineMs: 5000 });
    expect((await it.interpret('идея', 'b', 'ip')).source).toBe('deepseek');
  });

  it('DeepSeek hands the deadline signal to fetch', async () => {
    const ctrl = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    const p = deepseekProvider({ DEEPSEEK_API_KEY: 'k' }, fetchMock as unknown as typeof fetch);
    const run = p.interpret('идея', ctrl.signal);
    ctrl.abort();
    await expect(run).rejects.toThrow('aborted');
  });
});
