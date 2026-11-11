import crypto from 'node:crypto';
import { AppError } from './errors.js';

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

/** JWT HS256 mínimo. En producción puede sustituirse por validación de tokens de Microsoft Entra ID sin tocar el resto. */
export function issueToken(claims, secret, ttlSec = 3600) {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSec })}`;
  return `${body}.${sign(body, secret)}`;
}

export function verifyToken(token, secret) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) throw new AppError(401, 'UNAUTHENTICATED', 'Sesión inválida');
  const exp = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret)), got = Buffer.from(parts[2]);
  if (exp.length !== got.length || !crypto.timingSafeEqual(exp, got)) throw new AppError(401, 'UNAUTHENTICATED', 'Sesión inválida');
  let c; try {
    const h = JSON.parse(Buffer.from(parts[0], 'base64url')); if (h.alg !== 'HS256') throw 0;
    c = JSON.parse(Buffer.from(parts[1], 'base64url'));
  } catch { throw new AppError(401, 'UNAUTHENTICATED', 'Sesión inválida'); }
  if (!c.exp || c.exp < Date.now() / 1000 || !c.tenantId || !c.sub || !['lab_admin', 'lab_staff', 'vet', 'owner'].includes(c.role)) throw new AppError(401, 'UNAUTHENTICATED', 'Sesión vencida o incompleta');
  return { userId: c.sub, tenantId: c.tenantId, role: c.role, clinicId: c.clinicId, ownerId: c.ownerId };
}
