#!/usr/bin/env bash
set -euo pipefail

# Beispielaufruf ohne externe Domain: greift direkt per Loopback auf den internen
# Endpunkt zu und speichert die erzeugte SVG-Karte.
API_BASE="http://127.0.0.1:4040"
TARGET="$API_BASE/api/internal/feldkirchen-map?show=all&hours=24"

curl -fsSL "$TARGET" -o feldkirchen-map.svg
echo "SVG wurde nach feldkirchen-map.svg geladen"
