# Operación: respaldos, retención y recuperación

> Los comandos `az` de abajo están escritos según la documentación de Azure pero **no se han ejecutado contra una cuenta real**. Pruébelos en un entorno de ensayo antes de depender de ellos.

## 1. Qué vive dónde
| Dato | Lugar | Respaldo |
|---|---|---|
| Metadatos, relaciones, auditoría, cola | Azure SQL / SQL Server | Copias automáticas con restauración a un punto en el tiempo (PITR) + retención larga (LTR) |
| Original del archivo (inmutable) y variantes | Blob Storage, contenedor **privado** | Soft delete + versionado + replicación geográfica |
| Variantes (miniatura/optimizada) | Blob Storage | Se pueden **regenerar** desde el original (ver §4.3) |

Clave de objeto: `{tenantId}/{año}/{documentId}/original.{ext}` — nunca se sobrescribe.

## 2. Configuración recomendada en Azure
```bash
# Sin acceso anónimo, solo HTTPS, TLS 1.2+
az storage account update -n $CUENTA -g $RG --allow-blob-public-access false --https-only true --min-tls-version TLS1_2
# Papelera (recuperar borrados) y versionado (recuperar sobrescrituras)
az storage account blob-service-properties update -n $CUENTA -g $RG \
  --enable-delete-retention true --delete-retention-days 30 \
  --enable-container-delete-retention true --container-delete-retention-days 30 \
  --enable-versioning true
# Replicación geográfica (cámbiela con: az storage account update --sku Standard_RAGRS)
```
- Use **Managed Identity** del App Service/Container con el rol `Storage Blob Data Contributor` (la API firma las URLs con una *user delegation key*; no hay claves en la configuración).
- Azure SQL: PITR viene activo; configure retención corta de 14–35 días y **LTR** semanal/mensual/anual según la política de la sección 3.
- Para un laboratorio con requisito legal de inmutabilidad, evalúe una política de inmutabilidad (WORM) en el contenedor.

## 3. Retención
- Cada documento nace con `RetentionUntil` = fecha de carga + años del tipo (`kinds.js`, configurable con `DOC_RETENTION_YEARS`). Valores por defecto: 10 años (resultados, historias, imágenes diagnósticas, informes) y 5 (fotos, adjuntos).
- **Estos años son un supuesto técnico, no asesoría legal.** Confirme con su asesor la norma aplicable (historia clínica veterinaria, resultados de laboratorio, datos personales) antes de producción.
- Borrar desde el portal es **lógico** (`DeletedAt`): el administrador lo puede restaurar. Los objetos solo se eliminan de forma definitiva cuando está borrado **y** `RetentionUntil` ya venció (`purgeExpired`, cada 6 h). La papelera de Azure da 30 días más de margen.
- Política de ciclo de vida (ahorro de costos): mover a nivel *Cool* los originales con más de 90 días, sin borrar:
```json
{"rules":[{"name":"originales-a-cool","enabled":true,"type":"Lifecycle","definition":{
 "filters":{"blobTypes":["blockBlob"]},
 "actions":{"baseBlob":{"tierToCool":{"daysAfterModificationGreaterThan":90}}}}}]}
```
  (Una política que **borre** por antigüedad debe respetar `RetentionUntil`; por eso el borrado lo hace la aplicación, no Azure.)

## 4. Procedimientos de recuperación
Antes de cualquier recuperación: pare la API y el *worker* o póngalos en modo mantenimiento; anote la hora del incidente.

### 4.1 Un documento borrado por error
- Desde el portal (rol administrador): `POST /api/documents/{id}/restore`. Vuelve a verse al instante.

### 4.2 Un objeto desapareció o se alteró en el almacenamiento
1. Ejecute `npm run reconciliar` → lista **FALTANTES** (la BD apunta a un objeto inexistente) y **HUÉRFANOS**.
2. Para cada faltante: portal de Azure › contenedor › *Show deleted blobs* › *Undelete*; si fue sobrescrito, restaure la **versión anterior** (*Versions* › *Promote*).
3. Si pasaron más de 30 días: restaure desde la réplica geográfica o desde el respaldo de la cuenta; vuelva a ejecutar `reconciliar` hasta que `faltantes` sea 0.

### 4.3 Faltan miniaturas o versiones optimizadas
Vuelva a encolar el documento: `INSERT INTO DocumentJobs (DocumentId, TenantId) VALUES (...)` y poner el documento en `Status='processing'`. El *worker* regenera las variantes desde el original (que no cambia).

### 4.4 Se restauró la base de datos a un punto anterior (PITR)
- Los documentos subidos **después** de ese punto quedan como **HUÉRFANOS** (objeto sin registro). `reconciliar` los lista; no se borran solos. Los metadatos se pueden reconstruir con el `documentId` y el `tenantId` de la clave, y el `sha256` recalculando el archivo; si no, se conservan en una carpeta de cuarentena para revisión manual.
- Los documentos borrados después de ese punto reaparecen: revise la auditoría exportada antes de restaurar.

### 4.5 Pérdida total de la región
Conmutar la cuenta de almacenamiento a la réplica (*failover* de cuenta RA-GRS) y restaurar Azure SQL por *geo-restore*. Ejecutar `reconciliar` al final. **Haga un simulacro al menos una vez al año** y anote cuánto tardó.

## 5. Auditoría
`DocumentAudit` registra: subida, duplicado, listado, vista, descarga, borrado, restauración, purga, rechazo por antivirus y fallos de procesamiento, con usuario, rol, IP y hora. Limite el permiso de la cuenta de la aplicación a `INSERT`/`SELECT` en esa tabla. Las URLs firmadas se emiten **después** de validar el permiso y registrar el acceso; la vigencia (por defecto 120 s) es la ventana en la que un enlace copiado sigue funcionando.

## 6. Lista de verificación para producción
- [ ] `NODE_ENV=production` (el arranque falla sin SQL, sin Azure o sin antivirus).
- [ ] ClamAV activo y con firmas actualizadas (`freshclam`).
- [ ] Contenedor privado, HTTPS, soft delete y versionado activos.
- [ ] Probar `sql/001_documentos.sql` y `SqlRepository` contra una instancia real (aquí solo se probó con el repositorio en memoria).
- [ ] Limitar de tasa (WAF / API Management) los endpoints de carga y de URL.
- [ ] Reemplazar el JWT interno por Microsoft Entra ID o el IdP de la plataforma.
- [ ] Simulacro de recuperación realizado.
