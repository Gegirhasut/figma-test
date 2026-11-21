import { describe, expect, it } from 'vitest';
import { matchObjects } from '../src/shared/matcher';
import { CHIP_SETS, DEMO_EXAMPLE, FIXED_SETS, findFixedSet } from '../src/client/demo-examples';
import { CHIPS, LIST_CHIPS, takeFirstHint } from '../src/client/onboarding';
import { layoutWithDiagnostics } from '../src/shared/layout';
import { loadLibrary } from '../src/shared/library-fs';

const ids = (objects: { id: string; role: string }[]) => objects.map((o) => `${o.id}/${o.role}`);

describe('fixed phrase sets', () => {
  it('are the honest phrases with the objects they name', () => {
    const byPhrase = Object.fromEntries(FIXED_SETS.map((s) => [s.phrase, ids(s.objects)]));
    expect(byPhrase).toEqual({
      'Вечер с книгой': ['book/main', 'lamp/main', 'flower/background'],
      'Коплю деньги': ['wallet/main', 'coin/main'],
      'Слушаю подкаст': ['headphones/main', 'phone/main'],
      'Готовлюсь к экзамену': ['book/main', 'pen/main', 'lamp/background'],
      'Разбираю документы': ['folder/main', 'pen/main'],
    });
  });

  it('the demo is «Вечер с книгой» and there are three chips', () => {
    expect(DEMO_EXAMPLE.phrase).toBe('Вечер с книгой');
    expect(CHIP_SETS.map((s) => s.phrase)).toEqual(['Вечер с книгой', 'Коплю деньги', 'Слушаю подкаст']);
    expect(CHIPS.every((c) => c.example)).toBe(true);
  });

  it('every set lays out within the depth rules', () => {
    const lib = loadLibrary('L');
    for (const s of FIXED_SETS) {
      const { scene, diagnostics } = layoutWithDiagnostics({ objects: s.objects, format: s.format, size: 'L', variant: s.variant }, lib);
      expect(diagnostics.depthViolations, s.phrase).toBe(0);
      expect(scene.items).toHaveLength(s.objects.length);
    }
  });

  it('the chips after the AI limit are plain object lists read by the dictionary', () => {
    for (const c of LIST_CHIPS) expect(matchObjects(c.phrase).mode).toBe('objects');
  });
});

describe('first-result hint', () => {
  it('shows once per browser', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(takeFirstHint(storage)).toBe(true);
    expect(takeFirstHint(storage)).toBe(false);
  });

  it('a broken storage does not throw', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
    };
    expect(takeFirstHint(storage)).toBe(false);
  });
});

describe('typed example phrases', () => {
  it('a phrase typed by hand finds the same fixed set as its chip (case, ё, spaces, final dot ignored)', () => {
    for (const set of FIXED_SETS) expect(findFixedSet(set.phrase)).toBe(set);
    expect(findFixedSet('  вечер   с КНИГОЙ. ')).toBe(DEMO_EXAMPLE);
    expect(findFixedSet('Коплю деньги!')?.phrase).toBe('Коплю деньги');
  });

  it('other phrases are not treated as examples', () => {
    expect(findFixedSet('вечер с книгой и лампой')).toBeUndefined();
    expect(findFixedSet('кошелёк, монета')).toBeUndefined();
  });
});
