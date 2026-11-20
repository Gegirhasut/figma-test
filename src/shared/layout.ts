// Deterministic composition engine.
//
// Input: objects (library ids + main/background role), frame format, level of
// detail and a variant number. Output: a Scene — every object with a centre,
// rotation and paint order, all at one uniform scale.
//
// The rules come from the client's reference compositions (examples.svg):
//  • objects keep their library size relative to each other (one scale for all);
//    in the references that scale is 1, i.e. 1000-unit square frame, 1200×630,
//    800×1200 — we keep it near 1 and only shrink when many objects must fit;
//  • 2–3 main objects sit on a diagonal, the biggest lower-left, smaller ones
//    upper-right / lower-right; a very large main object may be cropped by the frame;
//  • background (monochrome) objects are pushed to an edge and cut by the frame,
//    roughly half visible, behind the main ones;
//  • every object stands on one ground plane, so depth is read from the lowest
//    point of an object's body (its cast shadow excluded): the lower on screen,
//    the closer to the viewer. Whatever is painted in front must also be closer
//    — otherwise it looks like it stands on the object behind it. A main object
//    may cover only a small part of a background object (see DEPTH RULES);
//  • nothing is generated: the scene only references library fragments.
// Starting from template slots, a small pattern search removes overlaps and
// keeps visibility rules; everything is deterministic for the same input.

import type { ObjectId } from './catalog';
import { clipConvex, intersectionArea, orient, placePoint, polygonArea, rectPolygon, type Placement } from './geometry';
import type { DecorStyle, Format, LibraryData, ObjectRequest, Pt, Scene, SceneItem, Size, Variant } from './types';

export interface LayoutInput {
  objects: ObjectRequest[];
  format: Format;
  size: Size;
  /** 0, 1, 2… — alternative arrangements of the same objects. */
  variant?: number;
  /** Optional colour variants carried over from a previous scene (by index). */
  tints?: number[];
}

/** Target share of the frame covered by the main objects' footprints. */
const TARGET_COVERAGE = 0.32;
const MIN_SCALE = 0.3;
const MAX_SCALE = 1.3;

type Slot = [number, number];

const MAIN_TEMPLATES: Record<number, Slot[][]> = {
  1: [[[0.5, 0.54]], [[0.5, 0.56]]],
  2: [
    [[0.42, 0.6], [0.73, 0.32]],
    [[0.56, 0.62], [0.24, 0.32]],
  ],
  3: [
    [[0.62, 0.33], [0.28, 0.63], [0.7, 0.79]],
    [[0.4, 0.42], [0.78, 0.66], [0.25, 0.8]],
  ],
  4: [
    [[0.34, 0.37], [0.7, 0.33], [0.32, 0.74], [0.72, 0.72]],
    [[0.5, 0.48], [0.2, 0.26], [0.8, 0.3], [0.5, 0.84]],
  ],
  5: [
    [[0.5, 0.5], [0.22, 0.26], [0.78, 0.26], [0.22, 0.78], [0.78, 0.78]],
    [[0.32, 0.4], [0.72, 0.36], [0.5, 0.72], [0.15, 0.82], [0.86, 0.8]],
  ],
};

/**
 * Edge slots for background objects; the optimiser pulls them to ~half
 * visibility. In the references they stand behind the main group — at the top
 * or the upper sides — so that they are further away than the main objects.
 */
const BG_SLOTS: Slot[] = [
  [0.12, 0.04],
  [0.9, 0.06],
  [0.5, 0.01],
  [0.03, 0.35],
  [0.97, 0.38],
];

// DEPTH RULES (checked by tests/layout-depth.test.ts)
/** Two objects overlap for depth purposes when their footprints share at least this part of the smaller one. */
export const DEPTH_OVERLAP_EPS = 0.01;
/**
 * A main object may cover at most this share of a background object's body
 * (both without shadows). In the client's references the headphones cover the
 * corner of the vase and the coin touches the lamp's base — well under a fifth.
 */
export const MAX_MAIN_ON_BACKGROUND = 0.18;
/** The optimiser keeps this much extra depth (share of the frame height) between overlapping objects. */
const DEPTH_MARGIN = 0.02;

function gridSlots(n: number): Slot[] {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const out: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const shift = r % 2 ? 0.5 / cols : 0;
    out.push([Math.min(0.92, (c + 0.5) / cols + shift * 0.5), (r + 0.5) / rows]);
  }
  return out;
}

interface Body {
  idx: number;
  id: ObjectId;
  role: Variant;
  w: number;
  h: number;
  hull: Pt[];
  hullArea: number;
  /** Footprint of the body without its shadow and its area (source units). */
  body: Pt[];
  bodyArea: number;
  /** Lowest point of the body, relative to the fragment's top-left corner. */
  base: number;
  x: number;
  y: number;
  ax: number;
  ay: number;
}

export interface LayoutDiagnostics {
  scale: number;
  penalty: number;
  mainVisibility: number[];
  maxMainOverlap: number;
  /** Overlapping pairs painted in the wrong depth order (must be 0). */
  depthViolations: number;
  /** Largest share of a background object's body covered by a main object's body. */
  maxMainOnBackground: number;
}

/**
 * An object painted mostly in the light background colour would melt into the
 * frame (the lilac wallet on a lilac background), so — as in the client's
 * reference compositions, where that wallet is yellow — it starts with a tint.
 */
export function defaultTint(lib: LibraryData, id: ObjectId, role: Variant): number {
  if (role !== 'main') return 0;
  return (lib.objects[id].main.roleShare.bgLight ?? 0) >= 0.3 ? 1 : 0;
}

export function decorForVariant(variant: number): DecorStyle['id'] {
  return variant % 2 === 0 ? 'confetti' : 'wedge';
}

export function layoutScene(input: LayoutInput, lib: LibraryData, uidPrefix = 'o'): Scene {
  return layoutWithDiagnostics(input, lib, uidPrefix).scene;
}

export function layoutWithDiagnostics(input: LayoutInput, lib: LibraryData, uidPrefix = 'o'): { scene: Scene; diagnostics: LayoutDiagnostics } {
  const variant = Math.max(0, Math.floor(input.variant ?? 0));
  const frame = lib.frames[input.format];
  const W = frame.w, H = frame.h;
  const reqs = input.objects.length ? input.objects : [];

  const bodies: Body[] = reqs.map((r, idx) => {
    const f = lib.objects[r.id][r.role];
    const hull = orient(f.hull);
    const body = orient(f.body ?? f.hull);
    return {
      idx, id: r.id, role: r.role, w: f.w, h: f.h, hull, hullArea: Math.abs(polygonArea(hull)),
      body, bodyArea: Math.abs(polygonArea(body)), base: Math.max(...body.map((p) => p.y)),
      x: 0, y: 0, ax: 0, ay: 0,
    };
  });
  const mains = bodies.filter((b) => b.role === 'main');
  const bgs = bodies.filter((b) => b.role === 'background');
  const sizing = mains.length ? mains : bgs;
  const area = sizing.reduce((s, b) => s + b.hullArea, 0) || 1;
  // Background-only scenes are sized like a main scene of the same objects.
  let scale = clamp(Math.sqrt((TARGET_COVERAGE * W * H) / area), MIN_SCALE, MAX_SCALE);
  // Many objects: leave room by targeting a little less coverage per object.
  if (mains.length > 3) scale *= Math.sqrt(3 / mains.length) ** 0.5;
  scale = clamp(scale, MIN_SCALE, MAX_SCALE);

  const mirror = Math.floor(variant / 2) % 2 === 1;
  const alt = Math.floor(variant / 4) % 2;
  const mainOrder = [...mains].sort((a, b) => b.hullArea - a.hullArea || a.idx - b.idx);
  const bgOrder = [...bgs].sort((a, b) => b.hullArea - a.hullArea || a.idx - b.idx);
  const templ = MAIN_TEMPLATES[mainOrder.length]?.[alt] ?? gridSlots(mainOrder.length);

  let best: { bodies: Body[]; scale: number; penalty: number; hard: number } | null = null;
  // Background objects that cannot be placed without breaking depth try the
  // other edge slots before the whole scene is shrunk.
  const shifts = bgOrder.length && mainOrder.length ? BG_SLOTS.length : 1;
  attempts: for (let attempt = 0; attempt < 7; attempt++) {
   for (let shift = 0; shift < shifts; shift++) {
    const s = clamp(scale * Math.pow(0.88, attempt), MIN_SCALE, MAX_SCALE);
    const state = bodies.map((b) => ({ ...b }));
    const byIdx = new Map(state.map((b) => [b.idx, b]));
    mainOrder.forEach((b, i) => {
      const [u, v] = templ[i];
      const t = byIdx.get(b.idx)!;
      t.ax = t.x = (mirror ? 1 - u : u) * W;
      t.ay = t.y = v * H;
    });
    bgOrder.forEach((b, i) => {
      const [u, v] = BG_SLOTS[(i + alt + shift) % BG_SLOTS.length];
      const t = byIdx.get(b.idx)!;
      t.ax = t.x = (mirror ? 1 - u : u) * W;
      t.ay = t.y = v * H;
    });
    const ctx = makeContext(state, s, W, H);
    optimise(state, ctx);
    const { total, hard } = evaluate(state, ctx);
    if (!best || hard < best.hard - 1e-6 || (Math.abs(hard - best.hard) < 1e-6 && total < best.penalty)) {
      best = { bodies: state, scale: s, penalty: total, hard };
    }
    if (hard < 0.05) break attempts;
   }
  }
  const final = best!;
  const ctx = makeContext(final.bodies, final.scale, W, H);
  const order = paintOrder(final.bodies, ctx);
  const items: SceneItem[] = order.map((b) => ({
    uid: `${uidPrefix}${b.idx + 1}`,
    id: b.id,
    role: b.role,
    x: round2(b.x),
    y: round2(b.y),
    rotation: 0,
    tint: input.tints?.[b.idx] ?? defaultTint(lib, b.id, b.role),
  }));
  const scene: Scene = {
    format: input.format,
    size: input.size,
    width: W,
    height: H,
    scale: round4(final.scale),
    decor: decorForVariant(variant),
    items,
  };
  const diag = diagnostics(final.bodies, ctx);
  return { scene, diagnostics: { scale: scene.scale, penalty: final.penalty, ...diag } };
}

// ---------------------------------------------------------------------------

interface Ctx {
  s: number;
  W: number;
  H: number;
  frame: Pt[];
  inner: Pt[];
  diag: number;
  /** idx of the main object that may be cropped (very large one), or -1. */
  croppable: number;
}

function makeContext(state: Body[], s: number, W: number, H: number): Ctx {
  const mains = state.filter((b) => b.role === 'main');
  const margin = Math.min(W, H) * 0.045;
  let croppable = -1;
  if (mains.length >= 2) {
    const biggest = [...mains].sort((a, b) => b.hullArea - a.hullArea)[0];
    if (biggest.w * s > W * 0.55 || biggest.h * s > H * 0.55) croppable = biggest.idx;
  }
  return {
    s,
    W,
    H,
    frame: rectPolygon(0, 0, W, H),
    inner: rectPolygon(margin, margin, W - 2 * margin, H - 2 * margin),
    diag: Math.hypot(W, H),
    croppable,
  };
}

function worldHull(b: Body, s: number): Pt[] {
  const pl: Placement = { x: b.x, y: b.y, rotation: 0, scale: s, w: b.w, h: b.h };
  return b.hull.map((p) => placePoint(p, pl));
}

function worldBody(b: Body, s: number): Pt[] {
  const pl: Placement = { x: b.x, y: b.y, rotation: 0, scale: s, w: b.w, h: b.h };
  return b.body.map((p) => placePoint(p, pl));
}

/** Where the object touches the ground, in frame units: larger = closer to the viewer. */
function worldBase(b: Body, s: number): number {
  return b.y + (b.base - b.h / 2) * s;
}

function evaluate(state: Body[], ctx: Ctx): { total: number; hard: number } {
  const hulls = state.map((b) => worldHull(b, ctx.s));
  const areas = state.map((b) => b.hullArea * ctx.s * ctx.s);
  const bodies = state.map((b) => worldBody(b, ctx.s));
  const bases = state.map((b) => worldBase(b, ctx.s));
  const margin = DEPTH_MARGIN * ctx.H;
  let hard = 0;
  let soft = 0;
  const mainIdx: number[] = [];
  state.forEach((b, i) => {
    if (b.role === 'main') {
      mainIdx.push(i);
      if (b.idx === ctx.croppable) {
        const vis = intersectionArea(hulls[i], ctx.frame) / areas[i];
        hard += 6 * Math.max(0, 0.62 - vis);
        soft += 0.6 * Math.max(0, vis - 0.9); // a cropped hero looks intentional, not accidental
      } else {
        const vis = intersectionArea(hulls[i], ctx.inner) / areas[i];
        hard += 8 * Math.max(0, 0.985 - vis);
      }
    } else {
      const vis = intersectionArea(hulls[i], ctx.frame) / areas[i];
      soft += 3 * (Math.max(0, 0.32 - vis) + Math.max(0, vis - 0.62));
      hard += 6 * Math.max(0, 0.15 - vis);
    }
  });
  for (let i = 0; i < state.length; i++) {
    for (let j = i + 1; j < state.length; j++) {
      const inter = intersectionArea(hulls[i], hulls[j]);
      if (!inter) continue;
      const a = state[i], b = state[j];
      if (a.role === 'main' && b.role === 'main') {
        hard += 6 * Math.max(0, inter / Math.min(areas[i], areas[j]) - 0.05);
      } else if (a.role !== b.role) {
        // Background behind main: the main object must be closer (lower base)
        // and may cover only a small part of the background object's body.
        const bgI = a.role === 'background' ? i : j;
        const mI = bgI === i ? j : i;
        hard += (8 * Math.max(0, bases[bgI] + margin - bases[mI])) / ctx.H;
        const bodyInter = intersectionArea(bodies[mI], bodies[bgI]);
        const bgBody = state[bgI].bodyArea * ctx.s * ctx.s;
        hard += 6 * Math.max(0, bodyInter / bgBody - (MAX_MAIN_ON_BACKGROUND - 0.03));
        soft += 2 * Math.max(0, inter / areas[bgI] - 0.3);
      } else {
        soft += 3 * Math.max(0, inter / Math.min(areas[i], areas[j]) - 0.08);
      }
    }
  }
  if (mainIdx.length) {
    // Balance: centre of the main footprints near the optical centre of the frame.
    let cx = 0, cy = 0, tot = 0;
    for (const i of mainIdx) {
      const c = centroid(clipConvex(hulls[i], ctx.frame));
      const a = areas[i];
      cx += c.x * a;
      cy += c.y * a;
      tot += a;
    }
    cx /= tot;
    cy /= tot;
    soft += 1.2 * (Math.hypot(cx - ctx.W * 0.5, cy - ctx.H * 0.54) / ctx.diag);
    // Compactness: main objects form one group instead of drifting to the corners.
    for (const i of mainIdx) soft += 0.5 * (Math.hypot(state[i].x - cx, state[i].y - cy) / ctx.diag) / mainIdx.length;
  }
  for (const b of state) soft += 0.5 * (Math.hypot(b.x - b.ax, b.y - b.ay) / ctx.diag);
  return { total: hard + soft, hard };
}

function centroid(p: Pt[]): Pt {
  if (p.length < 3) return p[0] ?? { x: 0, y: 0 };
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    const f = p[i].x * p[j].y - p[j].x * p[i].y;
    a += f;
    cx += (p[i].x + p[j].x) * f;
    cy += (p[i].y + p[j].y) * f;
  }
  if (Math.abs(a) < 1e-9) return p[0];
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

const DIRS: Pt[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 0.7071, y: 0.7071 },
  { x: -0.7071, y: 0.7071 },
  { x: 0.7071, y: -0.7071 },
  { x: -0.7071, y: -0.7071 },
];

function optimise(state: Body[], ctx: Ctx): void {
  let step = ctx.diag * 0.08;
  let cur = evaluate(state, ctx).total;
  let guard = 0;
  while (step > ctx.diag * 0.003 && guard++ < 400) {
    let improved = false;
    for (const b of state) {
      let bestD: Pt | null = null;
      let bestV = cur;
      const ox = b.x, oy = b.y;
      for (const d of DIRS) {
        b.x = ox + d.x * step;
        b.y = oy + d.y * step;
        const v = evaluate(state, ctx).total;
        if (v < bestV - 1e-9) {
          bestV = v;
          bestD = d;
        }
      }
      if (bestD) {
        b.x = ox + bestD.x * step;
        b.y = oy + bestD.y * step;
        cur = bestV;
        improved = true;
      } else {
        b.x = ox;
        b.y = oy;
      }
    }
    if (!improved) step *= 0.5;
  }
}

/**
 * Background first, then main objects; within each group by depth — the
 * object standing further away (higher base) is painted first. Overlapping
 * background/main pairs are kept depth-consistent by the optimiser, so the
 * whole order follows depth wherever objects overlap.
 */
function paintOrder(state: Body[], ctx: Ctx): Body[] {
  return [...state].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'background' ? -1 : 1;
    return worldBase(a, ctx.s) - worldBase(b, ctx.s) || a.idx - b.idx;
  });
}

function diagnostics(state: Body[], ctx: Ctx): Omit<LayoutDiagnostics, 'scale' | 'penalty'> {
  const hulls = state.map((b) => worldHull(b, ctx.s));
  const mainVisibility: number[] = [];
  let maxMainOverlap = 0;
  const order = paintOrder(state, ctx);
  let depthViolations = 0;
  let maxMainOnBackground = 0;
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const a = order[i], b = order[j];
      const inter = intersectionArea(worldHull(a, ctx.s), worldHull(b, ctx.s));
      const eps = DEPTH_OVERLAP_EPS * Math.min(a.hullArea, b.hullArea) * ctx.s * ctx.s;
      if (inter > eps && worldBase(b, ctx.s) < worldBase(a, ctx.s)) depthViolations++;
      if (a.role === 'background' && b.role === 'main') {
        const r = intersectionArea(worldBody(a, ctx.s), worldBody(b, ctx.s)) / (a.bodyArea * ctx.s * ctx.s);
        maxMainOnBackground = Math.max(maxMainOnBackground, r);
      }
    }
  }
  state.forEach((b, i) => {
    if (b.role !== 'main') return;
    mainVisibility.push(intersectionArea(hulls[i], ctx.frame) / (b.hullArea * ctx.s * ctx.s));
    state.forEach((c, j) => {
      if (j <= i || c.role !== 'main') return;
      const inter = intersectionArea(hulls[i], hulls[j]);
      maxMainOverlap = Math.max(maxMainOverlap, inter / (Math.min(b.hullArea, c.hullArea) * ctx.s * ctx.s));
    });
  });
  return { mainVisibility, maxMainOverlap, depthViolations, maxMainOnBackground };
}

// ---------------------------------------------------------------------------
// Size switch keeps the user's arrangement: S fragments are the L ones at half
// size in a half-size frame, so positions scale with the frame.

export function convertSceneSize(scene: Scene, target: LibraryData): Scene {
  if (scene.size === target.size) return scene;
  const f = target.frames[scene.format];
  const k = f.w / scene.width;
  return {
    ...scene,
    size: target.size,
    width: f.w,
    height: f.h,
    items: scene.items.map((it) => ({ ...it, x: round2(it.x * k), y: round2(it.y * k) })),
  };
}

export function sceneRequests(scene: Scene): { objects: ObjectRequest[]; tints: number[] } {
  return { objects: scene.items.map((i) => ({ id: i.id, role: i.role })), tints: scene.items.map((i) => i.tint) };
}

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}
function round2(v: number) {
  return Math.round(v * 100) / 100;
}
function round4(v: number) {
  return Math.round(v * 10000) / 10000;
}
