import { loadConfig } from './config.js';
import { createStorage } from './storage/index.js';
import { createScanner } from './documents/scanner.js';
import { DocumentWorker } from './documents/worker.js';
import { MemoryRepository } from './db/memory.js';
import { SqlRepository } from './db/sql.js';
import { buildApp } from './http/app.js';

const cfg = loadConfig();
const repo = cfg.db ? await SqlRepository.connect(cfg.db) : new MemoryRepository();
if (!cfg.db) console.warn('⚠ Sin SQL_SERVER: usando base en MEMORIA (solo desarrollo; se pierde al reiniciar).');
const storage = await createStorage(cfg.storage);
const app = await buildApp({ cfg, repo, storage, logger: true });
const worker = new DocumentWorker({ repo, storage, scanner: createScanner(cfg.scanner) }).start();
// Purga de retención vencida cada 6 h
setInterval(() => app.documents.purgeExpired().catch(e => app.log.error(e)), 6 * 3600_000).unref();
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, async () => { worker.stop(); await app.close(); process.exit(0); });
await app.listen({ port: cfg.port, host: '0.0.0.0' });
