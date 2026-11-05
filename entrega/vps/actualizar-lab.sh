#!/usr/bin/env bash
# Uso:  bash actualizar-lab.sh agrolab   (copia la versión nueva de la app sin tocar nada más)
set -euo pipefail
source "$(dirname "$0")/comun.sh"
LAB="${1:?falta el nombre del laboratorio}"; validar_lab "$LAB"
APP="$(cd "$(dirname "$0")/.." && pwd)/public"
[ -d "$LABS_DIR/$LAB" ] || { echo "No existe el laboratorio '$LAB' (revise el nombre; existentes: $(ls "$LABS_DIR" 2>/dev/null | tr '\n' ' '))"; exit 1; }
cp -r "$APP"/. "$LABS_DIR/$LAB"/ && echo "Actualizado $LAB"
