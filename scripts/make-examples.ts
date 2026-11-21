// Renders example compositions with the real engine into examples/.
//
//   npm run examples

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertSceneSize, layoutWithDiagnostics } from '../src/shared/layout';
import { loadLibrary } from '../src/shared/library-fs';
import { interpretByTags, matchObjects } from '../src/shared/matcher';
import { SCHEMES } from '../src/shared/palette';
import { sceneToSvg } from '../src/shared/render';
import type { Format, ObjectRequest, Size } from '../src/shared/types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, process.argv[2] ?? 'examples');

interface Example {
  file: string;
  phrase: string;
  format: Format;
  size: Size;
  scheme: string;
  variant?: number;
  /** Fixed objects, for phrases that in the app go through the LLM. */
  objects?: ObjectRequest[];
}

const EXAMPLES: Example[] = [
  { file: '01-koshelek-moneta-horizontal-lilac-L.svg', phrase: 'Кошелёк, монета', format: 'horizontal', size: 'L', scheme: 'lilac' },
  { file: '02-telefon-pazl-fon-kniga-square-peach-L.svg', phrase: 'телефон и пазл на фоне книги', format: 'square', size: 'L', scheme: 'peach' },
  { file: '03-naushniki-cvetok-fon-lampa-vertical-teal-S.svg', phrase: 'наушники и цветок на фоне лампы', format: 'vertical', size: 'S', scheme: 'teal' },
  {
    file: '04-vecher-s-knigoy-horizontal-lilac-L.svg',
    phrase: 'Вечер с книгой',
    format: 'horizontal',
    size: 'L',
    scheme: 'lilac',
    variant: 2,
    objects: [
      { id: 'book', role: 'main' },
      { id: 'lamp', role: 'main' },
      { id: 'flower', role: 'background' },
    ],
  },
];

mkdirSync(OUT, { recursive: true });
for (const ex of EXAMPLES) {
  const dict = matchObjects(ex.phrase);
  const objects = ex.objects ?? (dict.mode === 'objects' ? dict.objects : interpretByTags(ex.phrase).objects);
  const lib = loadLibrary(ex.size);
  const t0 = performance.now();
  // Laid out with the L geometry: an S composition is the L one with the S pieces.
  const laid = layoutWithDiagnostics({ objects, format: ex.format, size: 'L', variant: ex.variant }, loadLibrary('L'));
  const diagnostics = laid.diagnostics;
  const scene = convertSceneSize(laid.scene, lib);
  const ms = performance.now() - t0;
  const scheme = SCHEMES.find((s) => s.id === ex.scheme)!;
  writeFileSync(join(OUT, ex.file), sceneToSvg(scene, lib, scheme.colors, { title: ex.phrase }));
  console.log(
    `${ex.file}: ${objects.map((o) => `${o.id}/${o.role}`).join(', ')} | scale ${scene.scale} | ` +
      `vis ${diagnostics.mainVisibility.map((v) => v.toFixed(2)).join(',')} | overlap ${diagnostics.maxMainOverlap.toFixed(3)} | ${ms.toFixed(0)} ms`,
  );
}
