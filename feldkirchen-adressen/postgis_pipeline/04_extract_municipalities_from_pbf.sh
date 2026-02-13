#!/usr/bin/env bash
# 04_extract_municipalities_from_pbf.sh
# Extrahiert Gemeindegrenzen (admin_level=8) aus dem PBF als GeoJSON
set -euo pipefail

echo "=== [04] Gemeindegrenzen aus PBF extrahieren ==="

PBF=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pbf) PBF="$2"; shift 2;;
    *)     echo "Unbekannter Parameter: $1"; exit 1;;
  esac
done

if [ -z "$PBF" ] || [ ! -f "$PBF" ]; then
  echo "FEHLER: --pbf /pfad/zu/karnten-latest.osm.pbf erforderlich"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="${SCRIPT_DIR}/tmp"
mkdir -p "$TMP_DIR"

echo "  Quelle: $PBF"

# Schritt 1: Administrative Boundaries filtern (relations + ways mit boundary=administrative UND admin_level=8)
echo "  [1/2] osmium tags-filter ..."
osmium tags-filter "$PBF" \
  nwr/boundary=administrative \
  -o "${TMP_DIR}/admin_boundaries.osm.pbf" \
  --overwrite

# Schritt 2: Export als GeoJSON (mit Geometrien)
echo "  [2/2] osmium export -> GeoJSON ..."
osmium export "${TMP_DIR}/admin_boundaries.osm.pbf" \
  -f geojson \
  -o "${TMP_DIR}/municipalities_admin8.geojson" \
  --overwrite

# Statistik
if command -v jq &>/dev/null; then
  FEATURE_COUNT=$(jq '.features | length' "${TMP_DIR}/municipalities_admin8.geojson" 2>/dev/null || echo "?")
  echo "  Features extrahiert: $FEATURE_COUNT (alle admin boundaries)"
else
  echo "  (jq nicht installiert - Statistik übersprungen)"
fi

echo ""
echo "  Hinweis: Die Datei enthält ALLE admin boundaries."
echo "  Schritt 05 filtert auf admin_level=8 (Gemeinden) beim Import."
echo ""
echo "[04] Extraktion abgeschlossen -> ${TMP_DIR}/municipalities_admin8.geojson"
