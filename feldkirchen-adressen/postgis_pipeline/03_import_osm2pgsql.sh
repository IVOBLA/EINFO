#!/usr/bin/env bash
# 03_import_osm2pgsql.sh
# Importiert OSM PBF in PostGIS (osm2pgsql classic mode, slim + hstore)
set -euo pipefail

echo "=== [03] osm2pgsql Import ==="

# --- Parameter parsen ---
PBF=""
CACHE_MB="${CACHE_MB:-4000}"
REIMPORT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pbf)       PBF="$2"; shift 2;;
    --cache-mb)  CACHE_MB="$2"; shift 2;;
    --reimport)  REIMPORT=true; shift;;
    *)           echo "Unbekannter Parameter: $1"; exit 1;;
  esac
done

if [ -z "$PBF" ] || [ ! -f "$PBF" ]; then
  echo "FEHLER: --pbf /pfad/zu/karnten-latest.osm.pbf erforderlich (Datei muss existieren)"
  exit 1
fi

EINFO_DB_NAME="${EINFO_DB_NAME:-einfo_osm}"
EINFO_DB_USER="${EINFO_DB_USER:-einfo}"

if [ -z "${EINFO_DB_PASS:-}" ]; then
  echo "FEHLER: EINFO_DB_PASS muss gesetzt sein."
  exit 1
fi

export PGPASSWORD="$EINFO_DB_PASS"

# Prüfe ob bereits importiert
TABLE_EXISTS=$(psql -h "${EINFO_DB_HOST:-localhost}" -p "${EINFO_DB_PORT:-5432}" \
  -U "$EINFO_DB_USER" -d "$EINFO_DB_NAME" -tAc \
  "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='planet_osm_point');" 2>/dev/null || echo "f")

if [ "$TABLE_EXISTS" = "t" ] && [ "$REIMPORT" = false ]; then
  echo "  planet_osm_point existiert bereits. Verwende --reimport zum Überschreiben."
  echo "  Überspringe Import."
  exit 0
fi

if [ "$TABLE_EXISTS" = "t" ] && [ "$REIMPORT" = true ]; then
  echo "  --reimport: Lösche bestehende osm2pgsql-Tabellen..."
  for TBL in planet_osm_point planet_osm_line planet_osm_polygon planet_osm_roads planet_osm_rels planet_osm_ways planet_osm_nodes; do
    psql -h "${EINFO_DB_HOST:-localhost}" -p "${EINFO_DB_PORT:-5432}" \
      -U "$EINFO_DB_USER" -d "$EINFO_DB_NAME" -c "DROP TABLE IF EXISTS ${TBL} CASCADE;" 2>/dev/null || true
  done
fi

echo "  Importiere: $PBF"
echo "  Cache: ${CACHE_MB} MB"
echo "  DB: ${EINFO_DB_NAME} (User: ${EINFO_DB_USER})"
echo "  Projektion: --latlong (SRID 4326 / WGS84)"

# --latlong: Importiert Geometrien direkt in SRID 4326 (WGS84 lat/lon)
# statt des osm2pgsql-Defaults SRID 3857 (Web Mercator).
# Die App-Queries verwenden durchgehend SRID 4326 (ST_MakeEnvelope, ST_DWithin).
# Die Views in 06_create_views.sql nutzen ST_Transform(..., 4326), was bei
# 4326-Daten ein No-Op ist und bei 3857-Altdaten korrekt transformiert.
#
# HINWEIS: Wenn die DB bereits mit dem alten Default (3857) importiert wurde,
# muss entweder ein Reimport mit --reimport durchgefuehrt werden, oder die
# Views (06_create_views.sql) erledigen die Transformation automatisch.
osm2pgsql --create --slim \
  --latlong \
  --hstore \
  --multi-geometry \
  --cache "${CACHE_MB}" \
  --host "${EINFO_DB_HOST:-localhost}" \
  --port "${EINFO_DB_PORT:-5432}" \
  --database "$EINFO_DB_NAME" \
  -U "$EINFO_DB_USER" \
  "$PBF"

unset PGPASSWORD

echo ""
echo "[03] osm2pgsql Import abgeschlossen (SRID 4326 / WGS84)."
