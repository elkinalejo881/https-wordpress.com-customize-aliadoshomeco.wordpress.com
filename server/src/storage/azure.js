import { BlobServiceClient, StorageSharedKeyCredential, BlobSASPermissions, generateBlobSASQueryParameters, SASProtocol } from '@azure/storage-blob';
import { assertKey } from './provider.js';

/**
 * Azure Blob Storage. Contenedor PRIVADO (sin acceso anónimo). Dos modos de credencial:
 *  - connectionString / accountKey (SAS firmada con la clave de cuenta), o
 *  - Managed Identity (DefaultAzureCredential) con SAS de delegación de usuario (recomendado en producción).
 */
export class AzureBlobStorage {
  constructor({ container, connectionString, accountName, accountKey, credential }) {
    if (connectionString) {
      this.svc = BlobServiceClient.fromConnectionString(connectionString);
      const m = /AccountName=([^;]+).*AccountKey=([^;]+)/.exec(connectionString);
      if (m) this.key = new StorageSharedKeyCredential(m[1], m[2]);
    } else if (accountKey) {
      this.key = new StorageSharedKeyCredential(accountName, accountKey);
      this.svc = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, this.key);
    } else {
      this.svc = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, credential); // DefaultAzureCredential
    }
    this.containerName = container; this.c = this.svc.getContainerClient(container); this.udk = null;
  }
  async put(key, data, { contentType }) {
    assertKey(key);
    await this.c.getBlockBlobClient(key).uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } });
  }
  getBuffer(key) { assertKey(key); return this.c.getBlobClient(key).downloadToBuffer(); }
  exists(key) { assertKey(key); return this.c.getBlobClient(key).exists(); }
  async delete(key) { assertKey(key); await this.c.getBlobClient(key).deleteIfExists(); }
  async *list(prefix) { for await (const b of this.c.listBlobsFlat({ prefix })) yield b.name; }
  async signedUrl(key, { expiresInSec, filename, disposition = 'inline', contentType }) {
    assertKey(key);
    const startsOn = new Date(Date.now() - 60_000), expiresOn = new Date(Date.now() + expiresInSec * 1000);
    const q = {
      containerName: this.containerName, blobName: key, permissions: BlobSASPermissions.parse('r'),
      startsOn, expiresOn, protocol: SASProtocol.Https, contentType,
      contentDisposition: filename ? `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}` : disposition,
    };
    const cred = this.key ?? await this.#userDelegationKey(expiresOn);
    const sas = generateBlobSASQueryParameters(q, cred, this.svc.accountName).toString();
    return `${this.c.getBlobClient(key).url}?${sas}`;
  }
  async #userDelegationKey(needUntil) {
    if (!this.udk || this.udk.signedExpiresOn < new Date(needUntil.getTime() + 60_000)) {
      this.udk = await this.svc.getUserDelegationKey(new Date(Date.now() - 60_000), new Date(Date.now() + 3600_000));
    }
    return this.udk;
  }
}
