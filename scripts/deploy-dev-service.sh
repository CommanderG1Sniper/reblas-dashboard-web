#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_UNIT_SRC="$ROOT_DIR/deploy/systemd/reblas-dashboard-dev.service"
DEV_UNIT_DST="/etc/systemd/system/reblas-dashboard-dev.service"

echo "[dev-service] repo: $ROOT_DIR"
cd "$ROOT_DIR"

echo "[dev-service] migrating runtime data to protected storage..."
bash "$ROOT_DIR/scripts/migrate-runtime-data.sh"

echo "[dev-service] installing systemd unit..."
sudo cp "$DEV_UNIT_SRC" "$DEV_UNIT_DST"

echo "[dev-service] reloading systemd..."
sudo systemctl daemon-reload

echo "[dev-service] enabling and restarting service..."
sudo systemctl enable reblas-dashboard-dev
sudo systemctl restart reblas-dashboard-dev

echo "[dev-service] service status:"
sudo systemctl status --no-pager -l reblas-dashboard-dev || true

echo "[dev-service] local dev health check:"
curl -I --max-time 10 http://127.0.0.1:3010 || true

echo "[dev-service] done."
