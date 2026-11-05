#!/usr/bin/env bash
# Uso (como root, en Ubuntu 24.04 limpio):  bash instalar.sh
# Instala Caddy (servidor web con HTTPS automático) y un cortafuegos básico.
set -euo pipefail
apt-get update
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gpg ufw unzip
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
mkdir -p /etc/caddy/labs /srv/labs /srv/respaldos
cat > /etc/caddy/Caddyfile <<'C'
import /etc/caddy/labs/*.caddy
C
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
systemctl enable --now caddy
echo "Listo. Ahora use agregar-lab.sh para cada laboratorio."
