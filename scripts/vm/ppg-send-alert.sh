#!/usr/bin/env bash
set -euo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

APP_DIR="${APP_DIR:-/home/ubuntu/pingpongpaidegua}"
RUNTIME_DIR="${APP_DIR}/.runtime"
ALERT_KEY="${1:-generic}"
ALERT_SEVERITY="${2:-warn}"
ALERT_MESSAGE="${3:-}"
ALERT_COOLDOWN_SECONDS="${PPG_ALERT_COOLDOWN_SECONDS:-1800}"

if [[ -z "$ALERT_MESSAGE" ]]; then
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
rendered_message="[$ALERT_SEVERITY] $timestamp - $ALERT_MESSAGE"

normalize_token() {
  local raw="${1:-}"
  echo "$raw" \
    | tr '[:lower:]' '[:upper:]' \
    | sed -E 's/[^A-Z0-9]+/_/g; s/^_+//; s/_+$//'
}

key_suffix="$(normalize_token "$ALERT_KEY")"
severity_suffix="$(normalize_token "$ALERT_SEVERITY")"

read_config() {
  local var_name="${1:-}"
  [[ -n "$var_name" ]] || return 1
  local value="${!var_name:-}"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
    return 0
  fi
  return 1
}

resolve_routes() {
  local value=""
  if value="$(read_config "PPG_ALERT_ROUTES_${key_suffix}")"; then
    printf '%s' "$value"
    return 0
  fi
  if value="$(read_config "PPG_ALERT_ROUTES_${severity_suffix}")"; then
    printf '%s' "$value"
    return 0
  fi
  if value="$(read_config "PPG_ALERT_ROUTES_DEFAULT")"; then
    printf '%s' "$value"
    return 0
  fi
  printf ''
}

resolve_profile_var() {
  local base_name="${1:-}"
  local profile_name="${2:-}"
  local profile_suffix=""

  if [[ -n "$profile_name" ]]; then
    profile_suffix="$(normalize_token "$profile_name")"
    if read_config "${base_name}_${profile_suffix}"; then
      return 0
    fi
  fi

  if read_config "$base_name"; then
    return 0
  fi

  return 1
}

send_discord() {
  local profile_name="${1:-}"
  local webhook_url=""
  webhook_url="$(resolve_profile_var "PPG_DISCORD_WEBHOOK_URL" "$profile_name" || true)"
  [[ -n "$webhook_url" ]] || return 0
  local payload
  payload="$(printf '{"content":"%s"}' "${rendered_message//\"/\\\"}")"
  curl -fsS -X POST -H "Content-Type: application/json" -d "$payload" "$webhook_url" >/dev/null
}

send_telegram() {
  local profile_name="${1:-}"
  local bot_token=""
  local chat_id=""
  bot_token="$(resolve_profile_var "PPG_TELEGRAM_BOT_TOKEN" "$profile_name" || true)"
  chat_id="$(resolve_profile_var "PPG_TELEGRAM_CHAT_ID" "$profile_name" || true)"
  [[ -n "$bot_token" && -n "$chat_id" ]] || return 0
  curl -fsS -X POST "https://api.telegram.org/bot${bot_token}/sendMessage" \
    --data-urlencode "chat_id=${chat_id}" \
    --data-urlencode "text=${rendered_message}" >/dev/null
}

send_whatsapp() {
  local profile_name="${1:-}"
  local token=""
  local phone_number_id=""
  local to=""
  local api_version=""
  local message_type=""
  token="$(resolve_profile_var "PPG_WHATSAPP_TOKEN" "$profile_name" || true)"
  phone_number_id="$(resolve_profile_var "PPG_WHATSAPP_PHONE_NUMBER_ID" "$profile_name" || true)"
  to="$(resolve_profile_var "PPG_WHATSAPP_TO" "$profile_name" || true)"
  api_version="$(resolve_profile_var "PPG_WHATSAPP_API_VERSION" "$profile_name" || true)"
  message_type="$(resolve_profile_var "PPG_WHATSAPP_MESSAGE_TYPE" "$profile_name" || true)"
  [[ -n "$api_version" ]] || api_version="v23.0"
  [[ -n "$message_type" ]] || message_type="template"
  [[ -n "$token" && -n "$phone_number_id" && -n "$to" ]] || return 0

  local endpoint="https://graph.facebook.com/${api_version}/${phone_number_id}/messages"
  local payload=""

  if [[ "$message_type" == "text" ]]; then
    payload="$(printf '{"messaging_product":"whatsapp","to":"%s","type":"text","text":{"preview_url":false,"body":"%s"}}' "$to" "${rendered_message//\"/\\\"}")"
  else
    local template_name=""
    local template_lang=""
    template_name="$(resolve_profile_var "PPG_WHATSAPP_TEMPLATE_NAME" "$profile_name" || true)"
    template_lang="$(resolve_profile_var "PPG_WHATSAPP_TEMPLATE_LANG" "$profile_name" || true)"
    [[ -n "$template_name" ]] || template_name="pingpong_alert"
    [[ -n "$template_lang" ]] || template_lang="pt_BR"
    payload="$(printf '{"messaging_product":"whatsapp","to":"%s","type":"template","template":{"name":"%s","language":{"code":"%s"},"components":[{"type":"body","parameters":[{"type":"text","text":"%s"}]}]}}' "$to" "$template_name" "$template_lang" "${rendered_message//\"/\\\"}")"
  fi

  curl -fsS -X POST "$endpoint" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "$payload" >/dev/null
}

routes_value="$(resolve_routes)"
if [[ -n "$routes_value" ]]; then
  IFS=',' read -r -a channels <<< "$routes_value"
else
  channels=()
  [[ -n "${PPG_DISCORD_WEBHOOK_URL:-}" ]] && channels+=("discord")
  [[ -n "${PPG_TELEGRAM_BOT_TOKEN:-}" && -n "${PPG_TELEGRAM_CHAT_ID:-}" ]] && channels+=("telegram")
  [[ -n "${PPG_WHATSAPP_TOKEN:-}" && -n "${PPG_WHATSAPP_PHONE_NUMBER_ID:-}" && -n "${PPG_WHATSAPP_TO:-}" ]] && channels+=("whatsapp")
fi

for raw_channel in "${channels[@]:-}"; do
  channel="$(echo "$raw_channel" | tr '[:upper:]' '[:lower:]' | xargs)"
  profile=""
  if [[ "$channel" == *:* ]]; then
    profile="${channel#*:}"
    channel="${channel%%:*}"
  fi
  case "$channel" in
    discord) send_discord "$profile" ;;
    telegram) send_telegram "$profile" ;;
    whatsapp) send_whatsapp "$profile" ;;
    *) ;;
  esac
done

printf '%s\n' "$now_epoch" > "$state_file"
