// Scene → SVG. Used both for the export file and for the in-page canvas, so
// what the user sees is exactly what they download.

import { CATALOG_BY_ID } from './catalog';
import { resolveMarkup, tintPalette } from './palette';
import { type DecorStyle, type Fragment, type LibraryData, type Palette, type Role, type Scene, type SceneItem } from './types';

export function itemFragment(item: SceneItem, lib: LibraryData): Fragment {
  return lib.objects[item.id][item.role];
}

/** Palette an item is painted with: main objects may use a tint, background objects never. */
export function itemPalette(item: SceneItem, palette: Palette): Palette {
  return item.role === 'main' ? tintPalette(palette, item.tint) : palette;
}

export function itemTransform(item: SceneItem, f: Fragment, scale: number): string {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  const parts = [`translate(${n(item.x)} ${n(item.y)})`];
  if (item.rotation) parts.push(`rotate(${n(item.rotation)})`);
  parts.push(`scale(${n(scale)})`, `translate(${n(-cx)} ${n(-cy)})`);
  return parts.join(' ');
}

export function itemMarkup(item: SceneItem, lib: LibraryData, palette: Palette): string {
  return resolveMarkup(itemFragment(item, lib).markup, itemPalette(item, palette));
}

export interface DecorPlacement {
  name: string;
  tx: number;
  ty: number;
  fragment: Fragment;
}

/** Background decoration pinned to the frame corners it was drawn at in the swatch. */
export function decorPlacements(style: DecorStyle, w: number, h: number): DecorPlacement[] {
  return style.elements.map((e) => {
    const ox = e.corner.endsWith('l') ? 0 : w;
    const oy = e.corner.startsWith('t') ? 0 : h;
    return { name: e.name, tx: ox + e.dx - e.fragment.x, ty: oy + e.dy - e.fragment.y, fragment: e.fragment };
  });
}

export function decorStyle(lib: LibraryData, id: DecorStyle['id']): DecorStyle {
  return lib.decor.find((d) => d.id === id) ?? lib.decor[0];
}

export function objectLabel(item: SceneItem): string {
  const name = CATALOG_BY_ID[item.id].nameRu;
  return name[0].toUpperCase() + name.slice(1) + (item.role === 'background' ? ' (фон)' : '');
}

function xmlId(s: string): string {
  return s.replace(/[\s()·]+/g, '_').replace(/_+$/, '').replace(/^(\d)/, '_$1');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/**
 * Standalone SVG: every object is its own named <g> with a transform and its
 * original paths; colours are resolved hex values; no CSS, no raster, no
 * foreignObject. Opens in Figma as editable layers.
 */
export function sceneToSvg(scene: Scene, lib: LibraryData, palette: Palette, opts: { title?: string } = {}): string {
  const { width: w, height: h } = scene;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}" fill="none">`);
  if (opts.title) out.push(`<title>${esc(opts.title)}</title>`);
  out.push(`<defs><clipPath id="frame-clip"><rect width="${n(w)}" height="${n(h)}"/></clipPath></defs>`);
  out.push(`<g id="Иллюстрация" clip-path="url(#frame-clip)">`);
  out.push(`<g id="Фон">`);
  out.push(`<rect id="Фон_заливка" width="${n(w)}" height="${n(h)}" fill="${palette.bgLight}"/>`);
  for (const d of decorPlacements(decorStyle(lib, scene.decor), w, h)) {
    out.push(`<g id="${esc(xmlId('Фон_' + d.name))}" transform="translate(${n(d.tx)} ${n(d.ty)})">${resolveMarkup(d.fragment.markup, palette)}</g>`);
  }
  out.push(`</g>`);
  const used = new Map<string, number>();
  for (const item of scene.items) {
    const f = itemFragment(item, lib);
    let id = xmlId(objectLabel(item));
    const k = (used.get(id) ?? 0) + 1;
    used.set(id, k);
    if (k > 1) id += `_${k}`;
    out.push(`<g id="${esc(id)}" transform="${itemTransform(item, f, scene.scale)}">${itemMarkup(item, lib, palette)}</g>`);
  }
  out.push(`</g></svg>`);
  return out.join('\n') + '\n';
}

/** Colours actually painted by each layer — used to check the scheme rules. */
export function sceneColorUsage(scene: Scene, lib: LibraryData, palette: Palette): { background: Set<string>; mainObjects: Set<string>; backgroundObjects: Set<string> } {
  const grab = (markup: string, p: Palette, into: Set<string>) => {
    for (const m of markup.matchAll(/var\(--(\w+)\)/g)) into.add(p[m[1] as Role]);
  };
  const background = new Set<string>([palette.bgLight]);
  for (const d of decorStyle(lib, scene.decor).elements) grab(d.fragment.markup, palette, background);
  const mainObjects = new Set<string>();
  const backgroundObjects = new Set<string>();
  for (const it of scene.items) {
    grab(itemFragment(it, lib).markup, itemPalette(it, palette), it.role === 'main' ? mainObjects : backgroundObjects);
  }
  return { background, mainObjects, backgroundObjects };
}

function n(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}
