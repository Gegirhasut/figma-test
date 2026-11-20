import type { Pt } from './types';

export function polygonArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return a / 2;
}

/** Makes the polygon's signed area positive. */
export function orient(p: Pt[]): Pt[] {
  return polygonArea(p) < 0 ? [...p].reverse() : p;
}

/** Sutherland–Hodgman clip of `subject` by the convex polygon `clip` (both positively oriented). */
export function clipConvex(subject: Pt[], clip: Pt[]): Pt[] {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const inside = (p: Pt) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
    const inter = (p: Pt, q: Pt): Pt => {
      const a1 = b.y - a.y, b1 = a.x - b.x, c1 = a1 * a.x + b1 * a.y;
      const a2 = q.y - p.y, b2 = p.x - q.x, c2 = a2 * p.x + b2 * p.y;
      const det = a1 * b2 - a2 * b1;
      if (Math.abs(det) < 1e-12) return q;
      return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
    };
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const cur = input[k];
      const prev = input[(k - 1 + input.length) % input.length];
      const cin = inside(cur), pin = inside(prev);
      if (cin) {
        if (!pin) out.push(inter(prev, cur));
        out.push(cur);
      } else if (pin) {
        out.push(inter(prev, cur));
      }
    }
  }
  return out;
}

export function intersectionArea(a: Pt[], b: Pt[]): number {
  const c = clipConvex(a, b);
  return c.length < 3 ? 0 : Math.abs(polygonArea(c));
}

export function rectPolygon(x: number, y: number, w: number, h: number): Pt[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export interface Placement {
  /** Centre of the object in frame units. */
  x: number;
  y: number;
  rotation: number;
  scale: number;
  /** Fragment size in source units. */
  w: number;
  h: number;
}

/** Maps a point given relative to the fragment's top-left corner into frame units. */
export function placePoint(p: Pt, pl: Placement): Pt {
  const lx = (p.x - pl.w / 2) * pl.scale;
  const ly = (p.y - pl.h / 2) * pl.scale;
  if (!pl.rotation) return { x: pl.x + lx, y: pl.y + ly };
  const r = (pl.rotation * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return { x: pl.x + lx * c - ly * s, y: pl.y + lx * s + ly * c };
}

export function boundsOf(pts: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}
