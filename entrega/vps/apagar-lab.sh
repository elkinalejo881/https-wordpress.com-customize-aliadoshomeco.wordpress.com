#!/usr/bin/env bash
# Uso:  bash apagar-lab.sh agrolab asisvet.com   -> el laboratorio ve "Servicio suspendido por pago pendiente".
# No borra nada: los datos del laboratorio siguen en su navegador y se recuperan al prender.
set -euo pipefail
source "$(dirname "$0")/comun.sh"
LAB="${1:?nombre del laboratorio}"; DOM="${2:?dominio}"; validar_lab "$LAB"; validar_dom "$DOM"
F="$CADDY_LABS/$LAB.caddy"; BAK="$RESPALDOS/$LAB.caddy.activo"
[ -f "$F" ] || { echo "No existe $F"; exit 1; }
# Si ya está apagado NO volver a guardar la copia (sobrescribiría la configuración buena con la página de suspensión).
[ ! -f "$BAK" ] || { echo "El laboratorio '$LAB' ya está apagado."; exit 0; }
mkdir -p "$RESPALDOS" && cp "$F" "$BAK"
cat > "$F" <<C
$LAB.$DOM {
	header Content-Type "text/html; charset=utf-8"
	respond "<meta name=viewport content='width=device-width'><body style='font-family:sans-serif;max-width:480px;margin:15vh auto;padding:16px;text-align:center'><h2>Servicio suspendido</h2><p>El acceso a AsisVet Laboratorio está suspendido por pago pendiente. Sus datos están a salvo en su equipo. Escriba a soporte para reactivarlo.</p></body>" 503
}
C
( recargar_caddy "$F" "$BAK" ) || { rm -f "$BAK"; exit 1; }
echo "APAGADO $LAB"
