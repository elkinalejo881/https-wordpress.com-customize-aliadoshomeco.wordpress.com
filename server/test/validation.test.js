import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectFile, sanitizeFilename } from '../src/documents/validation.js';
import { kindPolicy } from '../src/documents/kinds.js';
import { png, pdf } from './helpers.js';

const pol = (k, cfg = {}) => kindPolicy(k, cfg);
const code = p => p.then(() => 'OK', e => e.code);

test('acepta PDF e imagen válidos', async () => {
  assert.equal((await inspectFile(pdf(), pol('lab_result_pdf'))).mime, 'application/pdf');
  const r = await inspectFile(await png(), pol('patient_photo')); assert.deepEqual([r.width, r.height], [800, 600]);
});
test('rechaza por contenido real, no por extensión: PNG enviado como resultado PDF', async () => {
  assert.equal(await code(inspectFile(await png(), pol('lab_result_pdf'))), 'TYPE_NOT_ALLOWED');
});
test('rechaza ejecutable y texto disfrazados', async () => {
  assert.equal(await code(inspectFile(Buffer.from('MZ\x90\x00\x03\x00\x00\x00'.padEnd(200, 'A')), pol('attachment'))), 'TYPE_NOT_ALLOWED');
  assert.equal(await code(inspectFile(Buffer.from('<script>alert(1)</script>'), pol('attachment'))), 'TYPE_NOT_ALLOWED');
});
test('rechaza PDF con JavaScript / Launch / archivos incrustados', async () => {
  for (const x of ['/OpenAction<</S/JavaScript/JS(app.alert(1))>>', '/Names<</EmbeddedFiles 9 0 R>>/AA<</O<</S/Launch>>>>'])
    if (x.includes('JavaScript') || x.includes('Launch')) assert.equal(await code(inspectFile(pdf(x), pol('lab_result_pdf'))), 'PDF_ACTIVE_CONTENT');
});
test('límite de tamaño configurable por tipo', async () => {
  const b = await png(2000, 2000);
  assert.equal(await code(inspectFile(b, pol('patient_photo', { limitsMb: { patient_photo: 0.001 } }))), 'FILE_TOO_LARGE');
  assert.equal(await code(inspectFile(b, pol('patient_photo'))), 'OK');
});
test('rechaza vacío e imagen corrupta (cabecera PNG + basura)', async () => {
  assert.equal(await code(inspectFile(Buffer.alloc(0), pol('patient_photo'))), 'EMPTY_FILE');
  const good = await png(); const bad = Buffer.concat([good.subarray(0, 40), Buffer.alloc(30, 7)]);
  assert.equal(await code(inspectFile(bad, pol('patient_photo'))), 'CORRUPT_IMAGE');
});
test('sanitiza nombres con rutas y caracteres de control', () => {
  assert.equal(sanitizeFilename('../../etc/pass\u0000wd'), 'passwd');
  assert.equal(sanitizeFilename('C:\\x\\foto<1>.jpg'), 'foto1.jpg');
  assert.equal(sanitizeFilename('...'), 'archivo');
});
