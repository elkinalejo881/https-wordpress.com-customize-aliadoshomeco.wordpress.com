#!/usr/bin/env bash
# Copia diaria de datos + archivos. Conserva 14 días. Complemente SIEMPRE con las copias (snapshots) del proveedor del VPS.
set -euo pipefail
D=/var/backups/asisvet; mkdir -p "$D"; F="$D/asisvet-$(date +%Y%m%d-%H%M).tgz"
tar -czf "$F" -C /var/lib asisvet && chmod 600 "$F" && echo "$(date -Is) respaldo $F ($(du -h "$F" | cut -f1))"
ls -1t "$D"/asisvet-*.tgz | tail -n +15 | xargs -r rm -f
