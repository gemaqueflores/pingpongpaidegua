#!/usr/bin/env bash
set -euo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

APP_DIR="${APP_DIR:-/home/ubuntu/pingpongpaidegua}"
RUNTIME_DIR="${APP_DIR}/.runtime"
WEBHOOK_URL="${PPG_ALERT_WEBHOOK_URL:-}"
ALERT_KEY="${1:-generic}"
ALERT_SEVERITY="${2:-warn}"
ALERT_MESSAGE="${3:-}"
ALERT_COOLDOWN_SECONDS="${PPG_ALERT_COOLDOWN_SECONDS:-1800}"

if [[ -z "$WEBHOOK_URL" || -z "$ALERT_MESSAGE" ]]; then
  exit 0
fi

mkdir -p "$RUNTIME_DIR"
state_file="${RUNTIME_DIR}/alert-${ALERT_KEY}.state"
now_epoch="$(date +%s)"
last_epoch="0"

if [[ -f "$state_file" ]]; then
  read -r last_epoch < "$state_file" || true
fi

if ! [[ "$last_epoch" =~ ^[0-9]+$ ]]; then
  last_epoch="0"
fi

if (( now_epoch - last_epoch < ALERT_COOLDOWN_SECONDS )); then
  exit 0
fi

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
payload="$(printf '{"text":"[%s] %s - %s"}' "$ALERT_SEVERITY" "$timestamp" "${ALERT_MESSAGE//\"/\\\"}")"

curl -fsS -X POST -H "Content-Type: application/json" -d "$payload" "$WEBHOOK_URL" >/dev/null
printf '%s\n' "$now_epoch" > "$state_file"
