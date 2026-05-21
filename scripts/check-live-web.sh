#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/projects/reblas-crew-dashboard"
APP_URL="http://127.0.0.1:3020/"
APP_LOG="/tmp/reblas-live-web.log"
WATCHDOG_LOG="/tmp/reblas-live-watchdog.log"
DATA_DIR="/home/australis/.reblas-dashboard-data"
START_PATTERN="next start --hostname 127.0.0.1 --port 3020"

cd "$APP_DIR"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*" >>"$WATCHDOG_LOG"
}

if curl -fsSI --max-time 10 "$APP_URL" >/dev/null 2>&1; then
  exit 0
fi

log "health check failed; restarting live web process"
pkill -f "$START_PATTERN" || true
nohup env REBLAS_DATA_DIR="$DATA_DIR" TZ=Australia/Melbourne npm run start -- --hostname 127.0.0.1 --port 3020 >"$APP_LOG" 2>&1 &
sleep 3

if curl -fsSI --max-time 10 "$APP_URL" >/dev/null 2>&1; then
  log "restart succeeded"
  exit 0
fi

log "restart failed"
exit 1

