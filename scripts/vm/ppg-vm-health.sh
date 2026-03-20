#!/usr/bin/env bash
set -euo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

APP_DIR="${APP_DIR:-/home/ubuntu/pingpongpaidegua}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pingpongpaidegua}"
RUNTIME_DIR="${APP_DIR}/.runtime"
LOCK_FILE="${RUNTIME_DIR}/ppg-vm-health.lock"

VM_DISK_WARN_PERCENT="${VM_DISK_WARN_PERCENT:-85}"
VM_DISK_FAIL_PERCENT="${VM_DISK_FAIL_PERCENT:-92}"
VM_MEM_AVAILABLE_WARN_MB="${VM_MEM_AVAILABLE_WARN_MB:-160}"
VM_MEM_AVAILABLE_FAIL_MB="${VM_MEM_AVAILABLE_FAIL_MB:-96}"
VM_SWAP_WARN_MB="${VM_SWAP_WARN_MB:-1024}"
VM_SWAP_FAIL_MB="${VM_SWAP_FAIL_MB:-2048}"
VM_DOCKER_RECLAIMABLE_WARN_MB="${VM_DOCKER_RECLAIMABLE_WARN_MB:-4096}"
VM_CONTAINER_RESTART_WARN="${VM_CONTAINER_RESTART_WARN:-1}"

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

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

read -r _ mem_total_mb mem_used_mb mem_free_mb _ mem_available_mb _ < <(free -m | awk 'NR==2 {print $1, $2, $3, $4, $5, $6, $7}')
read -r _ swap_total_mb swap_used_mb swap_free_mb < <(free -m | awk 'NR==3 {print $1, $2, $3, $4}')
disk_percent="$(df -P / | awk 'NR==2 {gsub("%", "", $5); print $5}')"

reclaimable_images_mb="0"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  reclaimable_images_mb="$(
    docker system df -v --format '{{json .}}' 2>/dev/null \
      | awk '
          BEGIN { sum = 0 }
          /"Type":"Image"/ {
            if (match($0, /"Reclaimable":"([0-9.]+)([A-Za-z]+)"/, m)) {
              value = m[1] + 0
              unit = m[2]
              if (unit == "B")      value = value / 1024 / 1024
              else if (unit == "kB" || unit == "KB") value = value / 1024
              else if (unit == "MB") value = value
              else if (unit == "GB") value = value * 1024
              else if (unit == "TB") value = value * 1024 * 1024
              sum += value
            }
          }
          END { printf "%.0f\n", sum }
        ' || echo "0"
  )"
fi

restart_count="0"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  restart_count="$(
    docker ps -q \
      | xargs -r docker inspect --format '{{.RestartCount}}' 2>/dev/null \
      | awk '{sum += $1} END {print sum + 0}'
  )"
fi

status="pass"
reasons=()

if (( disk_percent >= VM_DISK_FAIL_PERCENT )); then
  status="fail"
  reasons+=("disk=${disk_percent}%")
elif (( disk_percent >= VM_DISK_WARN_PERCENT )) && [[ "$status" != "fail" ]]; then
  status="warn"
  reasons+=("disk=${disk_percent}%")
fi

if (( mem_available_mb <= VM_MEM_AVAILABLE_FAIL_MB )); then
  status="fail"
  reasons+=("mem_available=${mem_available_mb}MB")
elif (( mem_available_mb <= VM_MEM_AVAILABLE_WARN_MB )) && [[ "$status" != "fail" ]]; then
  status="warn"
  reasons+=("mem_available=${mem_available_mb}MB")
fi

if (( swap_used_mb >= VM_SWAP_FAIL_MB )); then
  status="fail"
  reasons+=("swap_used=${swap_used_mb}MB")
elif (( swap_used_mb >= VM_SWAP_WARN_MB )) && [[ "$status" != "fail" ]]; then
  status="warn"
  reasons+=("swap_used=${swap_used_mb}MB")
fi

if (( reclaimable_images_mb >= VM_DOCKER_RECLAIMABLE_WARN_MB )) && [[ "$status" != "fail" ]]; then
  status="warn"
  reasons+=("reclaimable_images=${reclaimable_images_mb}MB")
fi

if (( restart_count >= VM_CONTAINER_RESTART_WARN )) && [[ "$status" != "fail" ]]; then
  status="warn"
  reasons+=("container_restarts=${restart_count}")
fi

if [[ "${#reasons[@]}" -eq 0 ]]; then
  reasons+=("ok")
fi

echo "${timestamp} vm_health status=${status} reasons=${reasons[*]} metrics=disk:${disk_percent}% mem_available:${mem_available_mb}MB swap_used:${swap_used_mb}MB reclaimable_images:${reclaimable_images_mb}MB restarts:${restart_count}"

case "$status" in
  pass) exit 0 ;;
  warn) exit 1 ;;
  fail) exit 2 ;;
esac
