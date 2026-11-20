import { describe, expect, it } from 'vitest';
import { parseXml, walk } from '../scripts/lib/xml';
import { layoutScene } from '../src/shared/layout';
import { loadLibrary } from '../src/shared/library-fs';
import { parsePalette, SCHEMES } from '../src/shared/palette';
import { sceneToSvg } from '../src/shared/render';
import type { ObjectRequest } from '../src/shared/types';

const objects: ObjectRequest[] = [
  { id: 'wallet', role: 'main' },
  { id: 'coin', role: 'main' },
  { id: 'coin', role: 'main' },
  { id: 'lamp', role: 'background' },
];

describe('SVG export', () => {
  const lib = loadLibrary('L');
  const scene = layoutScene({ objects, format: 'square', size: 'L' }, lib);
  scene.items[1] = { ...scene.items[1], rotation: 30 };
  const palette = SCHEMES[1].colors;
  const svg = sceneToSvg(scene, lib, palette, { title: 'тест <&>' });
  const root = parseXml(svg);
  const svgEl = root.children[0];

  it('is well-formed standalone SVG with a viewBox of the frame', () => {
    expect(svgEl.tag).toBe('svg');
    expect(svgEl.attrs.xmlns).toBe('http://www.w3.org/2000/svg');
    expect(svgEl.attrs.viewBox).toBe('0 0 1000 1000');
    expect(svgEl.attrs.width).toBe('1000');
  });

  it('has no CSS variables, styles, raster or foreignObject', () => {
    expect(svg).not.toMatch(/var\(--/);
    expect(svg).not.toMatch(/<image|<foreignObject|<style|style="|data:image|<script/i);
  });

  it('every object is its own named group with a transform and real paths', () => {
    const scene_g = [...walk(svgEl)].find((n) => n.attrs.id === 'Иллюстрация')!;
    const objectGroups = scene_g.children.filter((n) => n.tag === 'g' && n.attrs.id !== 'Фон');
    expect(objectGroups).toHaveLength(objects.length);
    for (const g of objectGroups) {
      expect(g.attrs.transform).toMatch(/^translate\([^)]+\)( rotate\([^)]+\))? scale\([^)]+\) translate\([^)]+\)$/);
      expect([...walk(g)].some((n) => n.tag === 'path' && n.attrs.d)).toBe(true);
    }
    expect(objectGroups.map((g) => g.attrs.id)).toEqual(expect.arrayContaining(['Кошелёк', 'Монета', 'Монета_2', 'Лампа_фон']));
    expect(objectGroups.some((g) => g.attrs.transform.includes('rotate(30)'))).toBe(true);
  });

  it('uses one scale for all objects', () => {
    const scales = new Set([...svg.matchAll(/scale\(([\d.]+)\)/g)].map((m) => m[1]));
    expect(scales.size).toBe(1);
  });

  it('ids are unique', () => {
    const ids = [...walk(svgEl)].map((n) => n.attrs.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every colour is a resolved palette colour', () => {
    const allowed = new Set(Object.values(palette));
    for (const n of walk(svgEl)) {
      for (const a of ['fill', 'stroke']) {
        const v = n.attrs[a];
        if (!v || v === 'none' || v.startsWith('url(')) continue;
        expect(allowed, `${n.tag} ${a}=${v}`).toContain(v);
      }
    }
  });

  it('escapes the title', () => {
    expect(svg).toContain('<title>тест &lt;&amp;></title>');
  });

  it('recolours through roles with a custom palette', () => {
    const p = parsePalette('#E3F0D0 #B9DC8F #5E9E3A #181817 #FFE08A #FF9F80 #FFE6DB #FFFFFF').palette!;
    const out = sceneToSvg(scene, lib, p);
    expect(out).toContain('#E3F0D0');
    expect(out).not.toContain(palette.bgLight);
    const colors = new Set([...out.matchAll(/(?:fill|stroke)="(#[0-9A-F]{6})"/g)].map((m) => m[1]));
    for (const c of colors) expect(Object.values(p)).toContain(c);
  });
});
