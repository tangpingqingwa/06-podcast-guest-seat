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

  unset POLAR_LIVE POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET POLAR_ACCESS_TOKEN
  export POLAR_FIXTURE_ONLY=1
  [[ "${POLAR_LIVE:-}" != "1" ]] || fail "POLAR_LIVE must stay unset in test.sh"

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
fi

echo "OK: buildable and testable"
