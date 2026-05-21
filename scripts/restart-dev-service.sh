#!/usr/bin/env bash
set -euo pipefail

echo "[dev-service] restarting reblas-dashboard-dev..."
sudo systemctl restart reblas-dashboard-dev
sudo systemctl status --no-pager -l reblas-dashboard-dev || true
