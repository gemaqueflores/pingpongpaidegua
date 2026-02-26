#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/pingpongpaidegua}"

SITE_SRC="$APP_DIR/scripts/vm/nginx-api-site.conf"
LIMITS_SRC="$APP_DIR/scripts/vm/nginx-limits.conf"

if [[ ! -f "$SITE_SRC" || ! -f "$LIMITS_SRC" ]]; then
  echo "Arquivos de configuracao nginx nao encontrados em $APP_DIR/scripts/vm" >&2
  exit 1
fi

sudo cp "$LIMITS_SRC" /etc/nginx/conf.d/pingpongpaidegua-limits.conf
sudo cp "$SITE_SRC" /etc/nginx/sites-available/api-pingpongpaidegua
sudo ln -sfn /etc/nginx/sites-available/api-pingpongpaidegua /etc/nginx/sites-enabled/api-pingpongpaidegua

sudo nginx -t
sudo systemctl reload nginx
sudo systemctl is-active nginx

echo "Nginx hardening aplicado com sucesso."
