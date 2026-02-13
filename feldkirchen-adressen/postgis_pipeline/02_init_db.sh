#!/usr/bin/env bash
# 02_init_db.sh
# Erstellt DB, User, Extensions und Schema (idempotent)
set -euo pipefail

echo "=== [02] Datenbank initialisieren ==="

EINFO_DB_NAME="${EINFO_DB_NAME:-einfo_osm}"
EINFO_DB_USER="${EINFO_DB_USER:-einfo}"

if [ -z "${EINFO_DB_PASS:-}" ]; then
  echo "FEHLER: EINFO_DB_PASS muss gesetzt sein."
  exit 1
fi

# User anlegen (idempotent)
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${EINFO_DB_USER}'" \
  | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE ${EINFO_DB_USER} WITH LOGIN PASSWORD '${EINFO_DB_PASS}';"

echo "  User '${EINFO_DB_USER}' vorhanden."

# DB anlegen (idempotent)
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${EINFO_DB_NAME}'" \
  | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE ${EINFO_DB_NAME} OWNER ${EINFO_DB_USER};"

echo "  Datenbank '${EINFO_DB_NAME}' vorhanden."

# Extensions aktivieren
sudo -u postgres psql -d "${EINFO_DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS postgis;"
sudo -u postgres psql -d "${EINFO_DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS hstore;"

echo "  Extensions postgis + hstore aktiviert."

# Schema erstellen
sudo -u postgres psql -d "${EINFO_DB_NAME}" -c "CREATE SCHEMA IF NOT EXISTS einfo AUTHORIZATION ${EINFO_DB_USER};"

echo "  Schema 'einfo' erstellt."

# Berechtigungen sicherstellen
sudo -u postgres psql -d "${EINFO_DB_NAME}" -c "
  GRANT USAGE ON SCHEMA public TO ${EINFO_DB_USER};
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${EINFO_DB_USER};
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${EINFO_DB_USER};
  GRANT ALL ON SCHEMA einfo TO ${EINFO_DB_USER};
"

echo ""
echo "[02] Datenbank '${EINFO_DB_NAME}' bereit."
