#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/pingpongpaidegua}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pingpongpaidegua}"
RUNTIME_DIR="$APP_DIR/.runtime"
LOG_FILE="$RUNTIME_DIR/ppg-recover.log"
RECOVERY_COOLDOWN_SECONDS="${RECOVERY_COOLDOWN_SECONDS:-600}"
RECOVERY_FAILURE_WINDOW_SECONDS="${RECOVERY_FAILURE_WINDOW_SECONDS:-3600}"
RECOVERY_MAX_FAILURES="${RECOVERY_MAX_FAILURES:-6}"
RECOVERY_RESTART_WORKER_ON_STALE_LOCKS="${RECOVERY_RESTART_WORKER_ON_STALE_LOCKS:-true}"
RECOVERY_STALE_LOCK_RESTART_MS="${RECOVERY_STALE_LOCK_RESTART_MS:-900000}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "Diretorio da aplicacao nao encontrado: $APP_DIR" >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/scripts/vm/ppg-recover.sh" ]]; then
  echo "Script de recovery nao encontrado em $APP_DIR/scripts/vm/ppg-recover.sh" >&2
  exit 1
fi

sudo install -m 755 "$APP_DIR/scripts/vm/ppg-recover.sh" /usr/local/bin/ppg-recover.sh
mkdir -p "$RUNTIME_DIR"

tmp_cron="$(mktemp)"
crontab -l > "$tmp_cron" 2>/dev/null || true

grep -v '/usr/local/bin/ppg-recover.sh' "$tmp_cron" | grep -v 'COMPOSE_PROJECT_NAME=pingpongpaidegua' > "${tmp_cron}.next" || true

{
  cat "${tmp_cron}.next"
  echo "@reboot COMPOSE_PROJECT_NAME=$PROJECT_NAME APP_DIR=$APP_DIR RECOVERY_COOLDOWN_SECONDS=$RECOVERY_COOLDOWN_SECONDS RECOVERY_FAILURE_WINDOW_SECONDS=$RECOVERY_FAILURE_WINDOW_SECONDS RECOVERY_MAX_FAILURES=$RECOVERY_MAX_FAILURES RECOVERY_RESTART_WORKER_ON_STALE_LOCKS=$RECOVERY_RESTART_WORKER_ON_STALE_LOCKS RECOVERY_STALE_LOCK_RESTART_MS=$RECOVERY_STALE_LOCK_RESTART_MS /usr/local/bin/ppg-recover.sh >>$LOG_FILE 2>&1"
  echo "*/2 * * * * COMPOSE_PROJECT_NAME=$PROJECT_NAME APP_DIR=$APP_DIR RECOVERY_COOLDOWN_SECONDS=$RECOVERY_COOLDOWN_SECONDS RECOVERY_FAILURE_WINDOW_SECONDS=$RECOVERY_FAILURE_WINDOW_SECONDS RECOVERY_MAX_FAILURES=$RECOVERY_MAX_FAILURES RECOVERY_RESTART_WORKER_ON_STALE_LOCKS=$RECOVERY_RESTART_WORKER_ON_STALE_LOCKS RECOVERY_STALE_LOCK_RESTART_MS=$RECOVERY_STALE_LOCK_RESTART_MS /usr/local/bin/ppg-recover.sh >>$LOG_FILE 2>&1"
} | crontab -

rm -f "$tmp_cron" "${tmp_cron}.next"

echo "Self-heal instalado com sucesso."
