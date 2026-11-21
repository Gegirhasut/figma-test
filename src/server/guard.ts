// Cross-site request protection for the API.
//
// The AI quota belongs to the visitor's browser (cookie) and IP, so a foreign
// page must not be able to spend it with a "simple" cross-site request such as
// fetch(url, { mode: 'no-cors', body, headers: { 'content-type': 'text/plain' } }).
// Two independent checks:
//  - a POST must be application/json: browsers never send that cross-site
//    without a CORS preflight, which this server does not answer;
//  - Sec-Fetch-Site / Origin, when the browser sends them, must point at this site.

import type { IncomingHttpHeaders } from 'node:http';

export interface GuardRejection {
  status: 403 | 415;
  error: string;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function header(h: IncomingHttpHeaders, name: string): string | undefined {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
}

/** True when the request comes from another site (by the browser's own headers). */
export function isCrossSite(h: IncomingHttpHeaders): boolean {
  const site = header(h, 'sec-fetch-site')?.toLowerCase();
  // same-origin: our own page; none: typed in the address bar / a bookmark.
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = header(h, 'origin');
  if (origin !== undefined) {
    const host = header(h, 'host')?.toLowerCase();
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return true; // "null" (sandboxed frames, file://) or garbage
    }
    if (!host || originHost !== host) return true;
  }
  return false;
}

/** null when the API request may proceed, otherwise the status to answer with. */
export function guardApiRequest(method: string | undefined, h: IncomingHttpHeaders): GuardRejection | null {
  const m = (method ?? 'GET').toUpperCase();
  if (SAFE_METHODS.has(m)) return null;
  if (isCrossSite(h)) return { status: 403, error: 'Запрос с чужого сайта отклонён' };
  const type = header(h, 'content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return { status: 415, error: 'Нужен Content-Type: application/json' };
  return null;
}
