# Podcast Guest Seat — Detailed Specification and Build Plan

**Product contract:** [SPEC.md](./SPEC.md) wins on auction rules, listing shape, veto defaults, and errors.  
**This file** wins on stack, module boundaries, test layout, and the PR sequence.  
**Git:** [CONTRIBUTING.md](./CONTRIBUTING.md). Every `### PR N` row is one squash-merged PR. `main` stays green.

Pay-to-rank board. Rank is the bid. Waffo + fixture. Host veto is a flag, default on for guest seat.

---

## 1. Locked stack (do not bikeshed in implementation PRs)

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 22 LTS | Same as the other verticals |
| Language | TypeScript 5.x, `strict` | Rank and money stay typed |
| HTTP | Fastify 5 | One process, schema validation |
| Validation | Zod | Fail closed on bid / URL / veto |
| Persistence | SQLite via `better-sqlite3` | One file, backup = copy |
| Billing | `WaffoPort` — explicit `fixture`, `waffo-test`, or `waffo-prod` mode | Merchant of record; no Stripe in v1 |
| Tests | `node:test` + `tsx` | No Jest tax |
| Lint | `tsc --noEmit` in `scripts/test.sh` once `src/` exists | |
| Host | One VPS, Caddy TLS | No AWS required |

**Out of stack:** Prisma, Nest, Redis, Kubernetes, Vercel, Supabase, chat, NSFW allow-lists, live Waffo in CI.

---

## 2. Architecture

```
Browser
  GET /  GET /e/:id  GET /about  GET /rules  GET /go/:listingId
  POST /checkout
        │
        ▼
     Fastify
        ├─ listings / episodes (lazy-open + `locksAt` rollover in SQLite)
        ├─ rank.ts          bidUsd desc, firstBidAt asc on ties
        ├─ hygiene.ts       strip tracking, reject chat/NSFW
        ├─ veto.ts          flag + public reason
        └─ WaffoPort        fixture | waffo-test | waffo-prod
                 │
              SQLite
```

HTTP does not talk to Waffo except through `WaffoPort`. Tests inject the fixture.

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

## 4. WaffoPort

```ts
type WaffoPort = {
  mode: "fixture" | "waffo-test" | "waffo-prod"
  storeId: string
  productId: string
  createCheckout(input: {
    intentId: string
    intentFingerprint: string
    episodeId: string
    listingId: string
    chargeCents: number
    quoteBaseCents: number
    targetBidCents: number
    kind: "open" | "raise"
    name: string
    siteUrl: string
    oneLiner: string
  }): Promise<{
    checkoutId: string
    url: string
    expiresAt?: string
  }>
  // Fixture only. Live ports reject browser/return completion.
  completeCheckout(checkoutId: string): Promise<{ paid: true; amountCents: number }>
  // Verify the exact raw body; settlement consumes only order.completed.
  verifyWebhook(rawBody: string, signature?: string): WaffoWebhook
}
```

- The application writes an immutable intent before provider I/O. It stores the
  normalized episode/listing fields, board window, target bid, quote base,
  exact charge, expected mode/store/product/USD/tax category, and a SHA-256
  fingerprint. The official anonymous checkout uses the configured product,
  `currency: "USD"`, decimal `priceSnapshot.amount`,
  `taxCategory: "digital_goods"`, the public success URL with `?intent=`, the
  intent as `orderMerchantExternalId`, and all normalized metadata as strings.
- Fixture is explicit, local, and network-free. `waffo-test` and `waffo-prod`
  require their mode-scoped credentials, IDs, webhook key, public HTTPS
  origin, and durable SQLite path; missing or conflicting configuration fails
  closed. Polar variables/adapters are inert compatibility debris.
- A successful provider response attaches its exact hosted Waffo checkout URL,
  session id, and expiry to the existing intent. Timeout, connection reset,
  408/409/425/429, 5xx, invalid JSON, or a crash after provider acceptance
  leave the intent `unknown` and recoverable; they never create a free rank.
- Live settlement is webhook-only. The route verifies the raw signed body and
  accepts only `order.completed` whose mode/store/order/payment/status/USD,
  external intent id, exact metadata, product, decimal subtotal/tax/total, and
  bounded provider timestamp match the immutable intent. One SQLite
  transaction records delivery/business/payment/order identities, the outcome,
  intent state, checkout event, and listing/raise. Exact retries are 2xx
  no-ops; changed replays, unknown/mismatched captures, stale raises, and
  unsafe events are durably rejected or reconciled without ranking.
- A browser return only reads the durable intent state (`open`, `unknown`,
  `paid`, `rejected`, or `needs_reconciliation`). It never settles live Waffo.
  Ranks contain paid rows only, and a raise charges only the difference.

---

## 5. Environment

| Name | Required | Default |
|---|---|---|
| `PORT` | no | 3000 |
| `DATABASE_PATH` | yes in prod and live modes | durable SQLite path |
| `WAFFO_MODE` | yes | `fixture`, `waffo-test`, or `waffo-prod` |
| `WAFFO_MERCHANT_ID` | Waffo modes | unset |
| `WAFFO_PRIVATE_KEY` or `WAFFO_PRIVATE_KEY_FILE` | Waffo modes | unset |
| `WAFFO_STORE_ID` | Waffo modes | unset |
| `WAFFO_PRODUCT_ID` | Waffo modes | unset |
| `WAFFO_PUBLIC_BASE_URL` | Waffo modes | public HTTPS origin |
| `WAFFO_API_BASE` | optional test override | official `https://api.waffo.ai` |
| `WAFFO_TEST_WEBHOOK_PUBLIC_KEY` | `waffo-test` | unset |
| `WAFFO_PROD_WEBHOOK_PUBLIC_KEY` | `waffo-prod` | unset |
| `WAFFO_CHECKOUT_TIMEOUT_MS` | no | 15000 |
| `HOST_SESSION_SECRET` | host veto/lock | dev dummy only in fixture tests |

`.env` is gitignored. Never read in unit tests.

---

## 6. Test plan (offline, required for main)

| File | Asserts |
|---|---|
| `rank.test.ts` | min $5; $10 vs $12; older wins ties; raise = difference; other bidder cannot pay only the difference |
| `hygiene.test.ts` | UTM stripped; Discord/Telegram rejected; NSFW rejected; `/go` has no query |
| `veto.test.ts` | guest_seat default on; sixty_second_open default off; veto drops #1; flag off → reject veto |
| `episode.test.ts` | new episode empty; old bids do not carry; lazy-open idempotency, `locksAt` rollover, and cross-connection SQLite serialization |
| `waffo.test.ts` | explicit fixture mode, immutable intent/decimal checkout params, signed webhook settlement, exact replay/reconciliation, return non-settlement, and stale-raise safety; no live host |
| `pages.test.ts` | `/` board; `/about`; `/rules`; public clicks; empty/post-lock lazy opening; `locksAt` rollover at GET/checkout; occupied live rolling last-7-days window |
| `window.test.ts` | rolling last 7 days is 7×24h; Monday 00:00 UTC does not drop an in-window bid |
| `scripts/test.sh` | contract checks **plus** `tsc` + `node:test` once `package.json` exists |

Live Waffo is **not** in CI. `scripts/live-smoke.sh` is an offline fixture-only operator check.

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

### PR 5: Waffo checkout + fixture

- **Description:** Persist an immutable intent before the official Waffo checkout. Fixture completion is local; live `waffo-test`/`waffo-prod` settlement is raw-body signed-webhook only, with exact decimal money, replay idempotency, and durable unknown/reconciliation states.
- **Files:** `src/waffo/port.ts`, `src/waffo/fixture.ts`, `src/waffo/live.ts`, `src/http/routes/checkout.ts`, `tests/waffo.test.ts`
- **Dependencies:** PR 3, PR 4
- **Acceptance:** SPEC 16–17. `WAFFO_MODE=fixture` is explicit; live modes fail closed without scoped config. Unpaid/unknown intents never rank, returns never settle live, exact signed retries are no-ops, changed/mismatched/stale events reconcile or reject, and CI/`scripts/test.sh` never calls Waffo.

### PR 6: Host veto + lock

- **Description:** Host session can veto when the flag is on; lock freezes the episode; booked guest is highest remaining eligible bid.
- **Files:** `src/veto.ts`, `src/http/routes/host.ts`, `tests/veto.test.ts`
- **Dependencies:** PR 5
- **Acceptance:** SPEC 10–13. Vetoed row remains visible. Flag frozen after first paid bid.

### Lifecycle note

The public board is also the small lifecycle trigger: `ensureCurrentOpenEpisode`
uses one SQLite `BEGIN IMMEDIATE` transaction to open a missing board and to
roll a due `locksAt` forward. There is no scheduler, paid listing, or payment
provider call in this path. Host lock/veto and `/e/:episodeId` archive views
remain authoritative, while a due checkout is rejected before an intent can
reach Waffo.

### PR 7: Dockerfile + one-VPS runbook

- **Description:** One-box image. Waffo stays off until the operator provides explicit live mode and secrets.
- **Files:** `Dockerfile`, `.env.example`, `deploy/runbook.md`, `scripts/test.sh`
- **Dependencies:** PR 6
- **Acceptance:** Node 22, non-root, `$PORT`. Image and CI do not enable a live Waffo mode.

### PR 8: live-smoke

- **Description:** Operator script starts a local process, walks fixture checkout → rank → public click → guest-seat veto. A requested live Waffo mode exits without a provider call. Not called from `scripts/test.sh` or Actions.
- **Files:** `scripts/live-smoke.sh`, `docs/live-smoke.md`
- **Dependencies:** PR 7
- **Acceptance:** Offline `scripts/test.sh` still green. CI does not invoke `live-smoke.sh` or set a live Waffo mode. Recorded table in `docs/live-smoke.md`: checkout, rank, click, veto.

---

## 8. Rollback

Any PR that makes `scripts/test.sh` red is reverted with `fix/` or `git revert` via PR. Do not force-push `main`.
