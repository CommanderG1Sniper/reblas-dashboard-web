#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_SYSTEMD_DIR="${HOME}/.config/systemd/user"

mkdir -p "$USER_SYSTEMD_DIR"
chmod 0755 "$ROOT_DIR/scripts/check-live-web.sh"
install -m 0644 \
  "$ROOT_DIR/deploy/systemd/reblas-dashboard-live-watchdog.user.service" \
  "$USER_SYSTEMD_DIR/reblas-dashboard-live-watchdog.user.service"
install -m 0644 \
  "$ROOT_DIR/deploy/systemd/reblas-dashboard-live-watchdog.user.timer" \
  "$USER_SYSTEMD_DIR/reblas-dashboard-live-watchdog.user.timer"

systemctl --user daemon-reload
systemctl --user enable --now reblas-dashboard-live-watchdog.user.timer
systemctl --user start reblas-dashboard-live-watchdog.user.service
systemctl --user status --no-pager -l reblas-dashboard-live-watchdog.user.timer
