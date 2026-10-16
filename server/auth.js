import crypto from 'node:crypto';
import { sendError } from './http-util.js';

export const COOKIE_NAME = 'lodestar_gm';
const MAX_AGE_S = 30 * 24 * 60 * 60;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

export function isHttps(req) {
  return req.socket.encrypted === true || req.headers['x-forwarded-proto'] === 'https';
}

export function createAuth({ db, password }) {
  let secret = db.kvGet('secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    db.kvSet('secret', secret);
  }
  const key = sha256(secret + password);
  const sign = (text) => crypto.createHmac('sha256', key).update(text).digest('hex');
  const pwDigest = sha256(password);

  function checkPassword(pw) {
    if (typeof pw !== 'string') return false;
    return crypto.timingSafeEqual(sha256(pw), pwDigest);
  }

  function attrs(secure, maxAge) {
    return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }

  function issueCookie(secure) {
    const expiry = String(Date.now() + MAX_AGE_S * 1000);
    return `${COOKIE_NAME}=${expiry}.${sign(expiry)}; ${attrs(secure, MAX_AGE_S)}`;
  }

  function clearCookie(secure) {
    return `${COOKIE_NAME}=; ${attrs(secure, 0)}`;
  }

  function isGm(req) {
    const header = req.headers.cookie;
    if (!header) return false;
    for (const part of header.split(';')) {
      const i = part.indexOf('=');
      if (i < 0 || part.slice(0, i).trim() !== COOKIE_NAME) continue;
      const [expiry, mac, extra] = part.slice(i + 1).trim().split('.');
      if (!expiry || !mac || extra !== undefined || !/^\d+$/.test(expiry)) return false;
      const want = Buffer.from(sign(expiry), 'hex');
      const got = Buffer.from(mac, 'hex');
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return false;
      return Number(expiry) > Date.now();
    }
    return false;
  }

  // Reusable guard: 401 JSON for /api/*, 302 to /login for pages. Returns true when allowed.
  function requireGm(req, res) {
    if (isGm(req)) return true;
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) sendError(res, 401, 'Login required');
    else { res.writeHead(302, { location: '/login' }); res.end(); }
    return false;
  }

  return { checkPassword, issueCookie, clearCookie, isGm, requireGm };
}
