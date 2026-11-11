import crypto from 'node:crypto';
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 64;
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 }, (e, k) => e ? rej(e) : res(k)));

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16); return `scrypt$${salt.toString('base64')}$${(await scrypt(pw, salt)).toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored).split('$'); if (alg !== 'scrypt' || !s || !h) return false;
  const got = await scrypt(pw, Buffer.from(s, 'base64')), exp = Buffer.from(h, 'base64');
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}
/** Limitador en memoria: máx. `max` intentos por clave en `windowMs` (contra fuerza bruta en el login). */
export class RateLimiter {
  constructor(max = 8, windowMs = 15 * 60_000) { this.max = max; this.w = windowMs; this.m = new Map(); }
  hit(key) { const now = Date.now(), a = (this.m.get(key) ?? []).filter(t => now - t < this.w); a.push(now); this.m.set(key, a); if (this.m.size > 5000) this.m.clear(); return a.length <= this.max; }
  reset(key) { this.m.delete(key); }
}
