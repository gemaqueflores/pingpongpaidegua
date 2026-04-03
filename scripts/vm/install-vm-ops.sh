#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/pingpongpaidegua}"
RUNTIME_DIR="$APP_DIR/.runtime"
HEALTH_LOG_FILE="$RUNTIME_DIR/ppg-vm-health.log"
HOUSEKEEPING_LOG_FILE="$RUNTIME_DIR/ppg-housekeeping.log"
EVENT_WATCH_LOG_FILE="$RUNTIME_DIR/ppg-event-watch.log"
VM_HEALTH_SCHEDULE="${VM_HEALTH_SCHEDULE:-*/15 * * * *}"
VM_HOUSEKEEPING_SCHEDULE="${VM_HOUSEKEEPING_SCHEDULE:-17 3 * * *}"
EVENT_WATCH_SCHEDULE="${EVENT_WATCH_SCHEDULE:-*/10 * * * *}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "Diretorio da aplicacao nao encontrado: $APP_DIR" >&2
  exit 1
fi

for script in ppg-vm-health.sh ppg-housekeeping.sh ppg-event-watch.sh; do
  if [[ ! -f "$APP_DIR/scripts/vm/$script" ]]; then
    echo "Script obrigatorio nao encontrado: $APP_DIR/scripts/vm/$script" >&2
    exit 1
  fi
done

if [[ ! -f "$APP_DIR/scripts/vm/ppg-send-alert.sh" ]]; then
  echo "Script obrigatorio nao encontrado: $APP_DIR/scripts/vm/ppg-send-alert.sh" >&2
  exit 1
fi

sudo install -m 755 "$APP_DIR/scripts/vm/ppg-vm-health.sh" /usr/local/bin/ppg-vm-health.sh
sudo install -m 755 "$APP_DIR/scripts/vm/ppg-housekeeping.sh" /usr/local/bin/ppg-housekeeping.sh
sudo install -m 755 "$APP_DIR/scripts/vm/ppg-event-watch.sh" /usr/local/bin/ppg-event-watch.sh
sudo install -m 755 "$APP_DIR/scripts/vm/ppg-send-alert.sh" /usr/local/bin/ppg-send-alert.sh
mkdir -p "$RUNTIME_DIR"

tmp_cron="$(mktemp)"
crontab -l > "$tmp_cron" 2>/dev/null || true

grep -v '/usr/local/bin/ppg-vm-health.sh' "$tmp_cron" \
  | grep -v '/usr/local/bin/ppg-housekeeping.sh' \
  | grep -v '/usr/local/bin/ppg-event-watch.sh' > "${tmp_cron}.next" || true

{
  cat "${tmp_cron}.next"
  echo "${VM_HEALTH_SCHEDULE} APP_DIR=$APP_DIR /usr/local/bin/ppg-vm-health.sh >>$HEALTH_LOG_FILE 2>&1"
  echo "${VM_HOUSEKEEPING_SCHEDULE} APP_DIR=$APP_DIR /usr/local/bin/ppg-housekeeping.sh >>$HOUSEKEEPING_LOG_FILE 2>&1"
  echo "${EVENT_WATCH_SCHEDULE} APP_DIR=$APP_DIR COMPOSE_PROJECT_NAME=pingpongpaidegua /usr/local/bin/ppg-event-watch.sh >>$EVENT_WATCH_LOG_FILE 2>&1"
} | crontab -

rm -f "$tmp_cron" "${tmp_cron}.next"

echo "Operacoes de VM instaladas com sucesso."
