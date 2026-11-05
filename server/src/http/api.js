import crypto from 'node:crypto';
import { AppError, forbidden, invalid } from '../errors.js';
import { RateLimiter } from '../passwords.js';
import { requestsCsv, requestsXlsx } from '../domain/exports.js';
import { SAMPLE_TYPES, SPECIES } from '../domain/catalog.js';

export function registerApi({ app, domain, authUser, cfg }) {
  const loginLimit = new RateLimiter(8, 15 * 60_000), regLimit = new RateLimiter(10, 3600_000);
  const need = (u, ...roles) => { if (!roles.includes(u.role)) throw forbidden(); return u; };
  const lab = u => need(u, 'lab_admin', 'lab_staff'), admin = u => need(u, 'lab_admin');

  app.get('/api/config', async () => ({ speciesList: SPECIES, sampleTypes: SAMPLE_TYPES }));
  app.get('/api/labs', async () => ({ labs: domain.listLabs() }));   // directorio público (nombre y ciudad)

  app.post('/api/auth/register-vet', async (req, reply) => {
    if (!regLimit.hit(req.ip)) throw new AppError(429, 'RATE_LIMIT', 'Demasiados registros desde esta red. Intente más tarde.');
    reply.code(201); return domain.registerVet(req.body ?? {});
  });
  app.post('/api/auth/login', async req => {
    const k = `${req.ip}|${String(req.body?.email ?? '').toLowerCase()}`;
    if (!loginLimit.hit(k)) throw new AppError(429, 'RATE_LIMIT', 'Demasiados intentos. Espere 15 minutos.');
    const r = await domain.login(req.body?.email, req.body?.password); loginLimit.reset(k); return r;
  });
  app.get('/api/me', async req => ({ user: domain.me(authUser(req)) }));

  // --- veterinario ---
  app.get('/api/vet/labs', async req => ({ labs: domain.myLabs(need(authUser(req), 'vet')) }));
  app.post('/api/labs/:id/join', async req => ({ link: await domain.joinLab(need(authUser(req), 'vet'), req.params.id, req.body?.code) }));
  app.get('/api/labs/:id/services', async req => ({ services: domain.services(authUser(req), req.params.id) }));

  // --- solicitudes ---
  app.post('/api/requests', async (req, reply) => { reply.code(201); return { request: await domain.createRequest(need(authUser(req), 'vet'), req.body ?? {}) }; });
  app.get('/api/requests', async req => domain.listRequests(authUser(req), req.query));
  app.get('/api/requests/export.:fmt', async (req, reply) => {
    const u = authUser(req), rows = domain.listRequests(u, req.query, { all: true }).items, stamp = new Date().toISOString().slice(0, 10);
    if (req.params.fmt === 'csv') return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="solicitudes-${stamp}.csv"`).send(requestsCsv(rows));
    if (req.params.fmt === 'xlsx') return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', `attachment; filename="solicitudes-${stamp}.xlsx"`).send(await requestsXlsx(rows));
    throw invalid('BAD_FORMAT', 'Formato no soportado (csv o xlsx)');
  });
  app.get('/api/requests/:id', async req => ({ request: domain.getRequest(authUser(req), req.params.id) }));
  app.post('/api/requests/:id/status', async req => ({ request: await domain.setStatus(lab(authUser(req)), req.params.id, req.body?.status, req.body?.note) }));
  app.post('/api/requests/:id/cancel', async req => ({ request: domain.cancel(need(authUser(req), 'vet'), req.params.id) }));

  // --- dueño de la plataforma (clave ADMIN_KEY): crea laboratorios y consulta su código ---
  const adminLimit = new RateLimiter(10, 15 * 60_000);
  const owner = req => {
    const key = process.env.ADMIN_KEY ?? '';
    if (key.length < 24) throw new AppError(404, 'NOT_FOUND', 'No disponible');
    if (!adminLimit.hit(req.ip)) throw new AppError(429, 'RATE_LIMIT', 'Demasiados intentos');
    const a = Buffer.from(String(req.headers['x-admin-key'] ?? '')), b = Buffer.from(key);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new AppError(401, 'UNAUTHENTICATED', 'Clave inválida');
  };
  app.post('/api/admin/labs', async (req, reply) => { owner(req); const l = await domain.createLab(req.body ?? {}); reply.code(201); return { lab: { id: l.id, name: l.name, inviteCode: l.inviteCode } }; });
  app.get('/api/admin/labs', async req => { owner(req); return { labs: domain.s.listLabs().map(l => ({ id: l.id, name: l.name, city: l.city, inviteCode: l.inviteCode, vets: domain.s.listLinks(x => x.labId === l.id).length, requests: domain.s.listRequests({ labId: l.id }).total })) }; });

  // --- panel del laboratorio ---
  app.get('/api/lab/settings', async req => domain.labSettings(lab(authUser(req))));
  app.post('/api/lab/invite', async req => domain.regenerateInvite(admin(authUser(req))));
  app.get('/api/lab/vets', async req => ({ vets: domain.labVets(lab(authUser(req))) }));
  app.post('/api/lab/vets/:id/status', async req => ({ link: domain.setVetStatus(admin(authUser(req)), req.params.id, req.body?.status) }));
  app.post('/api/lab/services', async (req, reply) => { reply.code(201); return { service: domain.saveService(admin(authUser(req)), null, req.body ?? {}) }; });
  app.put('/api/lab/services/:id', async req => ({ service: domain.saveService(admin(authUser(req)), req.params.id, req.body ?? {}) }));
  app.post('/api/lab/staff', async (req, reply) => { reply.code(201); return { user: await domain.addStaff(admin(authUser(req)), req.body ?? {}) }; });
}
