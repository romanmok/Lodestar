import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';

export const TEST_PASSWORD = 'test-pass';

export async function startTestServer() {
  const dataDir = await mkdtemp(join(tmpdir(), 'lodestar-test-'));
  const app = createApp({ dataDir, password: TEST_PASSWORD });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    dataDir,
    async login() {
      throw new Error('login() not implemented until Task 2');
    },
    async close() {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
