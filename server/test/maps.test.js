import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startTestServer } from './helpers.js';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const APP = 'Battlemap Screen and GM Streaming Tool';
const dataUrl = (extra = '') => `data:image/png;base64,${PNG_B64}${extra}`;

function rec(id, state, name = 'My map') {
  return { id, app: APP, version: 3, name, savedAt: '2026-01-01T00:00:00.000Z', state };
}
const put = (s, cookie, id, body) => fetch(`${s.url}/api/maps/${encodeURIComponent(id)}`, {
  method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const get = (s, cookie, p) => fetch(s.url + p, { headers: { cookie } });

test('crud', async () => {
  const s = await startTestServer();
  try {
    const cookie = await s.login();
    const r = rec('my map', { imageName: 'a.png', floors: [] });
    assert.equal((await put(s, cookie, 'my map', r)).status, 200);
    const list = await (await get(s, cookie, '/api/maps')).json();
    assert.equal(list.length, 1);
    const one = await get(s, cookie, '/api/maps/my%20map');
    assert.equal(one.status, 200);
    assert.deepEqual(await one.json(), r);
    assert.equal((await get(s, cookie, '/api/maps/nope')).status, 404);
    assert.equal((await fetch(`${s.url}/api/maps/my%20map`, { method: 'DELETE', headers: { cookie } })).status, 204);
    assert.deepEqual(await (await get(s, cookie, '/api/maps')).json(), []);
  } finally { await s.close(); }
});

test('requires gm and validates', async () => {
  const s = await startTestServer();
  try {
    const cookie = await s.login();
    assert.equal((await fetch(`${s.url}/api/maps`)).status, 401);
    assert.equal((await put(s, cookie, 'x', { id: 'x', name: 'x' })).status, 400);
    assert.equal((await get(s, cookie, '/api/maps/%E0%A4%A')).status, 400);
  } finally { await s.close(); }
});

test('id mismatch', async () => {
  const s = await startTestServer();
  try {
    const cookie = await s.login();
    assert.equal((await put(s, cookie, 'a', rec('b', {}))).status, 400);
  } finally { await s.close(); }
});

const imgState = () => ({ imageName: 'a.png', floors: [{ imageData: dataUrl() }], tokens: [{ image: dataUrl() }] });

test('externalizes on save', async () => {
  const s = await startTestServer();
  try {
    const cookie = await s.login();
    await put(s, cookie, 'm', rec('m', imgState()));
    const got = await (await get(s, cookie, '/api/maps/m')).json();
    assert.match(got.state.floors[0].imageData, /^\/api\/images\//);
    assert.match(got.state.tokens[0].image, /^\/api\/images\//);
    const db = new DatabaseSync(join(s.dataDir, 'lodestar.sqlite'));
    const row = db.prepare('SELECT record FROM maps WHERE id = ?').get('m');
    db.close();
    assert.ok(!row.record.includes('data:image'));
  } finally { await s.close(); }
});

test('export inlines', async () => {
  const s = await startTestServer();
  try {
    const cookie = await s.login();
    await put(s, cookie, 'm', rec('m', imgState()));
    const r = await get(s, cookie, '/api/export');
    assert.equal(r.status, 200);
    const ex = await r.json();
    assert.equal(ex.app, APP);
    assert.equal(ex.version, 3);
    assert.ok(!Number.isNaN(Date.parse(ex.exportedAt)));
    assert.ok(ex.maps[0].state.floors[0].imageData.startsWith('data:image/png;base64,'));
  } finally { await s.close(); }
});

test('import of offline export', async () => {
  const s = await startTestServer();
  try {
    const cookie = await s.login();
    const exp = { app: APP, version: 3, exportedAt: 'x', maps: [
      rec('one', { floors: [{ imageData: dataUrl() }] }, 'One'),
      rec('two', { floors: [{ imageData: `data:image/png;base64,${Buffer.from('other-image').toString('base64')}` }] }, 'Two'),
    ] };
    for (const m of exp.maps) assert.equal((await put(s, cookie, m.id, m)).status, 200);
    for (const m of exp.maps) {
      const g = await (await get(s, cookie, `/api/maps/${m.id}`)).json();
      assert.match(g.state.floors[0].imageData, /^\/api\/images\//);
    }
    assert.equal(readdirSync(join(s.dataDir, 'images')).length, 2);
  } finally { await s.close(); }
});

test('session round-trip', async () => {
  const s = await startTestServer();
  try {
    const cookie = await s.login();
    assert.equal((await get(s, cookie, '/api/session')).status, 204);
    const state = { grid: { size: 70 }, bg: dataUrl() };
    const p = await fetch(`${s.url}/api/session`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ state }) });
    assert.equal(p.status, 200);
    const g = await get(s, cookie, '/api/session');
    assert.equal(g.status, 200);
    const body = await g.json();
    assert.equal(body.state.grid.size, 70);
    assert.match(body.state.bg, /^\/api\/images\//);
  } finally { await s.close(); }
});

test('json limit', async () => {
  const s = await startTestServer();
  try {
    const cookie = await s.login();
    const big = Buffer.alloc(51 * 1024 * 1024, 0x20);
    const r = await fetch(`${s.url}/api/maps/big`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: big });
    assert.equal(r.status, 413);
  } finally { await s.close(); }
});
