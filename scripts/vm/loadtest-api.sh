#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://api-pingpongpaidegua.duckdns.org}"
EVENT_ID="${EVENT_ID:-43}"
DURATION="${DURATION:-30s}"
VUS="${VUS:-500}"

SCRIPT="$(mktemp)"
trap 'rm -f "$SCRIPT"' EXIT

cat >"$SCRIPT" <<'K6'
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500'],
  },
};

const base = __ENV.BASE_URL;
const eventId = __ENV.EVENT_ID;

export default function () {
  const pick = Math.random();
  let url = `${base}/events/${eventId}`;
  if (pick < 0.15) {
    url = `${base}/events/${eventId}/efficiency`;
  } else if (pick < 0.30) {
    url = `${base}/events/${eventId}/medalists`;
  } else if (pick < 0.45) {
    url = `${base}/events/${eventId}/athletes?page=1&pageSize=100`;
  }

  const res = http.get(url, { timeout: '10s' });
  check(res, {
    'status is 2xx/3xx/429': (r) => (r.status >= 200 && r.status < 400) || r.status === 429,
  });
  sleep(0.2);
}
K6

docker run --rm --network host \
  -v "$SCRIPT:/tmp/loadtest.js:ro" \
  -e BASE_URL="$BASE_URL" \
  -e EVENT_ID="$EVENT_ID" \
  grafana/k6 run \
  --vus "$VUS" \
  --duration "$DURATION" \
  /tmp/loadtest.js
