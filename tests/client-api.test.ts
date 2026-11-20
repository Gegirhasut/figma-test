import { afterEach, describe, expect, it } from 'vitest';
import { answerNote, formatResetTime, interpretPhrase } from '../src/client/api';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const NO_MATCH = 'Совпадений в словаре нет — взяли нейтральную пару объектов';

describe('notes shown to the user', () => {
  it('the server note replaces the generic text', () => {
    expect(answerNote({ objects: [], source: 'dictionary', aiLeft: 3, note: NO_MATCH })).toBe(NO_MATCH);
    expect(answerNote({ objects: [], source: 'dictionary', aiLeft: 3 })).toBe('Фразу разобрали по словарю');
  });

  it('says how many AI requests are left and when they come back', () => {
    const now = new Date(2026, 10, 20, 10, 0).getTime();
    expect(answerNote({ objects: [], source: 'anthropic', aiLeft: 2, aiLimit: 3 }, now)).toBe('Фразу разобрал AI. Осталось AI-запросов: 2 из 3 на сутки');
    const at = new Date(2026, 10, 21, 9, 30).getTime();
    const limited = answerNote({ objects: [], source: 'dictionary', aiLeft: 0, limited: true, aiResetAt: at }, now);
    expect(limited).toMatch(/Лимит AI-запросов на сутки исчерпан/);
    expect(limited).toMatch(/вернутся завтра в 09:30/);
    expect(answerNote({ objects: [], source: 'deepseek', aiLeft: 0, aiResetAt: at }, now)).toMatch(/последний AI-запрос/);
    expect(formatResetTime(new Date(2026, 10, 20, 18, 5).getTime(), now)).toBe('в 18:05');
  });
});

describe('interpretPhrase', () => {
  it('passes the server note through', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ objects: [{ id: 'lamp', role: 'main' }], source: 'dictionary', aiLeft: 3, note: NO_MATCH }))) as typeof fetch;
    const r = await interpretPhrase('ыыы щщщ');
    expect(r.note).toBe(NO_MATCH);
    expect(r.objects).toEqual([{ id: 'lamp', role: 'main' }]);
  });

  it('gives up on a hanging server and answers from the dictionary', async () => {
    globalThis.fetch = ((_u: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
    const t0 = Date.now();
    const r = await interpretPhrase('копим на отпуск', 50);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.source).toBe('offline');
    expect(r.note).toMatch(/не ответил вовремя/);
    expect(r.objects.map((o) => o.id)).toEqual(expect.arrayContaining(['wallet', 'coin']));
  });

  it('a list of objects never goes to the server', async () => {
    globalThis.fetch = (async () => {
      throw new Error('should not be called');
    }) as typeof fetch;
    const r = await interpretPhrase('5 монет');
    expect(r.objects).toHaveLength(5);
    expect(r.note).toBe('');
  });
});
