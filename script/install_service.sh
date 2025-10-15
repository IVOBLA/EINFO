#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/kanban"
SERVICE_NAME="kanban"

# 1) User/Gruppe anlegen, falls nicht vorhanden
if ! id -u "$SERVICE_NAME" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_NAME"
fi

# 2) Projekt kopieren
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$APP_DIR"
rsync -a --delete "$SRC_DIR/" "$APP_DIR/"

# 3) Rechte
chown -R "$SERVICE_NAME:$SERVICE_NAME" "$APP_DIR"

# 4) Env-Datei
install -o "$SERVICE_NAME" -g "$SERVICE_NAME" -m 0644 "$SRC_DIR/deploy/kanban.env" /etc/default/kanban

# 5) Service-Unit
install -m 0644 "$SRC_DIR/deploy/kanban.service" /etc/systemd/system/kanban.service
systemctl daemon-reload

# 6) Node optional installieren
# curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
# apt-get install -y nodejs

# 7) Starten & aktivieren
systemctl enable --now kanban.service

echo "✓ Service 'kanban' installiert und gestartet."
echo "→ Status: systemctl status kanban.service"
