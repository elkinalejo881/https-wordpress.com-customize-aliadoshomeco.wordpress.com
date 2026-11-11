// Uso (desarrollo): AUTH_JWT_SECRET=... node scripts/token.js <tenantId> <rol> [clinicId|ownerId]
import { issueToken } from '../src/auth.js';
const [tenantId, role = 'lab_admin', extra] = process.argv.slice(2);
if (!tenantId || !process.env.AUTH_JWT_SECRET) { console.error('Faltan tenantId o AUTH_JWT_SECRET'); process.exit(1); }
console.log(issueToken({ sub: `dev-${role}`, tenantId, role, ...(role === 'vet' ? { clinicId: extra } : {}), ...(role === 'owner' ? { ownerId: extra } : {}) }, process.env.AUTH_JWT_SECRET, 8 * 3600));
