#!/usr/bin/env bash
# 01_install_tools.sh
# Installiert osm2pgsql, osmium-tool und gdal (ogr2ogr) für Import/Extraktion
set -euo pipefail

echo "=== [01] Import-Tools installieren ==="

sudo apt-get update -qq

sudo apt-get install -y \
  osm2pgsql \
  osmium-tool \
  gdal-bin

echo ""
echo "--- Versionen ---"
osm2pgsql --version 2>&1 | head -1
osmium --version 2>&1 | head -1
ogr2ogr --version 2>&1 | head -1

echo ""
echo "[01] osm2pgsql + osmium-tool + gdal-bin installiert."
