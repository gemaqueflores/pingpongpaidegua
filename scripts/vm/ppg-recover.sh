#!/usr/bin/env bash
set -euo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

APP_DIR="${APP_DIR:-/home/ubuntu/pingpongpaidegua}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pingpongpaidegua}"
RUNTIME_DIR="${APP_DIR}/.runtime"
LOCK_FILE="${RUNTIME_DIR}/ppg-recover.lock"
STATE_FILE="${RUNTIME_DIR}/ppg-recover.state"
ALERT_HELPER="/usr/local/bin/ppg-send-alert.sh"
RECOVERY_COOLDOWN_SECONDS="${RECOVERY_COOLDOWN_SECONDS:-600}"
RECOVERY_FAILURE_WINDOW_SECONDS="${RECOVERY_FAILURE_WINDOW_SECONDS:-3600}"
RECOVERY_MAX_FAILURES="${RECOVERY_MAX_FAILURES:-6}"

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

if ! command -v docker >/dev/null 2>&1; then
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
reasons=()
needs_recover=0
for svc in "${services[@]}"; do
  id="$("${COMPOSE_CMD[@]}" ps "$svc" --status running --quiet 2>/dev/null || true)"
  if [[ -z "$id" ]]; then
    needs_recover=1
    reasons+=("${svc}:stopped")
    continue
  fi

  health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || echo "unknown")"
  if [[ "$health_status" == "unhealthy" ]]; then
    needs_recover=1
    reasons+=("${svc}:unhealthy")
  fi
done

if [[ "$needs_recover" -eq 1 ]]; then
  now_epoch="$(date +%s)"
  last_epoch="0"
  fail_window_start="0"
  fail_count="0"
  if [[ -f "$STATE_FILE" ]]; then
    # Formato: last_epoch fail_window_start fail_count
    read -r last_epoch fail_window_start fail_count < "$STATE_FILE" || true
  fi

  if ! [[ "$last_epoch" =~ ^[0-9]+$ ]]; then
    last_epoch="0"
  fi
  if ! [[ "$fail_window_start" =~ ^[0-9]+$ ]]; then
    fail_window_start="0"
  fi
  if ! [[ "$fail_count" =~ ^[0-9]+$ ]]; then
    fail_count="0"
  fi

  if [[ "$fail_window_start" -eq 0 || "$((now_epoch - fail_window_start))" -ge "$RECOVERY_FAILURE_WINDOW_SECONDS" ]]; then
    fail_window_start="$now_epoch"
    fail_count="0"
  fi

  if [[ "$fail_count" -ge "$RECOVERY_MAX_FAILURES" ]]; then
    printf '%s %s %s\n' "$last_epoch" "$fail_window_start" "$fail_count" > "$STATE_FILE"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) skip_recovery too_many_failures count=${fail_count} window_s=${RECOVERY_FAILURE_WINDOW_SECONDS} reasons=${reasons[*]}"
    if [[ -x "$ALERT_HELPER" ]]; then
      "$ALERT_HELPER" "recover-too-many-failures" "fail" "skip_recovery too_many_failures count=${fail_count} reasons=${reasons[*]}" || true
    fi
    exit 0
  fi

  elapsed="$((now_epoch - last_epoch))"
  if [[ "$elapsed" -lt "$RECOVERY_COOLDOWN_SECONDS" ]]; then
    printf '%s %s %s\n' "$last_epoch" "$fail_window_start" "$fail_count" > "$STATE_FILE"
    exit 0
  fi

  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) recovery_attempt reasons=${reasons[*]}"
  "${COMPOSE_CMD[@]}" up -d --no-recreate postgres redis api worker >/dev/null 2>&1 || true
  sleep 8

  recover_ok=1
  for svc in "${services[@]}"; do
    id="$("${COMPOSE_CMD[@]}" ps "$svc" --status running --quiet 2>/dev/null || true)"
    if [[ -z "$id" ]]; then
      recover_ok=0
      break
    fi
    health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || echo "unknown")"
    if [[ "$health_status" == "unhealthy" ]]; then
      recover_ok=0
      break
    fi
  done

  if [[ "$recover_ok" -eq 1 ]]; then
    printf '%s %s %s\n' "$now_epoch" "$now_epoch" "0" > "$STATE_FILE"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) recovery_success"
    if [[ -x "$ALERT_HELPER" ]]; then
      "$ALERT_HELPER" "recover-success" "warn" "recovery_success reasons=${reasons[*]}" || true
    fi
  else
    fail_count="$((fail_count + 1))"
    printf '%s %s %s\n' "$now_epoch" "$fail_window_start" "$fail_count" > "$STATE_FILE"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) recovery_failed fail_count=${fail_count} reasons=${reasons[*]}"
    if [[ -x "$ALERT_HELPER" ]]; then
      "$ALERT_HELPER" "recover-failed" "fail" "recovery_failed fail_count=${fail_count} reasons=${reasons[*]}" || true
    fi
  fi
fi
