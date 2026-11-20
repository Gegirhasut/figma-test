import { describe, expect, it } from 'vitest';
import { OBJECT_IDS, type ObjectId } from '../src/shared/catalog';
import { convertSceneSize, layoutScene, layoutWithDiagnostics, sceneRequests } from '../src/shared/layout';
import { loadLibrary } from '../src/shared/library-fs';
import { SCHEMES } from '../src/shared/palette';
import { sceneColorUsage } from '../src/shared/render';
import { BG_ROLES, OBJ_ROLES, type Format, type ObjectRequest, type Size } from '../src/shared/types';

const formats: Format[] = ['square', 'horizontal', 'vertical'];
const sizes: Size[] = ['L', 'S'];
const main = (...ids: ObjectId[]): ObjectRequest[] => ids.map((id) => ({ id, role: 'main' }));

const CASES: ObjectRequest[][] = [
  main('wallet'),
  main('wallet', 'coin'),
  main('phone', 'puzzle'),
  main('folder', 'wallet', 'coin'),
  [...main('headphones'), { id: 'flower', role: 'background' }],
  [...main('book', 'lamp', 'pen'), { id: 'flower', role: 'background' }],
  main('book', 'phone', 'puzzle', 'coin'),
  [...main('pen', 'puzzle'), { id: 'book', role: 'background' }, { id: 'lamp', role: 'background' }],
];

describe('layout invariants', () => {
  for (const size of sizes) {
    const lib = loadLibrary(size);
    for (const format of formats) {
      it(`${size} ${format}: uses only library objects, one uniform scale, sane placement`, () => {
        for (const objects of CASES) {
          const { scene, diagnostics } = layoutWithDiagnostics({ objects, format, size }, lib);
          expect(scene.width).toBe(lib.frames[format].w);
          expect(scene.height).toBe(lib.frames[format].h);
          expect(scene.items).toHaveLength(objects.length);
          // Every requested object, same multiset, nothing invented.
          expect(scene.items.map((i) => `${i.id}/${i.role}`).sort()).toEqual(objects.map((o) => `${o.id}/${o.role}`).sort());
          for (const it of scene.items) expect(OBJECT_IDS).toContain(it.id);
          // One scale for the whole scene: the item has no scale of its own.
          expect(scene.scale).toBeGreaterThan(0.25);
          expect(scene.scale).toBeLessThanOrEqual(1.3);
          for (const it of scene.items) expect(Object.keys(it).sort()).toEqual(['id', 'role', 'rotation', 'tint', 'uid', 'x', 'y']);
          // Main objects visible (a big hero may be cropped like in the references), not piled up.
          for (const v of diagnostics.mainVisibility) expect(v).toBeGreaterThan(0.55);
          expect(diagnostics.maxMainOverlap).toBeLessThan(0.15);
          // Background objects are painted behind the main ones.
          const firstMain = scene.items.findIndex((i) => i.role === 'main');
          const lastBg = scene.items.map((i) => i.role).lastIndexOf('background');
          if (firstMain >= 0 && lastBg >= 0) expect(lastBg).toBeLessThan(firstMain);
        }
      });
    }
  }

  it('is deterministic', () => {
    const lib = loadLibrary('L');
    const a = layoutScene({ objects: CASES[5], format: 'square', size: 'L', variant: 3 }, lib);
    const b = layoutScene({ objects: CASES[5], format: 'square', size: 'L', variant: 3 }, lib);
    expect(a).toEqual(b);
  });

  it('variants give different arrangements of the same objects', () => {
    const lib = loadLibrary('L');
    const a = layoutScene({ objects: CASES[1], format: 'square', size: 'L', variant: 0 }, lib);
    const b = layoutScene({ objects: CASES[1], format: 'square', size: 'L', variant: 2 }, lib);
    expect(a.items.map((i) => [i.x, i.y])).not.toEqual(b.items.map((i) => [i.x, i.y]));
  });

  it('changing the format re-lays-out instead of cropping', () => {
    const lib = loadLibrary('L');
    const sq = layoutScene({ objects: CASES[3], format: 'square', size: 'L' }, lib);
    const r = sceneRequests(sq);
    const vert = layoutScene({ ...r, format: 'vertical', size: 'L' }, lib);
    expect(vert.height).toBe(1200);
    for (const it of vert.items) {
      expect(it.x).toBeGreaterThanOrEqual(0);
      expect(it.x).toBeLessThanOrEqual(vert.width);
      expect(it.y).toBeGreaterThanOrEqual(0);
      expect(it.y).toBeLessThanOrEqual(vert.height);
    }
    expect(vert.items.map((i) => i.y)).not.toEqual(sq.items.map((i) => i.y));
  });

  it('switching L/S keeps the arrangement in proportion', () => {
    const L = loadLibrary('L');
    const S = loadLibrary('S');
    const a = layoutScene({ objects: CASES[1], format: 'horizontal', size: 'L' }, L);
    const b = convertSceneSize(a, S);
    expect(b.width).toBe(600);
    expect(b.items[0].x).toBeCloseTo(a.items[0].x / 2, 1);
    expect(b.scale).toBe(a.scale);
  });
});

describe('colour rules', () => {
  for (const scheme of SCHEMES) {
    it(`${scheme.nameRu}: background never uses object colours`, () => {
      const lib = loadLibrary('L');
      const bgColors = new Set(BG_ROLES.map((r) => scheme.colors[r]));
      const objColors = new Set(OBJ_ROLES.map((r) => scheme.colors[r]));
      const all = new Set([...bgColors, ...objColors]);
      for (const variant of [0, 1]) {
        for (const objects of CASES) {
          const scene = layoutScene({ objects, format: 'square', size: 'L', variant }, lib);
          const u = sceneColorUsage(scene, lib, scheme.colors);
          // Frame and decoration: background colours (the decoration's white glint is drawn so in the client's swatch).
          for (const c of u.background) expect([...bgColors, scheme.colors.paper]).toContain(c);
          expect(u.background.has(scheme.colors.accent1)).toBe(false);
          // Background objects: monochrome, background colours only.
          for (const c of u.backgroundObjects) expect(bgColors).toContain(c);
          // Main objects: anything from the scheme, nothing else.
          for (const c of u.mainObjects) expect(all).toContain(c);
        }
      }
    });
  }

  it('tints only permute scheme colours of main objects', () => {
    const lib = loadLibrary('L');
    const scheme = SCHEMES[0];
    const scene = layoutScene({ objects: main('wallet', 'coin'), format: 'square', size: 'L', tints: [2, 1] }, lib);
    const u = sceneColorUsage(scene, lib, scheme.colors);
    for (const c of u.mainObjects) expect(Object.values(scheme.colors)).toContain(c);
  });

  it('a lilac wallet on a lilac frame starts with a tint so it does not melt into the background', () => {
    const lib = loadLibrary('L');
    const scene = layoutScene({ objects: main('wallet', 'coin'), format: 'horizontal', size: 'L' }, lib);
    expect(scene.items.find((i) => i.id === 'wallet')!.tint).toBe(1);
    expect(scene.items.find((i) => i.id === 'coin')!.tint).toBe(0);
  });
});
