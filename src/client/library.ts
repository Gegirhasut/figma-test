// Loads the generated library for a level of detail on demand (one JSON per size).
import urlL from '../library/generated/library-L.json?url';
import urlS from '../library/generated/library-S.json?url';
import type { LibraryData, Size } from '../shared/types';

const URLS: Record<Size, string> = { L: urlL, S: urlS };
const pending = new Map<Size, Promise<LibraryData>>();
const ready = new Map<Size, LibraryData>();

export function loadLibrary(size: Size): Promise<LibraryData> {
  let p = pending.get(size);
  if (!p) {
    p = fetch(URLS[size])
      .then((r) => {
        if (!r.ok) throw new Error(`library ${size}: HTTP ${r.status}`);
        return r.json() as Promise<LibraryData>;
      })
      .then((lib) => {
        ready.set(size, lib);
        return lib;
      });
    p.catch(() => pending.delete(size));
    pending.set(size, p);
  }
  return p;
}

export function libraryIfReady(size: Size): LibraryData | undefined {
  return ready.get(size);
}
