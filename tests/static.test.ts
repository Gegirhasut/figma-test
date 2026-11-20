import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { staticTarget } from '../src/server/static';

const dist = mkdtempSync(join(tmpdir(), 'skladno-dist-'));
mkdirSync(join(dist, 'assets'));
writeFileSync(join(dist, 'index.html'), '<!doctype html>');
writeFileSync(join(dist, 'assets', 'app-123.js'), '1');
writeFileSync(join(dist, 'favicon.svg'), '<svg/>');
afterAll(() => rmSync(dist, { recursive: true, force: true }));

describe('static files and the SPA fallback', () => {
  it('serves existing files', () => {
    expect(staticTarget(dist, '/assets/app-123.js')).toEqual({ status: 200, file: join(dist, 'assets', 'app-123.js') });
    expect(staticTarget(dist, '/favicon.svg')).toEqual({ status: 200, file: join(dist, 'favicon.svg') });
    expect(staticTarget(dist, '/')).toEqual({ status: 200, file: join(dist, 'index.html') });
  });

  it('extension-less routes fall back to index.html', () => {
    expect(staticTarget(dist, '/editor')).toEqual({ status: 200, file: join(dist, 'index.html') });
  });

  it('a missing file with an extension or under /assets/ is 404', () => {
    expect(staticTarget(dist, '/assets/x.js').status).toBe(404);
    expect(staticTarget(dist, '/assets/old-bundle').status).toBe(404);
    expect(staticTarget(dist, '/assets/').status).toBe(404);
    expect(staticTarget(dist, '/logo.png').status).toBe(404);
    expect(staticTarget(dist, '/%E0%A4%A').status).toBe(404);
  });

  it('does not leave dist', () => {
    expect(staticTarget(dist, '/../package.json').status).not.toBe(200);
  });
});
