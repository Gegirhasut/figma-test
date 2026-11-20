// Renders example compositions with the real engine into examples/.
//
//   npm run examples

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutWithDiagnostics } from '../src/shared/layout';
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
  { file: '01-koshelek-moneta-horizontal-lilac-L.svg', phrase: 'кошелёк, монета', format: 'horizontal', size: 'L', scheme: 'lilac' },
  {
    file: '02-kopim-na-otpusk-square-peach-L.svg',
    phrase: 'копим на отпуск',
    format: 'square',
    size: 'L',
    scheme: 'peach',
    variant: 1,
  },
  {
    file: '03-uchimsya-po-vecheram-vertical-teal-S.svg',
    phrase: 'книга, лампа и ручка на фоне цветов',
    format: 'vertical',
    size: 'S',
    scheme: 'teal',
  },
];

mkdirSync(OUT, { recursive: true });
for (const ex of EXAMPLES) {
  const dict = matchObjects(ex.phrase);
  const objects = ex.objects ?? (dict.mode === 'objects' ? dict.objects : interpretByTags(ex.phrase).objects);
  const lib = loadLibrary(ex.size);
  const t0 = performance.now();
  const { scene, diagnostics } = layoutWithDiagnostics({ objects, format: ex.format, size: ex.size, variant: ex.variant }, lib);
  const ms = performance.now() - t0;
  const scheme = SCHEMES.find((s) => s.id === ex.scheme)!;
  writeFileSync(join(OUT, ex.file), sceneToSvg(scene, lib, scheme.colors, { title: ex.phrase }));
  console.log(
    `${ex.file}: ${objects.map((o) => `${o.id}/${o.role}`).join(', ')} | scale ${scene.scale} | ` +
      `vis ${diagnostics.mainVisibility.map((v) => v.toFixed(2)).join(',')} | overlap ${diagnostics.maxMainOverlap.toFixed(3)} | ${ms.toFixed(0)} ms`,
  );
}
