#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:8403}"
LLM_BASE="${LLM_BASE:-http://localhost:8000}"
KEY="${API_KEY:?API_KEY env required}"
LLM_KEY="${LLM_API_KEY:-$KEY}"
TIMEOUT="${TIMEOUT:-10}"
CHECK_RATE_LIMIT="${CHECK_RATE_LIMIT:-0}"
RUN_ID="${RUN_ID:-$(date +%s)}"

BASE="${BASE%/}"
LLM_BASE="${LLM_BASE%/}"

for cmd in curl python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "missing required command: $cmd" >&2
    exit 1
  fi
done

CLEANUP_MEMBER_ID=""
CLEANUP_RATE_MEMBER_ID=""

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

request() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  shift 3 || true

  local output_file
  output_file="$(mktemp)"
  local -a curl_args=(
    -sS
    -m "$TIMEOUT"
    -X "$method"
    -H "Accept: application/json"
    -o "$output_file"
    -w "%{http_code}"
  )

  local header
  for header in "$@"; do
    curl_args+=(-H "$header")
  done

  if [[ -n "$body" ]]; then
    curl_args+=(-H "Content-Type: application/json" --data "$body")
  fi

  local status
  status="$(curl "${curl_args[@]}" "$url")" || {
    rm -f "$output_file"
    return 1
  }

  printf '%s\n' "$status"
  cat "$output_file"
  rm -f "$output_file"
}

response_status() {
  printf '%s\n' "$1" | sed -n '1p'
}

response_body() {
  printf '%s\n' "$1" | tail -n +2
}

json_extract() {
  local json_text="$1"
  local python_expr="$2"
  printf '%s' "$json_text" | python3 -c "import json, sys; data = json.load(sys.stdin); ${python_expr}"
}

cleanup_member() {
  local member_id="$1"
  local key_suffix="$2"
  if [[ -z "$member_id" ]]; then
    return 0
  fi

  local delete_resp
  if ! delete_resp="$(request DELETE "$BASE/api/members/$member_id" "" "X-API-Key: $KEY" "Idempotency-Key: cleanup-$key_suffix-$member_id")"; then
    echo "WARN: cleanup transport error for member_id=$member_id" >&2
    return 0
  fi

  local delete_status
  delete_status="$(response_status "$delete_resp")"
  if [[ "$delete_status" == "200" || "$delete_status" == "400" ]]; then
    return 0
  fi

  echo "WARN: cleanup got status=$delete_status for member_id=$member_id body=$(response_body "$delete_resp")" >&2
}

cleanup_all() {
  cleanup_member "$CLEANUP_MEMBER_ID" "$RUN_ID"
  cleanup_member "$CLEANUP_RATE_MEMBER_ID" "$RUN_ID-rate"
}

trap cleanup_all EXIT

echo "=== Smoke Test ==="
echo "BASE=$BASE"
echo "LLM_BASE=$LLM_BASE"

ready_resp="$(request GET "$BASE/ready")" || fail "GET /ready transport error"
ready_status="$(response_status "$ready_resp")"
ready_body="$(response_body "$ready_resp")"
[[ "$ready_status" == "200" ]] || fail "GET /ready returned $ready_status body=$ready_body"
printf '%s' "$ready_body" | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data.get("status") == "ok", data'
pass "dashboard /ready"

health_resp="$(request GET "$BASE/health")" || fail "GET /health transport error"
health_status="$(response_status "$health_resp")"
health_body="$(response_body "$health_resp")"
[[ "$health_status" == "200" ]] || fail "GET /health returned $health_status body=$health_body"
printf '%s' "$health_body" | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data.get("status") == "ok", data'
pass "dashboard /health"

llm_health_resp="$(request GET "$LLM_BASE/health")" || fail "GET llm-gateway /health transport error"
llm_health_status="$(response_status "$llm_health_resp")"
llm_health_body="$(response_body "$llm_health_resp")"
[[ "$llm_health_status" == "200" ]] || fail "GET llm-gateway /health returned $llm_health_status body=$llm_health_body"
printf '%s' "$llm_health_body" | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data.get("status") == "ok", data'
pass "llm-gateway /health"

snapshot_resp="$(request GET "$BASE/api/dashboard/snapshot?range=7d" "" "X-API-Key: $KEY")" || fail "GET /api/dashboard/snapshot transport error"
snapshot_status="$(response_status "$snapshot_resp")"
snapshot_body="$(response_body "$snapshot_resp")"
[[ "$snapshot_status" == "200" ]] || fail "GET /api/dashboard/snapshot returned $snapshot_status body=$snapshot_body"
printf '%s' "$snapshot_body" | python3 -c 'import json,sys; data=json.load(sys.stdin); missing=[k for k in ("highlights","charts","aggs","ops_trend","members","wallet","transactions","audit_log") if k not in data]; assert not missing, missing'
pass "dashboard snapshot endpoint"

member_phone="smoke-${RUN_ID}"
member_body="$(printf '{"name":"Smoke Sentinel %s","phone_number":"%s","role":"member","initial_balance":0}' "$RUN_ID" "$member_phone")"
idem_key="smoke-idem-$RUN_ID"

first_resp="$(request POST "$BASE/api/members" "$member_body" "X-API-Key: $KEY" "Idempotency-Key: $idem_key")" || fail "POST /api/members first request transport error"
first_status="$(response_status "$first_resp")"
first_body="$(response_body "$first_resp")"
[[ "$first_status" == "200" ]] || fail "POST /api/members first request returned $first_status body=$first_body"
CLEANUP_MEMBER_ID="$(json_extract "$first_body" 'print(data.get("id", ""))' 2>/dev/null || true)"

second_resp="$(request POST "$BASE/api/members" "$member_body" "X-API-Key: $KEY" "Idempotency-Key: $idem_key")" || fail "POST /api/members second request transport error"
second_status="$(response_status "$second_resp")"
second_body="$(response_body "$second_resp")"

if [[ "$second_status" == "200" ]]; then
  [[ "$first_body" == "$second_body" ]] || fail "idempotency failed: second 200 response body differs from first body"
elif [[ "$second_status" != "409" ]]; then
  fail "idempotency failed: unexpected second status=$second_status body=$second_body"
fi
pass "idempotency on POST /api/members"

if [[ "$CHECK_RATE_LIMIT" == "1" ]]; then
  rate_phone="rate-${RUN_ID}"
  rate_body="$(printf '{"name":"Rate Limit Sentinel %s","phone_number":"%s","role":"member","initial_balance":0}' "$RUN_ID" "$rate_phone")"
  rate_key="smoke-rate-limit-$RUN_ID"
  seen_429=0

  for ((i = 1; i <= 61; i++)); do
    rate_resp="$(request POST "$BASE/api/members" "$rate_body" "X-API-Key: $KEY" "Idempotency-Key: $rate_key")" || fail "rate-limit transport error at request $i"
    rate_status="$(response_status "$rate_resp")"
    rate_resp_body="$(response_body "$rate_resp")"

    if [[ "$i" == "1" && -z "$CLEANUP_RATE_MEMBER_ID" ]]; then
      CLEANUP_RATE_MEMBER_ID="$(json_extract "$rate_resp_body" 'print(data.get("id", ""))' 2>/dev/null || true)"
    fi

    if [[ "$rate_status" == "429" ]]; then
      seen_429=1
      break
    fi

    [[ "$rate_status" == "200" ]] || fail "rate-limit precondition failed at request $i: status=$rate_status body=$rate_resp_body"
  done

  [[ "$seen_429" == "1" ]] || fail "expected at least one 429 by request 61 when CHECK_RATE_LIMIT=1"
  pass "optional rate limit check"
else
  echo "SKIP: optional rate limit check (set CHECK_RATE_LIMIT=1 to enable)"
fi

echo "=== All smoke checks passed ==="
