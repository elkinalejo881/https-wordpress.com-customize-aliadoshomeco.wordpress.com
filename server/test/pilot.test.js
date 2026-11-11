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

const reg = async (env, labId, code, n = 1) => (await call(env, 'POST', '/api/auth/register-vet', { body: { name: `Vet ${n}`, email: `v${n}@x.co`, password: 'password-' + n, clinicName: `Clínica ${n}`, labId, code } })).json();
const svcs = async (env, token, labId) => (await call(env, 'GET', `/api/labs/${labId}/services`, { token })).json().services;
const newReq = (env, token, labId, patients, extra = {}) => call(env, 'POST', '/api/requests', { token, body: { labId, delivery: 'LAB', patients, ...extra } });
const pat = (name, ids, extra = {}) => ({ name, species: 'canino', serviceIds: ids, ...extra });
const pstatus = (env, token, r, p, body) => call(env, 'POST', `/api/requests/${r.id}/patients/${p.id}/status`, { token, body });
const upRes = (env, token, r, p, name = 'resultado.pdf', data = pdf()) => call(env, 'POST', '/api/documents', { token, raw: multipart({ kind: 'lab_result_pdf', requestId: r.id, patientId: p.id }, [{ name, type: 'application/pdf', data }]) });

test('FLUJO COMPLETO: veterinario elige laboratorio → envía 2 pacientes → laboratorio recibe, sube resultados → veterinario los ve', async () => {
  const env = await boot(null);
  const labA = await mkLab(env, 'agrolab', 'Agrolab'); await mkLab(env, 'vetlab', 'Vetlab');
  const reg1 = await call(env, 'POST', '/api/auth/register-vet', { body: { name: 'Dra. Pérez', email: 'Perez@Clinica.co', password: 'otra-clave-123', clinicName: 'Clínica Patitas', phone: '3001112233', labId: 'agrolab', code: labA.inviteCode.toLowerCase() } });
  assert.equal(reg1.status, 201); const vet = reg1.json(); assert.equal(vet.link.status, 'approved');

  const dir = (await call(env, 'GET', '/api/labs')).json().labs; assert.deepEqual(dir.map(l => l.id).sort(), ['agrolab', 'vetlab']);
  assert.ok(!JSON.stringify(dir).includes('inviteCode'));
  const services = await svcs(env, vet.token, 'agrolab'); assert.ok(services.length >= 20);
  assert.equal((await call(env, 'GET', '/api/labs/vetlab/services', { token: vet.token })).status, 403);

  const id = c => services.find(s => s.code === c).id;
  const created = await newReq(env, vet.token, 'agrolab', [pat('Luna', [id('HEM-01'), id('QS-03')], { urg: true, owner: 'Ana Ruiz', obs: 'Decaída' }), pat('Michi', [id('CO-01')], { species: 'felino' })], { hora: '09:30', notes: 'Muestras en nevera' });
  assert.equal(created.status, 201); const r0 = created.json().request;
  assert.equal(r0.code, 'S-0001'); assert.equal(r0.total, 55000); assert.equal(r0.urg, true); assert.equal(r0.status, 'enviada'); assert.equal(r0.pats.length, 2);

  const adm = await login(env, 'admin@agrolab.co');
  const inbox = (await call(env, 'GET', '/api/requests', { token: adm.token })).json(); assert.equal(inbox.total, 1);
  assert.equal((await call(env, 'GET', '/api/lab/summary', { token: adm.token })).json().porRecibir, 2);
  await env.worker.drain();
  const orderDocs = (await call(env, 'GET', `/api/documents?requestId=${r0.id}`, { token: adm.token })).json().items;
  assert.equal(orderDocs.length, 1); assert.equal(orderDocs[0].kind, 'generated_report'); assert.equal(orderDocs[0].status, 'available');
  const bytes = (await env.app.inject({ method: 'GET', url: (await call(env, 'GET', `/api/documents/${orderDocs[0].id}/url`, { token: adm.token })).json().url.replace('http://x', '') })).rawPayload; assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');

  const [luna, michi] = r0.pats;
  assert.equal((await upRes(env, adm.token, r0, luna)).json().error, 'BAD_TRANSITION', 'no se sube resultado de una muestra no recibida');
  assert.equal((await pstatus(env, adm.token, r0, luna, { status: 'done' })).status, 422, 'no se entrega sin recibir');
  assert.equal((await pstatus(env, vet.token, r0, luna, { status: 'rec' })).status, 403, 'el veterinario no recibe');
  const rec = (await pstatus(env, adm.token, r0, luna, { status: 'rec', checks: { rot: true, frio: false } })).json().request;
  assert.equal(rec.pats[0].no, '1'); assert.equal(rec.pats[0].chk.frio, false); assert.equal(rec.status, 'en_proceso');
  assert.equal((await pstatus(env, adm.token, r0, michi, { status: 'rej' })).status, 422, 'rechazo exige motivo');
  assert.equal((await pstatus(env, adm.token, r0, michi, { status: 'rej', note: 'Muestra coagulada' })).status, 200);

  assert.equal((await pstatus(env, adm.token, r0, luna, { status: 'done' })).status, 422, 'no se entrega sin PDF de resultado');
  const up = await upRes(env, adm.token, r0, luna, 'resultado-luna.pdf'); assert.equal(up.status, 201); await env.worker.drain();
  const fin = (await pstatus(env, adm.token, r0, luna, { status: 'done' })).json().request; assert.equal(fin.status, 'finalizada');
  assert.equal((await call(env, 'POST', `/api/requests/${r0.id}/cancel`, { token: vet.token })).status, 422);

  const mine = (await call(env, 'GET', '/api/requests', { token: vet.token })).json().items[0]; assert.equal(mine.status, 'finalizada');
  assert.equal(mine.pats[1].why, 'Muestra coagulada');
  const docs = (await call(env, 'GET', `/api/documents?requestId=${r0.id}&patientId=${luna.id}`, { token: vet.token, lab: 'agrolab' })).json().items;
  const result = docs.find(d => d.kind === 'lab_result_pdf'); assert.equal(result.filename, 'resultado-luna.pdf');
  const link = await call(env, 'GET', `/api/documents/${result.id}/url?disposition=attachment`, { token: vet.token, lab: 'agrolab' });
  assert.equal((await env.app.inject({ method: 'GET', url: link.json().url.replace('http://x', '') })).statusCode, 200);
  const pac = (await call(env, 'GET', '/api/vet/patients', { token: vet.token })).json().patients; assert.deepEqual(pac.map(p => p.name).sort(), ['Luna', 'Michi']);
  assert.equal(pac.find(p => p.name === 'Luna').history[0].no, '1');
});

test('aislamiento: otro veterinario y otro laboratorio no ven ni tocan la solicitud', async () => {
  const env = await boot(null); const labA = await mkLab(env, 'agrolab', 'A'); await mkLab(env, 'vetlab', 'B');
  const v1 = await reg(env, 'agrolab', labA.inviteCode, 1), v2 = await reg(env, 'agrolab', labA.inviteCode, 2);
  const sv = (await svcs(env, v1.token, 'agrolab'))[0];
  const r = (await newReq(env, v1.token, 'agrolab', [pat('Max', [sv.id])])).json().request;
  assert.equal((await call(env, 'GET', `/api/requests/${r.id}`, { token: v2.token })).status, 404);
  assert.equal((await call(env, 'GET', '/api/requests', { token: v2.token })).json().total, 0);
  assert.deepEqual((await call(env, 'GET', '/api/vet/patients', { token: v2.token })).json().patients, []);
  const other = await login(env, 'admin@vetlab.co');
  assert.equal((await call(env, 'GET', `/api/requests/${r.id}`, { token: other.token })).status, 404);
  assert.equal((await pstatus(env, other.token, r, r.pats[0], { status: 'rec' })).status, 404);
  const m = multipart({ kind: 'attachment', requestId: r.id }, [{ name: 'a.pdf', type: 'application/pdf', data: pdf() }]);
  assert.equal((await call(env, 'POST', '/api/documents', { token: v2.token, lab: 'agrolab', raw: m })).status, 404);
  const f = multipart({ kind: 'lab_result_pdf', requestId: r.id, patientId: r.pats[0].id }, [{ name: 'a.pdf', type: 'application/pdf', data: pdf() }]);
  assert.equal((await call(env, 'POST', '/api/documents', { token: v1.token, lab: 'agrolab', raw: f })).status, 403, 'el veterinario no sube resultados falsos');
  const ok = multipart({ kind: 'attachment', requestId: r.id, patientId: r.pats[0].id }, [{ name: 'hist.pdf', type: 'application/pdf', data: pdf() }]);
  assert.equal((await call(env, 'POST', '/api/documents', { token: v1.token, lab: 'agrolab', raw: ok })).status, 201);
  const bad = multipart({ kind: 'attachment', requestId: r.id, patientId: 'no-existe' }, [{ name: 'h.pdf', type: 'application/pdf', data: pdf() }]);
  assert.equal((await call(env, 'POST', '/api/documents', { token: v1.token, lab: 'agrolab', raw: bad })).status, 404);
});

test('registro sin código queda pendiente hasta que el laboratorio aprueba; bloqueado no entra', async () => {
  const env = await boot(null); await mkLab(env, 'agrolab', 'A');
  const v = (await call(env, 'POST', '/api/auth/register-vet', { body: { name: 'V', email: 'v@x.co', password: 'password-1', clinicName: 'C', labId: 'agrolab' } })).json(); assert.equal(v.link.status, 'pending');
  assert.equal((await call(env, 'GET', '/api/labs/agrolab/services', { token: v.token })).status, 403);
  assert.equal((await call(env, 'POST', '/api/labs/agrolab/join', { token: v.token, body: { code: 'MAL0-CODE' } })).status, 422);
  const adm = await login(env, 'admin@agrolab.co');
  assert.equal((await call(env, 'GET', '/api/lab/summary', { token: adm.token })).json().veterinariosPendientes, 1);
  assert.equal((await call(env, 'POST', `/api/lab/vets/${v.user.id}/status`, { token: adm.token, body: { status: 'approved' } })).status, 200);
  assert.equal((await call(env, 'GET', '/api/labs/agrolab/services', { token: v.token })).status, 200);
  await call(env, 'POST', `/api/lab/vets/${v.user.id}/status`, { token: adm.token, body: { status: 'blocked' } });
  assert.equal((await call(env, 'GET', '/api/labs/agrolab/services', { token: v.token })).status, 403);
  assert.equal((await call(env, 'POST', '/api/lab/vets/' + v.user.id + '/status', { token: v.token, body: { status: 'approved' } })).status, 403);
});

test('portafolio editable; un precio nuevo no altera solicitudes ya enviadas; inactivo no se ofrece', async () => {
  const env = await boot(null); const lab = await mkLab(env, 'agrolab', 'A'); const adm = await login(env, 'admin@agrolab.co');
  const v = await reg(env, 'agrolab', lab.inviteCode); const hem = (await svcs(env, v.token, 'agrolab')).find(s => s.code === 'HEM-01');
  const r = (await newReq(env, v.token, 'agrolab', [pat('M', [hem.id])])).json().request;
  assert.equal((await call(env, 'PUT', `/api/lab/services/${hem.id}`, { token: adm.token, body: { ...hem, price: 99000 } })).status, 200);
  assert.equal((await call(env, 'GET', `/api/requests/${r.id}`, { token: v.token })).json().request.total, 25000);
  await call(env, 'PUT', `/api/lab/services/${hem.id}`, { token: adm.token, body: { ...hem, active: false } });
  assert.ok(!(await svcs(env, v.token, 'agrolab')).some(s => s.id === hem.id));
  assert.equal((await newReq(env, v.token, 'agrolab', [pat('M', [hem.id])])).status, 422);
  assert.equal((await call(env, 'POST', '/api/lab/services', { token: v.token, body: { code: 'X', name: 'X', price: 1 } })).status, 403);
});

test('exportes CSV y Excel por paciente: contenido correcto y sin inyección de fórmulas', async () => {
  const env = await boot(null); const lab = await mkLab(env, 'agrolab', 'A'); const adm = await login(env, 'admin@agrolab.co');
  const v = (await call(env, 'POST', '/api/auth/register-vet', { body: { name: 'V', email: 'v@x.co', password: 'password-1', clinicName: '=HYPERLINK("http://malo")', labId: 'agrolab', code: lab.inviteCode } })).json();
  const sv = (await svcs(env, v.token, 'agrolab'))[0];
  await newReq(env, v.token, 'agrolab', [pat('Rex, "el bueno"', [sv.id], { owner: 'Ñandú Gómez', obs: '+cmd|calc' }), pat('Otro', [sv.id])]);
  const csv = await call(env, 'GET', '/api/requests/export.csv', { token: adm.token }); const t = csv.res.body;
  assert.match(csv.res.headers['content-type'], /text\/csv/); assert.ok(t.startsWith('﻿Solicitud,'));
  assert.ok(t.includes("'=HYPERLINK") && t.includes("'+cmd|calc") && t.includes('"Rex, ""el bueno"""') && t.includes('Ñandú')); assert.equal(t.trim().split('\r\n').length, 3, 'una fila por paciente');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await call(env, 'GET', '/api/requests/export.xlsx', { token: adm.token })).res.rawPayload); const ws = wb.worksheets[0];
  assert.equal(ws.rowCount, 3); assert.equal(ws.getRow(2).getCell(1).value, 'S-0001'); assert.equal(ws.getRow(2).getCell(4).value, `'=HYPERLINK("http://malo")`); assert.equal(typeof ws.getRow(2).getCell(15).value, 'number');
  assert.equal((await call(env, 'GET', '/api/requests/export.csv', { token: v.token })).res.body.trim().split('\r\n').length, 3);
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
  await newReq(a, v.token, 'agrolab', [pat('Max', [sv.id])]);
  await a.repo.flush();
  const b = await boot(file);
  const s = await login(b, 'v@x.co', 'password-1'); assert.ok(s.token);
  const list = (await call(b, 'GET', '/api/requests', { token: s.token })).json(); assert.equal(list.total, 1); assert.ok(list.items[0].createdAt);
  assert.equal((await newReq(b, s.token, 'agrolab', [pat('Otro', [sv.id])])).json().request.code, 'S-0002', 'el consecutivo continúa');
});

test('validación de solicitud', async () => {
  const env = await boot(null); const lab = await mkLab(env, 'agrolab', 'A'); const v = await reg(env, 'agrolab', lab.inviteCode);
  const sv = (await svcs(env, v.token, 'agrolab'))[0], ok = [pat('M', [sv.id])];
  const bads = [{ patients: [] }, { patients: [pat('M', [])] }, { patients: [pat('M', ['no-existe'])] }, { patients: [pat('', [sv.id])] }, { patients: [pat('M', [sv.id], { species: 'dragón' })] }, { delivery: 'RECOGIDA' }, { patients: Array(21).fill(ok[0]) }];
  for (const bad of bads) assert.equal((await call(env, 'POST', '/api/requests', { token: v.token, body: { labId: 'agrolab', delivery: 'LAB', patients: ok, ...bad } })).status, 422, JSON.stringify(bad).slice(0, 60));
  assert.equal((await newReq(env, v.token, 'agrolab', ok, { delivery: 'RECOGIDA', addr: 'Cra 7 # 45-10' })).status, 201);
  assert.equal((await call(env, 'POST', '/api/requests', { body: { labId: 'agrolab', patients: ok } })).status, 401);
  const r = (await newReq(env, v.token, 'agrolab', ok)).json().request;
  assert.equal((await call(env, 'POST', `/api/requests/${r.id}/cancel`, { token: v.token })).status, 200);
  assert.equal((await call(env, 'GET', `/api/requests/${r.id}`, { token: v.token })).json().request.status, 'cancelada');
});

test('interfaz: archivos estáticos, aplicación instalable y política de seguridad', async () => {
  const env = await boot(null); const get = u => env.app.inject({ method: 'GET', url: u });
  const home = await get('/'); assert.equal(home.statusCode, 200); const csp = home.headers['content-security-policy'];
  for (const d of ["font-src 'self'", "worker-src 'self'", "manifest-src 'self'", "frame-ancestors 'none'", "default-src 'none'"]) assert.ok(csp.includes(d), d);
  assert.ok(!/script-src[^;]*https?:/.test(csp), 'scripts solo del propio origen');
  for (const [u, type] of [['/assets/app.js', /javascript/], ['/assets/app.css', /css/], ['/assets/themes.css', /css/], ['/assets/fonts.css', /css/], ['/assets/fonts/ibmplexsans-400.woff2', /woff2/], ['/assets/icon-512.png', /png/], ['/manifest.webmanifest', /manifest\+json/], ['/sw.js', /javascript/]])
    { const r = await get(u); assert.equal(r.statusCode, 200, u); assert.match(r.headers['content-type'], type, u); }
  assert.equal((await get('/sw.js')).headers['service-worker-allowed'], '/');
  for (const u of ['/assets/..%2fsrc%2fserver.js', '/assets/server.js', '/assets/fonts/..%2fapp.js', '/assets/datos.json', '/assets/nada.png']) assert.equal((await get(u)).statusCode, 404, u);
  const man = JSON.parse((await get('/manifest.webmanifest')).body); assert.equal(man.display, 'standalone'); assert.ok(man.icons.some(i => i.purpose === 'maskable'));
  const sw = (await get('/sw.js')).body; assert.ok(sw.includes("'/api/'") && sw.includes("'/_blob/'"), 'el service worker nunca guarda datos clínicos');
});
