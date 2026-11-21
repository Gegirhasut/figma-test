import { describe, expect, it } from 'vitest';
import { layoutScene } from '../src/shared/layout';
import { loadLibrary } from '../src/shared/library-fs';
import { MAX_SAME_OBJECT, SAME_OBJECT_LIMIT_TEXT, addBlocker, clearScene, switchSize, upperHalfVisible, addObject, countOf, itemBase, removeLatest, visibleShare, roleForNew } from '../src/shared/place';
import type { ObjectRequest, Scene } from '../src/shared/types';

const lib = loadLibrary('L');
const scene = (objects: ObjectRequest[], format: Scene['format'] = 'horizontal'): Scene => {
  const s = layoutScene({ objects, format, size: 'L', variant: 2 }, lib, 'u');
  return { ...s, items: s.items.map((it, i) => ({ ...it, uid: `u${i + 1}` })) };
};
const book = scene([
  { id: 'book', role: 'main' },
  { id: 'lamp', role: 'main' },
  { id: 'flower', role: 'background' },
]);
let uid = 100;
const add = (s: Scene, id: ObjectRequest['id'], at?: { x: number; y: number }) => addObject(s, lib, { uid: `u${++uid}`, id, tint: 0 }, at);

describe('adding an object keeps the scene', () => {
  it('existing objects do not move, also after the user moved and rotated one', () => {
    const moved: Scene = { ...book, items: book.items.map((it, i) => (i === 0 ? { ...it, x: it.x + 40, y: it.y - 30, rotation: 15 } : it)) };
    let s: Scene = moved;
    for (const id of ['phone', 'phone', 'phone', 'coin'] as const) s = add(s, id)!;
    expect(s.scale).toBe(moved.scale);
    for (const before of moved.items) expect(s.items.find((i) => i.uid === before.uid)).toEqual(before);
    expect(s.items).toHaveLength(moved.items.length + 4);
  });

  it('the added object is never cropped by the frame, on a click or a drop at the edge', () => {
    for (const format of ['horizontal', 'square', 'vertical'] as const) {
      let s = scene([{ id: 'wallet', role: 'main' }, { id: 'coin', role: 'main' }], format);
      for (const id of ['phone', 'phone', 'phone', 'headphones'] as const) {
        s = add(s, id)!;
        expect(visibleShare(s.items.find((i) => i.uid === `u${uid}`)!, lib, s)).toBeGreaterThan(0.999);
      }
      for (const at of [{ x: 0, y: 0 }, { x: s.width, y: s.height }, { x: -500, y: s.height / 2 }]) {
        const d = add(scene([{ id: 'wallet', role: 'main' }], format), 'book', at)!;
        expect(visibleShare(d.items.find((i) => i.uid === `u${uid}`)!, lib, d)).toBeGreaterThan(0.999);
      }
    }
  });

  it('a click puts it on a free spot, not on top of the others', () => {
    const s = add(book, 'coin')!;
    const coin = s.items.find((i) => i.uid === `u${uid}`)!;
    // Not dropped onto the middle of the book or the lamp.
    const others = s.items.filter((i) => i.uid !== coin.uid);
    for (const o of others) expect(Math.hypot(o.x - coin.x, o.y - coin.y)).toBeGreaterThan(40);
  });

  it('a drop lands where it was dropped when it fits', () => {
    const s = add(book, 'coin', { x: 600, y: 400 })!;
    const coin = s.items.find((i) => i.uid === `u${uid}`)!;
    expect([coin.x, coin.y]).toEqual([600, 400]);
  });

  it('is inserted into the paint order by depth', () => {
    const s = add(book, 'coin', { x: 600, y: 600 })!;
    const mains = s.items.filter((i) => i.role === 'main');
    const bases = mains.map((i) => itemBase(i, lib, s.scale));
    expect([...bases].sort((a, b) => a - b)).toEqual(bases);
    expect(s.items[0].role).toBe('background');
  });
});

describe('an object larger than the current scale allows', () => {
  it('zooms the whole composition out evenly instead of cropping it', () => {
    const small = scene([{ id: 'wallet', role: 'main' }, { id: 'coin', role: 'main' }]);
    const s = add(small, 'book')!;
    const k = s.scale / small.scale;
    expect(k).toBeLessThan(1);
    // The arrangement is the same, only smaller around the frame centre.
    for (const before of small.items) {
      const after = s.items.find((i) => i.uid === before.uid)!;
      expect(after.x).toBeCloseTo(small.width / 2 + (before.x - small.width / 2) * k, 1);
      expect(after.y).toBeCloseTo(small.height / 2 + (before.y - small.height / 2) * k, 1);
      expect(after.rotation).toBe(before.rotation);
    }
    expect(visibleShare(s.items.find((i) => i.uid === `u${uid}`)!, lib, s)).toBeGreaterThan(0.999);
  });
});

describe('limits', () => {
  it('at most three of the same object', () => {
    let s = book;
    for (let k = 0; k < MAX_SAME_OBJECT; k++) s = add(s, 'phone')!;
    expect(countOf(s.items, 'phone')).toBe(3);
    expect(addBlocker(s.items, 'phone')).toBe(SAME_OBJECT_LIMIT_TEXT);
    expect(add(s, 'phone')).toBeNull();
    // Other objects can still be added.
    expect(addBlocker(s.items, 'coin')).toBeNull();
  });

  it('duplicate on the canvas uses the same check', () => {
    const three = { ...book, items: [...book.items, ...[1, 2].map((k) => ({ ...book.items[1], uid: `d${k}` }))] };
    expect(countOf(three.items, 'lamp')).toBe(3);
    expect(addBlocker(three.items, 'lamp')).toBe(SAME_OBJECT_LIMIT_TEXT);
  });
});

describe('the «−» button', () => {
  it('removes the most recently added copy and leaves the rest in place', () => {
    let s = book;
    s = add(s, 'phone')!;
    const first = `u${uid}`;
    s = add(s, 'phone')!;
    const second = `u${uid}`;
    const after = removeLatest(s.items, 'phone');
    expect(after.map((i) => i.uid)).toContain(first);
    expect(after.map((i) => i.uid)).not.toContain(second);
    expect(after.filter((i) => i.uid !== first)).toEqual(s.items.filter((i) => i.uid !== first && i.uid !== second));
  });

  it('does nothing for an object that is not in the scene', () => {
    expect(removeLatest(book.items, 'pen')).toBe(book.items);
  });
});

describe('an empty canvas', () => {
  it('the last object can be removed, leaving an empty scene', () => {
    const one = scene([{ id: 'coin', role: 'main' }]);
    expect(removeLatest(one.items, 'coin')).toEqual([]);
  });

  it('«Очистить» removes every object and keeps the frame', () => {
    const c = clearScene(book);
    expect(c.items).toEqual([]);
    expect([c.width, c.height, c.format, c.decor, c.scale]).toEqual([book.width, book.height, book.format, book.decor, book.scale]);
    expect(add(c, 'pen')!.items).toHaveLength(1);
  });

  it('adding to an empty scene puts the object in the centre, whole and at a scale that suits it', () => {
    for (const format of ['horizontal', 'square', 'vertical'] as const) {
      const cleared: Scene = { ...scene([{ id: 'coin', role: 'main' }], format), items: [] };
      for (const id of ['coin', 'book', 'lamp'] as const) {
        const s = add(cleared, id)!;
        expect(s.items).toHaveLength(1);
        const it = s.items[0];
        expect(it.uid).toBe(`u${uid}`);
        expect(it.role).toBe('main');
        expect(visibleShare(it, lib, s)).toBeGreaterThan(0.999);
        expect(Math.abs(it.x - s.width / 2)).toBeLessThan(s.width * 0.2);
        expect(Math.abs(it.y - s.height / 2)).toBeLessThan(s.height * 0.25);
      }
    }
  });

  it('a drop on an empty canvas lands where it was dropped', () => {
    const cleared: Scene = { ...book, items: [] };
    const s = add(cleared, 'coin', { x: 400, y: 380 })!;
    expect([s.items[0].x, s.items[0].y]).toEqual([400, 380]);
  });
});

describe('switching S/L on an edited scene', () => {
  it('keeps manual moves and rotations, and never crops an object that was whole', () => {
    const S = loadLibrary('S');
    const moved: Scene = { ...book, items: book.items.map((it, i) => (i === 1 ? { ...it, x: it.x - 30, rotation: 15 } : it)) };
    const s = switchSize(moved, lib, S);
    expect(s.size).toBe('S');
    expect(s.items.map((i) => [i.uid, i.x, i.y, i.rotation])).toEqual(moved.items.map((i) => [i.uid, i.x, i.y, i.rotation]));
    moved.items.forEach((it, k) => {
      const before = visibleShare(it, lib, moved);
      expect(visibleShare(s.items[k], S, s)).toBeGreaterThanOrEqual(Math.min(before, 0.985) - 0.015);
    });
    // Back to L: the same arrangement at the L scale.
    const back = switchSize(s, S, lib);
    expect(back.items.map((i) => [i.x, i.y])).toEqual(moved.items.map((i) => [i.x, i.y]));
  });
});

describe('switching to S with a tall lamp', () => {
  it('keeps the lamp head and arm inside the frame', () => {
    const S = loadLibrary('S');
    for (const format of ['horizontal', 'square', 'vertical'] as const) {
      for (const variant of [0, 1, 2, 3]) {
        const l = layoutScene({ objects: [{ id: 'lamp', role: 'main' }, { id: 'headphones', role: 'main' }, { id: 'phone', role: 'main' }], format, size: 'L', variant }, lib);
        const s = switchSize(l, lib, S);
        const lamp = s.items.find((i) => i.id === 'lamp')!;
        expect(upperHalfVisible(lamp, S, s), `${format} v${variant}`).toBeGreaterThan(0.98);
      }
    }
  });
});

describe('role of a hand-added object', () => {
  it('is always main, however many main objects the scene already has', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ role: 'main' as const, uid: String(i) })) as never;
    expect(roleForNew([])).toBe('main');
    expect(roleForNew(many)).toBe('main');
  });
});
