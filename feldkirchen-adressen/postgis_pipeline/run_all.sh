#!/usr/bin/env bash
# run_all.sh
# One-Command Runner: Installiert PostGIS, importiert PBF, erstellt Views
#
# Verwendung:
#   EINFO_DB_PASS=meinpasswort ./run_all.sh --pbf /pfad/zu/karnten-latest.osm.pbf
#
# Optionen:
#   --pbf <path>       Pfad zur OSM PBF-Datei (erforderlich)
#   --cache-mb <MB>    osm2pgsql Cache in MB (default: 4000)
#   --reimport         Bestehende Tabellen überschreiben
#   --skip-install     Installation überspringen (PostGIS + Tools bereits vorhanden)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Parameter parsen ---
PBF=""
CACHE_MB="${CACHE_MB:-4000}"
REIMPORT=""
SKIP_INSTALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pbf)           PBF="$2"; shift 2;;
    --cache-mb)      CACHE_MB="$2"; shift 2;;
    --reimport)      REIMPORT="--reimport"; shift;;
    --skip-install)  SKIP_INSTALL=true; shift;;
    *)               echo "Unbekannter Parameter: $1"; exit 1;;
  esac
done

if [ -z "$PBF" ]; then
  echo "FEHLER: --pbf <path> ist erforderlich."
  echo "Beispiel: EINFO_DB_PASS=secret ./run_all.sh --pbf /data/karnten-latest.osm.pbf"
  exit 1
fi

if [ ! -f "$PBF" ]; then
  echo "FEHLER: PBF-Datei nicht gefunden: $PBF"
  exit 1
fi

if [ -z "${EINFO_DB_PASS:-}" ]; then
  echo "FEHLER: EINFO_DB_PASS muss als Umgebungsvariable gesetzt sein."
  exit 1
fi

export EINFO_DB_NAME="${EINFO_DB_NAME:-einfo_osm}"
export EINFO_DB_USER="${EINFO_DB_USER:-einfo}"
export EINFO_DB_PASS
export EINFO_DB_HOST="${EINFO_DB_HOST:-localhost}"
export EINFO_DB_PORT="${EINFO_DB_PORT:-5432}"
export CACHE_MB

echo "============================================================"
echo "  EINFO PostGIS Pipeline"
echo "============================================================"
echo "  PBF:    $PBF"
echo "  DB:     $EINFO_DB_NAME"
echo "  User:   $EINFO_DB_USER"
echo "  Host:   $EINFO_DB_HOST:$EINFO_DB_PORT"
echo "  Cache:  ${CACHE_MB} MB"
echo "============================================================"
echo ""

# Schritt 0+1: Installation (optional überspringen)
if [ "$SKIP_INSTALL" = false ]; then
  bash "${SCRIPT_DIR}/00_install_postgis.sh"
  echo ""
  bash "${SCRIPT_DIR}/01_install_tools.sh"
  echo ""
else
  echo "[SKIP] Installation übersprungen (--skip-install)"
  echo ""
fi

# Schritt 2: DB init
bash "${SCRIPT_DIR}/02_init_db.sh"
echo ""

# Schritt 3: osm2pgsql Import
bash "${SCRIPT_DIR}/03_import_osm2pgsql.sh" --pbf "$PBF" --cache-mb "$CACHE_MB" $REIMPORT
echo ""

# Schritt 4: Gemeinden extrahieren
bash "${SCRIPT_DIR}/04_extract_municipalities_from_pbf.sh" --pbf "$PBF"
echo ""

# Schritt 5: Gemeinden laden
bash "${SCRIPT_DIR}/05_load_municipalities.sh"
echo ""

# Schritt 6: Views erstellen
echo "=== [06] SQL Views erstellen ==="
export PGPASSWORD="$EINFO_DB_PASS"
psql -h "$EINFO_DB_HOST" -p "$EINFO_DB_PORT" \
  -U "$EINFO_DB_USER" -d "$EINFO_DB_NAME" \
  -f "${SCRIPT_DIR}/06_create_views.sql"
echo "[06] Views erstellt."
echo ""

# Schritt 7: Indices erstellen
echo "=== [07] SQL Indices erstellen ==="
psql -h "$EINFO_DB_HOST" -p "$EINFO_DB_PORT" \
  -U "$EINFO_DB_USER" -d "$EINFO_DB_NAME" \
  -f "${SCRIPT_DIR}/07_create_indices.sql"
echo "[07] Indices erstellt."
echo ""

# Schritt 8: Sanity Checks
echo "=== [08] Sanity Checks ==="
echo ""

for VIEW in einfo.poi_src einfo.building_src einfo.provider_src einfo.addr_src; do
  COUNT=$(psql -h "$EINFO_DB_HOST" -p "$EINFO_DB_PORT" \
    -U "$EINFO_DB_USER" -d "$EINFO_DB_NAME" \
    -tAc "SELECT count(*) FROM ${VIEW};" 2>/dev/null || echo "FEHLER")
  printf "  %-30s %s\n" "$VIEW" "$COUNT"
done

MUNI_COUNT=$(psql -h "$EINFO_DB_HOST" -p "$EINFO_DB_PORT" \
  -U "$EINFO_DB_USER" -d "$EINFO_DB_NAME" \
  -tAc "SELECT count(*) FROM einfo.municipalities;" 2>/dev/null || echo "FEHLER")
printf "  %-30s %s\n" "einfo.municipalities" "$MUNI_COUNT"

unset PGPASSWORD

echo ""
echo "============================================================"
echo "  Pipeline abgeschlossen!"
echo "============================================================"
echo ""
echo "  EINFO Chatbot starten mit:"
echo ""
echo "    export EINFO_DB_NAME=${EINFO_DB_NAME}"
echo "    export EINFO_DB_USER=${EINFO_DB_USER}"
echo "    export EINFO_DB_PASS=<passwort>"
echo "    export EINFO_DB_HOST=${EINFO_DB_HOST}"
echo "    export EINFO_DB_PORT=${EINFO_DB_PORT}"
echo "    cd chatbot && npm start"
echo ""
echo "  Oder via Connection-URL:"
echo ""
echo "    export EINFO_PG_URL=postgresql://${EINFO_DB_USER}:<pass>@${EINFO_DB_HOST}:${EINFO_DB_PORT}/${EINFO_DB_NAME}"
echo "    cd chatbot && npm start"
echo ""
echo "  Healthcheck SQL:"
echo "    psql -d ${EINFO_DB_NAME} -c \"SELECT count(*) FROM einfo.poi_src;\""
echo ""
