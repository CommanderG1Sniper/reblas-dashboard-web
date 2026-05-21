#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"

mkdir -p "$UNIT_DIR"
cp "$ROOT_DIR/deploy/systemd/reblas-dashboard-split-web.user.service" "$UNIT_DIR/"

systemctl --user daemon-reload
systemctl --user enable reblas-dashboard-split-web.user.service
systemctl --user restart reblas-dashboard-split-web.user.service

echo "[split-sandbox] web service restarted on 3010"
