import { LocalFsStorage } from './local.js';
import { AzureBlobStorage } from './azure.js';

/** Único lugar que conoce las implementaciones concretas. */
export async function createStorage(cfg) {
  switch (cfg.provider) {
    case 'azure': {
      const a = cfg.azure;
      if (a.connectionString || a.accountKey) return new AzureBlobStorage(a);
      const { DefaultAzureCredential } = await import('@azure/identity');
      return new AzureBlobStorage({ ...a, credential: new DefaultAzureCredential() });
    }
    case 'local': return new LocalFsStorage(cfg.local);
    default: throw new Error(`STORAGE_PROVIDER desconocido: ${cfg.provider}`);
  }
}
