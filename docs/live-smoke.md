# Live smoke — Podcast Guest Seat

Operator-only. `bash scripts/live-smoke.sh` is **not** called from `scripts/test.sh` or GitHub Actions. CI and `scripts/test.sh` stay offline and must not set `POLAR_LIVE`.

`100%` for this unit means a **local process** walked list → bid → rank → Polar fixture or live checkout → public click → guest-seat veto. Fixture checkout is the default path. Live Polar runs only when `POLAR_LIVE=1` and secrets exist. Missing Polar secret is `BLOCKED-SECRET` naming the exact env var — that is not a fixture success. Do not invent listings. An empty guest-seat board is valid.

## How to run

```bash
bash scripts/live-smoke.sh
```

The script:

1. Refuses `CI=true` / `GITHUB_ACTIONS=true` (override only with `LIVE_SMOKE_ALLOW_CI=1` for a local dry-run, never in Actions).
2. Seeds one `guest_seat` episode (`vetoEnabled` default on) into a temp SQLite file.
3. Starts `node --import tsx src/server.ts` on a free loopback port with Polar env unset and `POLAR_FIXTURE_ONLY=1`.
4. Or attaches to `LIVE_SMOKE_BASE` if that server already answers `GET /healthz`.
5. Walks list, bid, fixture checkout, rank, public click, guest-seat veto.
6. Live Polar: if `POLAR_LIVE=1` and `POLAR_ACCESS_TOKEN` is set, starts a second local process with `POLAR_FIXTURE_ONLY` unset. Missing token is `BLOCKED-SECRET: POLAR_ACCESS_TOKEN`.
7. Kills the process it started and deletes the temp database.

Overrides: `LIVE_SMOKE_BASE`, `LIVE_SMOKE_PORT`, `HOST_SESSION_SECRET` (fixture host session; default `live-smoke-host`).

Live Polar sandbox (operator machine; token is sandbox-only — production `api.polar.sh` returns 401):

```bash
set -a && source /Users/yann/.polar/sandbox.env && set +a
export POLAR_LIVE=1
unset POLAR_FIXTURE_ONLY
export POLAR_API_BASE=https://sandbox-api.polar.sh
bash scripts/live-smoke.sh
```

`POLAR_API_BASE` defaults to production Polar. The live client honors the override. `scripts/test.sh` and Actions never set `POLAR_LIVE`.

## Verdicts

| Label | Meaning |
|---|---|
| `PASS` | Flow completed as SPEC requires. |
| `PASS-ERROR` | Documented product error; nothing invented. |
| `BLOCKED-SECRET` | Live Polar secret missing. Exact env var named. |
| `FAIL` | Broken product or invented listing/count. |

## This session

Ran `bash scripts/test.sh` (offline, green, 47 tests) then `bash scripts/live-smoke.sh` on **2026-08-23** from `feat/live-polar-sandbox-smoke` (parent `a9ce4db`, live-smoke on `origin/main`). Sourced `/Users/yann/.polar/sandbox.env` (mode 600; token length 53, webhook length 49, product length 36). `POLAR_LIVE=1`. `POLAR_FIXTURE_ONLY` unset. `POLAR_API_BASE=https://sandbox-api.polar.sh`. Fixture walk on `http://127.0.0.1:56983`. Live Polar walk on a second local process started by the script. Temp SQLite. No invented guests: empty board first, then unique `*.example` URLs for this run. Live checkout URL host was `sandbox.polar.sh`, not a fixture `/checkout/complete` listing. Unpaid live session stayed off the board.

| Flow | Result | Note |
|---|---|---|
| list | **PASS** | `GET /` 200. Empty guest-seat board. Veto default on. No invented listings. |
| bid | **PASS** | `POST /checkout` $4 → 400 `min_bid`. $5 fixture session pending; unpaid row not listed. |
| rank | **PASS** | After $12 pays, Twelve is #1 and Ada $5 is #2. Rank is the bid. |
| checkout | **PASS** | `GET /checkout/complete` fixture. Ada #1 · $5. No Polar network. |
| click | **PASS** | `GET /go/lst_89254898-583b-40ca-b4d7-15e0ddc41864` 302 to stripped URL. Clicks `0→1`. |
| veto | **PASS** | `POST /host/veto` of #1 on guest seat. Ada books #1. Twelve stays visible as vetoed. |
| live-checkout | **PASS** | Real Polar sandbox Checkout URL (`sandbox.polar.sh`). Unpaid live session not listed. |

Process exit 0 (`PASS=7` `PASS-ERROR=0` `BLOCKED-SECRET=0` `FAIL=0`). Missing Polar secret still records `BLOCKED-SECRET` and must not invent a paid row. `scripts/test.sh` still unsets `POLAR_LIVE` and never invokes this script.

## What this does not do

- Does not call `scripts/live-smoke.sh` from `scripts/test.sh` or Actions.
- Does not set `POLAR_LIVE=1` in CI.
- Does not seed fake guests or click counts on an empty episode.
- Does not treat a missing Polar secret as a paid listing.
- Does not treat a fixture `/checkout/complete` URL as live Polar checkout.
