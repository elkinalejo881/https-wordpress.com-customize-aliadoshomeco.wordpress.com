import crypto from 'node:crypto';
import { AppError, invalid, notFound, forbidden } from '../errors.js';
import { hashPassword, verifyPassword } from '../passwords.js';
import { issueToken } from '../auth.js';
import { DEFAULT_PORTFOLIO, NEXT, SAMPLE_TYPES, SPECIES } from './catalog.js';
import { orderPdf } from './exports.js';

const SLUG = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/, EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const str = (v, name, { max = 120, req = false } = {}) => {
  const s = typeof v === 'string' ? v.trim().replace(/[\u0000-\u001f\u007f]/g, '') : '';
  if (req && !s) throw invalid('BAD_FIELD', `${name} es obligatorio`); if (s.length > max) throw invalid('BAD_FIELD', `${name} es demasiado largo`); return s || null;
};
const genCode = () => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const b = crypto.randomBytes(8); return [...b].map((x, i) => (i === 4 ? '-' : '') + A[x % A.length]).join(''); };
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, labId: u.labId ?? null, clinicName: u.clinicName ?? null, phone: u.phone ?? null, city: u.city ?? null });
const publicLab = l => ({ id: l.id, name: l.name, city: l.city, phone: l.phone, whatsapp: l.whatsapp });

export class DomainService {
  constructor({ store, docs, cfg, log = console }) { this.s = store; this.docs = docs; this.cfg = cfg; this.log = log; }
  tokenFor(u) { return issueToken({ sub: u.id, role: u.role, tenantId: u.labId ?? '-', clinicId: u.role === 'vet' ? u.id : undefined }, this.cfg.jwtSecret, 12 * 3600); }

  // ---------- cuentas ----------
  async createLab({ id, name, nit, city, phone, whatsapp, adminEmail, adminName, adminPassword }) {
    if (!SLUG.test(id ?? '')) throw invalid('BAD_FIELD', 'Identificador inválido (minúsculas, números y guiones; 3–40)');
    if (!EMAIL.test(adminEmail ?? '')) throw invalid('BAD_FIELD', 'Correo del administrador inválido');
    if ((adminPassword ?? '').length < 8) throw invalid('WEAK_PASSWORD', 'La contraseña debe tener al menos 8 caracteres');
    const lab = this.s.createLab({ id, name: str(name, 'Nombre', { req: true }), nit: str(nit, 'NIT', { max: 30 }), city: str(city, 'Ciudad', { max: 60 }), phone: str(phone, 'Teléfono', { max: 30 }), whatsapp: str(whatsapp, 'WhatsApp', { max: 30 }), inviteCode: genCode(), active: true, createdAt: new Date() });
    for (const [code, n, category, sampleType, hours, price] of DEFAULT_PORTFOLIO) this.s.saveService({ id: crypto.randomUUID(), labId: id, code, name: n, category, sampleType, turnaroundHours: hours, price, active: true });
    this.s.createUser({ id: crypto.randomUUID(), email: adminEmail.toLowerCase(), name: str(adminName ?? 'Administrador', 'Nombre'), role: 'lab_admin', labId: id, passwordHash: await hashPassword(adminPassword), createdAt: new Date() });
    return lab;
  }
  async registerVet(b) {
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw invalid('BAD_FIELD', 'Correo inválido');
    if ((b.password ?? '').length < 8) throw invalid('WEAK_PASSWORD', 'La contraseña debe tener al menos 8 caracteres');
    const u = this.s.createUser({ id: crypto.randomUUID(), email, name: str(b.name, 'Nombre', { req: true, max: 80 }), role: 'vet', clinicName: str(b.clinicName, 'Clínica o consultorio', { req: true, max: 100 }), phone: str(b.phone, 'Teléfono', { max: 30 }), city: str(b.city, 'Ciudad', { max: 60 }), passwordHash: await hashPassword(b.password), createdAt: new Date() });
    let link = null; if (b.labId) link = await this.joinLab(u, b.labId, b.code);
    return { token: this.tokenFor(u), user: publicUser(u), link };
  }
  async login(email, password) {
    const u = this.s.getUserByEmail(String(email ?? '').trim());
    const ok = await verifyPassword(String(password ?? ''), u?.passwordHash ?? 'scrypt$AAAA$AAAA'); // tiempo similar si no existe
    if (!u || !ok || u.disabled) throw new AppError(401, 'BAD_CREDENTIALS', 'Correo o contraseña incorrectos');
    return { token: this.tokenFor(u), user: publicUser(u) };
  }
  getUser(id) { const u = this.s.getUser(id); if (!u || u.disabled) throw new AppError(401, 'UNAUTHENTICATED', 'Sesión inválida'); return u; }
  me(u) { return publicUser(u); }
  async addStaff(admin, { email, name, password }) {
    if (!EMAIL.test(email ?? '')) throw invalid('BAD_FIELD', 'Correo inválido'); if ((password ?? '').length < 8) throw invalid('WEAK_PASSWORD', 'Mínimo 8 caracteres');
    const u = this.s.createUser({ id: crypto.randomUUID(), email: email.toLowerCase(), name: str(name, 'Nombre', { req: true, max: 80 }), role: 'lab_staff', labId: admin.labId, passwordHash: await hashPassword(password), createdAt: new Date() });
    return publicUser(u);
  }

  // ---------- directorio, vínculos y portafolio ----------
  listLabs() { return this.s.listLabs().filter(l => l.active).map(publicLab); }
  async joinLab(vet, labId, code) {
    const lab = this.s.getLab(labId); if (!lab?.active) throw notFound();
    const cur = this.s.getLink(labId, vet.id); if (cur?.status === 'blocked') throw forbidden('El laboratorio no permite su acceso');
    if (cur?.status === 'approved') return cur;
    const approved = !!code && String(code).trim().toUpperCase() === lab.inviteCode;
    if (code && !approved) throw invalid('BAD_CODE', 'El código de invitación no es válido');
    return this.s.setLink(labId, vet.id, approved ? 'approved' : 'pending');
  }
  myLabs(vet) {
    return this.s.listLinks(l => l.vetId === vet.id).map(l => ({ ...publicLab(this.s.getLab(l.labId)), status: l.status }));
  }
  assertVetApproved(vet, labId) { const l = this.s.getLink(labId, vet.id); if (l?.status !== 'approved') throw forbidden('Su acceso a este laboratorio aún no está aprobado'); }
  /** Portafolio: el veterinario aprobado ve solo lo activo; el personal del laboratorio ve todo lo suyo. */
  services(user, labId) {
    if (user.role === 'vet') { this.assertVetApproved(user, labId); return this.s.listServices(labId); }
    if (user.labId !== labId) throw notFound(); return this.s.listServices(labId, { all: true });
  }
  saveService(admin, id, b) {
    const cur = id ? this.s.getService(admin.labId, id) : null; if (id && !cur) throw notFound();
    const price = Number(b.price); if (!Number.isFinite(price) || price < 0 || price > 1e8) throw invalid('BAD_FIELD', 'Precio inválido');
    const hours = Number(b.turnaroundHours ?? 24); if (!Number.isFinite(hours) || hours < 0 || hours > 24 * 90) throw invalid('BAD_FIELD', 'Tiempo de entrega inválido');
    return this.s.saveService({ ...(cur ?? { id: crypto.randomUUID(), labId: admin.labId }), code: str(b.code, 'Código', { req: true, max: 20 }), name: str(b.name, 'Nombre', { req: true, max: 120 }), category: str(b.category ?? 'General', 'Categoría', { max: 60 }), sampleType: str(b.sampleType, 'Muestra', { max: 60 }), turnaroundHours: hours, price, active: b.active !== false });
  }
  labVets(admin) {
    return this.s.listLinks(l => l.labId === admin.labId).map(l => { const u = this.s.getUser(l.vetId); return { vetId: l.vetId, status: l.status, name: u?.name, clinicName: u?.clinicName, email: u?.email, phone: u?.phone, city: u?.city }; });
  }
  setVetStatus(admin, vetId, status) {
    if (!['approved', 'blocked', 'pending'].includes(status)) throw invalid('BAD_FIELD', 'Estado inválido');
    if (!this.s.getLink(admin.labId, vetId)) throw notFound(); return this.s.setLink(admin.labId, vetId, status);
  }
  labSettings(admin) { const l = this.s.getLab(admin.labId); return { ...publicLab(l), inviteCode: l.inviteCode, nit: l.nit }; }
  regenerateInvite(admin) { return { inviteCode: this.s.updateLab(admin.labId, { inviteCode: genCode() }).inviteCode }; }

  // ---------- solicitudes ----------
  async createRequest(vet, b) {
    const lab = this.s.getLab(b.labId); if (!lab?.active) throw notFound(); this.assertVetApproved(vet, lab.id);
    const p = b.patient ?? {}, species = String(p.species ?? '').toLowerCase();
    if (!SPECIES.includes(species)) throw invalid('BAD_FIELD', 'Especie inválida');
    const ids = [...new Set(Array.isArray(b.serviceIds) ? b.serviceIds : [])]; if (!ids.length || ids.length > 50) throw invalid('BAD_FIELD', 'Seleccione entre 1 y 50 exámenes');
    const items = ids.map(id => { const s = this.s.getService(lab.id, id); if (!s?.active) throw invalid('BAD_SERVICE', 'Hay un examen que ya no está disponible'); return { serviceId: s.id, code: s.code, name: s.name, price: s.price }; });
    const sampleType = str(b.sampleType, 'Tipo de muestra', { req: true, max: 60 }); if (!SAMPLE_TYPES.includes(sampleType)) throw invalid('BAD_FIELD', 'Tipo de muestra inválido');
    let collectionDate = str(b.collectionDate, 'Fecha de toma', { max: 10 });
    if (collectionDate && (!/^\d{4}-\d{2}-\d{2}$/.test(collectionDate) || Number.isNaN(Date.parse(collectionDate)))) throw invalid('BAD_FIELD', 'Fecha de toma inválida');
    const now = new Date(), req = this.s.createRequest({
      id: crypto.randomUUID(), labId: lab.id, vetId: vet.id, clinicName: vet.clinicName, clinicPhone: vet.phone, status: 'enviada',
      patient: { name: str(p.name, 'Nombre del paciente', { req: true, max: 80 }), species, breed: str(p.breed, 'Raza', { max: 60 }), age: str(p.age, 'Edad', { max: 30 }), sex: str(p.sex, 'Sexo', { max: 20 }), ownerName: str(p.ownerName, 'Propietario', { max: 80 }) },
      items, total: items.reduce((a, i) => a + i.price, 0), sampleType, collectionDate, notes: str(b.notes, 'Observaciones', { max: 1000 }),
      createdAt: now, updatedAt: now, events: [{ at: now, status: 'enviada', by: vet.name, note: null }],
    });
    try { // orden de servicio en PDF, guardada como documento de la solicitud (no bloquea el envío si falla)
      const buffer = await orderPdf({ lab, req });
      await this.docs.upload({ userId: 'system', tenantId: lab.id, role: 'lab_staff' }, { buffer, filename: `${req.number}-orden.pdf`, meta: { kind: 'generated_report', requestId: req.id, clinicId: vet.id, visibleToOwner: false } }, null);
    } catch (e) { this.log.error?.(`Orden PDF ${req.number}: ${e.message}`); }
    return req;
  }
  #visible(user, r) { if (!r) throw notFound(); if (user.role === 'vet' ? r.vetId !== user.id : r.labId !== user.labId) throw notFound(); return r; }
  getRequest(user, id) {
    const r = this.s.requests.get(id); this.#visible(user, r); return structuredClone(r);
  }
  listRequests(user, q, { all = false } = {}) {
    const page = Math.max(1, Number(q.page) || 1), pageSize = all ? 100000 : Math.min(100, Math.max(1, Number(q.pageSize) || 25));
    const f = { status: q.status || null, q: q.q ? String(q.q).slice(0, 60) : null, from: q.from ? new Date(q.from) : null, to: q.to ? new Date(new Date(q.to).getTime() + 86400000 - 1) : null };
    if ((f.from && Number.isNaN(+f.from)) || (f.to && Number.isNaN(+f.to))) throw invalid('BAD_FIELD', 'Fecha inválida');
    if (user.role === 'vet') { f.vetId = user.id; if (q.labId) f.labId = q.labId; } else f.labId = user.labId;
    const r = this.s.listRequests(f, { page, pageSize }); return { ...r, page, pageSize, hasMore: page * pageSize < r.total };
  }
  async setStatus(staff, id, status, note) {
    const r = this.#visible(staff, this.s.requests.get(id)); if (staff.role === 'vet') throw forbidden();
    if (!NEXT[r.status]?.includes(status)) throw invalid('BAD_TRANSITION', `No se puede pasar de «${r.status}» a «${status}»`);
    if (status === 'rechazada' && !str(note, 'Motivo', { max: 300 })) throw invalid('BAD_FIELD', 'Indique el motivo del rechazo');
    return this.s.updateRequest(r.labId, id, { status, events: [...r.events, { at: new Date(), status, by: staff.name, note: str(note, 'Nota', { max: 300 }) }] });
  }
  cancel(vet, id) {
    const r = this.#visible(vet, this.s.requests.get(id)); if (r.status !== 'enviada') throw invalid('BAD_TRANSITION', 'Solo se puede cancelar una solicitud que el laboratorio aún no recibió');
    return this.s.updateRequest(r.labId, id, { status: 'cancelada', events: [...r.events, { at: new Date(), status: 'cancelada', by: vet.name, note: null }] });
  }
  /** Convierte quién sube/ve documentos en el "principal" del servicio documental, para el laboratorio elegido. */
  docPrincipal(user, labId) {
    if (user.role === 'vet') { this.assertVetApproved(user, labId); return { userId: user.id, tenantId: labId, role: 'vet', clinicId: user.id }; }
    return { userId: user.id, tenantId: user.labId, role: user.role };
  }
  /** Antes de aceptar un archivo ligado a una solicitud: comprueba pertenencia y fija el destinatario (nunca confía en el cliente). */
  bindRequestMeta(user, labId, requestId) {
    const r = this.s.getRequest(labId, requestId); if (!r) throw notFound(); this.#visible(user, r);
    return { requestId: r.id, clinicId: r.vetId, patientId: null };
  }
  noteEvent(user, requestId, note) {
    const r = this.s.requests.get(requestId); if (r) this.s.updateRequest(r.labId, r.id, { events: [...r.events, { at: new Date(), status: r.status, by: user.name, note }] });
  }
}
