import sharp from 'sharp';
import { buildKey } from '../storage/provider.js';

const MAX_ATTEMPTS = 4;

/**
 * Procesa en segundo plano: (1) antivirus, (2) miniatura y versión optimizada.
 * El ORIGINAL no se modifica jamás; las variantes son archivos nuevos y sin metadatos EXIF (se elimina el GPS).
 * Hasta terminar, el documento está 'processing' y no se puede descargar.
 */
export class DocumentWorker {
  constructor({ repo, storage, scanner, now = () => new Date(), log = console }) { Object.assign(this, { repo, storage, scanner, now, log }); }

  async runOnce() {
    const job = await this.repo.claimJob(this.now(), 5 * 60_000);
    if (!job) return false;
    try { await this.#process(job); await this.repo.finishJob(job.id, { ok: true }); }
    catch (e) {
      const last = job.attempts >= MAX_ATTEMPTS;
      this.log.error?.(`job ${job.id} intento ${job.attempts}: ${e.message}`);
      await this.repo.finishJob(job.id, { ok: false, error: e.message, retryAt: last ? undefined : new Date(this.now().getTime() + 2 ** job.attempts * 15_000) });
      if (last) {
        await this.repo.update(job.tenantId, job.documentId, { status: 'failed', rejectReason: 'No se pudo procesar' });
        await this.repo.audit({ tenantId: job.tenantId, documentId: job.documentId, action: 'process_fail', actorId: 'system', actorRole: 'system', detail: e.message });
      }
    }
    return true;
  }
  async drain(max = 1000) { let n = 0; while (n < max && await this.runOnce()) n++; return n; }
  start(intervalMs = 2000) {
    this.timer = setInterval(() => { if (!this.busy) { this.busy = true; this.drain(20).catch(e => this.log.error?.(e.message)).finally(() => this.busy = false); } }, intervalMs);
    this.timer.unref?.(); return this;
  }
  stop() { clearInterval(this.timer); }

  async #process({ tenantId, documentId }) {
    const d = await this.repo.get(tenantId, documentId);
    if (!d || d.status !== 'processing') return;
    const original = await this.storage.getBuffer(d.storageKey);

    const verdict = await this.scanner.scan(original);   // si el motor falla, lanza y se reintenta: nunca se aprueba sin escanear
    if (!verdict.clean) {
      await this.storage.delete(d.storageKey);
      await this.repo.update(tenantId, documentId, { status: 'rejected', rejectReason: `Archivo malicioso: ${verdict.signature}` });
      await this.repo.audit({ tenantId, documentId, action: 'scan_reject', actorId: 'system', actorRole: 'system', detail: verdict.signature });
      return;
    }

    const variants = {};
    if (d.width && d.height) {
      const base = () => sharp(original, { limitInputPixels: 200e6 }).rotate();   // respeta orientación EXIF; sharp descarta metadatos al exportar
      const make = async (name, size, quality) => {
        const { data, info } = await base().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer({ resolveWithObject: true });
        const key = buildKey(tenantId, documentId, name, 'webp', d.createdAt);
        await this.storage.put(key, data, { contentType: 'image/webp' });
        variants[name] = { key, mime: 'image/webp', width: info.width, height: info.height, size: data.length };
      };
      await make('thumb', 320, 70);
      await make('optimized', 1600, 80);
    }
    await this.repo.update(tenantId, documentId, { status: 'available', variants });
  }
}
