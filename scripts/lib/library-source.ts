// Reads one Figma library section (size-L.svg / size-S.svg) and splits it into
// palettes, background frames and object groups. Shared by the extraction
// script and the tests.

import { readFileSync } from 'node:fs';
import { addPoint, convexHull, emptyBox, pathPoints, simplifyHull, unionBox, type Box, type Pt } from './svg-geom';
import { decodeFigmaName, parseXml, walk, type XNode } from './xml';
import type { ObjectId } from '../../src/shared/catalog';
import type { Palette, Role, Size, Variant } from '../../src/shared/types';

export interface SourceObject {
  id: ObjectId;
  variant: Variant;
  sourceName: string;
  node: XNode;
}

export interface SourceFrame {
  name: string;
  node: XNode;
  x: number;
  y: number;
  size: number;
  fill: string;
}

export interface SourceSection {
  file: string;
  size: Size;
  src: string;
  root: XNode;
  palettes: { name: string; colors: Palette }[];
  frames: SourceFrame[];
  objects: SourceObject[];
  unnamed: { sourceName: string; id: ObjectId; variant: Variant }[];
  ignored: string[];
}

/** Named layers → object ids. Figma suffixes repeated names with _2, _3. */
const NAME_TO_ID: Record<string, ObjectId> = {
  Книга: 'book',
  Телефон: 'phone',
  Пазлы: 'puzzle',
  Пазл: 'puzzle',
  Монета: 'coin',
  Наушники: 'headphones',
  Лампа: 'lamp',
  Цветок: 'flower',
  Кошелек: 'wallet',
  Кошелёк: 'wallet',
  Папка: 'folder',
  Ручка: 'pen',
};

/**
 * Unnamed groups («Group 21361363xx») identified by looking at the render and
 * checking position / proportions against the named L counterparts.
 */
export const UNNAMED_GROUPS: Record<Size, Record<string, ObjectId>> = {
  L: {
    'Group 2136136344': 'flower',
    'Group 2136136347': 'flower',
  },
  S: {
    'Group 2136136345': 'flower',
    'Group 2136136346': 'flower',
    'Group 2136136335': 'book',
    'Group 2136136341': 'book',
    'Group 2136136337': 'folder',
    'Group 2136136342': 'folder',
    'Group 2136136336': 'pen',
    'Group 2136136343': 'pen',
  },
};

export function normColor(v: string): string {
  const s = v.trim();
  if (/^white$/i.test(s)) return '#FFFFFF';
  if (/^black$/i.test(s)) return '#000000';
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + [...s.slice(1)].map((c) => c + c).join('')).toUpperCase();
  return s.toUpperCase();
}

function num(v: string | undefined, d = 0): number {
  return v === undefined ? d : parseFloat(v);
}

function translateOf(attr: string | undefined): { tx: number; ty: number } {
  if (!attr) return { tx: 0, ty: 0 };
  const m = /^translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)$/.exec(attr.trim());
  if (!m) throw new Error(`unsupported transform: ${attr}`);
  return { tx: parseFloat(m[1]), ty: parseFloat(m[2]) };
}

/** Points that describe the painted area of an element (strokes are widened by half the stroke width). */
export function elementPoints(n: XNode): Pt[] {
  const sw = n.attrs.stroke && n.attrs.stroke !== 'none' ? num(n.attrs['stroke-width'], 1) / 2 : 0;
  let pts: Pt[] = [];
  switch (n.tag) {
    case 'path':
      pts = pathPoints(n.attrs.d);
      break;
    case 'rect': {
      const { tx, ty } = translateOf(n.attrs.transform);
      const x = num(n.attrs.x) + tx, y = num(n.attrs.y) + ty, w = num(n.attrs.width), h = num(n.attrs.height);
      pts = [{ x, y }, { x: x + w, y }, { x, y: y + h }, { x: x + w, y: y + h }];
      break;
    }
    case 'line':
      pts = [{ x: num(n.attrs.x1), y: num(n.attrs.y1) }, { x: num(n.attrs.x2), y: num(n.attrs.y2) }];
      break;
    case 'circle': {
      const cx = num(n.attrs.cx), cy = num(n.attrs.cy), r = num(n.attrs.r);
      for (let k = 0; k < 16; k++) pts.push({ x: cx + r * Math.cos((k * Math.PI) / 8), y: cy + r * Math.sin((k * Math.PI) / 8) });
      break;
    }
    case 'ellipse': {
      const cx = num(n.attrs.cx), cy = num(n.attrs.cy), rx = num(n.attrs.rx), ry = num(n.attrs.ry);
      for (let k = 0; k < 16; k++) pts.push({ x: cx + rx * Math.cos((k * Math.PI) / 8), y: cy + ry * Math.sin((k * Math.PI) / 8) });
      break;
    }
    case 'g':
      if (n.attrs.transform) throw new Error('transformed groups are not supported');
      return n.children.flatMap(elementPoints);
    default:
      return [];
  }
  if (!sw) return pts;
  return pts.flatMap((p) => [
    { x: p.x - sw, y: p.y - sw },
    { x: p.x + sw, y: p.y + sw },
    { x: p.x - sw, y: p.y + sw },
    { x: p.x + sw, y: p.y - sw },
  ]);
}

export function nodeBox(n: XNode): Box {
  const b = emptyBox();
  for (const p of elementPoints(n)) addPoint(b, p.x, p.y);
  return b;
}

export function nodesBox(nodes: XNode[]): Box {
  return nodes.map(nodeBox).reduce(unionBox, emptyBox());
}

export function footprint(nodes: XNode[], max = 18): Pt[] {
  const pts = nodes.flatMap(elementPoints);
  return simplifyHull(convexHull(pts), max);
}

export function readSection(file: string, size: Size): SourceSection {
  const src = readFileSync(file, 'utf8');
  const root = parseXml(src);
  const svg = root.children.find((c) => c.tag === 'svg');
  if (!svg) throw new Error(`${file}: no <svg>`);
  const section = svg.children.find((c) => c.tag === 'g');
  if (!section) throw new Error(`${file}: no section group`);

  // Heading «Фоновые объекты» (outlined text) separates main and background variants.
  const heading = section.children.find((c) => c.tag === 'path' && decodeFigmaName(c.attrs.id ?? '') === 'Фоновые объекты');
  if (!heading) throw new Error(`${file}: heading «Фоновые объекты» not found`);
  const splitY = nodeBox(heading).minY;

  const palettes: SourceSection['palettes'] = [];
  const frames: SourceFrame[] = [];
  const objects: SourceObject[] = [];
  const unnamed: SourceSection['unnamed'] = [];
  const ignored: string[] = [];

  for (const g of section.children) {
    if (g.tag !== 'g') continue;
    const name = decodeFigmaName(g.attrs.id ?? '');
    const base = name.replace(/_\d+$/, '');
    const rects = g.children.filter((c) => c.tag === 'rect');
    if (g.children.length === 8 && rects.length === 8) {
      palettes.push({ name, colors: readPalette(rects) });
      continue;
    }
    if (base === 'Фон') {
      const rect = g.children.find((c) => c.tag === 'rect')!;
      const { tx, ty } = translateOf(rect.attrs.transform);
      frames.push({ name, node: g, x: tx + num(rect.attrs.x), y: ty + num(rect.attrs.y), size: num(rect.attrs.width), fill: normColor(rect.attrs.fill) });
      continue;
    }
    const box = nodeBox(g);
    const variant: Variant = box.minY > splitY ? 'background' : 'main';
    let id: ObjectId | undefined = NAME_TO_ID[base];
    if (!id) {
      id = UNNAMED_GROUPS[size][name];
      if (id) unnamed.push({ sourceName: name, id, variant });
    }
    if (!id) {
      ignored.push(name);
      continue;
    }
    objects.push({ id, variant, sourceName: name, node: g });
  }
  palettes.sort((a, b) => nodeBoxOfPalette(section, a.name) - nodeBoxOfPalette(section, b.name));
  return { file, size, src, root, palettes, frames, objects, unnamed, ignored };
}

function nodeBoxOfPalette(section: XNode, name: string): number {
  const g = section.children.find((c) => c.tag === 'g' && decodeFigmaName(c.attrs.id ?? '') === name)!;
  return nodeBox(g).minX;
}

/** 2×4 swatch: left column = background colours, right column = object colours, top to bottom. */
function readPalette(rects: XNode[]): Palette {
  const cells = rects.map((r) => ({ x: num(r.attrs.x), y: num(r.attrs.y), fill: normColor(r.attrs.fill) }));
  const xs = cells.map((c) => c.x);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const left = cells.filter((c) => c.x < midX).sort((a, b) => a.y - b.y);
  const right = cells.filter((c) => c.x >= midX).sort((a, b) => a.y - b.y);
  if (left.length !== 4 || right.length !== 4) throw new Error('palette swatch is not 2×4');
  const roles: Role[] = ['bgLight', 'bgMid', 'bgDark', 'ink', 'accent1', 'accent2', 'accent3', 'paper'];
  const colors = [...left, ...right].map((c) => c.fill);
  return Object.fromEntries(roles.map((r, i) => [r, colors[i]])) as Palette;
}

/** Collects every colour attribute used inside a node. */
export function colorsUsed(n: XNode): Set<string> {
  const out = new Set<string>();
  for (const e of [n, ...walk(n)]) {
    for (const k of ['fill', 'stroke']) {
      const v = e.attrs[k];
      if (v && v !== 'none' && !v.startsWith('url(')) out.add(normColor(v));
    }
  }
  return out;
}

/** Source markup between the group's opening and closing tags. */
export function innerMarkup(src: string, n: XNode): string {
  return src.slice(n.openEnd, n.closeStart);
}

/**
 * Turns source markup into library markup: layer ids are dropped (they would
 * collide when an object is used twice) and every fill/stroke colour becomes a
 * `var(--role)` token. Nothing else is touched.
 */
export function tokenizeMarkup(markup: string, colorToRole: Map<string, Role>): { markup: string; roles: Role[] } {
  const used = new Set<Role>();
  const out = markup
    .replace(/ id="[^"]*"/g, '')
    .replace(/ (fill|stroke)="([^"]*)"/g, (whole, attr: string, value: string) => {
      if (value === 'none' || value.startsWith('url(')) return whole;
      const role = colorToRole.get(normColor(value));
      if (!role) throw new Error(`colour ${value} is not in the palette`);
      used.add(role);
      return ` ${attr}="var(--${role})"`;
    });
  return { markup: out, roles: [...used] };
}

export function stripIds(markup: string): string {
  return markup.replace(/ id="[^"]*"/g, '');
}
