#!/usr/bin/env bash
# Uso:  bash agregar-lab.sh agrolab asisvet.com
# Crea https://agrolab.asisvet.com con su propia carpeta. Repetir por cada laboratorio.
# Requiere que el registro DNS (tipo A) agrolab -> IP del servidor ya exista.
set -euo pipefail
source "$(dirname "$0")/comun.sh"
LAB="${1:?falta el nombre corto del laboratorio, ej: agrolab}"; DOM="${2:?falta el dominio, ej: asisvet.com}"
validar_lab "$LAB"; validar_dom "$DOM"
APP="$(cd "$(dirname "$0")/.." && pwd)/public"
DEST="$LABS_DIR/$LAB"; F="$CADDY_LABS/$LAB.caddy"
# No pisar un laboratorio existente (si estaba suspendido, lo reactivaría sin querer).
[ ! -e "$F" ] && [ ! -e "$RESPALDOS/$LAB.caddy.activo" ] || { echo "El laboratorio '$LAB' ya existe. Para actualizar use actualizar-lab.sh; para reactivar, prender-lab.sh."; exit 1; }
mkdir -p "$DEST" "$CADDY_LABS" && cp -r "$APP"/. "$DEST"/
cat > "$F" <<C
$LAB.$DOM {
	root * $DEST
	encode gzip
	file_server
	header {
		X-Content-Type-Options nosniff
		X-Frame-Options SAMEORIGIN
		Referrer-Policy same-origin
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		X-Robots-Tag "noindex, nofollow"
	}
	@nocache path /index.html /sw.js /manifest.json /
	header @nocache Cache-Control "no-cache"
	@sw path /sw.js
	header @sw Service-Worker-Allowed /
	@mf path /manifest.json
	header @mf Content-Type application/manifest+json
}
C
recargar_caddy "$F" ""
echo "Listo: https://$LAB.$DOM"
