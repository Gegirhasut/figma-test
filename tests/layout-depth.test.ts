// Depth invariants of generated scenes, measured independently of the engine.
//
// Every object stands on one ground plane, so the lowest point of an object's
// body (cast shadow excluded) says how close it is to the viewer. For any two
// overlapping objects the one painted later must be closer (lower base),
// otherwise it looks like it stands on the other one. A main object may cover
// only a small part of a background object's body.

import { describe, expect, it } from 'vitest';
import { OBJECT_IDS, type ObjectId } from '../src/shared/catalog';
import { intersectionArea, orient, placePoint, polygonArea, type Placement } from '../src/shared/geometry';
import { DEPTH_OVERLAP_EPS, layoutScene, MAX_MAIN_ON_BACKGROUND } from '../src/shared/layout';
import { loadLibrary } from '../src/shared/library-fs';
import { SCHEMES } from '../src/shared/palette';
import { sceneToSvg } from '../src/shared/render';
import type { Format, LibraryData, ObjectRequest, Pt, Scene, SceneItem, Size } from '../src/shared/types';

const formats: Format[] = ['square', 'horizontal', 'vertical'];
const sizes: Size[] = ['L', 'S'];

interface Placed {
  item: SceneItem;
  hull: Pt[];
  body: Pt[];
  base: number;
}

function place(scene: Scene, lib: LibraryData): Placed[] {
  return scene.items.map((item) => {
    const f = lib.objects[item.id][item.role];
    const pl: Placement = { x: item.x, y: item.y, rotation: item.rotation, scale: scene.scale * (f.detail ?? 1), w: f.w, h: f.h };
    const hull = orient(f.hull.map((p) => placePoint(p, pl)));
    const body = orient(f.body.map((p) => placePoint(p, pl)));
    return { item, hull, body, base: Math.max(...body.map((p) => p.y)) };
  });
}

const area = (p: Pt[]) => Math.abs(polygonArea(p));

/** Problems found in one scene, as readable strings (empty = fine). */
function depthProblems(scene: Scene, lib: LibraryData): string[] {
  const out: string[] = [];
  const placed = place(scene, lib);
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const back = placed[i], front = placed[j];
      const inter = intersectionArea(back.hull, front.hull);
      if (inter <= DEPTH_OVERLAP_EPS * Math.min(area(back.hull), area(front.hull))) continue;
      const name = (p: Placed) => `${p.item.id}/${p.item.role}`;
      if (front.base < back.base) {
        out.push(`${name(front)} painted over ${name(back)} but stands further away (base ${front.base.toFixed(0)} < ${back.base.toFixed(0)})`);
      }
      const bg = back.item.role === 'background' ? back : front.item.role === 'background' ? front : null;
      const mn = back.item.role === 'main' ? back : front.item.role === 'main' ? front : null;
      if (bg && mn) {
        const share = intersectionArea(bg.body, mn.body) / area(bg.body);
        if (share > MAX_MAIN_ON_BACKGROUND) out.push(`${name(mn)} covers ${(share * 100).toFixed(0)}% of ${name(bg)}`);
      }
    }
  }
  return out;
}

const m = (id: ObjectId): ObjectRequest => ({ id, role: 'main' });
const b = (id: ObjectId): ObjectRequest => ({ id, role: 'background' });

/** Deterministic spread of object combinations: 1–5 objects, with and without background objects. */
function combinations(): ObjectRequest[][] {
  const ids = OBJECT_IDS as readonly ObjectId[];
  const out: ObjectRequest[][] = [];
  // The reported case: coin and wallet in front of a background flower vase.
  out.push([m('coin'), m('wallet'), b('flower')]);
  out.push([m('wallet'), m('coin')]);
  out.push([m('headphones'), m('phone'), b('book')]);
  for (let k = 0; k < ids.length; k++) {
    const a = ids[k], c = ids[(k + 3) % ids.length], d = ids[(k + 5) % ids.length], e = ids[(k + 7) % ids.length], f = ids[(k + 1) % ids.length];
    out.push([m(a)]);
    out.push([m(a), b(c)]);
    out.push([m(a), m(c)]);
    out.push([m(a), m(c), b(d)]);
    out.push([m(a), m(c), m(d)]);
    out.push([m(a), m(c), m(d), b(e)]);
    out.push([m(a), m(c), b(d), b(e)]);
    out.push([m(a), m(c), m(d), m(e)]);
    out.push([m(a), m(c), m(d), m(e), b(f)]);
    out.push([m(a), m(c), m(d), m(e), m(f)]);
  }
  return out;
}

const CASES = combinations();

describe('depth-consistent layout', () => {
  for (const size of sizes) {
    const lib = loadLibrary(size);
    for (const format of formats) {
      it(`${size} ${format}: objects painted in front are closer; main objects barely cover background ones`, () => {
        const problems: string[] = [];
        for (const objects of CASES) {
          for (const variant of [0, 1, 2]) {
            const scene = layoutScene({ objects, format, size, variant }, lib);
            for (const p of depthProblems(scene, lib)) problems.push(`[${objects.map((o) => `${o.id}/${o.role}`).join(', ')} v${variant}] ${p}`);
          }
        }
        expect(problems).toEqual([]);
      });
    }
  }

  it('the reported scene «коплю на Opus» keeps the coin off the vase', () => {
    const lib = loadLibrary('L');
    const scene = layoutScene({ objects: [m('coin'), m('wallet'), b('flower')], format: 'vertical', size: 'L' }, lib);
    expect(depthProblems(scene, lib)).toEqual([]);
    expect(scene.items[0]).toMatchObject({ id: 'flower', role: 'background' });
  });

  it('«купим на отпуск»: background headphones stay behind, the coin is not on them', () => {
    const lib = loadLibrary('L');
    const scene = layoutScene({ objects: [m('wallet'), m('coin'), b('headphones')], format: 'horizontal', size: 'L' }, lib);
    expect(depthProblems(scene, lib)).toEqual([]);
    expect(scene.items[0]).toMatchObject({ id: 'headphones', role: 'background' });
  });

  it('every object of a scene, main or background, is drawn at one shared scale', () => {
    for (const size of sizes) {
      const lib = loadLibrary(size);
      for (const format of formats) {
        for (const objects of CASES.filter((c) => c.some((o) => o.role === 'background'))) {
          const scene = layoutScene({ objects, format, size }, lib);
          const svg = sceneToSvg(scene, lib, SCHEMES[0].colors);
          // Object groups carry "translate(cx cy) scale(k) translate(..)"; decoration has no scale.
          const scales = [...svg.matchAll(/<g id="[^"]*" transform="translate\([^)]*\) scale\(([\d.]+)\)/g)].map((x) => Number(x[1]));
          expect(scales).toHaveLength(scene.items.length);
          // One scene scale; an S piece adds only its own detail factor, which draws it at its L size.
          scene.items.forEach((it, k) => expect(scales[k]).toBeCloseTo(scene.scale * (lib.objects[it.id][it.role].detail ?? 1), 2));
          // So drawn sizes keep the L library proportions between any two objects.
          const L = loadLibrary('L');
          const [p, q] = scene.items;
          const fp = lib.objects[p.id][p.role], fq = lib.objects[q.id][q.role];
          const lp = L.objects[p.id][p.role], lq = L.objects[q.id][q.role];
          expect(Math.abs((fp.w * scales[0]) / (fq.w * scales[1]) / (lp.w / lq.w) - 1)).toBeLessThan(0.01);
        }
      }
    }
  });

  it('the body footprint excludes the cast shadow', () => {
    const lib = loadLibrary('L');
    // The coin's shadow falls far below its body; the book's shadow below the cover.
    for (const id of ['coin', 'book'] as ObjectId[]) {
      const f = lib.objects[id].main;
      expect(Math.max(...f.body.map((p) => p.y))).toBeLessThan(f.h * 0.93);
      expect(area(f.body)).toBeLessThan(area(f.hull));
    }
  });
});
