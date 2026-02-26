#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/pingpongpaidegua}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pingpongpaidegua}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "Diretorio da aplicacao nao encontrado: $APP_DIR" >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/scripts/vm/ppg-recover.sh" ]]; then
  echo "Script de recovery nao encontrado em $APP_DIR/scripts/vm/ppg-recover.sh" >&2
  exit 1
fi

sudo install -m 755 "$APP_DIR/scripts/vm/ppg-recover.sh" /usr/local/bin/ppg-recover.sh

tmp_cron="$(mktemp)"
crontab -l > "$tmp_cron" 2>/dev/null || true

grep -v '/usr/local/bin/ppg-recover.sh' "$tmp_cron" | grep -v 'COMPOSE_PROJECT_NAME=pingpongpaidegua' > "${tmp_cron}.next" || true

{
  cat "${tmp_cron}.next"
  echo "@reboot COMPOSE_PROJECT_NAME=$PROJECT_NAME APP_DIR=$APP_DIR /usr/local/bin/ppg-recover.sh >/tmp/ppg-recover.log 2>&1"
  echo "*/2 * * * * COMPOSE_PROJECT_NAME=$PROJECT_NAME APP_DIR=$APP_DIR /usr/local/bin/ppg-recover.sh >/tmp/ppg-recover.log 2>&1"
} | crontab -

rm -f "$tmp_cron" "${tmp_cron}.next"

echo "Self-heal instalado com sucesso."

