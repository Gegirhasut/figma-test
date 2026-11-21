import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CSP, serveStatic } from '../src/server/static';

const dist = mkdtempSync(join(tmpdir(), 'skladno-csp-'));
mkdirSync(join(dist, 'assets'));
writeFileSync(join(dist, 'index.html'), '<!doctype html>');
afterAll(() => rmSync(dist, { recursive: true, force: true }));

function serve(path: string): Record<string, string> {
  let headers: Record<string, string> = {};
  const res = {
    writeHead(_s: number, h: Record<string, string>) {
      headers = h;
      return res;
    },
    end() {
      return res;
    },
  };
  serveStatic(dist, path, { headers: {} } as IncomingMessage, res as unknown as ServerResponse);
  return headers;
}

describe('Content-Security-Policy', () => {
  it('the page and missing files are served with it', () => {
    expect(serve('/')['content-security-policy']).toBe(CSP);
    expect(serve('/editor')['content-security-policy']).toBe(CSP);
    expect(serve('/assets/missing.js')['content-security-policy']).toBe(CSP);
  });

  it('only this origin plus Google Fonts, no plugins, no framing', () => {
    const d = Object.fromEntries(CSP.split('; ').map((x) => [x.split(' ')[0], x.split(' ').slice(1)]));
    expect(d['default-src']).toEqual(["'self'"]);
    expect(d['script-src']).toEqual(["'self'"]);
    expect(d['style-src']).toEqual(["'self'", 'https://fonts.googleapis.com']);
    expect(d['font-src']).toContain('https://fonts.gstatic.com');
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(CSP).not.toMatch(/unsafe-inline|unsafe-eval/);
  });
});
