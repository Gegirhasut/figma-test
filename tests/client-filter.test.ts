import { afterEach, describe, expect, it } from 'vitest';
import { interpretPhrase, sanitizeServerObjects } from '../src/client/api';

describe('the client keeps only library objects from a server answer', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('drops unknown ids and odd roles', () => {
    expect(
      sanitizeServerObjects([
        { id: 'wallet', role: 'main' },
        { id: '__proto__', role: 'main' },
        { id: 'unicorn', role: 'main' },
        null,
        { id: 'coin', role: 'weird' },
        { id: 'book', role: 'background' },
      ]),
    ).toEqual([
      { id: 'wallet', role: 'main' },
      { id: 'coin', role: 'main' },
      { id: 'book', role: 'background' },
    ]);
    expect(sanitizeServerObjects('nope')).toEqual([]);
    expect(sanitizeServerObjects(Array.from({ length: 20 }, () => ({ id: 'coin', role: 'main' })))).toHaveLength(5);
    expect(sanitizeServerObjects([{ id: 'book', role: 'background' }])).toEqual([{ id: 'book', role: 'main' }]);
  });

  it('unknown ids from the server never reach the scene', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ objects: [{ id: 'lamp', role: 'main' }, { id: 'constructor', role: 'main' }], source: 'anthropic', aiLeft: 2 }))) as typeof fetch;
    const r = await interpretPhrase('вечер с книгой');
    expect(r.objects).toEqual([{ id: 'lamp', role: 'main' }]);
  });

  it('an answer with nothing usable falls back to the dictionary', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ objects: [{ id: 'car', role: 'main' }], source: 'anthropic', aiLeft: 2 }))) as typeof fetch;
    const r = await interpretPhrase('копим на отпуск');
    expect(r.source).toBe('offline');
    expect(r.objects.map((o) => o.id)).toEqual(expect.arrayContaining(['wallet', 'coin']));
  });
});
