-- SQL Server / Azure SQL. Solo METADATOS: los binarios viven en Blob Storage (StorageKey).
-- Idempotente: se puede ejecutar varias veces.
IF OBJECT_ID('dbo.Documents') IS NULL
CREATE TABLE dbo.Documents (
  Id              UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  TenantId        VARCHAR(64)   NOT NULL,
  Kind            VARCHAR(32)   NOT NULL,
  Status          VARCHAR(16)   NOT NULL,           -- processing | available | rejected | failed
  FileName        NVARCHAR(160) NOT NULL,
  Mime            VARCHAR(100)  NOT NULL,
  SizeBytes       BIGINT        NOT NULL,
  Sha256          CHAR(64)      NOT NULL,
  StorageKey      VARCHAR(450)  NOT NULL,           -- referencia al objeto original (inmutable)
  Width           INT NULL, Height INT NULL,
  PatientId       VARCHAR(64) NULL, OwnerId VARCHAR(64) NULL, ClinicId VARCHAR(64) NULL,
  VeterinarianId  VARCHAR(64) NULL, RequestId VARCHAR(64) NULL,
  VisibleToOwner  BIT NOT NULL DEFAULT 0,
  UploadedBy      VARCHAR(64) NOT NULL,
  CreatedAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  RetentionUntil  DATETIME2(3) NOT NULL,            -- no se purga antes de esta fecha
  DeletedAt       DATETIME2(3) NULL, DeletedBy VARCHAR(64) NULL,
  RejectReason    NVARCHAR(200) NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Documents_Patient')
  CREATE INDEX IX_Documents_Patient ON dbo.Documents (TenantId, PatientId, CreatedAt DESC) INCLUDE (Kind, Status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Documents_Request')
  CREATE INDEX IX_Documents_Request ON dbo.Documents (TenantId, RequestId) WHERE RequestId IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Documents_Clinic')
  CREATE INDEX IX_Documents_Clinic ON dbo.Documents (TenantId, ClinicId, CreatedAt DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Documents_Owner')
  CREATE INDEX IX_Documents_Owner ON dbo.Documents (TenantId, OwnerId, CreatedAt DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Documents_Dedupe')
  CREATE INDEX IX_Documents_Dedupe ON dbo.Documents (TenantId, Sha256, PatientId, Kind) WHERE DeletedAt IS NULL;

IF OBJECT_ID('dbo.DocumentVariants') IS NULL
CREATE TABLE dbo.DocumentVariants (   -- miniatura y versión optimizada; el original NUNCA se modifica
  DocumentId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Documents(Id),
  Variant    VARCHAR(16) NOT NULL,    -- thumb | optimized
  StorageKey VARCHAR(450) NOT NULL, Mime VARCHAR(100) NOT NULL,
  Width INT NULL, Height INT NULL, SizeBytes BIGINT NOT NULL,
  PRIMARY KEY (DocumentId, Variant)
);

IF OBJECT_ID('dbo.DocumentAudit') IS NULL
CREATE TABLE dbo.DocumentAudit (      -- solo se inserta; sin UPDATE/DELETE para la cuenta de la aplicación
  Id BIGINT IDENTITY PRIMARY KEY,
  At DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  TenantId VARCHAR(64) NOT NULL, DocumentId UNIQUEIDENTIFIER NULL,
  Action VARCHAR(24) NOT NULL,        -- upload|view|download|list|delete|restore|purge|scan_reject|process_fail|duplicate
  ActorId VARCHAR(64) NULL, ActorRole VARCHAR(16) NULL, Ip VARCHAR(64) NULL, Detail NVARCHAR(400) NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Audit_Doc')
  CREATE INDEX IX_Audit_Doc ON dbo.DocumentAudit (TenantId, DocumentId, At DESC);

IF OBJECT_ID('dbo.DocumentJobs') IS NULL
CREATE TABLE dbo.DocumentJobs (       -- cola para procesamiento en segundo plano
  Id BIGINT IDENTITY PRIMARY KEY,
  DocumentId UNIQUEIDENTIFIER NOT NULL, TenantId VARCHAR(64) NOT NULL,
  Status VARCHAR(12) NOT NULL DEFAULT 'pending',   -- pending | running | done | failed
  Attempts INT NOT NULL DEFAULT 0, RunAfter DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  LockedUntil DATETIME2(3) NULL, LastError NVARCHAR(400) NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Jobs_Pending')
  CREATE INDEX IX_Jobs_Pending ON dbo.DocumentJobs (Status, RunAfter);
