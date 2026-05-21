#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[dev-user-service] ensuring protected runtime data exists..."
bash "$ROOT_DIR/scripts/migrate-runtime-data.sh"

echo "[dev-user-service] restarting reblas-dashboard-dev.user.service..."
systemctl --user restart reblas-dashboard-dev.user.service
systemctl --user status --no-pager -l reblas-dashboard-dev.user.service || true
