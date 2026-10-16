import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
};
const PUBLIC_DIRS = new Set(['manual', 'icons']);
const ONLINE_CONFIG = 'window.LODESTAR_ONLINE = true;\n';

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

// Handles GET/HEAD for public static files. Returns true if it responded.
export async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { notFound(res); return true; }
  if (decoded.includes('\0') || decoded.includes('\\')) { notFound(res); return true; }

  if (decoded === '/online-config.js') {
    res.writeHead(200, {
      'content-type': TYPES['.js'],
      'content-length': Buffer.byteLength(ONLINE_CONFIG),
      'cache-control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : ONLINE_CONFIG);
    return true;
  }

  if (decoded === '/') decoded = '/index.html';
  const rel = path.posix.normalize(decoded).replace(/^\/+/, '');
  const parts = rel.split('/');
  const ext = path.extname(rel).toLowerCase();
  const type = TYPES[ext];

  const allowed =
    type &&
    !parts.some((p) => p === '' || p === '..' || p.startsWith('.')) &&
    (parts.length === 1 || PUBLIC_DIRS.has(parts[0]));
  if (!allowed) { notFound(res); return true; }

  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) { notFound(res); return true; }

  let st;
  try { st = await stat(file); } catch { notFound(res); return true; }
  if (!st.isFile()) { notFound(res); return true; }

  res.writeHead(200, {
    'content-type': type,
    'content-length': st.size,
    'cache-control': 'no-cache',
  });
  if (req.method === 'HEAD') { res.end(); return true; }
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
  return true;
}
