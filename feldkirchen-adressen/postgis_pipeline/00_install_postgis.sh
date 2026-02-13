#!/usr/bin/env bash
# 00_install_postgis.sh
# Installiert PostgreSQL + PostGIS + hstore auf Ubuntu 22/24 (nativ, ohne Docker)
set -euo pipefail

echo "=== [00] PostgreSQL + PostGIS installieren ==="

sudo apt-get update -qq

sudo apt-get install -y \
  postgresql \
  postgresql-contrib \
  postgis \
  postgresql-postgis

echo ""
echo "--- Versionen ---"
psql --version
sudo -u postgres psql -c "SELECT version();" 2>/dev/null || echo "(PostgreSQL-Dienst noch nicht gestartet)"

# Sicherstellen, dass der Dienst läuft
sudo systemctl enable postgresql
sudo systemctl start postgresql

echo ""
echo "[00] PostgreSQL + PostGIS installiert."
