const json = (v, d) => { if (!v) return d; try { return JSON.parse(v); } catch { throw new Error('Variable JSON inválida'); } };

export function loadConfig(env = process.env) {
  const prod = env.NODE_ENV === 'production';
  const provider = env.STORAGE_PROVIDER ?? 'local';
  const cfg = {
    prod, port: Number(env.PORT ?? 3000), publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT ?? 3000}`,
    jwtSecret: env.AUTH_JWT_SECRET,
    limitsMb: json(env.DOC_LIMITS_MB, {}), retentionYears: json(env.DOC_RETENTION_YEARS, {}),
    signedUrlSec: Number(env.SIGNED_URL_SECONDS ?? 120), thumbUrlSec: Number(env.THUMB_URL_SECONDS ?? 300),
    maxFilesPerUpload: Number(env.MAX_FILES_PER_UPLOAD ?? 20), maxPageSize: 50,
    scanner: { clamdHost: env.CLAMD_HOST, clamdPort: Number(env.CLAMD_PORT ?? 3310) },
    db: env.SQL_SERVER ? { server: env.SQL_SERVER, database: env.SQL_DATABASE, user: env.SQL_USER, password: env.SQL_PASSWORD, options: { encrypt: true, trustServerCertificate: env.SQL_TRUST_CERT === '1' } } : null,
    storage: {
      provider,
      azure: { container: env.AZURE_CONTAINER ?? 'documentos', connectionString: env.AZURE_STORAGE_CONNECTION_STRING, accountName: env.AZURE_STORAGE_ACCOUNT, accountKey: env.AZURE_STORAGE_KEY },
      local: { root: env.LOCAL_STORAGE_ROOT ?? '.data/blobs', publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT ?? 3000}`, signingSecret: env.LOCAL_SIGNING_SECRET ?? env.AUTH_JWT_SECRET },
    },
  };
  if (!cfg.jwtSecret || cfg.jwtSecret.length < 32) throw new Error('AUTH_JWT_SECRET es obligatorio (mínimo 32 caracteres)');
  if (prod && provider === 'local' && env.ALLOW_LOCAL_STORAGE_IN_PROD !== '1') throw new Error('En producción use STORAGE_PROVIDER=azure');
  if (prod && !cfg.scanner.clamdHost && env.ALLOW_NO_AV !== '1') throw new Error('En producción configure CLAMD_HOST (antivirus) o ALLOW_NO_AV=1 asumiendo el riesgo');
  return cfg;
}
