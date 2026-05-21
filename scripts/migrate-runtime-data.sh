#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/data"
TARGET_DIR="${REBLAS_DATA_DIR:-$HOME/.reblas-dashboard-data}"

mkdir -p "$TARGET_DIR"

if [ -d "$SOURCE_DIR" ]; then
  cp -an "$SOURCE_DIR"/. "$TARGET_DIR"/
fi

echo "[runtime-data] source: $SOURCE_DIR"
echo "[runtime-data] target: $TARGET_DIR"
echo "[runtime-data] migration complete"
