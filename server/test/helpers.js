import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import sharp from 'sharp';
import { loadConfig } from '../src/config.js';
import { LocalFsStorage } from '../src/storage/local.js';
import { PilotStore } from '../src/db/pilot.js';
import { buildApp } from '../src/http/app.js';
import { DocumentWorker } from '../src/documents/worker.js';
import { createScanner } from '../src/documents/scanner.js';
import { issueToken } from '../src/auth.js';

export const SECRET = 'x'.repeat(40);
export async function setup(over = {}) {
  const cfg = { ...loadConfig({ AUTH_JWT_SECRET: SECRET }), ...over };
  const root = mkdtempSync(path.join(os.tmpdir(), 'blobs-'));
  const storage = new LocalFsStorage({ root, publicBaseUrl: 'http://x', signingSecret: SECRET });
  const repo = new PilotStore();
  for (const id of ['t1', 't2']) repo.createLab({ id, name: id, inviteCode: 'AAAA-BBBB', active: true, createdAt: new Date() });
  for (const [id, role, labId] of [['a1', 'lab_admin', 't1'], ['s1', 'lab_staff', 't1'], ['v1', 'vet', null], ['v2', 'vet', null], ['x1', 'lab_admin', 't2']])
    repo.createUser({ id, email: `${id}@x.co`, name: id, role, labId, clinicName: `Clínica ${id}`, passwordHash: 'x', createdAt: new Date() });
  repo.setLink('t1', 'v1', 'approved'); repo.setLink('t1', 'v2', 'approved');
  const app = await buildApp({ cfg, repo, storage });
  const worker = new DocumentWorker({ repo, storage, scanner: createScanner(cfg.scanner), log: {} });
  return { cfg, storage, repo, app, worker, svc: app.documents };
}
export const tok = (c) => issueToken({ sub: c.sub ?? 'u1', ...c }, SECRET);
export const P = {
  admin: { userId: 'a1', tenantId: 't1', role: 'lab_admin' }, staff: { userId: 's1', tenantId: 't1', role: 'lab_staff' },
  vet: { userId: 'v1', tenantId: 't1', role: 'vet', clinicId: 'v1' }, vet2: { userId: 'v2', tenantId: 't1', role: 'vet', clinicId: 'v2' },
  other: { userId: 'x1', tenantId: 't2', role: 'lab_admin' },
};
export const png = (w = 800, h = 600) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
export const jpgWithGps = async () => sharp({ create: { width: 400, height: 300, channels: 3, background: '#3a3' } }).withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '4/1 36/1 0/1' } }).jpeg().toBuffer();
export const pdf = (extra = '') => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R${extra}>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`);
export const multipart = (fields, files) => {
  const b = '----t' + Math.random().toString(16).slice(2), parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of files) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`), f.data, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
};
