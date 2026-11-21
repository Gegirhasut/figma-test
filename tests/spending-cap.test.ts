import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Interpreter } from '../src/server/interpret';
import { MAX_OUTPUT_TOKENS, TruncatedAnswerError, anthropicProvider, deepseekProvider, type Provider, type ProviderResult } from '../src/server/llm/providers';

// The Anthropic SDK is replaced, so no request ever leaves the machine.
const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
  },
}));

function fake(name: 'anthropic' | 'deepseek', impl: () => Promise<Partial<ProviderResult>>): Provider & { calls: number } {
  const p = {
    name,
    model: 'test',
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
const ok = async () => ({ objects: [{ id: 'coin', role: 'main' }] as ProviderResult['objects'] });

beforeEach(() => create.mockReset());

describe('output token cap', () => {
  it('Anthropic is asked for at most ~150 tokens', async () => {
    create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"objects":[{"id":"lamp","role":"main"}]}' }], usage: { input_tokens: 900, output_tokens: 20 } });
    const r = await anthropicProvider({ ANTHROPIC_API_KEY: 'k' }).interpret('вечер с книгой');
    expect(MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(150);
    expect(create.mock.calls[0][0].max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(r.objects).toEqual([{ id: 'lamp', role: 'main' }]);
  });

  it('an Anthropic answer cut at the cap is a TruncatedAnswerError', async () => {
    create.mockResolvedValue({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"objects":[{"id":"lamp","role":"main"},' }], usage: { input_tokens: 900, output_tokens: 150 } });
    await expect(anthropicProvider({ ANTHROPIC_API_KEY: 'k' }).interpret('x')).rejects.toBeInstanceOf(TruncatedAnswerError);
  });

  it('DeepSeek uses the same cap and finish_reason=length is a TruncatedAnswerError', async () => {
    const bodies: { max_tokens: number }[] = [];
    const fetchMock = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"objects":[' }, finish_reason: 'length' }], usage: { prompt_tokens: 900, completion_tokens: 150 } }));
    }) as unknown as typeof fetch;
    await expect(deepseekProvider({ DEEPSEEK_API_KEY: 'k' }, fetchMock).interpret('x')).rejects.toBeInstanceOf(TruncatedAnswerError);
    expect(bodies[0].max_tokens).toBe(MAX_OUTPUT_TOKENS);
  });

  it('a truncated answer does not start the fallback provider: the dictionary answers', async () => {
    const a = fake('anthropic', async () => {
      throw new TruncatedAnswerError('cut');
    });
    const d = fake('deepseek', ok);
    const it = new Interpreter([a, d], { perBrowser: 3, perIp: 10 });
    const r = await it.interpret('копим на отпуск', 'b', 'ip');
    expect(r.source).toBe('dictionary');
    expect(r.objects.map((o) => o.id)).toEqual(expect.arrayContaining(['wallet', 'coin']));
    expect(a.calls).toBe(1);
    expect(d.calls).toBe(0);
  });

  it('an ordinary failure still goes to the fallback', async () => {
    const a = fake('anthropic', async () => {
      throw new Error('HTTP 529');
    });
    const d = fake('deepseek', ok);
    const r = await new Interpreter([a, d], { perBrowser: 3, perIp: 10 }).interpret('копим на отпуск', 'b', 'ip');
    expect(r.source).toBe('deepseek');
  });
});

describe('daily AI limit for the whole service', () => {
  it('after the global limit every visitor gets the dictionary, like after a personal limit', async () => {
    let t = 0;
    const a = fake('anthropic', ok);
    const it = new Interpreter([a], { perBrowser: 3, perIp: 10, global: 4 }, { now: () => t });
    // Four different visitors from four addresses use up the service.
    for (let k = 0; k < 4; k++) expect((await it.interpret(`фраза ${k}`, `b${k}`, `ip${k}`)).source).toBe('anthropic');
    const late = await it.interpret('новая фраза', 'fresh', 'fresh-ip');
    expect(late.source).toBe('dictionary');
    expect(late.limited).toBe(true);
    expect(late.aiLeft).toBe(0);
    expect(late.aiResetAt).toBe(24 * 60 * 60 * 1000);
    expect(a.calls).toBe(4);
    expect(it.quota('fresh', 'fresh-ip').aiLeft).toBe(0);
    // Cached phrases are still free.
    expect((await it.interpret('фраза 0', 'fresh', 'fresh-ip')).cached).toBe(true);
    // A day later the service has AI again.
    t = 24 * 60 * 60 * 1000;
    expect((await it.interpret('новая фраза', 'fresh', 'fresh-ip')).source).toBe('anthropic');
  });

  it('has a sane default when not configured', async () => {
    const a = fake('anthropic', ok);
    const it = new Interpreter([a], { perBrowser: 1000, perIp: 1000 });
    for (let k = 0; k < 300; k++) await it.interpret(`ф ${k}`, 'b', 'ip');
    expect((await it.interpret('ещё одна', 'b', 'ip')).limited).toBe(true);
    expect(a.calls).toBe(300);
  });
});
