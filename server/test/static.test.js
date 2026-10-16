import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

// fetch() normalizes paths like /../x, so use raw http for exact request targets.
import http from 'node:http';
function rawGet(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(srv.url);
    http.get({ host: u.hostname, port: u.port, path }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

test('serves app.js', async () => {
  const r = await rawGet('/app.js');
  assert.equal(r.status, 200);
  assert.ok(r.headers['content-type'].startsWith('text/javascript'));
});

test('serves online flag', async () => {
  const r = await rawGet('/online-config.js');
  assert.equal(r.status, 200);
  assert.equal(r.body, 'window.LODESTAR_ONLINE = true;\n');
});

test('blocks non-public files', async () => {
  for (const p of [
    '/server/app.js', '/%2e%2e/server/app.js', '/../package.json', '/package.json',
    '/data/lodestar.sqlite', '/.git/config',
    '/docs/superpowers/specs/2026-10-16-online-play-design.md', '/server/login.html',
  ]) {
    const r = await rawGet(p);
    assert.equal(r.status, 404, p);
  }
});

test('serves manual assets', async () => {
  const r = await rawGet('/manual.html');
  assert.equal(r.status, 200);
});

test('login page links the public favicon', async () => {
  const page = await rawGet('/login');
  assert.match(page.body, /<link rel="icon" href="favicon\.svg" type="image\/svg\+xml">/);
  const icon = await rawGet('/favicon.svg');
  assert.equal(icon.status, 200);
  assert.equal(icon.headers['content-type'], 'image/svg+xml');
});
