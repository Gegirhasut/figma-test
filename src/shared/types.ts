import type { ObjectId } from './catalog';

/** Colour roles of the palette. The swatch in Figma has two columns of four. */
export type BgRole = 'bgLight' | 'bgMid' | 'bgDark' | 'ink';
export type ObjRole = 'accent1' | 'accent2' | 'accent3' | 'paper';
export type Role = BgRole | ObjRole;

export const BG_ROLES: BgRole[] = ['bgLight', 'bgMid', 'bgDark', 'ink'];
export const OBJ_ROLES: ObjRole[] = ['accent1', 'accent2', 'accent3', 'paper'];
export const ROLES: Role[] = [...BG_ROLES, ...OBJ_ROLES];

export type Palette = Record<Role, string>;

export interface Scheme {
  id: string;
  nameRu: string;
  colors: Palette;
}

export type Size = 'L' | 'S';
export type Variant = 'main' | 'background';
export type Format = 'square' | 'horizontal' | 'vertical';

export interface Pt {
  x: number;
  y: number;
}

/** One extracted piece of artwork: an object variant or a background decoration. */
export interface Fragment {
  /** Inner SVG markup (paths in original Figma coordinates); colours are `var(--role)` tokens. */
  markup: string;
  /** Tight bounding box in source units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Convex footprint, relative to (x, y). */
  hull: Pt[];
  /**
   * Convex footprint of the object's own body without its cast shadow,
   * relative to (x, y). Its lowest point is where the object stands on the
   * common ground plane, which decides depth (see layout.ts).
   */
  body: Pt[];
  /** Roles used by the markup. */
  roles: Role[];
  /** Approximate share of the painted area per fill role. */
  roleShare: Partial<Record<Role, number>>;
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

export interface DecorElement {
  name: string;
  fragment: Fragment;
  /** Corner of the frame the element is pinned to and its offset from it (source units). */
  corner: Corner;
  dx: number;
  dy: number;
}

export interface DecorStyle {
  id: 'confetti' | 'wedge';
  /** Side of the reference square frame the decoration was drawn for. */
  frame: number;
  elements: DecorElement[];
}

export interface LibraryData {
  size: Size;
  /** Frame sizes in source units for this level of detail. */
  frames: Record<Format, { w: number; h: number }>;
  objects: Record<ObjectId, Record<Variant, Fragment>>;
  decor: DecorStyle[];
}

export interface ManifestEntry {
  key: string;
  id: ObjectId;
  nameRu: string;
  nameEn: string;
  synonyms: string[];
  tags: string[];
  variant: Variant;
  size: Size;
  width: number;
  height: number;
  sourceName: string;
  file: string;
  roles: Role[];
}

export interface Manifest {
  generatedFrom: string[];
  schemes: Scheme[];
  roles: { id: Role; group: 'background' | 'object'; lilac: string }[];
  frames: Record<Size, Record<Format, { w: number; h: number }>>;
  entries: ManifestEntry[];
}

// ---------- scenes ----------

export interface SceneItem {
  uid: string;
  id: ObjectId;
  role: Variant;
  /** Centre of the object in frame units. */
  x: number;
  y: number;
  rotation: number;
  /** Index into the colour variants of a main object (0 = as drawn). */
  tint: number;
}

export interface Scene {
  format: Format;
  size: Size;
  width: number;
  height: number;
  /** Uniform scale applied to every object. */
  scale: number;
  decor: DecorStyle['id'];
  /** Items in paint order (first = back). */
  items: SceneItem[];
}

export interface ObjectRequest {
  id: ObjectId;
  role: Variant;
}
