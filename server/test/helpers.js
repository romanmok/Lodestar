import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';

export const TEST_PASSWORD = 'test-pass';

export async function startTestServer({ dataDir: givenDir, password = TEST_PASSWORD } = {}) {
  const dataDir = givenDir || await mkdtemp(join(tmpdir(), 'lodestar-test-'));
  const app = createApp({ dataDir, password });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    dataDir,
    // Logs in and returns a string usable as a `cookie:` request header.
    async login(pw = password) {
      const r = await fetch(`${url}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
      return r.headers.get('set-cookie').split(';')[0];
    },
    async close() {
      await app.close();
      if (!givenDir) await rm(dataDir, { recursive: true, force: true });
    },
  };
}
