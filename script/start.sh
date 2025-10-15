#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export NODE_ENV=production
: "${PORT:=4000}"

echo "[kanban] Installiere Abhängigkeiten (workspaces)…"
npm ci --workspaces

echo "[kanban] Baue Client → server/dist …"
npm run build

echo "[kanban] Starte Server (PORT=${PORT}) …"
npm run start
