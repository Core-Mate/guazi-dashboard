#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

source dashboard/e2e/env.sh

RUN_ID="${RUN_ID:-$(date -u +'%Y%m%dT%H%M%SZ')}"
REPORT_DIR="dashboard/e2e/reports/$RUN_ID"
REPORT="$REPORT_DIR/api-smoke.md"
mkdir -p "$REPORT_DIR"

for cmd in curl jq python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf '[e2e] missing required command: %s\n' "$cmd" >&2
    exit 1
  fi
done

INFRA_ERROR=0
TIMEOUT="${E2E_API_TIMEOUT:-15}"
BASE_URL="${E2E_API_BASE%/}"
AUTH_HEADER="X-API-Key: $E2E_API_KEY"

escape_md() {
  printf '%s' "$1" | sed 's/|/\\|/g'
}

write_row() {
  local check="$1"
  local result="$2"
  local detail="$3"
  printf '| %s | %s | %s |\n' "$(escape_md "$check")" "$result" "$(escape_md "$detail")" >>"$REPORT"
}

request_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local idempotency_key="${4:-}"
  local output_file
  output_file="$(mktemp)"
  local curl_args=(
    -sS
    -m "$TIMEOUT"
    -H "$AUTH_HEADER"
    -H "Accept: application/json"
    -o "$output_file"
    -w "%{http_code} %{time_total}"
    -X "$method"
  )

  if [[ -n "$body" ]]; then
    curl_args+=(-H "Content-Type: application/json" --data "$body")
  fi
  if [[ -n "$idempotency_key" ]]; then
    curl_args+=(-H "Idempotency-Key: $idempotency_key")
  fi

  local response_meta
  if ! response_meta="$(curl "${curl_args[@]}" "$BASE_URL$path")"; then
    rm -f "$output_file"
    return 90
  fi

  local status time_total
  status="${response_meta%% *}"
  time_total="${response_meta##* }"
  local response_body
  response_body="$(cat "$output_file")"
  rm -f "$output_file"

  printf '%s\n%s\n%s\n' "$status" "$time_total" "$response_body"
}

cleanup_member() {
  local member_id="$1"
  if [[ -z "$member_id" || "$member_id" == "null" ]]; then
    return 0
  fi

  local delete_key="cleanup-$RUN_ID-$member_id"
  local delete_response
  if ! delete_response="$(request_json DELETE "/api/members/$member_id" "" "$delete_key")"; then
    write_row "Cleanup DELETE /api/members/$member_id" "⚠️" "transport error while cleaning test member"
    return 0
  fi

  local delete_status delete_time delete_body
  delete_status="$(printf '%s\n' "$delete_response" | sed -n '1p')"
  delete_time="$(printf '%s\n' "$delete_response" | sed -n '2p')"
  delete_body="$(printf '%s\n' "$delete_response" | tail -n +3)"
  if [[ "$delete_status" == "200" ]]; then
    write_row "Cleanup DELETE /api/members/$member_id" "✅" "deleted in ${delete_time}s"
  else
    write_row "Cleanup DELETE /api/members/$member_id" "⚠️" "status=$delete_status body=${delete_body:-<empty>}"
  fi
}

{
  printf '# API Smoke\n\n'
  printf -- '- Run ID: `%s`\n' "$RUN_ID"
  printf -- '- Generated: `%s`\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf -- '- API Base: `%s`\n' "$BASE_URL"
  printf -- '- Tenant: `%s`\n\n' "$E2E_TENANT_ID"
  printf '| Check | Result | Detail |\n'
  printf '| --- | --- | --- |\n'
} >"$REPORT"

test1_status="✅"
test1_detail=""
for range in today yesterday 7d 30d; do
  if ! resp="$(request_json GET "/api/dashboard/snapshot?range=$range")"; then
    INFRA_ERROR=1
    write_row "GET /api/dashboard/snapshot?range=$range" "❌" "transport error"
    continue
  fi

  status="$(printf '%s\n' "$resp" | sed -n '1p')"
  time_total="$(printf '%s\n' "$resp" | sed -n '2p')"
  body="$(printf '%s\n' "$resp" | tail -n +3)"
  has_success="$(printf '%s' "$body" | jq -r 'if ((.charts.mini_stats.success_count? != null) or ([.highlights.cards[]?.key] | index("successCount") != null)) then "yes" else "no" end' 2>/dev/null || printf 'no')"

  if [[ "$status" != "200" ]]; then
    write_row "GET /api/dashboard/snapshot?range=$range" "❌" "status=$status body=${body:-<empty>}"
    test1_status="❌"
  elif [[ "$has_success" != "yes" ]]; then
    write_row "GET /api/dashboard/snapshot?range=$range" "⚠️" "status=200 but success metric missing (${time_total}s)"
    [[ "$test1_status" == "✅" ]] && test1_status="⚠️"
  else
    write_row "GET /api/dashboard/snapshot?range=$range" "✅" "status=200 success metric present (${time_total}s)"
  fi
done

for endpoint in highlights charts aggs ops_trend; do
  if ! resp="$(request_json GET "/api/dashboard/$endpoint?range=7d")"; then
    INFRA_ERROR=1
    write_row "GET /api/dashboard/$endpoint?range=7d" "❌" "transport error"
    continue
  fi

  status="$(printf '%s\n' "$resp" | sed -n '1p')"
  time_total="$(printf '%s\n' "$resp" | sed -n '2p')"
  body="$(printf '%s\n' "$resp" | tail -n +3)"

  if [[ "$status" == "200" ]]; then
    write_row "GET /api/dashboard/$endpoint?range=7d" "✅" "status=200 (${time_total}s)"
  else
    write_row "GET /api/dashboard/$endpoint?range=7d" "❌" "status=$status body=${body:-<empty>}"
  fi
done

for path in "/api/transactions?page=1&page_size=10" "/api/audit-log?page=1&page_size=10"; do
  if ! resp="$(request_json GET "$path")"; then
    INFRA_ERROR=1
    write_row "GET $path" "❌" "transport error"
    continue
  fi

  status="$(printf '%s\n' "$resp" | sed -n '1p')"
  time_total="$(printf '%s\n' "$resp" | sed -n '2p')"
  body="$(printf '%s\n' "$resp" | tail -n +3)"

  if [[ "$status" == "200" ]]; then
    write_row "GET $path" "✅" "status=200 (${time_total}s)"
  else
    write_row "GET $path" "❌" "status=$status body=${body:-<empty>}"
  fi
done

member_body='{"name":"E2E Idempotency Sentinel","phone_number":"99999999990","initial_balance":0}'
member_key="member-$RUN_ID"
member_id=""
if ! first_resp="$(request_json POST "/api/members" "$member_body" "$member_key")"; then
  INFRA_ERROR=1
  write_row "POST /api/members idempotency" "❌" "transport error on first request"
else
  first_status="$(printf '%s\n' "$first_resp" | sed -n '1p')"
  first_time="$(printf '%s\n' "$first_resp" | sed -n '2p')"
  first_body="$(printf '%s\n' "$first_resp" | tail -n +3)"
  member_id="$(printf '%s' "$first_body" | jq -r '.id // empty' 2>/dev/null || true)"

  if [[ "$first_status" != "200" ]]; then
    write_row "POST /api/members idempotency" "❌" "first status=$first_status body=${first_body:-<empty>}"
  elif ! second_resp="$(request_json POST "/api/members" "$member_body" "$member_key")"; then
    INFRA_ERROR=1
    write_row "POST /api/members idempotency" "❌" "transport error on second request"
  else
    second_status="$(printf '%s\n' "$second_resp" | sed -n '1p')"
    second_time="$(printf '%s\n' "$second_resp" | sed -n '2p')"
    second_body="$(printf '%s\n' "$second_resp" | tail -n +3)"
    if [[ "$second_status" == "200" && "$first_body" == "$second_body" ]]; then
      write_row "POST /api/members idempotency" "✅" "identical responses (${first_time}s, ${second_time}s)"
    else
      write_row "POST /api/members idempotency" "⚠️" "first=$first_status second=$second_status first_body=${first_body:-<empty>} second_body=${second_body:-<empty>}"
    fi
  fi
fi

cleanup_member "$member_id"

if ! warm_resp="$(request_json GET "/api/dashboard/snapshot?range=7d")"; then
  INFRA_ERROR=1
  write_row "Cache hit timing snapshot?range=7d" "❌" "transport error on warm request"
elif ! cached_resp="$(request_json GET "/api/dashboard/snapshot?range=7d")"; then
  INFRA_ERROR=1
  write_row "Cache hit timing snapshot?range=7d" "❌" "transport error on cached request"
else
  warm_status="$(printf '%s\n' "$warm_resp" | sed -n '1p')"
  warm_time="$(printf '%s\n' "$warm_resp" | sed -n '2p')"
  cached_status="$(printf '%s\n' "$cached_resp" | sed -n '1p')"
  cached_time="$(printf '%s\n' "$cached_resp" | sed -n '2p')"
  cached_ms="$(python3 - "$cached_time" <<'PY'
import sys
print(int(float(sys.argv[1]) * 1000))
PY
)"

  if [[ "$warm_status" != "200" || "$cached_status" != "200" ]]; then
    write_row "Cache hit timing snapshot?range=7d" "❌" "warm=$warm_status cached=$cached_status"
  elif (( cached_ms < 200 )); then
    write_row "Cache hit timing snapshot?range=7d" "✅" "warm=${warm_time}s cached=${cached_time}s (${cached_ms}ms)"
  else
    write_row "Cache hit timing snapshot?range=7d" "⚠️" "warm=${warm_time}s cached=${cached_time}s (${cached_ms}ms)"
  fi
fi

cat "$REPORT"

if [[ "$INFRA_ERROR" -eq 1 ]]; then
  exit 1
fi

exit 0
