#!/usr/bin/env bash
# Offline operator smoke for the one-VPS Node + SQLite process. It exercises
# the documented fixture journey and deliberately makes zero provider calls.
# Live Waffo checkout/webhook setup belongs to the deployment runbook.
set -euo pipefail

# The smoke owns its listener boundary. Never let a caller's host value affect
# setup, URL construction, or the fixture child; the child is fixed explicitly
# to loopback below.
unset LISTEN_HOST || true

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  fail "live-smoke must not run in GitHub Actions"
fi
if [[ "${CI:-}" == "true" && "${LIVE_SMOKE_ALLOW_CI:-}" != "1" ]]; then
  fail "live-smoke refuses CI=true"
fi
command -v curl >/dev/null || fail "curl is required"
command -v node >/dev/null || fail "node is required"
[[ -d node_modules ]] || fail "node_modules is required; install dependencies before the offline smoke"

# This script is intentionally fixture-only. A caller that asks for a live
# mode gets a successful, explicit no-call result before any process or DB is
# created; an unknown mode is a configuration error rather than a fallback.
requested_mode="${WAFFO_MODE:-fixture}"
case "$requested_mode" in
  fixture) ;;
  waffo-test|waffo-prod)
    echo "PASS-ERROR: WAFFO_MODE=${requested_mode}; offline smoke refused live provider calls"
    exit 0
    ;;
  *)
    fail "unsupported WAFFO_MODE=${requested_mode} (use fixture, waffo-test, or waffo-prod)"
    ;;
esac

if [[ -n "${LIVE_SMOKE_BASE:-}" ]]; then
  fail "LIVE_SMOKE_BASE is unsupported; the offline smoke owns its isolated fixture server"
fi

# Validate an operator-supplied port before it can participate in URL
# construction or reach curl. A bounded decimal-only value also keeps the
# child server's PORT input and the HTTP authority identical.
if [[ "${LIVE_SMOKE_PORT+x}" == "x" ]]; then
  if [[ ! "$LIVE_SMOKE_PORT" =~ ^[0-9]{1,5}$ ]]; then
    fail "LIVE_SMOKE_PORT must be a pure decimal integer from 1 to 65535"
  fi
  port=$((10#$LIVE_SMOKE_PORT))
  if (( port < 1 || port > 65535 )); then
    fail "LIVE_SMOKE_PORT must be a pure decimal integer from 1 to 65535"
  fi
else
  port=""
fi

smoke_dir="$(mktemp -d "${TMPDIR:-/tmp}/podcast-guest-seat-live-smoke.XXXXXX")"
server_pid=""
base=""
host_secret="${HOST_SESSION_SECRET:-live-smoke-host}"
pass_count=0
pass_error_count=0
fail_count=0

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$smoke_dir"
}
trap cleanup EXIT

record() {
  local flow="$1"
  local status="$2"
  local note="${3:-}"
  printf 'RESULT\t%s\t%s\t%s\n' "$flow" "$status" "$note"
  case "$status" in
    PASS) pass_count=$((pass_count + 1)) ;;
    PASS-ERROR) pass_error_count=$((pass_error_count + 1)) ;;
    FAIL) fail_count=$((fail_count + 1)) ;;
    *) fail "unknown smoke status ${status}" ;;
  esac
}

pick_port() {
  node --input-type=module -e '
    import net from "node:net";
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") process.exit(1);
      process.stdout.write(String(address.port));
      server.close();
    });
  '
}

wait_health() {
  local target="$1/healthz"
  local attempt
  for attempt in $(seq 1 80); do
    if curl -fsS --connect-timeout 2 --max-time 5 "$target" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

http_get() {
  local path="$1"
  local output="$2"
  curl -sS -o "$output" -w '%{http_code}' --connect-timeout 5 --max-time 20 \
    "$base$path"
}

http_get_headers() {
  local path="$1"
  local output="$2"
  local headers="$3"
  curl -sS -D "$headers" -o "$output" -w '%{http_code}' \
    --connect-timeout 5 --max-time 20 --max-redirs 0 "$base$path"
}

http_post_json() {
  local path="$1"
  local payload="$2"
  local output="$3"
  local headers="$4"
  shift 4
  curl -sS -D "$headers" -o "$output" -w '%{http_code}' \
    --connect-timeout 5 --max-time 20 --max-redirs 0 \
    -X POST -H 'content-type: application/json' -H 'accept: application/json' \
    "$@" --data "$payload" "$base$path"
}

header_value() {
  local file="$1"
  local name="$2"
  awk -v wanted="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" '
    BEGIN { FS = ": " }
    tolower($1) == wanted {
      value = $0
      sub(/^[^:]+:[ \t]*/, "", value)
      gsub(/\r/, "", value)
      print value
      exit
    }
  ' "$file"
}

json_field() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    let value;
    try {
      const body = JSON.parse(readFileSync(process.argv[1], "utf8"));
      value = body?.[process.argv[2]];
    } catch {
      process.exit(2);
    }
    if (value === undefined || value === null) process.exit(3);
    if (["string", "number", "boolean"].includes(typeof value)) {
      process.stdout.write(String(value));
    } else {
      process.stdout.write(JSON.stringify(value));
    }
  ' "$1" "$2"
}

row_attr() {
  local file="$1"
  local name="$2"
  local attribute="$3"
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    const name = process.argv[2];
    const attribute = process.argv[3];
    const rows = [...html.matchAll(/<li\b[^>]*data-listing-id="[^"]+"[\s\S]*?<\/li>/g)]
      .map((match) => match[0]);
    const row = rows.find((candidate) => candidate.includes(name));
    if (!row) process.exit(2);
    const match = row.match(new RegExp(`data-${attribute}="([^"]*)"`));
    if (!match) process.exit(3);
    process.stdout.write(match[1]);
  ' "$file" "$name" "$attribute"
}

row_for_name() {
  local file="$1"
  local name="$2"
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    const name = process.argv[2];
    const rows = [...html.matchAll(/<li\b[^>]*data-listing-id="[^"]+"[\s\S]*?<\/li>/g)]
      .map((match) => match[0]);
    const row = rows.find((candidate) => candidate.includes(name));
    if (!row) process.exit(2);
    process.stdout.write(row);
  ' "$file" "$name"
}

row_clicks() {
  local file="$1"
  local name="$2"
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    const name = process.argv[2];
    const rows = [...html.matchAll(/<li\b[^>]*data-listing-id="[^"]+"[\s\S]*?<\/li>/g)]
      .map((match) => match[0]);
    const row = rows.find((candidate) => candidate.includes(name));
    if (!row) process.exit(2);
    const match = row.match(/class="clicks"[^>]*>([0-9]+) clicks/);
    if (!match) process.exit(3);
    process.stdout.write(match[1]);
  ' "$file" "$name"
}

html_has() {
  local file="$1"
  local text="$2"
  grep -F -q -- "$text" "$file"
}

assert_status() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  [[ "$actual" == "$expected" ]] || fail "$label (HTTP ${actual}, expected ${expected})"
}

stamp="$(date -u +%Y%m%d%H%M%S)"
episode_id="ep_smoke_${stamp}"
ada_name="Smoke Ada ${stamp}"
twelve_name="Smoke Twelve ${stamp}"
ada_url="https://ada-${stamp}.example/guest"
twelve_url="https://twelve-${stamp}.example/seat"

if [[ -z "$port" ]]; then
  port="$(pick_port)"
fi
base="http://127.0.0.1:${port}"
db_path="${smoke_dir}/guest-seat.sqlite"
server_log="${smoke_dir}/server.log"

seed_json="$(node --import tsx --input-type=module -e '
  import { openDatabase } from "./src/db.ts";
  import { createEpisode } from "./src/episodes.ts";
  const db = openDatabase(process.argv[1]);
  const episode = createEpisode(db, {
    id: process.argv[2],
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: new Date().toISOString(),
  });
  process.stdout.write(JSON.stringify({
    id: episode.id,
    seatKind: episode.seatKind,
    vetoEnabled: episode.vetoEnabled,
  }));
  db.close();
' "$db_path" "$episode_id")"
[[ "$(json_field <(printf '%s' "$seed_json") seatKind)" == "guest_seat" ]] \
  || fail "seeded episode is not guest_seat"
[[ "$(json_field <(printf '%s' "$seed_json") vetoEnabled)" == "true" ]] \
  || fail "guest-seat episode did not default host veto on"
[[ -f "$db_path" ]] || fail "fixture seed did not create the isolated SQLite database"

# Keep every provider selector/credential out of the local process. Also clear
# deployment markers so a caller's production shell cannot turn the offline
# fixture into a live startup.
(
  unset NODE_ENV VERCEL_ENV APP_ENV DEPLOY_ENV BUILD_ENV \
    WAFFO_MODE WAFFO_LIVE WAFFO_MERCHANT_ID WAFFO_PRIVATE_KEY \
    WAFFO_PRIVATE_KEY_FILE WAFFO_STORE_ID WAFFO_PRODUCT_ID \
    WAFFO_PUBLIC_BASE_URL WAFFO_API_BASE WAFFO_TEST_WEBHOOK_PUBLIC_KEY \
    WAFFO_PROD_WEBHOOK_PUBLIC_KEY WAFFO_WEBHOOK_PUBLIC_KEY DATABASE_PATH || true
  export WAFFO_MODE=fixture
  export LISTEN_HOST=127.0.0.1
  export PORT="$port" DATABASE_PATH="$db_path" HOST_SESSION_SECRET="$host_secret"
  exec node --import tsx src/server.ts
) >"$server_log" 2>&1 &
server_pid=$!

if ! wait_health "$base"; then
  sed -n '1,160p' "$server_log" >&2 || true
  fail "fixture server did not become healthy at ${base}/healthz"
fi

# Fastify logs the actual listener URLs. Keep this evidence in the smoke
# output so a regression test can prove inherited/malformed LISTEN_HOST values
# did not move the fixture process off loopback.
listener_urls="$(grep -F 'Server listening at http://' "$server_log" || true)"
[[ -n "$listener_urls" ]] || fail "fixture server log omitted its listener URL"
if printf '%s\n' "$listener_urls" | grep -Fv -q "Server listening at http://127.0.0.1:${port}"; then
  fail "fixture server logged a non-loopback listener"
fi
echo "LISTENER PASS: fixture child bound only to 127.0.0.1:${port}"

health_body="${smoke_dir}/healthz.json"
health_code="$(http_get /healthz "$health_body" || true)"
assert_status "$health_code" 200 "GET /healthz"
html_has "$health_body" '"ok":true' || fail "healthz did not return { ok: true }"

# list: a new local fixture board starts empty and does not invent a bidder.
board_empty="${smoke_dir}/board-empty.html"
board_empty_code="$(http_get / "$board_empty" || true)"
assert_status "$board_empty_code" 200 "GET /"
html_has "$board_empty" 'data-empty-board' || fail "empty fixture board missing data-empty-board"
html_has "$board_empty" 'No paid listings on this episode yet' \
  || fail "empty fixture board missing honest no-paid copy"
html_has "$board_empty" 'data-empty-window' \
  || fail "empty fixture board missing rolling-window marker"
! html_has "$board_empty" 'data-listing-id=' \
  || fail "empty fixture board contains an invented listing"
html_has "$board_empty" "value=\"${episode_id}\"" \
  || fail "fixture server is not serving the isolated seeded episode"
html_has "$board_empty" 'data-seat-kind="guest_seat"' \
  || fail "board did not identify the guest-seat lane"
record list PASS "GET / 200; explicit fixture; no invented paid row"

# bid: minimum $5 is enforced, and an unpaid checkout never appears publicly.
bid4_body="${smoke_dir}/bid4.json"
bid4_headers="${smoke_dir}/bid4.headers"
bid4_payload="{\"episodeId\":\"${episode_id}\",\"name\":\"${ada_name}\",\"siteUrl\":\"${ada_url}?utm_source=smoke\",\"oneLiner\":\"Notes on the analytical engine.\",\"bidUsd\":4}"
bid4_code="$(http_post_json /checkout "$bid4_payload" "$bid4_body" "$bid4_headers" || true)"
bid4_error="$(json_field "$bid4_body" error || true)"
assert_status "$bid4_code" 400 "POST /checkout \$4"
[[ "$bid4_error" == "min_bid" ]] || fail "\$4 rejection was ${bid4_error:-missing error}"

bid5_body="${smoke_dir}/bid5.json"
bid5_headers="${smoke_dir}/bid5.headers"
bid5_payload="{\"episodeId\":\"${episode_id}\",\"name\":\"${ada_name}\",\"siteUrl\":\"${ada_url}?utm_source=smoke\",\"oneLiner\":\"Notes on the analytical engine.\",\"bidUsd\":5}"
bid5_code="$(http_post_json /checkout "$bid5_payload" "$bid5_body" "$bid5_headers" || true)"
assert_status "$bid5_code" 200 "POST /checkout \$5"
bid5_id="$(json_field "$bid5_body" checkoutId || true)"
bid5_url="$(json_field "$bid5_body" url || true)"
bid5_kind="$(json_field "$bid5_body" kind || true)"
bid5_charge="$(json_field "$bid5_body" chargeUsd || true)"
[[ -n "$bid5_id" && "$bid5_kind" == "open" && "$bid5_charge" == "5" ]] \
  || fail "fixture \$5 checkout omitted its open/\$5 contract"
[[ "$bid5_url" == /checkout/complete\?checkoutId=* ]] \
  || fail "fixture checkout did not return its local completion URL"
board_unpaid="${smoke_dir}/board-unpaid.html"
http_get / "$board_unpaid" >/dev/null || true
! html_has "$board_unpaid" "$ada_name" || fail "unpaid guest appeared on the board"
record bid PASS "\$4 → 400 min_bid; \$5 remains unranked until fixture completion"

# checkout: the explicit fixture completion claims Ada, strips tracking, and
# renders the current rolling-window invariant in occupied state.
complete_body="${smoke_dir}/complete.body"
complete_headers="${smoke_dir}/complete.headers"
complete_code="$(http_get_headers "/checkout/complete?checkoutId=${bid5_id}" "$complete_body" "$complete_headers" || true)"
complete_location="$(header_value "$complete_headers" location || true)"
assert_status "$complete_code" 303 "GET /checkout/complete fixture"
[[ "$complete_location" == "/" ]] || fail "fixture completion redirected to ${complete_location:-missing}"

board_paid="${smoke_dir}/board-paid.html"
board_paid_code="$(http_get / "$board_paid" || true)"
assert_status "$board_paid_code" 200 "GET / after fixture payment"
ada_row="$(row_for_name "$board_paid" "$ada_name" || true)"
[[ -n "$ada_row" ]] || fail "paid fixture guest missing from board"
ada_id="$(row_attr "$board_paid" "$ada_name" listing-id || true)"
ada_rank="$(row_attr "$board_paid" "$ada_name" rank || true)"
ada_clicks="$(row_clicks "$board_paid" "$ada_name" || true)"
[[ "$ada_rank" == "1" && "$ada_clicks" == "0" && -n "$ada_id" ]] \
  || fail "paid fixture guest rank=${ada_rank:-missing} clicks=${ada_clicks:-missing}"
! html_has "$board_paid" 'utm_source' || fail "tracking query leaked into board HTML"
html_has "$board_paid" 'data-paid-at=' || fail "paid fixture row missing paid-at marker"
html_has "$board_paid" 'data-rolling-week=' || fail "occupied board missing rolling-week marker"
html_has "$board_paid" 'class="week-window"' || fail "occupied board missing week-window copy"
html_has "$board_paid" 'Paid placements remain eligible for seven days' \
  || fail "occupied board missing current seven-day invariant"
html_has "$board_paid" 'does not reset at Monday midnight' \
  || fail "occupied board missing non-civil-window invariant"
record checkout PASS "fixture completion → Ada #1 at \$5; paid-only rank and rolling window visible"

# rank: a second completed fixture bid at $12 outranks the $5 placement.
twelve_body="${smoke_dir}/twelve.json"
twelve_headers="${smoke_dir}/twelve.headers"
twelve_payload="{\"episodeId\":\"${episode_id}\",\"name\":\"${twelve_name}\",\"siteUrl\":\"${twelve_url}\",\"oneLiner\":\"Opened at twelve.\",\"bidUsd\":12}"
twelve_code="$(http_post_json /checkout "$twelve_payload" "$twelve_body" "$twelve_headers" || true)"
assert_status "$twelve_code" 200 "POST /checkout \$12"
twelve_id="$(json_field "$twelve_body" checkoutId || true)"
[[ -n "$twelve_id" ]] || fail "\$12 fixture checkout omitted checkoutId"
twelve_complete_body="${smoke_dir}/twelve-complete.body"
twelve_complete_headers="${smoke_dir}/twelve-complete.headers"
twelve_complete_code="$(http_get_headers "/checkout/complete?checkoutId=${twelve_id}" "$twelve_complete_body" "$twelve_complete_headers" || true)"
assert_status "$twelve_complete_code" 303 "GET /checkout/complete \$12 fixture"

board_ranked="${smoke_dir}/board-ranked.html"
board_ranked_code="$(http_get / "$board_ranked" || true)"
assert_status "$board_ranked_code" 200 "GET / ranked board"
twelve_rank="$(row_attr "$board_ranked" "$twelve_name" rank || true)"
ada_rank="$(row_attr "$board_ranked" "$ada_name" rank || true)"
twelve_listing_id="$(row_attr "$board_ranked" "$twelve_name" listing-id || true)"
[[ "$twelve_rank" == "1" && "$ada_rank" == "2" ]] \
  || fail "rank order was ${twelve_name}=${twelve_rank:-missing}, ${ada_name}=${ada_rank:-missing}"
[[ -n "$twelve_listing_id" ]] || fail "ranked Twelve row omitted listing id"
record rank PASS "\$12 is #1; Ada \$5 is #2; rank follows the bid"

# click: /go increments only a paid row and forwards the canonical URL without
# the query string supplied to the redirect request.
click_body="${smoke_dir}/click.body"
click_headers="${smoke_dir}/click.headers"
click_code="$(http_get_headers "/go/${ada_id}?utm_source=injected" "$click_body" "$click_headers" || true)"
click_location="$(header_value "$click_headers" location || true)"
assert_status "$click_code" 302 "GET /go/:listingId"
[[ "$click_location" == "$ada_url" ]] || fail "click forwarded ${click_location:-missing}, expected ${ada_url}"
[[ "$click_location" != *\?* && "$click_location" != *#* ]] \
  || fail "click redirect retained query or fragment"
board_clicked="${smoke_dir}/board-clicked.html"
http_get / "$board_clicked" >/dev/null || true
ada_clicks="$(row_clicks "$board_clicked" "$ada_name" || true)"
[[ "$ada_clicks" == "1" ]] || fail "public click count was ${ada_clicks:-missing}, expected 1"
record click PASS "302 to stripped site URL; Ada clicks 0→1"

# veto: host review is on by default for guest seat. Vetoed #1 stays visible,
# loses its rank, and the next eligible paid listing becomes #1.
veto_body="${smoke_dir}/veto.json"
veto_headers="${smoke_dir}/veto.headers"
veto_payload="{\"episodeId\":\"${episode_id}\",\"listingId\":\"${twelve_listing_id}\",\"reason\":\"hard sell\"}"
veto_code="$(http_post_json /host/veto "$veto_payload" "$veto_body" "$veto_headers" -H "authorization: Bearer ${host_secret}" || true)"
veto_ok="$(json_field "$veto_body" ok || true)"
assert_status "$veto_code" 200 "POST /host/veto"
[[ "$veto_ok" == "true" ]] || fail "host veto did not return ok=true"
board_vetoed="${smoke_dir}/board-vetoed.html"
board_vetoed_code="$(http_get / "$board_vetoed" || true)"
assert_status "$board_vetoed_code" 200 "GET / after host veto"
twelve_vetoed="$(row_attr "$board_vetoed" "$twelve_name" vetoed || true)"
twelve_rank_after="$(row_attr "$board_vetoed" "$twelve_name" rank || true)"
ada_rank_after="$(row_attr "$board_vetoed" "$ada_name" rank || true)"
[[ "$twelve_vetoed" == "true" && -z "$twelve_rank_after" && "$ada_rank_after" == "1" ]] \
  || fail "veto result vetoed=${twelve_vetoed:-missing} Twelve-rank=${twelve_rank_after:-empty} Ada-rank=${ada_rank_after:-missing}"
html_has "$board_vetoed" 'Vetoed: hard sell' || fail "veto reason was not public"
record veto PASS "#1 vetoed; Ada books #1; vetoed Twelve remains visible"

echo
echo "SUMMARY PASS=${pass_count} PASS-ERROR=${pass_error_count} FAIL=${fail_count}"
[[ "$fail_count" -eq 0 ]] || exit 1
echo "PASS: fixture checkout → rank → public click → guest-seat veto (zero provider calls)"
