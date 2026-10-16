import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createAuth, isHttps } from './auth.js';
import { serveStatic } from './static.js';
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

export function createApp({ dataDir, password }) {
  const db = openDb(path.join(dataDir, 'lodestar.sqlite'));
  const auth = createAuth({ db, password });
  const ctx = { dataDir, password, db, auth };
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

    // Later tasks: add API routes here, before static.
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
