#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[restart-all] repo: $ROOT_DIR"
cd "$ROOT_DIR"

echo "[restart-all] refreshing sudo credentials for live deploy..."
sudo -v

echo "[restart-all] restarting dev user service..."
bash "$ROOT_DIR/scripts/restart-dev-user-service.sh"

echo "[restart-all] deploying live build and restarting live services..."
bash "$ROOT_DIR/scripts/deploy-live.sh"

echo "[restart-all] done."
