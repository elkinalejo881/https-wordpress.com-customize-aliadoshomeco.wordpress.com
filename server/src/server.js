import { loadConfig } from './config.js';
import { createStorage } from './storage/index.js';
import { createScanner } from './documents/scanner.js';
import { DocumentWorker } from './documents/worker.js';
import { PilotStore } from './db/pilot.js';
import { buildApp } from './http/app.js';

const cfg = loadConfig();
// SqlRepository solo cubre DOCUMENTOS; usuarios/laboratorios/solicitudes aún viven en PilotStore (archivo JSON). Ver docs/PILOTO.md.
const repo = await PilotStore.open(process.env.DATA_FILE ?? '.data/datos.json');
if (cfg.db) console.warn('⚠ SQL_SERVER definido pero el piloto usa PilotStore para todo; SQL aún no está conectado al dominio.');
console.warn('ℹ Modo PILOTO: datos en', process.env.DATA_FILE ?? '.data/datos.json');
const storage = await createStorage(cfg.storage);
const app = await buildApp({ cfg, repo, storage, logger: true });
const worker = new DocumentWorker({ repo, storage, scanner: createScanner(cfg.scanner) }).start();
// Purga de retención vencida cada 6 h
setInterval(() => app.documents.purgeExpired().catch(e => app.log.error(e)), 6 * 3600_000).unref();
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, async () => { worker.stop(); await app.close(); await repo.flush(); process.exit(0); });
await app.listen({ port: cfg.port, host: process.env.HOST ?? '0.0.0.0' });
