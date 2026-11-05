import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { readFile } from 'node:fs/promises';
import { AppError, invalid } from '../errors.js';
import { verifyToken } from '../auth.js';
import { KINDS, kindPolicy } from '../documents/kinds.js';
import { DocumentService } from '../documents/service.js';

const PORTAL = new URL('../../public/index.html', import.meta.url);

export async function buildApp({ cfg, repo, storage, logger = false }) {
  const app = Fastify({ logger, trustProxy: true, maxParamLength: 2048, bodyLimit: 1024 * 1024 });
  const svc = new DocumentService({ repo, storage, cfg });
  const maxBytes = Math.max(...Object.keys(KINDS).map(k => kindPolicy(k, cfg).maxBytes));
  await app.register(multipart, { limits: { fileSize: maxBytes, files: cfg.maxFilesPerUpload, fields: 20, parts: cfg.maxFilesPerUpload + 20 } });

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('Cache-Control', 'private, no-store');
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'FILE_TOO_LARGE', message: 'Archivo demasiado grande' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'BAD_REQUEST', message: 'Solicitud inválida' });
    req.log.error(err); reply.code(500).send({ error: 'INTERNAL', message: 'Error interno' });   // sin detalles internos al cliente
  });
  const auth = req => { const h = req.headers.authorization ?? ''; return verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '', cfg.jwtSecret); };

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/', async (req, reply) => reply.type('text/html; charset=utf-8')
    .header('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; frame-src https: http://localhost:*; connect-src 'self'; base-uri 'none'; form-action 'none'")
    .send(await readFile(PORTAL, 'utf8')));

  app.post('/api/documents', async (req, reply) => {
    const p = auth(req), fields = {}, files = [];
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        try { files.push({ filename: part.filename, buffer: await part.toBuffer() }); }
        catch (e) { files.push({ filename: part.filename, error: e.code === 'FST_REQ_FILE_TOO_LARGE' ? { code: 'FILE_TOO_LARGE', message: 'Archivo demasiado grande' } : { code: 'READ_ERROR', message: 'No se pudo leer el archivo' } }); }
      } else fields[part.fieldname] = String(part.value).slice(0, 200);
    }
    if (!files.length) throw invalid('NO_FILES', 'No se recibió ningún archivo');
    const meta = { ...fields, visibleToOwner: fields.visibleToOwner == null ? undefined : fields.visibleToOwner === 'true' };
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
        .header('Content-Security-Policy', "default-src 'none'; sandbox").send(r.data);
    });
  }
  app.decorate('documents', svc);
  return app;
}
