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

  unset POLAR_LIVE POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET
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
  if grep -Eqi 'polar\.(sh|in)|api\.polar' "$test_log"; then
    fail "unit tests must not call live Polar hosts"
  fi
fi

echo "OK: buildable and testable"
