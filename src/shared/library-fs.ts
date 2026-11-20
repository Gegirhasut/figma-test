// Node-side access to the generated library (scripts and tests).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LibraryData, Manifest, Size } from './types';

const GEN = join(dirname(fileURLToPath(import.meta.url)), '../library/generated');
const cache = new Map<Size, LibraryData>();

export function loadLibrary(size: Size): LibraryData {
  let lib = cache.get(size);
  if (!lib) {
    lib = JSON.parse(readFileSync(join(GEN, `library-${size}.json`), 'utf8')) as LibraryData;
    cache.set(size, lib);
  }
  return lib;
}

export function loadManifest(): Manifest {
  return JSON.parse(readFileSync(join(GEN, 'manifest.json'), 'utf8')) as Manifest;
}
