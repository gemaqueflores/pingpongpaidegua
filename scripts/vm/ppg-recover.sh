#!/usr/bin/env bash
set -euo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

APP_DIR="${APP_DIR:-/home/ubuntu/pingpongpaidegua}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pingpongpaidegua}"
LOCK_FILE="/tmp/ppg-recover.lock"

if ! command -v flock >/dev/null 2>&1; then
  exit 0
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  exit 0
fi

if [[ ! -d "$APP_DIR" ]]; then
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  exit 0
fi

cd "$APP_DIR"

COMPOSE_CMD=(docker compose -p "$PROJECT_NAME")
if ! "${COMPOSE_CMD[@]}" version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose -p "$PROJECT_NAME")
  else
    exit 0
  fi
fi

services=(postgres redis api worker)
needs_recover=0
for svc in "${services[@]}"; do
  id="$("${COMPOSE_CMD[@]}" ps "$svc" --status running --quiet 2>/dev/null || true)"
  if [[ -z "$id" ]]; then
    needs_recover=1
    break
  fi
done

if [[ "$needs_recover" -eq 1 ]]; then
  "${COMPOSE_CMD[@]}" up -d postgres redis api worker >/dev/null 2>&1 || true
fi

