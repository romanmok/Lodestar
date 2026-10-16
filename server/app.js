import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createAuth, isHttps } from './auth.js';
import { serveStatic } from './static.js';
import { createImageStore, mimeToExt, extToMime, externalizeImages, inlineImages } from './images.js';
import { HttpError, sendError, readBody, sendJson } from './http-util.js';

// Canonical form of the request path (decoded, normalized, case-folded) so encoded
// or differently cased spellings of the entry page cannot slip past the guard.
function isEntryPage(pathname) {
  let d;
  try { d = decodeURIComponent(pathname); } catch { return true; }
  if (d.includes('\\')) return true;
  const rel = path.posix.normalize(d).replace(/^\/+/, '').toLowerCase();
  return rel === '' || rel === 'index.html';
}

const APP_NAME = 'Battlemap Screen and GM Streaming Tool'; // keep in sync with app.js
const SAVE_FILE_VERSION = 3;
const JSON_LIMIT = 50 * 1024 * 1024;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

async function readJson(req) {
  const buf = await readBody(req, JSON_LIMIT);
  try { return JSON.parse(buf.toString()); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp({ dataDir, password }) {
  const db = openDb(path.join(dataDir, 'lodestar.sqlite'));
  const auth = createAuth({ db, password });
  const images = createImageStore(path.join(dataDir, 'images'));
  const ctx = { dataDir, password, db, auth, images };
  const loginHtml = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'login.html'));

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (req.method === 'GET' && p === '/login') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': loginHtml.length });
      res.end(loginHtml);
      return;
    }
    if (req.method === 'POST' && p === '/api/login') {
      let pw;
      try { pw = JSON.parse((await readBody(req, 4096)).toString()).password; } catch (e) {
        if (e instanceof HttpError) throw e;
      }
      if (!auth.checkPassword(pw)) {
        await new Promise((r) => setTimeout(r, 1050));
        return sendError(res, 401, 'Wrong password');
      }
      res.setHeader('set-cookie', auth.issueCookie(isHttps(req)));
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/logout') {
      res.setHeader('set-cookie', auth.clearCookie(isHttps(req)));
      return sendJson(res, 200, { ok: true });
    }
    // Everything else under /api/ requires a GM session (checked before route lookup).
    if (p.startsWith('/api/') && !auth.requireGm(req, res)) return;
    // The HTML entry is GM-only; other static assets stay public.
    if (isEntryPage(p) && !auth.requireGm(req, res)) return;

    if (req.method === 'POST' && p === '/api/images') {
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!mimeToExt(mime)) {
        req.resume();
        return sendError(res, 415, 'Unsupported image type');
      }
      const buf = await readBody(req, 25 * 1024 * 1024); // 413 on overflow; remaining upload is drained
      if (!buf.length) return sendError(res, 400, 'Empty body');
      return sendJson(res, 201, images.save(buf, mime));
    }
    if (req.method === 'GET' && p.startsWith('/api/images/')) {
      let id = '';
      try { id = decodeURIComponent(p.slice('/api/images/'.length)); } catch { /* 404 */ }
      const file = images.path(id);
      if (!file) return sendError(res, 404, 'Not found');
      const bytes = fs.readFileSync(file);
      res.writeHead(200, {
        'content-type': extToMime(id),
        'content-length': bytes.length,
        'cache-control': 'private, max-age=31536000, immutable',
      });
      return void res.end(bytes);
    }

    if (p === '/api/maps' && req.method === 'GET') return sendJson(res, 200, db.listMaps());
    if (p.startsWith('/api/maps/')) {
      let id;
      try { id = decodeURIComponent(p.slice('/api/maps/'.length)); } catch { throw new HttpError(400, 'Bad id'); }
      if (req.method === 'GET') {
        const rec = db.getMap(id);
        return rec ? sendJson(res, 200, rec) : sendError(res, 404, 'Not found');
      }
      if (req.method === 'PUT') {
        const rec = await readJson(req);
        if (!isObj(rec) || typeof rec.id !== 'string' || typeof rec.name !== 'string' || !isObj(rec.state)) {
          throw new HttpError(400, 'Invalid map record');
        }
        if (rec.id !== id) throw new HttpError(400, 'Id mismatch');
        db.putMap(externalizeImages(rec, images));
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        db.deleteMap(id);
        res.writeHead(204);
        return void res.end();
      }
    }
    if (p === '/api/export' && req.method === 'GET') {
      return sendJson(res, 200, {
        app: APP_NAME,
        version: SAVE_FILE_VERSION,
        exportedAt: new Date().toISOString(),
        maps: inlineImages(db.listMaps(), images),
      });
    }
    if (p === '/api/session') {
      if (req.method === 'GET') {
        const state = db.kvGet('session');
        if (state === undefined) { res.writeHead(204); return void res.end(); }
        return sendJson(res, 200, { state });
      }
      if (req.method === 'PUT') {
        const body = await readJson(req);
        if (!isObj(body) || !isObj(body.state)) throw new HttpError(400, 'Invalid session');
        db.kvSet('session', externalizeImages(body.state, images));
        return sendJson(res, 200, { ok: true });
      }
    }

    if (await serveStatic(req, res, url.pathname)) return;
    sendError(res, 404, 'Not found');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) { res.destroy(); return; }
      if (err instanceof HttpError) return sendError(res, err.status, err.message);
      console.error(err);
      sendError(res, 500, 'Internal error');
    });
  });

  return {
    server,
    close() {
      return new Promise((resolve) => {
        server.close(() => { db.close(); resolve(); });
        server.closeAllConnections?.();
      });
    },
  };
}
