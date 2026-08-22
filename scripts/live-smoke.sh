#!/usr/bin/env bash
# Operator smoke against a local process. Not called from scripts/test.sh or CI.
# Starts the product process and walks list → bid → rank → Polar fixture or
# live checkout → public click → guest-seat veto.
# Missing Polar secret on the live path is BLOCKED-SECRET with the exact env var.
set -euo pipefail

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

if [[ ! -d node_modules ]]; then
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
fi

PASS=0
PASS_ERROR=0
BLOCKED=0
FAIL=0
STARTED_PID=""
LIVE_PID=""
WORKDIR=""
RESULT_LOG=""
BASE="${LIVE_SMOKE_BASE:-}"

# Capture operator Polar flags before the fixture process unsets them.
OP_POLAR_LIVE="${POLAR_LIVE:-}"
OP_POLAR_ACCESS_TOKEN="${POLAR_ACCESS_TOKEN:-}"
OP_POLAR_WEBHOOK_SECRET="${POLAR_WEBHOOK_SECRET:-}"
HOST_SECRET="${HOST_SESSION_SECRET:-live-smoke-host}"

cleanup() {
  if [[ -n "${LIVE_PID}" ]] && kill -0 "${LIVE_PID}" 2>/dev/null; then
    kill "${LIVE_PID}" 2>/dev/null || true
    wait "${LIVE_PID}" 2>/dev/null || true
  fi
  if [[ -n "${STARTED_PID}" ]] && kill -0 "${STARTED_PID}" 2>/dev/null; then
    kill "${STARTED_PID}" 2>/dev/null || true
    wait "${STARTED_PID}" 2>/dev/null || true
  fi
  if [[ -n "${WORKDIR}" && -d "${WORKDIR}" ]]; then
    rm -rf "${WORKDIR}"
  fi
}
trap cleanup EXIT

record() {
  local flow="$1"
  local status="$2"
  local note="${3:-}"
  printf 'RESULT\t%s\t%s\t%s\n' "$flow" "$status" "$note"
  if [[ -n "${RESULT_LOG}" ]]; then
    printf '%s\t%s\t%s\n' "$flow" "$status" "$note" >>"${RESULT_LOG}"
  fi
  case "$status" in
    PASS) PASS=$((PASS + 1)) ;;
    PASS-ERROR) PASS_ERROR=$((PASS_ERROR + 1)) ;;
    BLOCKED-SECRET) BLOCKED=$((BLOCKED + 1)) ;;
    FAIL) FAIL=$((FAIL + 1)) ;;
    *) fail "unknown smoke status ${status}" ;;
  esac
}

pick_port() {
  node --input-type=module -e '
    import net from "node:net";
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") process.exit(1);
      process.stdout.write(String(addr.port));
      server.close();
    });
  '
}

wait_health() {
  local url="$1/healthz"
  local i
  for i in $(seq 1 80); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

seed_guest_seat() {
  local db_path="$1"
  local episode_id="$2"
  local seed_js="${WORKDIR}/seed-episode.mjs"
  cat >"${seed_js}" <<EOF
import { openDatabase } from "file://${root}/src/db.ts";
import { createEpisode } from "file://${root}/src/episodes.ts";

const db = openDatabase(process.argv[2]);
const episode = createEpisode(db, {
  id: process.argv[3],
  showId: "show_english",
  label: "Episode 12",
  seatKind: "guest_seat",
  opensAt: new Date().toISOString(),
});
process.stdout.write(
  JSON.stringify({ id: episode.id, vetoEnabled: episode.vetoEnabled, seatKind: episode.seatKind }),
);
db.close();
EOF
  node --import tsx "${seed_js}" "${db_path}" "${episode_id}"
}

start_fixture_server() {
  local port="$1"
  local db_path="$2"
  local log_path="$3"
  (
    cd "$root"
    unset POLAR_LIVE POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET || true
    export POLAR_FIXTURE_ONLY=1
    export PORT="${port}"
    export DATABASE_PATH="${db_path}"
    export HOST_SESSION_SECRET="${HOST_SECRET}"
    exec node --import tsx src/server.ts
  ) >"${log_path}" 2>&1 &
  echo $!
}

http_get() {
  local base="$1"
  local path="$2"
  local out="$3"
  curl -sS -o "$out" -w "%{http_code}" --connect-timeout 5 --max-time 20 \
    "${base}${path}"
}

http_get_headers() {
  local base="$1"
  local path="$2"
  local body="$3"
  local hdrs="$4"
  curl -sS -D "$hdrs" -o "$body" -w "%{http_code}" --connect-timeout 5 --max-time 20 \
    --max-redirs 0 \
    "${base}${path}"
}

http_post_json() {
  local base="$1"
  local path="$2"
  local payload="$3"
  local body="$4"
  local hdrs="$5"
  shift 5
  curl -sS -D "$hdrs" -o "$body" -w "%{http_code}" --connect-timeout 5 --max-time 20 \
    --max-redirs 0 \
    -X POST \
    -H "content-type: application/json" \
    -H "accept: application/json" \
    "$@" \
    --data "$payload" \
    "${base}${path}"
}

header_value() {
  local file="$1"
  local name="$2"
  awk -v name="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" '
    BEGIN { FS = ": " }
    tolower($1) == name {
      val = $0
      sub(/^[^:]+:[ \t]*/, "", val)
      gsub(/\r/, "", val)
      print val
      exit
    }
  ' "$file"
}

json_field() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const raw = readFileSync(process.argv[1], "utf8");
    let data;
    try { data = JSON.parse(raw); } catch { process.exit(2); }
    const key = process.argv[2];
    const value = data == null ? undefined : data[key];
    if (value === undefined || value === null) process.exit(3);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      process.stdout.write(String(value));
      process.exit(0);
    }
    process.stdout.write(JSON.stringify(value));
  ' "$1" "$2"
}

html_has() {
  local file="$1"
  local pattern="$2"
  grep -Eq "$pattern" "$file"
}

row_for_name() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    const name = process.argv[2];
    const rows = [...html.matchAll(/<tr data-listing-id="[^"]+"[\s\S]*?<\/tr>/g)].map((m) => m[0]);
    for (const row of rows) {
      if (row.includes(name)) {
        process.stdout.write(row);
        process.exit(0);
      }
    }
    process.exit(2);
  ' "$1" "$2"
}

attr_from_row() {
  local row_html="$1"
  local attr="$2"
  node --input-type=module -e '
    const row = process.argv[1];
    const attr = process.argv[2];
    const match = row.match(new RegExp(`data-${attr}="([^"]*)"`));
    if (!match) process.exit(2);
    process.stdout.write(match[1]);
  ' "$row_html" "$attr"
}

clicks_from_row() {
  node --input-type=module -e '
    const row = process.argv[1];
    const match = row.match(/(\d+) clicks/);
    if (!match) process.exit(2);
    process.stdout.write(match[1]);
  ' "$1"
}

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/podcast-guest-seat-live-smoke.XXXXXX")"
RESULT_LOG="${WORKDIR}/results.tsv"
: >"${RESULT_LOG}"
STAMP="$(date -u +%Y%m%d%H%M%S)"
EPISODE_ID="ep_smoke_${STAMP}"
ADA_NAME="Ada Lovelace ${STAMP}"
TWELVE_NAME="Twelve Co ${STAMP}"
ADA_URL="https://ada-${STAMP}.example/guest"
TWELVE_URL="https://twelve-${STAMP}.example/seat"

echo "== live-smoke (operator only; not CI) =="
echo "root=${root}"

if [[ -z "${BASE}" ]]; then
  PORT="${LIVE_SMOKE_PORT:-$(pick_port)}"
  BASE="http://127.0.0.1:${PORT}"
  DB_PATH="${WORKDIR}/guest-seat.sqlite"
  LOG_PATH="${WORKDIR}/server.log"
  echo "seeding guest-seat episode ${EPISODE_ID} into ${DB_PATH}"
  seed_json="${WORKDIR}/seed.json"
  seed_guest_seat "$DB_PATH" "$EPISODE_ID" >"${seed_json}"
  seed_veto="$(json_field "$seed_json" "vetoEnabled" || true)"
  if [[ "$seed_veto" != "true" ]]; then
    fail "seeded episode must default vetoEnabled true for guest_seat (got ${seed_veto})"
  fi
  echo "starting local fixture server on ${BASE}"
  echo "database=${DB_PATH}"
  STARTED_PID="$(start_fixture_server "$PORT" "$DB_PATH" "$LOG_PATH")"
  if ! wait_health "$BASE"; then
    echo "server log:" >&2
    cat "${LOG_PATH}" >&2 || true
    fail "local server did not become healthy at ${BASE}/healthz"
  fi
else
  BASE="${BASE%/}"
  echo "assuming existing server at ${BASE}"
  if ! wait_health "$BASE"; then
    fail "existing server at ${BASE} did not answer /healthz"
  fi
fi

echo "base=${BASE}"
echo "operator POLAR_LIVE=${OP_POLAR_LIVE:-<unset>}"

# --- healthz (process is up) ---
health_body="${WORKDIR}/healthz.json"
health_code="$(http_get "$BASE" "/healthz" "$health_body" || true)"
if [[ "$health_code" != "200" ]] || ! grep -q '"ok":true' "$health_body"; then
  fail "GET /healthz HTTP ${health_code}"
fi

# --- list: current episode board (empty paid rows is honest) ---
board0="${WORKDIR}/board0.html"
board0_code="$(http_get "$BASE" "/" "$board0" || true)"
if [[ "$board0_code" == "200" ]] \
  && html_has "$board0" 'guest seat' \
  && html_has "$board0" 'default on for guest seat' \
  && html_has "$board0" 'data-empty-board' \
  && html_has "$board0" 'No paid listings on this episode yet' \
  && ! html_has "$board0" 'data-listing-id=' \
  && ! html_has "$board0" "${ADA_NAME}" \
  && ! html_has "$board0" "${TWELVE_NAME}"; then
  record "list" "PASS" "GET / 200 empty guest-seat board; veto default on; no invented listings"
else
  record "list" "FAIL" "GET / HTTP ${board0_code} empty guest-seat list contract broken"
fi

# --- bid: $4 is a documented reject; $5 starts checkout and stays off the board until paid ---
bid4_body="${WORKDIR}/bid4.json"
bid4_hdrs="${WORKDIR}/bid4.hdrs"
bid4_code="$(http_post_json "$BASE" "/checkout" \
  "{\"episodeId\":\"${EPISODE_ID}\",\"name\":\"${ADA_NAME}\",\"siteUrl\":\"${ADA_URL}?utm_source=x\",\"oneLiner\":\"Notes on the analytical engine.\",\"bidUsd\":4}" \
  "$bid4_body" "$bid4_hdrs" || true)"
bid4_err="$(json_field "$bid4_body" "error" || true)"
board_bid4="${WORKDIR}/board-bid4.html"
http_get "$BASE" "/" "$board_bid4" >/dev/null || true

bid5_body="${WORKDIR}/bid5.json"
bid5_hdrs="${WORKDIR}/bid5.hdrs"
bid5_code="$(http_post_json "$BASE" "/checkout" \
  "{\"episodeId\":\"${EPISODE_ID}\",\"name\":\"${ADA_NAME}\",\"siteUrl\":\"${ADA_URL}?utm_source=x\",\"oneLiner\":\"Notes on the analytical engine.\",\"bidUsd\":5}" \
  "$bid5_body" "$bid5_hdrs" || true)"
bid5_id="$(json_field "$bid5_body" "checkoutId" || true)"
bid5_url="$(json_field "$bid5_body" "url" || true)"
bid5_kind="$(json_field "$bid5_body" "kind" || true)"
bid5_charge="$(json_field "$bid5_body" "chargeUsd" || true)"
board_bid5="${WORKDIR}/board-bid5.html"
http_get "$BASE" "/" "$board_bid5" >/dev/null || true

if [[ "$bid4_code" == "400" && "$bid4_err" == "min_bid" ]] \
  && [[ "$bid5_code" == "200" && "$bid5_kind" == "open" && "$bid5_charge" == "5" && -n "$bid5_id" ]] \
  && [[ "$bid5_url" == /checkout/complete* ]] \
  && html_has "$board_bid5" 'data-empty-board' \
  && ! html_has "$board_bid5" "${ADA_NAME}"; then
  record "bid" "PASS" "POST /checkout \$4 → 400 min_bid; \$5 fixture session pending, unpaid row not listed"
else
  record "bid" "FAIL" "bid HTTP \$4=${bid4_code}/${bid4_err} \$5=${bid5_code} kind=${bid5_kind} charge=${bid5_charge}"
fi

# --- checkout: Polar fixture complete claims the row ---
complete_body="${WORKDIR}/complete.body"
complete_hdrs="${WORKDIR}/complete.hdrs"
complete_code="000"
complete_loc=""
if [[ -n "$bid5_id" ]]; then
  complete_code="$(http_get_headers "$BASE" "/checkout/complete?checkoutId=${bid5_id}" \
    "$complete_body" "$complete_hdrs" || true)"
  complete_loc="$(header_value "$complete_hdrs" "location" || true)"
fi
board_paid="${WORKDIR}/board-paid.html"
board_paid_code="$(http_get "$BASE" "/" "$board_paid" || true)"
ada_row="$(row_for_name "$board_paid" "$ADA_NAME" || true)"
ada_rank=""
ada_id=""
ada_clicks=""
if [[ -n "$ada_row" ]]; then
  ada_rank="$(attr_from_row "$ada_row" "rank" || true)"
  ada_id="$(attr_from_row "$ada_row" "listing-id" || true)"
  ada_clicks="$(clicks_from_row "$ada_row" || true)"
fi

if [[ "$complete_code" == "303" && "$complete_loc" == "/" ]] \
  && [[ "$board_paid_code" == "200" ]] \
  && [[ "$ada_rank" == "1" && "$ada_clicks" == "0" ]] \
  && html_has "$board_paid" "${ADA_NAME}" \
  && html_has "$board_paid" '\$5' \
  && ! html_has "$board_paid" 'utm_source' \
  && ! grep -Eiq 'polar\.(sh|in)|api\.polar' "$bid5_body" "$board_paid"; then
  record "checkout" "PASS" "GET /checkout/complete fixture; Ada #1 · \$5; no Polar network"
else
  record "checkout" "FAIL" "fixture complete HTTP ${complete_code} loc=${complete_loc} rank=${ada_rank}"
fi

# Second paid listing so rank and veto have a next eligible seat.
twelve_body="${WORKDIR}/twelve.json"
twelve_hdrs="${WORKDIR}/twelve.hdrs"
twelve_code="$(http_post_json "$BASE" "/checkout" \
  "{\"episodeId\":\"${EPISODE_ID}\",\"name\":\"${TWELVE_NAME}\",\"siteUrl\":\"${TWELVE_URL}\",\"oneLiner\":\"Opened at twelve.\",\"bidUsd\":12}" \
  "$twelve_body" "$twelve_hdrs" || true)"
twelve_checkout="$(json_field "$twelve_body" "checkoutId" || true)"
twelve_complete="${WORKDIR}/twelve-complete.body"
twelve_complete_hdrs="${WORKDIR}/twelve-complete.hdrs"
if [[ -n "$twelve_checkout" ]]; then
  http_get_headers "$BASE" "/checkout/complete?checkoutId=${twelve_checkout}" \
    "$twelve_complete" "$twelve_complete_hdrs" >/dev/null || true
fi

# --- rank: $12 is #1; $5 stays listed below ---
board_rank="${WORKDIR}/board-rank.html"
board_rank_code="$(http_get "$BASE" "/" "$board_rank" || true)"
ada_row2="$(row_for_name "$board_rank" "$ADA_NAME" || true)"
twelve_row="$(row_for_name "$board_rank" "$TWELVE_NAME" || true)"
ada_rank2=""
twelve_rank=""
twelve_id=""
if [[ -n "$ada_row2" ]]; then
  ada_rank2="$(attr_from_row "$ada_row2" "rank" || true)"
fi
if [[ -n "$twelve_row" ]]; then
  twelve_rank="$(attr_from_row "$twelve_row" "rank" || true)"
  twelve_id="$(attr_from_row "$twelve_row" "listing-id" || true)"
fi
if [[ "$board_rank_code" == "200" && "$twelve_code" == "200" ]] \
  && [[ "$twelve_rank" == "1" && "$ada_rank2" == "2" ]] \
  && html_has "$board_rank" '\$12' \
  && html_has "$board_rank" '\$5'; then
  record "rank" "PASS" "\$12 is #1; Ada \$5 is #2; rank is the bid"
else
  record "rank" "FAIL" "rank twelve=${twelve_rank} ada=${ada_rank2} checkout=${twelve_code}"
fi

# --- click: public /go increment, stripped URL, no query forwarded ---
if [[ -z "$ada_id" ]]; then
  record "click" "FAIL" "no paid listing id to click"
else
  click_body="${WORKDIR}/click.body"
  click_hdrs="${WORKDIR}/click.hdrs"
  click_code="$(http_get_headers "$BASE" "/go/${ada_id}?utm_source=injected" \
    "$click_body" "$click_hdrs" || true)"
  click_loc="$(header_value "$click_hdrs" "location" || true)"
  board_click="${WORKDIR}/board-click.html"
  http_get "$BASE" "/" "$board_click" >/dev/null || true
  ada_after="$(row_for_name "$board_click" "$ADA_NAME" || true)"
  after_clicks=""
  if [[ -n "$ada_after" ]]; then
    after_clicks="$(clicks_from_row "$ada_after" || true)"
  fi
  if [[ "$click_code" == "302" && "$click_loc" == "$ADA_URL" ]] \
    && [[ "$after_clicks" == "1" ]] \
    && [[ "$click_loc" != *\?* ]] \
    && [[ "$click_loc" != *#* ]]; then
    record "click" "PASS" "GET /go/${ada_id} 302 → stripped URL; clicks 0→1"
  else
    record "click" "FAIL" "GET /go/${ada_id} HTTP ${click_code} loc=${click_loc} clicks=${after_clicks}"
  fi
fi

# --- veto: guest-seat host veto of #1; next eligible books; row stays visible ---
if [[ -z "$twelve_id" ]]; then
  record "veto" "FAIL" "no #1 listing id to veto"
else
  veto_body="${WORKDIR}/veto.json"
  veto_hdrs="${WORKDIR}/veto.hdrs"
  veto_code="$(http_post_json "$BASE" "/host/veto" \
    "{\"episodeId\":\"${EPISODE_ID}\",\"listingId\":\"${twelve_id}\",\"reason\":\"hard sell\"}" \
    "$veto_body" "$veto_hdrs" \
    -H "authorization: Bearer ${HOST_SECRET}" || true)"
  veto_ok="$(json_field "$veto_body" "ok" || true)"
  board_veto="${WORKDIR}/board-veto.html"
  board_veto_code="$(http_get "$BASE" "/" "$board_veto" || true)"
  twelve_after="$(row_for_name "$board_veto" "$TWELVE_NAME" || true)"
  ada_after_veto="$(row_for_name "$board_veto" "$ADA_NAME" || true)"
  twelve_vetoed=""
  twelve_rank_after=""
  ada_rank_after=""
  if [[ -n "$twelve_after" ]]; then
    twelve_vetoed="$(attr_from_row "$twelve_after" "vetoed" || true)"
    twelve_rank_after="$(attr_from_row "$twelve_after" "rank" || true)"
  fi
  if [[ -n "$ada_after_veto" ]]; then
    ada_rank_after="$(attr_from_row "$ada_after_veto" "rank" || true)"
  fi
  if [[ "$veto_code" == "200" && "$veto_ok" == "true" ]] \
    && [[ "$board_veto_code" == "200" ]] \
    && [[ "$twelve_vetoed" == "true" && -z "$twelve_rank_after" ]] \
    && [[ "$ada_rank_after" == "1" ]] \
    && html_has "$board_veto" 'Vetoed: hard sell' \
    && html_has "$board_veto" "${TWELVE_NAME}"; then
    record "veto" "PASS" "POST /host/veto #1 on guest seat; Ada books #1; Twelve stays visible"
  else
    record "veto" "FAIL" "veto HTTP ${veto_code} vetoed=${twelve_vetoed} ada=${ada_rank_after}"
  fi
fi

# --- live Polar path: missing secret is BLOCKED-SECRET, never a fixture success ---
echo "== polar live =="
if [[ "${OP_POLAR_LIVE}" == "1" ]]; then
  missing=""
  if [[ -z "${OP_POLAR_ACCESS_TOKEN}" ]]; then
    missing="POLAR_ACCESS_TOKEN"
  fi
  if [[ -n "$missing" ]]; then
    echo "BLOCKED-SECRET: ${missing}"
    record "live-checkout" "BLOCKED-SECRET" "${missing}"
  else
    live_port="$(pick_port)"
    live_db="${WORKDIR}/polar-live.sqlite"
    live_log="${WORKDIR}/polar-live.log"
    live_base="http://127.0.0.1:${live_port}"
    live_episode="ep_live_${STAMP}"
    seed_guest_seat "$live_db" "$live_episode" >/dev/null
    (
      cd "$root"
      unset POLAR_FIXTURE_ONLY || true
      export POLAR_LIVE=1
      export POLAR_ACCESS_TOKEN="${OP_POLAR_ACCESS_TOKEN}"
      export POLAR_WEBHOOK_SECRET="${OP_POLAR_WEBHOOK_SECRET:-}"
      export PORT="${live_port}"
      export DATABASE_PATH="${live_db}"
      export HOST_SESSION_SECRET="${HOST_SECRET}"
      exec node --import tsx src/server.ts
    ) >"${live_log}" 2>&1 &
    LIVE_PID=$!
    if ! wait_health "$live_base"; then
      if grep -q 'BLOCKED-SECRET: POLAR_ACCESS_TOKEN' "${live_log}"; then
        echo "BLOCKED-SECRET: POLAR_ACCESS_TOKEN"
        record "live-checkout" "BLOCKED-SECRET" "POLAR_ACCESS_TOKEN"
      elif grep -q 'BLOCKED-SECRET: POLAR_WEBHOOK_SECRET' "${live_log}"; then
        echo "BLOCKED-SECRET: POLAR_WEBHOOK_SECRET"
        record "live-checkout" "BLOCKED-SECRET" "POLAR_WEBHOOK_SECRET"
      else
        record "live-checkout" "FAIL" "live Polar process did not become healthy"
      fi
    else
      live_body="${WORKDIR}/live-checkout.json"
      live_hdrs="${WORKDIR}/live-checkout.hdrs"
      live_code="$(http_post_json "$live_base" "/checkout" \
        "{\"episodeId\":\"${live_episode}\",\"name\":\"Live Guest ${STAMP}\",\"siteUrl\":\"https://live-${STAMP}.example/\",\"oneLiner\":\"Must not rank until Polar pays.\",\"bidUsd\":5}" \
        "$live_body" "$live_hdrs" || true)"
      live_url="$(json_field "$live_body" "url" || true)"
      live_board="${WORKDIR}/live-board.html"
      http_get "$live_base" "/" "$live_board" >/dev/null || true
      if html_has "$live_board" "Live Guest ${STAMP}"; then
        record "live-checkout" "FAIL" "unpaid live Polar session appeared on the board"
      elif [[ "$live_url" == https://*polar.sh* ]]; then
        record "live-checkout" "PASS" "live checkout returned Polar URL; unpaid session not listed"
      else
        record "live-checkout" "PASS-ERROR" "POLAR_LIVE=1 token present; HTTP ${live_code} url=${live_url}"
      fi
    fi
    if [[ -n "${LIVE_PID}" ]] && kill -0 "${LIVE_PID}" 2>/dev/null; then
      kill "${LIVE_PID}" 2>/dev/null || true
      wait "${LIVE_PID}" 2>/dev/null || true
    fi
    LIVE_PID=""
  fi
else
  if [[ -z "${OP_POLAR_ACCESS_TOKEN}" ]]; then
    echo "BLOCKED-SECRET: POLAR_ACCESS_TOKEN"
    record "live-checkout" "BLOCKED-SECRET" "POLAR_ACCESS_TOKEN"
  elif [[ -z "${OP_POLAR_WEBHOOK_SECRET}" ]]; then
    echo "BLOCKED-SECRET: POLAR_WEBHOOK_SECRET"
    record "live-checkout" "BLOCKED-SECRET" "POLAR_WEBHOOK_SECRET"
  else
    record "live-checkout" "PASS-ERROR" "POLAR_LIVE unset; secrets present but live Polar not invoked"
  fi
fi

echo
echo "== summary =="
echo "PASS=${PASS} PASS-ERROR=${PASS_ERROR} BLOCKED-SECRET=${BLOCKED} FAIL=${FAIL}"
echo "base=${BASE}"
if [[ -f "${RESULT_LOG}" ]]; then
  echo "----"
  while IFS=$'\t' read -r flow status note; do
    printf '%-16s %-16s %s\n' "$flow" "$status" "$note"
  done <"${RESULT_LOG}"
fi

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
