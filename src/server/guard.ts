// Cross-site request protection for the API.
//
// The AI quota belongs to the visitor's browser (cookie) and IP, so a foreign
// page must not be able to spend it with a "simple" cross-site request such as
// fetch(url, { mode: 'no-cors', body, headers: { 'content-type': 'text/plain' } }).
// Two independent checks:
//  - a POST must be application/json: browsers never send that cross-site
//    without a CORS preflight, which this server does not answer. This is what
//    stops the no-cors attack, whatever the proxy in front does with headers;
//  - the browser's own word on where the request comes from must point at
//    this site: Sec-Fetch-Site when it is sent (every current browser), and
//    otherwise Origin against the host the visitor actually opened.

import type { IncomingHttpHeaders } from 'node:http';

export interface GuardRejection {
  status: 403 | 415;
  error: string;
}

export interface GuardOptions {
  /** Behind a trusted reverse proxy: the public host may come in X-Forwarded-Host. */
  trustProxy?: boolean;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function header(h: IncomingHttpHeaders, name: string): string | undefined {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Hosts this request may legitimately come from: the Host header and, behind a
 * trusted proxy, the X-Forwarded-Host it passes on (the proxy may rewrite Host
 * to the backend address, e.g. 127.0.0.1:8095).
 */
function ownHosts(h: IncomingHttpHeaders, opts: GuardOptions): string[] {
  const hosts = [header(h, 'host')];
  if (opts.trustProxy) hosts.push(...(header(h, 'x-forwarded-host')?.split(',') ?? []));
  return hosts.map((x) => x?.trim().toLowerCase()).filter((x): x is string => Boolean(x));
}

/** True when the request comes from another site (by the browser's own headers). */
export function isCrossSite(h: IncomingHttpHeaders, opts: GuardOptions = {}): boolean {
  const origin = header(h, 'origin');
  // Sandboxed frames, file:// pages and data: URLs: never our page.
  if (origin !== undefined && origin.trim().toLowerCase() === 'null') return true;
  const site = header(h, 'sec-fetch-site')?.toLowerCase();
  if (site) {
    // Set by the browser itself (a page cannot forge it) and independent of
    // how the proxy rewrites Host. same-origin: our page; none: user-initiated.
    return site !== 'same-origin' && site !== 'none';
  }
  if (origin === undefined) return false; // not a browser request at all (curl, scripts)
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return true; // garbage
  }
  return !ownHosts(h, opts).includes(originHost);
}

/** null when the API request may proceed, otherwise the status to answer with. */
export function guardApiRequest(method: string | undefined, h: IncomingHttpHeaders, opts: GuardOptions = {}): GuardRejection | null {
  const m = (method ?? 'GET').toUpperCase();
  if (SAFE_METHODS.has(m)) return null;
  if (isCrossSite(h, opts)) return { status: 403, error: 'Запрос с чужого сайта отклонён' };
  const type = header(h, 'content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return { status: 415, error: 'Нужен Content-Type: application/json' };
  return null;
}
