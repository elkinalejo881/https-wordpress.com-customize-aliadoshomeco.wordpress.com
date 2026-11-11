# AsisVet · Piloto: portal del veterinario + panel del laboratorio

**Qué hace (probado de punta a punta en navegador, celular + computador):** el veterinario se registra → elige un laboratorio y **se carga todo su portafolio** → arma **una solicitud con varios pacientes** (exámenes por paciente, urgencia, observaciones, entrega en laboratorio o recogida) → el laboratorio la ve al instante en **Recepción**, **recibe cada muestra** (N.º de muestra, rotulado, cadena de frío) o la **rechaza con motivo**, sube el **resultado en PDF por paciente** y lo **entrega** → el veterinario lo ve y lo descarga en **su** portal. Además: orden de servicio en **PDF** automática, exportes **CSV y Excel** (una fila por paciente), antivirus sobre cada archivo, respaldos diarios.

**Diseño:** usa el mismo sistema visual de la app del laboratorio (IBM Plex, 5 paletas, modo claro/oscuro/automático) y se adapta a celular, tableta y computador (revisado en 5 tamaños, 90 combinaciones). Se **instala como aplicación** (PWA) desde el navegador: Android/Chrome «Instalar»; iPhone/Safari «Compartir → Agregar a inicio». **Instalar requiere HTTPS (dominio con candado)**; por la IP solo funciona como página web.

## 1. Servidor (15 min)
Recomendado: **Hetzner Cloud**, Ashburn (EE. UU.), 2 vCPU / **4 GB RAM**, Ubuntu 24.04, con copias de seguridad activadas. Anote la IP.
(Si tiene solo 2 GB use `--sin-antivirus` en el paso 3, solo para la prueba.)

## 2. Subir el paquete
Abra la **Console** del proveedor (o Termius) y suba `AsisVet-Piloto-VPS.zip` a `/root/` (desde su computador: `scp AsisVet-Piloto-VPS.zip root@SU_IP:/root/`).

## 3. Instalar (copiar y pegar)
```
cd /root && apt-get install -y unzip && unzip -o AsisVet-Piloto-VPS.zip -d asisvet && cd asisvet
bash deploy/instalar-servidor.sh ip
```
- Con **dominio** (recomendado: candado HTTPS): cree antes el registro DNS tipo **A** (ej. `app` → IP del servidor, nube en gris en Cloudflare) y use `bash deploy/instalar-servidor.sh app.midominio.com`.
- Al terminar imprime la **dirección** y la **clave del dueño**. Guárdela; no me la envíe por chat.

## 4. Crear los laboratorios de la prueba
```
cd /opt/asisvet && set -a && . /etc/asisvet/env && set +a
node scripts/admin.js demo                      # crea Agrolab y VetCaribe de ejemplo
node scripts/admin.js crear-lab millab "Mi Laboratorio" correo@lab.co "Clave-Segura-1" "Medellín"   # uno real
node scripts/admin.js listar                    # ver códigos de invitación
```
Cada laboratorio entra en la **misma dirección** con su correo y contraseña. El código de invitación se lo da a sus veterinarios (o lo ven en la pestaña «Veterinarios»).

## 5. Verificar que todo esté activo
```
bash /root/asisvet/deploy/verificar.sh
```
Debe mostrar todo `[OK]`. Si algo falla: `journalctl -u asisvet -n 50`.

## 6. Guion de la prueba de mañana (5 min)
1. **Veterinario (celular):** abre la dirección → «Soy veterinario: crear cuenta» → datos + laboratorio + código → entra a «Mis envíos».
2. **Nueva solicitud:** ya aparece el portafolio del laboratorio; en cada paciente busca y marca exámenes (ve el total); «Agregar otro paciente» / «Duplicar»; elige entrega (laboratorio o recogida) → «Enviar».
3. **Laboratorio (computador):** inicia sesión → **Inicio** muestra «muestras por recibir» → **Recepción**: la solicitud aparece sola (cada 10 s, con aviso) → **Recibir** cada muestra (o **Rechazar** con motivo) → **Subir resultado (PDF)** → **Entregar al veterinario**.
4. **Veterinario:** su solicitud pasa a «Finalizada», ve «Resultado listo» con el PDF (**Ver** / descargar) y el motivo si se rechazó una muestra; «Mis pacientes» guarda el historial.
5. Muestre también: **Exportar CSV / Excel**, la **orden de servicio PDF**, el **Portafolio** editable, **Remitentes** (código de invitación y aprobación) y **Apariencia** (paletas/modo oscuro) en el botón con el nombre de usuario.

## 7. Operación
| Tarea | Comando |
|---|---|
| Estado | `bash deploy/verificar.sh` |
| Respaldo manual | `asisvet-respaldo` (automático a las 2:30 a. m., conserva 14 días, en `/var/backups/asisvet`) |
| Actualizar versión | descomprimir la nueva y `bash deploy/actualizar.sh` (no toca datos) |
| Ver errores | `journalctl -u asisvet -f` |
| Restaurar | `systemctl stop asisvet && tar -xzf /var/backups/asisvet/ARCHIVO.tgz -C /var/lib && systemctl start asisvet` |

## 8. Lo que es piloto y NO debe prometer todavía
- **Los datos están en un archivo en el servidor, no en SQL Server.** Es adecuado para la prueba y pocos laboratorios. Para vender a muchos hay que pasar usuarios, laboratorios, portafolio y solicitudes a SQL Server (el esquema de documentos ya existe; el del resto falta). Es el siguiente paso.
- **Un solo servidor, sin alta disponibilidad.** Si cae, el servicio se detiene hasta reiniciarlo. Mantenga las copias del proveedor activas.
- Este portal **no reemplaza** la app de laboratorio actual (captura de hemogramas/resultados, informes con firma, cartera y contabilidad): la complementa para la relación con veterinarios. «Mis pagos», «Mi equipo» y la anemia equina del portal de esa app **no están** en este portal todavía. El resultado se entrega como PDF que el laboratorio sube (no se genera automáticamente desde su app).
- Faltan para venta masiva: recuperación de contraseña por correo, avisos por correo/WhatsApp, panel de dueño con pagos y suspensión por laboratorio, facturación electrónica DIAN, términos y política de datos (Ley 1581).
- Los precios del portafolio base son **ejemplos**; cada laboratorio los ajusta en «Portafolio».
- Probado en un entorno de pruebas y con navegador automatizado; **la instalación en el VPS no se ha ejecutado en un servidor real**. Haga la prueba hoy, no mañana a primera hora.
