# Funciones comunes (se carga con "source"). Las rutas se pueden cambiar con variables de entorno (útil para pruebas).
CADDY_LABS="${CADDY_LABS:-/etc/caddy/labs}"
LABS_DIR="${LABS_DIR:-/srv/labs}"
RESPALDOS="${RESPALDOS:-/srv/respaldos}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"

validar_lab()  { [[ "$1" =~ ^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$ ]] || { echo "Nombre de laboratorio inválido: '$1' (solo minúsculas, números y guiones, ej: agrolab)"; exit 1; }; }
validar_dom()  { [[ "$1" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || { echo "Dominio inválido: '$1' (ej: asisvet.com)"; exit 1; }; }
# recargar_caddy <archivo> <copia_de_seguridad_o_vacío>: valida; si falla, deja todo como estaba y NO recarga.
recargar_caddy() {
  local f="$1" bak="${2:-}"
  if caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy
  else
    echo "ERROR: Caddy rechazó la configuración; se restaura lo anterior y no se recargó."
    if [ -n "$bak" ] && [ -f "$bak" ]; then cp "$bak" "$f"; else rm -f "$f"; fi
    exit 1
  fi
}
