// Splits the Figma library sections into reusable fragments.
//
//   npm run extract
//
// Inputs:  assets/source/size-L.svg, assets/source/size-S.svg
// Outputs: src/library/generated/manifest.json      — metadata for every object × variant × size
//          src/library/generated/library-{L,S}.json — role-tokenised markup used by the app
//          library/svg/{L,S}/{main,background}/*.svg — standalone SVG per fragment (original colours)

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG, OBJECT_IDS, type ObjectId } from '../src/shared/catalog';
import {
  BG_ROLES,
  ROLES,
  type Corner,
  type DecorElement,
  type DecorStyle,
  type Format,
  type Fragment,
  type LibraryData,
  type Manifest,
  type ManifestEntry,
  type Palette,
  type Role,
  type Scheme,
  type Size,
  type Variant,
} from '../src/shared/types';
import { colorsUsed, footprint, innerMarkup, nodeBox, nodesBox, readSection, tokenizeMarkup, type SourceSection } from './lib/library-source';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES: Record<Size, string> = {
  L: join(ROOT, 'assets/source/size-L.svg'),
  S: join(ROOT, 'assets/source/size-S.svg'),
};
const OUT_GEN = join(ROOT, 'src/library/generated');
const OUT_SVG = join(ROOT, 'library/svg');

const SCHEME_NAMES = [
  { id: 'lilac', nameRu: 'Сиреневая' },
  { id: 'peach', nameRu: 'Персиковая' },
  { id: 'teal', nameRu: 'Бирюзовая' },
];

/** Frame proportions taken from the reference compositions (examples.svg): 1000×1000, 1200×630, 800×1200 for L. */
const FRAMES_L: Record<Format, { w: number; h: number }> = {
  square: { w: 1000, h: 1000 },
  horizontal: { w: 1200, h: 630 },
  vertical: { w: 800, h: 1200 },
};

const round = (v: number, p = 3) => Math.round(v * 10 ** p) / 10 ** p;

function inverse(p: Palette): Map<string, Role> {
  const m = new Map<string, Role>();
  for (const r of ROLES) {
    if (m.has(p[r])) throw new Error(`palette colour ${p[r]} is used by two roles`);
    m.set(p[r], r);
  }
  return m;
}

function makeFragment(sec: SourceSection, nodes: import('./lib/xml').XNode[], colorToRole: Map<string, Role>, raw: string): Fragment {
  const box = nodesBox(nodes);
  const hull = footprint(nodes).map((p) => ({ x: round(p.x - box.minX, 1), y: round(p.y - box.minY, 1) }));
  const { markup, roles } = tokenizeMarkup(raw, colorToRole);
  void sec;
  return {
    markup,
    x: round(box.minX),
    y: round(box.minY),
    w: round(box.maxX - box.minX),
    h: round(box.maxY - box.minY),
    hull,
    roles: ROLES.filter((r) => roles.includes(r)),
  };
}

function standaloneSvg(raw: string, f: Fragment): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f.w}" height="${f.h}" viewBox="${f.x} ${f.y} ${f.w} ${f.h}" fill="none">${raw}</svg>\n`;
}

function extractDecor(sec: SourceSection, schemes: Scheme[]): DecorStyle[] {
  const styles: DecorStyle[] = [];
  const wanted: { id: DecorStyle['id']; scheme: string }[] = [
    { id: 'confetti', scheme: 'lilac' },
    { id: 'wedge', scheme: 'peach' },
  ];
  for (const w of wanted) {
    const scheme = schemes.find((s) => s.id === w.scheme)!;
    const frame = sec.frames.find((f) => f.fill === scheme.colors.bgLight);
    if (!frame) throw new Error(`${sec.size}: no background swatch for ${w.scheme}`);
    const map = inverse(scheme.colors);
    const elements: DecorElement[] = [];
    // A decoration group that spans half the frame (the confetti: one dot at the top,
    // one cluster at the bottom) is split into its parts so each part keeps its own corner.
    const parts = frame.node.children.flatMap((c) => {
      if (c.tag !== 'g') return [c];
      const b = nodeBox(c);
      return b.maxY - b.minY > frame.size / 2 || b.maxX - b.minX > frame.size / 2 ? c.children : [c];
    });
    for (const child of parts) {
      if (child.tag === 'rect') continue;
      const name = child.attrs.id ? decodeName(child.attrs.id) : child.tag;
      const raw = sec.src.slice(child.start, child.end);
      const fragment = makeFragment(sec, [child], map, raw);
      for (const r of fragment.roles) {
        if (!BG_ROLES.includes(r as never) && r !== 'paper') throw new Error(`decor ${name} uses object colour ${r}`);
      }
      const cx = fragment.x + fragment.w / 2 - frame.x;
      const cy = fragment.y + fragment.h / 2 - frame.y;
      const corner = ((cy < frame.size / 2 ? 't' : 'b') + (cx < frame.size / 2 ? 'l' : 'r')) as Corner;
      const ox = corner.endsWith('l') ? frame.x : frame.x + frame.size;
      const oy = corner.startsWith('t') ? frame.y : frame.y + frame.size;
      elements.push({ name, fragment, corner, dx: round(fragment.x - ox), dy: round(fragment.y - oy) });
    }
    styles.push({ id: w.id, frame: frame.size, elements });
  }
  return styles;
}

function decodeName(raw: string): string {
  const latin1 = raw.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return new TextDecoder().decode(Uint8Array.from(latin1, (c) => c.charCodeAt(0) & 0xff));
}

function main() {
  const manifest: Manifest = { generatedFrom: [], schemes: [], roles: [], frames: {} as Manifest['frames'], entries: [] };
  rmSync(OUT_SVG, { recursive: true, force: true });
  mkdirSync(OUT_GEN, { recursive: true });
  const report: string[] = [];

  for (const size of ['L', 'S'] as Size[]) {
    const sec = readSection(SOURCES[size], size);
    manifest.generatedFrom.push(`assets/source/size-${size}.svg`);
    if (sec.palettes.length !== 3) throw new Error(`${size}: expected 3 palettes, got ${sec.palettes.length}`);
    const schemes: Scheme[] = sec.palettes.map((p, i) => ({ ...SCHEME_NAMES[i], colors: p.colors }));
    if (size === 'L') {
      manifest.schemes = schemes;
      manifest.roles = ROLES.map((r) => ({ id: r, group: BG_ROLES.includes(r as never) ? 'background' : 'object', lilac: schemes[0].colors[r] }));
    } else if (JSON.stringify(schemes) !== JSON.stringify(manifest.schemes)) {
      throw new Error('S and L palettes differ');
    }
    const lilac = inverse(schemes[0].colors);
    const frameScale = sec.frames[0].size / 1000; // L swatch is 1000, S swatch is 500
    const frames = Object.fromEntries(
      Object.entries(FRAMES_L).map(([k, v]) => [k, { w: v.w * frameScale, h: v.h * frameScale }]),
    ) as Record<Format, { w: number; h: number }>;
    manifest.frames[size] = frames;

    const objects = {} as LibraryData['objects'];
    for (const o of sec.objects) {
      const raw = innerMarkup(sec.src, o.node);
      const used = colorsUsed(o.node);
      for (const c of used) if (!lilac.has(c)) throw new Error(`${size} ${o.sourceName}: colour ${c} outside the lilac palette`);
      const fragment = makeFragment(sec, [o.node], lilac, raw);
      if (o.variant === 'background') {
        const bad = fragment.roles.filter((r) => !BG_ROLES.includes(r as never));
        if (bad.length) throw new Error(`${size} ${o.sourceName}: background variant uses object colours ${bad.join(',')}`);
      }
      objects[o.id] ??= {} as Record<Variant, Fragment>;
      if (objects[o.id][o.variant]) throw new Error(`${size}: duplicate ${o.id}/${o.variant}`);
      objects[o.id][o.variant] = fragment;

      const rel = `library/svg/${size}/${o.variant}/${o.id}.svg`;
      mkdirSync(join(ROOT, dirname(rel)), { recursive: true });
      writeFileSync(join(ROOT, rel), standaloneSvg(raw, fragment));
      const cat = CATALOG.find((c) => c.id === o.id)!;
      const entry: ManifestEntry = {
        key: `${o.id}.${o.variant}.${size}`,
        id: o.id,
        nameRu: cat.nameRu,
        nameEn: cat.nameEn,
        synonyms: cat.synonyms,
        tags: cat.tags,
        variant: o.variant,
        size,
        width: fragment.w,
        height: fragment.h,
        sourceName: o.sourceName,
        file: rel,
        roles: fragment.roles,
      };
      manifest.entries.push(entry);
    }
    for (const id of OBJECT_IDS) {
      for (const v of ['main', 'background'] as Variant[]) {
        if (!objects[id]?.[v]) throw new Error(`${size}: missing ${id}/${v}`);
      }
    }
    const decor = extractDecor(sec, schemes);
    const lib: LibraryData = { size, frames, objects, decor };
    writeFileSync(join(OUT_GEN, `library-${size}.json`), JSON.stringify(lib));

    report.push(`${size}: ${sec.objects.length} fragments, ${decor.reduce((n, d) => n + d.elements.length, 0)} decor elements`);
    for (const u of sec.unnamed) report.push(`  unnamed ${u.sourceName} → ${u.id} (${u.variant})`);
    if (sec.ignored.length) report.push(`  ignored groups: ${sec.ignored.join(', ')}`);
  }
  manifest.entries.sort((a, b) => a.key.localeCompare(b.key));
  writeFileSync(join(OUT_GEN, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(report.join('\n'));
  console.log(`manifest: ${manifest.entries.length} entries, ${manifest.schemes.length} schemes`);
}

main();

export type { ObjectId };
