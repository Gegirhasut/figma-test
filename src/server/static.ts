// Built frontend from dist/: hashed assets with long caching, gzip, and the
// SPA fallback to index.html for extension-less routes only.

import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export type StaticTarget = { status: 200; file: string } | { status: 403 | 404 };

/**
 * Which file answers a path. A missing file that has an extension or lives
 * under /assets/ (an old hashed bundle, a typo in an image name) is a real 404;
 * only extension-less routes fall back to index.html.
 */
export function staticTarget(dist: string, path: string): StaticTarget {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return { status: 404 };
  }
  const safe = normalize(decoded).replace(/^([/\\])+/, '');
  const file = resolve(dist, safe);
  if (!file.startsWith(dist + sep) && file !== dist) return { status: 403 };
  if (existsSync(file) && !statSync(file).isDirectory()) return { status: 200, file };
  if (extname(safe) || /^assets([/\\]|$)/.test(safe)) return { status: 404 };
  return { status: 200, file: join(dist, 'index.html') };
}

const gzCache = new Map<string, Buffer>();

export function serveStatic(dist: string, path: string, req: IncomingMessage, res: ServerResponse) {
  const t = staticTarget(dist, path);
  if (t.status !== 200) {
    res.writeHead(t.status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(t.status === 404 ? 'Not found' : 'Forbidden');
    return;
  }
  const { file } = t;
  const ext = extname(file);
  const immutable = file.includes(`${sep}assets${sep}`);
  const headers: Record<string, string> = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    vary: 'accept-encoding',
  };
  let body: Buffer = readFileSync(file);
  if (/gzip/.test(String(req.headers['accept-encoding'] ?? '')) && ['.html', '.js', '.css', '.json', '.svg'].includes(ext)) {
    let gz = gzCache.get(file);
    if (!gz) {
      gz = gzipSync(body);
      gzCache.set(file, gz);
    }
    body = gz;
    headers['content-encoding'] = 'gzip';
  }
  res.writeHead(200, headers);
  res.end(body);
}
