// One process: /api/interpret + the frontend (Vite middleware in development,
// the built files from dist/ in production).
//
//   npm run dev                 — development with hot reload
//   npm run build && npm start  — production

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Interpreter, RateLimiter } from './interpret';
import { providerChain } from './llm/providers';

const ROOT = process.cwd();
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));

const env = process.env;
// The built server lives in dist-server/; running from source means development.
const isProd = env.NODE_ENV === 'production' || import.meta.url.includes('/dist-server/');
const PORT = Number(env.PORT) || 5173;
const COOKIE = 'skl_id';

const interpreter = new Interpreter(
  () => providerChain(env),
  { perBrowser: Number(env.AI_LIMIT_PER_BROWSER) || 3, perIp: Number(env.AI_LIMIT_PER_IP) || 10 },
  (m) => console.log(m),
);
const limiter = new RateLimiter(Number(env.RATE_LIMIT_PER_MINUTE) || 30);

function clientIp(req: IncomingMessage): string {
  if (env.TRUST_PROXY === '1') {
    const xf = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function browserId(req: IncomingMessage, res: ServerResponse): string {
  const m = /(?:^|;\s*)skl_id=([a-f0-9]{32})/.exec(req.headers.cookie ?? '');
  if (m) return m[1];
  const id = randomBytes(16).toString('hex');
  res.setHeader('set-cookie', `${COOKIE}=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${isProd ? '; Secure' : ''}`);
  return id;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 4096): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (!path.startsWith('/api/')) return false;
  const ip = clientIp(req);
  if (!limiter.allow(ip)) {
    sendJson(res, 429, { error: 'Слишком много запросов, попробуйте через минуту' });
    return true;
  }
  const id = browserId(req, res);
  if (path === '/api/status' && req.method === 'GET') {
    sendJson(res, 200, { aiLeft: interpreter.aiLeft(id, ip), aiConfigured: providerChain(env).length > 0 });
    return true;
  }
  if (path === '/api/interpret' && req.method === 'POST') {
    let phrase = '';
    try {
      const body = JSON.parse(await readBody(req)) as { phrase?: unknown };
      phrase = typeof body.phrase === 'string' ? body.phrase.trim().slice(0, 200) : '';
    } catch {
      sendJson(res, 400, { error: 'Некорректный запрос' });
      return true;
    }
    if (!phrase) {
      sendJson(res, 400, { error: 'Пустая фраза' });
      return true;
    }
    sendJson(res, 200, await interpreter.interpret(phrase, id, ip));
    return true;
  }
  sendJson(res, 404, { error: 'Not found' });
  return true;
}

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

function serveStatic(dist: string, path: string, res: ServerResponse) {
  const safe = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '');
  let file = resolve(dist, safe);
  if (!file.startsWith(dist + sep) && file !== dist) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  const ext = extname(file);
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(readFileSync(file));
}

async function main() {
  const dist = resolve(ROOT, 'dist');
  let vite: import('vite').ViteDevServer | null = null;
  if (!isProd) {
    const { createServer: createVite } = await import('vite');
    vite = await createVite({ server: { middlewareMode: true }, appType: 'spa' });
  } else if (!existsSync(join(dist, 'index.html'))) {
    console.error('dist/ not found — run `npm run build` first');
    process.exit(1);
  }
  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? '/').split('?')[0];
      if (await handleApi(req, res, path)) return;
      if (vite) vite.middlewares(req, res, () => res.writeHead(404).end());
      else serveStatic(dist, path, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { error: 'Внутренняя ошибка' });
      else res.end();
    }
  });
  server.listen(PORT, () => {
    const ai = providerChain(env).map((p) => `${p.name}:${p.model}`).join(' → ') || 'нет ключей, только словарь';
    console.log(`Складно: http://localhost:${PORT} (${isProd ? 'production' : 'development'}; AI: ${ai})`);
  });
}

main();
