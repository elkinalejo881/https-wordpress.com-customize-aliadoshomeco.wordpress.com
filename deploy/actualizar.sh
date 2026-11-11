#!/usr/bin/env bash
# Instala una versión nueva sin tocar datos ni configuración:  bash deploy/actualizar.sh   (desde la carpeta nueva descomprimida)
set -euo pipefail; ORIGEN="$(cd "$(dirname "$0")/.." && pwd)"; APP=/opt/asisvet
/usr/local/bin/asisvet-respaldo
rm -rf "$APP/src" "$APP/public" "$APP/scripts"; cp -r "$ORIGEN/server/"{src,public,scripts,package.json,package-lock.json} "$APP"/
( cd "$APP" && npm ci --omit=dev ); install -m 755 "$ORIGEN/deploy/respaldo.sh" /usr/local/bin/asisvet-respaldo
systemctl restart asisvet; sleep 2; curl -fsS http://127.0.0.1:3000/healthz && echo " actualizado"
