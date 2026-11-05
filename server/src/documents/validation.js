import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { invalid } from '../errors.js';

const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/tiff': 'tif', 'application/dicom': 'dcm' };
// Acciones activas dentro de un PDF. Heurística: un motor antivirus real es la defensa principal.
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA|SubmitForm|ImportData)(?![A-Za-z])/;
const MAX_PIXELS = 200e6;

export function sanitizeFilename(name = 'archivo') {
  const base = path.basename(String(name).replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^\.+/, '').trim();
  return (base || 'archivo').slice(0, 120);
}

/** Valida tamaño, tipo REAL (por contenido, no por extensión ni Content-Type) y estructura. Lanza error 422 si no es aceptable. */
export async function inspectFile(buffer, policy) {
  if (!buffer?.length) throw invalid('EMPTY_FILE', 'El archivo está vacío');
  if (buffer.length > policy.maxBytes) throw invalid('FILE_TOO_LARGE', `Supera el máximo de ${Math.round(policy.maxBytes / 1048576)} MB para este tipo de documento`);

  const ft = await fileTypeFromBuffer(buffer);
  if (!ft || !policy.mimes.includes(ft.mime)) throw invalid('TYPE_NOT_ALLOWED', `Tipo de archivo no permitido${ft ? ` (${ft.mime})` : ''}`);

  const out = { mime: ft.mime, ext: EXT[ft.mime] ?? ft.ext, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), width: null, height: null, renderable: false };

  if (ft.mime === 'application/pdf') {
    if (PDF_ACTIVE.test(buffer.toString('latin1'))) throw invalid('PDF_ACTIVE_CONTENT', 'El PDF contiene contenido activo (scripts, archivos incrustados o acciones) y no se acepta');
  } else if (ft.mime !== 'application/dicom') {
    try {
      const m = await sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata();
      if (!m.width || !m.height) throw new Error('sin dimensiones');
      Object.assign(out, { width: m.width, height: m.height, renderable: true });
    } catch { throw invalid('CORRUPT_IMAGE', 'La imagen está dañada o no se puede leer'); }
  }
  return out;
}
