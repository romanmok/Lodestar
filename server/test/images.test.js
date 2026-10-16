import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startTestServer } from './helpers.js';
import { createImageStore, externalizeImages, inlineImages } from '../images.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');
const CC = 'private, max-age=31536000, immutable';

async function post(s, cookie, body, type = 'image/png') {
  return fetch(`${s.url}/api/images`, { method: 'POST', headers: { ...(cookie ? { cookie } : {}), 'content-type': type }, body });
}

test('upload and fetch', async () => {
  const s = await startTestServer();
  try {
    const cookie = await s.login();
    const r = await post(s, cookie, PNG);
    assert.equal(r.status, 201);
    const { id, url } = await r.json();
    assert.match(id, /^[0-9a-f]{32}\.png$/);
    assert.equal(url, `/api/images/${id}`);
    const g = await fetch(s.url + url, { headers: { cookie } });
    assert.equal(g.status, 200);
    assert.equal(g.headers.get('content-type'), 'image/png');
    assert.equal(g.headers.get('cache-control'), CC);
    assert.deepEqual(Buffer.from(await g.arrayBuffer()), PNG);
  } finally { await s.close(); }
});

test('dedupe', async () => {
  const s = await startTestServer();
  try {
    const cookie = await s.login();
    const a = await (await post(s, cookie, PNG)).json();
    const b = await (await post(s, cookie, PNG)).json();
    assert.equal(a.id, b.id);
    assert.equal(readdirSync(join(s.dataDir, 'images')).length, 1);
  } finally { await s.close(); }
});

test('requires GM', async () => {
  const s = await startTestServer();
  try {
    assert.equal((await post(s, null, PNG)).status, 401);
    assert.equal((await fetch(`${s.url}/api/images/${'a'.repeat(32)}.png`)).status, 401);
  } finally { await s.close(); }
});

test('rejects type', async () => {
  const s = await startTestServer();
  try {
    const cookie = await s.login();
    assert.equal((await post(s, cookie, '<html>', 'text/html')).status, 415);
  } finally { await s.close(); }
});

test('rejects size', async () => {
  const s = await startTestServer();
  try {
    const cookie = await s.login();
    const r = await post(s, cookie, Buffer.alloc(26 * 1024 * 1024));
    assert.equal(r.status, 413);
    const n = await fetch(`${s.url}/login`);
    assert.equal(n.status, 200);
  } finally { await s.close(); }
});

test('bad id', async () => {
  const s = await startTestServer();
  try {
    const cookie = await s.login();
    for (const p of ['..%2fsqlite', 'zzz']) {
      const r = await fetch(`${s.url}/api/images/${p}`, { headers: { cookie } });
      assert.equal(r.status, 404);
    }
  } finally { await s.close(); }
});

test('externalizeImages / inlineImages', () => {
  const store = createImageStore(join(mkdtempSync(join(tmpdir(), 'img-')), 'images'));
  const dataUrl = `data:image/png;base64,${PNG_B64}`;
  const input = { a: [{ src: dataUrl }], b: 'x' };
  const snapshot = JSON.stringify(input);
  const out = externalizeImages(input, store);
  assert.equal(JSON.stringify(input), snapshot);
  const { id } = store.save(PNG, 'image/png');
  assert.deepEqual(out, { a: [{ src: `/api/images/${id}` }], b: 'x' });
  assert.deepEqual(inlineImages(out, store), input);
  assert.equal(inlineImages('/api/images/' + 'a'.repeat(32) + '.png', store), '/api/images/' + 'a'.repeat(32) + '.png');
});

test('externalizeImages leaves empty/invalid base64 unchanged', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'img-')), 'images');
  const store = createImageStore(dir);
  const bad = ['data:image/png;base64,', 'data:image/png;base64,!!!@@@', 'data:image/png;base64,abc$def', 'data:image/png;base64,   '];
  assert.deepEqual(externalizeImages(bad, store), bad);
  assert.equal(readdirSync(dir).length, 0);
  const ok = `data:image/png;base64,${PNG_B64.slice(0, 20)}\n${PNG_B64.slice(20)}`;
  assert.match(externalizeImages(ok, store), /^\/api\/images\/[0-9a-f]{32}\.png$/);
});
