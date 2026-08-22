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
6. Live Polar: if `POLAR_LIVE` is not `1` or `POLAR_ACCESS_TOKEN` is empty, prints `BLOCKED-SECRET: POLAR_ACCESS_TOKEN`.
7. Kills the process it started and deletes the temp database.

Overrides: `LIVE_SMOKE_BASE`, `LIVE_SMOKE_PORT`, `HOST_SESSION_SECRET` (fixture host session; default `live-smoke-host`).

Live Polar (operator machine with a real token):

```bash
POLAR_LIVE=1 POLAR_ACCESS_TOKEN=… bash scripts/live-smoke.sh
```

## Verdicts

| Label | Meaning |
|---|---|
| `PASS` | Flow completed as SPEC requires. |
| `PASS-ERROR` | Documented product error; nothing invented. |
| `BLOCKED-SECRET` | Live Polar secret missing. Exact env var named. |
| `FAIL` | Broken product or invented listing/count. |

## This session

Ran `bash scripts/live-smoke.sh` on **2026-08-22** from `feat/live-smoke` (parent `aa07e60`, Dockerfile + runbook on `origin/main`). Local process started by the script on `http://127.0.0.1:54748`. Temp SQLite. `POLAR_LIVE` unset. `POLAR_ACCESS_TOKEN` unset. Fixture path. No invented guests: empty board first, then unique `*.example` URLs for this run.

Also refused `CI=true` (`FAIL: live-smoke refuses CI=true`) and `GITHUB_ACTIONS=true`.

| Flow | Result | Note |
|---|---|---|
| list | **PASS** | `GET /` 200. Empty guest-seat board. Veto default on. No invented listings. |
| bid | **PASS** | `POST /checkout` $4 → 400 `min_bid`. $5 fixture session pending; unpaid row not listed. |
| rank | **PASS** | After $12 pays, Twelve is #1 and Ada $5 is #2. Rank is the bid. |
| checkout | **PASS** | `GET /checkout/complete` fixture. Ada #1 · $5. No Polar network. |
| click | **PASS** | `GET /go/lst_0066cfbb-d49e-4340-877b-fbd29847bbab` 302 to stripped URL. Clicks `0→1`. |
| veto | **PASS** | `POST /host/veto` of #1 on guest seat. Ada books #1. Twelve stays visible as vetoed. |
| live-checkout | **BLOCKED-SECRET** | `BLOCKED-SECRET: POLAR_ACCESS_TOKEN` |

Process exit 0 (`PASS=6` `PASS-ERROR=0` `BLOCKED-SECRET=1` `FAIL=0`). Re-run with `POLAR_LIVE=1` and a real token to complete Polar Checkout; missing token must stay `BLOCKED-SECRET`, never a fixture listing.

## What this does not do

- Does not call `scripts/live-smoke.sh` from `scripts/test.sh` or Actions.
- Does not set `POLAR_LIVE=1` in CI.
- Does not seed fake guests or click counts on an empty episode.
- Does not treat a missing Polar secret as a paid listing.
