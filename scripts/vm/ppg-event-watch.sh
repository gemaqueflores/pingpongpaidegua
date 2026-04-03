#!/usr/bin/env bash
set -euo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

APP_DIR="${APP_DIR:-/home/ubuntu/pingpongpaidegua}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pingpongpaidegua}"
RUNTIME_DIR="${APP_DIR}/.runtime"
LOCK_FILE="${RUNTIME_DIR}/ppg-event-watch.lock"

EVENT_WATCH_API_BASE_URL="${EVENT_WATCH_API_BASE_URL:-http://api:4000}"
EVENT_WATCH_MAX_EVENTS="${EVENT_WATCH_MAX_EVENTS:-6}"
EVENT_WATCH_POST_EVENT_HOURS="${EVENT_WATCH_POST_EVENT_HOURS:-18}"
EVENT_WATCH_AUTO_POST_REPROCESS="${EVENT_WATCH_AUTO_POST_REPROCESS:-true}"
EVENT_WATCH_POST_REPROCESS_COOLDOWN_MS="${EVENT_WATCH_POST_REPROCESS_COOLDOWN_MS:-1800000}"

if [[ ! -d "$APP_DIR" ]]; then
  exit 0
fi

mkdir -p "$RUNTIME_DIR"

if ! command -v flock >/dev/null 2>&1; then
  exit 0
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

cd "$APP_DIR"

compose_cmd=(docker compose -p "$PROJECT_NAME")
if ! "${compose_cmd[@]}" version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    compose_cmd=(docker-compose -p "$PROJECT_NAME")
  else
    echo "event_watch status=skip reason=compose_unavailable"
    exit 0
  fi
fi

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "${timestamp} event_watch_start"

set +e
"${compose_cmd[@]}" exec -T \
  -e EVENT_WATCH_API_BASE_URL="$EVENT_WATCH_API_BASE_URL" \
  -e EVENT_WATCH_MAX_EVENTS="$EVENT_WATCH_MAX_EVENTS" \
  -e EVENT_WATCH_POST_EVENT_HOURS="$EVENT_WATCH_POST_EVENT_HOURS" \
  -e EVENT_WATCH_AUTO_POST_REPROCESS="$EVENT_WATCH_AUTO_POST_REPROCESS" \
  -e EVENT_WATCH_POST_REPROCESS_COOLDOWN_MS="$EVENT_WATCH_POST_REPROCESS_COOLDOWN_MS" \
  worker sh -lc "cd /workspace && npm run ops:event-watch -- --json"
rc=$?
set -e

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) event_watch_done rc=${rc}"
exit "$rc"
