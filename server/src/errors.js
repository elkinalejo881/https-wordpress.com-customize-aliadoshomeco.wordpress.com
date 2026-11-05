export class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const notFound = () => new AppError(404, 'NOT_FOUND', 'Documento no encontrado');
export const forbidden = (m = 'Sin permiso para esta operación') => new AppError(403, 'FORBIDDEN', m);
export const invalid = (code, m) => new AppError(422, code, m);
