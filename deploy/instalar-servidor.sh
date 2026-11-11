#!/usr/bin/env bash
# Instala AsisVet (portal veterinario + laboratorio) en Ubuntu 24.04 limpio. Ejecutar como root.
#   bash instalar-servidor.sh ip                      -> prueba por la IP del servidor (HTTP, sin candado)
#   bash instalar-servidor.sh app.midominio.com       -> con HTTPS automático (el DNS tipo A ya debe apuntar a este servidor)
#   Agregue  --sin-antivirus  si el servidor tiene poca RAM (solo para pruebas; entonces solo se detecta el archivo de prueba EICAR).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Ejecute como root"; exit 1; }
MODO="${1:?Indique 'ip' o su dominio, ej: app.midominio.com}"; AV=1; [ "${2:-}" = "--sin-antivirus" ] && AV=0
ORIGEN="$(cd "$(dirname "$0")/.." && pwd)"; APP=/opt/asisvet; DATOS=/var/lib/asisvet; CONF=/etc/asisvet
[ -d "$ORIGEN/server/src" ] || { echo "No encuentro $ORIGEN/server. Ejecute desde la carpeta descomprimida (deploy/)."; exit 1; }

echo "== 1/7 Paquetes base"; export DEBIAN_FRONTEND=noninteractive
apt-get update -y; apt-get install -y curl ca-certificates gnupg ufw unzip debian-keyring debian-archive-keyring apt-transport-https
echo "== 2/7 Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; apt-get install -y nodejs; fi
echo "== 3/7 Caddy (HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y; apt-get install -y caddy
fi
if [ "$AV" = 1 ]; then
  echo "== 4/7 Antivirus ClamAV (puede tardar unos minutos)"
  apt-get install -y clamav clamav-daemon
  systemctl stop clamav-freshclam || true; freshclam || echo "(freshclam: se reintentará solo)"; systemctl start clamav-freshclam || true
  grep -q '^TCPSocket' /etc/clamav/clamd.conf || printf 'TCPSocket 3310\nTCPAddr 127.0.0.1\n' >> /etc/clamav/clamd.conf
  systemctl enable --now clamav-daemon; systemctl restart clamav-daemon
  for i in $(seq 1 60); do (echo PING > /dev/tcp/127.0.0.1/3310) 2>/dev/null && break; sleep 3; done
  (echo PING > /dev/tcp/127.0.0.1/3310) 2>/dev/null && echo "ClamAV activo" || echo "AVISO: ClamAV aún no responde (carga firmas). Revise con: systemctl status clamav-daemon"
else echo "== 4/7 Antivirus omitido (--sin-antivirus)"; fi

echo "== 5/7 Aplicación"
id asisvet >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin asisvet
mkdir -p "$APP" "$DATOS" "$CONF" /var/backups/asisvet
rm -rf "$APP/src" "$APP/public" "$APP/scripts"; cp -r "$ORIGEN/server/"{src,public,scripts,package.json,package-lock.json} "$APP"/
( cd "$APP" && npm ci --omit=dev )
chown -R root:root "$APP"; chown -R asisvet:asisvet "$DATOS"; chmod 700 "$DATOS"
if [ ! -f "$CONF/env" ]; then
  if [ "$MODO" = ip ]; then IP="$(curl -4 -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"; URL="http://$IP"; else URL="https://$MODO"; fi
  { echo "NODE_ENV=production"; echo "HOST=127.0.0.1"; echo "PORT=3000"; echo "PUBLIC_BASE_URL=$URL"
    echo "AUTH_JWT_SECRET=$(openssl rand -hex 32)"; echo "ADMIN_KEY=$(openssl rand -hex 16)"
    echo "STORAGE_PROVIDER=local"; echo "ALLOW_LOCAL_STORAGE_IN_PROD=1"; echo "LOCAL_STORAGE_ROOT=$DATOS/blobs"; echo "DATA_FILE=$DATOS/datos.json"
    if [ "$AV" = 1 ]; then echo "CLAMD_HOST=127.0.0.1"; echo "CLAMD_PORT=3310"; else echo "ALLOW_NO_AV=1"; fi; } > "$CONF/env"
  chown root:asisvet "$CONF/env"; chmod 640 "$CONF/env"
else echo "(se conserva la configuración existente en $CONF/env)"; fi

echo "== 6/7 Servicio y respaldos"
cat > /etc/systemd/system/asisvet.service <<'U'
[Unit]
Description=AsisVet portal veterinario y laboratorio
After=network.target
[Service]
User=asisvet
WorkingDirectory=/opt/asisvet
EnvironmentFile=/etc/asisvet/env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/asisvet
[Install]
WantedBy=multi-user.target
U
install -m 755 "$ORIGEN/deploy/respaldo.sh" /usr/local/bin/asisvet-respaldo
echo "30 2 * * * root /usr/local/bin/asisvet-respaldo >> /var/log/asisvet-respaldo.log 2>&1" > /etc/cron.d/asisvet-respaldo
systemctl daemon-reload; systemctl enable --now asisvet; systemctl restart asisvet

echo "== 7/7 HTTPS y cortafuegos"
if [ "$MODO" = ip ]; then SITE=":80"; else SITE="$MODO"; fi
cat > /etc/caddy/Caddyfile <<C
$SITE {
	encode gzip
	request_body {
		max_size 120MB
	}
	header {
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		X-Robots-Tag "noindex, nofollow"
	}
	reverse_proxy 127.0.0.1:3000
}
C
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; systemctl enable --now caddy; systemctl reload caddy
ufw allow OpenSSH; ufw allow 80/tcp; ufw allow 443/tcp; ufw --force enable
sleep 3; curl -fsS http://127.0.0.1:3000/healthz && echo
set -a; . "$CONF/env"; set +a
echo; echo "=============================================="; echo " LISTO:  $PUBLIC_BASE_URL"
echo " Clave del dueño (guárdela, no la comparta): $ADMIN_KEY"
echo " Crear los laboratorios de ejemplo:   cd $APP && set -a && . $CONF/env && set +a && node scripts/admin.js demo"
echo "=============================================="
