import crypto from 'node:crypto';

/** Repositorio en memoria: pruebas y desarrollo sin SQL Server. Misma interfaz que SqlRepository. */
export class MemoryRepository {
  constructor() { this.docs = new Map(); this.auditLog = []; this.jobs = []; this.seq = 0; }
  async insert(d) { this.docs.set(d.id, structuredClone(d)); }
  async get(tenantId, id) { const d = this.docs.get(id); return d && d.tenantId === tenantId ? structuredClone(d) : null; }
  async findDuplicate(tenantId, { patientId, kind, sha256 }) {
    for (const d of this.docs.values()) if (d.tenantId === tenantId && !d.deletedAt && d.sha256 === sha256 && d.kind === kind && (d.patientId ?? null) === (patientId ?? null) && d.status !== 'rejected') return structuredClone(d);
    return null;
  }
  async list(tenantId, f, { page, pageSize }) {
    let r = [...this.docs.values()].filter(d => d.tenantId === tenantId);
    if (!f.includeDeleted) r = r.filter(d => !d.deletedAt);
    for (const k of ['patientId', 'requestId', 'kind', 'ownerId', 'clinicId', 'status']) if (f[k] != null) r = r.filter(d => d[k] === f[k]);
    if (f.visibleToOwner) r = r.filter(d => d.visibleToOwner);
    r.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
    return { total: r.length, items: r.slice((page - 1) * pageSize, page * pageSize).map(x => structuredClone(x)) };
  }
  async update(tenantId, id, patch) { const d = this.docs.get(id); if (!d || d.tenantId !== tenantId) return; Object.assign(d, patch); }
  async audit(e) { this.auditLog.push({ at: new Date(), ...e }); }
  async enqueue(job) { this.jobs.push({ id: ++this.seq, status: 'pending', attempts: 0, runAfter: new Date(), ...job }); }
  async claimJob(now, lockMs) {
    const j = this.jobs.find(x => (x.status === 'pending' && x.runAfter <= now) || (x.status === 'running' && x.lockedUntil < now));
    if (!j) return null; j.status = 'running'; j.attempts++; j.lockedUntil = new Date(now.getTime() + lockMs); return { ...j };
  }
  async finishJob(id, { ok, error, retryAt }) { const j = this.jobs.find(x => x.id === id); j.status = ok ? 'done' : retryAt ? 'pending' : 'failed'; j.lastError = error; if (retryAt) j.runAfter = retryAt; }
  async listPurgeable(now, limit = 100) { return [...this.docs.values()].filter(d => d.deletedAt && d.retentionUntil <= now).slice(0, limit).map(x => structuredClone(x)); }
  async remove(tenantId, id) { const d = this.docs.get(id); if (d?.tenantId === tenantId) this.docs.delete(id); }
  async *allStorageKeys() { for (const d of this.docs.values()) { yield { tenantId: d.tenantId, id: d.id, key: d.storageKey }; for (const v of Object.values(d.variants ?? {})) yield { tenantId: d.tenantId, id: d.id, key: v.key }; } }
}
export const newId = () => crypto.randomUUID();
