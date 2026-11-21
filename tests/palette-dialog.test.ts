import { describe, expect, it } from 'vitest';
import { SWATCH_NAMES } from '../src/client/components/PaletteDialog';
import { DEFAULT_SCHEME, conflictingRoles, parsePalette } from '../src/shared/palette';
import { ROLES } from '../src/shared/types';

describe('palette dialog helpers', () => {
  it('every role has a short human name', () => {
    expect(ROLES.map((r) => SWATCH_NAMES[r])).toEqual(['Фон', 'Фон 2', 'Фон 3', 'Контур', 'Акцент 1', 'Акцент 2', 'Акцент 3', 'Белый']);
  });

  it('marks the object colour that equals a background colour, case-insensitively', () => {
    const p = { ...DEFAULT_SCHEME.colors };
    expect(conflictingRoles(p)).toEqual([]);
    const bad = { ...p, accent2: p.bgMid.toLowerCase() };
    expect(conflictingRoles(bad)).toEqual(['accent2']);
  });

  it('hex text is read without rejecting a conflict, so the swatch can show the warning', () => {
    const t = '#E3F0D0 #B9DC8F #5E9E3A #181817 #E3F0D0 #FF9F80 #FFE6DB #FFFFFF';
    expect(parsePalette(t).error).toMatch(/совпадает/);
    const loose = parsePalette(t, undefined, { validate: false });
    expect(loose.palette?.accent1).toBe('#E3F0D0');
    expect(conflictingRoles(loose.palette!)).toEqual(['accent1']);
  });
});
