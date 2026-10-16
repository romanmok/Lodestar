import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let srv;
before(async () => { srv = await startTestServer({ loginDelayMs: 5 }); });
after(async () => { await srv.close(); });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function assertSecurityHeaders(r, label) {
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff', label);
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN', label);
}

test('security headers on every kind of response', async () => {
  const cookie = await srv.login();
  const up = await fetch(srv.url + '/api/images', { method: 'POST', headers: { cookie, 'content-type': 'image/png' }, body: PNG });
  assertSecurityHeaders(up, 'image upload');
  const { url: imageUrl } = await up.json();
  const cases = [
    ['static', () => fetch(srv.url + '/app.js')],
    ['entry page', () => fetch(srv.url + '/', { headers: { cookie } })],
    ['entry redirect', () => fetch(srv.url + '/', { redirect: 'manual' })],
    ['login page', () => fetch(srv.url + '/login')],
    ['login ok', () => fetch(srv.url + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-pass' }) })],
    ['login wrong', () => fetch(srv.url + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'nope' }) })],
    ['api unauthorized', () => fetch(srv.url + '/api/maps')],
    ['api', () => fetch(srv.url + '/api/maps', { headers: { cookie } })],
    ['image', () => fetch(srv.url + imageUrl, { headers: { cookie } })],
    ['not found', () => fetch(srv.url + '/nope.js')],
  ];
  for (const [label, run] of cases) assertSecurityHeaders(await run(), label);
});
