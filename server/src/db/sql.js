import sql from 'mssql';

const VARIANTS = 'SELECT DocumentId, Variant, StorageKey, Mime, Width, Height, SizeBytes FROM dbo.DocumentVariants WHERE DocumentId IN';

const toDoc = r => ({
  id: r.Id.toLowerCase(), tenantId: r.TenantId, kind: r.Kind, status: r.Status, filename: r.FileName, mime: r.Mime, sizeBytes: Number(r.SizeBytes),
  sha256: r.Sha256, storageKey: r.StorageKey, width: r.Width, height: r.Height, patientId: r.PatientId, ownerId: r.OwnerId, clinicId: r.ClinicId,
  veterinarianId: r.VeterinarianId, requestId: r.RequestId, visibleToOwner: !!r.VisibleToOwner, uploadedBy: r.UploadedBy, createdAt: r.CreatedAt,
  retentionUntil: r.RetentionUntil, deletedAt: r.DeletedAt, deletedBy: r.DeletedBy, rejectReason: r.RejectReason, variants: {},
});

/**
 * Repositorio SQL Server / Azure SQL. TODAS las consultas llevan TenantId como parámetro y son parametrizadas
 * (nunca se concatenan valores del usuario). Nota: escrito contra el esquema de sql/001_documentos.sql; requiere
 * probarse contra una instancia real antes de producción (las pruebas automáticas usan MemoryRepository).
 */
export class SqlRepository {
  constructor(pool) { this.pool = pool; }
  static async connect(cfg) { return new SqlRepository(await new sql.ConnectionPool(cfg).connect()); }
  #req(params = {}) {
    const r = this.pool.request();
    for (const [k, [t, v]] of Object.entries(params)) r.input(k, t, v);
    return r;
  }
  async #withVariants(docs) {
    if (!docs.length) return docs;
    const req = this.pool.request(); const names = docs.map((d, i) => { req.input(`d${i}`, sql.UniqueIdentifier, d.id); return `@d${i}`; });
    const { recordset } = await req.query(`${VARIANTS} (${names.join(',')})`);
    const by = new Map(docs.map(d => [d.id, d]));
    for (const v of recordset) by.get(v.DocumentId.toLowerCase()).variants[v.Variant] = { key: v.StorageKey, mime: v.Mime, width: v.Width, height: v.Height, size: Number(v.SizeBytes) };
    return docs;
  }
  async insert(d) {
    await this.#req({
      id: [sql.UniqueIdentifier, d.id], t: [sql.VarChar(64), d.tenantId], kind: [sql.VarChar(32), d.kind], st: [sql.VarChar(16), d.status], fn: [sql.NVarChar(160), d.filename],
      mime: [sql.VarChar(100), d.mime], sz: [sql.BigInt, d.sizeBytes], sha: [sql.Char(64), d.sha256], key: [sql.VarChar(450), d.storageKey], w: [sql.Int, d.width], h: [sql.Int, d.height],
      pat: [sql.VarChar(64), d.patientId], own: [sql.VarChar(64), d.ownerId], cli: [sql.VarChar(64), d.clinicId], vet: [sql.VarChar(64), d.veterinarianId], req: [sql.VarChar(64), d.requestId],
      vis: [sql.Bit, d.visibleToOwner], up: [sql.VarChar(64), d.uploadedBy], ca: [sql.DateTime2(3), d.createdAt], ret: [sql.DateTime2(3), d.retentionUntil],
    }).query(`INSERT dbo.Documents (Id,TenantId,Kind,Status,FileName,Mime,SizeBytes,Sha256,StorageKey,Width,Height,PatientId,OwnerId,ClinicId,VeterinarianId,RequestId,VisibleToOwner,UploadedBy,CreatedAt,RetentionUntil)
      VALUES (@id,@t,@kind,@st,@fn,@mime,@sz,@sha,@key,@w,@h,@pat,@own,@cli,@vet,@req,@vis,@up,@ca,@ret)`);
  }
  async get(tenantId, id) {
    const { recordset } = await this.#req({ t: [sql.VarChar(64), tenantId], id: [sql.UniqueIdentifier, id] }).query('SELECT * FROM dbo.Documents WHERE TenantId=@t AND Id=@id');
    return recordset[0] ? (await this.#withVariants([toDoc(recordset[0])]))[0] : null;
  }
  async findDuplicate(tenantId, { patientId, kind, sha256 }) {
    const { recordset } = await this.#req({ t: [sql.VarChar(64), tenantId], p: [sql.VarChar(64), patientId ?? null], k: [sql.VarChar(32), kind], s: [sql.Char(64), sha256] })
      .query("SELECT TOP 1 * FROM dbo.Documents WHERE TenantId=@t AND Sha256=@s AND Kind=@k AND DeletedAt IS NULL AND Status<>'rejected' AND ((PatientId=@p) OR (PatientId IS NULL AND @p IS NULL))");
    return recordset[0] ? toDoc(recordset[0]) : null;
  }
  async list(tenantId, f, { page, pageSize }) {
    const p = { t: [sql.VarChar(64), tenantId], off: [sql.Int, (page - 1) * pageSize], n: [sql.Int, pageSize] };
    const w = ['TenantId=@t'];
    if (!f.includeDeleted) w.push('DeletedAt IS NULL');
    const cols = { patientId: ['PatientId', 64], requestId: ['RequestId', 64], kind: ['Kind', 32], ownerId: ['OwnerId', 64], clinicId: ['ClinicId', 64], status: ['Status', 16] };
    for (const [k, [col, len]] of Object.entries(cols)) if (f[k] != null) { p[k] = [sql.VarChar(len), f[k]]; w.push(`${col}=@${k}`); }
    if (f.visibleToOwner) w.push('VisibleToOwner=1');
    const where = w.join(' AND ');
    const [{ recordset: c }, { recordset: rows }] = await Promise.all([
      this.#req(p).query(`SELECT COUNT(*) n FROM dbo.Documents WHERE ${where}`),
      this.#req(p).query(`SELECT * FROM dbo.Documents WHERE ${where} ORDER BY CreatedAt DESC, Id DESC OFFSET @off ROWS FETCH NEXT @n ROWS ONLY`),
    ]);
    return { total: c[0].n, items: await this.#withVariants(rows.map(toDoc)) };
  }
  async update(tenantId, id, patch) {
    const map = { status: ['Status', sql.VarChar(16)], width: ['Width', sql.Int], height: ['Height', sql.Int], deletedAt: ['DeletedAt', sql.DateTime2(3)], deletedBy: ['DeletedBy', sql.VarChar(64)], rejectReason: ['RejectReason', sql.NVarChar(200)] };
    const sets = [], params = { t: [sql.VarChar(64), tenantId], id: [sql.UniqueIdentifier, id] };
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'variants') continue;
      if (!map[k]) throw new Error(`Campo no actualizable: ${k}`);
      sets.push(`${map[k][0]}=@${k}`); params[k] = [map[k][1], v];
    }
    if (sets.length) await this.#req(params).query(`UPDATE dbo.Documents SET ${sets.join(',')} WHERE TenantId=@t AND Id=@id`);
    for (const [name, v] of Object.entries(patch.variants ?? {})) {
      await this.#req({ id: [sql.UniqueIdentifier, id], n: [sql.VarChar(16), name], k: [sql.VarChar(450), v.key], m: [sql.VarChar(100), v.mime], w: [sql.Int, v.width], h: [sql.Int, v.height], s: [sql.BigInt, v.size] })
        .query(`MERGE dbo.DocumentVariants AS x USING (SELECT @id DocumentId,@n Variant) y ON x.DocumentId=y.DocumentId AND x.Variant=y.Variant
          WHEN MATCHED THEN UPDATE SET StorageKey=@k,Mime=@m,Width=@w,Height=@h,SizeBytes=@s
          WHEN NOT MATCHED THEN INSERT (DocumentId,Variant,StorageKey,Mime,Width,Height,SizeBytes) VALUES (@id,@n,@k,@m,@w,@h,@s);`);
    }
  }
  async audit(e) {
    await this.#req({ t: [sql.VarChar(64), e.tenantId], d: [sql.UniqueIdentifier, e.documentId ?? null], a: [sql.VarChar(24), e.action], u: [sql.VarChar(64), e.actorId ?? null], r: [sql.VarChar(16), e.actorRole ?? null], ip: [sql.VarChar(64), e.ip ?? null], x: [sql.NVarChar(400), e.detail?.slice(0, 400) ?? null] })
      .query('INSERT dbo.DocumentAudit (TenantId,DocumentId,Action,ActorId,ActorRole,Ip,Detail) VALUES (@t,@d,@a,@u,@r,@ip,@x)');
  }
  async enqueue({ documentId, tenantId }) {
    await this.#req({ d: [sql.UniqueIdentifier, documentId], t: [sql.VarChar(64), tenantId] }).query('INSERT dbo.DocumentJobs (DocumentId,TenantId) VALUES (@d,@t)');
  }
  /** Reclama un trabajo de forma atómica (varios workers no toman el mismo): UPDLOCK + READPAST. */
  async claimJob(now, lockMs) {
    const { recordset } = await this.#req({ now: [sql.DateTime2(3), now], until: [sql.DateTime2(3), new Date(now.getTime() + lockMs)] }).query(`
      WITH n AS (SELECT TOP 1 * FROM dbo.DocumentJobs WITH (UPDLOCK, READPAST, ROWLOCK)
                 WHERE (Status='pending' AND RunAfter<=@now) OR (Status='running' AND LockedUntil<@now) ORDER BY Id)
      UPDATE n SET Status='running', Attempts=Attempts+1, LockedUntil=@until
      OUTPUT inserted.Id id, inserted.DocumentId documentId, inserted.TenantId tenantId, inserted.Attempts attempts;`);
    const j = recordset[0]; return j ? { ...j, documentId: j.documentId.toLowerCase() } : null;
  }
  async finishJob(id, { ok, error, retryAt }) {
    await this.#req({ id: [sql.BigInt, id], st: [sql.VarChar(12), ok ? 'done' : retryAt ? 'pending' : 'failed'], e: [sql.NVarChar(400), error?.slice(0, 400) ?? null], ra: [sql.DateTime2(3), retryAt ?? new Date()] })
      .query('UPDATE dbo.DocumentJobs SET Status=@st, LastError=@e, RunAfter=@ra, LockedUntil=NULL WHERE Id=@id');
  }
  async listPurgeable(now, limit = 100) {
    const { recordset } = await this.#req({ now: [sql.DateTime2(3), now], n: [sql.Int, limit] }).query('SELECT TOP (@n) * FROM dbo.Documents WHERE DeletedAt IS NOT NULL AND RetentionUntil<=@now');
    return this.#withVariants(recordset.map(toDoc));
  }
  async remove(tenantId, id) {
    const p = { t: [sql.VarChar(64), tenantId], id: [sql.UniqueIdentifier, id] };
    await this.#req(p).query('DELETE v FROM dbo.DocumentVariants v JOIN dbo.Documents d ON d.Id=v.DocumentId WHERE d.TenantId=@t AND d.Id=@id; DELETE FROM dbo.Documents WHERE TenantId=@t AND Id=@id');
  }
  async *allStorageKeys() {
    const { recordset } = await this.pool.request().query('SELECT TenantId, Id, StorageKey [key] FROM dbo.Documents UNION ALL SELECT d.TenantId, d.Id, v.StorageKey FROM dbo.DocumentVariants v JOIN dbo.Documents d ON d.Id=v.DocumentId');
    for (const r of recordset) yield { tenantId: r.TenantId, id: r.Id.toLowerCase(), key: r.key };
  }
}
