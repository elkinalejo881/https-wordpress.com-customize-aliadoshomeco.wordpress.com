// Concilia SQL <-> almacenamiento. Uso: node scripts/reconciliar.js [--tenant=<id>]
//  - FALTANTES: la BD referencia un objeto que NO existe en el almacenamiento (restaurar desde respaldo/soft-delete).
//  - HUÉRFANOS: hay objetos sin registro en la BD (p. ej. tras restaurar la BD a un punto anterior). No se borran solos.
import { loadConfig } from '../src/config.js';
import { createStorage } from '../src/storage/index.js';
import { SqlRepository } from '../src/db/sql.js';
import { MemoryRepository } from '../src/db/memory.js';

const tenant = process.argv.find(a => a.startsWith('--tenant='))?.split('=')[1];
const cfg = loadConfig(); const storage = await createStorage(cfg.storage);
const repo = cfg.db ? await SqlRepository.connect(cfg.db) : new MemoryRepository();
const known = new Set(), missing = [], orphans = [];
for await (const r of repo.allStorageKeys()) { if (tenant && r.tenantId !== tenant) continue; known.add(r.key); if (!(await storage.exists(r.key))) missing.push(r); }
for await (const k of storage.list(tenant ? `${tenant}/` : '')) if (!known.has(k)) orphans.push(k);
console.log(JSON.stringify({ faltantes: missing.length, huerfanos: orphans.length, detalleFaltantes: missing.slice(0, 200), detalleHuerfanos: orphans.slice(0, 200) }, null, 2));
process.exit(missing.length ? 2 : 0);
