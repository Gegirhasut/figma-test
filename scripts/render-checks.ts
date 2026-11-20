// Renders check compositions to SVG and PNG under build/checks/ so a layout
// change can be looked at, not only measured.
//
//   npm run checks                 the default set below
//   npm run checks -- --all        also every variant 0–7 of each case
//
// PNGs are made with headless Chrome/Edge if one is installed; otherwise only
// the SVGs are written.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { layoutWithDiagnostics } from '../src/shared/layout';
import { loadLibrary } from '../src/shared/library-fs';
import { interpretByTags, matchObjects } from '../src/shared/matcher';
import { SCHEMES } from '../src/shared/palette';
import { sceneToSvg } from '../src/shared/render';
import type { Format, ObjectRequest, Size } from '../src/shared/types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'build', 'checks');

interface Check {
  name: string;
  phrase: string;
  format: Format;
  size: Size;
  scheme: string;
  /** What the LLM returned for the phrase in the app, when the dictionary would pick something else. */
  objects?: ObjectRequest[];
}

const CHECKS: Check[] = [
  {
    name: 'koplyu-na-opus-peach-vertical-L',
    phrase: 'коплю на Opus',
    format: 'vertical',
    size: 'L',
    scheme: 'peach',
    objects: [
      { id: 'coin', role: 'main' },
      { id: 'wallet', role: 'main' },
      { id: 'flower', role: 'background' },
    ],
  },
  {
    name: 'kupim-na-otpusk-lilac-horizontal-L',
    phrase: 'купим на отпуск',
    format: 'horizontal',
    size: 'L',
    scheme: 'lilac',
    objects: [
      { id: 'wallet', role: 'main' },
      { id: 'coin', role: 'main' },
      { id: 'headphones', role: 'background' },
    ],
  },
  { name: 'kopim-na-otpusk-lilac-square-L', phrase: 'копим на отпуск', format: 'square', size: 'L', scheme: 'lilac' },
  { name: 'naushniki-telefon-kniga-na-fone-teal-horizontal-S', phrase: 'наушники, телефон, книга на фоне', format: 'horizontal', size: 'S', scheme: 'teal' },
];

function browser(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

function toPng(exe: string, svgPath: string, pngPath: string, w: number, h: number, profile: string) {
  spawnSync(
    exe,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--user-data-dir=${profile}`,
      `--window-size=${w},${h}`,
      `--screenshot=${pngPath}`,
      pathToFileURL(svgPath).href,
    ],
    { stdio: 'ignore', timeout: 60_000 },
  );
}

const all = process.argv.includes('--all');
mkdirSync(OUT, { recursive: true });
const exe = browser();
const profile = mkdtempSync(join(tmpdir(), 'skladno-checks-'));
try {
  for (const c of CHECKS) {
    const dict = matchObjects(c.phrase);
    const objects = c.objects ?? (dict.mode === 'objects' ? dict.objects : interpretByTags(c.phrase).objects);
    const lib = loadLibrary(c.size);
    const scheme = SCHEMES.find((s) => s.id === c.scheme)!;
    for (const variant of all ? [0, 1, 2, 3, 4, 5, 6, 7] : [0]) {
      const { scene, diagnostics } = layoutWithDiagnostics({ objects, format: c.format, size: c.size, variant }, lib);
      const base = join(OUT, all ? `${c.name}-v${variant}` : c.name);
      writeFileSync(base + '.svg', sceneToSvg(scene, lib, scheme.colors, { title: c.phrase }));
      if (exe) toPng(exe, base + '.svg', base + '.png', scene.width, scene.height, profile);
      console.log(
        `${base}.${exe ? 'png' : 'svg'}: ${scene.items.map((i) => `${i.id}/${i.role}`).join(' < ')} | ` +
          `depth violations ${diagnostics.depthViolations} | max main-on-bg ${diagnostics.maxMainOnBackground.toFixed(3)}`,
      );
    }
  }
} finally {
  rmSync(profile, { recursive: true, force: true });
}
