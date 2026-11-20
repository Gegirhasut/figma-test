import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEME, parsePalette, tintPalette, validatePalette } from '../src/shared/palette';

describe('custom palettes', () => {
  it('reads 8 hex colours in swatch order', () => {
    const r = parsePalette('#e3f0d0, #B9DC8F; #5E9E3A #181817 #FFE08A #FF9F80 #FFE6DB #fff');
    expect(r.error).toBeUndefined();
    expect(r.palette).toEqual({
      bgLight: '#E3F0D0',
      bgMid: '#B9DC8F',
      bgDark: '#5E9E3A',
      ink: '#181817',
      accent1: '#FFE08A',
      accent2: '#FF9F80',
      accent3: '#FFE6DB',
      paper: '#FFFFFF',
    });
  });

  it('reads 6 colours and keeps contour and white', () => {
    const r = parsePalette('["#E3F0D0","#B9DC8F","#5E9E3A","#FFE08A","#FF9F80","#FFE6DB"]');
    expect(r.palette?.ink).toBe(DEFAULT_SCHEME.colors.ink);
    expect(r.palette?.paper).toBe('#FFFFFF');
    expect(r.palette?.accent2).toBe('#FF9F80');
  });

  it('reads JSON with roles (partial is fine)', () => {
    const r = parsePalette(JSON.stringify({ name: 'mint', colors: { bgLight: '#DDF5EE', accent1: '#FFD166' } }));
    expect(r.palette?.bgLight).toBe('#DDF5EE');
    expect(r.palette?.accent1).toBe('#FFD166');
    expect(r.palette?.bgDark).toBe(DEFAULT_SCHEME.colors.bgDark);
  });

  it('rejects a palette that would put object colours into the background', () => {
    const r = parsePalette('#E3F0D0 #B9DC8F #5E9E3A #181817 #E3F0D0 #FF9F80 #FFE6DB #FFFFFF');
    expect(r.palette).toBeUndefined();
    expect(r.error).toMatch(/совпадает/);
    expect(validatePalette(DEFAULT_SCHEME.colors)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(parsePalette('').error).toBeTruthy();
    expect(parsePalette('#123456 #abcdef').error).toMatch(/6 или 8/);
    expect(parsePalette('{oops').error).toBeTruthy();
  });

  it('tints permute colours inside the scheme', () => {
    const p = DEFAULT_SCHEME.colors;
    const t = tintPalette(p, 1);
    expect(t.bgLight).toBe(p.accent1);
    expect(new Set(Object.values(t))).toEqual(new Set(Object.values(p)));
    expect(tintPalette(p, 3)).toEqual(p);
  });
});
