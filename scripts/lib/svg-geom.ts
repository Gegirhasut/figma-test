// Geometry helpers for the library extraction: exact bounding boxes of SVG
// path data (absolute and relative commands, cubic/quadratic extrema, arcs by
// sampling) and a convex hull used as a coarse footprint of each object.

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyBox(): Box {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function addPoint(b: Box, x: number, y: number): void {
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
}

export function unionBox(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

const PARAMS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push(m[1] ? m[1] : parseFloat(m[2]));
  return out;
}

/** Roots of the derivative of a 1-D cubic Bezier, in (0,1). */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const ts: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      ts.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  return ts.filter((t) => t > 0 && t < 1);
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * Walks path data and reports every point on the outline that matters for a
 * bounding box (end points and curve extrema) plus a few interior samples per
 * curve (used for the hull).
 */
export function pathPoints(d: string, samplesPerCurve = 4): Pt[] {
  const toks = tokenize(d);
  const pts: Pt[] = [];
  let i = 0;
  let cmd = '';
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  let lastCtrl: Pt | null = null;
  let lastQuad: Pt | null = null;
  const num = () => toks[i++] as number;

  const addCubic = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    const ts = new Set<number>([...cubicExtrema(x0, x1, x2, x3), ...cubicExtrema(y0, y1, y2, y3)]);
    for (let k = 1; k < samplesPerCurve; k++) ts.add(k / samplesPerCurve);
    for (const t of ts) pts.push({ x: cubicAt(x0, x1, x2, x3, t), y: cubicAt(y0, y1, y2, y3, t) });
    pts.push({ x: x3, y: y3 });
  };

  while (i < toks.length) {
    const tk = toks[i];
    if (typeof tk === 'string') {
      cmd = tk;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        x = sx;
        y = sy;
        lastCtrl = lastQuad = null;
        continue;
      }
    } else if (!cmd) {
      throw new Error('path data does not start with a command');
    }
    const lc = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    if (PARAMS[lc] === undefined) throw new Error(`unsupported path command ${cmd}`);
    if (lc === 'z') continue;
    const bx = rel ? x : 0;
    const by = rel ? y : 0;
    switch (lc) {
      case 'm': {
        x = bx + num();
        y = by + num();
        sx = x;
        sy = y;
        pts.push({ x, y });
        cmd = rel ? 'l' : 'L'; // subsequent pairs are line-to
        lastCtrl = lastQuad = null;
        break;
      }
      case 'l':
        x = bx + num();
        y = by + num();
        pts.push({ x, y });
        lastCtrl = lastQuad = null;
        break;
      case 'h':
        x = bx + num();
        pts.push({ x, y });
        lastCtrl = lastQuad = null;
        break;
      case 'v':
        y = by + num();
        pts.push({ x, y });
        lastCtrl = lastQuad = null;
        break;
      case 'c': {
        const x1 = bx + num(), y1 = by + num(), x2 = bx + num(), y2 = by + num(), x3 = bx + num(), y3 = by + num();
        addCubic(x, y, x1, y1, x2, y2, x3, y3);
        lastCtrl = { x: x2, y: y2 };
        lastQuad = null;
        x = x3;
        y = y3;
        break;
      }
      case 's': {
        const x1 = lastCtrl ? 2 * x - lastCtrl.x : x;
        const y1 = lastCtrl ? 2 * y - lastCtrl.y : y;
        const x2 = bx + num(), y2 = by + num(), x3 = bx + num(), y3 = by + num();
        addCubic(x, y, x1, y1, x2, y2, x3, y3);
        lastCtrl = { x: x2, y: y2 };
        lastQuad = null;
        x = x3;
        y = y3;
        break;
      }
      case 'q':
      case 't': {
        let qx: number, qy: number;
        if (lc === 'q') {
          qx = bx + num();
          qy = by + num();
        } else {
          qx = lastQuad ? 2 * x - lastQuad.x : x;
          qy = lastQuad ? 2 * y - lastQuad.y : y;
        }
        const x3 = bx + num(), y3 = by + num();
        // elevate to cubic
        addCubic(x, y, x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x3 + (2 / 3) * (qx - x3), y3 + (2 / 3) * (qy - y3), x3, y3);
        lastQuad = { x: qx, y: qy };
        lastCtrl = null;
        x = x3;
        y = y3;
        break;
      }
      case 'a': {
        const rx = Math.abs(num()), ry = Math.abs(num()), rot = num(), large = num(), sweep = num();
        const x3 = bx + num(), y3 = by + num();
        for (const p of sampleArc(x, y, rx, ry, rot, large !== 0, sweep !== 0, x3, y3, 24)) pts.push(p);
        x = x3;
        y = y3;
        lastCtrl = lastQuad = null;
        break;
      }
    }
  }
  return pts;
}

function sampleArc(x1: number, y1: number, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, x2: number, y2: number, n: number): Pt[] {
  if (rx === 0 || ry === 0) return [{ x: x2, y: y2 }];
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const out: Pt[] = [];
  for (let k = 1; k <= n; k++) {
    const t = t1 + (dt * k) / n;
    out.push({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  }
  return out;
}

/** Andrew's monotone chain; returns the hull counter-clockwise without repeating the first point. */
export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Reduces a convex polygon to at most `max` vertices by dropping the vertex that removes the least area. */
export function simplifyHull(hull: Pt[], max: number): Pt[] {
  const h = [...hull];
  const tri = (a: Pt, b: Pt, c: Pt) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  while (h.length > max) {
    let best = 0;
    let bestArea = Infinity;
    for (let i = 0; i < h.length; i++) {
      const a = tri(h[(i - 1 + h.length) % h.length], h[i], h[(i + 1) % h.length]);
      if (a < bestArea) {
        bestArea = a;
        best = i;
      }
    }
    h.splice(best, 1);
  }
  return h;
}

/** Approximate filled area of path data: sum of signed subpath areas (rings cancel out their holes). */
export function pathArea(d: string): number {
  const subpaths = d.split(/(?=[Mm])/).filter((s) => s.trim());
  let total = 0;
  let x0 = 0;
  let y0 = 0;
  for (const sp of subpaths) {
    // Relative moveto would need the previous end point; Figma exports absolute commands.
    const pts = pathPoints(sp.startsWith('m') ? `M${x0} ${y0}` + sp.slice(1) : sp, 6);
    if (pts.length < 3) continue;
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    total += a / 2;
    x0 = pts[pts.length - 1].x;
    y0 = pts[pts.length - 1].y;
  }
  return Math.abs(total);
}
