# Podcast Guest Seat — Product Development Spec

**Version:** 1.0  
**Status:** Ready to build  
**Repo:** https://github.com/tangpingqingwa/06-podcast-guest-seat  
**Market:** global English  
**Currency:** USD only  
**Forbidden:** chat/invite links, NSFW, invented social proof, live Waffo in CI

Pay-to-rank clone of [outbid.lol](https://outbid.lol/). Rank is the bid. The scarce slot is the next episode’s **guest seat** or **60-second open**.

One-line pitch: **Bid dollars to sit in the next episode. The host can still say no.**

---

## 1. Product statement

A public auction board. People and companies bid whole US dollars to claim the next episode guest seat or a 60-second open. Listeners and other guests watch who is paying. Clicks go to the bidder’s site.

This is not a booking marketplace, not a talent agency, and not a comments thread. Payment claims rank. A documented host veto (optional flag, **on by default for guest seat**) keeps the show from becoming a pure hard-sell by default.

---

## 2. Goals and non-goals

### Goals

- Public leaderboard for the **current open episode**. Rank = bid. Nothing else.
- Whole USD bids. Minimum **$5**. Raises pay only the **difference**.
- Equal bids: the **older** bid keeps the higher rank.
- Listing = **person or company + site + one-liner**. Per-episode cadence.
- Explicit Waffo checkout modes in production and tests; fixture mode is
  offline and must be selected intentionally.
- About + Rules pages. Public click counts. Tracking query strings stripped.
- Host veto is a real, documented flag — default **on** for `guest_seat`.

### Non-goals

- Chat, DMs, Discord/Telegram/WhatsApp/Signal/Messenger invite links.
- NSFW / adult listings.
- Fake downloads, subscriber counts, or “featured guest” badges that are not the bid.
- Multi-currency, ads, API keys for bidders, revenue share with listed sites.
- Full show production, recording, or episode hosting.
- Matching guests to topics with an algorithm.

### Kill / change rules

- If 90 days after a public board: paid listings < 10 **and** no host is using veto or lock, freeze features.
- If Waffo is down, checkout fails closed. Do not invent a paid rank.

---

## 3. Seat kinds and cadence

| `seatKind` | What #1 buys | Host veto default |
|---|---|---|
| `guest_seat` | The next episode’s guest seat | **on** (`vetoEnabled: true`) |
| `sixty_second_open` | A 60-second open / mid-roll read | **off** (`vetoEnabled: false`) |

Cadence is **per episode**, not a forever board.

Occupied live `/` ranks Waffo-paid `paidAt` in the **rolling last 7 days**. Not a civil-midnight lock. Not Monday 00:00 UTC. Not a 24h lock on #1. Host lock still freezes the episode. Paid rows older than 7 days stay stored; they do not occupy the live rundown.

1. The first public visit to `/` opens episode `N` as a new empty guest-seat board when no episode is unlocked. This lazy open is idempotent, creates no listing, and does not call Waffo.
2. Bids land on that episode’s board until the host **locks** it or its documented `locksAt` is reached. At the deadline, a public `/`, episode page, or checkout boundary atomically closes the episode; the current-board boundary also opens `N+1`.
3. After lock, the booked listing is the highest remaining eligible bid (see veto).
4. Episode `N+1` opens as a new empty board. Prior bids do not carry. A host may still choose the seat kind when opening an episode manually through the host desk.

v1 architecture is multi-show. A documented v1 lane may be a single English-language show; do not hard-code one show into the rank engine.

---

## 4. Auction rules (normative)

Public leaderboard. No ads, no bidder API keys, no revenue share. You pay to stand above everyone else. **Rank is the bid — nothing else.**

| Rule | Contract |
|---|---|
| Currency | Whole US dollars. Integer cents are not a v1 input. |
| Minimum | **$5** first bid. |
| Increment | **$1**. |
| Below #1 | Still lists, at the rank that bid can take. |
| Ties | Same `bidUsd`: **older** `firstBidAt` keeps the higher rank. |
| Raise | Same listing (same episode + same site identity) may raise. New total must be at least **$1 above the current #1**. Payer pays only the **difference**. |
| Identity | Another bidder cannot steal a listing by paying only that difference. They pay a full new bid. |
| Claim | A **completed payment** claims the rank. Unpaid checkout does not. |
| Window | Occupied live rank is Waffo-paid `paidAt` in the **rolling last 7 days**. Not a civil-midnight lock. Not Monday 00:00 UTC. Not a 24h lock on #1. |
| Tracking | Query strings are stripped from listing URLs. Affiliate / referral / UTM params do not survive. |
| Shorteners | Not allowed as the stored URL. Resolve to the redirect target or reject. |
| Chat / NSFW | Reject. Telegram, WhatsApp, Discord, Messenger, Signal, and similar invite hosts. Sexual / adult platforms. |

App Store, Play Store, GitHub, and similar platform links are keyed by path so two apps on the same host do not share a bid.

---

## 5. Listing shape

```ts
type SeatKind = "guest_seat" | "sixty_second_open"

type Listing = {
  id: string
  episodeId: string
  name: string            // person or company
  siteUrl: string         // canonical, tracking stripped
  oneLiner: string        // one sentence; no markdown
  bidUsd: number          // integer, >= 5
  firstBidAt: string      // ISO; tie-break
  paidAt: string          // ISO; completed Waffo (or fixture) payment
  clicks: number          // public
  vetoedAt: string | null
  vetoReason: string | null
}

type Episode = {
  id: string
  showId: string
  label: string           // e.g. "Episode 12"
  seatKind: SeatKind
  vetoEnabled: boolean    // default true iff seatKind === "guest_seat"
  opensAt: string
  locksAt: string | null
  lockedAt: string | null
}
```

- `name`: person or company. Required. No empty display name.
- `siteUrl`: https only after hygiene. This is the public click target.
- `oneLiner`: required, single line, max 140 characters. No hashtags dump. No invented metrics.
- Rank key: `(episodeId, siteIdentity)` where `siteIdentity` is host + path after stripping query/hash.

Do not store raw bidder emails on the public board.

---

## 6. Host veto (optional flag)

Veto exists so a guest-seat auction does not become a pure hard-sell by default.

| Field | Rule |
|---|---|
| Flag | `episode.vetoEnabled` |
| Default | `true` when `seatKind === "guest_seat"` |
| Default | `false` when `seatKind === "sixty_second_open"` |
| Override | A show may flip the flag **before the first paid bid** on that episode. After the first paid bid, the flag is frozen for that episode. |
| Effect | Host may veto the current #1 (or any listed bidder) with a **public reason**. Money already paid is not refunded by this product (Waffo / MoR policy is outside the rank engine). |
| After veto | That listing is ineligible. Rank recomputes among remaining paid listings. Older still wins ties. |
| When off | Highest paid bid is booked at lock. No host reject path. |
| Transparency | Vetoed rows stay visible as vetoed. Do not silently delete a paid listing. |

Veto is not a secret shadow-ban. Rules page must state the flag and the default.

---

## 7. Information architecture

```
GET  /                         current episode leaderboard
GET  /e/:episodeId             that episode’s board (indexable after lock)
GET  /about
GET  /rules
GET  /go/:listingId            302 to stripped siteUrl; increment public clicks
GET  /healthz                  200 if process up
POST /checkout                 start Waffo (or fixture) checkout for a bid / raise
POST /webhooks/waffo           Waffo payment completed → claim rank
POST /host/open                host session; open the next empty episode
POST /host/veto                host session; only if vetoEnabled
POST /host/lock                lock the episode
```

`/about` and `/rules` are required. Rules must include: min $5, rank=bid, older wins ties, raise=difference, tracking stripped, no chat/NSFW, veto default on for guest seat.

Public clicks: `/go/:listingId` never forwards original query junk. The click counter is public on the row.

---

## 8. Payments (Waffo + fixture)

| Mode | When | Behavior |
|---|---|---|
| Fixture | explicit offline test/development mode | `WaffoPort` fake. Completing a fixture checkout claims rank. No network. |
| Live Waffo | Explicit `WAFFO_MODE=waffo-prod` or `waffo-test`, all mode-scoped secrets/config present | Waffo Checkout + webhook. Fail closed if configuration is missing or inconsistent. |

`WAFFO_MODE=fixture` is explicit and offline. CI must not select a live mode or
provide live credentials.

A listing is not ranked until payment completes. Abandoned checkout = no row (or an unpaid draft that is not public — v1: no public unpaid rows).

An episode whose `locksAt` has passed is not eligible for a new checkout or
claim, even if no scheduler has visited the process. The request that observes
the deadline performs the close and replacement-board write in one immediate
SQLite transaction, so concurrent visitors converge on one empty next board.

---

## 9. URL hygiene

Before store or `/go` redirect:

1. Require `https:` (or resolve a documented shortener, then require https).
2. Drop userinfo, hash, and **all** query parameters.
3. Reject chat/invite hosts (Telegram, WhatsApp, Discord, Messenger, Signal, and similar).
4. Reject NSFW / adult platform hosts (documented deny list in code + Rules).
5. Reject `javascript:`, data URLs, and non-http(s) schemes.

Clicks go to the cleaned URL only.

---

## 10. Pages and copy

- Board shows rank, name, one-liner, bid, relative time, public clicks, veto state.
- Do not render “verified”, star ratings, or follower counts.
- English UI.
- Footer: independent board; not affiliated with listed companies or Waffo beyond payments.
- `/about`: what the seat is, per-episode cadence, veto default.
- `/rules`: the auction table in §4 plus veto in §6, verbatim enough that a bidder can predict rank.

---

## 11. Acceptance tests

| # | Case | Expected |
|---|---|---|
| 1 | First bid $5 on empty guest-seat episode | Rank #1 after fixture payment |
| 2 | Bid $4 | Reject. Min $5 |
| 3 | Two listings, $10 then $12 | $12 is #1 |
| 4 | Two listings both $10 | Older `firstBidAt` is #1 |
| 5 | Raise own $10 to $13 when #1 is $12 | Pay $3; become #1 |
| 6 | Other bidder tries to pay only the $1 difference | Reject / full new bid required |
| 7 | URL with `?utm_source=x` | Stored and `/go` URL have no query |
| 8 | Discord / Telegram invite | Reject |
| 9 | NSFW host | Reject |
| 10 | Guest-seat episode, default flag | `vetoEnabled === true` |
| 11 | 60-second episode, default flag | `vetoEnabled === false` |
| 12 | Veto #1 on guest seat | Next eligible listing books; vetoed row stays visible |
| 13 | Veto when flag off | 403 / documented error |
| 14 | New episode | Empty board; old bids do not carry |
| 15 | Public click | `/go/:id` 302 + clicks increment |
| 16 | Waffo fixture | Checkout without network claims rank |
| 17 | Live mode absent in test | No live Waffo host |
| 18 | Empty database or post-lock public `/` | Opens one empty guest-seat board; repeat visits do not duplicate it |
| 19 | `locksAt` reached before `/` or checkout | Closes the old episode, opens one empty next board, and rejects the old checkout |

---

## 12. Infrastructure

- One process, Node 22, SQLite, one VPS behind Caddy. No AWS required for v1.
- Env: `PORT`, `DATABASE_PATH`, explicit `WAFFO_MODE`, mode-scoped Waffo
  secrets/configuration, host session secret.
- `.env` is gitignored. Never read Waffo secrets in unit tests.

---

## 13. File layout (suggested)

```
/
  SPEC.md
  BUILD.md
  CONTRIBUTING.md
  README.md
  scripts/test.sh
  src/
    server.ts
    rank.ts
    listings.ts
    waffo/          # WaffoPort + fixture + live
    http/
  tests/
    fixtures/
```

No app code in the docs PR. Adding a server means **extending** `scripts/test.sh`.

## 14. Git collaboration (normative)

Development is GitHub trunk-based. **`main` is always cloneable, buildable, and testable.**

| Rule | Requirement |
|---|---|
| Integration branch | `main` only. No long-lived `develop`. |
| How code lands | Pull request into `main`. No direct push. |
| Required check | GitHub Actions workflow `ci` (job id `ci`) must be green. |
| Local / CI test | `bash scripts/test.sh` — offline, no production secrets. |
| Branch names | `feat/` `fix/` `docs/` `chore/` `test/` + short slug. |
| Merge | Squash. Delete the head branch. |
| Broken `main` | Treat as an incident. Fix on `fix/…` via PR. |

Full process: [CONTRIBUTING.md](./CONTRIBUTING.md).

Implementation plan (stack, modules, PR DAG): [BUILD.md](./BUILD.md).

Until there is an application binary, `scripts/test.sh` still has to pass: contract files exist, SPEC/CONTRIBUTING agree, no tracked secrets. Adding a server or CLI means **extending** that script with unit/contract tests. Live Waffo calls are optional and must not be required for `main` to stay green.
