// Palettes and colour roles. Every colour in the library markup is a role token;
// a palette maps roles to hex values. Recolouring = swapping the palette.

import manifestJson from '../library/generated/manifest.json';
import { BG_ROLES, OBJ_ROLES, ROLES, type Manifest, type Palette, type Role, type Scheme } from './types';

const manifest = manifestJson as unknown as Manifest;

export const SCHEMES: Scheme[] = manifest.schemes;
export const DEFAULT_SCHEME = SCHEMES[0];

export const ROLE_LABELS: Record<Role, string> = {
  bgLight: 'Фон, светлый',
  bgMid: 'Фон, средний',
  bgDark: 'Фон, тёмный',
  ink: 'Контур',
  accent1: 'Акцент 1',
  accent2: 'Акцент 2',
  accent3: 'Акцент 3',
  paper: 'Белый',
};

/**
 * Colour variants of a main object («цвета объекта можно менять»): roles are
 * permuted inside the scheme, so the result still uses only scheme colours.
 * Background variants are never tinted.
 */
export const TINTS: Partial<Record<Role, Role>>[] = [
  {},
  { bgLight: 'accent1', accent1: 'accent2', accent2: 'bgLight' },
  { bgLight: 'accent2', accent2: 'accent1', accent1: 'bgLight' },
];

export function tintPalette(p: Palette, tint: number): Palette {
  const t = TINTS[((tint % TINTS.length) + TINTS.length) % TINTS.length];
  const out = { ...p };
  for (const [from, to] of Object.entries(t) as [Role, Role][]) out[from] = p[to];
  return out;
}

export function paletteKey(p: Palette): string {
  return ROLES.map((r) => p[r]).join('');
}

const HEX_RE = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;

function normHex(h: string): string {
  const s = h.trim().toUpperCase();
  if (s.length === 4) return '#' + [...s.slice(1)].map((c) => c + c).join('');
  return s;
}

export interface PaletteParseResult {
  palette?: Palette;
  error?: string;
}

/**
 * Accepts either JSON (an object keyed by role, or an array of hex strings) or
 * any text with hex colours. Order for lists: the Figma swatch order —
 * background column top→bottom (light, mid, dark, contour), then object column
 * top→bottom (accent 1, accent 2, accent 3, white). With 6 colours the contour
 * and white keep their default values.
 */
export function parsePalette(text: string, base: Palette = DEFAULT_SCHEME.colors, opts: { validate?: boolean } = {}): PaletteParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { error: 'Пустая палитра' };
  let list: string[] | null = null;
  let obj: Partial<Palette> | null = null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed) as unknown;
      if (Array.isArray(data)) list = data.map(String);
      else if (data && typeof data === 'object') {
        const rec = data as Record<string, unknown>;
        const colors = (rec.colors && typeof rec.colors === 'object' ? rec.colors : rec) as Record<string, unknown>;
        if (Array.isArray(colors)) list = colors.map(String);
        else {
          obj = {};
          for (const r of ROLES) if (typeof colors[r] === 'string') obj[r] = colors[r] as string;
        }
      }
    } catch {
      return { error: 'Не удалось прочитать JSON' };
    }
  } else {
    list = trimmed.match(HEX_RE) ?? [];
  }
  let palette: Palette;
  if (list) {
    const hexes = list.map((s) => (s.match(HEX_RE) ?? [])[0]).filter(Boolean) as string[];
    if (hexes.length === 8) {
      palette = Object.fromEntries(ROLES.map((r, i) => [r, normHex(hexes[i])])) as Palette;
    } else if (hexes.length === 6) {
      const [l, m, d, a1, a2, a3] = hexes.map(normHex);
      palette = { ...base, bgLight: l, bgMid: m, bgDark: d, accent1: a1, accent2: a2, accent3: a3 };
    } else {
      return { error: `Нужно 6 или 8 цветов, найдено ${hexes.length}` };
    }
  } else if (obj) {
    const missing = ROLES.filter((r) => !obj![r]);
    if (missing.length === ROLES.length) return { error: 'В JSON нет ни одной роли палитры' };
    palette = { ...base };
    for (const r of ROLES) if (obj[r]) {
      const hex = (obj[r]!.match(HEX_RE) ?? [])[0];
      if (!hex) return { error: `Роль ${r}: не цвет` };
      palette[r] = normHex(hex);
    }
  } else {
    return { error: 'Не удалось прочитать палитру' };
  }
  const err = opts.validate === false ? null : validatePalette(palette);
  return err ? { error: err } : { palette };
}

/** Object roles whose colour equals a background colour (forbidden by the scheme rules). */
export function conflictingRoles(p: Palette): Role[] {
  return OBJ_ROLES.filter((o) => BG_ROLES.some((b) => p[o].toUpperCase() === p[b].toUpperCase()));
}

/**
 * Scheme rule: background colours may appear in objects, object colours may not
 * appear in backgrounds. With role-based colouring this holds as long as no
 * object colour is equal to a background colour.
 */
export function validatePalette(p: Palette): string | null {
  for (const o of OBJ_ROLES) {
    for (const b of BG_ROLES) {
      if (p[o] === p[b]) return `Цвет объектов ${p[o]} совпадает с цветом фона — так схема нарушится`;
    }
  }
  return null;
}

export function resolveMarkup(markup: string, p: Palette): string {
  return markup.replace(/var\(--(\w+)\)/g, (_, role: string) => {
    const v = p[role as Role];
    if (!v) throw new Error(`unknown role ${role}`);
    return v;
  });
}
