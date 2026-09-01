# Live smoke — Podcast Guest Seat

Operator-only. `bash scripts/live-smoke.sh` is **not** called from `scripts/test.sh` or GitHub Actions. CI and `scripts/test.sh` stay offline and must not select a live Waffo mode.

`100%` for this unit means a **local process** walked fixture checkout → rank → public click → guest-seat veto. The fixture path is explicit (`WAFFO_MODE=fixture`) and makes zero provider calls. A requested `waffo-test` or `waffo-prod` mode exits with a documented no-call result. Do not invent listings. An empty guest-seat board is valid.

## How to run

```bash
bash scripts/live-smoke.sh
```

The script:

1. Refuses `CI=true` / `GITHUB_ACTIONS=true` (override only with `LIVE_SMOKE_ALLOW_CI=1` for a local dry-run, never in Actions).
2. Seeds one `guest_seat` episode (`vetoEnabled` default on) into a temp SQLite file.
3. Clears any inherited `LISTEN_HOST` before setup, then starts
   `node --import tsx src/server.ts` with `LISTEN_HOST=127.0.0.1`, a validated
   loopback port, Waffo credentials unset, and `WAFFO_MODE=fixture`. It checks
   the child server log to prove the listener stayed loopback-only.
4. Verifies the seeded episode is served by that isolated process and checks the honest empty board before any mutation.
5. Walks list, bid, fixture checkout, rank, public click, guest-seat veto.
6. If `WAFFO_MODE` requests a live mode, exits before starting a server and makes no provider request.
7. Kills the process it started and deletes the temp database.

Overrides: `LIVE_SMOKE_PORT` (pure decimal `1`–`65535`) and `HOST_SESSION_SECRET` (fixture host session; default `live-smoke-host`). Any inherited `LISTEN_HOST` is ignored; the fixture child is always explicitly fixed to `127.0.0.1`. The smoke always owns its loopback server and isolated SQLite file.

No live Waffo checkout is performed by this script. Production credentials,
stable HTTPS, and webhook registration are deployment operations outside the
offline smoke.

## Verdicts

| Label | Meaning |
|---|---|
| `PASS` | Flow completed as SPEC requires. |
| `PASS-ERROR` | A requested live Waffo mode was refused before startup; the offline smoke made zero provider calls. |
| `FAIL` | Broken product or invented listing/count. |

## This session

Ran the offline fixture smoke on **2026-08-27** with a temporary SQLite
database. No Waffo credentials were read and no provider request was made.

| Flow | Result | Note |
|---|---|---|
| list | **PASS** | `GET /` 200. Empty guest-seat board. Veto default on. No invented listings. |
| bid | **PASS** | `POST /checkout` $4 → 400 `min_bid`. $5 fixture session pending; unpaid row not listed. |
| rank | **PASS** | After $12 pays, Twelve is #1 and Ada $5 is #2. Rank is the bid. |
| checkout | **PASS** | `GET /checkout/complete` fixture. Offline Guest #1 · $5. No Waffo network. |
| click | **PASS** | `GET /go/lst_89254898-583b-40ca-b4d7-15e0ddc41864` 302 to stripped URL. Clicks `0→1`. |
| veto | **PASS** | `POST /host/veto` of #1 on guest seat. Ada books #1. Twelve stays visible as vetoed. |
| live-mode guard | **PASS-ERROR** | A live mode is refused before server start; no Waffo request. |

Process exit 0 for fixture mode (`PASS` with no provider calls). A requested
live mode records `PASS-ERROR` and exits before any provider call. Missing live
configuration is never interpreted as a paid fixture.

## What this does not do

- Does not call `scripts/live-smoke.sh` from `scripts/test.sh` or Actions.
- Does not select a live Waffo mode in CI.
- Does not mutate another process.
- Does not seed fake guests or click counts on an empty episode.
- Does not treat missing Waffo configuration as a paid listing.
- Does not treat a fixture `/checkout/complete` URL as a live Waffo checkout.
