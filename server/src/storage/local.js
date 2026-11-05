import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertKey } from './provider.js';

/** Proveedor en disco: desarrollo, pruebas y respaldo on-premise. Las URLs firmadas las sirve la propia API (/_blob/:token). */
export class LocalFsStorage {
  constructor({ root, publicBaseUrl, signingSecret }) {
    if (!signingSecret || signingSecret.length < 16) throw new Error('signingSecret demasiado corto');
    this.root = path.resolve(root); this.base = publicBaseUrl.replace(/\/$/, ''); this.secret = signingSecret;
  }
  #path(key) {
    assertKey(key);
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error('Clave fuera de la raíz');
    return p;
  }
  async put(key, data) {
    const p = this.#path(key); await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${crypto.randomUUID()}.tmp`; await fs.writeFile(tmp, data); await fs.rename(tmp, p);
  }
  getBuffer(key) { return fs.readFile(this.#path(key)); }
  async exists(key) { try { await fs.access(this.#path(key)); return true; } catch { return false; } }
  async delete(key) { await fs.rm(this.#path(key), { force: true }); }
  async *list(prefix) {
    const walk = async function* (dir) {
      let ents; try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) { const f = path.join(dir, e.name); if (e.isDirectory()) yield* walk(f); else if (!e.name.endsWith('.tmp')) yield f; }
    };
    const pre = prefix.replace(/\/$/, '');
    for await (const f of walk(pre ? this.#path(pre) : this.root)) yield path.relative(this.root, f).split(path.sep).join('/');
  }
  async signedUrl(key, { expiresInSec, filename, disposition = 'inline', contentType = 'application/octet-stream' }) {
    assertKey(key);
    const body = Buffer.from(JSON.stringify({ k: key, e: Math.floor(Date.now() / 1000) + expiresInSec, d: disposition, f: filename, c: contentType })).toString('base64url');
    return `${this.base}/_blob/${body}.${this.#mac(body)}`;
  }
  #mac(body) { return crypto.createHmac('sha256', this.secret).update(body).digest('base64url'); }
  /** Valida token y devuelve lo necesario para responder; null si es inválido o venció. */
  async resolveToken(token) {
    const [body, sig] = String(token).split('.');
    if (!body || !sig) return null;
    const a = Buffer.from(sig), b = Buffer.from(this.#mac(body));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
    if (!p.e || p.e < Date.now() / 1000) return null;
    try { return { data: await this.getBuffer(p.k), disposition: p.d, filename: p.f, contentType: p.c }; } catch { return null; }
  }
}
