import path from 'node:path';
import { createApp } from './app.js';

const password = process.env.LODESTAR_GM_PASSWORD;
if (!password) {
  console.error('LODESTAR_GM_PASSWORD is required. Set it in the environment and restart.');
  process.exit(1);
}
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '127.0.0.1';
const dataDir = path.resolve(process.env.DATA_DIR || './data');

const app = createApp({ dataDir, password });
app.server.listen(port, host, () => {
  const { address } = app.server.address();
  console.log(`Lodestar server listening on ${address}:${port} (data: ${dataDir})`);
});
