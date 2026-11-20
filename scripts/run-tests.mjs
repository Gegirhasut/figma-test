#!/usr/bin/env node
// Test runner that remembers progress.
//
//   node scripts/run-tests.mjs              run every tests/*.test.ts (one vitest process per file)
//   node scripts/run-tests.mjs --resume     skip files that already passed on exactly this working tree
//   node scripts/run-tests.mjs layout       only files whose name contains «layout»
//
// Each PASS is written to build/test-logs/_passed.json the moment it happens,
// together with a fingerprint of the working tree (tracked changes + untracked,
// not ignored files). A changed tree means a new fingerprint, so a green result
// never carries over to different code. After a killed run, start the same
// command again with --resume. Logs: build/test-logs/<file>.log.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOGS = join(ROOT, 'build', 'test-logs');
const PASSED = join(LOGS, '_passed.json');

const args = process.argv.slice(2);
const resume = args.includes('--resume');
const filters = args.filter((a) => !a.startsWith('--'));

function git(...a) {
  const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout ?? '').trim();
}

function fingerprint() {
  const snap = git('stash', 'create') || git('rev-parse', 'HEAD');
  const h = createHash('sha1');
  h.update(snap ? git('rev-parse', `${snap}^{tree}`) : 'no-commit');
  for (const f of git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean).sort()) {
    h.update(f);
    try {
      h.update(readFileSync(join(ROOT, f)));
    } catch {
      /* deleted meanwhile */
    }
  }
  return h.digest('hex');
}

function loadPassed(fp) {
  try {
    const d = JSON.parse(readFileSync(PASSED, 'utf8'));
    if (d.fp === fp) return new Set(d.passed);
  } catch {
    /* no file yet */
  }
  return new Set();
}

function savePassed(fp, passed) {
  mkdirSync(LOGS, { recursive: true });
  writeFileSync(PASSED, JSON.stringify({ fp, passed: [...passed].sort(), updated: new Date().toISOString() }, null, 2));
}

const files = readdirSync(join(ROOT, 'tests'))
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => !filters.length || filters.some((p) => f.includes(p)))
  .sort();

if (!files.length) {
  console.error('no test files matched');
  process.exit(2);
}

const fp = fingerprint();
const passed = resume ? loadPassed(fp) : new Set();
if (!resume) savePassed(fp, passed);
const vitest = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
if (!existsSync(vitest)) {
  console.error('vitest is not installed — run npm install');
  process.exit(2);
}

const t0 = Date.now();
const failed = [];
let skipped = 0;
for (const f of files) {
  if (passed.has(f)) {
    skipped++;
    console.log(`SKIP  ${f} (passed on this tree)`);
    continue;
  }
  const t = Date.now();
  const r = spawnSync(process.execPath, [vitest, 'run', `tests/${f}`, '--reporter=verbose'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  mkdirSync(LOGS, { recursive: true });
  writeFileSync(join(LOGS, f.replace(/\.ts$/, '.log')), (r.stdout ?? '') + (r.stderr ?? ''));
  const s = ((Date.now() - t) / 1000).toFixed(1);
  if (r.status === 0) {
    passed.add(f);
    savePassed(fp, passed);
    console.log(`PASS  ${f} (${s} s)`);
  } else {
    failed.push(f);
    console.log(`FAIL  ${f} (${s} s) — see build/test-logs/${f.replace(/\.ts$/, '.log')}`);
  }
}
const total = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`== ${files.length} files: ${files.length - failed.length - skipped} PASS, ${skipped} skipped, ${failed.length} FAIL${failed.length ? ` (${failed.join(', ')})` : ''} in ${total} s`);
process.exit(failed.length ? 1 : 0);
