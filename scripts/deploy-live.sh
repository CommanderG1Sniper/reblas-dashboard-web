#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_UNIT_SRC="$ROOT_DIR/deploy/systemd/reblas-dashboard-web.service"
BOT_UNIT_SRC="$ROOT_DIR/deploy/systemd/reblas-dashboard-bot.service"
WEB_UNIT_DST="/etc/systemd/system/reblas-dashboard-web.service"
BOT_UNIT_DST="/etc/systemd/system/reblas-dashboard-bot.service"

echo "[deploy] repo: $ROOT_DIR"
cd "$ROOT_DIR"

echo "[deploy] migrating runtime data to protected storage..."
bash "$ROOT_DIR/scripts/migrate-runtime-data.sh"

echo "[deploy] ensuring live watchdog timer is installed..."
bash "$ROOT_DIR/scripts/install-live-watchdog-user-service.sh"

echo "[deploy] building app..."
npm run build

echo "[deploy] installing systemd units..."
sudo cp "$WEB_UNIT_SRC" "$WEB_UNIT_DST"
sudo cp "$BOT_UNIT_SRC" "$BOT_UNIT_DST"

echo "[deploy] reloading and restarting services..."
sudo systemctl daemon-reload
sudo systemctl restart reblas-dashboard-web reblas-dashboard-bot

echo "[deploy] service status:"
sudo systemctl status --no-pager -l reblas-dashboard-web reblas-dashboard-bot || true

echo "[deploy] local web health check:"
curl -I --max-time 10 http://127.0.0.1:3020 || true

echo "[deploy] done."
