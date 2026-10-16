import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, TEST_PASSWORD } from './helpers.js';

const login = (srv, password) =>
  fetch(srv.url + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });

test('parallel wrong logins are serialized', async () => {
  const srv = await startTestServer();
  try {
    const t = Date.now();
    const rs = await Promise.all(Array.from({ length: 5 }, () => login(srv, 'nope')));
    const elapsed = Date.now() - t;
    for (const r of rs) assert.equal(r.status, 401);
    assert.ok(elapsed >= 5000, `took ${elapsed} ms`);
  } finally {
    await srv.close();
  }
});

test('lockout after 10 consecutive failures', async () => {
  const srv = await startTestServer({ loginDelayMs: 5, lockoutBaseMs: 300 });
  try {
    for (let i = 0; i < 10; i++) assert.equal((await login(srv, 'nope')).status, 401, `attempt ${i + 1}`);
    const r = await login(srv, TEST_PASSWORD);
    assert.equal(r.status, 429);
    assert.deepEqual(await r.json(), { error: 'Too many attempts, try again later' });
    assert.equal(r.headers.get('set-cookie'), null);
    await new Promise((res) => setTimeout(res, 350));
    assert.equal((await login(srv, TEST_PASSWORD)).status, 200);
    // the success reset the counter: no immediate lockout on the next failure
    assert.equal((await login(srv, 'nope')).status, 401);
    assert.equal((await login(srv, TEST_PASSWORD)).status, 200);
  } finally {
    await srv.close();
  }
});

test('lockout doubles on repeated failure', async () => {
  const srv = await startTestServer({ loginDelayMs: 5, lockoutBaseMs: 200 });
  try {
    for (let i = 0; i < 10; i++) await login(srv, 'nope');
    await new Promise((res) => setTimeout(res, 250));
    assert.equal((await login(srv, 'nope')).status, 401); // 11th failure -> 400 ms lockout
    await new Promise((res) => setTimeout(res, 250));
    assert.equal((await login(srv, TEST_PASSWORD)).status, 429);
    await new Promise((res) => setTimeout(res, 200));
    assert.equal((await login(srv, TEST_PASSWORD)).status, 200);
  } finally {
    await srv.close();
  }
});

test('success resets the failure counter', async () => {
  const srv = await startTestServer({ loginDelayMs: 5, lockoutBaseMs: 60000 });
  try {
    for (let i = 0; i < 9; i++) await login(srv, 'nope');
    assert.equal((await login(srv, TEST_PASSWORD)).status, 200);
    for (let i = 0; i < 9; i++) assert.equal((await login(srv, 'nope')).status, 401);
    assert.equal((await login(srv, TEST_PASSWORD)).status, 200);
  } finally {
    await srv.close();
  }
});
