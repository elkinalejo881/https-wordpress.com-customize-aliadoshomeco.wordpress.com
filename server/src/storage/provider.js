/**
 * Contrato de almacenamiento de objetos. La lógica de negocio SOLO conoce esta interfaz;
 * para cambiar de proveedor (Azure, S3/MinIO, disco) se escribe otra clase y se cambia
 * STORAGE_PROVIDER. Nada más de la aplicación se toca.
 *
 * @typedef {Object} SignOptions
 * @property {number} expiresInSec      vigencia del enlace
 * @property {string} [filename]        nombre sugerido al descargar
 * @property {'inline'|'attachment'} [disposition]
 * @property {string} [contentType]
 *
 * @typedef {Object} StorageProvider
 * @property {(key:string, data:Buffer, opts:{contentType:string})=>Promise<void>} put
 * @property {(key:string)=>Promise<Buffer>} getBuffer
 * @property {(key:string)=>Promise<boolean>} exists
 * @property {(key:string)=>Promise<void>} delete
 * @property {(prefix:string)=>AsyncIterable<string>} list      claves bajo un prefijo (conciliación)
 * @property {(key:string, opts:SignOptions)=>Promise<string>} signedUrl  URL de lectura de corta duración
 */

/** Las claves las genera el sistema, pero se validan igual (defensa en profundidad). */
export function assertKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,400}$/.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error('Clave de almacenamiento inválida');
  }
}

export const buildKey = (tenantId, documentId, variant, ext, date = new Date()) =>
  `${tenantId}/${date.getUTCFullYear()}/${documentId}/${variant}.${ext}`;
