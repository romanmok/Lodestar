import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX = fileURLToPath(new URL('../index.js', import.meta.url));

const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// Starts server/index.js and resolves with its "listening" log line.
async function startIndex(env) {
  const dataDir = await mkdtemp(join(tmpdir(), 'lodestar-index-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', INDEX], {
    env: { ...process.env, HOST: '', LODESTAR_GM_PASSWORD: 'x', DATA_DIR: dataDir, PORT: String(port), ...env },
  });
  try {
    const line = await new Promise((resolve, reject) => {
      let out = '';
      child.stdout.on('data', (c) => { out += c; if (out.includes('\n')) resolve(out.trim()); });
      child.on('exit', (code) => reject(new Error(`exited ${code}`)));
    });
    return { line, port };
  } finally {
    child.kill();
    await new Promise((r) => child.once('close', r));
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('listens on 127.0.0.1 by default', async () => {
  const { line, port } = await startIndex({});
  assert.ok(line.includes(`127.0.0.1:${port}`), line);
});

test('HOST overrides the listen address', async () => {
  const { line, port } = await startIndex({ HOST: '0.0.0.0' });
  assert.ok(line.includes(`0.0.0.0:${port}`), line);
});
