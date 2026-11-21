// Adding and removing single objects in an existing scene without a new
// layout: everything already on the canvas (moved or rotated by the user) stays
// where it is. The new object goes where it was dropped, or on a click to the
// free spot nearest the centre; either way it is never cropped by the frame and
// is inserted into the paint order by depth.

import type { ObjectId } from './catalog';
import { boundsOf, clipConvex, intersectionArea, orient, placePoint, polygonArea as signedArea, rectPolygon, type Placement } from './geometry';
import { MAX_MAIN_ON_BACKGROUND, convertSceneSize, layoutScene } from './layout';
import type { LibraryData, Pt, Scene, SceneItem, Variant } from './types';

/** At most this many copies of one library object in a scene (the TZ sets no limit; this is a sensible default). */
export const MAX_SAME_OBJECT = 3;
/** At most this many objects in a scene. */
export const MAX_ITEMS = 8;
export const SAME_OBJECT_LIMIT_TEXT = 'Не больше трёх одинаковых объектов';

export function countOf(items: SceneItem[], id: ObjectId): number {
  return items.reduce((n, it) => n + (it.id === id ? 1 : 0), 0);
}

/** Why another `id` cannot be added, or null when it can. */
export function addBlocker(items: SceneItem[], id: ObjectId): string | null {
  if (items.length >= MAX_ITEMS) return `Не больше ${MAX_ITEMS} объектов в композиции`;
  if (countOf(items, id) >= MAX_SAME_OBJECT) return SAME_OBJECT_LIMIT_TEXT;
  return null;
}

/**
 * Role for an object the user adds by hand: always main (coloured). The TZ sets no limit on main objects,
 * and an object that silently arrives monochrome looks like a bug; the user can still make it background
 * with the toolbar's «Главный или фоновый».
 */
export function roleForNew(_items: SceneItem[]): Variant {
  return 'main';
}

function placement(item: SceneItem, lib: LibraryData, scale: number): { pl: Placement; hull: Pt[]; body: Pt[] } {
  const f = lib.objects[item.id][item.role];
  const pl: Placement = { x: item.x, y: item.y, rotation: item.rotation, scale: scale * (f.detail ?? 1), w: f.w, h: f.h };
  return { pl, hull: orient(f.hull.map((p) => placePoint(p, pl))), body: orient(f.body.map((p) => placePoint(p, pl))) };
}

const polygonArea = (p: Pt[]) => Math.abs(signedArea(p));

export function itemHull(item: SceneItem, lib: LibraryData, scale: number): Pt[] {
  return placement(item, lib, scale).hull;
}

/** Where the object stands on the ground plane (lowest point of its body): larger = closer to the viewer. */
export function itemBase(item: SceneItem, lib: LibraryData, scale: number): number {
  return boundsOf(placement(item, lib, scale).body).maxY;
}

/**
 * Inserts `item` into the paint order by depth: background objects before main
 * ones, and within its group after everything standing further away. The order
 * of the existing objects is kept as it is.
 */
export function insertByDepth(items: SceneItem[], item: SceneItem, lib: LibraryData, scale: number): SceneItem[] {
  const base = itemBase(item, lib, scale);
  let at = items.length;
  for (let k = 0; k < items.length; k++) {
    const o = items[k];
    if (item.role === 'background' && o.role === 'main') {
      at = k;
      break;
    }
    if (o.role === item.role && itemBase(o, lib, scale) > base) {
      at = k;
      break;
    }
  }
  return [...items.slice(0, at), item, ...items.slice(at)];
}

/**
 * Centre position that keeps the whole object inside the frame (with a small
 * margin), as close as possible to the wanted one.
 */
export function clampInside(item: SceneItem, lib: LibraryData, scene: Scene, margin = 0.02): { x: number; y: number } {
  const m = Math.min(scene.width, scene.height) * margin;
  const b = boundsOf(itemHull(item, lib, scene.scale));
  const halfLeft = item.x - b.minX, halfRight = b.maxX - item.x;
  const halfTop = item.y - b.minY, halfBottom = b.maxY - item.y;
  const fit = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return {
    x: fit(item.x, m + halfLeft, scene.width - m - halfRight),
    y: fit(item.y, m + halfTop, scene.height - m - halfBottom),
  };
}

/** Problems an object at its position would cause with the others (0 = fine). */
function conflict(item: SceneItem, others: SceneItem[], lib: LibraryData, scene: Scene): { overlap: number; depth: number } {
  const s = scene.scale;
  const { hull, body } = placement(item, lib, s);
  const area = polygonArea(hull);
  const base = boundsOf(body).maxY;
  let overlap = 0;
  let depth = 0;
  for (const o of others) {
    const p = placement(o, lib, s);
    const inter = intersectionArea(hull, p.hull);
    if (!inter) continue;
    overlap += inter / Math.min(area, polygonArea(p.hull));
    if (item.role !== o.role) {
      // A main object in front of a background one must stand closer and cover little of its body.
      const [bg, main] = item.role === 'background' ? [{ body, base }, { body: p.body, base: boundsOf(p.body).maxY }] : [{ body: p.body, base: boundsOf(p.body).maxY }, { body, base }];
      if (main.base <= bg.base) depth += 1;
      const covered = intersectionArea(main.body, bg.body) / polygonArea(bg.body);
      if (covered > MAX_MAIN_ON_BACKGROUND) depth += covered;
    }
  }
  return { overlap, depth };
}

/**
 * The free spot nearest the centre for a new object: a grid of candidates
 * (all keeping the object fully inside the frame), scored by overlap with the
 * existing objects, depth-rule conflicts and distance from the centre.
 */
export function freeSpot(item: SceneItem, others: SceneItem[], lib: LibraryData, scene: Scene): { x: number; y: number } {
  const W = scene.width, H = scene.height;
  const cx = W / 2, cy = H * 0.54;
  const diag = Math.hypot(W, H);
  let best = clampInside({ ...item, x: cx, y: cy }, lib, scene, 0.045);
  let bestScore = Infinity;
  const N = 13;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const want = { ...item, x: (W * (i + 0.5)) / N, y: (H * (j + 0.5)) / N };
      const pos = clampInside(want, lib, scene, 0.045);
      const cand = { ...item, ...pos };
      const c = conflict(cand, others, lib, scene);
      const score = 10 * c.depth + 3 * c.overlap + Math.hypot(pos.x - cx, pos.y - cy) / diag;
      if (score < bestScore - 1e-9) {
        bestScore = score;
        best = pos;
      }
    }
  }
  return { x: round2(best.x), y: round2(best.y) };
}

/** Share of the upper half of a tall main object inside the frame (1 for objects that are not tall). */
export function upperHalfVisible(item: SceneItem, lib: LibraryData, scene: Scene): number {
  const hull = itemHull(item, lib, scene.scale);
  const b = boundsOf(hull);
  if (b.maxY - b.minY <= scene.height * 0.45) return 1;
  const mid = (b.minY + b.maxY) / 2;
  const upper = clipConvex(hull, rectPolygon(-1e6, b.minY - 1, 2e6, mid - b.minY + 1));
  const a = polygonArea(upper);
  return a > 0 ? intersectionArea(upper, rectPolygon(0, 0, scene.width, scene.height)) / a : 1;
}

/** Share of the object's footprint inside the frame. */
export function visibleShare(item: SceneItem, lib: LibraryData, scene: Scene): number {
  const hull = itemHull(item, lib, scene.scale);
  return intersectionArea(hull, rectPolygon(0, 0, scene.width, scene.height)) / polygonArea(hull);
}

/**
 * Adds one object without touching the others. `at` is the drop point in frame
 * units; without it the object goes to the free spot nearest the centre.
 * Returns null when a limit forbids it.
 */
export function addObject(
  scene: Scene,
  lib: LibraryData,
  add: { uid: string; id: ObjectId; tint: number; role?: Variant },
  at?: { x: number; y: number },
  /** The L library: an S scene is laid out with the L geometry (identical to L). */
  libL: LibraryData = lib,
): Scene | null {
  if (addBlocker(scene.items, add.id)) return null;
  const role = add.role ?? roleForNew(scene.items);
  if (!scene.items.length && !at) {
    // An empty canvas: the object is laid out on its own, as a one-object composition (centred, scale to suit it).
    const solo = convertSceneSize(layoutScene({ objects: [{ id: add.id, role }], tints: [add.tint], format: scene.format, size: 'L' }, libL), lib);
    return { ...scene, scale: solo.scale, items: solo.items.map((it) => ({ ...it, uid: add.uid })) };
  }
  const item: SceneItem = { uid: add.uid, id: add.id, role, tint: add.tint, rotation: 0, x: at?.x ?? scene.width / 2, y: at?.y ?? scene.height / 2 };
  scene = zoomToFit(scene, item, lib);
  const pos = at ? clampInside(item, lib, scene) : freeSpot(item, scene.items, lib, scene);
  const placed = { ...item, x: round2(pos.x), y: round2(pos.y) };
  return { ...scene, items: insertByDepth(scene.items, placed, lib, scene.scale) };
}

/**
 * The scene has one scale for all objects (their proportions never change). A
 * scene laid out for small objects (a coin and a wallet) can be too large for a
 * book: then the whole composition zooms out around the frame centre, keeping
 * the arrangement, until the new object fits inside the frame.
 */
export function zoomToFit(scene: Scene, item: SceneItem, lib: LibraryData, room = 0.9): Scene {
  const b = boundsOf(itemHull({ ...item, x: 0, y: 0 }, lib, scene.scale));
  const k = Math.min(1, (scene.width * room) / (b.maxX - b.minX), (scene.height * room) / (b.maxY - b.minY));
  if (k >= 1) return scene;
  const cx = scene.width / 2, cy = scene.height / 2;
  return {
    ...scene,
    scale: Math.round(scene.scale * k * 10000) / 10000,
    items: scene.items.map((it) => ({ ...it, x: round2(cx + (it.x - cx) * k), y: round2(cy + (it.y - cy) * k) })),
  };
}

/**
 * S/L switch: S and L pieces are drawn at the same size, so nothing moves or
 * resizes — positions, manual moves and rotations stay exactly; only the
 * pieces (level of detail) are swapped.
 */
export function switchSize(scene: Scene, _from: LibraryData, to: LibraryData): Scene {
  return convertSceneSize(scene, to);
}

/** «Очистить»: no objects left; the frame, format, scale and decoration stay. */
export function clearScene(scene: Scene): Scene {
  return { ...scene, items: [] };
}

/** Removes the most recently added copy of `id` (the highest uid number; the last one in the scene otherwise). */
export function removeLatest(items: SceneItem[], id: ObjectId): SceneItem[] {
  let k = -1;
  let bestN = -Infinity;
  items.forEach((it, i) => {
    if (it.id !== id) return;
    const n = Number(/(\d+)$/.exec(it.uid)?.[1] ?? NaN);
    const rank = Number.isNaN(n) ? i : n;
    if (k < 0 || rank >= bestN) {
      bestN = rank;
      k = i;
    }
  });
  return k < 0 ? items : [...items.slice(0, k), ...items.slice(k + 1)];
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
