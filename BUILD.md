# Podcast Guest Seat — Detailed Specification and Build Plan

**Product contract:** [SPEC.md](./SPEC.md) wins on auction rules, listing shape, veto defaults, and errors.  
**This file** wins on stack, module boundaries, test layout, and the PR sequence.  
**Git:** [CONTRIBUTING.md](./CONTRIBUTING.md). Every `### PR N` row is one squash-merged PR. `main` stays green.

Pay-to-rank board. Rank is the bid. Polar + fixture. Host veto is a flag, default on for guest seat.

---

## 1. Locked stack (do not bikeshed in implementation PRs)

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 22 LTS | Same as the other verticals |
| Language | TypeScript 5.x, `strict` | Rank and money stay typed |
| HTTP | Fastify 5 | One process, schema validation |
| Validation | Zod | Fail closed on bid / URL / veto |
| Persistence | SQLite via `better-sqlite3` | One file, backup = copy |
| Billing | `PolarPort` — fixture default; live Polar when `POLAR_LIVE=1` | Merchant of record; no Stripe in v1 |
| Tests | `node:test` + `tsx` | No Jest tax |
| Lint | `tsc --noEmit` in `scripts/test.sh` once `src/` exists | |
| Host | One VPS, Caddy TLS | No AWS required |

**Out of stack:** Prisma, Nest, Redis, Kubernetes, Vercel, Supabase, chat, NSFW allow-lists, live Polar in CI.

---

## 2. Architecture

```
Browser
  GET /  GET /e/:id  GET /about  GET /rules  GET /go/:listingId
  POST /checkout
        │
        ▼
     Fastify
        ├─ listings / episodes
        ├─ rank.ts          bidUsd desc, firstBidAt asc on ties
        ├─ hygiene.ts       strip tracking, reject chat/NSFW
        ├─ veto.ts          flag + public reason
        └─ PolarPort        fixture | live
                 │
              SQLite
```

HTTP does not talk to Polar except through `PolarPort`. Tests inject the fixture.

---

## 3. Rank algorithm (implementation-level)

Eligible listings: `paidAt` set, `vetoedAt` null, same `episodeId`.

```
order by bidUsd DESC, firstBidAt ASC, id ASC
```

Raise (same `episodeId` + `siteIdentity`):

1. `newTotal >= currentTopBid + 1` (if another listing is top) or `newTotal >= existingBid + 1`.
2. Charge `newTotal - existingBid` only.
3. Keep original `firstBidAt`. Update `bidUsd` after payment completes.

Someone else bidding the same site identity is a new listing only if hygiene says it is a different identity; they pay a full bid, not the difference.

Min first bid: **$5**.

---

## 4. PolarPort

```ts
type PolarPort = {
  createCheckout(input: {
    episodeId: string
    listingId: string
    amountUsd: number
    kind: "open" | "raise"
  }): Promise<{ checkoutId: string; url: string }>
  // webhook / fixture complete → { paid: true, amountUsd }
}
```

- Fixture: in-process complete; deterministic ids; no network.
- Live: Polar Checkout + webhook. Missing secret → fail closed.
- `POLAR_FIXTURE_ONLY=1` always selects fixture.
- `scripts/test.sh` unsets live Polar env and does not call Polar hosts.

---

## 5. Environment

| Name | Required | Default |
|---|---|---|
| `PORT` | no | 3000 |
| `DATABASE_PATH` | yes in prod | `./data/guest-seat.sqlite` |
| `POLAR_FIXTURE_ONLY` | no | `1` in CI / `scripts/test.sh` |
| `POLAR_LIVE` | no | `0`. Ignored when fixture-only is `1` |
| `POLAR_ACCESS_TOKEN` | live only | unset |
| `POLAR_WEBHOOK_SECRET` | live only | unset |
| `POLAR_API_BASE` | live only | production Polar API. Operator sandbox smoke may override. |
| `POLAR_PRODUCT_ID` | live only | unset. Sandbox custom-amount checkout needs it. |
| `HOST_SESSION_SECRET` | host veto/lock | dev dummy only in fixture tests |

`.env` is gitignored. Never read in unit tests.

---

## 6. Test plan (offline, required for main)

| File | Asserts |
|---|---|
| `rank.test.ts` | min $5; $10 vs $12; older wins ties; raise = difference; other bidder cannot pay only the difference |
| `hygiene.test.ts` | UTM stripped; Discord/Telegram rejected; NSFW rejected; `/go` has no query |
| `veto.test.ts` | guest_seat default on; sixty_second_open default off; veto drops #1; flag off → reject veto |
| `episode.test.ts` | new episode empty; old bids do not carry |
| `polar.test.ts` | fixture checkout claims rank; `POLAR_FIXTURE_ONLY` wins; no live host |
| `pages.test.ts` | `/` board; `/about`; `/rules`; public clicks |
| `scripts/test.sh` | contract checks **plus** `tsc` + `node:test` once `package.json` exists |

Live Polar is **not** in CI. Optional `scripts/live-smoke.sh` is operator-only.

---

## 7. PR plan

Each PR is independently mergeable. Dependencies are hard.

### PR 1: Skeleton + healthz

- **Description:** package.json, tsconfig, Fastify `/healthz`, extend `scripts/test.sh` to compile + run tests (even if only health).
- **Files:** `package.json`, `tsconfig.json`, `src/server.ts`, `src/app.ts`, `src/http/routes/health.ts`, `scripts/test.sh`
- **Dependencies:** None
- **Acceptance:** `GET /healthz` 200 `{ ok: true }`. `scripts/test.sh` green offline.

### PR 2: Episodes + listing rows

- **Description:** SQLite episodes/listings. Listing is person/company + site + one-liner. Per-episode board. Default `vetoEnabled` true for `guest_seat`, false for `sixty_second_open`. No payments yet (rows inserted only by tests).
- **Files:** `src/db.ts`, `src/migrations/001_init.sql`, `src/episodes.ts`, `src/listings.ts`, `tests/episode.test.ts`
- **Dependencies:** PR 1
- **Acceptance:** SPEC listing shape; new episode does not carry old bids; defaults for the veto flag.

### PR 3: Rank engine

- **Description:** Implement §3. Min $5, rank=bid, older wins ties, raise = difference.
- **Files:** `src/rank.ts`, `tests/rank.test.ts`
- **Dependencies:** PR 2
- **Acceptance:** SPEC acceptance 1–6 against in-memory / SQLite listings.

### PR 4: URL hygiene + about/rules + public clicks

- **Description:** Strip tracking. Reject chat/NSFW. `/about`, `/rules`, `/go/:listingId` increments public clicks.
- **Files:** `src/hygiene.ts`, `src/http/routes/pages.ts`, `src/http/routes/go.ts`, `tests/hygiene.test.ts`, `tests/pages.test.ts`
- **Dependencies:** PR 2
- **Acceptance:** SPEC 7–9, 15; Rules page states min $5, older wins, veto default on for guest seat.

### PR 5: Polar checkout + fixture

- **Description:** `PolarPort` fixture completes a bid or raise. Public row only after payment. Live Polar module may exist but must stay env-gated and unused in CI.
- **Files:** `src/polar/port.ts`, `src/polar/fixture.ts`, `src/polar/live.ts`, `src/http/routes/checkout.ts`, `tests/polar.test.ts`
- **Dependencies:** PR 3, PR 4
- **Acceptance:** SPEC 16–17. `POLAR_FIXTURE_ONLY=1` wins. CI / `scripts/test.sh` never set `POLAR_LIVE=1`.

### PR 6: Host veto + lock

- **Description:** Host session can veto when the flag is on; lock freezes the episode; booked guest is highest remaining eligible bid.
- **Files:** `src/veto.ts`, `src/http/routes/host.ts`, `tests/veto.test.ts`
- **Dependencies:** PR 5
- **Acceptance:** SPEC 10–13. Vetoed row remains visible. Flag frozen after first paid bid.

### PR 7: Dockerfile + one-VPS runbook

- **Description:** One-box image. Polar stays off until the operator sets live flags.
- **Files:** `Dockerfile`, `.env.example`, `deploy/runbook.md`, `scripts/test.sh`
- **Dependencies:** PR 6
- **Acceptance:** Node 22, non-root, `$PORT`. Image and CI do not set `POLAR_LIVE=1`.

### PR 8: live-smoke

- **Description:** Operator script starts a local process, walks list → bid → rank → Polar fixture or live checkout → public click → guest-seat veto. Missing Polar secret on the live path is `BLOCKED-SECRET` with the exact env var. Not called from `scripts/test.sh` or Actions.
- **Files:** `scripts/live-smoke.sh`, `docs/live-smoke.md`
- **Dependencies:** PR 7
- **Acceptance:** Offline `scripts/test.sh` still green. CI does not invoke `live-smoke.sh` or set `POLAR_LIVE`. Recorded table in `docs/live-smoke.md`: list, bid, rank, checkout, click, veto.

---

## 8. Rollback

Any PR that makes `scripts/test.sh` red is reverted with `fix/` or `git revert` via PR. Do not force-push `main`.
