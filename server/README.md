# AsisVet · Servicio de documentos

Almacenamiento documental centralizado: PDF, fotografías, radiografías, ecografías e informes.

**Arquitectura**
- **SQL Server / Azure SQL** = fuente de verdad de metadatos (`sql/001_documentos.sql`). Los binarios **nunca** van a la base.
- **Almacenamiento de objetos** detrás de la interfaz `StorageProvider` (`src/storage/provider.js`). Incluye `azure` (Blob Storage privado) y `local` (desarrollo). Cambiar de proveedor = escribir una clase y cambiar `STORAGE_PROVIDER`; la lógica de negocio no se toca.
- **Worker en segundo plano** (cola en la tabla `DocumentJobs`): antivirus → miniatura (320 px) y versión optimizada (1600 px, WebP, sin EXIF/GPS). El original no se modifica.
- SQLite no se usa en el servidor; solo podría usarse como caché offline en el cliente.

**Seguridad aplicada**
Tenant en cada consulta · permisos por rol/clínica/propietario en cada listado, vista y descarga (otro tenant → 404) · URLs firmadas de solo lectura (120 s) · validación por contenido real (no por extensión) · PDF con scripts/archivos incrustados rechazado · imágenes decodificadas y limitadas en píxeles · antivirus (ClamAV + EICAR) y **nunca se aprueba si el motor falla** · límites de tamaño por tipo · auditoría de cargas, vistas, descargas, borrados · borrado lógico + retención · duplicados por hash (mismo paciente y tipo).

## Uso
```bash
npm install
npm test                      # 21 pruebas
export AUTH_JWT_SECRET=$(openssl rand -hex 24)
npm start                     # desarrollo: base en memoria + disco local (.data/)
node scripts/token.js lab1 lab_admin    # imprime un token de prueba
# abrir http://localhost:3000/#token=<token>
```

## API
| Método | Ruta | |
|---|---|---|
| POST | `/api/documents` | multipart: `kind`, `patientId` o `requestId`, `clinicId`, `ownerId`, `veterinarianId`, `visibleToOwner`, `files` (varios) |
| GET | `/api/documents?patientId&requestId&kind&page&pageSize` | paginado (máx. 50) con URL firmada de miniatura |
| GET | `/api/documents/:id` | metadatos |
| GET | `/api/documents/:id/url?variant=original\|optimized\|thumb&disposition=inline\|attachment` | URL firmada |
| DELETE / POST | `/api/documents/:id` · `/:id/restore` | borrado lógico / restaurar (solo `lab_admin`) |

Tipos (`kind`): `lab_result_pdf`, `clinical_history_pdf`, `patient_photo`, `sample_photo`, `diagnostic_image`, `radiograph`, `ultrasound`, `attachment`, `generated_report`.

## Límites conocidos
- `SqlRepository` y `AzureBlobStorage` **no se han probado contra servicios reales** (sin acceso desde este entorno); las pruebas usan repositorio en memoria y almacenamiento local, que cumplen la misma interfaz.
- La carga se recibe completa en memoria (hasta el máximo del tipo, p. ej. 100 MB). Para archivos mayores conviene cargar directo a Blob con SAS de escritura.
- No hay miniaturas de PDF ni vista previa DICOM (se descargan).
- La detección de contenido activo en PDF es heurística; la defensa principal es el antivirus.
- Sin limitación de tasa propia (usar WAF/API Management). Ver `docs/OPERACION.md`.
