#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_SRC="$ROOT_DIR/deploy/systemd/reblas-dashboard-dev.user.service"
UNIT_NAME="reblas-dashboard-dev.user.service"

echo "[dev-user-service] repo: $ROOT_DIR"
cd "$ROOT_DIR"

echo "[dev-user-service] migrating runtime data to protected storage..."
bash "$ROOT_DIR/scripts/migrate-runtime-data.sh"

echo "[dev-user-service] stopping any existing manual dev web process on 3010..."
pkill -f "node /projects/reblas-crew-dashboard/node_modules/.bin/next dev -H 0.0.0.0 -p 3010" || true
pkill -f "sh -c TZ=Australia/Melbourne next dev -H 0.0.0.0 -p 3010" || true
pkill -f "npm run dev:web" || true

echo "[dev-user-service] linking user unit..."
systemctl --user link "$UNIT_SRC"

echo "[dev-user-service] reloading user systemd..."
systemctl --user daemon-reload

echo "[dev-user-service] enabling and restarting service..."
systemctl --user enable "$UNIT_NAME"
systemctl --user restart "$UNIT_NAME"

echo "[dev-user-service] service status:"
systemctl --user status --no-pager -l "$UNIT_NAME" || true

echo "[dev-user-service] local dev health check:"
curl -I --max-time 10 http://127.0.0.1:3010 || true

echo "[dev-user-service] done."
