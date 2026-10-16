import http from 'node:http';
import { serveStatic } from './static.js';
import { HttpError, sendError } from './http-util.js';

export function createApp({ dataDir, password }) {
  const ctx = { dataDir, password };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    // Later tasks: add login / API routes here, before static.
    if (await serveStatic(req, res, url.pathname)) return;
    sendError(res, 404, 'Not found');
  }

  const server = http.createServer((req, res) => {
    handle(req, res, ctx).catch((err) => {
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
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}
