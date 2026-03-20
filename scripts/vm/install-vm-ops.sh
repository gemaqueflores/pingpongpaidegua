#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/pingpongpaidegua}"
RUNTIME_DIR="$APP_DIR/.runtime"
HEALTH_LOG_FILE="$RUNTIME_DIR/ppg-vm-health.log"
HOUSEKEEPING_LOG_FILE="$RUNTIME_DIR/ppg-housekeeping.log"
VM_HEALTH_SCHEDULE="${VM_HEALTH_SCHEDULE:-*/15 * * * *}"
VM_HOUSEKEEPING_SCHEDULE="${VM_HOUSEKEEPING_SCHEDULE:-17 3 * * *}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "Diretorio da aplicacao nao encontrado: $APP_DIR" >&2
  exit 1
fi

for script in ppg-vm-health.sh ppg-housekeeping.sh; do
  if [[ ! -f "$APP_DIR/scripts/vm/$script" ]]; then
    echo "Script obrigatorio nao encontrado: $APP_DIR/scripts/vm/$script" >&2
    exit 1
  fi
done

sudo install -m 755 "$APP_DIR/scripts/vm/ppg-vm-health.sh" /usr/local/bin/ppg-vm-health.sh
sudo install -m 755 "$APP_DIR/scripts/vm/ppg-housekeeping.sh" /usr/local/bin/ppg-housekeeping.sh
mkdir -p "$RUNTIME_DIR"

tmp_cron="$(mktemp)"
crontab -l > "$tmp_cron" 2>/dev/null || true

grep -v '/usr/local/bin/ppg-vm-health.sh' "$tmp_cron" \
  | grep -v '/usr/local/bin/ppg-housekeeping.sh' > "${tmp_cron}.next" || true

{
  cat "${tmp_cron}.next"
  echo "${VM_HEALTH_SCHEDULE} APP_DIR=$APP_DIR /usr/local/bin/ppg-vm-health.sh >>$HEALTH_LOG_FILE 2>&1"
  echo "${VM_HOUSEKEEPING_SCHEDULE} APP_DIR=$APP_DIR /usr/local/bin/ppg-housekeeping.sh >>$HOUSEKEEPING_LOG_FILE 2>&1"
} | crontab -

rm -f "$tmp_cron" "${tmp_cron}.next"

echo "Operacoes de VM instaladas com sucesso."
