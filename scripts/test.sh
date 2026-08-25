#!/usr/bin/env bash
# Offline gate for main. Must exit 0 on a clean clone with no secrets.
# When application code lands, add unit/contract tests here. Do not delete the
# contract checks. Do not require live Polar or other third-party networks.
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
grep -q 'Polar' SPEC.md || fail "SPEC.md missing Polar"
grep -q 'fixture' SPEC.md || fail "SPEC.md missing fixture Polar"
grep -q '/about' SPEC.md || fail "SPEC.md missing /about"
grep -q '/rules' SPEC.md || fail "SPEC.md missing /rules"
grep -q 'public click' SPEC.md || fail "SPEC.md missing public clicks"
grep -q 'Query strings are stripped' SPEC.md || fail "SPEC.md missing tracking strip"
grep -q 'Chat / NSFW' SPEC.md || fail "SPEC.md missing no chat/NSFW"

echo "== BUILD PR plan through live-smoke =="
grep -q '### PR 1:' BUILD.md || fail "BUILD.md missing ### PR 1:"
grep -q '### PR 8: live-smoke' BUILD.md || fail "BUILD.md missing ### PR 8: live-smoke"
grep -q 'PolarPort' BUILD.md || fail "BUILD.md missing PolarPort"
grep -q 'POLAR_FIXTURE_ONLY' BUILD.md || fail "BUILD.md missing POLAR_FIXTURE_ONLY"
grep -q 'guest_seat' BUILD.md || fail "BUILD.md missing guest_seat veto default"

echo "== CI job ci is defined =="
[[ -f .github/workflows/ci.yml ]] || fail "missing .github/workflows/ci.yml"
grep -qE '^[[:space:]]*ci:[[:space:]]*$' .github/workflows/ci.yml \
  || fail "ci.yml missing job id ci"
if grep -Eqi 'POLAR_LIVE=1|POLAR_ACCESS_TOKEN=' .github/workflows/ci.yml; then
  fail "CI must not set live Polar"
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

  unset POLAR_LIVE POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET HOST_SESSION_SECRET
  export POLAR_FIXTURE_ONLY=1
  [[ "${POLAR_LIVE:-}" != "1" ]] || fail "POLAR_LIVE must stay unset in test.sh"
  [[ "${POLAR_FIXTURE_ONLY}" == "1" ]] || fail "POLAR_FIXTURE_ONLY must be 1 in test.sh"

  echo "== healthz source =="
  [[ -f src/app.ts ]] || fail "missing src/app.ts"
  [[ -f src/server.ts ]] || fail "missing src/server.ts"
  [[ -f src/http/routes/health.ts ]] || fail "missing src/http/routes/health.ts"
  grep -q '/healthz' src/http/routes/health.ts || fail "health route missing /healthz"
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
  grep -q 'oneLiner' src/listings.ts || fail "src/listings.ts missing oneLiner"
  grep -q 'siteUrl' src/listings.ts || fail "src/listings.ts missing siteUrl"
  if grep -RInE 'https?://([^/]*\.)?polar\.sh' src tests >/dev/null 2>&1; then
    fail "src/tests must not hard-code polar.sh HTTP"
  fi

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
  grep -q 'isPaidListing' src/rank.ts || fail "src/rank.ts missing isPaidListing Polar paid gate"
  grep -q 'paidListings' src/rank.ts || fail "src/rank.ts missing paidListings Polar occupancy"
  grep -q 'paidListings(listings)' src/rank.ts || fail "rankListings must rank Polar-paid rows only"
  if grep -E 'PolarPort|/about|/rules|/go/' src/rank.ts >/dev/null; then
    fail "rank engine must not add Polar or hygiene pages"
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
  if grep -RInE 'createCheckout|PolarPort|POLAR_LIVE' src/hygiene.ts \
    src/http/routes/pages.ts src/http/routes/go.ts >/dev/null 2>&1; then
    fail "hygiene/pages/go must not start Polar checkout"
  fi

  echo "== product UI (studio rundown) source =="
  [[ -f src/views/skin.ts ]] || fail "missing src/views/skin.ts"
  grep -q 'Claim the' src/http/routes/pages.ts || fail "board missing claim chrome"
  grep -q 'Claim #1 for' src/http/routes/pages.ts || fail "empty-open claim missing Claim #1"
  grep -q 'data-first-click="claim"' src/http/routes/pages.ts \
    || fail "empty-open Claim #1 missing first-click mark"
  grep -q 'data-empty-claim-first' src/http/routes/pages.ts \
    || fail "empty-open claim missing empty-claim-first stamp"
  grep -q 'empty-claim-first' src/http/routes/pages.ts \
    || fail "empty-open claim missing empty-claim-first class"
  grep -q 'data-later-write' src/http/routes/pages.ts \
    || fail "empty-open guest site missing later-write stamp"
  grep -q 'data-listing-identity' src/http/routes/pages.ts \
    || fail "empty-open guest site missing listing-identity wrap"
  grep -q 'Then the guest site' src/http/routes/pages.ts \
    || fail "empty-open must name the guest site as a later write"
  grep -q 'listing-identity\[data-later-write\]' src/views/skin.ts \
    || fail "empty-open CSS missing later-write guest-site composition"
  grep -q 'Empty open: guest site is a later write' src/views/skin.ts \
    || fail "empty-open CSS must document guest site as a later write after Claim #1"
  if grep -nE 'data-empty-claim-after|data-claim-after-empty|empty-claim-after-[0-9]|lock-after-open-six' \
    src/http/routes/pages.ts src/views/skin.ts >/dev/null; then
    fail "do not stamp another named hop; compose empty Claim #1 then the guest site"
  fi
  grep -q 'bid-stepper' src/http/routes/pages.ts || fail "board missing ± bid stepper"
  grep -q 'bid-field' src/http/routes/pages.ts || fail "board missing dashed \$amount"
  grep -q 'Outbid' src/http/routes/pages.ts || fail "board missing Outbid"
  grep -q 'show-ticket' src/http/routes/pages.ts || fail "board missing show ticket"
  grep -q 'guest-name' src/http/routes/pages.ts || fail "guest card missing name"
  grep -q 'guest-line' src/http/routes/pages.ts || fail "guest card missing one-liner"
  grep -q 'guest-site' src/http/routes/pages.ts || fail "guest card missing site"
  grep -q 'data-guest-prize' src/http/routes/pages.ts || fail "live ranked seat missing guest prize mark"
  grep -q 'data-paid-at' src/http/routes/pages.ts || fail "live ranked seat missing Polar paid-at stamp"
  grep -q 'data-guest-prize' src/views/skin.ts || fail "live ranked seat missing prize-before-price CSS"
  grep -q 'data-paid-at' src/views/skin.ts || fail "occupied #1 prize CSS missing Polar paid-at"
  grep -q 'data-first-click="guest"' src/http/routes/pages.ts || fail "occupied #1 guest missing first-click mark"
  grep -q 'data-first-click="guest"' src/views/skin.ts || fail "occupied #1 guest missing first-click CSS"
  grep -q 'data-later-claim' src/http/routes/pages.ts || fail "occupied Claim missing later-claim stamp"
  grep -q 'later-claim' src/http/routes/pages.ts || fail "occupied Claim missing later-claim class"
  grep -q '"claim later-claim"' src/http/routes/pages.ts \
    || fail "occupied Claim must compose later-claim, not a same-weight rail"
  grep -q 'data-later-claim' src/views/skin.ts || fail "occupied later-claim CSS missing later-claim stamp"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim]' src/views/skin.ts \
    || fail "occupied later-claim CSS must be scoped to Polar-paid studio-open-occupied"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .claim-title' src/views/skin.ts \
    || fail "occupied later-claim title CSS must recede after the #1 guest"
  grep -q 'Occupied live: Claim is a later write after the #1 guest' src/views/skin.ts \
    || fail "occupied CSS must document Claim as a later write after the #1 guest"
  grep -q 'livePaidListings' src/rank.ts \
    || fail "rank engine missing livePaidListings rolling-week occupancy"
  grep -q 'bidInRollingWeek' src/rank.ts \
    || fail "rank engine missing bidInRollingWeek live window"
  [[ -f src/window.ts ]] || fail "missing src/window.ts"
  [[ -s src/window.ts ]] || fail "empty src/window.ts"
  [[ -f tests/window.test.ts ]] || fail "missing tests/window.test.ts"
  grep -q 'ROLLING_WEEK_MS' src/window.ts || fail "src/window.ts missing ROLLING_WEEK_MS"
  grep -q 'rollingWeekStart' src/window.ts || fail "src/window.ts missing rollingWeekStart"
  grep -q 'bidInRollingWeek' src/window.ts || fail "src/window.ts missing bidInRollingWeek"
  grep -q 'data-rolling-week' src/http/routes/pages.ts \
    || fail "occupied live rundown missing data-rolling-week"
  grep -q 'Rolling last 7 days' src/http/routes/pages.ts \
    || fail "occupied live rundown missing rolling last-7-days copy"
  grep -q 'Not Monday 00:00 UTC' src/http/routes/pages.ts \
    || fail "occupied live rundown must reject Monday 00:00 UTC lock"
  grep -q 'class="week-window"' src/http/routes/pages.ts \
    || fail "occupied live rundown missing week-window"
  grep -F -q '.studio.studio-open-occupied .rundown[data-rolling-week] .week-window[data-rolling-week]' src/views/skin.ts \
    || fail "occupied rolling-week CSS must be scoped to Polar-paid studio-open-occupied"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-rolling-week]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked rolling-week chrome"
  grep -F -q '.studio.studio-open-empty [data-rolling-week]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked rolling-week without stamp-only"
  grep -F -q '.studio.studio-open-empty .week-window' src/views/skin.ts \
    || fail "empty-open shell must hide leaked week-window class"
  grep -q 'Occupied live: rolling last-7-days window' src/views/skin.ts \
    || fail "occupied CSS must document rolling last-7-days window"
  grep -q 'rolling last 7 days' SPEC.md \
    || fail "SPEC.md missing rolling last-7-days occupied live window"
  grep -q 'class="empty-window"' src/http/routes/pages.ts \
    || fail "empty-open missing empty-window copy (do not stamp occupied week-window onto empty)"
  grep -q 'data-empty-window' src/http/routes/pages.ts \
    || fail "empty-open missing data-empty-window rolling last-7-days certainty"
  grep -q 'Live rank is the rolling last 7 days from paidAt' src/http/routes/pages.ts \
    || fail "empty-open must name rolling last-7-days from paidAt"
  grep -q 'data-empty-claim-window' src/http/routes/pages.ts \
    || fail "empty-open claim-note missing data-empty-claim-window rolling last-7-days certainty"
  grep -q 'Empty open: name the fair occupied-rank window' src/views/skin.ts \
    || fail "empty-open CSS must document rolling last-7-days copy, not occupied week-window"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] .empty.open-seat[data-empty-honest] .empty-window[data-empty-window]' src/views/skin.ts \
    || fail "empty-open rolling-window CSS must be scoped to empty open-seat"
  grep -q 'Empty open: claim-note names rolling last-7-days beside Claim #1' src/views/skin.ts \
    || fail "empty-open CSS must document claim-note rolling last-7-days beside Claim #1"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] .claim.empty-claim-first[data-empty-claim-first] .claim-note[data-empty-claim-window]' src/views/skin.ts \
    || fail "empty-open claim-note rolling-window CSS must be scoped to empty Claim #1"
  grep -q 'data-later-claim-window' src/http/routes/pages.ts \
    || fail "occupied later-claim missing data-later-claim-window rolling last-7-days certainty"
  grep -q 'Occupied live: later-claim names rolling last-7-days beside Outbid' src/views/skin.ts \
    || fail "occupied CSS must document later-claim rolling last-7-days beside Outbid"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .claim-note[data-later-claim-window]' src/views/skin.ts \
    || fail "occupied later-claim rolling-window CSS must be scoped to occupied later-claim"
  grep -q 'data-later-claim-identity' src/http/routes/pages.ts \
    || fail "occupied later-claim missing later-claim-identity later write"
  grep -q 'Then name, site, one-liner' src/http/routes/pages.ts \
    || fail "occupied later-claim must name identity as a later write after Outbid"
  grep -q 'Occupied live: later-claim identity is a later write after Outbid' src/views/skin.ts \
    || fail "occupied CSS must document later-claim identity as a later write after Outbid"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .later-claim-identity[data-later-claim-identity]' src/views/skin.ts \
    || fail "occupied later-claim identity CSS must be scoped to occupied later-claim"
  grep -q 'data-later-claim-raise' src/http/routes/pages.ts \
    || fail "occupied later-claim missing data-later-claim-raise difference beside Outbid"
  grep -q 'You pay only the difference' src/http/routes/pages.ts \
    || fail "occupied later-claim must name the raise difference beside Outbid"
  grep -q 'Occupied live: later-claim names the raise difference beside Outbid' src/views/skin.ts \
    || fail "occupied CSS must document later-claim raise difference beside Outbid"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .claim-note[data-later-claim-raise]' src/views/skin.ts \
    || fail "occupied later-claim raise CSS must be scoped to occupied later-claim"
  grep -q 'data-later-claim-raise-amount' src/http/routes/pages.ts \
    || fail "occupied later-claim missing data-later-claim-raise-amount on dashed \$amount"
  grep -q 'data-raise-amount-usd' src/http/routes/pages.ts \
    || fail "occupied later-claim missing Polar raise-difference amount on dashed \$amount"
  grep -q 'Polar charges' src/http/routes/pages.ts \
    || fail "occupied later-claim must name the Polar charge as the raise difference on dashed \$amount"
  grep -q 'Occupied live: later-claim names the Polar charge as the raise difference on the dashed' src/views/skin.ts \
    || fail "occupied CSS must document Polar charge as the raise difference on dashed \$amount"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .bid-field[data-later-claim-raise-amount]' src/views/skin.ts \
    || fail "occupied later-claim raise-amount CSS must be scoped to occupied dashed \$amount"
  grep -q 'data-new-bid-usd' src/http/routes/pages.ts \
    || fail "occupied later-claim missing Polar full new bid on dashed \$amount"
  grep -q 'A new guest pays the full bid' src/http/routes/pages.ts \
    || fail "occupied later-claim must name that a new guest pays the full bid"
  grep -q 'Occupied live: later-claim names Polar' src/views/skin.ts \
    || fail "occupied CSS must document Polar full new bid for a new guest"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .bid-field[data-later-claim-raise-amount] .raise-amount[data-raise-amount] [data-new-bid-usd]' src/views/skin.ts \
    || fail "occupied later-claim full-bid CSS must be scoped to occupied dashed \$amount"
  grep -q 'data-raiser-polar-charge' src/http/routes/pages.ts \
    || fail "occupied later-claim missing raiser Polar charge on dashed \$amount"
  grep -q 'data-raise-lead-usd' src/http/routes/pages.ts \
    || fail "occupied later-claim missing Polar raise-lead amount when the guest is raising"
  grep -q 'Same site: only the difference' src/http/routes/pages.ts \
    || fail "occupied later-claim must name Polar charges the raise difference for a same-site raiser"
  grep -q 'data-live-listings' src/http/routes/pages.ts \
    || fail "occupied later-claim missing live listings so a raiser can match the same site"
  grep -q 'Occupied live: later-claim Polar charge leads with the raise difference when the guest is raising' src/views/skin.ts \
    || fail "occupied CSS must document Polar charge leading with the raise difference when raising"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .bid-field[data-later-claim-raise-amount] .raise-amount[data-raise-amount] [data-raiser-polar-charge]' src/views/skin.ts \
    || fail "occupied later-claim raiser Polar-charge CSS must be scoped to occupied dashed \$amount"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .bid-field[data-later-claim-raise-amount] .raise-amount[data-raise-amount] [data-raise-lead-usd]' src/views/skin.ts \
    || fail "occupied later-claim raise-lead CSS must be scoped to occupied dashed \$amount"
  grep -q 'data-new-guest-claim-note' src/http/routes/pages.ts \
    || fail "occupied later-claim missing new-guest claim-note until a site is entered"
  grep -q 'data-raiser-claim-note' src/http/routes/pages.ts \
    || fail "occupied later-claim missing raiser claim-note after the same site is entered"
  grep -q 'data-raiser-claim-usd' src/http/routes/pages.ts \
    || fail "occupied later-claim missing raise-difference amount on the claim-note"
  grep -q 'data-claim-note-lead' src/http/routes/pages.ts \
    || fail "occupied later-claim missing claim-note lead so a raiser is not told they pay a new bid"
  grep -q 'the raise difference, not a full bid' src/http/routes/pages.ts \
    || fail "occupied later-claim must name the raise difference without telling a raiser they pay a new bid"
  grep -q 'Occupied live: later-claim note names the raise difference after the same site is entered' src/views/skin.ts \
    || fail "occupied CSS must document later-claim note naming the raise difference after the same site"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .claim-note[data-later-claim-raise] [data-new-guest-claim-note]' src/views/skin.ts \
    || fail "occupied later-claim new-guest note CSS must be scoped to occupied later-claim"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .claim-note[data-later-claim-raise] [data-raiser-claim-note]' src/views/skin.ts \
    || fail "occupied later-claim raiser note CSS must be scoped to occupied later-claim"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .claim-note[data-later-claim-raise] [data-raiser-claim-usd]' src/views/skin.ts \
    || fail "occupied later-claim raiser note amount CSS must be scoped to occupied later-claim"
  grep -q 'data-new-guest-form-hint' src/http/routes/pages.ts \
    || fail "occupied later-claim missing new-guest form-hint until a site is entered"
  grep -q 'data-raiser-form-hint' src/http/routes/pages.ts \
    || fail "occupied later-claim missing raiser form-hint after the same site is entered"
  grep -q 'data-raiser-form-hint-usd' src/http/routes/pages.ts \
    || fail "occupied later-claim missing raise-difference amount on the form-hint"
  grep -q 'data-form-hint-lead' src/http/routes/pages.ts \
    || fail "occupied later-claim missing form-hint lead so a raiser is not told they pay a new bid"
  grep -q 'data-later-claim-form-hint' src/http/routes/pages.ts \
    || fail "occupied later-claim missing later-claim-form-hint mark"
  grep -q 'Already on this episode: you pay' src/http/routes/pages.ts \
    || fail "occupied later-claim must name the raise difference on the form-hint without telling a raiser they pay a new bid"
  grep -q 'Occupied live: later-claim form-hint names the raise difference after the same site is entered' src/views/skin.ts \
    || fail "occupied CSS must document later-claim form-hint naming the raise difference after the same site"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .form-hint[data-later-claim-form-hint] [data-new-guest-form-hint]' src/views/skin.ts \
    || fail "occupied later-claim new-guest form-hint CSS must be scoped to occupied later-claim"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .form-hint[data-later-claim-form-hint] [data-raiser-form-hint]' src/views/skin.ts \
    || fail "occupied later-claim raiser form-hint CSS must be scoped to occupied later-claim"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .form-hint[data-later-claim-form-hint] [data-raiser-form-hint-usd]' src/views/skin.ts \
    || fail "occupied later-claim raiser form-hint amount CSS must be scoped to occupied later-claim"
  grep -q 'data-raiser-guest' src/http/routes/pages.ts \
    || fail "occupied later-claim missing raiser-guest after the same site is entered"
  grep -q 'data-raiser-guest-name' src/http/routes/pages.ts \
    || fail "occupied later-claim missing matched guest name after the same site is entered"
  grep -q 'Raising' src/http/routes/pages.ts \
    || fail "occupied later-claim must name the matched guest being raised"
  grep -q 'Occupied live: later-claim names the matched guest after the same site is entered' src/views/skin.ts \
    || fail "occupied CSS must document later-claim naming the matched guest after the same site"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .bid-field[data-later-claim-raise-amount] .raise-amount[data-raise-amount] [data-raiser-guest]' src/views/skin.ts \
    || fail "occupied later-claim raiser-guest Polar CSS must be scoped to occupied dashed \$amount"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .claim-note[data-later-claim-raise] [data-raiser-guest]' src/views/skin.ts \
    || fail "occupied later-claim raiser-guest note CSS must be scoped to occupied later-claim"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .form-hint[data-later-claim-form-hint] [data-raiser-guest]' src/views/skin.ts \
    || fail "occupied later-claim raiser-guest form-hint CSS must be scoped to occupied later-claim"
  grep -q 'data-later-claim-outbid' src/http/routes/pages.ts \
    || fail "occupied later-claim missing Outbid mark so a raiser can see which guest the raise submits"
  grep -q 'data-raiser-outbid-guest' src/http/routes/pages.ts \
    || fail "occupied later-claim Outbid missing matched guest after the same site is entered"
  grep -q 'data-raiser-outbid-guest-name' src/http/routes/pages.ts \
    || fail "occupied later-claim Outbid missing matched guest name after the same site is entered"
  grep -q 'Occupied live: later-claim Outbid names the matched guest after the same site is entered' src/views/skin.ts \
    || fail "occupied CSS must document later-claim Outbid naming the matched guest after the same site"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .outbid[data-later-claim-outbid] [data-raiser-outbid-guest]' src/views/skin.ts \
    || fail "occupied later-claim Outbid guest CSS must be scoped to occupied Outbid"
  grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .outbid[data-later-claim-outbid] [data-raiser-outbid-guest-name]' src/views/skin.ts \
    || fail "occupied later-claim Outbid guest-name CSS must be scoped to occupied Outbid"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-later-claim-identity]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied later-claim-identity"
  grep -F -q '.studio.studio-open-empty [data-later-claim-identity]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied later-claim-identity without stamp-only"
  grep -F -q '.studio.studio-open-empty .later-claim-identity' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-claim-identity class"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-later-claim-raise]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied later-claim-raise"
  grep -F -q '.studio.studio-open-empty [data-later-claim-raise]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied later-claim-raise without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-later-claim-raise-amount]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied later-claim-raise-amount"
  grep -F -q '.studio.studio-open-empty [data-later-claim-raise-amount]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied later-claim-raise-amount without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-raise-amount]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raise-amount"
  grep -F -q '.studio.studio-open-empty [data-raise-amount]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raise-amount without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-new-bid-usd]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied new-bid-usd"
  grep -F -q '.studio.studio-open-empty [data-new-bid-usd]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied new-bid-usd without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-new-guest-polar-charge]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied new-guest Polar charge"
  grep -F -q '.studio.studio-open-empty [data-new-guest-polar-charge]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied new-guest Polar charge without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-raiser-polar-charge]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser Polar charge"
  grep -F -q '.studio.studio-open-empty [data-raiser-polar-charge]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser Polar charge without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-raise-lead-usd]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raise-lead-usd"
  grep -F -q '.studio.studio-open-empty [data-raise-lead-usd]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raise-lead-usd without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-new-guest-claim-note]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied new-guest claim-note"
  grep -F -q '.studio.studio-open-empty [data-new-guest-claim-note]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied new-guest claim-note without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-raiser-claim-note]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser claim-note"
  grep -F -q '.studio.studio-open-empty [data-raiser-claim-note]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser claim-note without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-raiser-claim-usd]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser-claim-usd"
  grep -F -q '.studio.studio-open-empty [data-raiser-claim-usd]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser-claim-usd without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-claim-note-lead]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied claim-note-lead"
  grep -F -q '.studio.studio-open-empty [data-claim-note-lead]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied claim-note-lead without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-later-claim-form-hint]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied later-claim-form-hint"
  grep -F -q '.studio.studio-open-empty [data-later-claim-form-hint]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied later-claim-form-hint without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-new-guest-form-hint]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied new-guest form-hint"
  grep -F -q '.studio.studio-open-empty [data-new-guest-form-hint]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied new-guest form-hint without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-raiser-form-hint]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser form-hint"
  grep -F -q '.studio.studio-open-empty [data-raiser-form-hint]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser form-hint without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-raiser-form-hint-usd]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser-form-hint-usd"
  grep -F -q '.studio.studio-open-empty [data-raiser-form-hint-usd]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser-form-hint-usd without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-form-hint-lead]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied form-hint-lead"
  grep -F -q '.studio.studio-open-empty [data-form-hint-lead]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied form-hint-lead without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-raiser-guest]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser-guest"
  grep -F -q '.studio.studio-open-empty [data-raiser-guest]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser-guest without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-raiser-guest-name]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser-guest-name"
  grep -F -q '.studio.studio-open-empty [data-raiser-guest-name]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser-guest-name without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-later-claim-outbid]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied later-claim-outbid"
  grep -F -q '.studio.studio-open-empty [data-later-claim-outbid]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied later-claim-outbid without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-raiser-outbid-guest]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser-outbid-guest"
  grep -F -q '.studio.studio-open-empty [data-raiser-outbid-guest]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser-outbid-guest without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-raiser-outbid-guest-name]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser-outbid-guest-name"
  grep -F -q '.studio.studio-open-empty [data-raiser-outbid-guest-name]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied raiser-outbid-guest-name without stamp-only"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-live-listings]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied live-listings"
  grep -F -q '.studio.studio-open-empty [data-live-listings]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied live-listings without stamp-only"
  grep -F -q '.studio.studio-open-empty .raise-amount' src/views/skin.ts \
    || fail "empty-open shell must hide leaked raise-amount class"
  if grep -F -q '.studio.studio-open-occupied .claim.later-claim[data-later-claim] .listing-identity[data-later-write]' src/views/skin.ts; then
    fail "do not stamp empty later-write onto occupied later-claim"
  fi
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-later-claim-window]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied later-claim-window"
  grep -F -q '.studio.studio-open-empty [data-later-claim-window]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied later-claim-window without stamp-only"
  if grep -nE 'lock-after-open-six|data-rolling-after|rolling-after-N|empty-window-after|data-empty-rolling-after|empty-claim-window-after|data-empty-claim-after|claim-window-after|later-claim-window-after|occupied-claim-window-after|data-later-claim-after|later-claim-identity-after|occupied-later-write-after|later-claim-raise-after|occupied-raise-after|raise-after-outbid|data-later-claim-raise-after|later-claim-raise-amount-after|occupied-raise-amount-after|raise-amount-after-outbid|data-later-claim-raise-amount-after|later-claim-new-bid-after|occupied-new-bid-after|new-bid-after-outbid|later-claim-full-bid-after|occupied-full-bid-after|later-claim-raise-lead-after|occupied-raise-lead-after|raise-lead-after-outbid|later-claim-raise-lead-N|occupied-raise-lead-N|later-claim-note-raise-after|occupied-claim-note-after|claim-note-raise-after|later-claim-note-after|occupied-note-raise-after|claim-note-lead-after|later-claim-form-hint-after|occupied-form-hint-after|form-hint-raise-after|later-claim-hint-after|form-hint-lead-after|occupied-hint-raise-after|form-hint-after-site|occupied-form-hint-N|later-claim-form-hint-N|later-claim-raise-guest-after|occupied-raise-guest-after|raise-guest-after|later-claim-guest-after|raiser-guest-after|occupied-guest-raise-after|raise-guest-after-site|later-claim-raise-guest-N|occupied-raise-guest-N|raiser-guest-after-site|later-claim-outbid-after|occupied-outbid-guest-after|outbid-guest-after|outbid-after-guest|later-claim-outbid-N|occupied-outbid-N|raiser-outbid-after|outbid-guest-after-site' \
    src/http/routes/pages.ts src/views/skin.ts >/dev/null; then
    fail "do not stamp another named hop; name rolling last-7-days on empty copy"
  fi
  grep -F -q $'${ticket}\n${rundown}\n${claim}\n${desk}' src/http/routes/pages.ts \
    || fail "occupied live Claim must render after the rundown, not above the #1 guest"
  grep -q 'data-later-seat' src/http/routes/pages.ts || fail "occupied later seat missing later-seat mark"
  grep -q 'later-seat' src/http/routes/pages.ts || fail "occupied later seat missing later-seat class"
  grep -q 'data-later-seat' src/views/skin.ts || fail "occupied later seat missing later-seat CSS"
  grep -q 'data-later-go' src/http/routes/pages.ts || fail "occupied later seat missing quieter /go mark"
  grep -q 'later-name' src/http/routes/pages.ts || fail "occupied later seat missing quieter guest name"
  grep -q 'data-later-foot' src/http/routes/pages.ts || fail "occupied later seat missing later-foot composition"
  grep -q 'class="later-foot"' src/http/routes/pages.ts || fail "occupied later seat missing later-foot class"
  grep -q 'guest.later-seat\[data-later-seat\]' src/views/skin.ts || fail "later seats must stay quieter than occupied #1"
  grep -q 'later-foot\[data-later-foot\]' src/views/skin.ts || fail "later-foot CSS must keep /go and \$bid quieter than #1 guest"
  grep -q 'export const STUDIO_CSS' src/views/skin.ts || fail "empty-open studio CSS missing STUDIO_CSS"
  grep -q 'export const OCCUPIED_CSS' src/views/skin.ts || fail "occupied guest-one-first CSS missing OCCUPIED_CSS"
  grep -F -q '.studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-name' src/views/skin.ts \
    || fail "occupied #1 guest prize CSS must be scoped to Polar-paid studio-open-occupied"
  grep -F -q '.studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-name a[data-first-click="guest"]' src/views/skin.ts \
    || fail "occupied #1 guest first-click CSS must be scoped to Polar-paid studio-open-occupied"
  grep -q 'class="later-facts"' src/http/routes/pages.ts \
    || fail "occupied #1 guest missing later-facts composition"
  grep -q 'data-later-facts' src/http/routes/pages.ts \
    || fail "occupied #1 guest missing later-facts stamp"
  grep -F -q '.studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .later-facts[data-later-facts]' src/views/skin.ts \
    || fail "occupied #1 later-facts CSS must be scoped to Polar-paid studio-open-occupied"
  grep -F -q '.studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at]' src/views/skin.ts \
    || fail "later-seat CSS must be scoped to Polar-paid studio-open-occupied"
  grep -F -q '.studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-foot[data-later-foot]' src/views/skin.ts \
    || fail "later-foot CSS must be scoped to Polar-paid studio-open-occupied"
  if grep -E '^\.guest\[data-guest-prize\]' src/views/skin.ts >/dev/null; then
    fail "guest-prize CSS must not leak globally onto empty open"
  fi
  if grep -E '^\.guest\.later-seat\[data-later-seat\]' src/views/skin.ts >/dev/null; then
    fail "later-seat CSS must not leak globally onto empty open"
  fi
  if grep -E '^\.later-foot' src/views/skin.ts >/dev/null; then
    fail "later-foot CSS must not leak globally onto empty open"
  fi
  if grep -E '^\.later-facts' src/views/skin.ts >/dev/null; then
    fail "later-facts CSS must not leak globally onto empty open"
  fi
  if grep -nE 'data-prize-not-foot|data-later-foot-first|later-foot-after' \
    src/http/routes/pages.ts src/views/skin.ts >/dev/null; then
    fail "do not stamp another named hop; compose prize later-facts vs later-foot"
  fi
  if grep -nE 'data-lock-after-rundown|data-guest-before-lock|lock-after-guest|data-lock-after-guest' \
    src/http/routes/pages.ts src/views/skin.ts >/dev/null; then
    fail "do not stamp another named hop; compose occupied Lock after the rundown"
  fi
  if grep -nE 'data-guest-before-claim|data-claim-after-guest|claim-after-guest|guest-before-claim-N' \
    src/http/routes/pages.ts src/views/skin.ts >/dev/null; then
    fail "do not stamp another named hop; compose occupied Claim after the #1 guest"
  fi
  if grep -E '^\.claim\.later-claim' src/views/skin.ts >/dev/null; then
    fail "later-claim CSS must not leak globally onto empty open"
  fi
  if grep -E '^\.later-claim' src/views/skin.ts >/dev/null; then
    fail "later-claim CSS must not leak globally onto empty open"
  fi
  grep -q 'paidListings' src/http/routes/pages.ts \
    || fail "rundown occupancy must compose Polar-paid rows only"
  grep -q 'isPaidListing' src/http/routes/pages.ts \
    || fail "guest card must refuse unpaid Polar checkout as #1"
  grep -q 'isPaidListing' src/http/routes/go.ts \
    || fail "/go must 404 unpaid Polar checkout"
  if grep -nE 'data-unpaid-off|data-paid-only-rundown|data-unpaid-off-board|lock-after-open-six' \
    src/http/routes/pages.ts src/views/skin.ts src/http/routes/go.ts >/dev/null; then
    fail "unpaid-off occupancy must not add another named hop"
  fi
  grep -F -q $'${rundown}\n${claim}\n${desk}' src/http/routes/pages.ts \
    || fail "occupied live host Lock must render after the rundown (Claim is a later write between them)"
  grep -q 'data-later-fact' src/http/routes/pages.ts || fail "live ranked seat missing later-fact \$bid stamp"
  grep -q 'later-fact' src/http/routes/pages.ts || fail "live ranked seat missing later-fact \$bid class"
  grep -q 'data-later-fact' src/views/skin.ts || fail "live ranked seat missing later-fact \$bid CSS"
  grep -q 'bid.later-fact\[data-later-fact\]' src/views/skin.ts || fail "later-fact \$bid must stay muted beside the guest label"
  grep -q 'Polar cannot charge' src/http/routes/pages.ts \
    || fail "empty episode must explain Polar cannot charge"
  grep -q 'data-empty-board' src/http/routes/pages.ts || fail "board missing honest empty"
  grep -q 'data-guest-skip' src/http/routes/pages.ts || fail "host desk missing guest-skip"
  grep -q 'Guests skip this' src/http/routes/pages.ts || fail "host desk missing guests-skip copy"
  grep -q 'data-host-lock' src/http/routes/pages.ts || fail "occupied board missing host lock desk"
  grep -q 'class="lock-episode"' src/http/routes/pages.ts || fail "host lock desk missing lock-episode control"
  grep -q 'class="open-next"' src/http/routes/pages.ts || fail "host desk missing open-next control"
  grep -q 'data-open-next' src/http/routes/pages.ts || fail "locked host desk missing data-open-next"
  grep -q 'data-open-after-lock' src/http/routes/pages.ts || fail "locked host desk missing data-open-after-lock"
  grep -q 'data-open-after-lock-first' src/http/routes/pages.ts || fail "locked host desk missing data-open-after-lock-first"
  grep -q 'open-after-lock-first' src/views/skin.ts || fail "open-after-lock-first desk missing hop-local CSS"
  grep -q 'data-open-after-lock-two' src/http/routes/pages.ts || fail "locked host desk missing data-open-after-lock-two"
  grep -q 'open-after-lock-two' src/views/skin.ts || fail "open-after-lock-two desk missing hop-local CSS"
  grep -q 'data-open-after-lock-three' src/http/routes/pages.ts || fail "locked host desk missing data-open-after-lock-three"
  grep -q 'open-after-lock-three' src/views/skin.ts || fail "open-after-lock-three desk missing hop-local CSS"
  grep -q 'data-open-after-lock-four' src/http/routes/pages.ts || fail "locked host desk missing data-open-after-lock-four"
  grep -q 'open-after-lock-four' src/views/skin.ts || fail "open-after-lock-four desk missing hop-local CSS"
  grep -q 'data-open-after-lock-five' src/http/routes/pages.ts || fail "locked host desk missing data-open-after-lock-five"
  grep -q 'open-after-lock-five' src/views/skin.ts || fail "open-after-lock-five desk missing hop-local CSS"
  grep -q 'data-lock-after-open' src/http/routes/pages.ts || fail "locked claim missing data-lock-after-open"
  grep -q 'data-lock-after-open-first' src/http/routes/pages.ts || fail "locked claim missing data-lock-after-open-first"
  grep -q 'lock-after-open-first' src/views/skin.ts || fail "lock-after-open-first claim missing hop-local CSS"
  grep -q 'data-lock-after-open-two' src/http/routes/pages.ts || fail "locked claim missing data-lock-after-open-two"
  grep -q 'lock-after-open-two' src/views/skin.ts || fail "lock-after-open-two claim missing hop-local CSS"
  grep -q 'data-lock-after-open-three' src/http/routes/pages.ts || fail "locked claim missing data-lock-after-open-three"
  grep -q 'lock-after-open-three' src/views/skin.ts || fail "lock-after-open-three claim missing hop-local CSS"
  grep -q 'data-lock-after-open-four' src/http/routes/pages.ts || fail "locked claim missing data-lock-after-open-four"
  grep -q 'lock-after-open-four' src/views/skin.ts || fail "lock-after-open-four claim missing hop-local CSS"
  grep -q 'data-lock-after-open-five' src/http/routes/pages.ts || fail "locked claim missing data-lock-after-open-five"
  grep -q 'lock-after-open-five' src/views/skin.ts || fail "lock-after-open-five claim missing hop-local CSS"
  grep -q 'data-open-seat' src/http/routes/pages.ts || fail "fresh-open board missing data-open-seat"
  grep -q 'data-empty-honest' src/http/routes/pages.ts || fail "fresh-open board missing empty-honest stamp"
  grep -q 'data-empty-honest' src/views/skin.ts || fail "fresh-open board missing empty-honest CSS"
  grep -q 'studio-open-empty' src/http/routes/pages.ts || fail "fresh-open board missing empty-open studio shell"
  grep -q 'studio-open-occupied' src/http/routes/pages.ts || fail "occupied live board missing occupied studio shell"
  grep -q 'studio-locked' src/http/routes/pages.ts || fail "locked board missing locked studio shell"
  grep -q 'studio-open-empty' src/views/skin.ts || fail "empty-open shell missing isolation CSS"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-guest-prize]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked guest-prize chrome"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-first-click="guest"]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked #1 guest first-click"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-later-seat]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-seat chrome"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-later-go]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-seat /go"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-later-foot]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-foot chrome"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-later-facts]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-facts chrome"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-later-claim]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied later-claim"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-paid-at]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked Polar paid-at chrome"
  grep -F -q '.studio.studio-open-empty [data-guest-prize]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked guest-prize without stamp-only"
  grep -F -q '.studio.studio-open-empty [data-first-click="guest"]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked #1 guest first-click without stamp-only"
  grep -F -q '.studio.studio-open-empty [data-later-seat]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-seat without stamp-only"
  grep -F -q '.studio.studio-open-empty [data-later-go]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-seat /go without stamp-only"
  grep -F -q '.studio.studio-open-empty [data-later-foot]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-foot without stamp-only"
  grep -F -q '.studio.studio-open-empty [data-later-facts]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-facts without stamp-only"
  grep -F -q '.studio.studio-open-empty [data-later-claim]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked occupied later-claim without stamp-only"
  grep -F -q '.studio.studio-open-empty [data-paid-at]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked Polar paid-at without stamp-only"
  grep -F -q '.studio.studio-open-empty .later-fact' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-fact class"
  grep -F -q '.studio.studio-open-empty .later-facts' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-facts class"
  grep -F -q '.studio.studio-open-empty .later-claim' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-claim class"
  grep -F -q '.studio.studio-open-empty .guest.later-seat' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-seat class"
  grep -F -q '.studio.studio-open-empty .later-foot' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-foot class"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-later-fact]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked later-fact \$bid"
  grep -F -q '.studio.studio-open-empty[data-empty-honest] [data-lock-certain]' src/views/skin.ts \
    || fail "empty-open shell must hide leaked lock-certain chrome"
  grep -F -q '.studio.studio-open-occupied .empty.open-seat' src/views/skin.ts \
    || fail "occupied live board must hide empty-open \$5 slab"
  grep -q 'function studioShell' src/http/routes/pages.ts || fail "board missing studioShell isolation"
  if grep -Eq 'empty-honest-(first|six|after)|studio-after-empty-N' src/http/routes/pages.ts src/views/skin.ts; then
    fail "empty-open isolation must not stamp *-after-*-N"
  fi
  grep -q 'data-claim-live' src/http/routes/pages.ts || fail "open claim missing data-claim-live"
  grep -q 'data-claim-locked' src/http/routes/pages.ts || fail "locked board missing data-claim-locked"
  grep -q 'data-lock-certain' src/http/routes/pages.ts || fail "locked claim missing data-lock-certain"
  grep -q 'data-lock-certain' src/views/skin.ts || fail "locked claim missing lock-certain CSS"
  grep -q 'data-lock-409' src/http/routes/pages.ts || fail "locked claim missing data-lock-409"
  grep -q 'data-lock-409' src/views/skin.ts || fail "locked checkout missing lock-409 CSS"
  grep -q 'data-next-seat' src/http/routes/pages.ts || fail "N+1 board missing data-next-seat"
  grep -q 'takes #1' src/http/routes/pages.ts || fail "fresh-open board missing \$5 takes #1"
  grep -q 'clicks' src/http/routes/pages.ts || fail "guest card missing public clicks"
  if grep -Eqi 'featured guest|play count|followers' src/http/routes/pages.ts src/views/skin.ts; then
    fail "product UI must not invent featured-guest art or play counts"
  fi

  echo "== Polar checkout + fixture source =="
  for f in src/polar/port.ts src/polar/fixture.ts src/polar/live.ts \
    src/http/routes/checkout.ts tests/polar.test.ts; do
    [[ -f "$f" ]] || fail "missing $f"
    [[ -s "$f" ]] || fail "empty $f"
  done
  grep -q 'PolarPort' src/polar/port.ts || fail "src/polar/port.ts missing PolarPort"
  grep -q 'createCheckout' src/polar/port.ts \
    || fail "src/polar/port.ts missing createCheckout"
  grep -q 'POLAR_FIXTURE_ONLY' src/polar/port.ts \
    || fail "src/polar/port.ts missing POLAR_FIXTURE_ONLY"
  grep -q 'FixturePolar' src/polar/fixture.ts \
    || fail "src/polar/fixture.ts missing FixturePolar"
  grep -q 'LivePolar' src/polar/live.ts || fail "src/polar/live.ts missing LivePolar"
  grep -q 'POLAR_LIVE' src/polar/live.ts || fail "src/polar/live.ts missing POLAR_LIVE gate"
  grep -q 'POST' src/http/routes/checkout.ts \
    || fail "src/http/routes/checkout.ts missing POST"
  grep -q '/checkout' src/http/routes/checkout.ts \
    || fail "src/http/routes/checkout.ts missing /checkout"
  grep -q 'POLAR_FIXTURE_ONLY' tests/polar.test.ts \
    || fail "tests/polar.test.ts missing fixture-wins"
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
  grep -q 'hostRoutes' src/app.ts || fail "src/app.ts must register hostRoutes"
  if grep -Eqi 'POLAR_LIVE=1|https?://([^/]*\.)?polar\.sh' src/veto.ts \
    src/http/routes/host.ts tests/veto.test.ts; then
    fail "veto/lock must stay offline (no live Polar)"
  fi

  echo "== deploy artifacts (Dockerfile + runbook) =="
  [[ -f Dockerfile ]] || fail "missing Dockerfile"
  [[ -f .env.example ]] || fail "missing .env.example"
  [[ -f deploy/runbook.md ]] || fail "missing deploy/runbook.md"
  grep -q 'node:22' Dockerfile || fail "Dockerfile must use Node 22"
  grep -qE '^USER[[:space:]]+node$' Dockerfile || fail "Dockerfile must run as non-root USER node"
  grep -q 'PORT' Dockerfile || fail "Dockerfile must honor PORT"
  grep -q 'src/server.ts' Dockerfile || fail "Dockerfile must start src/server.ts"
  if grep -E 'POLAR_LIVE[[:space:]]*=[[:space:]]*(1|true|yes|on)' Dockerfile >/dev/null; then
    fail "Dockerfile must not set POLAR_LIVE=1"
  fi
  if grep -E 'POLAR_(ACCESS_TOKEN|WEBHOOK_SECRET)[[:space:]]*=' Dockerfile >/dev/null; then
    fail "Dockerfile must not bake Polar secrets"
  fi
  grep -q 'POLAR_LIVE' .env.example || fail ".env.example missing POLAR_LIVE"
  grep -q 'POLAR_FIXTURE_ONLY' .env.example || fail ".env.example missing POLAR_FIXTURE_ONLY"
  grep -q 'DATABASE_PATH' .env.example || fail ".env.example missing DATABASE_PATH"
  grep -q 'HOST_SESSION_SECRET' .env.example || fail ".env.example missing HOST_SESSION_SECRET"
  grep -q 'POLAR_ACCESS_TOKEN' .env.example || fail ".env.example missing POLAR_ACCESS_TOKEN"
  grep -q 'POLAR_WEBHOOK_SECRET' .env.example || fail ".env.example missing POLAR_WEBHOOK_SECRET"
  grep -q 'POLAR_API_BASE' .env.example || fail ".env.example missing POLAR_API_BASE"
  grep -q 'POLAR_PRODUCT_ID' .env.example || fail ".env.example missing POLAR_PRODUCT_ID"
  if grep -E '^[[:space:]]*POLAR_LIVE=1[[:space:]]*$' .env.example >/dev/null; then
    fail ".env.example must not default POLAR_LIVE on"
  fi
  if grep -E '^[[:space:]]*POLAR_(ACCESS_TOKEN|WEBHOOK_SECRET)=' .env.example >/dev/null; then
    fail ".env.example must keep Polar secrets commented"
  fi
  grep -q 'POLAR_API_BASE' src/polar/port.ts || fail "src/polar/port.ts missing POLAR_API_BASE override"
  grep -q 'polarApiBase' src/polar/live.ts || fail "src/polar/live.ts must honor POLAR_API_BASE"
  grep -q '/healthz' deploy/runbook.md || fail "runbook missing /healthz"
  grep -q 'POLAR_LIVE=1' deploy/runbook.md || fail "runbook missing how to enable live Polar"
  grep -q 'docker build' deploy/runbook.md || fail "runbook missing docker build"
  grep -q 'docker run' deploy/runbook.md || fail "runbook missing docker run"
  grep -q 'Caddy' deploy/runbook.md || fail "runbook missing Caddy"
  grep -q 'guest seat' deploy/runbook.md || fail "runbook missing guest-seat product"
  if grep -E 'POLAR_LIVE[[:space:]]*=[[:space:]]*1' .github/workflows/ci.yml >/dev/null; then
    fail "CI must not set POLAR_LIVE=1"
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
  grep -q '/healthz' "$test_log" || fail "healthz test did not run"
  grep -q 'new episode does not carry old bids' "$test_log" \
    || fail "episode isolation test did not run"
  grep -q 'guest-seat episode defaults vetoEnabled to true' "$test_log" \
    || fail "guest_seat veto default test did not run"
  grep -q '60-second episode defaults vetoEnabled to false' "$test_log" \
    || fail "sixty_second_open veto default test did not run"
  grep -q 'first bid $5 on empty guest-seat episode is rank #1 after payment' "$test_log" \
    || fail "SPEC 1 rank test did not run"
  grep -q 'bid $4 is rejected (min $5)' "$test_log" \
    || fail "SPEC 2 rank test did not run"
  grep -q 'two listings, $10 then $12' "$test_log" \
    || fail "SPEC 3 rank test did not run"
  grep -q 'older firstBidAt is #1' "$test_log" \
    || fail "SPEC 4 rank test did not run"
  grep -q 'raise own $10 to $13' "$test_log" \
    || fail "SPEC 5 rank test did not run"
  grep -q 'other bidder cannot pay only the $1 difference' "$test_log" \
    || fail "SPEC 6 rank test did not run"
  grep -q 'URL with ?utm_source=x is stored and /go has no query' "$test_log" \
    || fail "SPEC 7 hygiene test did not run"
  grep -q 'Discord / Telegram invite is rejected' "$test_log" \
    || fail "SPEC 8 hygiene test did not run"
  grep -q 'NSFW host is rejected' "$test_log" \
    || fail "SPEC 9 hygiene test did not run"
  grep -q 'public click /go/:id 302 + clicks increment' "$test_log" \
    || fail "SPEC 15 public click test did not run"
  grep -q 'GET /about describes the seat' "$test_log" \
    || fail "about page test did not run"
  grep -q 'GET /rules states min $5' "$test_log" \
    || fail "rules page test did not run"
  grep -q 'GET / with no episode keeps the claim visible' "$test_log" \
    || fail "no-episode claim chrome test did not run"
  grep -q 'GET / with no episode points first-time guests' "$test_log" \
    || fail "no-episode waiting-path test did not run"
  grep -q 'GET / with no episode shows a first-time host desk' "$test_log" \
    || fail "no-episode host-desk test did not run"
  grep -q 'GET / with no episode tells first-time guests to skip the host desk' "$test_log" \
    || fail "guest-skip host-desk test did not run"
  grep -q 'POST /host/open from the desk opens a guest-seat episode' "$test_log" \
    || fail "host-open desk test did not run"
  grep -q 'GET / on an occupied open episode makes locking the episode the host action' "$test_log" \
    || fail "host-lock occupied desk test did not run"
  grep -q 'POST /host/lock from the desk locks the occupied episode' "$test_log" \
    || fail "host-lock desk post test did not run"
  grep -q 'GET / after lock makes opening the next empty episode the host action' "$test_log" \
    || fail "host-open next-episode test did not run"
  grep -q 'GET / after lock makes the host desk the certain next host action' "$test_log" \
    || fail "open-after-lock host-desk test did not run"
  grep -q 'GET / after lock makes the locked episode certain for a first-time guest' "$test_log" \
    || fail "locked-guest first-user test did not run"
  grep -q 'GET / after lock concentrates the locked episode after the host desk moved up' "$test_log" \
    || fail "lock-after-open guest first-read test did not run"
  grep -q 'GET / after lock concentrates opening the next empty episode after the locked claim is first' "$test_log" \
    || fail "open-after-lock-first host-desk test did not run"
  grep -q 'GET / after lock concentrates the locked episode after Open N+1 is concentrated' "$test_log" \
    || fail "lock-after-open-first guest first-read test did not run"
  grep -q 'GET / after lock concentrates opening the next empty episode after the locked claim is re-concentrated' "$test_log" \
    || fail "open-after-lock-two host-desk test did not run"
  grep -q 'GET / after lock concentrates the locked episode after Open N+1 is re-concentrated' "$test_log" \
    || fail "lock-after-open-two guest first-read test did not run"
  grep -q 'GET / after lock concentrates opening the next empty episode after the locked claim is louder' "$test_log" \
    || fail "open-after-lock-three host-desk test did not run"
  grep -q 'GET / after lock concentrates the locked episode after Open N+1 is louder' "$test_log" \
    || fail "lock-after-open-three guest first-read test did not run"
  grep -q 'GET / after lock concentrates opening the next empty episode after the locked claim is re-concentrated again' "$test_log" \
    || fail "open-after-lock-four host-desk test did not run"
  grep -q 'GET / after lock concentrates the locked episode after Open N+1 is re-concentrated again' "$test_log" \
    || fail "lock-after-open-four guest first-read test did not run"
  grep -q 'GET / after lock concentrates opening the next empty episode after the locked claim is re-concentrated again, once more' "$test_log" \
    || fail "open-after-lock-five host-desk test did not run"
  grep -q 'GET / after lock concentrates the locked episode after Open N+1 is re-concentrated again, once more' "$test_log" \
    || fail "lock-after-open-five guest first-read test did not run"
  grep -q 'GET / after lock keeps Episode N is locked the first read' "$test_log" \
    || fail "lock-certain first-read test did not run"
  grep -q 'GET / after lock still fail-closes checkout 409' "$test_log" \
    || fail "locked checkout 409 test did not run"
  grep -q 'GET / after the host opens N+1 makes bidding that empty seat live' "$test_log" \
    || fail "N+1 first-guest bid test did not run"
  grep -q 'GET / on a fresh-open empty episode makes bidding the guest seat live' "$test_log" \
    || fail "open-seat first-guest test did not run"
  grep -q 'GET / on a fresh-open empty episode stays empty-honest' "$test_log" \
    || fail "fresh-open empty-honest test did not run"
  grep -q 'GET / on a fresh-open empty episode isolates \$5 from lock / prize leak' "$test_log" \
    || fail "fresh-open empty-open isolation test did not run"
  grep -q 'GET / on a fresh-open empty episode keeps \$5 honest' "$test_log" \
    || fail "fresh-open empty-open guest-one-first leak isolation test did not run"
  grep -q 'GET / on a fresh-open empty episode has one first click' "$test_log" \
    || fail "empty-open Claim #1 then guest-site later-write test did not run"
  grep -q 'studio rundown is a guest card' "$test_log" \
    || fail "studio guest-card test did not run"
  grep -q 'GET / on a live ranked seat reads the guest label first' "$test_log" \
    || fail "live prize-before-price test did not run"
  grep -q 'GET / on an occupied live seat keeps \$bid a later fact' "$test_log" \
    || fail "occupied live later-fact \$bid test did not run"
  grep -q 'GET / on occupied live keeps #1 guest the first click' "$test_log" \
    || fail "occupied live #1 guest first-click test did not run"
  grep -q 'GET / on occupied live keeps later seats quieter than #1 guest' "$test_log" \
    || fail "occupied live later-seat quiet test did not run"
  grep -q 'GET / on occupied live keeps #1 guest prize chrome' "$test_log" \
    || fail "occupied live prize-not-foot test did not run"
  grep -q 'GET / on occupied live keeps one first click' "$test_log" \
    || fail "occupied live host Lock after rundown test did not run"
  grep -q 'Claim stays after the #1 guest' "$test_log" \
    || fail "occupied live Claim after #1 guest leftover test did not run"
  grep -q 'occupied week window is rolling last-7-days' "$test_log" \
    || fail "occupied live rolling last-7-days window test did not run"
  grep -q 'GET / on a fresh-open empty episode names rolling last-7-days' "$test_log" \
    || fail "empty-open rolling last-7-days copy test did not run"
  grep -q 'GET / on a fresh-open empty episode names rolling last-7-days on the claim-note' "$test_log" \
    || fail "empty-open claim-note rolling last-7-days test did not run"
  grep -q 'GET / on occupied live names rolling last-7-days on later-claim' "$test_log" \
    || fail "occupied later-claim rolling last-7-days test did not run"
  grep -q 'GET / on occupied live keeps later-claim identity a later write after Outbid' "$test_log" \
    || fail "occupied later-claim identity later-write test did not run"
  grep -q 'GET / on occupied live names the raise difference on later-claim' "$test_log" \
    || fail "occupied later-claim raise difference beside Outbid test did not run"
  grep -q 'GET / on occupied live names the Polar charge as the raise difference on later-claim dashed' "$test_log" \
    || fail "occupied later-claim dashed \$amount raise difference test did not run"
  grep -q 'GET / on occupied live names Polar' "$test_log" \
    || fail "occupied later-claim new-guest full bid test did not run"
  grep -q 'later-claim note names the raise difference after the same site' "$test_log" \
    || fail "occupied later-claim note raise-difference after same site test did not run"
  grep -q 'later-claim form-hint names the raise difference after the same site' "$test_log" \
    || fail "occupied later-claim form-hint raise-difference after same site test did not run"
  grep -q 'later-claim names the matched guest after the same site' "$test_log" \
    || fail "occupied later-claim matched guest after same site test did not run"
  grep -q 'later-claim Outbid names the matched guest after the same site' "$test_log" \
    || fail "occupied later-claim Outbid matched guest after same site test did not run"
  grep -q 'rolling last-7-days window is 7' "$test_log" \
    || fail "rolling last-7-days window math test did not run"
  grep -q 'Monday 00:00 UTC does not drop a bid still inside the rolling week' "$test_log" \
    || fail "Monday midnight rolling-week test did not run"
  grep -q 'unpaid stays off the rundown' "$test_log" \
    || fail "unpaid stays off the rundown leftover test did not run"
  grep -q 'No #1 guest until Polar reports paid' "$test_log" \
    || fail "unpaid-off Polar paid leftover test did not run"
  grep -q 'HTML Outbid form posts to /checkout' "$test_log" \
    || fail "HTML Outbid form test did not run"
  grep -q 'fixture checkout without network claims rank' "$test_log" \
    || fail "SPEC 16 polar fixture test did not run"
  grep -q 'POLAR_LIVE unset in test' "$test_log" \
    || fail "SPEC 17 no-live-Polar test did not run"
  grep -q 'POLAR_FIXTURE_ONLY=1 wins' "$test_log" \
    || fail "POLAR_FIXTURE_ONLY wins test did not run"
  grep -q 'guest-seat episode default flag is vetoEnabled === true' "$test_log" \
    || fail "SPEC 10 guest-seat veto default test did not run"
  grep -q '60-second episode default flag is vetoEnabled === false' "$test_log" \
    || fail "SPEC 11 sixty-second veto default test did not run"
  grep -q 'Veto #1 on guest seat' "$test_log" \
    || fail "SPEC 12 veto #1 test did not run"
  grep -q 'Veto when flag off is 403' "$test_log" \
    || fail "SPEC 13 veto-when-off test did not run"
  grep -q 'lock freezes the episode' "$test_log" \
    || fail "lock freeze test did not run"
  grep -q 'veto flag is frozen after the first paid bid' "$test_log" \
    || fail "veto flag freeze test did not run"
  if grep -Eqi 'polar\.(sh|in)|api\.polar' "$test_log"; then
    fail "unit tests must not call live Polar hosts"
  fi
fi

echo "OK: buildable and testable"
