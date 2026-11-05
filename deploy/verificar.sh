#!/usr/bin/env bash
# Revisa que todo esté activo:  bash deploy/verificar.sh
. /etc/asisvet/env 2>/dev/null
ok(){ printf '  [OK]  %s\n' "$1"; }; mal(){ printf '  [FALLA] %s\n' "$1"; }
systemctl is-active --quiet asisvet && ok "servicio asisvet activo" || mal "servicio asisvet detenido (journalctl -u asisvet -n 50)"
systemctl is-active --quiet caddy && ok "caddy (HTTPS) activo" || mal "caddy detenido"
curl -fsS http://127.0.0.1:3000/healthz >/dev/null && ok "API responde" || mal "API no responde"
curl -fsS "$PUBLIC_BASE_URL/api/labs" -o /tmp/labs.json && ok "portal público responde en $PUBLIC_BASE_URL ($(grep -o '"id"' /tmp/labs.json | wc -l) laboratorios)" || mal "no responde $PUBLIC_BASE_URL desde afuera (DNS/puertos)"
if [ -n "${CLAMD_HOST:-}" ]; then (echo PING > /dev/tcp/127.0.0.1/3310) 2>/dev/null && ok "antivirus ClamAV responde" || mal "antivirus no responde (los archivos quedarán 'procesando')"; else echo "  [AVISO] sin antivirus"; fi
ls /var/backups/asisvet/*.tgz >/dev/null 2>&1 && ok "hay respaldos: $(ls -1t /var/backups/asisvet/*.tgz | head -1)" || echo "  [AVISO] aún no hay respaldos (el primero es a las 2:30 a. m.; o ejecute: asisvet-respaldo)"
df -h /var/lib/asisvet | tail -1 | awk '{print "  [INFO] disco usado: "$5" de "$2}'
