import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { loadConfig } from '../src/config.js';
import { LocalFsStorage } from '../src/storage/local.js';
import { PilotStore } from '../src/db/pilot.js';
import { buildApp } from '../src/http/app.js';
import { DocumentWorker } from '../src/documents/worker.js';
import { createScanner } from '../src/documents/scanner.js';
import { SECRET, pdf, multipart } from './helpers.js';

async function boot(file) {
  const cfg = loadConfig({ AUTH_JWT_SECRET: SECRET });
  const storage = new LocalFsStorage({ root: mkdtempSync(path.join(os.tmpdir(), 'b-')), publicBaseUrl: 'http://x', signingSecret: SECRET });
  const repo = await PilotStore.open(file); const app = await buildApp({ cfg, repo, storage });
  return { app, repo, worker: new DocumentWorker({ repo, storage, scanner: createScanner(cfg.scanner), log: {} }), domain: app.domain };
}
const call = async (env, method, url, { token, body, lab, raw } = {}) => {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(lab ? { 'x-lab': lab } : {}) };
  const r = await env.app.inject({ method, url, headers: raw ? { ...headers, ...raw.headers } : headers, payload: raw ? raw.payload : body });
  return { status: r.statusCode, json: () => r.json(), res: r };
};
const mkLab = (env, id, name) => env.domain.createLab({ id, name, city: 'Bogotá', adminEmail: `admin@${id}.co`, adminPassword: 'clave-segura-1' });
const login = async (env, email, password = 'clave-segura-1') => (await call(env, 'POST', '/api/auth/login', { body: { email, password } })).json();

test('FLUJO COMPLETO: veterinario elige laboratorio → envía muestra → laboratorio responde → veterinario ve el resultado', async () => {
  const env = await boot(null);
  const labA = await mkLab(env, 'agrolab', 'Agrolab'); await mkLab(env, 'vetlab', 'Vetlab');

  // 1. El veterinario se registra con el código del laboratorio y queda aprobado
  const reg = await call(env, 'POST', '/api/auth/register-vet', { body: { name: 'Dra. Pérez', email: 'Perez@Clinica.co', password: 'otra-clave-123', clinicName: 'Clínica Patitas', phone: '3001112233', city: 'Cali', labId: 'agrolab', code: labA.inviteCode.toLowerCase() } });
  assert.equal(reg.status, 201); const vet = reg.json(); assert.equal(vet.link.status, 'approved');

  // 2. Ve el directorio y, al elegir el laboratorio, se carga TODO su portafolio
  const dir = (await call(env, 'GET', '/api/labs')).json().labs; assert.deepEqual(dir.map(l => l.id).sort(), ['agrolab', 'vetlab']);
  assert.ok(!JSON.stringify(dir).includes('inviteCode'), 'el directorio no filtra el código de invitación');
  const services = (await call(env, 'GET', '/api/labs/agrolab/services', { token: vet.token })).json().services;
  assert.ok(services.length >= 20 && services.some(s => s.name === 'Hemograma completo'));
  assert.equal((await call(env, 'GET', '/api/labs/vetlab/services', { token: vet.token })).status, 403, 'sin vínculo no ve el portafolio de otro laboratorio');

  // 3. Envía la muestra
  const picks = services.filter(s => ['HEM-01', 'QS-03'].includes(s.code));
  const created = await call(env, 'POST', '/api/requests', { token: vet.token, body: { labId: 'agrolab', serviceIds: picks.map(s => s.id), sampleType: 'sangre EDTA', collectionDate: '2026-11-04', notes: 'Decaído 3 días', patient: { name: 'Luna', species: 'canino', breed: 'Criollo', age: '4 años', sex: 'hembra', ownerName: 'Ana Ruiz' } } });
  assert.equal(created.status, 201); const reqId = created.json().request.id;
  assert.equal(created.json().request.number, 'SOL-00001'); assert.equal(created.json().request.total, 40000);

  // 4. El laboratorio la ve (la orden en PDF se generó y se guardó)
  const adm = await login(env, 'admin@agrolab.co');
  const inbox = (await call(env, 'GET', '/api/requests', { token: adm.token })).json();
  assert.equal(inbox.total, 1); assert.equal(inbox.items[0].patient.name, 'Luna'); assert.equal(inbox.items[0].status, 'enviada');
  await env.worker.drain();
  const orderDocs = (await call(env, 'GET', `/api/documents?requestId=${reqId}`, { token: adm.token })).json().items;
  assert.equal(orderDocs.length, 1); assert.equal(orderDocs[0].kind, 'generated_report'); assert.equal(orderDocs[0].status, 'available');
  const ord = (await call(env, 'GET', `/api/documents/${orderDocs[0].id}/url`, { token: adm.token })).json();
  const bytes = (await env.app.inject({ method: 'GET', url: ord.url.replace('http://x', '') })).rawPayload; assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');

  // 5. Transiciones de estado válidas e inválidas
  assert.equal((await call(env, 'POST', `/api/requests/${reqId}/status`, { token: adm.token, body: { status: 'finalizada' } })).status, 422);
  for (const st of ['recibida', 'en_proceso']) assert.equal((await call(env, 'POST', `/api/requests/${reqId}/status`, { token: adm.token, body: { status: st } })).status, 200);
  assert.equal((await call(env, 'POST', `/api/requests/${reqId}/status`, { token: vet.token, body: { status: 'finalizada' } })).status, 403, 'el veterinario no cambia estados');
  assert.equal((await call(env, 'POST', `/api/requests/${reqId}/cancel`, { token: vet.token })).status, 422, 'ya no se puede cancelar');

  // 6. El laboratorio sube el resultado en PDF ligado a la solicitud (no puede apuntar a otro veterinario)
  const m = multipart({ kind: 'lab_result_pdf', requestId: reqId, clinicId: 'otro-veterinario' }, [{ name: 'resultado-luna.pdf', type: 'application/pdf', data: pdf() }]);
  const up = await call(env, 'POST', '/api/documents', { token: adm.token, raw: m }); assert.equal(up.status, 201);
  await env.worker.drain();
  assert.equal((await call(env, 'POST', `/api/requests/${reqId}/status`, { token: adm.token, body: { status: 'finalizada' } })).status, 200);

  // 7. El veterinario ve el resultado en SU portal y lo abre con enlace firmado
  const mine = (await call(env, 'GET', '/api/requests', { token: vet.token })).json().items[0]; assert.equal(mine.status, 'finalizada');
  const docs = (await call(env, 'GET', `/api/documents?requestId=${reqId}`, { token: vet.token, lab: 'agrolab' })).json().items;
  const result = docs.find(d => d.kind === 'lab_result_pdf'); assert.ok(result, 'el veterinario ve el resultado'); assert.equal(result.filename, 'resultado-luna.pdf');
  const link = await call(env, 'GET', `/api/documents/${result.id}/url?disposition=attachment`, { token: vet.token, lab: 'agrolab' }); assert.equal(link.status, 200);
  assert.equal((await env.app.inject({ method: 'GET', url: link.json().url.replace('http://x', '') })).statusCode, 200);
  const hist = (await call(env, 'GET', `/api/requests/${reqId}`, { token: vet.token })).json().request.events.map(e => e.status);
  assert.deepEqual(hist, ['enviada', 'recibida', 'en_proceso', 'en_proceso', 'finalizada']);
});

test('aislamiento: otro veterinario y otro laboratorio no ven ni tocan la solicitud', async () => {
  const env = await boot(null); const labA = await mkLab(env, 'agrolab', 'A'); await mkLab(env, 'vetlab', 'B');
  const v1 = (await call(env, 'POST', '/api/auth/register-vet', { body: { name: 'V1', email: 'v1@x.co', password: 'password-1', clinicName: 'C1', labId: 'agrolab', code: labA.inviteCode } })).json();
  const v2 = (await call(env, 'POST', '/api/auth/register-vet', { body: { name: 'V2', email: 'v2@x.co', password: 'password-2', clinicName: 'C2', labId: 'agrolab', code: labA.inviteCode } })).json();
  const sv = (await call(env, 'GET', '/api/labs/agrolab/services', { token: v1.token })).json().services[0];
  const r = (await call(env, 'POST', '/api/requests', { token: v1.token, body: { labId: 'agrolab', serviceIds: [sv.id], sampleType: 'suero', patient: { name: 'Max', species: 'felino' } } })).json().request;
  assert.equal((await call(env, 'GET', `/api/requests/${r.id}`, { token: v2.token })).status, 404);
  assert.equal((await call(env, 'GET', '/api/requests', { token: v2.token })).json().total, 0);
  const other = await login(env, 'admin@vetlab.co');
  assert.equal((await call(env, 'GET', `/api/requests/${r.id}`, { token: other.token })).status, 404);
  assert.equal((await call(env, 'POST', `/api/requests/${r.id}/status`, { token: other.token, body: { status: 'recibida' } })).status, 404);
  // v2 no puede adjuntar a la solicitud de v1
  const m = multipart({ kind: 'attachment', requestId: r.id }, [{ name: 'a.pdf', type: 'application/pdf', data: pdf() }]);
  assert.equal((await call(env, 'POST', '/api/documents', { token: v2.token, lab: 'agrolab', raw: m })).status, 404);
  // v1 no puede subir un "resultado" falso
  const f = multipart({ kind: 'lab_result_pdf', requestId: r.id }, [{ name: 'a.pdf', type: 'application/pdf', data: pdf() }]);
  assert.equal((await call(env, 'POST', '/api/documents', { token: v1.token, lab: 'agrolab', raw: f })).status, 403);
  // v1 sí puede adjuntar una foto de apoyo
  const ok = multipart({ kind: 'attachment', requestId: r.id }, [{ name: 'hist.pdf', type: 'application/pdf', data: pdf() }]);
  assert.equal((await call(env, 'POST', '/api/documents', { token: v1.token, lab: 'agrolab', raw: ok })).status, 201);
});

test('registro sin código queda pendiente hasta que el laboratorio aprueba; bloqueado no entra', async () => {
  const env = await boot(null); await mkLab(env, 'agrolab', 'A');
  const v = (await call(env, 'POST', '/api/auth/register-vet', { body: { name: 'V', email: 'v@x.co', password: 'password-1', clinicName: 'C', labId: 'agrolab' } })).json(); assert.equal(v.link.status, 'pending');
  const svc = await call(env, 'GET', '/api/labs/agrolab/services', { token: v.token }); assert.equal(svc.status, 403);
  assert.equal((await call(env, 'POST', '/api/labs/agrolab/join', { token: v.token, body: { code: 'MAL0-CODE' } })).status, 422);
  const adm = await login(env, 'admin@agrolab.co');
  assert.equal((await call(env, 'POST', `/api/lab/vets/${v.user.id}/status`, { token: adm.token, body: { status: 'approved' } })).status, 200);
  assert.equal((await call(env, 'GET', '/api/labs/agrolab/services', { token: v.token })).status, 200);
  await call(env, 'POST', `/api/lab/vets/${v.user.id}/status`, { token: adm.token, body: { status: 'blocked' } });
  assert.equal((await call(env, 'GET', '/api/labs/agrolab/services', { token: v.token })).status, 403);
  assert.equal((await call(env, 'POST', '/api/lab/vets/' + v.user.id + '/status', { token: v.token, body: { status: 'approved' } })).status, 403, 'el veterinario no se aprueba solo');
});

test('portafolio editable por el administrador; un precio nuevo no altera solicitudes ya enviadas', async () => {
  const env = await boot(null); const lab = await mkLab(env, 'agrolab', 'A');
  const adm = await login(env, 'admin@agrolab.co');
  const v = (await call(env, 'POST', '/api/auth/register-vet', { body: { name: 'V', email: 'v@x.co', password: 'password-1', clinicName: 'C', labId: 'agrolab', code: lab.inviteCode } })).json();
  const hem = (await call(env, 'GET', '/api/labs/agrolab/services', { token: v.token })).json().services.find(s => s.code === 'HEM-01');
  const r = (await call(env, 'POST', '/api/requests', { token: v.token, body: { labId: 'agrolab', serviceIds: [hem.id], sampleType: 'sangre EDTA', patient: { name: 'M', species: 'canino' } } })).json().request;
  assert.equal((await call(env, 'PUT', `/api/lab/services/${hem.id}`, { token: adm.token, body: { ...hem, price: 99000 } })).status, 200);
  assert.equal((await call(env, 'GET', `/api/requests/${r.id}`, { token: v.token })).json().request.total, 25000);
  await call(env, 'PUT', `/api/lab/services/${hem.id}`, { token: adm.token, body: { ...hem, active: false } });
  assert.ok(!(await call(env, 'GET', '/api/labs/agrolab/services', { token: v.token })).json().services.some(s => s.id === hem.id), 'inactivo no se ofrece');
  assert.equal((await call(env, 'POST', '/api/requests', { token: v.token, body: { labId: 'agrolab', serviceIds: [hem.id], sampleType: 'sangre EDTA', patient: { name: 'M', species: 'canino' } } })).status, 422);
  assert.equal((await call(env, 'POST', '/api/lab/services', { token: v.token, body: { code: 'X', name: 'X', price: 1 } })).status, 403);
});

test('exportes CSV y Excel: contenido correcto y sin inyección de fórmulas', async () => {
  const env = await boot(null); const lab = await mkLab(env, 'agrolab', 'A'); const adm = await login(env, 'admin@agrolab.co');
  const v = (await call(env, 'POST', '/api/auth/register-vet', { body: { name: 'V', email: 'v@x.co', password: 'password-1', clinicName: '=HYPERLINK("http://malo")', labId: 'agrolab', code: lab.inviteCode } })).json();
  const sv = (await call(env, 'GET', '/api/labs/agrolab/services', { token: v.token })).json().services[0];
  await call(env, 'POST', '/api/requests', { token: v.token, body: { labId: 'agrolab', serviceIds: [sv.id], sampleType: 'suero', notes: '+cmd|calc', patient: { name: 'Rex, "el bueno"', species: 'canino', ownerName: 'Ñandú Gómez' } } });
  const csv = await call(env, 'GET', '/api/requests/export.csv', { token: adm.token });
  assert.match(csv.res.headers['content-type'], /text\/csv/); const t = csv.res.body;
  assert.ok(t.startsWith('﻿Número,')); assert.ok(t.includes("'=HYPERLINK") && t.includes("'+cmd|calc")); assert.ok(t.includes('"Rex, ""el bueno"""') && t.includes('Ñandú'));
  const x = await call(env, 'GET', '/api/requests/export.xlsx', { token: adm.token });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.res.rawPayload); const ws = wb.worksheets[0];
  assert.equal(ws.rowCount, 2); assert.equal(ws.getRow(2).getCell(1).value, 'SOL-00001'); assert.equal(ws.getRow(2).getCell(4).value, `'=HYPERLINK("http://malo")`); assert.equal(typeof ws.getRow(2).getCell(13).value, 'number');
  assert.equal((await call(env, 'GET', '/api/requests/export.csv', { token: v.token })).res.body.split('\r\n').length, 3, 'el veterinario exporta solo lo suyo');
  assert.equal((await call(env, 'GET', '/api/requests/export.pdf', { token: adm.token })).status, 422);
});

test('contraseñas, login y límite de intentos', async () => {
  const env = await boot(null); await mkLab(env, 'agrolab', 'A');
  assert.equal((await call(env, 'POST', '/api/auth/login', { body: { email: 'admin@agrolab.co', password: 'mala' } })).status, 401);
  assert.equal((await call(env, 'POST', '/api/auth/login', { body: { email: 'noexiste@x.co', password: 'mala' } })).status, 401);
  assert.equal((await call(env, 'POST', '/api/auth/register-vet', { body: { name: 'V', email: 'v@x.co', password: '123', clinicName: 'C' } })).status, 422);
  assert.ok(!JSON.stringify([...env.repo.users.values()]).includes('clave-segura-1'), 'no se guardan contraseñas en claro');
  let last; for (let i = 0; i < 9; i++) last = await call(env, 'POST', '/api/auth/login', { body: { email: 'admin@agrolab.co', password: 'x' + i } });
  assert.equal(last.status, 429);
  assert.equal((await call(env, 'POST', '/api/auth/login', { body: { email: 'otro@agrolab.co', password: 'x' } })).status, 401, 'el bloqueo es por cuenta+IP');
});

test('persistencia: los datos sobreviven a un reinicio', async () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'p-')), 'datos.json');
  const a = await boot(file); const lab = await mkLab(a, 'agrolab', 'A');
  const v = (await call(a, 'POST', '/api/auth/register-vet', { body: { name: 'V', email: 'v@x.co', password: 'password-1', clinicName: 'C', labId: 'agrolab', code: lab.inviteCode } })).json();
  const sv = (await call(a, 'GET', '/api/labs/agrolab/services', { token: v.token })).json().services[0];
  await call(a, 'POST', '/api/requests', { token: v.token, body: { labId: 'agrolab', serviceIds: [sv.id], sampleType: 'suero', patient: { name: 'Max', species: 'felino' } } });
  await a.repo.flush();
  const b = await boot(file);
  const s = await login(b, 'v@x.co', 'password-1'); assert.ok(s.token);
  const list = (await call(b, 'GET', '/api/requests', { token: s.token })).json(); assert.equal(list.total, 1); assert.ok(list.items[0].createdAt);
  assert.equal((await call(b, 'POST', '/api/requests', { token: s.token, body: { labId: 'agrolab', serviceIds: [sv.id], sampleType: 'suero', patient: { name: 'Otro', species: 'felino' } } })).json().request.number, 'SOL-00002', 'el consecutivo continúa');
});

test('validación de solicitud', async () => {
  const env = await boot(null); const lab = await mkLab(env, 'agrolab', 'A');
  const v = (await call(env, 'POST', '/api/auth/register-vet', { body: { name: 'V', email: 'v@x.co', password: 'password-1', clinicName: 'C', labId: 'agrolab', code: lab.inviteCode } })).json();
  const sv = (await call(env, 'GET', '/api/labs/agrolab/services', { token: v.token })).json().services[0];
  const base = { labId: 'agrolab', serviceIds: [sv.id], sampleType: 'suero', patient: { name: 'M', species: 'canino' } };
  for (const bad of [{ serviceIds: [] }, { serviceIds: ['no-existe'] }, { sampleType: 'saliva' }, { patient: { name: '', species: 'canino' } }, { patient: { name: 'M', species: 'dragón' } }, { collectionDate: '31/02/2026' }])
    assert.equal((await call(env, 'POST', '/api/requests', { token: v.token, body: { ...base, ...bad } })).status, 422, JSON.stringify(bad));
  assert.equal((await call(env, 'POST', '/api/requests', { body: base })).status, 401);
});

test('panel del dueño: crear laboratorios requiere ADMIN_KEY', async () => {
  const env = await boot(null); const ok = process.env.ADMIN_KEY;
  try {
    delete process.env.ADMIN_KEY;
    assert.equal((await env.app.inject({ method: 'POST', url: '/api/admin/labs', payload: {} })).statusCode, 404, 'sin ADMIN_KEY configurada el endpoint no existe');
    process.env.ADMIN_KEY = 'k'.repeat(30);
    const body = { id: 'nuevo-lab', name: 'Nuevo', adminEmail: 'a@nuevo.co', adminPassword: 'clave-12345' };
    assert.equal((await env.app.inject({ method: 'POST', url: '/api/admin/labs', payload: body, headers: { 'x-admin-key': 'mala' } })).statusCode, 401);
    const r = await env.app.inject({ method: 'POST', url: '/api/admin/labs', payload: body, headers: { 'x-admin-key': 'k'.repeat(30) } });
    assert.equal(r.statusCode, 201); assert.match(r.json().lab.inviteCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.equal((await env.app.inject({ method: 'POST', url: '/api/admin/labs', payload: body, headers: { 'x-admin-key': 'k'.repeat(30) } })).statusCode, 409);
    assert.ok((await login(env, 'a@nuevo.co', 'clave-12345')).token);
  } finally { ok === undefined ? delete process.env.ADMIN_KEY : process.env.ADMIN_KEY = ok; }
});
