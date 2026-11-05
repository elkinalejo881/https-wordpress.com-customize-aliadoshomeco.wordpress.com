import { forbidden, notFound } from '../errors.js';

/**
 * Principal (del token): { userId, tenantId, role, clinicId?, ownerId? }
 * Roles: lab_admin | lab_staff | vet | owner
 * Documento: { tenantId, clinicId, ownerId, visibleToOwner, status, deletedAt, ... }
 *
 * Regla 0: otro tenant => 404 (no revelar existencia). Se aplica además en CADA consulta SQL (WHERE TenantId = @t).
 */
export function assertVisible(p, d) {
  if (!d || d.tenantId !== p.tenantId) throw notFound();
  if (d.deletedAt && p.role !== 'lab_admin') throw notFound();
  if (p.role === 'lab_admin' || p.role === 'lab_staff') return;
  if (p.role === 'vet' && p.clinicId && d.clinicId === p.clinicId) return;
  if (p.role === 'owner' && p.ownerId && d.ownerId === p.ownerId && d.visibleToOwner) return;
  throw notFound();
}

export const canDownload = (p, d) => { assertVisible(p, d); if (d.status !== 'available') throw forbidden('El documento aún se está procesando o fue rechazado'); };

export function assertCanUpload(p, meta) {
  if (p.role === 'lab_admin' || p.role === 'lab_staff') return;
  if (p.role === 'vet' && p.clinicId && meta.clinicId === p.clinicId) return; // solo para su propia clínica
  throw forbidden('Su rol no puede cargar documentos');
}
export const assertCanDelete = p => { if (p.role !== 'lab_admin') throw forbidden('Solo el administrador puede eliminar o restaurar'); };

/** Filtro obligatorio que se añade a los listados según el rol (se traduce a SQL en el repositorio). */
export function listScope(p) {
  switch (p.role) {
    case 'lab_admin': return { includeDeleted: true };
    case 'lab_staff': return {};
    case 'vet': return { clinicId: p.clinicId ?? '__none__' };
    case 'owner': return { ownerId: p.ownerId ?? '__none__', visibleToOwner: true };
    default: return { clinicId: '__none__' };
  }
}
