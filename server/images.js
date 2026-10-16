import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
export const ID_RE = /^[0-9a-f]{32}\.(png|jpg|webp|gif)$/;
const DATA_URL_RE = /^data:image\/(png|jpeg|webp|gif);base64,/;
const API_URL_RE = /^\/api\/images\/([0-9a-f]{32}\.(?:png|jpg|webp|gif))$/;

export function mimeToExt(mime) { return EXT_BY_MIME[mime] || null; }
export function extToMime(id) { return MIME_BY_EXT[id.slice(id.lastIndexOf('.') + 1)]; }

export function createImageStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = (id) => (typeof id === 'string' && ID_RE.test(id) ? path.join(dir, id) : null);
  return {
    save(buf, mime) {
      const ext = EXT_BY_MIME[mime];
      if (!ext) throw new Error(`Unsupported image type: ${mime}`);
      const id = `${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32)}.${ext}`;
      const p = path.join(dir, id);
      if (!fs.existsSync(p)) {
        const tmp = `${p}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, p);
      }
      return { id, url: `/api/images/${id}` };
    },
    path(id) {
      const p = filePath(id);
      return p && fs.existsSync(p) ? p : null;
    },
    toDataUrl(id) {
      const p = this.path(id);
      if (!p) return null;
      return `data:${extToMime(id)};base64,${fs.readFileSync(p).toString('base64')}`;
    },
  };
}

function walk(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, fn));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, fn);
    return out;
  }
  return value;
}

export function externalizeImages(value, store) {
  return walk(value, (s) => {
    const m = DATA_URL_RE.exec(s);
    if (!m) return s;
    const mime = `image/${m[1]}`;
    const payload = s.slice(m[0].length).replace(/\s+/g, '');
    const buf = Buffer.from(payload, 'base64');
    // Leave empty or non-base64 payloads untouched rather than store a corrupt file.
    if (!buf.length || buf.toString('base64').replace(/=+$/, '') !== payload.replace(/=+$/, '')) return s;
    return store.save(buf, mime).url;
  });
}

export function inlineImages(value, store) {
  return walk(value, (s) => {
    const m = API_URL_RE.exec(s);
    if (!m) return s;
    return store.toDataUrl(m[1]) ?? s;
  });
}
