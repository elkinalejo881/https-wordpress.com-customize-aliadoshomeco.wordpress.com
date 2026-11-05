# AsisVet · Guía para subir al servidor (VPS) y administrar laboratorios

Escrita para quien no es técnico. Marcado con **[HOY]** lo que ya funciona con este paquete y **[FASE 1]** lo que necesita el servidor con base de datos (todavía no construido).

---
## 1. Contratar el VPS (el computador alquilado en internet)

**Dónde:** Hetzner (hetzner.com/cloud), DigitalOcean o Vultr. Los tres sirven. Precio aproximado: 5 a 8 USD al mes (verifique el precio al contratar).

**Pasos (ejemplo genérico, es casi igual en los tres):**
1. Cree la cuenta con su correo y active la verificación en dos pasos.
2. Agregue un medio de pago (tarjeta de crédito/débito internacional o PayPal; Nequi no sirve aquí).
3. «Create server» / «Create droplet»:
   - Sistema: **Ubuntu 24.04**.
   - Tamaño: **2 GB de RAM**, 1 o 2 CPU, unos 40 GB de disco.
   - Ubicación: la más cercana a Colombia (Miami o Nueva York; si aparece Bogotá o São Paulo, mejor).
   - Acceso: elija **contraseña** (más fácil) o llave SSH.
   - Active **copias de seguridad / snapshots** (cuesta cerca del 20 % extra; vale la pena).
4. Al terminar le muestran una **dirección IP** (ejemplo 203.0.113.10). Guárdela.

**Entrar al servidor:** en el panel del proveedor hay un botón **Console** que abre una terminal en el navegador. No necesita instalar nada.

**Subir este paquete al servidor:** desde un computador, `scp AsisVet-Servidor.zip root@SU_IP:/root/`. Desde el celular, la app Termius permite subir archivos (SFTP) con la IP, el usuario `root` y su contraseña.

**Instalar (copiar y pegar en la consola):**
```
cd /root && unzip AsisVet-Servidor-*.zip -d asisvet && cd asisvet/vps
bash instalar.sh
```
Eso instala Caddy (da el candado HTTPS solo) y cierra puertos innecesarios.

> Si el zip trae un nombre distinto, ajuste el comando `unzip`. Dentro del zip hay dos carpetas: `public` (la app) y `vps` (los scripts); por eso la ruta es `asisvet/vps`.

---
## 2. Comprar el dominio

**Dónde:** Cloudflare Registrar (precio de costo, unos 10–11 USD al año el .com), Namecheap o Porkbun. Verifique que el nombre esté libre antes de decidir.

**Decisión pendiente:** la marca quedó como *AsisVet Laboratorio* (una sola «s», igual que el logo). Compre el dominio con esa escritura (asisvet.com u otro) antes de crear los laboratorios.

**Pasos:**
1. Busque el nombre, compre 1 año con renovación automática, active 2FA.
2. Si compró en Cloudflare, ya tiene el DNS ahí. Si compró en otro sitio, cree cuenta gratis en Cloudflare, agregue el dominio y pegue los dos «nameservers» que le da en el registrador.

---
## 3. Crear cada laboratorio  **[HOY]**

Cada laboratorio tiene su propio subdominio y su propia copia de la app.

1. En Cloudflare › DNS cree un registro: Tipo **A**, Nombre **agrolab**, Contenido **la IP del servidor**, nube en gris («solo DNS»).
2. En la consola del servidor:
   ```
   cd /root/asisvet/vps
   bash agregar-lab.sh agrolab SUDOMINIO.com
   ```
   A los pocos minutos abre `https://agrolab.SUDOMINIO.com` con candado.
3. Repita para el segundo laboratorio (`lab2`).
4. El laboratorio entra, crea su administrador, configura datos, logo, usuarios, módulos y precios, e instala la app en el celular/PC.
5. **Respaldo diario obligatorio:** hoy los datos viven en el navegador del equipo del laboratorio, no en el servidor.

**Nombres:** el nombre corto del laboratorio solo admite minúsculas, números y guiones (ej. `agrolab`). Si repite `agregar-lab.sh` con un laboratorio que ya existe, el script se niega (no pisa nada).

**Actualizar la app** (cuando yo le entregue una versión nueva): suba el zip nuevo y ejecute `bash actualizar-lab.sh agrolab`. No toca los datos.

---
## 4. Su panel de dueño

**[HOY]** No hay panel gráfico. Su «panel» es una hoja de cálculo con: laboratorio, subdominio, plan, fecha de pago, vence, estado. Más los comandos de la sección 6 para apagar y prender.

**[FASE 1]** Panel propio, solo para usted, con:
- Lista de laboratorios con estado (activo, por vencer, suspendido, prueba).
- Fecha de vencimiento, último pago, plan y módulos (AIE, etc.).
- Botones **Apagar / Prender**, **Extender prueba**, **Crear laboratorio**.
- Pagos recibidos y pendientes.
- Alertas en su celular.

Necesita servidor con base de datos (se hace con el dinero de los primeros clientes).

---
## 5. Cobro a los laboratorios y Nequi

**[HOY] manual:** usted les envía su número de Nequi (o su QR) con el valor del mes; ellos le mandan el comprobante; usted lo anota en su hoja.

**[FASE 1] automático:** una pasarela de pago. Wompi (Bancolombia) y ePayco aceptan Nequi entre sus medios (verifique en cada sitio, las condiciones cambian). Lo que se necesita:
- Cuenta de negocio en la pasarela: se pide RUT y cámara de comercio (puede ser a nombre de Atomik Store SAS u otra figura; consúltelo con su contador).
- Un Nequi personal **no** sirve como pasarela.
- Flujo: el sistema genera cada mes un enlace de pago y lo envía por WhatsApp → el laboratorio paga con Nequi → la pasarela avisa al servidor → el panel marca «pagado» y extiende la fecha. Si no paga, avisa y suspende.
- Los cobros recurrentes automáticos con Nequi tienen limitaciones; lo más seguro es el enlace mensual con recordatorio.

---
## 6. Apagar y prender  **[HOY]**

```
bash apagar-lab.sh agrolab SUDOMINIO.com    # suspende (si ya estaba apagado, avisa y no hace nada)
bash prender-lab.sh agrolab                 # reactiva
```
Si Caddy rechaza algún cambio, los scripts dejan todo como estaba y se lo dicen (los demás laboratorios no se afectan).

Al apagar, el laboratorio ve «Servicio suspendido por pago pendiente». No se borra nada; sus datos siguen en su equipo y vuelve todo al prender.

**Alertas [HOY]:** UptimeRobot (tiene plan gratis, verifique) o similar le avisa por correo si algún sitio se cae.

**Alertas [FASE 1]:** 5 días antes del vencimiento, aviso al laboratorio por WhatsApp; el día del vencimiento, otro; con 3 días de gracia, suspensión automática; a usted le llega un aviso cuando entra un pago, se suspende un laboratorio o se cae el servidor.

---
## 7. Veterinarios: cómo se registran

**Regla de negocio:** el veterinario usa el portal gratis; cada laboratorio aprueba a sus veterinarios.

**Flujo previsto [FASE 1]:**
1. El laboratorio entra a **Remitentes** y genera el código de invitación de esa veterinaria (formato XXXX-XXXX) o la aprueba directamente.
2. El veterinario abre el portal del laboratorio (por ejemplo `agrolab.SUDOMINIO.com`), elige «Soy veterinario» y se registra con su código. Si no tiene código, se registra igual y queda **pendiente**.
3. Recepción recibe la alerta «nuevo acceso», revisa y **aprueba** (y marca si está autorizada para anemia equina).
4. El veterinario entra desde cualquier celular o computador, envía solicitudes, y ve y descarga los resultados.

**Hoy [HOY]:** el registro funciona solo desde el mismo navegador del laboratorio. En otro celular el código no se reconoce, porque la lista de códigos vive en el equipo del laboratorio. Por eso, hasta la fase 1 los veterinarios se atienden por WhatsApp (el laboratorio carga la solicitud por ellos).

---
## 8. Qué queda para mañana

- [ ] Comprar el dominio con la escritura AsisVet.
- [ ] Contratar VPS Ubuntu 24.04, 2 GB, con copias de seguridad.
- [ ] Crear los registros A (agrolab, lab2) apuntando a la IP.
- [ ] Subir el zip, `instalar.sh`, `agregar-lab.sh` por laboratorio.
- [ ] Probar en celular: abrir, instalar la app, ver el icono nuevo.
- [ ] Pedir a cada laboratorio la información de la sección siguiente.

**Información que necesita de cada laboratorio:** nombre y NIT, dirección y teléfono, logo y firma del director, régimen de IVA, resolución DIAN del recibo (si la tiene), usuarios y cargos, portafolio y precios, número de WhatsApp de envíos.

## 9. Costos y utilidad (aproximado)
Servidor + dominio: unos 7 a 10 USD al mes en total para los dos laboratorios (unos COP 30.000 a 40.000, según la tasa). Ingreso: 2 × COP 150.000 = COP 300.000 al mes. Margen alto, y el servidor soporta muchos más laboratorios antes de subir de plan.

## 10. Lo que NO prometer todavía
Portal de veterinarios entre equipos, sincronización sin internet hacia la nube, avisos con la app cerrada, panel del dueño, cobro automático y factura electrónica DIAN válida. Todo eso es la fase 1.
