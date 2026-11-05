#!/usr/bin/env bash
# Uso:  bash prender-lab.sh agrolab   -> vuelve a activar el laboratorio
set -euo pipefail
source "$(dirname "$0")/comun.sh"
LAB="${1:?nombre del laboratorio}"; validar_lab "$LAB"
BAK="$RESPALDOS/$LAB.caddy.activo"; F="$CADDY_LABS/$LAB.caddy"
[ -f "$BAK" ] || { echo "El laboratorio '$LAB' no está apagado (no hay copia guardada)."; exit 1; }
cp "$F" "$F.suspendido"
cp "$BAK" "$F"
( recargar_caddy "$F" "$F.suspendido" ) || { rm -f "$F.suspendido"; exit 1; }
rm -f "$BAK" "$F.suspendido"; echo "ENCENDIDO $LAB"
