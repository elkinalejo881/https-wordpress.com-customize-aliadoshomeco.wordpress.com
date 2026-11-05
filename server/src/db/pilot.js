import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import { MemoryRepository } from './memory.js';
import { AppError } from '../errors.js';

const DATE_KEYS = new Set(['createdAt', 'updatedAt', 'retentionUntil', 'deletedAt', 'runAfter', 'lockedUntil', 'at']);
const reviver = (k, v) => (DATE_KEYS.has(k) && typeof v === 'string' ? new Date(v) : v);

/**
 * Almacén del PILOTO: documentos (heredado de MemoryRepository) + dominio (laboratorios, usuarios, portafolio, solicitudes).
 * Se guarda en un archivo JSON (escritura atómica) para sobrevivir reinicios. NO es una base de datos multiusuario:
 * sirve para la prueba/piloto con pocos usuarios. El diseño de producción es SQL Server (ver docs/PILOTO.md).
 */
export class PilotStore extends MemoryRepository {
  constructor({ file = null } = {}) {
    super(); this.file = file; this.timer = null;
    this.labs = new Map(); this.users = new Map(); this.services = new Map(); this.links = new Map(); this.requests = new Map(); this.counters = {};
  }
  static async open(file) { const s = new PilotStore({ file }); if (file) await s.#load(); return s; }

  // ---------- persistencia ----------
  async #load() {
    let txt; try { txt = await fs.readFile(this.file, 'utf8'); } catch { return; }
    const d = JSON.parse(txt, reviver);
    for (const k of ['docs', 'labs', 'users', 'services', 'links', 'requests']) this[k] = new Map(d[k] ?? []);
    this.auditLog = d.auditLog ?? []; this.jobs = d.jobs ?? []; this.seq = d.seq ?? 0; this.counters = d.counters ?? {};
  }
  #snapshot() {
    return JSON.stringify({ docs: [...this.docs], labs: [...this.labs], users: [...this.users], services: [...this.services], links: [...this.links], requests: [...this.requests], auditLog: this.auditLog.slice(-20000), jobs: this.jobs.filter(j => j.status !== 'done').slice(-5000), seq: this.seq, counters: this.counters });
  }
  save() { // agrupa escrituras (máx. 1 por segundo)
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush().catch(e => console.error('No se pudo guardar:', e.message)); }, 800); this.timer.unref?.();
  }
  async flush() {
    if (!this.file) return; const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, this.#snapshot(), { mode: 0o600 }); await fs.rename(tmp, this.file);
  }
  // los métodos de documentos también disparan guardado
  async insert(d) { await super.insert(d); this.save(); }
  async update(t, id, p) { await super.update(t, id, p); this.save(); }
  async audit(e) { await super.audit(e); this.save(); }
  async enqueue(j) { await super.enqueue(j); this.save(); }
  async finishJob(id, r) { await super.finishJob(id, r); this.save(); }
  async remove(t, id) { await super.remove(t, id); this.save(); }

  // ---------- laboratorios ----------
  createLab(l) { if (this.labs.has(l.id)) throw new AppError(409, 'LAB_EXISTS', 'Ya existe un laboratorio con ese identificador'); this.labs.set(l.id, structuredClone(l)); this.save(); return l; }
  getLab(id) { const l = this.labs.get(id); return l ? structuredClone(l) : null; }
  listLabs() { return [...this.labs.values()].map(l => structuredClone(l)).sort((a, b) => a.name.localeCompare(b.name, 'es')); }
  updateLab(id, patch) { const l = this.labs.get(id); if (!l) return null; Object.assign(l, patch); this.save(); return structuredClone(l); }

  // ---------- usuarios ----------
  createUser(u) {
    if (this.getUserByEmail(u.email)) throw new AppError(409, 'EMAIL_EXISTS', 'Ese correo ya está registrado');
    this.users.set(u.id, structuredClone(u)); this.save(); return u;
  }
  getUser(id) { const u = this.users.get(id); return u ? structuredClone(u) : null; }
  getUserByEmail(email) { const e = String(email).toLowerCase(); for (const u of this.users.values()) if (u.email === e) return structuredClone(u); return null; }
  updateUser(id, patch) { const u = this.users.get(id); if (u) { Object.assign(u, patch); this.save(); } }
  listUsers(filter) { return [...this.users.values()].filter(filter).map(u => structuredClone(u)); }

  // ---------- portafolio ----------
  saveService(s) { this.services.set(s.id, structuredClone(s)); this.save(); return s; }
  getService(labId, id) { const s = this.services.get(id); return s && s.labId === labId ? structuredClone(s) : null; }
  listServices(labId, { all = false } = {}) {
    return [...this.services.values()].filter(s => s.labId === labId && (all || s.active)).map(s => structuredClone(s))
      .sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es'));
  }

  // ---------- vínculos veterinario <-> laboratorio ----------
  getLink(labId, vetId) { const l = this.links.get(`${labId}|${vetId}`); return l ? structuredClone(l) : null; }
  setLink(labId, vetId, status) {
    const k = `${labId}|${vetId}`, cur = this.links.get(k), now = new Date();
    this.links.set(k, { labId, vetId, status, createdAt: cur?.createdAt ?? now, updatedAt: now }); this.save(); return this.getLink(labId, vetId);
  }
  listLinks(f) { return [...this.links.values()].filter(f).map(l => structuredClone(l)); }

  // ---------- solicitudes ----------
  nextCounter(name) { this.counters[name] = (this.counters[name] ?? 0) + 1; this.save(); return this.counters[name]; }
  createRequest(r) { this.requests.set(r.id, structuredClone(r)); this.save(); return structuredClone(r); }
  getRequest(labId, id) { const r = this.requests.get(id); return r && r.labId === labId ? structuredClone(r) : null; }
  updateRequest(labId, id, patch) { const r = this.requests.get(id); if (!r || r.labId !== labId) return null; Object.assign(r, patch, { updatedAt: new Date() }); this.save(); return structuredClone(r); }
  listRequests(f, { page = 1, pageSize = 25 } = {}) {
    let r = [...this.requests.values()];
    if (f.labId) r = r.filter(x => x.labId === f.labId);
    if (f.vetId) r = r.filter(x => x.vetId === f.vetId);
    if (f.status) r = r.filter(x => x.status === f.status);
    if (f.from) r = r.filter(x => x.createdAt >= f.from);
    if (f.to) r = r.filter(x => x.createdAt <= f.to);
    if (f.q) { const q = f.q.toLowerCase(); r = r.filter(x => `${x.code} ${x.clinicName} ${x.pats.map(p => `${p.name} ${p.owner ?? ''} ${p.no ?? ''}`).join(' ')}`.toLowerCase().includes(q)); }
    r.sort((a, b) => b.createdAt - a.createdAt);
    return { total: r.length, items: r.slice((page - 1) * pageSize, page * pageSize).map(x => structuredClone(x)) };
  }
}
export const uid = () => crypto.randomUUID();
