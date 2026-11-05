import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { LocalFsStorage } from '../src/storage/local.js';

const mk = () => new LocalFsStorage({ root: mkdtempSync(path.join(os.tmpdir(), 's-')), publicBaseUrl: 'http://h', signingSecret: 'k'.repeat(32) });

test('put/get/exists/delete/list', async () => {
  const s = mk(); await s.put('t1/2026/a/original.pdf', Buffer.from('hola'), {});
  assert.equal((await s.getBuffer('t1/2026/a/original.pdf')).toString(), 'hola');
  assert.equal(await s.exists('t1/2026/a/original.pdf'), true);
  const l = []; for await (const k of s.list('t1/')) l.push(k); assert.deepEqual(l, ['t1/2026/a/original.pdf']);
  await s.delete('t1/2026/a/original.pdf'); assert.equal(await s.exists('t1/2026/a/original.pdf'), false);
});
test('rechaza claves con traversal', async () => {
  const s = mk();
  for (const k of ['../etc/passwd', 'a/../../b', '/abs', 'a//b']) await assert.rejects(s.put(k, Buffer.from('x'), {}));
});
test('URL firmada: válida, manipulada y vencida', async () => {
  const s = mk(); await s.put('t1/f.txt', Buffer.from('dato'), {});
  const tok = u => u.split('/_blob/')[1];
  const ok = await s.signedUrl('t1/f.txt', { expiresInSec: 60, contentType: 'text/plain' });
  assert.equal((await s.resolveToken(tok(ok))).data.toString(), 'dato');
  const t = tok(ok); assert.equal(await s.resolveToken(t.slice(0, -2) + 'xx'), null);
  const [b, sig] = t.split('.'); const forged = Buffer.from(JSON.stringify({ k: 't2/otro', e: 9e9 })).toString('base64url');
  assert.equal(await s.resolveToken(`${forged}.${sig}`), null); void b;
  const old = await s.signedUrl('t1/f.txt', { expiresInSec: -5 }); assert.equal(await s.resolveToken(tok(old)), null);
});
