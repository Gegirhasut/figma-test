import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RateLimiter } from '../src/server/interpret';
import { parseAnswer } from '../src/server/llm/prompt';
import { deepseekProvider, providerChain, type Provider, type ProviderResult } from '../src/server/llm/providers';

function fake(name: 'anthropic' | 'deepseek', impl: () => Promise<Partial<ProviderResult>>): Provider & { calls: number } {
  const p = {
    name,
    model: name + '-test',
    calls: 0,
    configured: () => true,
    async interpret() {
      p.calls++;
      const r = await impl();
      return { provider: name, model: 'm', objects: [], inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 1, raw: '', ...r } as ProviderResult;
    },
  };
  return p;
}

describe('LLM answer validation', () => {
  it('keeps only library ids and roles', () => {
    expect(parseAnswer('{"objects":[{"id":"wallet","role":"main"},{"id":"unicorn","role":"main"},{"id":"coin","role":"background"}]}')).toEqual([
      { id: 'wallet', role: 'main' },
      { id: 'coin', role: 'background' },
    ]);
  });
  it('ignores coordinates and extra fields, promotes a main object', () => {
    expect(parseAnswer('```json\n{"objects":[{"id":"lamp","role":"background","x":10}]}\n```')).toEqual([{ id: 'lamp', role: 'main' }]);
  });
  it('throws when nothing usable is left', () => {
    expect(() => parseAnswer('{"objects":[{"id":"car"}]}')).toThrow();
    expect(() => parseAnswer('not json')).toThrow();
  });
});

describe('interpreter', () => {
  const ok = (ids: string[]) => async () => ({ objects: ids.map((id) => ({ id, role: 'main' })) as ProviderResult['objects'] });

  it('uses the primary provider and caches identical phrases', async () => {
    const a = fake('anthropic', ok(['wallet', 'coin']));
    const d = fake('deepseek', ok(['book']));
    const it = new Interpreter(() => [a, d], { perBrowser: 3, perIp: 10 });
    const r1 = await it.interpret('Копим на отпуск', 'b1', 'ip');
    const r2 = await it.interpret('копим  на отпуск!', 'b2', 'ip2');
    expect(r1.source).toBe('anthropic');
    expect(r1.objects.map((o) => o.id)).toEqual(['wallet', 'coin']);
    expect(r2.cached).toBe(true);
    expect(a.calls).toBe(1);
    expect(d.calls).toBe(0);
  });

  it('falls back to the second provider, then to the dictionary', async () => {
    const a = fake('anthropic', async () => {
      throw new Error('down');
    });
    const d = fake('deepseek', ok(['lamp']));
    const it1 = new Interpreter(() => [a, d], { perBrowser: 3, perIp: 10 });
    expect((await it1.interpret('идея', 'b', 'ip')).source).toBe('deepseek');

    const bad = fake('deepseek', async () => {
      throw new Error('down');
    });
    const it2 = new Interpreter(() => [a, bad], { perBrowser: 3, perIp: 10 });
    const r = await it2.interpret('копим на отпуск', 'b', 'ip');
    expect(r.source).toBe('dictionary');
    expect(r.objects.map((o) => o.id)).toEqual(expect.arrayContaining(['wallet', 'coin']));
  });

  it('without keys answers from the dictionary and does not spend the quota', async () => {
    const it = new Interpreter(() => [], { perBrowser: 3, perIp: 10 });
    const r = await it.interpret('новая идея', 'b', 'ip');
    expect(r.source).toBe('dictionary');
    expect(r.aiUnavailable).toBe(true);
    expect(r.aiLeft).toBe(3);
  });

  it('limits AI requests per browser and per IP', async () => {
    const a = fake('anthropic', ok(['coin']));
    const it = new Interpreter(() => [a], { perBrowser: 3, perIp: 5 });
    for (const p of ['раз', 'два', 'три']) expect((await it.interpret(p, 'b1', 'ip1')).source).toBe('anthropic');
    const limited = await it.interpret('четыре', 'b1', 'ip1');
    expect(limited.limited).toBe(true);
    expect(limited.source).toBe('dictionary');
    expect(limited.aiLeft).toBe(0);
    // A new cookie from the same IP gets only what is left of the IP quota.
    expect((await it.interpret('пять', 'b2', 'ip1')).source).toBe('anthropic');
    expect((await it.interpret('шесть', 'b2', 'ip1')).source).toBe('anthropic');
    expect((await it.interpret('семь', 'b2', 'ip1')).limited).toBe(true);
    expect(a.calls).toBe(5);
  });
});

describe('providers', () => {
  it('chain order follows env and skips providers without keys', () => {
    expect(providerChain({}).length).toBe(0);
    expect(providerChain({ ANTHROPIC_API_KEY: 'x', DEEPSEEK_API_KEY: 'y' }).map((p) => p.name)).toEqual(['anthropic', 'deepseek']);
    expect(providerChain({ ANTHROPIC_API_KEY: 'x', DEEPSEEK_API_KEY: 'y', LLM_PRIMARY: 'deepseek' }).map((p) => p.name)).toEqual(['deepseek', 'anthropic']);
    expect(providerChain({ DEEPSEEK_API_KEY: 'y' }).map((p) => p.name)).toEqual(['deepseek']);
    expect(providerChain({ ANTHROPIC_API_KEY: 'x', DEEPSEEK_API_KEY: 'y', LLM_FALLBACK: 'none' }).map((p) => p.name)).toEqual(['anthropic']);
  });

  it('DeepSeek is called through the OpenAI-compatible endpoint in JSON mode', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.model).toBe('deepseek-chat');
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"objects":[{"id":"headphones","role":"main"}]}' } }], usage: { prompt_tokens: 500, completion_tokens: 20 } }));
    });
    const p = deepseekProvider({ DEEPSEEK_API_KEY: 'k' }, fetchMock as unknown as typeof fetch);
    const r = await p.interpret('слушаем подкаст');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    expect(r.objects).toEqual([{ id: 'headphones', role: 'main' }]);
    expect(r.inputTokens).toBe(500);
    expect(r.costUsd).toBeGreaterThan(0);
  });
});

describe('rate limiter', () => {
  it('allows N per minute per IP', () => {
    let t = 0;
    const rl = new RateLimiter(3, () => t);
    expect([1, 2, 3, 4].map(() => rl.allow('a'))).toEqual([true, true, true, false]);
    expect(rl.allow('b')).toBe(true);
    t = 61_000;
    expect(rl.allow('a')).toBe(true);
  });
});
