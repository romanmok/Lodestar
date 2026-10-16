import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer, TEST_PASSWORD } from './helpers.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

const get = (path, cookie, extra = {}) =>
  fetch(srv.url + path, { redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...extra } });
const post = (path, body, headers = {}) =>
  fetch(srv.url + path, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('GM page redirects when logged out', async () => {
  for (const p of ['/', '/index.html']) {
    const r = await get(p);
    assert.equal(r.status, 302, p);
    assert.equal(r.headers.get('location'), '/login');
  }
  const l = await get('/login');
  assert.equal(l.status, 200);
  assert.match(await l.text(), /<form/);
});

test('wrong password', async () => {
  const t = Date.now();
  const r = await post('/api/login', { password: 'nope' });
  assert.equal(r.status, 401);
  assert.ok(Date.now() - t >= 1000);
  assert.equal(r.headers.get('set-cookie'), null);
});

test('right password', async () => {
  const r = await post('/api/login', { password: TEST_PASSWORD });
  assert.equal(r.status, 200);
  const c = r.headers.get('set-cookie');
  assert.match(c, /lodestar_gm=/);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Max-Age=2592000/);
  assert.doesNotMatch(c, /Secure/);
  const s = await post('/api/login', { password: TEST_PASSWORD }, { 'x-forwarded-proto': 'https' });
  assert.match(s.headers.get('set-cookie'), /Secure/);
});

test('cookie unlocks GM page', async () => {
  const cookie = await srv.login();
  const r = await get('/', cookie);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /app\.js/);
});

test('tampered cookie rejected', async () => {
  const cookie = await srv.login();
  const last = cookie.slice(-1);
  const bad = cookie.slice(0, -1) + (last === '0' ? '1' : '0');
  assert.equal((await get('/', bad)).status, 302);
});

test('password change invalidates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lodestar-pw-'));
  try {
    const a = await startTestServer({ dataDir: dir, password: 'one' });
    const cookie = await a.login();
    assert.equal((await fetch(a.url + '/', { headers: { cookie }, redirect: 'manual' })).status, 200);
    await a.close();
    const b = await startTestServer({ dataDir: dir, password: 'two' });
    assert.equal((await fetch(b.url + '/', { headers: { cookie }, redirect: 'manual' })).status, 302);
    await b.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('logout', async () => {
  const r = await post('/api/logout', {});
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
});

test('api requires login', async () => {
  assert.equal((await get('/api/maps')).status, 401);
});
