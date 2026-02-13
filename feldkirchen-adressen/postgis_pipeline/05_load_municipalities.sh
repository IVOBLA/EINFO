#!/usr/bin/env bash
# 05_load_municipalities.sh
# Importiert Gemeindegrenzen-GeoJSON nach PostGIS und erstellt saubere Tabelle
set -euo pipefail

echo "=== [05] Gemeindegrenzen nach PostGIS laden ==="

EINFO_DB_NAME="${EINFO_DB_NAME:-einfo_osm}"
EINFO_DB_USER="${EINFO_DB_USER:-einfo}"
EINFO_DB_HOST="${EINFO_DB_HOST:-localhost}"
EINFO_DB_PORT="${EINFO_DB_PORT:-5432}"

if [ -z "${EINFO_DB_PASS:-}" ]; then
  echo "FEHLER: EINFO_DB_PASS muss gesetzt sein."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GEOJSON="${SCRIPT_DIR}/tmp/municipalities_admin8.geojson"

if [ ! -f "$GEOJSON" ]; then
  echo "FEHLER: $GEOJSON nicht gefunden. Zuerst 04_extract_municipalities_from_pbf.sh ausführen."
  exit 1
fi

export PGPASSWORD="$EINFO_DB_PASS"

PG_CONN="PG:dbname=${EINFO_DB_NAME} user=${EINFO_DB_USER} password=${EINFO_DB_PASS} host=${EINFO_DB_HOST} port=${EINFO_DB_PORT}"

# Schritt 1: Raw-Import per ogr2ogr
echo "  [1/3] ogr2ogr Import -> einfo.municipalities_raw ..."

# Alte Tabelle droppen falls vorhanden
psql -h "$EINFO_DB_HOST" -p "$EINFO_DB_PORT" \
  -U "$EINFO_DB_USER" -d "$EINFO_DB_NAME" \
  -c "DROP TABLE IF EXISTS einfo.municipalities_raw CASCADE;" 2>/dev/null || true

ogr2ogr -f "PostgreSQL" \
  "$PG_CONN" \
  "$GEOJSON" \
  -nln einfo.municipalities_raw \
  -nlt PROMOTE_TO_MULTI \
  -lco GEOMETRY_NAME=geom \
  -lco SCHEMA=einfo \
  -t_srs EPSG:4326 \
  -skipfailures

echo "  Raw-Import abgeschlossen."

# Schritt 2: Cleanup - nur admin_level=8, name validiert, Geometrie repariert
echo "  [2/3] Erstelle einfo.municipalities (admin_level=8 only) ..."

psql -h "$EINFO_DB_HOST" -p "$EINFO_DB_PORT" \
  -U "$EINFO_DB_USER" -d "$EINFO_DB_NAME" <<'SQL'

DROP TABLE IF EXISTS einfo.municipalities CASCADE;

CREATE TABLE einfo.municipalities (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  admin_level INT DEFAULT 8,
  geom geometry(MultiPolygon, 4326)
);

-- Aus der raw-Tabelle nur admin_level=8 mit gültigem Namen und Polygon/Multi-Polygon
INSERT INTO einfo.municipalities (name, admin_level, geom)
SELECT
  TRIM(r.name) AS name,
  8 AS admin_level,
  ST_Multi(ST_MakeValid(r.geom)) AS geom
FROM einfo.municipalities_raw r
WHERE
  r.name IS NOT NULL
  AND TRIM(r.name) != ''
  AND (
    r.admin_level = '8'
    OR r.admin_level::text = '8'
  )
  AND ST_GeometryType(ST_MakeValid(r.geom)) IN ('ST_Polygon', 'ST_MultiPolygon')
;

-- Spatial Index
CREATE INDEX IF NOT EXISTS idx_municipalities_geom ON einfo.municipalities USING GIST (geom);

-- Aufräumen
DROP TABLE IF EXISTS einfo.municipalities_raw CASCADE;
SQL

# Schritt 3: Statistik
echo "  [3/3] Statistik ..."
MUNI_COUNT=$(psql -h "$EINFO_DB_HOST" -p "$EINFO_DB_PORT" \
  -U "$EINFO_DB_USER" -d "$EINFO_DB_NAME" \
  -tAc "SELECT count(*) FROM einfo.municipalities;" 2>/dev/null || echo "?")

echo "  Gemeinden geladen: $MUNI_COUNT"

# Beispiel-Gemeinden ausgeben
psql -h "$EINFO_DB_HOST" -p "$EINFO_DB_PORT" \
  -U "$EINFO_DB_USER" -d "$EINFO_DB_NAME" \
  -c "SELECT name, ST_NPoints(geom) AS vertices FROM einfo.municipalities ORDER BY name LIMIT 10;"

unset PGPASSWORD

echo ""
echo "[05] Gemeindegrenzen geladen."
