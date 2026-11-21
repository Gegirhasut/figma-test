import { afterEach, describe, expect, it } from 'vitest';
import { interpretPhrase } from '../src/client/api';
import { guardApiRequest, isCrossSite } from '../src/server/guard';

const HOST = 'skladno.qaprovider.com';
const json = { 'content-type': 'application/json' };

describe('API guard against cross-site requests', () => {
  it('a no-cors text/plain POST from another page gets 415 even without Origin', () => {
    // fetch('/api/interpret', { method: 'POST', mode: 'no-cors', body: '{"phrase":"…"}' }) from an old browser.
    expect(guardApiRequest('POST', { host: HOST, 'content-type': 'text/plain;charset=UTF-8' })?.status).toBe(415);
    expect(guardApiRequest('POST', { host: HOST, 'content-type': 'application/x-www-form-urlencoded' })?.status).toBe(415);
    expect(guardApiRequest('POST', { host: HOST, 'content-type': 'multipart/form-data; boundary=x' })?.status).toBe(415);
    expect(guardApiRequest('POST', { host: HOST })?.status).toBe(415);
  });

  it('a cross-site request is 403 by Sec-Fetch-Site or Origin', () => {
    expect(guardApiRequest('POST', { host: HOST, ...json, 'sec-fetch-site': 'cross-site' })?.status).toBe(403);
    expect(guardApiRequest('POST', { host: HOST, ...json, 'sec-fetch-site': 'same-site' })?.status).toBe(403);
    expect(guardApiRequest('POST', { host: HOST, 'content-type': 'text/plain', origin: 'https://evil.example' })?.status).toBe(403);
    expect(guardApiRequest('POST', { host: HOST, ...json, origin: 'https://evil.example' })?.status).toBe(403);
    expect(guardApiRequest('POST', { host: HOST, ...json, origin: 'null' })?.status).toBe(403);
    expect(guardApiRequest('POST', { host: HOST, ...json, origin: `https://${HOST}.evil.example` })?.status).toBe(403);
  });

  it('our own page passes: production behind nginx and the local dev server', () => {
    expect(guardApiRequest('POST', { host: HOST, 'content-type': 'application/json', origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' })).toBeNull();
    expect(guardApiRequest('POST', { host: 'localhost:5173', 'content-type': 'application/json; charset=utf-8', origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' })).toBeNull();
    // curl and scripts without browser headers are not cross-site (they have no visitor quota to steal).
    expect(guardApiRequest('POST', { host: HOST, ...json })).toBeNull();
  });

  it('behind a proxy that rewrites Host to the backend address our own page still passes', () => {
    const backend = { host: '127.0.0.1:8095', 'content-type': 'application/json', origin: `https://${HOST}` };
    // Every current browser sends Sec-Fetch-Site, which does not depend on Host.
    expect(guardApiRequest('POST', { ...backend, 'sec-fetch-site': 'same-origin' })).toBeNull();
    expect(guardApiRequest('POST', { ...backend, 'sec-fetch-site': 'same-origin' }, { trustProxy: true })).toBeNull();
    // Without Sec-Fetch-Site the trusted proxy's X-Forwarded-Host names the public host.
    expect(guardApiRequest('POST', { ...backend, 'x-forwarded-host': HOST }, { trustProxy: true })).toBeNull();
    // X-Forwarded-Host is only believed behind a trusted proxy.
    expect(guardApiRequest('POST', { ...backend, 'x-forwarded-host': HOST })?.status).toBe(403);
  });

  it('behind the same proxy a foreign origin is still rejected', () => {
    const backend = { host: '127.0.0.1:8095', 'content-type': 'application/json', 'x-forwarded-host': HOST };
    expect(guardApiRequest('POST', { ...backend, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, { trustProxy: true })?.status).toBe(403);
    expect(guardApiRequest('POST', { ...backend, origin: 'https://evil.example' }, { trustProxy: true })?.status).toBe(403);
    expect(guardApiRequest('POST', { ...backend, origin: 'null', 'sec-fetch-site': 'same-origin' }, { trustProxy: true })?.status).toBe(403);
    // The no-cors text/plain attack is stopped by the Content-Type whatever the headers say.
    expect(guardApiRequest('POST', { ...backend, 'content-type': 'text/plain', origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' }, { trustProxy: true })?.status).toBe(415);
  });

  it('GET stays open (status check, the page itself)', () => {
    expect(guardApiRequest('GET', { host: HOST, 'sec-fetch-site': 'cross-site' })).toBeNull();
    expect(isCrossSite({ host: HOST, 'sec-fetch-site': 'none' })).toBe(false);
  });
});

describe('the client sends what the guard accepts', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('POST /api/interpret goes as application/json from the same origin', async () => {
    let seen: RequestInit | undefined;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify({ objects: [{ id: 'lamp', role: 'main' }], source: 'anthropic', aiLeft: 2 }));
    }) as typeof fetch;
    await interpretPhrase('вечер с книгой');
    const headers = new Headers(seen?.headers);
    expect(seen?.method).toBe('POST');
    expect(guardApiRequest('POST', { host: HOST, 'content-type': headers.get('content-type') ?? undefined, origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' })).toBeNull();
  });
});
