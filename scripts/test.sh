#!/usr/bin/env bash
# Offline gate for main. Must exit 0 on a clean clone with no secrets.
# When application code lands, add unit/contract tests here. Do not delete the
# contract checks. Do not require live Waffo or other third-party networks.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "== contract files =="
for f in README.md SPEC.md BUILD.md CONTRIBUTING.md scripts/test.sh; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done

echo "== contributing rules are documented =="
grep -q 'main must always be buildable' CONTRIBUTING.md \
  || grep -q 'main` must always be buildable' CONTRIBUTING.md \
  || fail "CONTRIBUTING.md does not state the main-branch rule"

echo "== SPEC mentions git collaboration =="
grep -q 'Git collaboration' SPEC.md || fail "SPEC.md missing Git collaboration section"

echo "== auction + listing contract =="
grep -q '\$5' SPEC.md || fail "SPEC.md missing min \$5"
grep -q 'Rank is the bid' SPEC.md || fail "SPEC.md missing rank-is-the-bid"
grep -q 'older' SPEC.md || fail "SPEC.md missing older-wins-ties"
grep -q 'difference' SPEC.md || fail "SPEC.md missing raise=difference"
grep -q 'one-liner' SPEC.md || fail "SPEC.md missing one-liner listing field"
grep -q 'person or company' SPEC.md || fail "SPEC.md missing person/company listing"
grep -q 'per episode' SPEC.md || fail "SPEC.md missing per-episode cadence"
grep -q 'guest_seat' SPEC.md || fail "SPEC.md missing guest_seat"
grep -q 'sixty_second_open' SPEC.md || fail "SPEC.md missing sixty_second_open"
grep -q 'vetoEnabled' SPEC.md || fail "SPEC.md missing vetoEnabled flag"
grep -q 'default \*\*on\*\* for `guest_seat`' SPEC.md \
  || grep -q 'default true iff seatKind === "guest_seat"' SPEC.md \
  || grep -q 'true when `seatKind === "guest_seat"`' SPEC.md \
  || fail "SPEC.md must default veto on for guest seat"
grep -q 'fixture' SPEC.md || fail "SPEC.md missing fixture payment mode"
grep -q '/about' SPEC.md || fail "SPEC.md missing /about"
grep -q '/rules' SPEC.md || fail "SPEC.md missing /rules"
grep -q 'public click' SPEC.md || fail "SPEC.md missing public clicks"
grep -q 'Query strings are stripped' SPEC.md || fail "SPEC.md missing tracking strip"
grep -q 'Chat / NSFW' SPEC.md || fail "SPEC.md missing no chat/NSFW"

echo "== BUILD PR plan through live-smoke =="
grep -q '### PR 1:' BUILD.md || fail "BUILD.md missing ### PR 1:"
grep -q '### PR 8: live-smoke' BUILD.md || fail "BUILD.md missing ### PR 8: live-smoke"
grep -F -q '| Billing | `WaffoPort` — explicit `fixture`, `waffo-test`, or `waffo-prod` mode |' BUILD.md \
  || fail "BUILD.md missing exact WaffoPort billing architecture"
grep -F -q 'HTTP does not talk to Waffo except through `WaffoPort`.' BUILD.md \
  || fail "BUILD.md missing Waffo-only provider boundary"
grep -q 'guest_seat' BUILD.md || fail "BUILD.md missing guest_seat veto default"

echo "== CI job ci is defined =="
[[ -f .github/workflows/ci.yml ]] || fail "missing .github/workflows/ci.yml"
grep -qE '^[[:space:]]*ci:[[:space:]]*$' .github/workflows/ci.yml \
  || fail "ci.yml missing job id ci"
if grep -Eqi 'WAFFO_MODE[=:][[:space:]]*(waffo-test|waffo-prod)|WAFFO_(MERCHANT_ID|PRIVATE_KEY|STORE_ID|PRODUCT_ID)=' .github/workflows/ci.yml; then
  fail "CI must remain fixture-only and must not contain live Waffo configuration"
fi
if grep -q 'scripts/live-smoke.sh' .github/workflows/ci.yml; then
  fail "live-smoke.sh must not be called from Actions"
fi
if grep -Eq '^\s*(bash )?scripts/live-smoke\.sh' scripts/test.sh; then
  fail "test.sh must not invoke live-smoke.sh"
fi

echo "== no committed secrets =="
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git ls-files | grep -E '(^|/)\.env$|(^|/)id_rsa$|\.pem$|credentials\.json$' >/dev/null; then
    fail "secret-like path is tracked"
  fi
fi

echo "== markdown is UTF-8 text =="
file -b --mime-encoding README.md SPEC.md BUILD.md CONTRIBUTING.md | grep -qiE 'utf-8|us-ascii' \
  || fail "docs are not UTF-8/ASCII"

if [[ -f package.json ]]; then
  echo "== install =="
  if [[ ! -d node_modules ]]; then
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
  fi

  unset HOST_SESSION_SECRET \
    WAFFO_LIVE WAFFO_MERCHANT_ID WAFFO_STORE_ID WAFFO_PRODUCT_ID \
    WAFFO_PRIVATE_KEY WAFFO_PRIVATE_KEY_FILE WAFFO_API_BASE \
    WAFFO_PUBLIC_BASE_URL WAFFO_TEST_WEBHOOK_PUBLIC_KEY WAFFO_PROD_WEBHOOK_PUBLIC_KEY \
    WAFFO_WEBHOOK_PUBLIC_KEY DATABASE_PATH
  export WAFFO_MODE=fixture
  [[ "${WAFFO_MODE}" == "fixture" ]] || fail "WAFFO_MODE must be fixture in test.sh"

  echo "== exact Waffo SDK dependency =="
  waffo_version="$(node -p "require('./node_modules/@waffo/pancake-ts/package.json').version" 2>/dev/null || true)"
  [[ "$waffo_version" == "0.19.1" ]] || fail "installed @waffo/pancake-ts must be exactly 0.19.1 (got ${waffo_version:-missing})"
  grep -q '"@waffo/pancake-ts": "0.19.1"' package.json \
    || fail "package.json must pin @waffo/pancake-ts 0.19.1"
  grep -q 'node_modules/@waffo/pancake-ts' package-lock.json \
    || fail "package-lock.json must contain @waffo/pancake-ts"

  echo "== healthz source =="
  [[ -f src/app.ts ]] || fail "missing src/app.ts"
  [[ -f src/server.ts ]] || fail "missing src/server.ts"
  [[ -f src/http/routes/health.ts ]] || fail "missing src/http/routes/health.ts"
  grep -q '/healthz' src/http/routes/health.ts || fail "health route missing /healthz"
  grep -q 'LISTEN_HOST' src/server.ts || fail "server must expose an explicit LISTEN_HOST"
  grep -F -q 'LISTEN_HOST=127.0.0.1' .env.example \
    || fail "host/systemd env must force LISTEN_HOST=127.0.0.1"
  grep -F -q 'unset LISTEN_HOST' scripts/live-smoke.sh \
    || fail "live-smoke must clear inherited LISTEN_HOST before setup"
  grep -F -q 'export LISTEN_HOST=127.0.0.1' scripts/live-smoke.sh \
    || fail "live-smoke child must force loopback LISTEN_HOST"
  grep -q 'ok: true' src/http/routes/health.ts || fail "health route missing { ok: true }"
  [[ -f tests/health.test.ts ]] || fail "missing tests/health.test.ts"

  echo "== episodes + listings source =="
  for f in src/db.ts src/episodes.ts src/listings.ts src/migrations/001_init.sql \
    tests/episode.test.ts; do
    [[ -f "$f" ]] || fail "missing $f"
    [[ -s "$f" ]] || fail "empty $f"
  done
  grep -q 'CREATE TABLE episodes' src/migrations/001_init.sql \
    || fail "episodes table missing from 001_init.sql"
  grep -q 'CREATE TABLE listings' src/migrations/001_init.sql \
    || fail "listings table missing from 001_init.sql"
  grep -q 'guest_seat' src/episodes.ts || fail "src/episodes.ts missing guest_seat"
  grep -q 'sixty_second_open' src/episodes.ts \
    || fail "src/episodes.ts missing sixty_second_open"
  grep -q 'vetoEnabled' src/episodes.ts || fail "src/episodes.ts missing vetoEnabled"
  grep -q 'ensureCurrentOpenEpisode' src/episodes.ts \
    || fail "src/episodes.ts missing idempotent public episode opening"
  grep -q 'isEpisodeLockDue' src/episodes.ts \
    || fail "src/episodes.ts missing locksAt expiry boundary"
  grep -q 'isEpisodeLockMalformed' src/episodes.ts \
    || fail "src/episodes.ts missing fail-closed malformed locksAt boundary"
  grep -q 'oneLiner' src/listings.ts || fail "src/listings.ts missing oneLiner"
  grep -q 'siteUrl' src/listings.ts || fail "src/listings.ts missing siteUrl"
  if grep -RInE 'https?://([^/]*\.)?polar\.sh' src tests >/dev/null 2>&1; then
    fail "src/tests must not hard-code polar.sh HTTP"
  fi
  echo "== retired payment compatibility shims are inert =="
  for f in src/polar/fixture.ts src/polar/live.ts src/polar/port.ts src/polar/waffo-session.ts; do
    [[ -f "$f" ]] || fail "missing retired compatibility shim $f"
    # Compatibility names may remain for old imports, but these files may not
    # retain executable transport, crypto signing, filesystem secret reads, or
    # obfuscated legacy endpoints.
    if grep -nE 'fetch[[:space:]]*\(|node:(http|https)|XMLHttpRequest|https?://|api[._-]?polar|polar\.sh|create(Sign|Hash)|readFileSync|fromCharCode|base64|\.join[[:space:]]*\(' "$f" >/dev/null 2>&1; then
      fail "$f contains executable legacy I/O or endpoint obfuscation"
    fi
  done

  echo "== rank engine source =="
  for f in src/rank.ts tests/rank.test.ts; do
    [[ -f "$f" ]] || fail "missing $f"
    [[ -s "$f" ]] || fail "empty $f"
  done
  grep -q 'MIN_BID_USD' src/rank.ts || fail "src/rank.ts missing MIN_BID_USD"
  grep -q 'firstBidAt' src/rank.ts || fail "src/rank.ts missing firstBidAt tie-break"
  grep -q 'chargeUsd' src/rank.ts || fail "src/rank.ts missing raise chargeUsd"
  grep -q 'full_bid_required' src/rank.ts \
    || fail "src/rank.ts missing full-bid reject for other bidders"
  grep -q 'rankListings' src/rank.ts || fail "src/rank.ts missing rankListings"
  grep -q 'isPaidListing' src/rank.ts || fail "src/rank.ts missing isPaidListing provider-paid gate"
  grep -q 'paidListings' src/rank.ts || fail "src/rank.ts missing paidListings provider occupancy"
  grep -q 'paidListings(listings)' src/rank.ts || fail "rankListings must rank provider-paid rows only"
  if grep -E 'WaffoPort|/about|/rules|/go/' src/rank.ts >/dev/null; then
    fail "rank engine must not add provider or hygiene pages"
  fi

  echo "== URL hygiene + pages source =="
  for f in src/hygiene.ts src/http/routes/pages.ts src/http/routes/go.ts \
    tests/hygiene.test.ts tests/pages.test.ts; do
    [[ -f "$f" ]] || fail "missing $f"
    [[ -s "$f" ]] || fail "empty $f"
  done
  grep -q 'canonicalizeSiteUrl' src/hygiene.ts \
    || fail "src/hygiene.ts missing canonicalizeSiteUrl"
  grep -q 'chat_link' src/hygiene.ts || fail "src/hygiene.ts missing chat_link"
  grep -q 'nsfw' src/hygiene.ts || fail "src/hygiene.ts missing nsfw"
  grep -q '/about' src/http/routes/pages.ts || fail "pages route missing /about"
  grep -q '/rules' src/http/routes/pages.ts || fail "pages route missing /rules"
  grep -q '\$5' src/http/routes/pages.ts || fail "rules page missing min \$5"
  grep -q 'older' src/http/routes/pages.ts || fail "rules page missing older wins"
  grep -q 'guest seat' src/http/routes/pages.ts \
    || fail "rules page missing guest-seat veto default"
  grep -q '/go/:listingId' src/http/routes/go.ts \
    || fail "go route missing /go/:listingId"
  grep -q 'incrementListingClicks' src/http/routes/go.ts \
    || fail "go route missing click increment"
  if grep -RInE 'createCheckout|WaffoPort|WAFFO_MODE' src/hygiene.ts \
    src/http/routes/pages.ts src/http/routes/go.ts >/dev/null 2>&1; then
    fail "hygiene/pages/go must not start a provider checkout"
  fi

  echo "== product UI (studio rundown) source =="
  for f in src/http/routes/pages.ts src/views/skin.ts tests/pages.test.ts; do
    [[ -s "$f" ]] || fail "missing or empty $f"
  done
  if grep -E 'renderPodcastReferencePage|outbid-reference-page' src/http/routes/pages.ts >/dev/null; then
    fail "product page must not short-circuit into the shared reference renderer"
  fi
  for marker in 'data-slot="studio-board"' 'data-slot="episode-slate"' \
    'data-slot="claim-console"' 'data-slot="cue-column"' 'data-slot="rundown-stack"'; do
    grep -F -q "$marker" src/http/routes/pages.ts \
      || fail "Studio Rundown identity is missing $marker"
  done
  for selector in '.studio-intro' '.rundown-desk' '.cue-column' '.rundown-column'; do
    grep -F -q "$selector" src/views/skin.ts \
      || fail "Studio Rundown identity CSS is missing $selector"
  done
  grep -q 'Claim the' src/http/routes/pages.ts || fail "board missing claim chrome"
  grep -q 'Claim #1 for' src/http/routes/pages.ts || fail "empty-open claim missing Claim #1"
  grep -F -q 'data-first-click="claim"' src/http/routes/pages.ts \
    || fail "empty-open Claim #1 missing first-click mark"
  grep -F -q 'data-empty-claim-first' src/http/routes/pages.ts \
    || fail "empty-open claim missing empty-claim-first stamp"
  grep -F -q 'empty-claim-first' src/http/routes/pages.ts \
    || fail "empty-open claim missing empty-claim-first class"
  grep -F -q 'data-studio-state' src/http/routes/pages.ts \
    || fail "board missing compact studio state contract"
  grep -F -q 'studio-all-vetoed' src/http/routes/pages.ts src/views/skin.ts \
    || fail "all-vetoed board missing distinct visible state"
  grep -F -q 'data-all-vetoed' src/http/routes/pages.ts \
    || fail "all-vetoed board missing state marker"
  grep -F -q '.studio.studio-all-vetoed .rundown[data-rundown]' src/views/skin.ts \
    || fail "all-vetoed rundown visibility rule is missing"
  grep -F -q 'data-claim-state' src/http/routes/pages.ts \
    || fail "board missing compact claim state contract"
  grep -F -q 'data-host-action' src/http/routes/pages.ts \
    || fail "host desk missing single-action contract"
  if grep -RInE 'Then the guest site|Then name, site, one-liner|lock-after-open|open-after-lock|data-later-write|data-listing-identity|data-later-claim' \
    src/http/routes/pages.ts src/views/skin.ts tests/pages.test.ts >/dev/null 2>&1; then
    fail "obsolete hop wording or numbered/staged residue remains"
  fi
  grep -q 'bid-stepper' src/http/routes/pages.ts || fail "board missing ± bid stepper"
  grep -q 'bid-field' src/http/routes/pages.ts || fail "board missing dashed \$amount"
  grep -q 'Outbid' src/http/routes/pages.ts || fail "board missing Outbid"
  grep -q 'show-ticket' src/http/routes/pages.ts || fail "board missing show ticket"
  grep -q 'guest-name' src/http/routes/pages.ts || fail "guest card missing name"
  grep -q 'guest-line' src/http/routes/pages.ts || fail "guest card missing one-liner"
  grep -q 'guest-site' src/http/routes/pages.ts || fail "guest card missing site"
  grep -q 'data-guest-prize' src/http/routes/pages.ts || fail "live ranked seat missing guest prize mark"
  grep -q 'data-paid-at' src/http/routes/pages.ts || fail "live ranked seat missing Waffo paid-at stamp"
  grep -q 'data-first-click="guest"' src/http/routes/pages.ts || fail "occupied #1 guest missing first-click mark"
  grep -q '"claim occupied-claim"' src/http/routes/pages.ts \
    || fail "occupied claim must use the compact occupied state"
  grep -q 'data-identity-fields' src/http/routes/pages.ts \
    || fail "empty and occupied claims must expose direct identity fields"
  for marker in data-occupied-window data-occupied-raise data-raise-amount-field data-occupied-outbid data-occupied-form-hint; do
    grep -q "$marker" src/http/routes/pages.ts || fail "occupied claim missing $marker"
  done
  grep -F -q '.studio.studio-open-occupied .claim[data-claim-state="open-occupied"]' src/views/skin.ts \
    || fail "occupied CSS must use the compact claim state"
  grep -F -q '.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .bid-field[data-raise-amount-field]' src/views/skin.ts \
    || fail "occupied CSS missing dashed raise amount styling"
  grep -F -q '[data-host-action="open"]' src/views/skin.ts \
    || fail "host open CSS missing compact action state"
  grep -F -q 'data-host-action="lock"' src/http/routes/pages.ts \
    || fail "host lock desk missing compact action state"
  grep -q 'data-archive-current' src/http/routes/pages.ts \
    || fail "rolled archive missing current-rundown status"
  grep -q 'livePaidListings' src/rank.ts \
    || fail "rank engine missing livePaidListings rolling-week occupancy"
  grep -q 'bidInRollingWeek' src/rank.ts \
    || fail "rank engine missing bidInRollingWeek live window"
  for f in src/window.ts tests/window.test.ts; do
    [[ -s "$f" ]] || fail "missing or empty $f"
  done
  grep -q 'ROLLING_WEEK_MS' src/window.ts || fail "src/window.ts missing ROLLING_WEEK_MS"
  grep -q 'rollingWeekStart' src/window.ts || fail "src/window.ts missing rollingWeekStart"
  grep -q 'bidInRollingWeek' src/window.ts || fail "src/window.ts missing bidInRollingWeek"
  grep -q 'data-rolling-week' src/http/routes/pages.ts \
    || fail "occupied live rundown missing data-rolling-week"
  # The renderer states the invariant in user-facing copy: each paid
  # placement remains eligible for seven days, and the window follows the
  # placement timestamp instead of a civil Monday boundary. Keep these
  # assertions tied to the current copy rather than the retired wording.
  grep -F -q 'Paid placements remain eligible for seven days' src/http/routes/pages.ts \
    || fail "occupied live rundown missing rolling seven-day copy"
  grep -F -q 'does not reset at Monday midnight' src/http/routes/pages.ts \
    || fail "occupied live rundown missing non-civil window invariant"
  grep -q 'class="week-window"' src/http/routes/pages.ts \
    || fail "occupied live rundown missing week-window"
  grep -F -q '.studio.studio-open-occupied .week-window[data-rolling-week]' src/views/skin.ts \
    || fail "occupied rolling-week CSS must be scoped to Waffo-paid studio-open-occupied"
  grep -q 'Occupied live: rolling last-7-days window' src/views/skin.ts \
    || fail "occupied CSS must document rolling last-7-days window"
  grep -q 'class="empty-window"' src/http/routes/pages.ts \
    || fail "empty-open missing empty-window copy"
  grep -q 'data-empty-window' src/http/routes/pages.ts \
    || fail "empty-open missing data-empty-window rolling last-7-days certainty"
  grep -q 'data-empty-claim-window' src/http/routes/pages.ts \
    || fail "empty-open claim-note missing data-empty-claim-window"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] .empty.open-seat[data-empty-honest] .empty-window[data-empty-window]' src/views/skin.ts \
    || fail "empty-open rolling-window CSS must be scoped to empty open-seat"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] .claim.empty-claim-first[data-empty-claim-first] .claim-note[data-empty-claim-window]' src/views/skin.ts \
    || fail "empty-open claim-note CSS must be scoped to empty Claim #1"
  grep -F -q '.claim[data-claim-state="locked"]' src/views/skin.ts \
    || fail "locked CSS must use the compact claim state"
  grep -F -q '.doc[data-checkout-state="locked"]' src/views/skin.ts \
    || fail "locked checkout CSS must use the compact state"
  grep -q 'data-claim-locked' src/http/routes/pages.ts || fail "locked board missing data-claim-locked"
  grep -q 'data-next-seat' src/http/routes/pages.ts || fail "N+1 board missing data-next-seat"
  grep -q 'takes #1' src/http/routes/pages.ts || fail "fresh-open board missing \$5 takes #1"
  grep -q 'clicks' src/http/routes/pages.ts || fail "guest card missing public clicks"
  grep -F -q 'Occupied live `/` ranks Waffo-paid `paidAt` in the **rolling last 7 days**.' SPEC.md \
    || fail "SPEC.md missing exact rolling seven-day contract"
  grep -F -q 'Not a civil-midnight lock. Not Monday 00:00 UTC.' SPEC.md \
    || fail "SPEC.md missing non-civil Monday rolling-window contract"
  if grep -Eqi 'featured guest|play count|followers' src/http/routes/pages.ts src/views/skin.ts; then
    fail "product UI must not invent featured-guest art or play counts"
  fi
  echo "== Waffo checkout + fixture source =="
  for f in src/waffo/port.ts src/waffo/fixture.ts src/waffo/live.ts \
    src/http/routes/checkout.ts tests/waffo.test.ts; do
    [[ -f "$f" ]] || fail "missing $f"
    [[ -s "$f" ]] || fail "empty $f"
  done
  grep -q 'WaffoPort' src/waffo/port.ts || fail "src/waffo/port.ts missing WaffoPort"
  grep -q 'createCheckout' src/waffo/port.ts \
    || fail "src/waffo/port.ts missing createCheckout"
  grep -q 'fixture' src/waffo/port.ts || fail "Waffo port missing fixture mode"
  grep -q 'FixtureWaffo' src/waffo/fixture.ts \
    || fail "src/waffo/fixture.ts missing FixtureWaffo"
  grep -q 'LiveWaffo' src/waffo/live.ts || fail "src/waffo/live.ts missing LiveWaffo"
  grep -q 'WAFFO_MODE' src/waffo/live.ts || fail "src/waffo/live.ts missing explicit mode gate"
  grep -q 'POST' src/http/routes/checkout.ts \
    || fail "src/http/routes/checkout.ts missing POST"
  grep -q '/checkout' src/http/routes/checkout.ts \
    || fail "src/http/routes/checkout.ts missing /checkout"
  grep -q 'Waffo mode truth table' tests/waffo.test.ts \
    || fail "tests/waffo.test.ts missing Waffo truth table"
  grep -q 'production cannot construct a fixture' tests/waffo.test.ts \
    || fail "Waffo production fixture fail-closed regression is missing"
  grep -q 'provider timeout leaves an unknown intent' tests/waffo.test.ts \
    || fail "Waffo timeout recovery regression is missing"
  grep -q 'normal app construction honors the fixture/live/missing/invalid Waffo mode matrix' tests/waffo.test.ts \
    || fail "normal app Waffo mode matrix regression is missing"
  grep -q 'money-field omission is distinct' tests/waffo.test.ts \
    || fail "Waffo malformed-money regression is missing"
  grep -q 'all-vetoed live board stays truthful' tests/pages.test.ts \
    || fail "all-vetoed UI regression is missing"
  if grep -RInE 'Polar (can|cannot|charges|did not charge)' src/http/routes/pages.ts src/views/skin.ts tests scripts/test.sh >/dev/null 2>&1; then
    fail "active Waffo UI/operator/test copy must not identify the retired provider"
  fi
  if grep -RInE 'https?://([^/]*\.)?polar\.sh' src tests >/dev/null 2>&1; then
    fail "src/tests must not hard-code polar.sh HTTP"
  fi

  echo "== host veto + lock source =="
  for f in src/veto.ts src/http/routes/host.ts tests/veto.test.ts; do
    [[ -f "$f" ]] || fail "missing $f"
    [[ -s "$f" ]] || fail "empty $f"
  done
  grep -q 'vetoListing' src/veto.ts || fail "src/veto.ts missing vetoListing"
  grep -q 'lockEpisode' src/veto.ts || fail "src/veto.ts missing lockEpisode"
  grep -q 'veto_disabled' src/veto.ts || fail "src/veto.ts missing veto_disabled"
  grep -q 'veto_flag_frozen' src/veto.ts || fail "src/veto.ts missing veto_flag_frozen"
  grep -q 'bookedGuest' src/veto.ts || fail "src/veto.ts missing bookedGuest"
  grep -q '/host/veto' src/http/routes/host.ts || fail "host route missing /host/veto"
  grep -q '/host/lock' src/http/routes/host.ts || fail "host route missing /host/lock"
  grep -q '/host/open' src/http/routes/host.ts || fail "host route missing /host/open"
  grep -q 'openNextEpisode' src/episodes.ts || fail "src/episodes.ts missing openNextEpisode"
  grep -q 'HOST_SESSION_SECRET' src/http/routes/host.ts \
    || fail "host route missing HOST_SESSION_SECRET"
  grep -q 'requireHostSessionSecret' src/app.ts src/http/routes/host.ts \
    || fail "production app must validate HOST_SESSION_SECRET"
  grep -q 'hostRoutes' src/app.ts || fail "src/app.ts must register hostRoutes"
  if grep -Eqi 'WAFFO_MODE[=:][[:space:]]*(waffo-test|waffo-prod)|https?://([^/]*\.)?waffo\.ai' src/veto.ts \
    src/http/routes/host.ts tests/veto.test.ts; then
    fail "veto/lock must stay offline (no live provider)"
  fi

  echo "== deploy artifacts (Dockerfile + runbook) =="
  [[ -f Dockerfile ]] || fail "missing Dockerfile"
  [[ -f .env.example ]] || fail "missing .env.example"
  [[ -f deploy/runbook.md ]] || fail "missing deploy/runbook.md"
  grep -q 'node:22' Dockerfile || fail "Dockerfile must use Node 22"
  grep -qE '^USER[[:space:]]+node$' Dockerfile || fail "Dockerfile must run as non-root USER node"
  grep -q 'PORT' Dockerfile || fail "Dockerfile must honor PORT"
  grep -q 'src/server.ts' Dockerfile || fail "Dockerfile must start src/server.ts"
  grep -F -q 'COPY public ./public' Dockerfile \
    || fail "Dockerfile must copy public runtime assets"
  grep -F -q 'test -s /app/public/icons/bitcoin.svg' Dockerfile \
    || fail "Dockerfile must verify the bitcoin runtime asset"
  grep -F -q 'LISTEN_HOST=0.0.0.0' Dockerfile \
    || fail "Dockerfile must bind the container listener to 0.0.0.0"
  [[ -s public/icons/bitcoin.svg ]] || fail "missing public/icons/bitcoin.svg"
  [[ -f tests/deploy.test.ts ]] || fail "missing Docker/runtime deployment test"
  grep -F -q 'Docker runtime staging copies public icons' tests/deploy.test.ts \
    || fail "deployment test must stage and serve public icons"
  if grep -E 'WAFFO_MODE[[:space:]]*=' Dockerfile >/dev/null; then
    fail "Dockerfile must not select a Waffo mode"
  fi
  if grep -E 'WAFFO_(MERCHANT_ID|PRIVATE_KEY|PRIVATE_KEY_FILE|STORE_ID|PRODUCT_ID|.*WEBHOOK_PUBLIC_KEY)[[:space:]]*=' Dockerfile >/dev/null; then
    fail "Dockerfile must not bake Waffo credentials"
  fi
  grep -q 'DATABASE_PATH' .env.example || fail ".env.example missing DATABASE_PATH"
  grep -q 'HOST_SESSION_SECRET' .env.example || fail ".env.example missing HOST_SESSION_SECRET"
  grep -q 'WAFFO_MODE' .env.example || fail ".env.example missing WAFFO_MODE"
  grep -q 'WAFFO_MERCHANT_ID' .env.example || fail ".env.example missing WAFFO_MERCHANT_ID"
  grep -q 'WAFFO_PRIVATE_KEY' .env.example || fail ".env.example missing WAFFO_PRIVATE_KEY"
  grep -q 'WAFFO_STORE_ID' .env.example || fail ".env.example missing WAFFO_STORE_ID"
  grep -q 'WAFFO_PRODUCT_ID' .env.example || fail ".env.example missing WAFFO_PRODUCT_ID"
  grep -q 'WAFFO_PUBLIC_BASE_URL' .env.example || fail ".env.example missing WAFFO_PUBLIC_BASE_URL"
  grep -q 'WAFFO_TEST_WEBHOOK_PUBLIC_KEY' .env.example \
    || fail ".env.example missing WAFFO_TEST_WEBHOOK_PUBLIC_KEY"
  grep -q 'WAFFO_PROD_WEBHOOK_PUBLIC_KEY' .env.example \
    || fail ".env.example missing WAFFO_PROD_WEBHOOK_PUBLIC_KEY"
  if grep -E '^[[:space:]]*WAFFO_MODE=(waffo-test|waffo-prod)[[:space:]]*$' .env.example >/dev/null; then
    fail ".env.example must not default to a live Waffo mode"
  fi
  if grep -E '^[[:space:]]*WAFFO_(MERCHANT_ID|PRIVATE_KEY|PRIVATE_KEY_FILE|STORE_ID|PRODUCT_ID|PUBLIC_BASE_URL|.*WEBHOOK_PUBLIC_KEY)=' .env.example >/dev/null 2>&1; then
    fail "Waffo credentials must remain commented in .env.example"
  fi
  [[ -f src/migrations/003_waffo_checkout_state.sql ]] \
    || fail "missing durable Waffo checkout migration"
  [[ -f src/migrations/004_waffo_business_payload.sql ]] \
    || fail "missing Waffo replay-payload migration"
  grep -q 'CREATE TABLE checkout_intents' src/migrations/003_waffo_checkout_state.sql \
    || fail "checkout intent table missing"
  grep -q 'CREATE TABLE waffo_checkout_events' src/migrations/003_waffo_checkout_state.sql \
    || fail "Waffo event table missing"
  grep -q 'CREATE TABLE waffo_webhook_attempts' src/migrations/003_waffo_checkout_state.sql \
    || fail "Waffo webhook attempt table missing"
  grep -q 'verifyWebhook' src/waffo/live.ts src/http/routes/checkout.ts \
    || fail "webhook route must use Waffo official verifier"
  grep -q 'order.completed' src/http/routes/checkout.ts \
    || fail "webhook route must settle only order.completed"
  grep -q 'subtotalCents' src/http/routes/checkout.ts \
    || fail "webhook route must reconcile decimal subtotal"
  grep -q 'business_payload' src/http/routes/checkout.ts src/migrations/004_waffo_business_payload.sql \
    || fail "webhook route must persist complete replay payload"
  grep -q 'transaction.immediate' src/http/routes/checkout.ts \
    || fail "settlement must serialize across DB connections"
  if grep -n 'waffo-session' src/http/routes/checkout.ts src/waffo/live.ts >/dev/null 2>&1; then
    fail "v1 runtime must not import the quarantined Waffo adapter"
  fi
  grep -q '/healthz' deploy/runbook.md || fail "runbook missing /healthz"
  grep -q 'waffo-test' deploy/runbook.md || fail "runbook missing Waffo test mode"
  grep -q 'waffo-prod' deploy/runbook.md || fail "runbook missing Waffo production mode"
  grep -q '/webhooks/waffo' deploy/runbook.md || fail "runbook missing Waffo webhook endpoint"
  grep -qi 'HTTPS' deploy/runbook.md || fail "runbook missing HTTPS boundary"
  grep -qi 'durable' deploy/runbook.md || fail "runbook missing durable database requirement"
  grep -qi 'reconciliation' deploy/runbook.md || fail "runbook missing reconciliation procedure"
  grep -qi 'rollback' deploy/runbook.md || fail "runbook missing rollback procedure"
  grep -q 'docker build' deploy/runbook.md || fail "runbook missing docker build"
  grep -q 'docker run' deploy/runbook.md || fail "runbook missing docker run"
  grep -F -q -- '-e LISTEN_HOST=0.0.0.0' deploy/runbook.md \
    || fail "runbook must explicitly bind the Docker listener"
  grep -F -q 'Environment=LISTEN_HOST=127.0.0.1' deploy/runbook.md \
    || fail "runbook must force systemd host loopback"
  grep -F -q 'fixture child to loopback despite inherited LISTEN_HOST' tests/live-smoke.test.ts \
    || fail "live-smoke must regress inherited LISTEN_HOST values"
  grep -q 'Caddy' deploy/runbook.md || fail "runbook missing Caddy"
  grep -q 'guest seat' deploy/runbook.md || fail "runbook missing guest-seat product"
  if grep -E 'WAFFO_MODE[[:space:]]*=[[:space:]]*(waffo-test|waffo-prod)|WAFFO_(MERCHANT_ID|PRIVATE_KEY|STORE_ID|PRODUCT_ID)=' .github/workflows/ci.yml >/dev/null; then
    fail "CI must not set live Waffo configuration"
  fi

  echo "== tsc --noEmit =="
  npx tsc --noEmit

  echo "== unit tests =="
  test_log="$(mktemp)"
  trap 'rm -f "$test_log"' EXIT
  set +e
  npx tsx --test --test-reporter spec 'tests/**/*.test.ts' | tee "$test_log"
  test_status=${PIPESTATUS[0]}
  set -e
  [[ $test_status -eq 0 ]] || fail "unit tests failed"
  grep -Eq 'tests[[:space:]]+[1-9][0-9]*' "$test_log" \
    || fail "test runner reported 0 tests"
  while IFS= read -r expected; do
    [[ -z "$expected" ]] && continue
    grep -F -q "$expected" "$test_log" || fail "expected regression did not run: $expected"
  done <<'EOF'
GET /healthz returns 200 { ok: true }
new episode does not carry old bids
guest-seat episode defaults vetoEnabled to true
60-second episode defaults vetoEnabled to false
ensureCurrentOpenEpisode opens one empty board
ensureCurrentOpenEpisode opens the next empty board after a host lock
ensureCurrentOpenEpisode serializes a cold-database open across SQLite connections
ensureCurrentOpenEpisode atomically rolls an episode past locksAt
scheduled rollover serializes one replacement board across SQLite connections
malformed locksAt quarantine serializes one replacement across SQLite connections
first bid $5 on empty guest-seat episode is rank #1 after payment
bid $4 is rejected (min $5)
two listings, $10 then $12
older firstBidAt is #1
raise own $10 to $13
other bidder cannot pay only the $1 difference
URL with ?utm_source=x is stored and /go has no query
Discord / Telegram invite is rejected
NSFW host is rejected
public click /go/:id 302 + clicks increment
GET /about describes the seat
GET /rules states the public bid, window, and host-review rules
GET / with an empty database auto-opens an empty claim board
GET / auto-opens only once and About explains automatic episode opening
GET / auto-opening does not expose the host desk or host session
GET / with no prior episodes gives guests an immediately usable claim
POST /host/open from the desk opens a guest-seat episode
GET / after a lock opens the next board while the old episode stays archived
GET / rolls an expired locksAt into one empty claim board
POST /checkout rolls an expired locksAt before refusing the old episode
GET / quarantines malformed locksAt and opens one usable replacement
malformed locksAt quarantines before Waffo and creates no intent
GET / after the host opens N+1 makes bidding that empty seat live
GET / on a fresh-open empty episode makes bidding the guest seat live
GET / on a fresh-open empty episode stays empty-honest
GET / on a fresh-open empty episode isolates $5 from lock / prize leak
GET / on a fresh-open empty episode keeps $5 honest
studio rundown is a guest card
GET / on a live ranked seat reads the guest label first
GET / on an occupied live seat keeps $bid a later fact
GET / on occupied live keeps #1 guest the first click
GET / on occupied live keeps later seats quieter than #1 guest
GET / on occupied live keeps #1 guest prize chrome
GET / on occupied live keeps one first click
occupied week window is rolling last-7-days
GET / on a fresh-open empty episode names rolling last-7-days
GET / on occupied live names rolling last-7-days on occupied-claim
GET / on occupied live names the raise difference on occupied-claim
GET / on occupied live names the Waffo charge as the raise difference
GET / on occupied live names Waffo's full new bid
GET / on occupied live Waffo charge leads with the raise difference
occupied-claim note names the raise difference
occupied-claim form-hint names the raise difference
occupied-claim names the matched guest
occupied-claim Outbid names the matched guest
rolling last-7-days window is 7
Monday 00:00 UTC does not drop a bid still inside the rolling week
unpaid stays off the rundown
HTML Outbid form posts to /checkout
HTML checkout error copy is human-readable
public claim identity fields have labels and a visible focus ring
Docker runtime staging copies public icons and serves the loopback app
offline smoke fixes the fixture child to loopback despite inherited LISTEN_HOST
Waffo mode truth table is explicit
normal app construction honors the fixture/live/missing/invalid Waffo mode matrix
offline smoke rejects malformed LIVE_SMOKE_PORT before any request
production cannot construct a fixture
production app requires the configured durable database
provider timeout leaves an unknown intent
official anonymous checkout receives immutable Waffo parameters
signed raw order.completed settles once
invalid signature, wrong event, mode, store
return URL never settles a live checkout
stale captured raise enters reconciliation
direct settlement serializes two deliveries
migration restart recovers committed schema and partial additive migration
Veto #1 on guest seat
Veto when flag off is 403
lock freezes the episode
veto flag is frozen after the first paid bid
EOF
  provider_endpoint_regex='https?://([A-Za-z0-9-]+\.)*waffo\.(ai|test)(:[0-9]+)?([/?#]|$)'
  if ! printf '%s\n' 'https://api.waffo.ai/v1/checkout' | grep -Eqi "$provider_endpoint_regex"; then
    fail "unit-test provider-call guard does not recognize Waffo endpoints"
  fi
  if grep -Eqi "$provider_endpoint_regex" "$test_log"; then
    fail "unit tests must not call live Waffo hosts"
  fi
fi

echo "OK: buildable and testable"
