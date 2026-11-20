import { describe, expect, it } from 'vitest';
import { applyExplicitBackground, interpretByTags, matchObjects, sameWord } from '../src/shared/matcher';

const ids = (t: string) => matchObjects(t).objects.map((o) => o.id);

describe('dictionary matcher (scenario 2)', () => {
  it('reads a plain list', () => {
    const r = matchObjects('Кошелёк, монета');
    expect(r.mode).toBe('objects');
    expect(r.objects).toEqual([
      { id: 'wallet', role: 'main' },
      { id: 'coin', role: 'main' },
    ]);
  });

  it.each([
    ['кошелек и монеты', ['wallet', 'coin']],
    ['с кошельком и монетой', ['wallet', 'coin']],
    ['кошелька', ['wallet']],
    ['книгу, лампу и ручку', ['book', 'lamp', 'pen']],
    ['книжка', ['book']],
    ['наушниками', ['headphones']],
    ['телефоном', ['phone']],
    ['пазлы', ['puzzle']],
    ['пазлами', ['puzzle']],
    ['цветы', ['flower']],
    ['тюльпаны', ['flower']],
    ['папки', ['folder']],
    ['смартфон', ['phone']],
    ['ручкой', ['pen']],
    ['Wallet, coin', ['wallet', 'coin']],
  ])('%s → %j', (text, expected) => {
    expect(ids(text)).toEqual(expected);
    expect(matchObjects(text).mode).toBe('objects');
  });

  it('understands counts', () => {
    expect(ids('кошелёк и три монеты')).toEqual(['wallet', 'coin', 'coin', 'coin']);
    expect(ids('2 книги')).toEqual(['book', 'book']);
  });

  it('marks objects after «на фоне» as background', () => {
    expect(matchObjects('кошелёк на фоне книги').objects).toEqual([
      { id: 'wallet', role: 'main' },
      { id: 'book', role: 'background' },
    ]);
  });

  const roles = (t: string) => matchObjects(t).objects.map((o) => `${o.id}/${o.role}`);

  it.each([
    // «X на фоне»: the marker refers back to the object before it.
    ['наушники, телефон, книга на фоне', ['headphones/main', 'phone/main', 'book/background']],
    ['телефон, наушники, книга — на фоне', ['phone/main', 'headphones/main', 'book/background']],
    ['книга на фоне и телефон', ['book/background', 'phone/main']],
    ['книга фоном, телефон', ['book/background', 'phone/main']],
    ['лампа на заднем плане и книга', ['lamp/background', 'book/main']],
    ['две монеты на фоне, кошелёк', ['coin/background', 'coin/background', 'wallet/main']],
    // «на фоне X», «фоном X»: the objects after the marker in its clause.
    ['телефон и пазл на фоне книги', ['phone/main', 'puzzle/main', 'book/background']],
    ['кошелёк на фоне книги и лампы', ['wallet/main', 'book/background', 'lamp/background']],
    ['фоном книга, кошелёк', ['book/background', 'wallet/main']],
    ['на заднем плане книга, телефон', ['book/background', 'phone/main']],
    ['фоновая лампа и монета', ['lamp/background', 'coin/background']],
  ])('«на фоне»: %s → %j', (text, expected) => {
    expect(roles(text)).toEqual(expected);
    expect(matchObjects(text).mode).toBe('objects');
  });

  it('an explicit «на фоне» overrides roles chosen by the LLM or the meaning dictionary', () => {
    const llm = [
      { id: 'headphones', role: 'main' },
      { id: 'phone', role: 'main' },
      { id: 'book', role: 'main' },
    ] as const;
    expect(applyExplicitBackground('музыка в дороге, книга на фоне', [...llm]).map((o) => o.role)).toEqual(['main', 'main', 'background']);
    // Missing background object is added; nothing changes without a marker.
    expect(applyExplicitBackground('коплю на мечту на фоне цветка', [{ id: 'coin', role: 'main' }])).toEqual([
      { id: 'coin', role: 'main' },
      { id: 'flower', role: 'background' },
    ]);
    expect(applyExplicitBackground('музыка в дороге', [...llm])).toEqual(llm);
    // The dictionary fallback for scenario 1 honours it too.
    const d = interpretByTags('копим на отпуск, кошелёк на фоне').objects;
    expect(d.find((o) => o.id === 'wallet')?.role).toBe('background');
    expect(d.some((o) => o.role === 'main')).toBe(true);
  });

  it('keeps at most four main objects', () => {
    const r = matchObjects('книга телефон пазл монета лампа');
    expect(r.objects.filter((o) => o.role === 'main')).toHaveLength(4);
    expect(r.objects[4].role).toBe('background');
  });

  it('sends metaphors to scenario 1', () => {
    expect(matchObjects('копим на отпуск').mode).toBe('phrase');
    expect(matchObjects('кошелёк для отпуска').mode).toBe('phrase');
    expect(matchObjects('').mode).toBe('phrase');
  });

  it('word-form comparison is not too loose', () => {
    expect(sameWord('лампа', 'лапа')).toBe(false);
    expect(sameWord('папка', 'пачка')).toBe(false);
    expect(sameWord('ручка', 'ручкой')).toBe(true);
    expect(sameWord('кошелек', 'кошельком')).toBe(true);
  });
});

describe('tag fallback (scenario 1 without AI)', () => {
  it('maps money metaphors to wallet and coin', () => {
    const r = interpretByTags('копим на отпуск');
    expect(r.objects.map((o) => o.id)).toEqual(expect.arrayContaining(['wallet', 'coin']));
  });

  it('maps ideas to the lamp', () => {
    expect(interpretByTags('новая идея для стартапа').objects[0].id).toBe('lamp');
  });

  it('always returns something, deterministically', () => {
    const r = interpretByTags('ыыы щщщ');
    expect(r.objects.length).toBeGreaterThan(0);
    expect(interpretByTags('ыыы щщщ')).toEqual(r);
  });
});
