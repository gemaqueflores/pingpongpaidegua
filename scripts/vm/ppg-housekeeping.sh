#!/usr/bin/env bash
set -euo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

APP_DIR="${APP_DIR:-/home/ubuntu/pingpongpaidegua}"
RUNTIME_DIR="${APP_DIR}/.runtime"
LOCK_FILE="${RUNTIME_DIR}/ppg-housekeeping.lock"
HOUSEKEEPING_IMAGE_MAX_AGE="${HOUSEKEEPING_IMAGE_MAX_AGE:-168h}"
HOUSEKEEPING_BUILDER_MAX_AGE="${HOUSEKEEPING_BUILDER_MAX_AGE:-168h}"

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

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
before_disk="$(df -h / | awk 'NR==2 {print $3 "/" $2 " (" $5 ")"}')"

echo "${timestamp} housekeeping_start disk=${before_disk} image_max_age=${HOUSEKEEPING_IMAGE_MAX_AGE} builder_max_age=${HOUSEKEEPING_BUILDER_MAX_AGE}"

docker container prune -f >/dev/null 2>&1 || true
docker image prune -af --filter "until=${HOUSEKEEPING_IMAGE_MAX_AGE}" >/dev/null 2>&1 || true
docker builder prune -af --filter "until=${HOUSEKEEPING_BUILDER_MAX_AGE}" >/dev/null 2>&1 || true

after_disk="$(df -h / | awk 'NR==2 {print $3 "/" $2 " (" $5 ")"}')"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) housekeeping_done disk=${after_disk}"
