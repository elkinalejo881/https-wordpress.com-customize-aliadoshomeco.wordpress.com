import crypto from 'node:crypto';
import { AppError, invalid, notFound } from '../errors.js';
import { KIND_NAMES, kindPolicy } from './kinds.js';
import { inspectFile, sanitizeFilename } from './validation.js';
import { assertCanDelete, assertCanUpload, assertVisible, canDownload, listScope } from './authz.js';
import { buildKey } from '../storage/provider.js';

const ID_RE = /^[A-Za-z0-9_\-]{1,64}$/;
const cleanId = (v, name) => { if (v == null || v === '') return null; if (!ID_RE.test(v)) throw invalid('BAD_FIELD', `${name} inválido`); return v; };
const addYears = (d, y) => { const r = new Date(d); r.setUTCFullYear(r.getUTCFullYear() + y); return r; };

/** Lógica de negocio. Depende solo de las interfaces: StorageProvider, repositorio y scanner. */
export class DocumentService {
  constructor({ repo, storage, cfg, now = () => new Date() }) { this.repo = repo; this.storage = storage; this.cfg = cfg; this.now = now; }

  #audit(p, action, documentId, detail, ip) {
    return this.repo.audit({ tenantId: p.tenantId, documentId, action, actorId: p.userId, actorRole: p.role, ip, detail });
  }

  /** Recibe un archivo; valida; guarda el original inmutable en estado 'processing'; encola el análisis y las miniaturas. */
  async upload(p, { buffer, filename, meta }, ip) {
    const policy = kindPolicy(meta.kind, this.cfg);
    if (!policy) throw invalid('BAD_KIND', `Tipo de documento inválido. Válidos: ${KIND_NAMES.join(', ')}`);
    const m = {
      kind: meta.kind, patientId: cleanId(meta.patientId, 'patientId'), ownerId: cleanId(meta.ownerId, 'ownerId'),
      clinicId: cleanId(meta.clinicId ?? (p.role === 'vet' ? p.clinicId : null), 'clinicId'),
      veterinarianId: cleanId(meta.veterinarianId, 'veterinarianId'), requestId: cleanId(meta.requestId, 'requestId'),
    };
    if (!m.patientId && !m.requestId) throw invalid('BAD_FIELD', 'Indique patientId o requestId');
    assertCanUpload(p, m);

    const info = await inspectFile(buffer, policy);
    const dup = await this.repo.findDuplicate(p.tenantId, { patientId: m.patientId, kind: m.kind, sha256: info.sha256 });
    if (dup) { await this.#audit(p, 'duplicate', dup.id, 'Archivo idéntico ya existente', ip); return { document: dup, duplicate: true }; }

    const id = crypto.randomUUID(), at = this.now();
    const key = buildKey(p.tenantId, id, 'original', info.ext, at);
    await this.storage.put(key, buffer, { contentType: info.mime });
    const doc = {
      id, tenantId: p.tenantId, ...m, status: 'processing', filename: sanitizeFilename(filename), mime: info.mime, sizeBytes: buffer.length, sha256: info.sha256,
      storageKey: key, width: info.width, height: info.height, visibleToOwner: meta.visibleToOwner ?? policy.ownerVisible, uploadedBy: p.userId,
      createdAt: at, retentionUntil: addYears(at, policy.retentionYears), deletedAt: null, deletedBy: null, rejectReason: null, variants: {},
    };
    try { await this.repo.insert(doc); } catch (e) { await this.storage.delete(key).catch(() => {}); throw e; } // sin huérfanos
    await this.repo.enqueue({ documentId: id, tenantId: p.tenantId });
    await this.#audit(p, 'upload', id, `${m.kind} ${info.mime} ${buffer.length}B`, ip);
    return { document: doc, duplicate: false };
  }

  async list(p, q, ip) {
    const page = Math.max(1, Number(q.page) || 1), pageSize = Math.min(this.cfg.maxPageSize, Math.max(1, Number(q.pageSize) || 24));
    if (q.kind && !KIND_NAMES.includes(q.kind)) throw invalid('BAD_KIND', 'Tipo inválido');
    const f = { ...listScope(p), patientId: cleanId(q.patientId, 'patientId'), requestId: cleanId(q.requestId, 'requestId'), kind: q.kind ?? null };
    // un filtro del usuario nunca puede ampliar el alcance de su rol
    const { items, total } = await this.repo.list(p.tenantId, f, { page, pageSize });
    await this.#audit(p, 'list', null, `n=${items.length} p=${page}`, ip);
    const out = [];
    for (const d of items) out.push(await this.#view(p, d, true));
    return { items: out, page, pageSize, total, hasMore: page * pageSize < total };
  }

  async get(p, id) { const d = await this.repo.get(p.tenantId, id); assertVisible(p, d); return this.#view(p, d, true); }

  async #view(p, d, withThumb) {
    const v = {
      id: d.id, kind: d.kind, status: d.status, filename: d.filename, mime: d.mime, sizeBytes: d.sizeBytes, width: d.width, height: d.height, patientId: d.patientId,
      requestId: d.requestId, clinicId: d.clinicId, ownerId: d.ownerId, visibleToOwner: d.visibleToOwner, createdAt: d.createdAt, deleted: !!d.deletedAt,
      hasThumbnail: !!d.variants?.thumb, thumbnailUrl: null,
    };
    if (withThumb && d.status === 'available' && d.variants?.thumb) {
      v.thumbnailUrl = await this.storage.signedUrl(d.variants.thumb.key, { expiresInSec: this.cfg.thumbUrlSec, contentType: d.variants.thumb.mime });
    }
    return v;
  }

  /** Cada solicitud de visualización/descarga revalida permisos y deja registro; devuelve URL firmada de corta duración. */
  async signedDownload(p, id, { variant = 'original', disposition = 'inline' }, ip) {
    const d = await this.repo.get(p.tenantId, id); canDownload(p, d);
    if (!['inline', 'attachment'].includes(disposition)) throw invalid('BAD_FIELD', 'disposition inválido');
    let key = d.storageKey, mime = d.mime;
    if (variant !== 'original') {
      const v = d.variants?.[variant]; if (!v) throw notFound();
      key = v.key; mime = v.mime;
    }
    const url = await this.storage.signedUrl(key, { expiresInSec: this.cfg.signedUrlSec, filename: d.filename, disposition, contentType: mime });
    await this.#audit(p, disposition === 'attachment' ? 'download' : 'view', id, variant, ip);
    return { url, expiresAt: new Date(this.now().getTime() + this.cfg.signedUrlSec * 1000).toISOString(), mime, filename: d.filename };
  }

  /** Borrado lógico: el objeto se conserva hasta RetentionUntil (recuperable). */
  async remove(p, id, ip) {
    assertCanDelete(p); const d = await this.repo.get(p.tenantId, id); assertVisible(p, d);
    await this.repo.update(p.tenantId, id, { deletedAt: this.now(), deletedBy: p.userId });
    await this.#audit(p, 'delete', id, null, ip);
  }
  async restore(p, id, ip) {
    assertCanDelete(p); const d = await this.repo.get(p.tenantId, id); assertVisible(p, d);
    await this.repo.update(p.tenantId, id, { deletedAt: null, deletedBy: null });
    await this.#audit(p, 'restore', id, null, ip);
  }

  /** Purga definitiva SOLO de lo borrado cuya retención venció. Ejecutar desde un proceso programado. */
  async purgeExpired() {
    let n = 0;
    for (const d of await this.repo.listPurgeable(this.now())) {
      for (const k of [d.storageKey, ...Object.values(d.variants ?? {}).map(v => v.key)]) await this.storage.delete(k);
      await this.repo.remove(d.tenantId, d.id);
      await this.repo.audit({ tenantId: d.tenantId, documentId: d.id, action: 'purge', actorId: 'system', actorRole: 'system', detail: 'Retención vencida' }); n++;
    }
    return n;
  }
}
export { AppError };
