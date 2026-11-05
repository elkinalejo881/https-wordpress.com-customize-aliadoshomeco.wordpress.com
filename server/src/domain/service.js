import crypto from 'node:crypto';
import { AppError, invalid, notFound, forbidden } from '../errors.js';
import { hashPassword, verifyPassword } from '../passwords.js';
import { issueToken } from '../auth.js';
import { DEFAULT_PORTFOLIO, SPECIES } from './catalog.js';
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

  // ---------- solicitudes (una solicitud = varios pacientes, como en la app del laboratorio) ----------
  #code(labId) { const n = this.s.nextCounter(`${labId}:req`); return `S-${String(n).padStart(4, '0')}`; }
  /** Estado de la solicitud, derivado del estado de cada paciente. */
  static derive(r) {
    if (r.cancelled) return 'cancelada';
    const st = r.pats.map(p => p.st);
    if (st.every(x => x === 'rej')) return 'rechazada';
    if (st.every(x => x === 'done' || x === 'rej')) return 'finalizada';
    return st.some(x => x === 'rec' || x === 'done') ? 'en_proceso' : 'enviada';
  }
  async createRequest(vet, b) {
    const lab = this.s.getLab(b.labId); if (!lab?.active) throw notFound(); this.assertVetApproved(vet, lab.id);
    const list = Array.isArray(b.patients) ? b.patients : []; if (!list.length || list.length > 20) throw invalid('BAD_FIELD', 'Agregue entre 1 y 20 pacientes');
    const delivery = b.delivery === 'RECOGIDA' ? 'RECOGIDA' : 'LAB', addr = str(b.addr, 'Dirección de recogida', { max: 200 });
    if (delivery === 'RECOGIDA' && !addr) throw invalid('BAD_FIELD', 'Indique la dirección de recogida');
    const pats = list.map((p, i) => {
      const n = i + 1, species = String(p?.species ?? '').toLowerCase(); if (!SPECIES.includes(species)) throw invalid('BAD_FIELD', `Paciente ${n}: especie inválida`);
      const ids = [...new Set(Array.isArray(p.serviceIds) ? p.serviceIds : [])]; if (!ids.length || ids.length > 30) throw invalid('BAD_FIELD', `Paciente ${n}: seleccione entre 1 y 30 exámenes`);
      const items = ids.map(id => { const sv = this.s.getService(lab.id, id); if (!sv?.active) throw invalid('BAD_SERVICE', `Paciente ${n}: hay un examen que ya no está disponible`); return { serviceId: sv.id, code: sv.code, name: sv.name, price: sv.price }; });
      return { id: crypto.randomUUID(), name: str(p.name, `Nombre del paciente ${n}`, { req: true, max: 80 }), species, sex: str(p.sex, 'Sexo', { max: 20 }), breed: str(p.breed, 'Raza', { max: 60 }), age: str(p.age, 'Edad', { max: 30 }), owner: str(p.owner, 'Acudiente', { max: 80 }), phone: str(p.phone, 'WhatsApp', { max: 30 }), items, subtotal: items.reduce((a, x) => a + x.price, 0), obs: str(p.obs, 'Observaciones', { max: 500 }), urg: p.urg === true, st: 'pend', no: null, chk: null, why: null };
    });
    const now = new Date(), req = this.s.createRequest({
      id: crypto.randomUUID(), code: this.#code(lab.id), labId: lab.id, vetId: vet.id, clinicName: vet.clinicName, clinicPhone: vet.phone, vetName: vet.name, delivery, addr, hora: str(b.hora, 'Hora', { max: 5 }), notes: str(b.notes, 'Observaciones generales', { max: 1000 }),
      urg: pats.some(p => p.urg), status: 'enviada', pats, total: pats.reduce((a, p) => a + p.subtotal, 0), createdAt: now, updatedAt: now, events: [{ at: now, status: 'enviada', by: vet.name, note: null }],
    });
    try { // orden de servicio en PDF guardada como documento (no bloquea el envío si falla)
      await this.docs.upload({ userId: 'system', tenantId: lab.id, role: 'lab_staff' }, { buffer: await orderPdf({ lab, req }), filename: `${req.code}-orden.pdf`, meta: { kind: 'generated_report', requestId: req.id, clinicId: vet.id, visibleToOwner: false } }, null);
    } catch (e) { this.log.error?.(`Orden PDF ${req.code}: ${e.message}`); }
    return req;
  }
  #visible(user, r) { if (!r) throw notFound(); if (user.role === 'vet' ? r.vetId !== user.id : r.labId !== user.labId) throw notFound(); return r; }
  getRequest(user, id) { const r = this.s.requests.get(id); this.#visible(user, r); return structuredClone(r); }
  listRequests(user, q, { all = false } = {}) {
    const page = Math.max(1, Number(q.page) || 1), pageSize = all ? 100000 : Math.min(100, Math.max(1, Number(q.pageSize) || 25));
    const f = { status: q.status || null, q: q.q ? String(q.q).slice(0, 60) : null, from: q.from ? new Date(q.from) : null, to: q.to ? new Date(new Date(q.to).getTime() + 86400000 - 1) : null };
    if ((f.from && Number.isNaN(+f.from)) || (f.to && Number.isNaN(+f.to))) throw invalid('BAD_FIELD', 'Fecha inválida');
    if (user.role === 'vet') { f.vetId = user.id; if (q.labId) f.labId = q.labId; } else f.labId = user.labId;
    const r = this.s.listRequests(f, { page, pageSize }); return { ...r, page, pageSize, hasMore: page * pageSize < r.total };
  }
  /** Acción del laboratorio sobre UN paciente: recibir (asigna N.º de muestra), rechazar o entregar resultado. */
  async setPatientStatus(staff, id, patId, { status, note, checks }) {
    if (staff.role === 'vet') throw forbidden();
    const r = this.#visible(staff, this.s.requests.get(id)); if (r.cancelled) throw invalid('BAD_TRANSITION', 'La solicitud fue cancelada');
    const p = r.pats.find(x => x.id === patId); if (!p) throw notFound();
    const ok = { pend: ['rec', 'rej'], rec: ['done', 'rej'], done: [], rej: [] }[p.st];
    if (!ok.includes(status)) throw invalid('BAD_TRANSITION', `No se puede pasar de «${p.st}» a «${status}»`);
    const reason = str(note, 'Motivo', { max: 300 }); if (status === 'rej' && !reason) throw invalid('BAD_FIELD', 'Indique el motivo del rechazo');
    if (status === 'done') {
      const { total } = await this.s.list(r.labId, { patientId: p.id, kind: 'lab_result_pdf', status: 'available' }, { page: 1, pageSize: 1 });
      if (!total) throw invalid('NO_RESULT', 'Primero suba el resultado en PDF de este paciente (y espere a que termine la revisión de seguridad)');
    }
    const upd = { st: status };
    if (status === 'rec') { upd.no = String(this.s.nextCounter(`${r.labId}:muestra`)); upd.chk = { rot: checks?.rot !== false, frio: checks?.frio !== false }; upd.recAt = new Date(); }
    if (status === 'rej') upd.why = reason;
    const pats = r.pats.map(x => x.id === p.id ? { ...x, ...upd } : x), next = { ...r, pats };
    const label = { rec: `Recibida ${p.name} (N.º ${upd.no})`, rej: `Rechazada ${p.name}: ${reason}`, done: `Resultado entregado: ${p.name}` }[status];
    return this.s.updateRequest(r.labId, id, { pats, status: DomainService.derive(next), events: [...r.events, { at: new Date(), status: DomainService.derive(next), by: staff.name, note: label }] });
  }
  cancel(vet, id) {
    const r = this.#visible(vet, this.s.requests.get(id)); if (r.cancelled || r.pats.some(p => p.st !== 'pend')) throw invalid('BAD_TRANSITION', 'Solo se puede cancelar mientras el laboratorio no haya recibido ninguna muestra');
    return this.s.updateRequest(r.labId, id, { cancelled: true, status: 'cancelada', events: [...r.events, { at: new Date(), status: 'cancelada', by: vet.name, note: null }] });
  }
  /** Pacientes del veterinario (derivados de sus solicitudes), con historial. */
  patients(vet) {
    const m = new Map(), key = p => `${p.name}|${p.owner ?? ''}`.toLowerCase();
    const rows = [...this.s.requests.values()].filter(r => r.vetId === vet.id).sort((a, b) => a.createdAt - b.createdAt);
    for (const r of rows) for (const p of r.pats) {
      const o = m.get(key(p)) ?? { history: [] };
      m.set(key(p), { name: p.name, species: p.species, sex: p.sex, breed: p.breed, age: p.age, owner: p.owner, history: [...o.history, { requestId: r.id, code: r.code, labId: r.labId, patientId: p.id, date: r.createdAt, status: p.st, no: p.no, why: p.why, exams: p.items.map(i => i.name) }] });
    }
    return [...m.values()].map(p => ({ ...p, count: p.history.length, last: p.history.at(-1).date, history: p.history.reverse() })).sort((a, b) => b.last - a.last);
  }
  /** Resumen para el inicio del laboratorio. */
  summary(staff) {
    const reqs = [...this.s.requests.values()].filter(r => r.labId === staff.labId), today = new Date().toISOString().slice(0, 10);
    const count = f => reqs.reduce((a, r) => a + r.pats.filter(f).length, 0);
    return { porRecibir: count(p => p.st === 'pend'), enProceso: count(p => p.st === 'rec'), entregadosHoy: reqs.reduce((a, r) => a + (r.status === 'finalizada' && r.updatedAt.toISOString().slice(0, 10) === today ? 1 : 0), 0),
      urgentes: reqs.reduce((a, r) => a + r.pats.filter(p => p.urg && p.st === 'pend' && !r.cancelled).length, 0), veterinariosPendientes: this.s.listLinks(l => l.labId === staff.labId && l.status === 'pending').length, solicitudes: reqs.length };
  }
  /** Convierte quién sube/ve documentos en el "principal" del servicio documental, para el laboratorio elegido. */
  docPrincipal(user, labId) {
    if (user.role === 'vet') { this.assertVetApproved(user, labId); return { userId: user.id, tenantId: labId, role: 'vet', clinicId: user.id }; }
    return { userId: user.id, tenantId: user.labId, role: user.role };
  }
  /** Antes de aceptar un archivo ligado a una solicitud: comprueba pertenencia y fija el destinatario (nunca confía en el cliente). */
  bindRequestMeta(user, labId, requestId, patientId, kind) {
    const r = this.s.getRequest(labId, requestId); if (!r) throw notFound(); this.#visible(user, r);
    const p = patientId ? r.pats.find(x => x.id === patientId) : null; if (patientId && !p) throw notFound();
    if (kind === 'lab_result_pdf') { if (!p) throw invalid('BAD_FIELD', 'Indique el paciente del resultado'); if (p.st !== 'rec') throw invalid('BAD_TRANSITION', 'Primero reciba la muestra de este paciente'); }
    return { requestId: r.id, clinicId: r.vetId, patientId: p?.id ?? null };
  }
  noteEvent(user, requestId, note) {
    const r = this.s.requests.get(requestId); if (r) this.s.updateRequest(r.labId, r.id, { events: [...r.events, { at: new Date(), status: r.status, by: user.name, note }] });
  }
}
