import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { innerMarkup, readSection, stripIds, UNNAMED_GROUPS } from '../scripts/lib/library-source';
import { decodeFigmaName } from '../scripts/lib/xml';
import { OBJECT_IDS } from '../src/shared/catalog';
import { loadLibrary, loadManifest } from '../src/shared/library-fs';
import { resolveMarkup } from '../src/shared/palette';
import { BG_ROLES, type Size } from '../src/shared/types';

const ROOT = join(__dirname, '..');

describe('Figma layer names', () => {
  it('decodes UTF-8 bytes written as Latin-1 entities', () => {
    expect(decodeFigmaName('&#208;&#154;&#208;&#189;&#208;&#184;&#208;&#179;&#208;&#176;')).toBe('Книга');
    expect(decodeFigmaName('&#208;&#154;&#208;&#190;&#209;&#136;&#208;&#181;&#208;&#187;&#208;&#181;&#208;&#186;_2')).toBe('Кошелек_2');
    expect(decodeFigmaName('Group 2136136344')).toBe('Group 2136136344');
  });
});

describe('manifest', () => {
  const m = loadManifest();
  it('has every object × variant × size', () => {
    expect(m.entries).toHaveLength(OBJECT_IDS.length * 2 * 2);
    for (const id of OBJECT_IDS)
      for (const v of ['main', 'background'])
        for (const s of ['L', 'S']) {
          const e = m.entries.find((x) => x.key === `${id}.${v}.${s}`);
          expect(e, `${id}.${v}.${s}`).toBeTruthy();
          expect(e!.nameRu).toBeTruthy();
          expect(e!.nameEn).toBeTruthy();
          expect(e!.synonyms.length).toBeGreaterThan(0);
          expect(e!.tags.length).toBeGreaterThan(0);
          expect(e!.width).toBeGreaterThan(0);
          expect(e!.height).toBeGreaterThan(0);
        }
  });

  it('wallet carries its meaning tags', () => {
    const w = m.entries.find((e) => e.key === 'wallet.main.L')!;
    expect(w.tags).toEqual(expect.arrayContaining(['деньги', 'накопления', 'покупки']));
  });

  it('has the three schemes from the swatches', () => {
    expect(m.schemes.map((s) => s.id)).toEqual(['lilac', 'peach', 'teal']);
    expect(m.schemes[0].colors).toEqual({
      bgLight: '#D7CDF5',
      bgMid: '#AA9BF0',
      bgDark: '#7864D7',
      ink: '#181817',
      accent1: '#F9ECB0',
      accent2: '#F9A3AA',
      accent3: '#FFE3E1',
      paper: '#FFFFFF',
    });
    expect(m.schemes[1].colors.bgLight).toBe('#FDD7B9');
    expect(m.schemes[2].colors.accent2).toBe('#6D7BFC');
  });

  it('keeps relative proportions: S is about half of L for every object', () => {
    for (const id of OBJECT_IDS) {
      const l = m.entries.find((e) => e.key === `${id}.main.L`)!;
      const s = m.entries.find((e) => e.key === `${id}.main.S`)!;
      expect(s.width / l.width).toBeGreaterThan(0.45);
      expect(s.width / l.width).toBeLessThan(0.6);
    }
  });
});

describe.each(['L', 'S'] as Size[])('library %s', (size) => {
  const sec = readSection(join(ROOT, `assets/source/size-${size}.svg`), size);
  const lib = loadLibrary(size);
  const lilac = loadManifest().schemes[0].colors;

  it('maps every unnamed group', () => {
    expect(sec.ignored).toEqual([]);
    expect(sec.unnamed.map((u) => u.sourceName).sort()).toEqual(Object.keys(UNNAMED_GROUPS[size]).sort());
  });

  it('keeps object geometry byte-for-byte (only colours become roles, layer ids dropped)', () => {
    const canon = (s: string) => s.replace(/(fill|stroke)="(white|#[0-9a-fA-F]{6})"/g, (_, a: string, c: string) => `${a}="${c === 'white' ? '#FFFFFF' : c.toUpperCase()}"`);
    for (const o of sec.objects) {
      const source = canon(stripIds(innerMarkup(sec.src, o.node)));
      const restored = resolveMarkup(lib.objects[o.id][o.variant].markup, lilac);
      expect(restored, `${o.id}/${o.variant}`).toBe(source);
    }
  });

  it('library markup contains only role tokens as colours', () => {
    for (const id of OBJECT_IDS)
      for (const v of ['main', 'background'] as const) {
        const mk = lib.objects[id][v].markup;
        expect(mk).not.toMatch(/(fill|stroke)="#/);
        expect(mk).not.toMatch(/ id="/);
      }
  });

  it('background variants are monochrome in background roles', () => {
    for (const id of OBJECT_IDS) for (const r of lib.objects[id].background.roles) expect(BG_ROLES).toContain(r);
  });

  it('has a tight viewBox and a footprint inside it', () => {
    for (const id of OBJECT_IDS) {
      const f = lib.objects[id].main;
      expect(f.hull.length).toBeGreaterThanOrEqual(3);
      for (const p of f.hull) {
        expect(p.x).toBeGreaterThanOrEqual(-0.5);
        expect(p.y).toBeGreaterThanOrEqual(-0.5);
        expect(p.x).toBeLessThanOrEqual(f.w + 0.5);
        expect(p.y).toBeLessThanOrEqual(f.h + 0.5);
      }
      const xs = f.hull.map((p) => p.x);
      expect(Math.min(...xs)).toBeLessThan(f.w * 0.05);
      expect(Math.max(...xs)).toBeGreaterThan(f.w * 0.95);
    }
  });

  it('extracts the two decoration styles', () => {
    expect(lib.decor.map((d) => d.id)).toEqual(['confetti', 'wedge']);
    for (const d of lib.decor) for (const e of d.elements) for (const r of e.fragment.roles) expect([...BG_ROLES, 'paper']).toContain(r);
  });
});
