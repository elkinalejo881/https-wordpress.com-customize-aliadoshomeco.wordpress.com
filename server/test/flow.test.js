import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { setup, tok, P, png, pdf, jpgWithGps, multipart } from './helpers.js';

const asTok = p => ({ authorization: `Bearer ${tok({ sub: p.userId, ...p })}` });
async function upload(env, who, files, fields = {}) {
  const m = multipart({ kind: 'patient_photo', patientId: 'pac1', clinicId: 'c1', ownerId: 'ow1', ...fields }, files);
  return env.app.inject({ method: 'POST', url: '/api/documents', payload: m.payload, headers: { ...m.headers, ...asTok(who) } });
}
const get = (env, who, url) => env.app.inject({ method: 'GET', url, headers: asTok(who) });
const fetchBlob = async (env, url) => env.app.inject({ method: 'GET', url: url.replace('http://x', '') });

test('sin token o con token manipulado => 401', async () => {
  const env = await setup();
  assert.equal((await env.app.inject({ method: 'GET', url: '/api/documents' })).statusCode, 401);
  const bad = tok(P.admin).slice(0, -3) + 'abc';
  assert.equal((await env.app.inject({ method: 'GET', url: '/api/documents', headers: { authorization: `Bearer ${bad}` } })).statusCode, 401);
});

test('carga múltiple, procesamiento, miniatura, original intacto y sin GPS en variantes', async () => {
  const env = await setup(); const orig = await jpgWithGps();
  const r = await upload(env, P.staff, [{ name: 'a.jpg', type: 'image/jpeg', data: orig }, { name: 'b.png', type: 'image/png', data: await png() }, { name: 'mal.png', type: 'image/png', data: Buffer.from('no soy imagen') }]);
  assert.equal(r.statusCode, 201);
  const res = r.json().results; assert.deepEqual(res.map(x => x.ok), [true, true, false]); assert.equal(res[2].code, 'TYPE_NOT_ALLOWED');
  // antes de procesar no se puede descargar
  assert.equal((await get(env, P.staff, `/api/documents/${res[0].id}/url`)).statusCode, 403);
  await env.worker.drain();
  const d = await env.repo.get('t1', res[0].id);
  assert.equal(d.status, 'available'); assert.ok(d.variants.thumb && d.variants.optimized);
  assert.deepEqual((await env.storage.getBuffer(d.storageKey)), orig, 'original byte a byte idéntico');
  const th = await env.storage.getBuffer(d.variants.thumb.key); const meta = await sharp(th).metadata();
  assert.equal(meta.exif, undefined, 'miniatura sin EXIF/GPS'); assert.ok(meta.width <= 320);
  const origMeta = await sharp(orig).metadata(); assert.ok(origMeta.exif, 'el original conserva sus metadatos');
  // URL firmada sirve el contenido
  const u = (await get(env, P.staff, `/api/documents/${d.id}/url?disposition=attachment`)).json();
  const blob = await fetchBlob(env, u.url); assert.equal(blob.statusCode, 200);
  assert.match(blob.headers['content-disposition'], /^attachment/); assert.deepEqual(blob.rawPayload, orig);
});

test('aislamiento por tenant: otro laboratorio recibe 404 y la lista sale vacía', async () => {
  const env = await setup(); const id = (await upload(env, P.admin, [{ name: 'a.png', type: 'image/png', data: await png() }])).json().results[0].id;
  await env.worker.drain();
  for (const path of [`/api/documents/${id}`, `/api/documents/${id}/url`]) assert.equal((await get(env, P.other, path)).statusCode, 404);
  assert.equal((await get(env, P.other, '/api/documents')).json().total, 0);
  assert.equal((await env.app.inject({ method: 'DELETE', url: `/api/documents/${id}`, headers: asTok(P.other) })).statusCode, 404);
});

test('veterinarios solo ven su clínica; propietarios solo lo suyo y visible', async () => {
  const env = await setup();
  const a = (await upload(env, P.staff, [{ name: '1.png', type: 'image/png', data: await png(100, 100) }], { clinicId: 'c1', ownerId: 'ow1' })).json().results[0].id;
  const b = (await upload(env, P.staff, [{ name: '2.png', type: 'image/png', data: await png(110, 100) }], { clinicId: 'c2', ownerId: 'ow2' })).json().results[0].id;
  const c = (await upload(env, P.staff, [{ name: '3.png', type: 'image/png', data: await png(120, 100) }], { kind: 'sample_photo', clinicId: 'c1', ownerId: 'ow1' })).json().results[0].id; // no visible al propietario
  await env.worker.drain();
  const ids = async who => (await get(env, who, '/api/documents')).json().items.map(i => i.id).sort();
  assert.deepEqual(await ids(P.vet), [a, c].sort()); assert.deepEqual(await ids(P.vet2), [b]);
  assert.deepEqual(await ids(P.owner), [a]);
  assert.equal((await get(env, P.vet, `/api/documents/${b}/url`)).statusCode, 404);
  assert.equal((await get(env, P.owner, `/api/documents/${c}/url`)).statusCode, 404);
  assert.equal((await get(env, P.owner, `/api/documents/${a}/url`)).statusCode, 200);
  // el filtro del usuario no puede ampliar su alcance
  assert.deepEqual((await get(env, P.vet, '/api/documents?patientId=pac1&clinicId=c2')).json().items.map(i => i.id).sort(), [a, c].sort());
  // permisos de escritura
  assert.equal((await upload(env, P.owner, [{ name: 'x.png', type: 'image/png', data: await png(9, 9) }])).statusCode, 422);
  assert.equal((await upload(env, P.vet, [{ name: 'y.png', type: 'image/png', data: await png(10, 9) }], { clinicId: 'c2' })).json().results[0].code, 'FORBIDDEN');
  assert.equal((await env.app.inject({ method: 'DELETE', url: `/api/documents/${a}`, headers: asTok(P.staff) })).statusCode, 403);
});

test('EICAR es rechazado por el antivirus y el objeto se elimina', async () => {
  const env = await setup();
  const eicar = Buffer.concat([pdf(), Buffer.from('\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')]);
  const id = (await upload(env, P.admin, [{ name: 'v.pdf', type: 'application/pdf', data: eicar }], { kind: 'lab_result_pdf' })).json().results[0].id;
  await env.worker.drain(); const d = await env.repo.get('t1', id);
  assert.equal(d.status, 'rejected'); assert.equal(await env.storage.exists(d.storageKey), false);
  assert.equal((await get(env, P.admin, `/api/documents/${id}/url`)).statusCode, 403);
  assert.ok(env.repo.auditLog.some(a => a.action === 'scan_reject'));
});

test('si el antivirus falla NUNCA se aprueba: reintenta y termina en failed', async () => {
  const env = await setup(); env.worker.scanner = { scan: async () => { throw new Error('clamd caído'); } };
  let t = new Date(); env.worker.now = () => t;
  const id = (await upload(env, P.admin, [{ name: 'a.png', type: 'image/png', data: await png() }])).json().results[0].id;
  for (let i = 0; i < 6; i++) { await env.worker.drain(); t = new Date(t.getTime() + 3600_000); }
  assert.equal((await env.repo.get('t1', id)).status, 'failed');
});

test('duplicados: mismo archivo, mismo paciente y tipo no se guarda dos veces', async () => {
  const env = await setup(); const data = await png();
  const r1 = (await upload(env, P.admin, [{ name: 'a.png', type: 'image/png', data }])).json().results[0];
  const r2 = (await upload(env, P.admin, [{ name: 'otra.png', type: 'image/png', data }])).json().results[0];
  assert.equal(r2.duplicate, true); assert.equal(r2.id, r1.id); assert.equal(env.repo.docs.size, 1);
  const r3 = (await upload(env, P.admin, [{ name: 'a.png', type: 'image/png', data }], { patientId: 'pac2' })).json().results[0];
  assert.equal(r3.duplicate, false);
});

test('paginación, auditoría de visualización/descarga/listado y límites de página', async () => {
  const env = await setup();
  for (let i = 0; i < 5; i++) await upload(env, P.admin, [{ name: `${i}.png`, type: 'image/png', data: await png(50 + i, 50) }]);
  await env.worker.drain();
  const p1 = (await get(env, P.admin, '/api/documents?pageSize=2&page=1')).json(), p3 = (await get(env, P.admin, '/api/documents?pageSize=2&page=3')).json();
  assert.equal(p1.total, 5); assert.equal(p1.items.length, 2); assert.equal(p1.hasMore, true); assert.equal(p3.items.length, 1); assert.equal(p3.hasMore, false);
  assert.ok(p1.items[0].thumbnailUrl);
  assert.equal((await get(env, P.admin, '/api/documents?pageSize=9999')).json().pageSize, 50);
  const id = p1.items[0].id;
  await get(env, P.vet, `/api/documents/${id}/url`); await get(env, P.admin, `/api/documents/${id}/url?disposition=attachment`); await get(env, P.admin, `/api/documents/${id}/url`);
  const acts = env.repo.auditLog.map(a => a.action);
  for (const a of ['upload', 'list', 'download', 'view']) assert.ok(acts.includes(a), a);
  assert.ok(env.repo.auditLog.every(a => a.tenantId && a.actorId));
});

test('borrado lógico, restauración y purga solo tras vencer la retención', async () => {
  const env = await setup(); let now = new Date('2026-01-01T00:00:00Z'); env.svc.now = () => now;
  const id = (await upload(env, P.admin, [{ name: 'a.png', type: 'image/png', data: await png() }])).json().results[0].id;
  await env.worker.drain();
  assert.equal((await env.app.inject({ method: 'DELETE', url: `/api/documents/${id}`, headers: asTok(P.admin) })).statusCode, 204);
  assert.equal((await get(env, P.staff, `/api/documents/${id}`)).statusCode, 404);   // el personal ya no lo ve
  assert.equal((await get(env, P.admin, `/api/documents/${id}`)).statusCode, 200);   // el admin sí (puede restaurarlo)
  assert.equal(await env.svc.purgeExpired(), 0, 'no se purga dentro de la retención');
  assert.equal((await env.app.inject({ method: 'POST', url: `/api/documents/${id}/restore`, headers: asTok(P.admin) })).statusCode, 204);
  assert.equal((await get(env, P.staff, `/api/documents/${id}`)).statusCode, 200);
  await env.app.inject({ method: 'DELETE', url: `/api/documents/${id}`, headers: asTok(P.admin) });
  const d = await env.repo.get('t1', id); d.retentionUntil = new Date('2025-01-01'); await env.repo.insert(d);
  assert.equal(await env.svc.purgeExpired(), 1); assert.equal(await env.storage.exists(d.storageKey), false); assert.equal(env.repo.docs.size, 0);
});

test('límite de tamaño por configuración, en la API', async () => {
  const env = await setup({ limitsMb: { patient_photo: 0.0005 } });
  const r = await upload(env, P.admin, [{ name: 'a.png', type: 'image/png', data: await png(1500, 1500) }]);
  assert.equal(r.json().results[0].code, 'FILE_TOO_LARGE');
});

test('tipo de documento y campos inválidos', async () => {
  const env = await setup();
  assert.equal((await upload(env, P.admin, [{ name: 'a.png', type: 'image/png', data: await png() }], { kind: 'virus' })).json().results[0].code, 'BAD_KIND');
  assert.equal((await upload(env, P.admin, [{ name: 'a.png', type: 'image/png', data: await png() }], { patientId: "x'; DROP TABLE" })).json().results[0].code, 'BAD_FIELD');
});
