import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { readFile } from 'node:fs/promises';
import { AppError, invalid, forbidden } from '../errors.js';
import { verifyToken } from '../auth.js';
import { KINDS, kindPolicy } from '../documents/kinds.js';
import { DocumentService } from '../documents/service.js';
import { DomainService } from '../domain/service.js';
import { registerApi } from './api.js';

const page = n => new URL(`../../public/${n}`, import.meta.url);
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; frame-src 'self' https:; font-src 'self'; manifest-src 'self'; worker-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export async function buildApp({ cfg, repo, storage, logger = false }) {
  const app = Fastify({ logger, trustProxy: true, maxParamLength: 2048, bodyLimit: 1024 * 1024 });
  const svc = new DocumentService({ repo, storage, cfg });
  const domain = new DomainService({ store: repo, docs: svc, cfg, log: app.log });
  const maxBytes = Math.max(...Object.keys(KINDS).map(k => kindPolicy(k, cfg).maxBytes));
  await app.register(multipart, { limits: { fileSize: maxBytes, files: cfg.maxFilesPerUpload, fields: 20, parts: cfg.maxFilesPerUpload + 20 } });

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    if (!reply.getHeader('cache-control')) reply.header('Cache-Control', 'private, no-store');
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'FILE_TOO_LARGE', message: 'Archivo demasiado grande' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'BAD_REQUEST', message: 'Solicitud inválida' });
    req.log.error(err); reply.code(500).send({ error: 'INTERNAL', message: 'Error interno' });   // sin detalles internos al cliente
  });
  const authUser = req => { const h = req.headers.authorization ?? ''; return domain.getUser(verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '', cfg.jwtSecret).userId); };
  /** Principal del servicio documental. El veterinario indica el laboratorio con X-Lab; se valida que esté aprobado. */
  const auth = req => {
    const u = authUser(req);
    if (u.role === 'vet') { const lab = req.headers['x-lab']; if (!lab) throw invalid('LAB_REQUIRED', 'Falta indicar el laboratorio (X-Lab)'); return domain.docPrincipal(u, String(lab)); }
    return domain.docPrincipal(u, u.labId);
  };

  app.get('/healthz', async () => ({ ok: true }));
  const html = (name) => async (req, reply) => reply.type('text/html; charset=utf-8').header('Content-Security-Policy', CSP).send(await readFile(page(name), 'utf8'));
  app.get('/', html('app.html')); app.get('/documentos', html('documentos.html'));
  // Archivos estáticos de la interfaz (lista cerrada por extensión; nombres sin rutas)
  const MIME = { css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', png: 'image/png', woff2: 'font/woff2', webmanifest: 'application/manifest+json' };
  const sendAsset = (sub, name, reply, extra = {}) => {
    const ext = /^[a-z0-9][a-z0-9._-]*\.([a-z0-9]+)$/.exec(name)?.[1];
    if (!ext || !MIME[ext] || name.includes('..')) return reply.code(404).send();
    return readFile(new URL(`../../public/assets/${sub}${name}`, import.meta.url)).then(buf => reply.type(MIME[ext]).header('Cache-Control', ext === 'woff2' || ext === 'png' ? 'public, max-age=86400' : 'no-cache').headers(extra).send(buf), () => reply.code(404).send());
  };
  app.get('/assets/:name', (req, reply) => sendAsset('', req.params.name, reply));
  app.get('/assets/fonts/:name', (req, reply) => sendAsset('fonts/', req.params.name, reply));
  app.get('/manifest.webmanifest', (req, reply) => sendAsset('', 'manifest.webmanifest', reply));
  app.get('/sw.js', async (req, reply) => reply.type('text/javascript; charset=utf-8').header('Cache-Control', 'no-cache').header('Service-Worker-Allowed', '/').send(await readFile(new URL('../../public/assets/sw.js', import.meta.url))));

  app.post('/api/documents', async (req, reply) => {
    const user = authUser(req), p = auth(req), fields = {}, files = [];
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        try { files.push({ filename: part.filename, buffer: await part.toBuffer() }); }
        catch (e) { files.push({ filename: part.filename, error: e.code === 'FST_REQ_FILE_TOO_LARGE' ? { code: 'FILE_TOO_LARGE', message: 'Archivo demasiado grande' } : { code: 'READ_ERROR', message: 'No se pudo leer el archivo' } }); }
      } else fields[part.fieldname] = String(part.value).slice(0, 200);
    }
    if (!files.length) throw invalid('NO_FILES', 'No se recibió ningún archivo');
    if (p.role === 'vet') { // el veterinario solo adjunta material de SUS solicitudes; nunca resultados del laboratorio
      if (!['attachment', 'patient_photo', 'sample_photo'].includes(fields.kind)) throw forbidden('Solo puede adjuntar fotos o documentos de apoyo');
      if (!fields.requestId) throw invalid('BAD_FIELD', 'Indique la solicitud (requestId)');
    }
    const bound = fields.requestId ? domain.bindRequestMeta(user, p.tenantId, fields.requestId, fields.patientId, fields.kind) : {};
    const meta = { ...fields, ...bound, visibleToOwner: fields.visibleToOwner == null ? undefined : fields.visibleToOwner === 'true' };
    const results = [];
    for (const f of files) {   // un archivo malo no cancela los demás
      if (f.error) { results.push({ filename: f.filename, ok: false, ...f.error }); continue; }
      try {
        const r = await svc.upload(p, { buffer: f.buffer, filename: f.filename, meta }, req.ip);
        results.push({ filename: f.filename, ok: true, duplicate: r.duplicate, id: r.document.id, status: r.document.status });
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        results.push({ filename: f.filename, ok: false, code: e.code, message: e.message });
      }
    }
    if (fields.requestId && p.role !== 'vet' && fields.kind === 'lab_result_pdf' && results.some(r => r.ok && !r.duplicate)) domain.noteEvent(user, fields.requestId, 'Resultado cargado (pendiente de entregar)');
    return reply.code(results.some(r => r.ok) ? 201 : 422).send({ results });
  });

  app.get('/api/documents', async req => svc.list(auth(req), req.query, req.ip));
  app.get('/api/documents/:id', async req => svc.get(auth(req), req.params.id));
  app.get('/api/documents/:id/url', async req => svc.signedDownload(auth(req), req.params.id, req.query, req.ip));
  app.delete('/api/documents/:id', async (req, reply) => { await svc.remove(auth(req), req.params.id, req.ip); reply.code(204).send(); });
  app.post('/api/documents/:id/restore', async (req, reply) => { await svc.restore(auth(req), req.params.id, req.ip); reply.code(204).send(); });

  if (typeof storage.resolveToken === 'function') {   // solo proveedor local; Azure firma sus propias URLs
    app.get('/_blob/:token', async (req, reply) => {
      const r = await storage.resolveToken(req.params.token);
      if (!r) return reply.code(404).send();
      const name = encodeURIComponent(r.filename ?? 'archivo');
      return reply.header('Content-Type', r.contentType).header('Content-Disposition', `${r.disposition}; filename*=UTF-8''${name}`)
        .header('Cross-Origin-Resource-Policy', 'same-origin').send(r.data);
    });
  }
  registerApi({ app, domain, authUser, cfg });
  app.decorate('documents', svc); app.decorate('domain', domain);
  return app;
}
