import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { createEpisode, getCurrentEpisode } from "../src/episodes.js";
import { DEV_HOST_SESSION_SECRET } from "../src/http/routes/host.js";
import {
  boardRows,
  matchLiveListing,
  renderBoardHtml,
  renderCheckoutErrorHtml,
} from "../src/http/routes/pages.js";
import { getListing, insertListing, listListingsForEpisode, type Listing } from "../src/listings.js";
import { FixtureWaffo } from "../src/waffo/fixture.js";

// Keep route-level rolling-window assertions stable as the calendar advances.
const TEST_NOW = new Date("2026-08-27T12:00:00.000Z");
mock.timers.enable({ apis: ["Date"], now: TEST_NOW });
after(() => mock.timers.reset());

function memoryDb() {
  const db = openDatabase(":memory:");
  after(() => db.close());
  return db;
}

function studioMarkup(html: string): string {
  const start = html.search(/<div class="studio(?:\s[^"]*)?"/);
  const end = html.indexOf("<script>", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return html.slice(start, end);
}

function countExact(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function countAttr(haystack: string, name: string): number {
  const re = new RegExp(`${name}(?![\\w-])`, "g");
  return haystack.match(re)?.length ?? 0;
}

test("GET / is the current episode board", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_12",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada?utm_source=board",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });

  const app = await buildApp({ db });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /text\/html/);
  const body = response.body;
  assert.match(body, /Episode 12/);
  assert.match(body, /Ada Lovelace/);
  assert.match(body, /Notes on the analytical engine/);
  assert.match(body, /\$12/);
  assert.match(body, /3 clicks/);
  assert.match(body, /\/go\/lst_ada/);
  assert.match(body, /About/);
  assert.match(body, /Rules/);
  assert.doesNotMatch(body, /utm_source/);
  assert.doesNotMatch(body, /verified/i);
  assert.doesNotMatch(body, /https?:\/\/api\./);
});

test("GET /e/:episodeId is that episode’s board", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_12",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-01T00:00:00.000Z",
    lockedAt: "2026-08-08T00:00:00.000Z",
  });
  createEpisode(db, {
    id: "ep_13",
    showId: "show_english",
    label: "Episode 13",
    seatKind: "guest_seat",
    opensAt: "2026-08-15T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_old",
    episodeId: "ep_12",
    name: "Old Guest Co",
    siteUrl: "https://old.example/",
    oneLiner: "Was #1 last episode.",
    bidUsd: 40,
    firstBidAt: "2026-08-01T12:00:00.000Z",
    paidAt: "2026-08-01T12:00:10.000Z",
  });

  const app = await buildApp({ db });
  after(() => app.close());

  const current = await app.inject({ method: "GET", url: "/" });
  assert.match(current.body, /Episode 13/);
  assert.doesNotMatch(current.body, /Old Guest Co/);

  const archived = await app.inject({ method: "GET", url: "/e/ep_12" });
  assert.equal(archived.statusCode, 200);
  assert.match(archived.body, /Episode 12/);
  assert.match(archived.body, /Old Guest Co/);
  assert.match(archived.body, /\$40/);
});

test("rundown context tabs navigate and expose the selected state", async () => {
  const db = memoryDb();
  const archivedEpisode = createEpisode(db, {
    id: "ep_context_old",
    showId: "show_english",
    label: "Episode 11",
    seatKind: "guest_seat",
    opensAt: "2026-08-01T00:00:00.000Z",
    lockedAt: "2026-08-08T00:00:00.000Z",
  });
  createEpisode(db, {
    id: "ep_context_current",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-15T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_context_old",
    episodeId: archivedEpisode.id,
    name: "Archived Guest",
    siteUrl: "https://archived.example/",
    oneLiner: "A paid row from the archived episode.",
    bidUsd: 40,
    firstBidAt: "2026-08-01T12:00:00.000Z",
    paidAt: "2026-08-01T12:00:10.000Z",
  });

  const app = await buildApp({ db });
  after(() => app.close());

  const current = await app.inject({ method: "GET", url: "/" });
  assert.equal(current.statusCode, 200);
  assert.equal(
    countExact(current.body, 'data-context-tab="current" aria-selected="true" aria-current="page"'),
    1,
  );
  assert.equal(countExact(current.body, 'data-context-tab="episode" aria-selected="false"'), 1);
  assert.equal(countExact(current.body, 'data-context-href="/e/ep_context_old"'), 1);
  assert.equal(countExact(current.body, 'role="tablist"'), 1);
  assert.equal(countExact(current.body, 'data-slot="period-tabs"'), 1);
  assert.doesNotMatch(current.body, /class="mobile-context"[^>]*data-slot="period-tabs"/);
  assert.match(current.body, /Episode 12/);
  assert.doesNotMatch(current.body, /Archived Guest/);

  const perEpisode = await app.inject({ method: "GET", url: "/e/ep_context_old" });
  assert.equal(perEpisode.statusCode, 200);
  assert.equal(countExact(perEpisode.body, 'data-context-tab="current" aria-selected="false"'), 1);
  assert.equal(
    countExact(perEpisode.body, 'data-context-tab="episode" aria-selected="true" aria-current="page"'),
    1,
  );
  assert.equal(countExact(perEpisode.body, 'data-context-href="/e/ep_context_old"'), 1);
  assert.equal(countExact(perEpisode.body, 'role="tablist"'), 1);
  assert.equal(countExact(perEpisode.body, 'data-slot="period-tabs"'), 1);
  assert.doesNotMatch(perEpisode.body, /class="mobile-context"[^>]*data-slot="period-tabs"/);
  assert.match(perEpisode.body, /Episode 11/);
  assert.match(perEpisode.body, /Archived Guest/);
  assert.doesNotMatch(perEpisode.body, /Episode 12/);
});

test("per-episode context has a truthful empty state when there is no history", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_context_empty",
    showId: "show_english",
    label: "Episode 13",
    seatKind: "guest_seat",
    opensAt: "2026-08-20T00:00:00.000Z",
  });
  const app = await buildApp({ db });
  after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/e" });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /data-episode-history-empty/);
  assert.match(response.body, /No episode history yet/);
  assert.equal(countExact(response.body, 'data-context-tab="current" aria-selected="false"'), 1);
  assert.equal(
    countExact(response.body, 'data-context-tab="episode" aria-selected="true" aria-current="page"'),
    1,
  );
  assert.equal(countExact(response.body, 'data-context-href="/e"'), 1);
  assert.equal(countExact(response.body, 'role="tablist"'), 1);
  assert.equal(countExact(response.body, 'data-slot="period-tabs"'), 1);
  assert.doesNotMatch(response.body, /class="mobile-context"[^>]*data-slot="period-tabs"/);
  assert.match(response.body, /href="\/"/);
  assert.doesNotMatch(response.body, /Claim #1 for/);
});

test("GET /about describes the seat, cadence, and host review", async () => {
  const app = await buildApp();
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/about" });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /text\/html/);
  const content = response.body.slice(response.body.indexOf('<article class="doc"'));
  assert.match(response.body, /guest seat/i);
  assert.match(response.body, /Each episode has its own auction/i);
  assert.match(response.body, /host can still say no to a guest-seat placement/i);
  assert.match(response.body, /60-second open/);
  assert.match(response.body, /eligible for seven days/i);
  assert.match(response.body, /unless the host locks the episode sooner/i);
  assert.doesNotMatch(content, /Waffo|outbid\.lol|clone of|\bv1\b|fixture|API keys|paidAt|weekId|BLOCKED-/i);
});

test("GET /rules states the public bid, window, and host-review rules", async () => {
  const app = await buildApp();
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/rules" });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /text\/html/);
  const body = response.body;
  const content = body.slice(body.indexOf('<article class="doc"'));
  assert.match(body, /\$5/);
  assert.match(body, /listing placed first keeps the higher rank/i);
  assert.match(body, /difference/i);
  assert.match(body, /Guest-seat auctions allow host review/i);
  assert.match(body, /parameters are removed/i);
  assert.match(body, /Chat invitations and adult-platform links are rejected/i);
  assert.match(body, /eligible for <strong>seven days/i);
  assert.match(body, /rather than resetting at Monday midnight/i);
  assert.doesNotMatch(content, /Waffo|outbid\.lol|clone of|\bv1\b|fixture|API keys|paidAt|weekId|BLOCKED-/i);
});

test("GET / with no episode keeps the claim visible; Waffo cannot charge yet", async () => {
  const app = await buildApp();
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  assert.match(body, /Claim the guest seat for/);
  assert.match(body, /data-bid-step="-1"/);
  assert.match(body, /data-bid-step="1"/);
  assert.match(body, /name="bidUsd"/);
  assert.match(body, /Claim rank/);
  assert.match(body, /bidding has not started/);
  assert.match(body, /data-empty-board/);
  assert.match(body, /No open episode yet/);
  assert.match(body, /data-show-ticket/);
  assert.match(body, /data-episode-open="false"/);
  assert.match(body, /Show ticket/);
  assert.match(body, /bid-field/);
  assert.match(body, /data-waiting-on-host/);
  assert.match(body, /No seat for sale/);
  assert.match(body, /The next seat is not for sale/);
  assert.match(body, /No seat is for sale until the host opens an episode/);
  assert.match(body, /\/about#when-open/);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);
  assert.doesNotMatch(body, /followers/i);
  assert.doesNotMatch(studioMarkup(body), /data-empty-window/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-claim-window/);
  assert.doesNotMatch(studioMarkup(body), /data-occupied-window/);
  assert.doesNotMatch(studioMarkup(body), /Paid placements remain eligible for seven days/);
  assert.match(body, /disabled/);
});

test("GET / with no episode points first-time guests at when the next seat opens", async () => {
  const app = await buildApp();
  after(() => app.close());
  const board = await app.inject({ method: "GET", url: "/" });
  assert.equal(board.statusCode, 200);
  assert.match(board.body, /data-waiting-on-host/);
  assert.match(board.body, /href="\/about#when-open"/);
  assert.doesNotMatch(board.body, /Already on this episode\?/);
  assert.match(board.body, /disabled/);

  const about = await app.inject({ method: "GET", url: "/about" });
  assert.equal(about.statusCode, 200);
  assert.match(about.body, /id="when-open"/);
  assert.match(about.body, /The host opens each episode/);
  assert.match(about.body, /preview and cannot be purchased/);
  assert.match(about.body, /first confirmed bid of at least \$5 takes #1/);
});

test("GET / with no episode shows a first-time host desk to open the next seat", async () => {
  const app = await buildApp({ hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  assert.match(body, /data-host-open/);
  assert.match(body, /data-host-only/);
  assert.match(body, /data-guest-skip/);
  assert.match(body, /Guests skip this/);
  assert.match(body, /Open the next episode so guests can bid/);
  assert.match(body, /action="\/host\/open"/);
  assert.match(body, /Open Episode 1/);
  assert.match(body, /class="open-next"/);
  const studio = studioMarkup(body);
  assert.match(studio, /class="studio studio-waiting"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.equal(countExact(studio, "data-claim-locked"), 0);
  assert.equal(countExact(studio, 'data-checkout-state="locked"'), 0);
  assert.equal(countExact(studio, "data-empty-honest"), 0);
  assert.equal(countExact(studio, "data-later-fact"), 0);
  assert.match(body, /name="session"/);
  assert.match(body, /name="seatKind" value="guest_seat"/);
  assert.match(body, /name="label"[^>]*value="Episode 1"/);
  assert.match(body, /data-waiting-on-host/);
  assert.match(body, /Skip the host desk/);
  assert.match(body, /bidding has not started/);
  assert.match(body, /disabled/);
  assert.doesNotMatch(body, /name="episodeId"/);
});

test("GET / with no episode tells first-time guests to skip the host desk", async () => {
  const app = await buildApp({ hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const waitingAt = body.indexOf("data-waiting-on-host");
  const deskAt = body.indexOf("data-host-open");
  const skipAt = body.indexOf("data-guest-skip");
  const claimAt = body.indexOf('id="claim"');
  assert.notEqual(waitingAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(skipAt, -1);
  assert.notEqual(claimAt, -1);
  assert.match(body, /data-host-only/);
  assert.match(body, /Guests skip this\. This desk is for the host — it is not a bid\./);
  assert.match(body, /Skip the host desk\. That session form is not a bid\./);
  assert.match(body, /Claim the guest seat for/);
  assert.match(body, /name="bidUsd"[^>]*disabled/);
  assert.match(body, /class="outbid" disabled/);
  assert.match(body, /action="\/host\/open"/);
  assert.match(body, /Open Episode 1/);
  assert.match(body, /class="open-next"/);
  const studio = studioMarkup(body);
  assert.match(studio, /class="studio studio-waiting"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.equal(countExact(studio, "data-claim-locked"), 0);
  assert.equal(countExact(studio, 'data-checkout-state="locked"'), 0);
  assert.equal(countExact(studio, "data-empty-honest"), 0);
  assert.equal(countExact(studio, "data-later-fact"), 0);
  assert.doesNotMatch(body, /class="open-next outbid"/);
  assert.doesNotMatch(body, /name="episodeId"/);
  assert.doesNotMatch(body, /Already on this episode\?/);
});

test("POST /host/open from the desk opens a guest-seat episode so Waffo can charge", async () => {
  const db = memoryDb();
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());

  const missing = await app.inject({
    method: "POST",
    url: "/host/open",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
    payload: "label=Episode%201&seatKind=guest_seat",
  });
  assert.equal(missing.statusCode, 401);
  assert.match(missing.body, /Episode did not open/);
  assert.match(missing.body, /Checkout remains closed/);
  assert.equal(getCurrentEpisode(db), undefined);

  const opened = await app.inject({
    method: "POST",
    url: "/host/open",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
    payload: `label=Episode%201&seatKind=guest_seat&session=${DEV_HOST_SESSION_SECRET}`,
  });
  assert.equal(opened.statusCode, 303);
  assert.equal(opened.headers.location, "/");
  const episode = getCurrentEpisode(db);
  assert.ok(episode);
  assert.equal(episode.label, "Episode 1");
  assert.equal(episode.seatKind, "guest_seat");
  assert.equal(episode.vetoEnabled, true);
  assert.equal(episode.lockedAt, null);

  const board = await app.inject({ method: "GET", url: "/" });
  assert.equal(board.statusCode, 200);
  assert.match(board.body, /Episode 1/);
  assert.match(board.body, /data-episode-open="true"/);
  assert.match(board.body, /Host review is on\./);
  assert.match(board.body, /name="episodeId"/);
  assert.match(board.body, /data-claim-live/);
  assert.match(board.body, /data-open-seat/);
  assert.match(board.body, /data-empty-honest/);
  assert.match(board.body, /Seat is open/);
  assert.match(board.body, /\$5 takes #1/);
  assert.match(board.body, /data-claim-live/);
  const openedStudio = studioMarkup(board.body);
  assert.match(openedStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.equal(countExact(openedStudio, "data-empty-honest"), 3);
  assert.doesNotMatch(openedStudio, /studio-open-occupied/);
  assert.doesNotMatch(openedStudio, /data-claim-locked/);
  assert.doesNotMatch(openedStudio, /data-checkout-state="locked"/);
  assert.doesNotMatch(openedStudio, /data-claim-locked/);
  assert.doesNotMatch(openedStudio, /This episode is locked/);
  assert.doesNotMatch(openedStudio, /data-host-open/);
  assert.doesNotMatch(openedStudio, /data-host-lock/);
  assert.doesNotMatch(board.body, /data-host-only/);
  assert.doesNotMatch(board.body, /data-guest-skip/);
  assert.doesNotMatch(board.body, /data-waiting-on-host/);
  assert.doesNotMatch(board.body, /Skip the host desk/);
  assert.doesNotMatch(board.body, /Already on this episode\?/);
  assert.doesNotMatch(board.body, /name="bidUsd"[^>]*disabled/);
  assert.match(board.body, />Outbid<\/button>/);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=${episode.id}&name=Ada%20Lovelace&siteUrl=https%3A%2F%2Fada.example%2Fnotes&oneLiner=Notes%20on%20the%20engine.&bidUsd=5`,
  });
  assert.equal(checkout.statusCode, 303);
  assert.match(String(checkout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);

  const again = await app.inject({
    method: "POST",
    url: "/host/open",
    headers: { "content-type": "application/json" },
    payload: { session: DEV_HOST_SESSION_SECRET, label: "Episode 2" },
  });
  assert.equal(again.statusCode, 409);
  assert.deepEqual(again.json(), { error: "episode_already_open" });
});

test("GET / after lock still fail-closes checkout 409 — vetoed rows stay visible", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_lock_409",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_lock_409",
    episodeId: "ep_lock_409",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  insertListing(db, {
    id: "lst_lock_409_veto",
    episodeId: "ep_lock_409",
    name: "Hard Sell Co",
    siteUrl: "https://hardsell.example/",
    oneLiner: "Buy my course on air.",
    bidUsd: 20,
    firstBidAt: "2026-08-22T00:30:00.000Z",
    paidAt: "2026-08-22T00:30:05.000Z",
    vetoedAt: "2026-08-22T02:00:00.000Z",
    vetoReason: "hard sell",
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const board = await app.inject({ method: "GET", url: "/" });
  assert.equal(board.statusCode, 200);
  const body = board.body;
  const studio = studioMarkup(body);
  const claimAt = studio.indexOf('id="claim"');
  const lock409At = studio.indexOf('data-checkout-state="locked"');
  const lockCertainAt = studio.indexOf("data-claim-locked");
  const lockedTitleAt = studio.indexOf("Episode 12 is locked");
  const ticketAt = studio.indexOf("data-show-ticket");
  const rundownAt = studio.indexOf("data-rundown");
  const bookedAt = studio.indexOf("Booked Co");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(claimAt, -1);
  assert.notEqual(lock409At, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockedTitleAt, -1);
  assert.notEqual(ticketAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(bookedAt, -1);
  assert.notEqual(vetoAt, -1);
  assert.ok(ticketAt < claimAt);
  assert.ok(ticketAt < lock409At);
  assert.ok(ticketAt < lockCertainAt);
  assert.ok(ticketAt < lockedTitleAt);
  assert.ok(lockedTitleAt < rundownAt);
  assert.ok(rundownAt < bookedAt);
  assert.ok(rundownAt < vetoAt);
  assert.match(body, /data-checkout-state="locked"/);
  assert.match(body, /data-claim-locked/);
  assert.match(body, /data-claim-locked/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Bidding is closed for this episode/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_lock_409_veto"[^>]*data-vetoed="true"/);
  assert.equal(countExact(studio, 'data-checkout-state="locked"'), 1);
  assert.equal(countExact(studio, "data-claim-locked"), 1);
  assert.equal(countExact(studio, "data-claim-locked"), 1);
  assert.doesNotMatch(studio, /data-guest-prize/);
  assert.doesNotMatch(studio, /data-later-fact/);
  assert.doesNotMatch(studio, /data-empty-honest/);
  assert.match(studio, /class="studio studio-locked"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /data-checkout-state="locked"-first/);
  assert.doesNotMatch(studio, /data-checkout-state="locked"-six/);
  assert.doesNotMatch(studio, /data-checkout-state="locked"-after/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, /Seat is open/);
  assert.doesNotMatch(body, /\$5 takes #1/);
  assert.doesNotMatch(body, /name="bidUsd"/);
  assert.doesNotMatch(body, /class="outbid"/);
  assert.doesNotMatch(body, /action="\/checkout"/);
  assert.doesNotMatch(body, /featured guest/i);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /\.claim\[data-claim-state="locked"\]/);
  assert.match(studioCss, /\.claim\[data-claim-state="locked"\]/);
  assert.match(studioCss, /\.claim\[data-empty-honest\]/);
  assert.doesNotMatch(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name/);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_lock_409&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /This episode is locked/);
  assert.match(checkout.body, /No charge was started/);
  assert.match(checkout.body, /data-checkout-state="locked"/);
  assert.match(checkout.body, /No new claim can start/);
  const checkoutDoc = checkout.body.slice(
    checkout.body.indexOf("<article"),
    checkout.body.indexOf("</article>") + "</article>".length,
  );
  assert.match(checkoutDoc, /data-checkout-state="locked"/);
  assert.doesNotMatch(checkoutDoc, /episode_locked/);
  assert.doesNotMatch(checkoutDoc, /data-claim-live/);
  assert.doesNotMatch(checkoutDoc, /name="bidUsd"/);
  assert.doesNotMatch(checkoutDoc, /class="outbid"/);
  assert.doesNotMatch(checkoutDoc, /action="\/checkout"/);
  assert.doesNotMatch(checkoutDoc, /data-empty-honest/);
  assert.doesNotMatch(checkoutDoc, /data-open-seat/);
  const jsonCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: { "content-type": "application/json" },
    payload: {
      episodeId: "ep_lock_409",
      name: "Late Co",
      siteUrl: "https://late.example/",
      oneLiner: "Should not bid.",
      bidUsd: 20,
    },
  });
  assert.equal(jsonCheckout.statusCode, 409);
  assert.deepEqual(jsonCheckout.json(), { error: "episode_locked" });
});

test("HTML checkout error copy is human-readable for known states", () => {
  const cases = [
    ["episode_locked", /This episode is locked/],
    ["waffo_unavailable", /Payment is temporarily unavailable/],
    ["invalid_checkout", /Check your claim details/],
    ["unknown_checkout", /Checkout status is unavailable/],
    ["webhook_only", /Payment is still being confirmed/],
  ] as const;
  for (const [code, phrase] of cases) {
    const html = renderCheckoutErrorHtml(code);
    assert.match(html, phrase, code);
    assert.doesNotMatch(html, new RegExp(code), code);
    assert.match(html, /Back to the rundown/, code);
  }
});

test("public claim identity fields have labels and a visible focus ring", () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_claim_labels",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const html = renderBoardHtml(episode, [], new Date("2026-08-24T01:00:00.000Z"));
  assert.match(html, /<label class="sr-only" for="claim-name">Name or company<\/label>/);
  assert.match(html, /<input id="claim-name" name="name"/);
  assert.match(html, /<label class="sr-only" for="claim-site">Site<\/label>/);
  assert.match(html, /<input id="claim-site" name="siteUrl"/);
  assert.match(html, /<label class="sr-only" for="claim-one-liner">One-liner for the host<\/label>/);
  assert.match(html, /<input id="claim-one-liner" class="span-2" name="oneLiner"/);
  assert.match(html, /a:focus-visible, button:focus-visible, input:focus-visible/);
  assert.match(html, /\.bid-field input:focus-visible/);
});

test("board shell keeps the compact responsive controls and guest-seat markers", () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_shell_contract",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-26T00:00:00.000Z",
  });
  const rows = [
    {
      id: "lst_shell_one",
      episodeId: episode.id,
      name: "Mira Chen",
      siteUrl: "https://mira.example/",
      oneLiner: "A compact show rundown.",
      bidUsd: 12,
      firstBidAt: "2026-08-26T01:00:00.000Z",
      paidAt: "2026-08-26T01:00:05.000Z",
      clicks: 3,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_shell_two",
      episodeId: episode.id,
      name: "Jon Bell",
      siteUrl: "https://jon.example/",
      oneLiner: "Short notes for the host.",
      bidUsd: 8,
      firstBidAt: "2026-08-26T02:00:00.000Z",
      paidAt: "2026-08-26T02:00:05.000Z",
      clicks: 2,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_shell_three",
      episodeId: episode.id,
      name: "Anya Rao",
      siteUrl: "https://anya.example/",
      oneLiner: "A field guide to humane systems.",
      bidUsd: 6,
      firstBidAt: "2026-08-26T03:00:00.000Z",
      paidAt: "2026-08-26T03:00:05.000Z",
      clicks: 1,
      vetoedAt: null,
      vetoReason: null,
    },
  ] satisfies Listing[];
  const html = renderBoardHtml(episode, rows, new Date("2026-08-27T01:00:00.000Z"));
  const studio = studioMarkup(html);
  assert.match(html, /class="brand"/);
  assert.match(html, /<header class="site-header" data-slot="site-header">/);
  assert.match(html, /<div class="header-shell" data-slot="shell">/);
  assert.match(html, /data-slot="primary-nav"/);
  assert.match(html, /data-search-toggle/);
  assert.match(html, /data-theme-toggle/);
  assert.match(html, />\s*Search\s*<\/button>/);
  assert.match(html, /data-theme-label>Dark mode<\/span>/);
  assert.match(html, /class="mobile-context"/);
  assert.match(html, /class="ranking-tabs"/);
  assert.equal(countExact(html, 'role="tablist"'), 1);
  assert.equal(countExact(html, 'data-slot="period-tabs"'), 1);
  assert.doesNotMatch(html, /class="mobile-context"[^>]*data-slot="period-tabs"/);
  assert.match(html, /data-slot="stats-pill"/);
  assert.match(studio, /data-function-rail/);
  assert.match(studio, /data-slot="category-rail"/);
  assert.match(studio, /data-function-menu/);
  assert.match(studio, /class="identity-details"/);
  assert.match(studio, /<summary[^>]*>Guest details/);
  assert.match(studio, /data-slot="claim-hero"/);
  assert.match(studio, /data-slot="claim-heading"/);
  assert.match(studio, /data-slot="claim-form"/);
  assert.match(studio, /data-slot="url-input"/);
  assert.match(studio, /data-slot="category-control"/);
  assert.match(studio, /data-slot="claim-button"/);
  assert.match(studio, /data-slot="top-three"/);
  const ticketAt = studio.indexOf('data-show-ticket');
  const periodAt = studio.indexOf('data-slot="period-tabs"');
  const claimAt = studio.indexOf('data-slot="claim-hero"');
  const formAt = studio.indexOf('data-slot="claim-form"');
  const railAt = studio.indexOf('data-slot="category-rail"');
  const topThreeAt = studio.indexOf('data-slot="top-three"');
  assert.equal(countExact(studio, 'class="mobile-context"'), 1);
  assert.equal(countExact(studio, 'role="tablist"'), 1);
  assert.ok(ticketAt >= 0 && ticketAt < periodAt);
  assert.ok(periodAt < claimAt && claimAt < formAt && formAt < railAt && railAt < topThreeAt);
  assert.equal(countExact(studio, 'id="bid"'), 1);
  assert.equal(countExact(studio, 'id="bid-form"'), 1);
  assert.match(studio, /data-guest-prize/);
  assert.match(studio, /data-later-seat/);
  assert.match(studio, /data-paid-at=/);
  assert.match(studio, /data-first-click="guest"/);
  assert.doesNotMatch(html, /class="brand-mark"|class="guest-avatar"|<svg\b|lucideIcon|⌕|☾|☼/);
  assert.doesNotMatch(html, /\.ranking-tab::before|\.ticket-kicker::before/);
  assert.doesNotMatch(studio, /Explore <span|class="guest-avatar"/);
  assert.match(html, /--primary: #d9785b/);
  assert.match(html, /html, body \{[\s\S]*width: 100%;[\s\S]*max-width: 100%;[\s\S]*overflow-x: hidden;/);
  assert.match(html, /main, body > footer \{\n  width: min\(calc\(100% - 32px\), 992px\);\n  max-width: 992px;\n  min-width: 0;/);
  assert.match(html, /\.site-header \{[^}]*height: 76px;[^}]*min-height: 76px;[^}]*padding: 20px 0 16px;/);
  assert.match(html, /\.ranking-tabs \{[^}]*height: 40px;/);
  assert.match(html, /\.show-ticket \{[^}]*height: 32px;[^}]*min-height: 32px;/);
  assert.match(html, /grid-template-columns: minmax\(0, 604fr\) minmax\(0, 256fr\)/);
  assert.match(html, /\.show-ticket \{[^}]*width: 310px;[^}]*max-width: 100%;/);
  assert.match(html, /\.ranking-tabs \{[^}]*width: 173px;[^}]*height: 40px;/);
  assert.match(html, /\.studio > \.mobile-context \{[\s\S]*top: -56px;[\s\S]*left: 131\.68px;[\s\S]*width: 173px;/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*\.studio > \.mobile-context \{[\s\S]*position: static;[\s\S]*margin-top: 22px;/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*\.site-header \{ height: auto; min-height: 102px; padding: 16px 0 12px; \}/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*\.header-shell \{[\s\S]*grid-template-columns: 1fr;[\s\S]*height: auto;/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*\.header-cluster \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*overflow: visible;/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*nav\[aria-label="Main"\] \{[\s\S]*overflow-x: auto;[\s\S]*scrollbar-width: none;/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*\.brand \{[\s\S]*max-width: none;[\s\S]*overflow: visible;/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*\.compact-ranking-grid, \.activity-grid \{[\s\S]*display: flex;[\s\S]*flex-direction: column;[\s\S]*overflow: visible;/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*\.compact-ranking-item \{[\s\S]*grid-template-columns: 34px minmax\(0, 1fr\) max-content;[\s\S]*overflow: visible;/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*\.compact-ranking-name, \.compact-ranking-site \{[\s\S]*white-space: normal;[\s\S]*overflow-wrap: anywhere;/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*\.activity-item \{[\s\S]*grid-template-areas: "kind facts" "copy facts";[\s\S]*overflow: visible;/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*\.activity-copy strong, \.activity-copy span \{[\s\S]*white-space: normal;[\s\S]*overflow-wrap: anywhere;/);
  assert.match(html, /html::\-webkit-scrollbar, body::\-webkit-scrollbar \{ display: none; width: 0; height: 0; \}/);
  assert.match(html, /\.bid-form \{[^}]*min-height: 44px;[^}]*margin-top: 24px;/);
  assert.match(html, /\.bid-form \{ display: grid; gap: 8px; margin-top: 18px; \}/);
  assert.match(html, /\.function-rail \{[^}]*height: 32px;[^}]*min-height: 32px;[^}]*margin: 32px 0 0;/);
  assert.match(html, /\.rundown \{[^}]*gap: 12px;[^}]*margin: 20px 0 0;/);
  assert.match(html, /\.guest \{[^}]*width: 100%;[^}]*min-height: 110px;/);
  assert.match(
    html,
    /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name \{\s*font-size: 16px;/,
  );
  assert.match(html, /\.bid-field input \{[^}]*text-align: start; \}/);
  assert.match(html, /\.step \{[^}]*place-items: center;[^}]*line-height: 1; \}/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*\.claim-title \{[^}]*font-size: 24px;[^}]*line-height: 36px;/);
  assert.match(html, /\.outbid \{[^}]*font-size: 14px;[^}]*white-space: nowrap; \}/);
  assert.doesNotMatch(html, /\.outbid::before|\.outbid[^}]*content:\s*["']Claim rank/);
  assert.match(
    html,
    /\.outbid \{[^}]*height: 44px;[^}]*border-radius: 999px;[^}]*background: #e19b87;/,
  );
  assert.match(
    html,
    /\.outbid:disabled \{ background: #e19b87; color: var\(--primary-foreground\); opacity: 0\.68; \}/,
  );
  assert.match(studio, /data-business-action="Outbid" aria-label="Outbid — Claim rank">Outbid/);
  assert.match(html, /\.cue-num \{ display: inline-flex/);
  assert.match(html, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
});

test("search popover is closed by default and indexes only real board entries", () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_search_contract",
    showId: "show_english",
    label: "Episode 19",
    seatKind: "guest_seat",
    opensAt: "2026-08-26T00:00:00.000Z",
  });
  const listings = [
    {
      id: "lst_search_one",
      episodeId: episode.id,
      name: "Mira Chen",
      siteUrl: "https://mira.example/",
      oneLiner: "A real paid guest listing.",
      bidUsd: 12,
      firstBidAt: "2026-08-26T01:00:00.000Z",
      paidAt: "2026-08-26T01:00:05.000Z",
      clicks: 3,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_search_two",
      episodeId: episode.id,
      name: "Jon Bell",
      siteUrl: "https://jon.example/",
      oneLiner: "A second paid guest listing.",
      bidUsd: 8,
      firstBidAt: "2026-08-26T02:00:00.000Z",
      paidAt: "2026-08-26T02:00:05.000Z",
      clicks: 2,
      vetoedAt: null,
      vetoReason: null,
    },
  ] satisfies Listing[];
  const html = renderBoardHtml(episode, listings, new Date("2026-08-27T01:00:00.000Z"));

  assert.match(
    html,
    /class="header-icon search-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="rundown-search"[^>]*data-search-toggle/,
  );
  assert.match(html, /<div class="search-popover" id="rundown-search" role="search"[^>]* hidden>/);
  assert.match(html, /id="rundown-search-input" class="search-input" type="search"/);
  assert.match(html, /data-search-close[^>]*aria-label="Close search"/);
  assert.equal(countExact(html, 'data-search-result data-search-text='), 3);
  assert.match(html, /data-search-result[^>]*href="\/"[^>]*>\s*<span class="search-result-kind">Episode/);
  assert.match(html, /data-search-result[^>]*href="\/go\/lst_search_one"[^>]*>[\s\S]*?Mira Chen/);
  assert.match(html, /A real paid guest listing\./);
  assert.doesNotMatch(html, /Fake Guest|synthetic|followers|downloads/);
  assert.match(html, /\.search-popover \{\n  position: absolute;/);
  assert.match(html, /searchPanel\.hidden = !open/);
  assert.match(html, /event\.key === "Escape"/);
  assert.match(html, /search\.focus\(\)/);

  const noEpisode = renderBoardHtml(undefined, [], new Date("2026-08-27T01:00:00.000Z"));
  assert.match(noEpisode, /data-search-empty hidden/);
  assert.equal(countExact(noEpisode, "data-search-result data-search-text="), 0);
});

test("occupied desktop rundown derives lower ranking and activity from paid rows", () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_lower_fold",
    showId: "show_english",
    label: "Episode 28",
    seatKind: "guest_seat",
    opensAt: "2026-08-27T00:00:00.000Z",
  });
  const listings = [1, 2, 3, 4, 5].map((rank) => ({
    id: `lst_lower_${rank}`,
    episodeId: episode.id,
    name: `Guest ${rank}`,
    siteUrl: `https://guest-${rank}.example/`,
    oneLiner: `A truthful guest-seat note ${rank}.`,
    bidUsd: 30 - rank,
    firstBidAt: `2026-08-27T0${rank}:00:00.000Z`,
    paidAt: `2026-08-27T0${rank}:00:05.000Z`,
    clicks: rank,
    vetoedAt: null,
    vetoReason: null,
  })) satisfies Listing[];
  listings.forEach((listing) => insertListing(db, listing));

  const html = renderBoardHtml(episode, listings, new Date("2026-08-27T12:00:00.000Z"));
  const studio = studioMarkup(html);
  const rank3At = studio.indexOf('data-listing-id="lst_lower_3"');
  const lowerAt = studio.indexOf("data-lower-fold");
  const rank4At = studio.indexOf('data-listing-id="lst_lower_4"');
  assert.ok(rank3At !== -1 && lowerAt !== -1 && rank4At !== -1);
  assert.ok(rank3At < lowerAt && lowerAt < rank4At);
  assert.match(studio, /data-slot="today-strip"/);
  assert.match(studio, /data-slot="activity-strip"/);
  assert.match(studio, /data-slot="later-rows"/);
  assert.match(studio, /data-today-ranking/);
  assert.match(studio, /Episode ledger/);
  assert.match(studio, /Recent paid placements/);
  assert.match(studio, /Episode 28/);
  assert.match(studio, /data-lower-listing-id="lst_lower_1"[^>]*data-placement-rank="1"/);
  assert.match(studio, /data-activity-listing-id="lst_lower_5"[^>]*data-activity-paid-at="2026-08-27T05:00:05\.000Z"[^>]*data-activity-rank="5"[^>]*data-activity-clicks="5"/);
  assert.match(studio, /5 clicks/);
  assert.doesNotMatch(studio, /class="guest-avatar"|class="brand-mark"|<svg\b|lucideIcon|⌕|☾|☼/);
  assert.match(html, /\.lower-fold \{ display: grid; gap: 54px; width: 100%; margin: 8px 0 19px; \}/);
  assert.doesNotMatch(html, /\.lower-fold \{ display: none; \}/);
});

test("GET / after the host opens N+1 makes bidding that empty seat live", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_12",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-01T00:00:00.000Z",
    lockedAt: "2026-08-08T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_booked",
    episodeId: "ep_12",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-01T12:00:00.000Z",
    paidAt: "2026-08-01T12:00:10.000Z",
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());

  const opened = await app.inject({
    method: "POST",
    url: "/host/open",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
    payload: `label=Episode%2013&seatKind=guest_seat&session=${DEV_HOST_SESSION_SECRET}`,
  });
  assert.equal(opened.statusCode, 303);
  assert.equal(opened.headers.location, "/");
  const next = getCurrentEpisode(db);
  assert.ok(next);
  assert.equal(next.label, "Episode 13");
  assert.equal(next.lockedAt, null);
  assert.equal(next.vetoEnabled, true);

  const board = await app.inject({ method: "GET", url: "/" });
  assert.equal(board.statusCode, 200);
  const body = board.body;
  const claimAt = body.indexOf('id="claim"');
  const nextSeatAt = body.indexOf(" data-next-seat");
  const liveAt = body.indexOf("data-claim-live");
  const openSeatAt = body.indexOf(" data-open-seat");
  const ticketAt = body.indexOf("data-show-ticket");
  const outbidAt = body.indexOf(">Outbid</button>");
  assert.notEqual(claimAt, -1);
  assert.notEqual(nextSeatAt, -1);
  assert.notEqual(liveAt, -1);
  assert.notEqual(openSeatAt, -1);
  assert.notEqual(ticketAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.ok(ticketAt < claimAt);
  assert.ok(ticketAt < outbidAt);
  assert.match(body, /data-episode-open="true"/);
  assert.match(body, /Claim #1 for/);
  assert.match(body, /class="claim empty-claim-first"/);
  assert.match(body, /data-first-click="claim"/);
  assert.match(body, /data-identity-fields/);
  assert.match(body, /data-identity-fields/);
  assert.doesNotMatch(body, /Claim Episode 13 for/);
  assert.match(body, /Episode 13 is open/);
  assert.match(body, /\$5 takes #1 on this empty board/);
  assert.match(body, /Prior bids do not carry/);
  assert.match(body, /Paid placements remain eligible for seven days/);
  assert.match(body, /does not reset at Monday midnight/);
  assert.match(body, /data-empty-window/);
  assert.match(body, /class="empty-window"/);
  assert.match(body, /data-empty-claim-window/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /name="episodeId" value="[^"]+"/);
  assert.match(body, /value="5"/);
  assert.match(body, />Outbid<\/button>/);
  assert.match(body, /Host review is on\./);
  assert.doesNotMatch(body, /data-waiting-on-host/);
  assert.doesNotMatch(body, /No open episode yet/);
  assert.doesNotMatch(body, /No seat for sale/);
  assert.doesNotMatch(body, /Skip the host desk/);
  const studio = studioMarkup(body);
  assert.doesNotMatch(studio, /data-host-open/);
  assert.doesNotMatch(studio, /data-host-lock/);
  assert.doesNotMatch(studio, / data-open-next/);
  assert.equal(countExact(studio, "data-claim-locked"), 0);
  assert.equal(countExact(studio, 'data-checkout-state="locked"'), 0);
  assert.match(studio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.equal(countExact(studio, "data-empty-honest"), 3);
  assert.equal(countExact(studio, "data-later-fact"), 0);
  assert.match(studio, /data-empty-window/);
  assert.doesNotMatch(studio, /data-rolling-week/);
  assert.doesNotMatch(studio, /class="week-window"/);
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.doesNotMatch(studio, /studio-locked/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /Episode 13 is locked/);
  assert.doesNotMatch(body, /data-guest-skip/);
  assert.doesNotMatch(body, /bidding has not started/);
  assert.doesNotMatch(body, /This episode is locked/);
  assert.doesNotMatch(body, /The next episode opens empty/);
  assert.doesNotMatch(body, /Booked Co/);
  assert.doesNotMatch(body, /Already on this episode\?/);
  assert.doesNotMatch(body, /name="bidUsd"[^>]*disabled/);
  assert.doesNotMatch(body, /class="outbid" disabled/);
  assert.doesNotMatch(body, /featured guest/i);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=${next.id}&name=Next%20Guest&siteUrl=https%3A%2F%2Fnext.example%2F&oneLiner=First%20bid%20on%20N%2B1.&bidUsd=5`,
  });
  assert.equal(checkout.statusCode, 303);
  assert.match(String(checkout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);
});

test("GET / on a fresh-open empty episode makes bidding the guest seat live", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_open",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const app = await buildApp({ db });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const claimAt = body.indexOf('id="claim"');
  const openSeatAt = body.indexOf("data-open-seat");
  const liveAt = body.indexOf("data-claim-live");
  assert.notEqual(claimAt, -1);
  assert.notEqual(openSeatAt, -1);
  assert.notEqual(liveAt, -1);
  assert.match(body, /data-episode-open="true"/);
  assert.match(body, /Claim #1 for/);
  assert.match(body, /class="claim empty-claim-first"/);
  assert.match(body, /data-empty-claim-first/);
  assert.match(body, /data-first-click="claim"/);
  assert.match(body, /data-identity-fields/);
  assert.match(body, /data-identity-fields/);
  assert.match(body, /name="episodeId"/);
  assert.match(body, /value="5"/);
  assert.match(body, />Outbid<\/button>/);
  assert.doesNotMatch(body, /Claim the guest seat for/);
  assert.match(body, /The guest seat is open/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /\$5 takes #1/);
  assert.match(body, /Seat is open/);
  assert.match(body, /Paid placements remain eligible for seven days/);
  assert.match(body, /does not reset at Monday midnight/);
  assert.match(body, /data-empty-window/);
  assert.match(body, /data-empty-claim-window/);
  assert.match(body, /First paid bid of at least \$5 takes #1/);
  assert.match(body, /No paid listings on this episode yet/);
  assert.match(body, /Host review is on\./);
  assert.match(body, /data-empty-honest/);
  assert.doesNotMatch(body, /data-waiting-on-host/);
  assert.doesNotMatch(body, /No open episode yet/);
  assert.doesNotMatch(body, /No seat for sale/);
  const studio = studioMarkup(body);
  assert.doesNotMatch(studio, /data-host-open/);
  assert.doesNotMatch(studio, /data-host-lock/);
  assert.match(studio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.equal(countExact(studio, "data-empty-honest"), 3);
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.doesNotMatch(studio, /data-guest-prize/);
  assert.doesNotMatch(studio, /data-later-fact/);
  assert.doesNotMatch(studio, /data-rundown/);
  assert.doesNotMatch(studio, /data-guest-skip/);
  assert.equal(countExact(studio, "data-claim-locked"), 0);
  assert.equal(countExact(studio, 'data-checkout-state="locked"'), 0);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(body, /Claim Episode 1 for/);
  assert.doesNotMatch(body, /Already on this episode\?/);
  assert.doesNotMatch(body, /This episode is locked/);
  assert.doesNotMatch(body, /Episode 1 is locked/);
  assert.doesNotMatch(body, /name="bidUsd"[^>]*disabled/);
  assert.doesNotMatch(body, /class="outbid" disabled/);
  assert.doesNotMatch(body, /featured guest/i);
});

test("GET / on a fresh-open empty episode stays empty-honest — no lock chrome", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_open_honest",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const app = await buildApp({ db });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const studio = studioMarkup(body);
  const shellAt = studio.indexOf('class="studio studio-open-empty"');
  const claimAt = studio.indexOf('id="claim"');
  const honestAt = studio.indexOf("data-empty-honest");
  const openSeatAt = studio.indexOf("data-open-seat");
  const liveAt = studio.indexOf("data-claim-live");
  const takesAt = studio.indexOf("$5 takes #1");
  const ticketAt = studio.indexOf("data-show-ticket");
  const outbidAt = studio.indexOf(">Outbid</button>");
  const lockCertainAt = studio.indexOf("data-claim-locked");
  const lockedTitleAt = studio.indexOf("Episode 1 is locked");
  assert.notEqual(claimAt, -1);
  assert.notEqual(honestAt, -1);
  assert.notEqual(openSeatAt, -1);
  assert.notEqual(liveAt, -1);
  assert.notEqual(takesAt, -1);
  assert.notEqual(ticketAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.ok(shellAt < claimAt);
  assert.ok(honestAt < claimAt);
  assert.ok(takesAt > claimAt);
  assert.ok(outbidAt > claimAt);
  assert.equal(lockCertainAt, -1);
  assert.equal(lockedTitleAt, -1);
  assert.match(body, /data-empty-honest/);
  assert.match(body, /data-open-seat/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /Claim #1 for/);
  assert.match(body, /class="claim empty-claim-first"/);
  assert.match(body, /data-first-click="claim"/);
  assert.match(body, /data-identity-fields/);
  assert.match(body, /The guest seat is open/);
  assert.match(body, /\$5 takes #1/);
  assert.match(body, /First paid bid of at least \$5 takes #1/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /name="episodeId" value="ep_open_honest"/);
  assert.match(body, /value="5"/);
  assert.match(body, />Outbid<\/button>/);
  assert.match(body, /data-episode-open="true"/);
  assert.match(studio, /class="studio studio-open-empty"/);
  assert.match(studio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.equal(countExact(studio, "data-empty-honest"), 3);
  assert.equal(countExact(studio, "data-claim-locked"), 0);
  assert.equal(countExact(studio, 'data-checkout-state="locked"'), 0);
  assert.equal(countExact(studio, "data-claim-locked"), 0);
  assert.doesNotMatch(studio, /data-guest-prize/);
  assert.doesNotMatch(studio, /data-later-fact/);
  assert.doesNotMatch(studio, /data-rundown/);
  assert.doesNotMatch(studio, /data-empty-honest-first/);
  assert.doesNotMatch(studio, /data-empty-honest-six/);
  assert.doesNotMatch(studio, /data-empty-honest-after/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /Episode 1 is locked/);
  assert.doesNotMatch(studio, /This episode is locked/);
  assert.doesNotMatch(studio, /The next episode opens empty/);
  assert.doesNotMatch(studio, /data-host-open/);
  assert.doesNotMatch(studio, /data-host-lock/);
  assert.doesNotMatch(studio, / data-next-seat/);
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.doesNotMatch(studio, /studio-locked/);
  assert.doesNotMatch(body, /name="bidUsd"[^>]*disabled/);
  assert.doesNotMatch(body, /class="outbid" disabled/);
  assert.doesNotMatch(body, /featured guest/i);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /\.claim\[data-empty-honest\]/);
  assert.match(studioCss, /\.empty\[data-empty-honest\] \.empty-lead/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-guest-prize\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-first-click="guest"\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-later-seat\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-later-go\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-later-foot\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-later-facts\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-later-fact\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-claim-state="open-occupied"\]/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.empty\.open-seat/);
  assert.match(studioCss, /\.claim\[data-claim-state="locked"\]/);
  assert.doesNotMatch(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name/);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_open_honest&name=First%20Guest&siteUrl=https%3A%2F%2Ffirst.example%2F&oneLiner=First%20bid%20on%20a%20live%20seat.&bidUsd=5",
  });
  assert.equal(checkout.statusCode, 303);
  assert.match(String(checkout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);
  assert.doesNotMatch(checkout.body, /episode_locked/);
});

test("GET / on a fresh-open empty episode isolates $5 from lock / prize leak", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_open_isolate",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const app = await buildApp({ db });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const studio = studioMarkup(body);
  const shellAt = studio.indexOf('class="studio studio-open-empty"');
  const honestAt = studio.indexOf("data-empty-honest");
  const claimAt = studio.indexOf('id="claim"');
  const takesAt = studio.indexOf("$5 takes #1");
  const outbidAt = studio.indexOf(">Outbid</button>");
  assert.notEqual(shellAt, -1);
  assert.notEqual(honestAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(takesAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.ok(shellAt < claimAt);
  assert.ok(shellAt < honestAt);
  assert.ok(takesAt > claimAt);
  assert.match(studio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(body, /Claim #1 for/);
  assert.match(body, /data-first-click="claim"/);
  assert.match(body, /data-identity-fields/);
  assert.match(body, /\$5 takes #1/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /data-open-seat/);
  assert.match(body, /value="5"/);
  assert.match(body, />Outbid<\/button>/);
  assert.match(body, /action="\/checkout"/);
  assert.equal(countExact(studio, "data-empty-honest"), 3);
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.doesNotMatch(studio, /studio-locked/);
  assert.doesNotMatch(studio, /data-guest-prize/);
  assert.doesNotMatch(studio, /data-later-fact/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /data-checkout-state="locked"/);
  assert.doesNotMatch(studio, /data-host-lock/);
  assert.doesNotMatch(studio, /data-rundown/);
  assert.doesNotMatch(studio, /Episode 1 is locked/);
  assert.doesNotMatch(studio, /This episode is locked/);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-guest-prize\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-first-click="guest"\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-later-seat\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-later-go\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-later-foot\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-later-facts\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-later-fact\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-claim-state="open-occupied"\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-host-lock\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \.rundown/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \.guest/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.empty\.open-seat/);
  assert.match(studioCss, /\.studio\.studio-locked \.empty\.open-seat/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \.empty\.open-seat\[data-empty-honest\]/);
  assert.doesNotMatch(studio, /empty-honest-first/);
  assert.doesNotMatch(studio, /empty-honest-six/);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_open_isolate&name=First%20Guest&siteUrl=https%3A%2F%2Ffirst.example%2F&oneLiner=First%20bid%20on%20a%20live%20seat.&bidUsd=5",
  });
  assert.equal(checkout.statusCode, 303);
  assert.match(String(checkout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);
  assert.doesNotMatch(checkout.body, /episode_locked/);
});

test("GET / on a fresh-open empty episode keeps $5 honest — guest-one-first / later-seat cannot leak", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_open_no_guest_leak",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const app = await buildApp({ db });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const studio = studioMarkup(body);
  const shellAt = studio.indexOf('class="studio studio-open-empty"');
  const honestAt = studio.indexOf("data-empty-honest");
  const claimAt = studio.indexOf('id="claim"');
  const takesAt = studio.indexOf("$5 takes #1");
  const outbidAt = studio.indexOf(">Outbid</button>");
  assert.notEqual(shellAt, -1);
  assert.notEqual(honestAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(takesAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.ok(shellAt < claimAt);
  assert.ok(shellAt < honestAt);
  assert.ok(takesAt > claimAt);
  assert.match(studio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(body, /Claim #1 for/);
  assert.match(body, /data-first-click="claim"/);
  assert.match(body, /data-identity-fields/);
  assert.match(body, /\$5 takes #1/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /data-open-seat/);
  assert.match(body, /value="5"/);
  assert.match(body, />Outbid<\/button>/);
  assert.match(body, /action="\/checkout"/);
  assert.match(body, /name="episodeId" value="ep_open_no_guest_leak"/);
  assert.equal(countExact(studio, "data-empty-honest"), 3);
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.doesNotMatch(studio, /studio-locked/);
  assert.doesNotMatch(studio, /data-guest-prize/);
  assert.doesNotMatch(studio, /data-first-click="guest"/);
  assert.doesNotMatch(studio, /data-later-seat/);
  assert.doesNotMatch(studio, /data-later-go/);
  assert.doesNotMatch(studio, /data-later-foot/);
  assert.doesNotMatch(studio, /data-later-facts/);
  assert.doesNotMatch(studio, /data-later-fact/);
  assert.doesNotMatch(studio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(studio, /class="claim occupied-claim"/);
  assert.doesNotMatch(studio, /class="guest later-seat"/);
  assert.doesNotMatch(studio, /later-name/);
  assert.doesNotMatch(studio, /class="later-foot"/);
  assert.doesNotMatch(studio, /class="later-facts"/);
  assert.doesNotMatch(studio, /data-rundown/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /data-checkout-state="locked"/);
  assert.doesNotMatch(studio, /data-host-lock/);
  assert.doesNotMatch(studio, /Episode 1 is locked/);
  assert.doesNotMatch(studio, /This episode is locked/);
  assert.doesNotMatch(studio, /data-guest-one-first/);
  assert.doesNotMatch(studio, /data-later-seat-first/);
  assert.doesNotMatch(studio, /empty-honest-first/);
  assert.doesNotMatch(studio, /empty-honest-six/);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-guest-prize\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-first-click="guest"\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-later-seat\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-later-go\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-later-foot\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-later-facts\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-claim-state="open-occupied"\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \[data-guest-prize\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \[data-first-click="guest"\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \[data-later-seat\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \[data-later-go\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \[data-later-foot\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \[data-later-facts\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \[data-claim-state="open-occupied"\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \.later-fact/);
  assert.match(studioCss, /\.studio\.studio-open-empty \.later-facts/);
  assert.match(studioCss, /\.studio\.studio-open-empty \.occupied-claim/);
  assert.match(studioCss, /\.studio\.studio-open-empty \.guest\.later-seat/);
  assert.match(studioCss, /\.studio\.studio-open-empty \.later-name/);
  assert.match(studioCss, /\.studio\.studio-open-empty \.later-foot/);
  assert.match(studioCss, /\.studio\.studio-open-empty \.empty\.open-seat\[data-empty-honest\]/);
  assert.doesNotMatch(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name/);
  assert.doesNotMatch(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name a\[data-first-click="guest"\]/);
  assert.doesNotMatch(studioCss, /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\]/);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_open_no_guest_leak&name=First%20Guest&siteUrl=https%3A%2F%2Ffirst.example%2F&oneLiner=First%20bid%20on%20a%20live%20seat.&bidUsd=5",
  });
  assert.equal(checkout.statusCode, 303);
  assert.match(String(checkout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);
  assert.doesNotMatch(checkout.body, /episode_locked/);
});

test("studio rundown is a guest card, not a table: name, one-liner, site, bid, veto", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_studio",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada?utm_source=board",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  insertListing(db, {
    id: "lst_veto",
    episodeId: episode.id,
    name: "Hard Sell Co",
    siteUrl: "https://hardsell.example/",
    oneLiner: "Buy my course on air.",
    bidUsd: 20,
    firstBidAt: "2026-08-22T00:30:00.000Z",
    paidAt: "2026-08-22T00:30:05.000Z",
    clicks: 1,
    vetoedAt: "2026-08-22T02:00:00.000Z",
    vetoReason: "hard sell",
  });

  const app = await buildApp({ db });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  const body = response.body;

  assert.equal(response.statusCode, 200);
  assert.match(body, /data-show-ticket/);
  assert.match(body, /Episode 12/);
  assert.match(body, /Claim #1 for/);
  assert.match(body, />Outbid</);
  assert.match(body, /action="\/checkout"/);
  assert.match(body, /name="name"/);
  assert.match(body, /name="siteUrl"/);
  assert.match(body, /name="oneLiner"/);
  assert.match(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-honest/);
  assert.match(studioMarkup(body), /class="later-facts"[^>]*data-later-facts/);
  assert.match(studioMarkup(body), /class="bid lead-bid later-fact"[^>]*data-later-fact/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(body, /Seat is open/);
  assert.match(body, /Already on this episode\?/);
  assert.match(body, /data-rundown/);
  assert.match(body, /Ada Lovelace/);
  assert.match(body, /Notes on the analytical engine/);
  assert.match(body, /example.com\/ada/);
  assert.match(body, /\$12/);
  assert.match(body, /3 clicks/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_veto"[^>]*data-vetoed="true"/);
  assert.match(body, /hardsell.example/);
  assert.doesNotMatch(body, /<table/);
  assert.doesNotMatch(body, /<thead/);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);
  assert.doesNotMatch(body, /utm_source/);
});

test("GET / on a live ranked seat reads the guest label first and larger than $bid + clicks", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_prize",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  insertListing(db, {
    id: "lst_hold",
    episodeId: episode.id,
    name: "Hold Co",
    siteUrl: "https://hold.example/",
    oneLiner: "Still listed below #1.",
    bidUsd: 8,
    firstBidAt: "2026-08-22T01:10:00.000Z",
    paidAt: "2026-08-22T01:10:05.000Z",
    clicks: 2,
  });
  insertListing(db, {
    id: "lst_veto",
    episodeId: episode.id,
    name: "Hard Sell Co",
    siteUrl: "https://hardsell.example/",
    oneLiner: "Buy my course on air.",
    bidUsd: 20,
    firstBidAt: "2026-08-22T00:30:00.000Z",
    paidAt: "2026-08-22T00:30:05.000Z",
    clicks: 1,
    vetoedAt: "2026-08-22T02:00:00.000Z",
    vetoReason: "hard sell",
  });

  const app = await buildApp({ db });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const studio = studioMarkup(body);
  const adaStart = studio.indexOf('data-listing-id="lst_ada"');
  const holdStart = studio.indexOf('data-listing-id="lst_hold"');
  const vetoStart = studio.indexOf('data-listing-id="lst_veto"');
  const rundownAt = studio.indexOf("data-rundown");
  assert.notEqual(adaStart, -1);
  assert.notEqual(holdStart, -1);
  assert.notEqual(vetoStart, -1);
  assert.notEqual(rundownAt, -1);
  const adaCard = studio.slice(adaStart, holdStart);
  const holdCard = studio.slice(holdStart, vetoStart);
  const vetoCard = studio.slice(vetoStart);
  const nameAt = adaCard.indexOf("Ada Lovelace");
  const bidAt = adaCard.indexOf("$12");
  const clicksAt = adaCard.indexOf("3 clicks");
  assert.ok(rundownAt < adaStart);
  assert.ok(nameAt !== -1 && bidAt !== -1 && clicksAt !== -1);
  assert.ok(bidAt !== -1);
  assert.ok(nameAt < clicksAt);
  assert.match(adaCard, /data-guest-prize/);
  assert.match(adaCard, /class="guest-name"/);
  assert.match(adaCard, /data-first-click="guest"/);
  assert.match(adaCard, /class="later-facts"[^>]*data-later-facts/);
  assert.doesNotMatch(adaCard, /class="tally"/);
  assert.match(adaCard, /<p class="guest-site">example.com\/ada<\/p>/);
  assert.doesNotMatch(adaCard, /class="guest-site"><a href="\/go\/lst_ada"/);
  assert.doesNotMatch(adaCard, /data-later-foot/);
  assert.doesNotMatch(holdCard, /data-guest-prize/);
  assert.match(holdCard, /Hold Co/);
  assert.match(holdCard, /class="guest-name later-name"/);
  assert.match(holdCard, /data-later-seat/);
  assert.match(holdCard, /class="later-foot"[^>]*data-later-foot/);
  assert.doesNotMatch(holdCard, /data-first-click="guest"/);
  assert.doesNotMatch(holdCard, /class="tally"/);
  assert.doesNotMatch(holdCard, /data-later-facts/);
  assert.match(vetoCard, /data-vetoed="true"/);
  assert.doesNotMatch(vetoCard, /data-guest-prize/);
  assert.doesNotMatch(vetoCard, /data-later-seat/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /Claim #1 for/);
  assert.match(studio, /Claim #1 for/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_veto"[^>]*data-vetoed="true"/);
  assert.equal(countExact(studio, "data-guest-prize"), 1);
  assert.match(adaCard, /class="bid lead-bid later-fact"[^>]*data-later-fact/);
  assert.doesNotMatch(holdCard, /data-later-fact/);
  assert.doesNotMatch(holdCard, /class="bid later-fact"/);
  assert.doesNotMatch(vetoCard, /data-later-fact/);
  assert.doesNotMatch(vetoCard, /class="bid later-fact"/);
  assert.equal(countAttr(studio, "data-later-fact"), 1);
  assert.equal(countExact(studio, 'class="bid lead-bid later-fact"'), 1);
  assert.equal(countExact(studio, "data-later-seat"), 1);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /data-checkout-state="locked"/);
  assert.doesNotMatch(studio, /data-empty-honest/);
  assert.match(studio, /class="studio studio-open-occupied"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(body, /downloads/i);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, /This episode is locked/);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \{\s*margin-top: 20px;/);
  assert.match(studioCss, /@media \(min-width: 761px\)[\s\S]*\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.claim-title \{[\s\S]*height: 60px;[\s\S]*line-height: 60px;/);
  assert.match(studioCss, /@media \(min-width: 761px\)[\s\S]*\.studio\.studio-open-occupied \.lower-fold \{\s*margin: 24px 0 19px;\s*gap: 25px;/);
  assert.match(studioCss, /@media \(min-width: 761px\)[\s\S]*\.studio\.studio-open-occupied \.compact-ranking-item \{\s*min-height: 64px;/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \{\s*margin-top: 28px;/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.rundown \{\s*margin-top: 20px;\s*gap: 6px;/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] > \.lead-bid/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.later-facts \.clicks/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] > \.lead-bid/);
});

test("GET / on an occupied live seat keeps $bid a later fact beside the guest label", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_later_fact",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  insertListing(db, {
    id: "lst_hold",
    episodeId: episode.id,
    name: "Hold Co",
    siteUrl: "https://hold.example/",
    oneLiner: "Still listed below #1.",
    bidUsd: 8,
    firstBidAt: "2026-08-22T01:10:00.000Z",
    paidAt: "2026-08-22T01:10:05.000Z",
    clicks: 2,
  });
  insertListing(db, {
    id: "lst_veto",
    episodeId: episode.id,
    name: "Hard Sell Co",
    siteUrl: "https://hardsell.example/",
    oneLiner: "Buy my course on air.",
    bidUsd: 20,
    firstBidAt: "2026-08-22T00:30:00.000Z",
    paidAt: "2026-08-22T00:30:05.000Z",
    clicks: 1,
    vetoedAt: "2026-08-22T02:00:00.000Z",
    vetoReason: "hard sell",
  });

  const app = await buildApp({ db });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const studio = studioMarkup(body);
  const adaStart = studio.indexOf('data-listing-id="lst_ada"');
  const holdStart = studio.indexOf('data-listing-id="lst_hold"');
  const vetoStart = studio.indexOf('data-listing-id="lst_veto"');
  const rundownAt = studio.indexOf("data-rundown");
  assert.notEqual(adaStart, -1);
  assert.notEqual(holdStart, -1);
  assert.notEqual(vetoStart, -1);
  assert.notEqual(rundownAt, -1);
  const adaCard = studio.slice(adaStart, holdStart);
  const holdCard = studio.slice(holdStart, vetoStart);
  const vetoCard = studio.slice(vetoStart);
  const prizeAt = adaCard.indexOf("data-guest-prize");
  const nameAt = adaCard.indexOf("Ada Lovelace");
  const laterAt = adaCard.indexOf("data-later-fact");
  const bidAt = adaCard.indexOf("$12");
  const clicksAt = adaCard.indexOf("3 clicks");
  assert.ok(rundownAt < adaStart);
  assert.ok(prizeAt !== -1 && nameAt !== -1 && laterAt !== -1);
  assert.ok(laterAt < nameAt);
  assert.ok(laterAt < bidAt);
  assert.ok(nameAt < clicksAt);
  assert.ok(bidAt < clicksAt);
  assert.match(adaCard, /data-guest-prize/);
  assert.match(adaCard, /class="guest-name"/);
  assert.match(adaCard, /data-first-click="guest"/);
  assert.match(adaCard, /class="later-facts"[^>]*data-later-facts/);
  assert.match(adaCard, /class="bid lead-bid later-fact"[^>]*data-later-fact/);
  assert.match(adaCard, /\$12/);
  assert.match(adaCard, /3 clicks/);
  assert.doesNotMatch(adaCard, /class="tally"/);
  assert.match(adaCard, /<p class="guest-site">example.com\/ada<\/p>/);
  assert.doesNotMatch(adaCard, /class="guest-site"><a href="\/go\/lst_ada"/);
  assert.doesNotMatch(adaCard, /data-later-foot/);
  assert.doesNotMatch(holdCard, /data-guest-prize/);
  assert.match(holdCard, /data-later-seat/);
  assert.match(holdCard, /class="guest-name later-name"/);
  assert.match(holdCard, /class="later-foot"[^>]*data-later-foot/);
  assert.match(holdCard, /class="later-meta"[^>]*data-later-meta/);
  assert.doesNotMatch(holdCard, /data-later-fact/);
  assert.doesNotMatch(holdCard, /class="bid later-fact"/);
  assert.doesNotMatch(holdCard, /class="tally"/);
  assert.match(holdCard, /\$8/);
  assert.match(vetoCard, /data-vetoed="true"/);
  assert.match(vetoCard, /Hard Sell Co/);
  assert.match(vetoCard, /Vetoed: hard sell/);
  assert.doesNotMatch(vetoCard, /data-guest-prize/);
  assert.doesNotMatch(vetoCard, /data-later-seat/);
  assert.doesNotMatch(vetoCard, /data-later-fact/);
  assert.doesNotMatch(vetoCard, /class="bid later-fact"/);
  assert.equal(countExact(studio, "data-guest-prize"), 1);
  assert.equal(countAttr(studio, "data-later-fact"), 1);
  assert.equal(countExact(studio, 'class="bid lead-bid later-fact"'), 1);
  assert.equal(countExact(studio, "data-later-seat"), 1);
  assert.match(body, /data-claim-live/);
  assert.match(body, /Claim #1 for/);
  assert.match(body, />Outbid</);
  assert.match(body, /action="\/checkout"/);
  assert.match(studio, /Claim #1 for/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /data-checkout-state="locked"/);
  assert.doesNotMatch(studio, /data-empty-honest/);
  assert.match(studio, /class="studio studio-open-occupied"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /data-later-fact-first/);
  assert.doesNotMatch(studio, /data-later-fact-six/);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, /This episode is locked/);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name/);
  assert.match(studioCss, /@media \(min-width: 761px\)[\s\S]*\.studio\.studio-open-occupied \.guest\[data-paid-at\] \{[\s\S]*height: 110px;[\s\S]*min-height: 110px;/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] > \.lead-bid/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.person\s*\{[\s\S]*grid-template-rows: 20px 32px minmax\(0, 1fr\)/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-line\s*\{[\s\S]*max-width: 100%;[\s\S]*-webkit-line-clamp: 2/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \{[\s\S]*grid-template-rows: 52px 14px;/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] > \.later-bid\s*\{[\s\S]*color: var\(--muted-foreground\)/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\[data-paid-at\] \{[\s\S]*height: 123px;[\s\S]*min-height: 123px;/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \{[\s\S]*grid-template-columns: 38px minmax\(0, 1fr\) max-content;[\s\S]*"cue person price"/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.cue \{[\s\S]*align-self: start;[\s\S]*margin-top: 15px;/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.person \{[\s\S]*grid-template-rows: 19px 34px minmax\(0, 1fr\)/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-footer \{[\s\S]*display: flex;[\s\S]*align-items: center;[\s\S]*min-height: 13px;/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-site \{[\s\S]*flex: 1 1 auto;[\s\S]*white-space: nowrap;/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.later-facts\[data-later-facts\] \{[\s\S]*flex: 0 1 auto;[\s\S]*flex-wrap: nowrap;[\s\S]*white-space: nowrap;/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \{[\s\S]*grid-template-columns: 38px minmax\(0, 1fr\) max-content;[\s\S]*"cue person price"[\s\S]*"cue foot price"/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \{[\s\S]*grid-template-rows: 19px 34px minmax\(0, 1fr\);/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.cue \{[\s\S]*align-self: start;[\s\S]*margin-top: 15px;/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.person \{[\s\S]*grid-template-rows: 19px 34px;/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot \{[\s\S]*align-self: center;/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name a\[data-first-click="guest"\] \{[\s\S]*text-decoration: underline;/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] > \.later-bid \{[\s\S]*color: var\(--muted-foreground\)/);
  assert.match(studioCss, /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-meta \{[\s\S]*overflow: hidden;[\s\S]*white-space: nowrap;/);
  assert.doesNotMatch(studioCss, /display:\s*contents/);
});

test("r9 mobile occupied cards keep the podcast three-track inner geometry", () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_r9_card_geometry",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  const listings = [
    {
      id: "lst_r9_one",
      episodeId: episode.id,
      name: "Northwind Studio",
      siteUrl: "https://northwind.example/",
      oneLiner: "Practical systems for independent creators.",
      bidUsd: 120,
      firstBidAt: "2026-08-22T01:00:00.000Z",
      paidAt: "2026-08-22T01:00:05.000Z",
      clicks: 35,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_r9_two",
      episodeId: episode.id,
      name: "Signal Works",
      siteUrl: "https://signal.example/",
      oneLiner: "How small teams find a clear signal.",
      bidUsd: 80,
      firstBidAt: "2026-08-22T02:00:00.000Z",
      paidAt: "2026-08-22T02:00:05.000Z",
      clicks: 28,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_r9_three",
      episodeId: episode.id,
      name: "Field Notes Co",
      siteUrl: "https://field.example/",
      oneLiner: "A field guide to thoughtful launches.",
      bidUsd: 60,
      firstBidAt: "2026-08-22T03:00:00.000Z",
      paidAt: "2026-08-22T03:00:05.000Z",
      clicks: 17,
      vetoedAt: null,
      vetoReason: null,
    },
  ] satisfies Listing[];
  const html = renderBoardHtml(episode, listings, new Date("2026-08-27T01:00:00.000Z"));
  const studio = studioMarkup(html);
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

  assert.equal(countExact(studio, 'data-slot="paid-card"'), 3);
  assert.equal(countExact(studio, "data-paid-at="), 3);
  assert.match(studio, /Northwind Studio|Signal Works|Field Notes Co/);
  assert.match(studio, /northwind\.example|signal\.example|field\.example/);
  assert.match(studio, /35 clicks|28 clicks|17 clicks/);
  assert.match(css, /\.studio\.studio-open-occupied \.rundown-column \.guest \{/);
  assert.match(css, /\.studio\.studio-open-occupied \.rundown-column \.guest\.booked/);
  assert.match(css, /\.studio\.studio-open-occupied \.rundown-column \.guest\.later-seat/);
  assert.match(css, /grid-template-columns: 44px minmax\(0, 1fr\) max-content/);
  assert.match(css, /grid-template-areas: "cue person price" "cue foot price"/);
  assert.match(css, /\.studio\.studio-open-occupied \.claim-console \.claim/);
  assert.doesNotMatch(css, /display:\s*contents/);
});

test("GET / on occupied live keeps #1 guest the first click — later seats stay quieter", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_guest_one_first",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  insertListing(db, {
    id: "lst_hold",
    episodeId: episode.id,
    name: "Hold Co",
    siteUrl: "https://hold.example/",
    oneLiner: "Still listed below #1.",
    bidUsd: 8,
    firstBidAt: "2026-08-22T01:10:00.000Z",
    paidAt: "2026-08-22T01:10:05.000Z",
    clicks: 2,
  });
  insertListing(db, {
    id: "lst_veto",
    episodeId: episode.id,
    name: "Hard Sell Co",
    siteUrl: "https://hardsell.example/",
    oneLiner: "Buy my course on air.",
    bidUsd: 20,
    firstBidAt: "2026-08-22T00:30:00.000Z",
    paidAt: "2026-08-22T00:30:05.000Z",
    clicks: 1,
    vetoedAt: "2026-08-22T02:00:00.000Z",
    vetoReason: "hard sell",
  });

  const app = await buildApp({ db });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const studio = studioMarkup(body);
  const adaStart = studio.indexOf('data-listing-id="lst_ada"');
  const holdStart = studio.indexOf('data-listing-id="lst_hold"');
  const vetoStart = studio.indexOf('data-listing-id="lst_veto"');
  const rundownAt = studio.indexOf("data-rundown");
  assert.notEqual(adaStart, -1);
  assert.notEqual(holdStart, -1);
  assert.notEqual(vetoStart, -1);
  assert.notEqual(rundownAt, -1);
  const adaCard = studio.slice(adaStart, holdStart);
  const holdCard = studio.slice(holdStart, vetoStart);
  const vetoCard = studio.slice(vetoStart);
  const prizeAt = adaCard.indexOf("data-guest-prize");
  const firstClickAt = adaCard.indexOf('data-first-click="guest"');
  const nameAt = adaCard.indexOf("Ada Lovelace");
  const adaGoAt = adaCard.indexOf('href="/go/lst_ada"');
  const laterSeatAt = holdCard.indexOf("data-later-seat");
  const laterNameAt = holdCard.indexOf("Hold Co");
  const laterFootAt = holdCard.indexOf("data-later-foot");
  const laterGoAt = holdCard.indexOf("data-later-go");
  const holdGoAt = holdCard.indexOf('href="/go/lst_hold"');
  const holdBidAt = holdCard.indexOf("$8");
  const holdTallyAt = holdCard.indexOf('class="tally"');
  const holdNameLinkAt = holdCard.indexOf("<h2 class=\"guest-name\"");
  assert.ok(rundownAt < adaStart);
  assert.ok(adaStart < holdStart);
  assert.ok(prizeAt !== -1 && firstClickAt !== -1 && nameAt !== -1 && adaGoAt !== -1);
  assert.ok(prizeAt < firstClickAt);
  assert.ok(firstClickAt < nameAt);
  assert.ok(adaGoAt < firstClickAt);
  assert.ok(laterSeatAt !== -1 && laterNameAt !== -1 && laterFootAt !== -1 && laterGoAt !== -1 && holdGoAt !== -1);
  assert.ok(laterSeatAt < laterNameAt);
  assert.ok(laterNameAt < laterFootAt);
  assert.ok(laterFootAt < laterGoAt);
  assert.ok(holdGoAt > laterNameAt);
  assert.ok(holdBidAt < laterNameAt);
  assert.equal(holdTallyAt, -1);
  assert.equal(holdNameLinkAt, -1);
  assert.match(adaCard, /data-guest-prize/);
  assert.match(studio, /class="guest booked"[^>]*data-listing-id="lst_ada"[^>]*data-guest-prize/);
  assert.match(adaCard, /data-first-click="guest"/);
  assert.match(adaCard, /<h2 class="guest-name"><a href="\/go\/lst_ada" data-first-click="guest">Ada Lovelace<\/a><\/h2>/);
  assert.match(adaCard, /class="later-facts"[^>]*data-later-facts/);
  assert.match(adaCard, /class="bid lead-bid later-fact"[^>]*data-later-fact/);
  assert.doesNotMatch(adaCard, /class="tally"/);
  assert.match(adaCard, /<p class="guest-site">example.com\/ada<\/p>/);
  assert.doesNotMatch(adaCard, /class="guest-site"><a href="\/go\/lst_ada"/);
  assert.doesNotMatch(adaCard, /data-later-foot/);
  assert.doesNotMatch(adaCard, /data-later-seat/);
  assert.doesNotMatch(adaCard, /data-later-go/);
  assert.match(studio, /class="guest later-seat"[^>]*data-listing-id="lst_hold"[^>]*data-later-seat/);
  assert.match(holdCard, /<p class="guest-name later-name">Hold Co<\/p>/);
  assert.match(holdCard, /class="later-foot"[^>]*data-later-foot/);
  assert.match(holdCard, /<a class="later-go" href="\/go\/lst_hold" data-later-go>/);
  assert.doesNotMatch(holdCard, /class="guest-site later-go"/);
  assert.doesNotMatch(holdCard, /class="tally"/);
  assert.doesNotMatch(holdCard, /data-guest-prize/);
  assert.doesNotMatch(holdCard, /data-first-click="guest"/);
  assert.doesNotMatch(holdCard, /data-later-fact/);
  assert.match(vetoCard, /data-vetoed="true"/);
  assert.match(vetoCard, /Hard Sell Co/);
  assert.match(vetoCard, /Vetoed: hard sell/);
  assert.match(vetoCard, /href="\/go\/lst_veto"/);
  assert.doesNotMatch(vetoCard, /data-guest-prize/);
  assert.doesNotMatch(vetoCard, /data-later-seat/);
  assert.doesNotMatch(vetoCard, /data-later-foot/);
  assert.doesNotMatch(vetoCard, /data-first-click="guest"/);
  assert.equal(countExact(studio, "data-guest-prize"), 1);
  assert.equal(countExact(studio, 'data-first-click="guest"'), 1);
  assert.equal(countExact(studio, "data-later-seat"), 1);
  assert.equal(countExact(studio, "data-later-go"), 1);
  assert.equal(countExact(studio, "data-later-foot"), 1);
  assert.equal(countExact(studio, 'class="later-foot"'), 1);
  assert.equal(countAttr(studio, "data-later-fact"), 1);
  assert.equal(countExact(studio, 'class="bid lead-bid later-fact"'), 1);
  assert.match(studio, /class="studio studio-open-occupied"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /data-empty-honest/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /data-checkout-state="locked"/);
  assert.doesNotMatch(studio, /data-guest-one-first/);
  assert.doesNotMatch(studio, /data-later-seat-first/);
  assert.doesNotMatch(studio, /data-later-seat-six/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.doesNotMatch(studio, /empty-claim-first/);
  assert.doesNotMatch(studio, /data-first-click="claim"/);
  assert.match(studio, /Claim #1 for/);
  assert.match(studio, /class="claim occupied-claim"/);
  assert.match(studio, /data-claim-state="open-occupied"/);
  assert.ok(studio.indexOf('id="claim"') < rundownAt);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, /This episode is locked/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /Claim #1 for/);
  assert.match(body, />Outbid</);
  assert.match(body, /action="\/checkout"/);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  const prizeName = studioCss.match(
    /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name\s*\{[^}]*font-size:\s*([\d.]+)px/,
  );
  const laterName = studioCss.match(
    /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.guest-name\s*\{[^}]*font-size:\s*([\d.]+)px/,
  );
  const laterGo = studioCss.match(
    /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot \{[^}]*font-size:\s*([\d.]+)rem/,
  );
  assert.ok(prizeName);
  assert.ok(laterName);
  assert.ok(laterGo);
  assert.ok(Number(laterName[1]) < Number(prizeName[1]));
  assert.ok(Number(laterGo[1]) < Number(laterName[1]));
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name a\[data-first-click="guest"\]/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\]/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.guest-name/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot/);
  assert.match(
    studioCss,
    /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-go\s*\{/,
  );
  assert.match(
    studioCss,
    /\.later-go\s*\{[^}]*color:\s*var\(--muted-foreground\)/,
  );
  assert.doesNotMatch(
    studioCss,
    /\.later-go\s*\{[^}]*color:\s*var\(--lamp\)/,
  );

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_guest_one_first&name=Raise%20Co&siteUrl=https%3A%2F%2Fraise.example%2F&oneLiner=Still%20live.&bidUsd=13",
  });
  assert.equal(checkout.statusCode, 303);
  assert.match(String(checkout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);
  assert.doesNotMatch(checkout.body, /episode_locked/);
});

test("GET / on occupied live keeps later seats quieter than #1 guest — prize stays first", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_later_seat_quiet",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  insertListing(db, {
    id: "lst_hold",
    episodeId: episode.id,
    name: "Hold Co",
    siteUrl: "https://hold.example/",
    oneLiner: "Still listed below #1.",
    bidUsd: 8,
    firstBidAt: "2026-08-22T01:10:00.000Z",
    paidAt: "2026-08-22T01:10:05.000Z",
    clicks: 2,
  });
  insertListing(db, {
    id: "lst_third",
    episodeId: episode.id,
    name: "Third Mic",
    siteUrl: "https://third.example/",
    oneLiner: "Also below #1.",
    bidUsd: 6,
    firstBidAt: "2026-08-22T01:20:00.000Z",
    paidAt: "2026-08-22T01:20:05.000Z",
    clicks: 1,
  });
  insertListing(db, {
    id: "lst_veto",
    episodeId: episode.id,
    name: "Hard Sell Co",
    siteUrl: "https://hardsell.example/",
    oneLiner: "Buy my course on air.",
    bidUsd: 20,
    firstBidAt: "2026-08-22T00:30:00.000Z",
    paidAt: "2026-08-22T00:30:05.000Z",
    clicks: 1,
    vetoedAt: "2026-08-22T02:00:00.000Z",
    vetoReason: "hard sell",
  });

  const app = await buildApp({ db });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const studio = studioMarkup(body);
  const adaStart = studio.indexOf('data-listing-id="lst_ada"');
  const holdStart = studio.indexOf('data-listing-id="lst_hold"');
  const thirdStart = studio.indexOf('data-listing-id="lst_third"');
  const vetoStart = studio.indexOf('data-listing-id="lst_veto"');
  assert.notEqual(adaStart, -1);
  assert.notEqual(holdStart, -1);
  assert.notEqual(thirdStart, -1);
  assert.notEqual(vetoStart, -1);
  const adaCard = studio.slice(adaStart, holdStart);
  const holdCard = studio.slice(holdStart, thirdStart);
  const thirdCard = studio.slice(thirdStart, vetoStart);
  const vetoCard = studio.slice(vetoStart);
  const prizeAt = adaCard.indexOf("data-guest-prize");
  const firstClickAt = adaCard.indexOf('data-first-click="guest"');
  const adaNameAt = adaCard.indexOf("Ada Lovelace");
  const adaBidAt = adaCard.indexOf("$12");
  const holdNameAt = holdCard.indexOf("Hold Co");
  const holdFootAt = holdCard.indexOf("data-later-foot");
  const holdGoAt = holdCard.indexOf("data-later-go");
  const holdBidAt = holdCard.indexOf("$8");
  const thirdNameAt = thirdCard.indexOf("Third Mic");
  const thirdFootAt = thirdCard.indexOf("data-later-foot");
  const thirdGoAt = thirdCard.indexOf("data-later-go");
  const thirdBidAt = thirdCard.indexOf("$6");
  assert.ok(prizeAt !== -1 && firstClickAt !== -1 && adaNameAt !== -1);
  assert.ok(prizeAt < firstClickAt);
  assert.ok(firstClickAt < adaNameAt);
  assert.ok(adaBidAt < adaNameAt);
  assert.ok(holdNameAt !== -1 && holdFootAt !== -1 && holdGoAt !== -1);
  assert.ok(holdNameAt < holdFootAt);
  assert.ok(holdFootAt < holdGoAt);
  assert.ok(holdBidAt < holdNameAt);
  assert.ok(thirdNameAt !== -1 && thirdFootAt !== -1 && thirdGoAt !== -1);
  assert.ok(thirdNameAt < thirdFootAt);
  assert.ok(thirdFootAt < thirdGoAt);
  assert.ok(thirdBidAt < thirdNameAt);
  assert.match(adaCard, /class="later-facts"[^>]*data-later-facts/);
  assert.match(adaCard, /<h2 class="guest-name"><a href="\/go\/lst_ada" data-first-click="guest">Ada Lovelace<\/a><\/h2>/);
  assert.doesNotMatch(adaCard, /class="tally"/);
  assert.match(adaCard, /<p class="guest-site">example.com\/ada<\/p>/);
  assert.doesNotMatch(adaCard, /class="guest-site"><a href="\/go\/lst_ada"/);
  assert.doesNotMatch(adaCard, /data-later-foot/);
  assert.doesNotMatch(adaCard, /data-later-seat/);
  assert.match(holdCard, /class="later-foot"[^>]*data-later-foot/);
  assert.match(holdCard, /<a class="later-go" href="\/go\/lst_hold" data-later-go>/);
  assert.match(holdCard, /<span class="bid later-bid"[^>]*>\$8<\/span>/);
  assert.doesNotMatch(holdCard, /class="tally"/);
  assert.doesNotMatch(holdCard, /class="guest-site/);
  assert.doesNotMatch(holdCard, /data-guest-prize/);
  assert.doesNotMatch(holdCard, /data-first-click="guest"/);
  assert.match(thirdCard, /class="later-foot"[^>]*data-later-foot/);
  assert.match(thirdCard, /<a class="later-go" href="\/go\/lst_third" data-later-go>/);
  assert.doesNotMatch(thirdCard, /class="tally"/);
  assert.doesNotMatch(thirdCard, /data-guest-prize/);
  assert.match(vetoCard, /data-vetoed="true"/);
  assert.match(vetoCard, /Hard Sell Co/);
  assert.match(vetoCard, /Vetoed: hard sell/);
  assert.match(vetoCard, /class="tally"/);
  assert.doesNotMatch(vetoCard, /data-later-foot/);
  assert.doesNotMatch(vetoCard, /data-later-seat/);
  assert.doesNotMatch(vetoCard, /data-guest-prize/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.doesNotMatch(studio, /data-first-click="claim"/);
  assert.match(studio, /Claim #1 for/);
  assert.match(studio, /class="claim occupied-claim"/);
  assert.match(studio, /data-claim-state="open-occupied"/);
  assert.ok(studio.indexOf('id="claim"') < studio.indexOf("data-rundown"));
  assert.equal(countExact(studio, "data-guest-prize"), 1);
  assert.equal(countExact(studio, 'data-first-click="guest"'), 1);
  assert.equal(countExact(studio, "data-later-seat"), 2);
  assert.equal(countExact(studio, "data-later-foot"), 2);
  assert.equal(countExact(studio, "data-later-go"), 2);
  assert.equal(countAttr(studio, "data-later-fact"), 1);
  assert.match(studio, /class="studio studio-open-occupied"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /data-empty-honest/);
  assert.doesNotMatch(studio, /data-later-seat-first/);
  assert.doesNotMatch(studio, /data-later-foot-first/);
  assert.doesNotMatch(studio, /later-seat-after/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.doesNotMatch(studio, /data-first-click="claim"/);
  assert.match(studio, /Claim #1 for/);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);
  assert.match(body, /data-claim-live/);
  assert.match(body, />Outbid</);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot/);
  assert.match(studioCss, /grid-template-areas:\s*"cue person price"\s*"cue person price"\s*"cue foot price"/);
  assert.doesNotMatch(studioCss, /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.guest-site\.later-go/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.later-facts\[data-later-facts\]/);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_later_seat_quiet&name=Raise%20Co&siteUrl=https%3A%2F%2Fraise.example%2F&oneLiner=Still%20live.&bidUsd=13",
  });
  assert.equal(checkout.statusCode, 303);
  assert.match(String(checkout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);
  assert.doesNotMatch(checkout.body, /episode_locked/);
});

test("GET / on occupied live keeps #1 guest prize chrome — later-foot cannot leak onto #1", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_prize_not_foot",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  insertListing(db, {
    id: "lst_hold",
    episodeId: episode.id,
    name: "Hold Co",
    siteUrl: "https://hold.example/",
    oneLiner: "Still listed below #1.",
    bidUsd: 8,
    firstBidAt: "2026-08-22T01:10:00.000Z",
    paidAt: "2026-08-22T01:10:05.000Z",
    clicks: 2,
  });
  insertListing(db, {
    id: "lst_third",
    episodeId: episode.id,
    name: "Third Mic",
    siteUrl: "https://third.example/",
    oneLiner: "Also below #1.",
    bidUsd: 6,
    firstBidAt: "2026-08-22T01:20:00.000Z",
    paidAt: "2026-08-22T01:20:05.000Z",
    clicks: 1,
  });
  insertListing(db, {
    id: "lst_veto",
    episodeId: episode.id,
    name: "Hard Sell Co",
    siteUrl: "https://hardsell.example/",
    oneLiner: "Buy my course on air.",
    bidUsd: 20,
    firstBidAt: "2026-08-22T00:30:00.000Z",
    paidAt: "2026-08-22T00:30:05.000Z",
    clicks: 1,
    vetoedAt: "2026-08-22T02:00:00.000Z",
    vetoReason: "hard sell",
  });

  const app = await buildApp({ db });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const studio = studioMarkup(body);
  const adaStart = studio.indexOf('data-listing-id="lst_ada"');
  const holdStart = studio.indexOf('data-listing-id="lst_hold"');
  const thirdStart = studio.indexOf('data-listing-id="lst_third"');
  const vetoStart = studio.indexOf('data-listing-id="lst_veto"');
  assert.notEqual(adaStart, -1);
  assert.notEqual(holdStart, -1);
  assert.notEqual(thirdStart, -1);
  assert.notEqual(vetoStart, -1);
  const adaCard = studio.slice(adaStart, holdStart);
  const holdCard = studio.slice(holdStart, thirdStart);
  const thirdCard = studio.slice(thirdStart, vetoStart);
  const vetoCard = studio.slice(vetoStart);
  const prizeAt = adaCard.indexOf("data-guest-prize");
  const firstClickAt = adaCard.indexOf('data-first-click="guest"');
  const adaNameAt = adaCard.indexOf("Ada Lovelace");
  const factsAt = adaCard.indexOf("data-later-facts");
  const adaBidAt = adaCard.indexOf("$12");
  const adaClicksAt = adaCard.indexOf("3 clicks");
  const adaGoCount = countExact(adaCard, 'href="/go/lst_ada"');
  assert.ok(prizeAt !== -1 && firstClickAt !== -1 && adaNameAt !== -1 && factsAt !== -1);
  assert.ok(prizeAt < firstClickAt);
  assert.ok(firstClickAt < adaNameAt);
  assert.ok(adaNameAt < factsAt);
  assert.ok(adaBidAt < factsAt);
  assert.ok(adaBidAt < adaClicksAt);
  assert.equal(adaGoCount, 1);
  assert.match(adaCard, /<h2 class="guest-name"><a href="\/go\/lst_ada" data-first-click="guest">Ada Lovelace<\/a><\/h2>/);
  assert.match(adaCard, /class="later-facts"[^>]*data-later-facts/);
  assert.match(adaCard, /class="bid lead-bid later-fact"[^>]*data-later-fact/);
  assert.doesNotMatch(adaCard, /class="tally"/);
  assert.match(adaCard, /<p class="guest-site">example.com\/ada<\/p>/);
  assert.doesNotMatch(adaCard, /class="guest-site"><a href="\/go\/lst_ada"/);
  assert.doesNotMatch(adaCard, /data-later-foot/);
  assert.doesNotMatch(adaCard, /class="later-foot"/);
  assert.doesNotMatch(adaCard, /data-later-go/);
  assert.doesNotMatch(adaCard, /later-bid/);
  assert.doesNotMatch(holdCard, /data-later-facts/);
  assert.doesNotMatch(holdCard, /class="later-facts"/);
  assert.doesNotMatch(holdCard, /data-guest-prize/);
  assert.match(holdCard, /class="later-foot"[^>]*data-later-foot/);
  assert.match(holdCard, /<a class="later-go" href="\/go\/lst_hold" data-later-go>/);
  assert.match(holdCard, /<span class="bid later-bid"[^>]*>\$8<\/span>/);
  assert.doesNotMatch(thirdCard, /data-later-facts/);
  assert.doesNotMatch(thirdCard, /data-guest-prize/);
  assert.match(thirdCard, /class="later-foot"[^>]*data-later-foot/);
  assert.match(vetoCard, /data-vetoed="true"/);
  assert.match(vetoCard, /Hard Sell Co/);
  assert.match(vetoCard, /Vetoed: hard sell/);
  assert.match(vetoCard, /class="tally"/);
  assert.doesNotMatch(vetoCard, /data-later-facts/);
  assert.doesNotMatch(vetoCard, /data-later-foot/);
  assert.match(studio, /Claim #1 for/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.match(studio, /class="claim occupied-claim"/);
  assert.match(studio, /data-claim-state="open-occupied"/);
  assert.ok(studio.indexOf('id="claim"') < studio.indexOf("data-rundown"));
  assert.doesNotMatch(studio, /data-prize-not-foot/);
  assert.doesNotMatch(studio, /data-later-foot-first/);
  assert.equal(countExact(studio, "data-guest-prize"), 1);
  assert.equal(countExact(studio, 'data-first-click="guest"'), 1);
  assert.equal(countExact(studio, "data-later-facts"), 1);
  assert.equal(countExact(studio, 'class="later-facts"'), 1);
  assert.equal(countExact(studio, "data-later-foot"), 2);
  assert.equal(countExact(studio, 'class="later-foot"'), 2);
  assert.equal(countExact(studio, "data-later-seat"), 2);
  assert.equal(countExact(studio, "data-later-go"), 2);
  assert.equal(countAttr(studio, "data-later-fact"), 1);
  assert.match(studio, /class="studio studio-open-occupied"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /Claim #1 for/);
  assert.match(body, />Outbid</);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  const prizeName = studioCss.match(
    /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name\s*\{[^}]*font-size:\s*([\d.]+)px/,
  );
  const prizeBid = studioCss.match(
    /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] > \.lead-bid\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterFoot = studioCss.match(
    /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  assert.ok(prizeName);
  assert.ok(prizeBid);
  assert.ok(laterFoot);
  assert.ok(Number(prizeBid[1]) < Number(prizeName[1]));
  assert.ok(Number(laterFoot[1]) < Number(prizeName[1]));
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.later-facts\[data-later-facts\]/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot/);
  assert.doesNotMatch(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.later-foot/);
  assert.doesNotMatch(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \[data-later-foot\]/);
  assert.doesNotMatch(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.later-go/);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_prize_not_foot&name=Raise%20Co&siteUrl=https%3A%2F%2Fraise.example%2F&oneLiner=Still%20live.&bidUsd=13",
  });
  assert.equal(checkout.statusCode, 303);
  assert.match(String(checkout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);
  assert.doesNotMatch(checkout.body, /episode_locked/);
});

test("GET / on occupied live keeps one first click — host Lock stays after the rundown", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_lock_after",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  insertListing(db, {
    id: "lst_hold",
    episodeId: episode.id,
    name: "Hold Co",
    siteUrl: "https://hold.example/",
    oneLiner: "Still listed below #1.",
    bidUsd: 8,
    firstBidAt: "2026-08-22T01:10:00.000Z",
    paidAt: "2026-08-22T01:10:05.000Z",
    clicks: 2,
  });
  insertListing(db, {
    id: "lst_veto",
    episodeId: episode.id,
    name: "Hard Sell Co",
    siteUrl: "https://hardsell.example/",
    oneLiner: "Buy my course on air.",
    bidUsd: 20,
    firstBidAt: "2026-08-22T00:30:00.000Z",
    paidAt: "2026-08-22T00:30:05.000Z",
    clicks: 1,
    vetoedAt: "2026-08-22T02:00:00.000Z",
    vetoReason: "hard sell",
  });

  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const studio = studioMarkup(body);
  const ticketAt = studio.indexOf("data-show-ticket");
  const claimAt = studio.indexOf('id="claim"');
  const rundownAt = studio.indexOf("data-rundown");
  const adaStart = studio.indexOf('data-listing-id="lst_ada"');
  const holdStart = studio.indexOf('data-listing-id="lst_hold"');
  const vetoStart = studio.indexOf('data-listing-id="lst_veto"');
  const guestClickAt = studio.indexOf('data-first-click="guest"');
  const deskAt = studio.indexOf("data-host-lock");
  const lockBtnAt = studio.indexOf('class="lock-episode"');
  const sessionAt = studio.indexOf('placeholder="Host session"');
  const outbidAt = studio.indexOf(">Outbid");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(adaStart, -1);
  assert.notEqual(holdStart, -1);
  assert.notEqual(vetoStart, -1);
  assert.notEqual(guestClickAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(lockBtnAt, -1);
  assert.notEqual(sessionAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.ok(ticketAt < rundownAt);
  assert.ok(rundownAt < adaStart);
  assert.ok(adaStart < holdStart);
  assert.ok(holdStart < vetoStart);
  assert.ok(claimAt < guestClickAt);
  assert.ok(claimAt < vetoStart);
  assert.ok(claimAt < rundownAt);
  assert.ok(claimAt < deskAt);
  assert.ok(outbidAt < rundownAt);
  assert.ok(outbidAt < deskAt);
  assert.ok(lockBtnAt > rundownAt);
  assert.ok(sessionAt > rundownAt);
  const adaCard = studio.slice(adaStart, holdStart);
  const holdCard = studio.slice(holdStart, vetoStart);
  const vetoCard = studio.slice(vetoStart, deskAt);
  assert.match(adaCard, /data-guest-prize/);
  assert.match(adaCard, /<h2 class="guest-name"><a href="\/go\/lst_ada" data-first-click="guest">Ada Lovelace<\/a><\/h2>/);
  assert.match(adaCard, /class="later-facts"[^>]*data-later-facts/);
  assert.doesNotMatch(adaCard, /data-later-foot/);
  assert.match(holdCard, /class="later-foot"[^>]*data-later-foot/);
  assert.match(holdCard, /<a class="later-go" href="\/go\/lst_hold" data-later-go>/);
  assert.doesNotMatch(holdCard, /data-first-click="guest"/);
  assert.match(vetoCard, /data-vetoed="true"/);
  assert.match(vetoCard, /Hard Sell Co/);
  assert.match(vetoCard, /Vetoed: hard sell/);
  assert.doesNotMatch(vetoCard, /data-later-foot/);
  assert.match(studio, /class="studio studio-open-occupied"/);
  assert.match(studio, /data-host-lock/);
  assert.match(studio, /Lock episode/);
  assert.match(studio, /Lock Episode 12 — book Ada Lovelace\./);
  assert.match(studio, /action="\/host\/lock"/);
  assert.match(studio, /class="lock-episode"/);
  assert.equal(countExact(studio, 'data-first-click="guest"'), 1);
  assert.equal(countExact(studio, "data-guest-prize"), 1);
  assert.equal(countExact(studio, "data-later-seat"), 1);
  assert.equal(countExact(studio, "data-later-foot"), 1);
  assert.equal(countExact(studio, "data-host-lock"), 1);
  assert.doesNotMatch(studio, /data-first-click="claim"/);
  assert.match(studio, /Claim #1 for/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.doesNotMatch(studio, /data-guest-before-lock/);
  assert.match(studio, /class="claim occupied-claim"/);
  assert.match(studio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(studio, /data-guest-before-claim/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /data-empty-honest/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /data-checkout-state="locked"/);
  assert.doesNotMatch(studio, /This episode is locked/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /Claim #1 for/);
  assert.match(body, />Outbid</);
  assert.match(body, /action="\/checkout"/);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_lock_after&name=Raise%20Co&siteUrl=https%3A%2F%2Fraise.example%2F&oneLiner=Still%20live.&bidUsd=13",
  });
  assert.equal(checkout.statusCode, 303);
  assert.match(String(checkout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);
  assert.doesNotMatch(checkout.body, /episode_locked/);
});

test("GET / on occupied live keeps one first click — Claim stays after the #1 guest", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_guest_before_claim",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  insertListing(db, {
    id: "lst_hold",
    episodeId: episode.id,
    name: "Hold Co",
    siteUrl: "https://hold.example/",
    oneLiner: "Still listed below #1.",
    bidUsd: 8,
    firstBidAt: "2026-08-22T01:10:00.000Z",
    paidAt: "2026-08-22T01:10:05.000Z",
    clicks: 2,
  });
  insertListing(db, {
    id: "lst_veto",
    episodeId: episode.id,
    name: "Hard Sell Co",
    siteUrl: "https://hardsell.example/",
    oneLiner: "Buy my course on air.",
    bidUsd: 20,
    firstBidAt: "2026-08-22T00:30:00.000Z",
    paidAt: "2026-08-22T00:30:05.000Z",
    clicks: 1,
    vetoedAt: "2026-08-22T02:00:00.000Z",
    vetoReason: "hard sell",
  });

  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const studio = studioMarkup(body);
  const ticketAt = studio.indexOf("data-show-ticket");
  const rundownAt = studio.indexOf("data-rundown");
  const adaStart = studio.indexOf('data-listing-id="lst_ada"');
  const holdStart = studio.indexOf('data-listing-id="lst_hold"');
  const vetoStart = studio.indexOf('data-listing-id="lst_veto"');
  const guestClickAt = studio.indexOf('data-first-click="guest"');
  const laterClaimClassAt = studio.indexOf('class="claim occupied-claim"');
  const laterClaimAt = studio.indexOf('data-claim-state="open-occupied"');
  const claimAt = studio.indexOf('id="claim"');
  const claimTitleAt = studio.indexOf("Claim #1 for");
  const outbidAt = studio.indexOf(">Outbid");
  const deskAt = studio.indexOf("data-host-lock");
  const lockBtnAt = studio.indexOf('class="lock-episode"');
  const sessionAt = studio.indexOf('placeholder="Host session"');
  assert.notEqual(ticketAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(adaStart, -1);
  assert.notEqual(holdStart, -1);
  assert.notEqual(vetoStart, -1);
  assert.notEqual(guestClickAt, -1);
  assert.notEqual(laterClaimClassAt, -1);
  assert.notEqual(laterClaimAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(claimTitleAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(lockBtnAt, -1);
  assert.notEqual(sessionAt, -1);
  assert.ok(ticketAt < rundownAt);
  assert.ok(rundownAt < adaStart);
  assert.ok(adaStart < holdStart);
  assert.ok(holdStart < vetoStart);
  assert.ok(laterClaimClassAt < guestClickAt);
  assert.ok(laterClaimClassAt < vetoStart);
  assert.ok(laterClaimClassAt < rundownAt);
  assert.ok(laterClaimClassAt < claimAt);
  assert.ok(claimAt < laterClaimAt);
  assert.ok(laterClaimAt < claimTitleAt);
  assert.ok(claimTitleAt < outbidAt);
  assert.ok(outbidAt < deskAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockBtnAt > claimAt);
  assert.ok(sessionAt > claimAt);
  const adaCard = studio.slice(adaStart, holdStart);
  const holdCard = studio.slice(holdStart, vetoStart);
  const vetoCard = studio.slice(vetoStart, deskAt);
  const claimBlock = studio.slice(laterClaimClassAt, deskAt);
  assert.match(adaCard, /data-guest-prize/);
  assert.match(adaCard, /<h2 class="guest-name"><a href="\/go\/lst_ada" data-first-click="guest">Ada Lovelace<\/a><\/h2>/);
  assert.match(adaCard, /class="later-facts"[^>]*data-later-facts/);
  assert.doesNotMatch(adaCard, /id="claim"/);
  assert.doesNotMatch(adaCard, /data-claim-state="open-occupied"/);
  assert.match(holdCard, /class="later-foot"[^>]*data-later-foot/);
  assert.doesNotMatch(holdCard, /data-first-click="guest"/);
  assert.doesNotMatch(holdCard, /data-claim-state="open-occupied"/);
  assert.match(vetoCard, /data-vetoed="true"/);
  assert.match(vetoCard, /Hard Sell Co/);
  assert.match(vetoCard, /Vetoed: hard sell/);
  assert.doesNotMatch(vetoCard, /data-claim-state="open-occupied"/);
  assert.match(studio, /class="claim occupied-claim"[^>]*id="claim"[^>]*data-claim-state="open-occupied"/);
  assert.match(claimBlock, /data-claim-state="open-occupied"/);
  assert.match(claimBlock, /data-occupied-window/);
  assert.match(claimBlock, /data-claim-live/);
  assert.match(claimBlock, /Claim #1 for/);
  assert.match(claimBlock, /Rank is the bid/);
  assert.match(claimBlock, /Paid placements remain eligible for seven days/);
  assert.match(claimBlock, /does not reset at Monday midnight/);
  assert.match(claimBlock, /A host lock still closes the episode/);
  assert.match(claimBlock, /Host review is on\./);
  assert.match(claimBlock, /Already on this episode\?/);
  assert.match(claimBlock, />Outbid/);
  assert.match(claimBlock, /action="\/checkout"/);
  assert.doesNotMatch(claimBlock, /data-empty-claim-window/);
  assert.doesNotMatch(claimBlock, /data-first-click="claim"/);
  assert.doesNotMatch(claimBlock, /data-empty-claim-first/);
  assert.match(studio, /class="studio studio-open-occupied"/);
  assert.match(studio, /data-host-lock/);
  assert.match(studio, /Lock Episode 12 — book Ada Lovelace\./);
  assert.equal(countExact(studio, 'data-first-click="guest"'), 1);
  assert.equal(countExact(studio, "data-guest-prize"), 1);
  assert.equal(countAttr(studio, 'data-claim-state="open-occupied"'), 1);
  assert.equal(countExact(studio, "data-occupied-window"), 1);
  assert.equal(countExact(studio, 'class="claim occupied-claim"'), 1);
  assert.equal(countExact(studio, "data-later-seat"), 1);
  assert.equal(countExact(studio, "data-later-foot"), 1);
  assert.equal(countExact(studio, "data-host-lock"), 1);
  assert.doesNotMatch(studio, /data-first-click="claim"/);
  assert.match(studio, /Claim #1 for/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.doesNotMatch(studio, /data-guest-before-claim/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /data-empty-honest/);
  assert.doesNotMatch(studio, /This episode is locked/);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  const prizeName = studioCss.match(
    /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name\s*\{[^}]*font-size:\s*([\d.]+)px/,
  );
  const laterClaimTitle = studioCss.match(
    /@media \(max-width: 760px\)[\s\S]*\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.claim-title\s*\{[\s\S]*font-size:\s*24px/,
  );
  assert.ok(prizeName);
  assert.ok(laterClaimTitle);
  assert.ok(laterClaimTitle);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\]/);
  assert.match(
    studioCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.claim-note\[data-occupied-window\]/,
  );
  assert.match(studioCss, /\.studio\.studio-open-occupied \.week-window\[data-rolling-week\]/);

  const emptyDb = memoryDb();
  createEpisode(emptyDb, {
    id: "ep_empty_before_claim",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const emptyApp = await buildApp({ db: emptyDb });
  after(() => emptyApp.close());
  const emptyBoard = await emptyApp.inject({ method: "GET", url: "/" });
  const emptyStudio = studioMarkup(emptyBoard.body);
  assert.match(emptyStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(emptyStudio, /Claim #1 for/);
  assert.match(emptyStudio, /data-first-click="claim"/);
  assert.match(emptyStudio, /data-identity-fields/);
  assert.match(emptyStudio, /data-identity-fields/);
  assert.doesNotMatch(emptyStudio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(emptyStudio, /data-occupied-window/);
  assert.doesNotMatch(emptyStudio, /class="claim occupied-claim"/);
  assert.doesNotMatch(emptyStudio, /data-first-click="guest"/);
  assert.doesNotMatch(emptyStudio, /data-guest-prize/);
  assert.doesNotMatch(emptyStudio, /studio-open-occupied/);
  const emptyCss = emptyBoard.body.slice(
    emptyBoard.body.indexOf("<style>"),
    emptyBoard.body.indexOf("</style>"),
  );
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-claim-state="open-occupied"\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-occupied-window\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-claim-state="open-occupied"\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-occupied-window\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \.occupied-claim/);
  assert.doesNotMatch(
    emptyCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\]/,
  );

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_guest_before_claim&name=Raise%20Co&siteUrl=https%3A%2F%2Fraise.example%2F&oneLiner=Still%20live.&bidUsd=13",
  });
  assert.equal(checkout.statusCode, 303);
  assert.match(String(checkout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);
  assert.doesNotMatch(checkout.body, /episode_locked/);

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=ep_guest_before_claim&session=${encodeURIComponent(DEV_HOST_SESSION_SECRET)}`,
  });
  assert.equal(locked.statusCode, 303);
  const afterLock = await app.inject({ method: "GET", url: "/" });
  const lockedStudio = studioMarkup(afterLock.body);
  assert.match(lockedStudio, /Episode 12 is locked/);
  assert.match(lockedStudio, /data-checkout-state="locked"/);
  assert.match(lockedStudio, /Hard Sell Co/);
  assert.doesNotMatch(lockedStudio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(lockedStudio, /data-occupied-window/);
  assert.doesNotMatch(lockedStudio, /class="claim occupied-claim"/);
  const lockedCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_guest_before_claim&name=Too%20Late&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Locked.&bidUsd=13",
  });
  assert.equal(lockedCheckout.statusCode, 409);
  assert.match(lockedCheckout.body, /data-checkout-state="locked"/);
  assert.match(lockedCheckout.body, /This episode is locked/);
});

test("occupied week window is rolling last-7-days — not a civil-midnight lock", async () => {
  const emptyDb = memoryDb();
  createEpisode(emptyDb, {
    id: "ep_empty_window",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-16T00:00:00.000Z",
  });
  const emptyApp = await buildApp({ db: emptyDb });
  after(() => emptyApp.close());
  const emptyBoard = await emptyApp.inject({ method: "GET", url: "/" });
  const emptyStudio = studioMarkup(emptyBoard.body);
  assert.match(emptyStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(emptyStudio, /Claim #1 for/);
  assert.match(emptyStudio, /data-first-click="claim"/);
  assert.match(emptyStudio, /data-identity-fields/);
  assert.match(emptyStudio, /data-identity-fields/);
  assert.match(emptyStudio, /Paid placements remain eligible for seven days/);
  assert.match(emptyStudio, /does not reset at Monday midnight/);
  assert.match(emptyStudio, /A host lock still closes the episode/);
  assert.match(emptyStudio, /data-empty-window/);
  assert.match(emptyStudio, /class="empty-window"/);
  assert.match(emptyStudio, /data-empty-claim-window/);
  assert.doesNotMatch(emptyStudio, /data-occupied-window/);
  assert.doesNotMatch(emptyStudio, /data-rolling-week/);
  assert.doesNotMatch(emptyStudio, /class="week-window"/);
  assert.doesNotMatch(emptyStudio, /Rolling last 7 days\. does not reset at Monday midnight\./);
  assert.doesNotMatch(emptyStudio, /data-first-click="guest"/);
  assert.doesNotMatch(emptyStudio, /data-guest-prize/);
  assert.doesNotMatch(emptyStudio, /studio-open-occupied/);
  assert.doesNotMatch(emptyStudio, /24h lock/);
  assert.doesNotMatch(emptyStudio, /data-unpaid-off/);
  const emptyCss = emptyBoard.body.slice(
    emptyBoard.body.indexOf("<style>"),
    emptyBoard.body.indexOf("</style>"),
  );
  assert.match(emptyCss, /Empty open: name the fair occupied-rank window/);
  assert.match(
    emptyCss,
    /\.studio\.studio-open-empty\[data-empty-honest\] \.empty\.open-seat\[data-empty-honest\] \.empty-window\[data-empty-window\]/,
  );
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-rolling-week\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-occupied-window\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-rolling-week\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \.week-window/);
  assert.doesNotMatch(
    emptyCss,
    /\.studio\.studio-open-occupied \.rundown\[data-rolling-week\] \.week-window\[data-rolling-week\]/,
  );

  const monday = new Date("2026-08-17T00:00:00.000Z");
  const episode = {
    id: "ep_rolling_week",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat" as const,
    vetoEnabled: true,
    opensAt: "2026-08-16T00:00:00.000Z",
    locksAt: null,
    lockedAt: null,
  };
  const listings: Listing[] = [
    {
      id: "lst_ada",
      episodeId: episode.id,
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 12,
      firstBidAt: "2026-08-16T12:00:00.000Z",
      paidAt: "2026-08-16T12:00:00.000Z",
      clicks: 3,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_hold",
      episodeId: episode.id,
      name: "Hold Co",
      siteUrl: "https://hold.example/",
      oneLiner: "Still listed below #1.",
      bidUsd: 8,
      firstBidAt: "2026-08-16T18:00:00.000Z",
      paidAt: "2026-08-16T18:00:00.000Z",
      clicks: 2,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_veto",
      episodeId: episode.id,
      name: "Hard Sell Co",
      siteUrl: "https://hardsell.example/",
      oneLiner: "Buy my course on air.",
      bidUsd: 20,
      firstBidAt: "2026-08-16T11:00:00.000Z",
      paidAt: "2026-08-16T11:00:00.000Z",
      clicks: 1,
      vetoedAt: "2026-08-16T19:00:00.000Z",
      vetoReason: "hard sell",
    },
  ];
  const occupiedHtml = renderBoardHtml(episode, listings, monday);
  const occupied = studioMarkup(occupiedHtml);
  const ticketAt = occupied.indexOf("data-show-ticket");
  const rundownAt = occupied.indexOf("data-rundown");
  const windowAt = occupied.indexOf('data-rolling-week=""');
  const adaStart = occupied.indexOf('data-listing-id="lst_ada"');
  const holdStart = occupied.indexOf('data-listing-id="lst_hold"');
  const vetoStart = occupied.indexOf('data-listing-id="lst_veto"');
  const guestClickAt = occupied.indexOf('data-first-click="guest"');
  const laterClaimAt = occupied.indexOf('data-claim-state="open-occupied"');
  const laterClaimWindowAt = occupied.indexOf("data-occupied-window");
  const rollingCopyAt = occupied.indexOf("Paid placements remain eligible for seven days");
  const claimAt = occupied.indexOf('id="claim"');
  const outbidAt = occupied.indexOf(">Outbid");
  const deskAt = occupied.indexOf("data-host-lock");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(windowAt, -1);
  assert.notEqual(adaStart, -1);
  assert.notEqual(holdStart, -1);
  assert.notEqual(vetoStart, -1);
  assert.notEqual(guestClickAt, -1);
  assert.notEqual(laterClaimAt, -1);
  assert.notEqual(laterClaimWindowAt, -1);
  assert.notEqual(rollingCopyAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.notEqual(deskAt, -1);
  assert.ok(ticketAt < rundownAt);
  assert.ok(rundownAt <= windowAt);
  assert.ok(windowAt < guestClickAt);
  assert.ok(laterClaimAt < guestClickAt);
  assert.ok(laterClaimAt < vetoStart);
  assert.ok(laterClaimAt < laterClaimWindowAt);
  assert.ok(laterClaimWindowAt < rollingCopyAt);
  assert.ok(rollingCopyAt < outbidAt);
  assert.ok(outbidAt < deskAt);
  assert.ok(laterClaimAt < deskAt);
  assert.ok(claimAt < deskAt);
  assert.match(occupied, /class="studio studio-open-occupied"/);
  assert.match(occupied, /data-rolling-week=""/);
  assert.match(occupied, /Paid placements remain eligible for seven days\./);
  assert.match(occupied, /class="week-window"/);
  assert.doesNotMatch(occupied, /data-empty-window/);
  assert.doesNotMatch(occupied, /class="empty-window"/);
  assert.doesNotMatch(occupied, /data-empty-claim-window/);
  assert.match(occupied, /data-occupied-window/);
  assert.match(occupied, /Paid placements remain eligible for seven days/);
  assert.match(occupied, /A host lock still closes the episode/);
  assert.match(occupied, /Rank is the bid/);
  assert.match(occupied, /Host review is on\./);
  assert.match(occupied, /class="rundown[^\"]*"[^>]*data-rolling-week=""/);
  assert.match(occupied, /Ada Lovelace/);
  assert.match(occupied, /data-first-click="guest"/);
  assert.match(occupied, /data-guest-prize/);
  assert.match(occupied, /class="claim occupied-claim"/);
  assert.match(occupied, /data-claim-state="open-occupied"/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, />Outbid</);
  assert.match(occupied, /data-host-lock/);
  assert.match(occupied, /Lock Episode 12 — book Ada Lovelace\./);
  assert.match(occupied, /Hard Sell Co/);
  assert.match(occupied, /Vetoed: hard sell/);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /24h lock/);
  assert.doesNotMatch(occupied, /data-unpaid-off/);
  assert.doesNotMatch(occupied, /data-guest-before-claim/);
  assert.equal(countExact(occupied, 'data-first-click="guest"'), 1);
  assert.equal(countExact(occupied, "data-guest-prize"), 1);
  const occupiedCss = occupiedHtml.slice(
    occupiedHtml.indexOf("<style>"),
    occupiedHtml.indexOf("</style>"),
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.week-window\[data-rolling-week\]/,
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name a\[data-first-click="guest"\]/,
  );
  assert.doesNotMatch(occupiedCss, /background:\s*var\(--lamp\)[\s\S]{0,80}rolling-week/);

  const expired = renderBoardHtml(
    episode,
    listings,
    new Date("2026-08-23T18:00:01.000Z"),
  );
  const expiredStudio = studioMarkup(expired);
  assert.match(expiredStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(expiredStudio, /Claim #1 for/);
  assert.match(expiredStudio, /data-first-click="claim"/);
  assert.match(expiredStudio, /data-identity-fields/);
  assert.match(expiredStudio, /Paid placements remain eligible for seven days/);
  assert.match(expiredStudio, /data-empty-window/);
  assert.match(expiredStudio, /data-empty-claim-window/);
  assert.doesNotMatch(expiredStudio, /data-rolling-week/);
  assert.doesNotMatch(expiredStudio, /class="week-window"/);
  assert.doesNotMatch(expiredStudio, /Rolling last 7 days\. does not reset at Monday midnight\./);
  assert.doesNotMatch(expiredStudio, /data-first-click="guest"/);
  assert.doesNotMatch(expiredStudio, /data-guest-prize/);
  assert.doesNotMatch(expiredStudio, /Ada Lovelace/);
  assert.doesNotMatch(expiredStudio, /studio-open-occupied/);
  assert.doesNotMatch(expiredStudio, /data-host-lock/);
  assert.doesNotMatch(expiredStudio, /24h lock/);

  const db = memoryDb();
  createEpisode(db, {
    id: "ep_live_window",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-16T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: "ep_live_window",
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  insertListing(db, {
    id: "lst_hold",
    episodeId: "ep_live_window",
    name: "Hold Co",
    siteUrl: "https://hold.example/",
    oneLiner: "Still listed below #1.",
    bidUsd: 8,
    firstBidAt: "2026-08-22T01:10:00.000Z",
    paidAt: "2026-08-22T01:10:05.000Z",
    clicks: 2,
  });
  insertListing(db, {
    id: "lst_veto",
    episodeId: "ep_live_window",
    name: "Hard Sell Co",
    siteUrl: "https://hardsell.example/",
    oneLiner: "Buy my course on air.",
    bidUsd: 20,
    firstBidAt: "2026-08-22T00:30:00.000Z",
    paidAt: "2026-08-22T00:30:05.000Z",
    clicks: 1,
    vetoedAt: "2026-08-22T02:00:00.000Z",
    vetoReason: "hard sell",
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const live = await app.inject({ method: "GET", url: "/" });
  assert.equal(live.statusCode, 200);
  const liveStudio = studioMarkup(live.body);
  assert.match(liveStudio, /class="studio studio-open-occupied"/);
  assert.match(liveStudio, /data-rolling-week=""/);
  assert.match(liveStudio, /Paid placements remain eligible for seven days\./);
  assert.match(liveStudio, /data-first-click="guest"/);
  assert.match(liveStudio, /class="claim occupied-claim"/);
  assert.match(liveStudio, /data-occupied-window/);
  assert.match(liveStudio, /Paid placements remain eligible for seven days/);
  assert.match(liveStudio, /data-host-lock/);
  assert.match(liveStudio, /Hard Sell Co/);
  assert.match(liveStudio, /Claim #1 for/);
  assert.doesNotMatch(liveStudio, /24h lock/);

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=ep_live_window&session=${encodeURIComponent(DEV_HOST_SESSION_SECRET)}`,
  });
  assert.equal(locked.statusCode, 303);
  const afterLock = await app.inject({ method: "GET", url: "/" });
  const lockedStudio = studioMarkup(afterLock.body);
  assert.match(lockedStudio, /Episode 12 is locked/);
  assert.match(lockedStudio, /data-checkout-state="locked"/);
  assert.match(lockedStudio, /Hard Sell Co/);
  assert.doesNotMatch(lockedStudio, /data-rolling-week/);
  assert.doesNotMatch(lockedStudio, /Rolling last 7 days/);
  assert.doesNotMatch(lockedStudio, /data-empty-window/);
  assert.doesNotMatch(lockedStudio, /data-empty-claim-window/);
  assert.doesNotMatch(lockedStudio, /data-occupied-window/);
  assert.doesNotMatch(lockedStudio, /Paid placements remain eligible for seven days/);
  const lockedCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_live_window&name=Too%20Late&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Locked.&bidUsd=13",
  });
  assert.equal(lockedCheckout.statusCode, 409);
  assert.match(lockedCheckout.body, /data-checkout-state="locked"/);
  assert.match(lockedCheckout.body, /This episode is locked/);
});

test("GET / on a fresh-open empty episode names rolling last-7-days — not Monday 00:00 UTC", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_empty_rolling_copy",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const studio = studioMarkup(body);
  const claimAt = studio.indexOf('id="claim"');
  const claimCopyAt = studio.indexOf("Claim #1 for");
  const windowAt = studio.indexOf("data-empty-window");
  const rollingCopyAt = studio.indexOf("Paid placements remain eligible for seven days");
  const mondayAt = studio.indexOf("does not reset at Monday midnight");
  const guestClickAt = studio.indexOf('data-first-click="guest"');
  const weekChromeAt = studio.indexOf("data-rolling-week");
  const weekClassAt = studio.indexOf('class="week-window"');
  const lockAt = studio.indexOf("data-host-lock");
  assert.notEqual(claimAt, -1);
  assert.notEqual(claimCopyAt, -1);
  assert.notEqual(windowAt, -1);
  assert.notEqual(rollingCopyAt, -1);
  assert.notEqual(mondayAt, -1);
  assert.ok(claimCopyAt > claimAt);
  const slabRollingAt = studio.indexOf("Paid placements remain eligible for seven days", windowAt);
  assert.ok(slabRollingAt > windowAt);
  assert.ok(mondayAt > rollingCopyAt);
  assert.equal(guestClickAt, -1);
  assert.equal(weekChromeAt, -1);
  assert.equal(weekClassAt, -1);
  assert.equal(lockAt, -1);
  assert.match(studio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(studio, /Claim #1 for/);
  assert.match(studio, /data-first-click="claim"/);
  assert.match(studio, /data-identity-fields/);
  assert.match(studio, /data-identity-fields/);
  assert.match(studio, /class="empty-window"/);
  assert.match(studio, /data-empty-window/);
  assert.match(studio, /data-empty-claim-window/);
  assert.match(studio, /Paid placements remain eligible for seven days/);
  assert.match(studio, /does not reset at Monday midnight/);
  assert.match(studio, /A host lock still closes the episode/);
  assert.match(studio, /\$5 takes #1/);
  assert.match(studio, /data-open-seat/);
  assert.match(studio, /data-claim-live/);
  assert.equal(countExact(studio, "data-empty-honest"), 3);
  assert.equal(countExact(studio, "data-empty-window"), 1);
  assert.equal(countExact(studio, "data-empty-claim-window"), 1);
  assert.equal(countExact(studio, 'data-first-click="claim"'), 1);
  assert.doesNotMatch(studio, /data-rolling-week/);
  assert.doesNotMatch(studio, /class="week-window"/);
  assert.doesNotMatch(studio, /Rolling last 7 days\. does not reset at Monday midnight\./);
  assert.doesNotMatch(studio, /data-rundown/);
  assert.doesNotMatch(studio, /data-guest-prize/);
  assert.doesNotMatch(studio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(studio, /data-occupied-window/);
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /data-host-lock/);
  assert.doesNotMatch(studio, /24h lock/);
  assert.doesNotMatch(studio, /data-empty-rolling-after/);
  assert.doesNotMatch(body, /featured guest/i);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /Empty open: name the fair occupied-rank window/);
  assert.match(
    studioCss,
    /\.studio\.studio-open-empty\[data-empty-honest\] \.empty\.open-seat\[data-empty-honest\] \.empty-window\[data-empty-window\]/,
  );
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-rolling-week\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \.week-window/);
  const emptyWindowCss = (
    studioCss.split("Empty open: name the fair occupied-rank window", 2)[1] ?? ""
  ).split("Empty open: claim-note names rolling last-7-days beside Claim #1")[0] ?? "";
  assert.match(emptyWindowCss, /color:\s*var\(--muted\)/);
  assert.match(emptyWindowCss, /font-family:\s*var\(--mono\)/);
  assert.doesNotMatch(emptyWindowCss, /background:/);
  assert.doesNotMatch(emptyWindowCss, /var\(--lamp\)/);
  assert.doesNotMatch(emptyWindowCss, /var\(--on-air\)/);
  assert.doesNotMatch(
    studioCss,
    /\.studio\.studio-open-occupied \.rundown\[data-rolling-week\] \.week-window\[data-rolling-week\]/,
  );

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_empty_rolling_copy&name=First%20Guest&siteUrl=https%3A%2F%2Ffirst.example%2F&oneLiner=First%20bid%20on%20a%20live%20seat.&bidUsd=5",
  });
  assert.equal(checkout.statusCode, 303);
  const location = String(checkout.headers.location ?? "");
  assert.match(location, /\/checkout\/complete\?checkoutId=/);
  assert.doesNotMatch(checkout.body, /episode_locked/);

  const complete = await app.inject({ method: "GET", url: location });
  assert.equal(complete.statusCode, 303);

  const occupiedBoard = await app.inject({ method: "GET", url: "/" });
  const occupied = studioMarkup(occupiedBoard.body);
  assert.match(occupied, /class="studio studio-open-occupied"/);
  assert.match(occupied, /Paid placements remain eligible for seven days\./);
  assert.match(occupied, /class="week-window"/);
  assert.match(occupied, /data-rolling-week=""/);
  assert.match(occupied, /data-first-click="guest"/);
  assert.match(occupied, /data-host-lock/);
  assert.match(occupied, /First Guest/);
  assert.match(occupied, /class="claim occupied-claim"/);
  assert.match(occupied, /data-occupied-window/);
  assert.match(occupied, /Paid placements remain eligible for seven days/);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /data-empty-window/);
  assert.doesNotMatch(occupied, /class="empty-window"/);
  assert.doesNotMatch(occupied, /data-empty-claim-window/);

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=ep_empty_rolling_copy&session=${encodeURIComponent(DEV_HOST_SESSION_SECRET)}`,
  });
  assert.equal(locked.statusCode, 303);
  const afterLock = await app.inject({ method: "GET", url: "/" });
  const lockedStudio = studioMarkup(afterLock.body);
  assert.match(lockedStudio, /Episode 1 is locked/);
  assert.match(lockedStudio, /data-checkout-state="locked"/);
  assert.match(lockedStudio, /First Guest/);
  assert.doesNotMatch(lockedStudio, /data-empty-window/);
  assert.doesNotMatch(lockedStudio, /data-empty-claim-window/);
  assert.doesNotMatch(lockedStudio, /data-occupied-window/);
  assert.doesNotMatch(lockedStudio, /Paid placements remain eligible for seven days/);
  assert.doesNotMatch(lockedStudio, /data-rolling-week/);
  const lockedCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_empty_rolling_copy&name=Too%20Late&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Locked.&bidUsd=13",
  });
  assert.equal(lockedCheckout.statusCode, 409);
  assert.match(lockedCheckout.body, /This episode is locked/);
});

test("GET / on a fresh-open empty episode names rolling last-7-days on the claim-note beside Claim #1", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_empty_claim_window",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  const studio = studioMarkup(body);
  const claimAt = studio.indexOf('id="claim"');
  const firstClickAt = studio.indexOf('data-first-click="claim"');
  const claimCopyAt = studio.indexOf("Claim #1 for");
  const claimNoteAt = studio.indexOf('class="claim-note"');
  const claimWindowAt = studio.indexOf("data-empty-claim-window");
  const rollingCopyAt = studio.indexOf("Paid placements remain eligible for seven days");
  const mondayAt = studio.indexOf("does not reset at Monday midnight");
  const lockCopyAt = studio.indexOf("A host lock still closes the episode");
  const outbidAt = studio.indexOf(">Outbid</button>");
  const windowAt = studio.indexOf("data-empty-window");
  const guestClickAt = studio.indexOf('data-first-click="guest"');
  const weekChromeAt = studio.indexOf("data-rolling-week");
  const weekClassAt = studio.indexOf('class="week-window"');
  const lockAt = studio.indexOf("data-host-lock");
  assert.notEqual(claimAt, -1);
  assert.notEqual(firstClickAt, -1);
  assert.notEqual(claimCopyAt, -1);
  assert.notEqual(claimNoteAt, -1);
  assert.notEqual(claimWindowAt, -1);
  assert.notEqual(rollingCopyAt, -1);
  assert.notEqual(mondayAt, -1);
  assert.notEqual(lockCopyAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.notEqual(windowAt, -1);
  assert.ok(firstClickAt > claimAt);
  assert.ok(claimCopyAt > firstClickAt);
  assert.ok(claimNoteAt > claimCopyAt);
  assert.ok(claimWindowAt > claimNoteAt);
  assert.ok(rollingCopyAt > claimWindowAt);
  assert.ok(mondayAt > rollingCopyAt);
  assert.ok(lockCopyAt > mondayAt);
  assert.ok(outbidAt > lockCopyAt);
  const slabRollingAt = studio.indexOf("Paid placements remain eligible for seven days", windowAt);
  assert.ok(slabRollingAt > windowAt);
  assert.equal(guestClickAt, -1);
  assert.equal(weekChromeAt, -1);
  assert.equal(weekClassAt, -1);
  assert.equal(lockAt, -1);
  assert.match(studio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(studio, /Claim #1 for/);
  assert.match(studio, /class="claim empty-claim-first"/);
  assert.match(studio, /data-first-click="claim"/);
  assert.match(studio, /data-identity-fields/);
  assert.match(studio, /data-identity-fields/);
  assert.match(studio, /class="claim-note"/);
  assert.match(studio, /data-empty-claim-window/);
  assert.match(studio, /Paid placements remain eligible for seven days/);
  assert.match(studio, /does not reset at Monday midnight/);
  assert.match(studio, /A host lock still closes the episode/);
  assert.match(studio, /\$5 takes #1/);
  assert.match(studio, /The guest seat is open/);
  assert.match(studio, /data-claim-live/);
  assert.match(studio, /class="empty-window"/);
  assert.match(studio, /data-empty-window/);
  assert.match(studio, /data-open-seat/);
  assert.match(studio, /data-claim-live/);
  assert.match(studio, />Outbid<\/button>/);
  assert.equal(countExact(studio, "data-empty-honest"), 3);
  assert.equal(countExact(studio, "data-empty-claim-window"), 1);
  assert.equal(countExact(studio, "data-empty-window"), 1);
  assert.equal(countExact(studio, "Paid placements remain eligible for seven days"), 2);
  assert.equal(countExact(studio, 'data-first-click="claim"'), 1);
  assert.doesNotMatch(studio, /data-rolling-week/);
  assert.doesNotMatch(studio, /class="week-window"/);
  assert.doesNotMatch(studio, /Rolling last 7 days\. does not reset at Monday midnight\./);
  assert.doesNotMatch(studio, /data-rundown/);
  assert.doesNotMatch(studio, /data-guest-prize/);
  assert.doesNotMatch(studio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(studio, /data-occupied-window/);
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /data-host-lock/);
  assert.doesNotMatch(studio, /24h lock/);
  assert.doesNotMatch(studio, /data-empty-rolling-after/);
  assert.doesNotMatch(studio, /empty-claim-window-after/);
  assert.doesNotMatch(studio, /claim-window-after/);
  assert.doesNotMatch(body, /featured guest/i);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /Empty open: claim-note names rolling last-7-days beside Claim #1/);
  assert.match(
    studioCss,
    /\.studio\.studio-open-empty\[data-empty-honest\] \.claim\.empty-claim-first\[data-empty-claim-first\] \.claim-note\[data-empty-claim-window\]/,
  );
  assert.match(studioCss, /Empty open: name the fair occupied-rank window/);
  assert.match(
    studioCss,
    /\.studio\.studio-open-empty\[data-empty-honest\] \.empty\.open-seat\[data-empty-honest\] \.empty-window\[data-empty-window\]/,
  );
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-rolling-week\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \.week-window/);
  const claimWindowCss = (
    studioCss.split("Empty open: claim-note names rolling last-7-days beside Claim #1", 2)[1] ?? ""
  ).split(".studio.studio-open-empty[data-empty-honest] [data-guest-prize]")[0] ?? "";
  assert.match(claimWindowCss, /color:\s*var\(--muted\)/);
  assert.doesNotMatch(claimWindowCss, /background:/);
  assert.doesNotMatch(claimWindowCss, /var\(--lamp\)/);
  assert.doesNotMatch(claimWindowCss, /var\(--on-air\)/);
  assert.doesNotMatch(claimWindowCss, /\.week-window/);
  assert.doesNotMatch(claimWindowCss, /data-rolling-week/);
  assert.doesNotMatch(
    studioCss,
    /\.studio\.studio-open-occupied \.rundown\[data-rolling-week\] \.week-window\[data-rolling-week\]/,
  );

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_empty_claim_window&name=First%20Guest&siteUrl=https%3A%2F%2Ffirst.example%2F&oneLiner=First%20bid%20on%20a%20live%20seat.&bidUsd=5",
  });
  assert.equal(checkout.statusCode, 303);
  const location = String(checkout.headers.location ?? "");
  assert.match(location, /\/checkout\/complete\?checkoutId=/);
  assert.doesNotMatch(checkout.body, /episode_locked/);

  const complete = await app.inject({ method: "GET", url: location });
  assert.equal(complete.statusCode, 303);

  const occupiedBoard = await app.inject({ method: "GET", url: "/" });
  const occupied = studioMarkup(occupiedBoard.body);
  assert.match(occupied, /class="studio studio-open-occupied"/);
  assert.match(occupied, /Paid placements remain eligible for seven days\./);
  assert.match(occupied, /class="week-window"/);
  assert.match(occupied, /data-rolling-week=""/);
  assert.match(occupied, /data-first-click="guest"/);
  assert.match(occupied, /data-host-lock/);
  assert.match(occupied, /First Guest/);
  assert.match(occupied, /class="claim occupied-claim"/);
  assert.match(occupied, /data-occupied-window/);
  assert.match(occupied, /Paid placements remain eligible for seven days/);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /data-empty-claim-window/);
  assert.doesNotMatch(occupied, /data-empty-window/);
  assert.doesNotMatch(occupied, /class="empty-window"/);

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=ep_empty_claim_window&session=${encodeURIComponent(DEV_HOST_SESSION_SECRET)}`,
  });
  assert.equal(locked.statusCode, 303);
  const afterLock = await app.inject({ method: "GET", url: "/" });
  const lockedStudio = studioMarkup(afterLock.body);
  assert.match(lockedStudio, /Episode 1 is locked/);
  assert.match(lockedStudio, /data-checkout-state="locked"/);
  assert.match(lockedStudio, /First Guest/);
  assert.doesNotMatch(lockedStudio, /data-empty-claim-window/);
  assert.doesNotMatch(lockedStudio, /data-empty-window/);
  assert.doesNotMatch(lockedStudio, /data-occupied-window/);
  assert.doesNotMatch(lockedStudio, /Paid placements remain eligible for seven days/);
  assert.doesNotMatch(lockedStudio, /data-rolling-week/);
  const lockedCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_empty_claim_window&name=Too%20Late&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Locked.&bidUsd=13",
  });
  assert.equal(lockedCheckout.statusCode, 409);
  assert.match(lockedCheckout.body, /This episode is locked/);
});

test("GET / on occupied live names rolling last-7-days on occupied-claim beside Outbid", async () => {
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const episode = {
    id: "ep_occupied_claim_window",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat" as const,
    vetoEnabled: true,
    opensAt: "2026-08-16T00:00:00.000Z",
    locksAt: null,
    lockedAt: null,
  };
  const listings: Listing[] = [
    {
      id: "lst_ada",
      episodeId: episode.id,
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 12,
      firstBidAt: "2026-08-16T12:00:00.000Z",
      paidAt: "2026-08-16T12:00:00.000Z",
      clicks: 3,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_hold",
      episodeId: episode.id,
      name: "Hold Co",
      siteUrl: "https://hold.example/",
      oneLiner: "Still listed below #1.",
      bidUsd: 8,
      firstBidAt: "2026-08-16T18:00:00.000Z",
      paidAt: "2026-08-16T18:00:00.000Z",
      clicks: 2,
      vetoedAt: null,
      vetoReason: null,
    },
  ];
  const occupiedHtml = renderBoardHtml(episode, listings, monday);
  const occupied = studioMarkup(occupiedHtml);
  const ticketAt = occupied.indexOf("data-show-ticket");
  const rundownAt = occupied.indexOf("data-rundown");
  const weekWindowAt = occupied.indexOf('class="week-window"');
  const guestClickAt = occupied.indexOf('data-first-click="guest"');
  const laterClaimClassAt = occupied.indexOf('class="claim occupied-claim"');
  const laterClaimAt = occupied.indexOf('data-claim-state="open-occupied"');
  const claimAt = occupied.indexOf('id="claim"');
  const claimTitleAt = occupied.indexOf("Claim #1 for");
  const claimNoteAt = occupied.indexOf('class="claim-note"');
  const laterClaimWindowAt = occupied.indexOf("data-occupied-window");
  const rollingCopyAt = occupied.indexOf("Paid placements remain eligible for seven days");
  const mondayAt = occupied.indexOf("does not reset at Monday midnight", laterClaimWindowAt);
  const lockCopyAt = occupied.indexOf("A host lock still closes the episode");
  const vetoCopyAt = occupied.indexOf("Host review is on", laterClaimWindowAt);
  const outbidAt = occupied.indexOf(">Outbid");
  const deskAt = occupied.indexOf("data-host-lock");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(weekWindowAt, -1);
  assert.notEqual(guestClickAt, -1);
  assert.notEqual(laterClaimClassAt, -1);
  assert.notEqual(laterClaimAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(claimTitleAt, -1);
  assert.notEqual(claimNoteAt, -1);
  assert.notEqual(laterClaimWindowAt, -1);
  assert.notEqual(rollingCopyAt, -1);
  assert.notEqual(mondayAt, -1);
  assert.notEqual(lockCopyAt, -1);
  assert.notEqual(vetoCopyAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.notEqual(deskAt, -1);
  assert.ok(ticketAt < rundownAt);
  assert.ok(rundownAt < weekWindowAt);
  assert.ok(guestClickAt < weekWindowAt);
  assert.ok(laterClaimClassAt < rundownAt);
  assert.ok(laterClaimClassAt < claimAt);
  assert.ok(claimAt < laterClaimAt);
  assert.ok(laterClaimAt < claimTitleAt);
  assert.ok(claimTitleAt < claimNoteAt);
  assert.ok(claimNoteAt < laterClaimWindowAt);
  assert.ok(laterClaimWindowAt < rollingCopyAt);
  assert.ok(rollingCopyAt < mondayAt);
  assert.ok(mondayAt < lockCopyAt);
  assert.ok(lockCopyAt < vetoCopyAt);
  assert.ok(vetoCopyAt < outbidAt);
  assert.ok(outbidAt < deskAt);
  const claimBlock = occupied.slice(laterClaimClassAt, deskAt);
  assert.match(occupied, /class="studio studio-open-occupied"/);
  assert.match(occupied, /class="claim occupied-claim"[^>]*id="claim"[^>]*data-claim-state="open-occupied"/);
  assert.match(claimBlock, /class="claim-note"/);
  assert.match(claimBlock, /data-occupied-window/);
  assert.match(claimBlock, /Rank is the bid/);
  assert.match(claimBlock, /Paid placements remain eligible for seven days/);
  assert.match(claimBlock, /does not reset at Monday midnight/);
  assert.match(claimBlock, /A host lock still closes the episode/);
  assert.match(claimBlock, /Host review is on\./);
  assert.match(claimBlock, />Outbid/);
  assert.match(occupied, /data-first-click="guest"/);
  assert.match(occupied, /data-guest-prize/);
  assert.match(occupied, /Ada Lovelace/);
  assert.match(occupied, /Paid placements remain eligible for seven days\./);
  assert.match(occupied, /class="week-window"/);
  assert.match(occupied, /data-rolling-week=""/);
  assert.match(occupied, /data-host-lock/);
  assert.equal(countExact(occupied, "data-occupied-window"), 1);
  assert.equal(countExact(occupied, "Paid placements remain eligible for seven days"), 2);
  assert.equal(countExact(occupied, 'data-first-click="guest"'), 1);
  assert.equal(countAttr(occupied, 'data-claim-state="open-occupied"'), 1);
  assert.doesNotMatch(occupied, /data-empty-claim-window/);
  assert.doesNotMatch(occupied, /data-empty-window/);
  assert.doesNotMatch(occupied, /class="empty-window"/);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /data-guest-before-claim/);
  assert.doesNotMatch(occupied, /occupied-claim-window-after/);
  assert.doesNotMatch(occupied, /occupied-claim-window-after/);
  assert.doesNotMatch(occupied, /24h lock/);
  const occupiedCss = occupiedHtml.slice(
    occupiedHtml.indexOf("<style>"),
    occupiedHtml.indexOf("</style>"),
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.claim-note\[data-occupied-window\]/,
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.week-window\[data-rolling-week\]/,
  );
  assert.match(occupiedCss, /\.studio\.studio-open-occupied \.week-window\[data-rolling-week\] \{[\s\S]*color:\s*var\(--muted\)/);

  const emptyDb = memoryDb();
  createEpisode(emptyDb, {
    id: "ep_empty_stays_shipped",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const emptyApp = await buildApp({ db: emptyDb });
  after(() => emptyApp.close());
  const emptyBoard = await emptyApp.inject({ method: "GET", url: "/" });
  const emptyStudio = studioMarkup(emptyBoard.body);
  assert.match(emptyStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(emptyStudio, /Claim #1 for/);
  assert.match(emptyStudio, /data-empty-claim-window/);
  assert.match(emptyStudio, /Paid placements remain eligible for seven days/);
  assert.match(emptyStudio, /data-identity-fields/);
  assert.doesNotMatch(emptyStudio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(emptyStudio, /data-occupied-window/);
  assert.doesNotMatch(emptyStudio, /class="claim occupied-claim"/);
  assert.doesNotMatch(emptyStudio, /studio-open-occupied/);
  const emptyCss = emptyBoard.body.slice(
    emptyBoard.body.indexOf("<style>"),
    emptyBoard.body.indexOf("</style>"),
  );
  assert.match(emptyCss, /Empty open: claim-note names rolling last-7-days beside Claim #1/);
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-occupied-window\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-occupied-window\]/);
  assert.doesNotMatch(
    emptyCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.claim-note\[data-occupied-window\]/,
  );

  const db = memoryDb();
  createEpisode(db, {
    id: "ep_live_claim_window",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-16T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: "ep_live_claim_window",
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const live = await app.inject({ method: "GET", url: "/" });
  assert.equal(live.statusCode, 200);
  const liveStudio = studioMarkup(live.body);
  const liveLaterClaimAt = liveStudio.indexOf('data-claim-state="open-occupied"');
  const liveWindowAt = liveStudio.indexOf("data-occupied-window");
  const liveRollingAt = liveStudio.indexOf("Paid placements remain eligible for seven days");
  const liveOutbidAt = liveStudio.indexOf(">Outbid");
  const liveGuestAt = liveStudio.indexOf('data-first-click="guest"');
  assert.ok(liveGuestAt > -1 && liveLaterClaimAt < liveGuestAt);
  assert.ok(liveLaterClaimAt < liveWindowAt);
  assert.ok(liveWindowAt < liveRollingAt);
  assert.ok(liveRollingAt < liveOutbidAt);
  assert.match(liveStudio, /class="studio studio-open-occupied"/);
  assert.match(liveStudio, /class="claim occupied-claim"/);
  assert.match(liveStudio, /data-occupied-window/);
  assert.match(liveStudio, /Rank is the bid/);
  assert.match(liveStudio, /Paid placements remain eligible for seven days/);
  assert.match(liveStudio, /Host review is on\./);
  assert.match(liveStudio, /Paid placements remain eligible for seven days\./);
  assert.match(liveStudio, /data-first-click="guest"/);
  assert.match(liveStudio, /data-host-lock/);
  assert.doesNotMatch(liveStudio, /data-empty-claim-window/);
  assert.match(liveStudio, /Claim #1 for/);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_live_claim_window&name=Raise%20Co&siteUrl=https%3A%2F%2Fraise.example%2F&oneLiner=Still%20live.&bidUsd=13",
  });
  assert.equal(checkout.statusCode, 303);
  assert.match(String(checkout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);
  assert.doesNotMatch(checkout.body, /episode_locked/);

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=ep_live_claim_window&session=${encodeURIComponent(DEV_HOST_SESSION_SECRET)}`,
  });
  assert.equal(locked.statusCode, 303);
  const afterLock = await app.inject({ method: "GET", url: "/" });
  const lockedStudio = studioMarkup(afterLock.body);
  assert.match(lockedStudio, /Episode 12 is locked/);
  assert.match(lockedStudio, /data-checkout-state="locked"/);
  assert.match(lockedStudio, /Ada Lovelace/);
  assert.doesNotMatch(lockedStudio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(lockedStudio, /data-occupied-window/);
  assert.doesNotMatch(lockedStudio, /class="claim occupied-claim"/);
  assert.doesNotMatch(lockedStudio, /Paid placements remain eligible for seven days/);
  const lockedCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_live_claim_window&name=Too%20Late&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Locked.&bidUsd=13",
  });
  assert.equal(lockedCheckout.statusCode, 409);
  assert.match(lockedCheckout.body, /data-checkout-state="locked"/);
  assert.match(lockedCheckout.body, /This episode is locked/);
});

test("GET / on occupied live names the raise difference on occupied-claim beside Outbid", async () => {
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const episode = {
    id: "ep_occupied_claim_raise",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat" as const,
    vetoEnabled: true,
    opensAt: "2026-08-16T00:00:00.000Z",
    locksAt: null,
    lockedAt: null,
  };
  const listings: Listing[] = [
    {
      id: "lst_ada",
      episodeId: episode.id,
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 12,
      firstBidAt: "2026-08-16T12:00:00.000Z",
      paidAt: "2026-08-16T12:00:00.000Z",
      clicks: 3,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_hold",
      episodeId: episode.id,
      name: "Hold Co",
      siteUrl: "https://hold.example/",
      oneLiner: "Still listed below #1.",
      bidUsd: 8,
      firstBidAt: "2026-08-16T18:00:00.000Z",
      paidAt: "2026-08-16T18:00:00.000Z",
      clicks: 2,
      vetoedAt: null,
      vetoReason: null,
    },
  ];
  const occupiedHtml = renderBoardHtml(episode, listings, monday);
  const occupied = studioMarkup(occupiedHtml);
  const ticketAt = occupied.indexOf("data-show-ticket");
  const rundownAt = occupied.indexOf("data-rundown");
  const weekWindowAt = occupied.indexOf('class="week-window"');
  const guestClickAt = occupied.indexOf('data-first-click="guest"');
  const laterClaimClassAt = occupied.indexOf('class="claim occupied-claim"');
  const laterClaimAt = occupied.indexOf('data-claim-state="open-occupied"');
  const claimAt = occupied.indexOf('id="claim"');
  const claimTitleAt = occupied.indexOf("Claim #1 for");
  const laterClaimWindowAt = occupied.indexOf("data-occupied-window");
  const laterClaimRaiseAt = occupied.indexOf("data-occupied-raise>");
  const rollingCopyAt = occupied.indexOf("Paid placements remain eligible for seven days");
  const raiseCopyAt = occupied.indexOf("You pay only the difference");
  const outbidAt = occupied.indexOf(">Outbid");
  const nameAt = occupied.indexOf('name="name"');
  const siteAt = occupied.indexOf('name="siteUrl"');
  const lineAt = occupied.indexOf('name="oneLiner"');
  const deskAt = occupied.indexOf("data-host-lock");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(weekWindowAt, -1);
  assert.notEqual(guestClickAt, -1);
  assert.notEqual(laterClaimClassAt, -1);
  assert.notEqual(laterClaimAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(claimTitleAt, -1);
  assert.notEqual(laterClaimWindowAt, -1);
  assert.notEqual(laterClaimRaiseAt, -1);
  assert.notEqual(rollingCopyAt, -1);
  assert.notEqual(raiseCopyAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.notEqual(nameAt, -1);
  assert.notEqual(siteAt, -1);
  assert.notEqual(lineAt, -1);
  assert.notEqual(deskAt, -1);
  assert.ok(ticketAt < rundownAt);
  assert.ok(rundownAt < weekWindowAt);
  assert.ok(guestClickAt < weekWindowAt);
  assert.ok(laterClaimClassAt < rundownAt);
  assert.ok(laterClaimClassAt < claimAt);
  assert.ok(claimAt < laterClaimAt);
  assert.ok(laterClaimAt < claimTitleAt);
  assert.ok(claimTitleAt < laterClaimWindowAt);
  assert.ok(laterClaimWindowAt < laterClaimRaiseAt);
  assert.ok(laterClaimRaiseAt < rollingCopyAt);
  assert.ok(rollingCopyAt < raiseCopyAt);
  assert.ok(raiseCopyAt < outbidAt);
  // The site is the first-row control; name and one-liner stay in the
  // expandable Guest details layer without changing the submitted fields.
  assert.ok(siteAt < nameAt);
  assert.ok(nameAt < lineAt);
  assert.ok(lineAt < deskAt);
  const claimBlock = occupied.slice(laterClaimClassAt, deskAt);
  const claimNote = occupied.slice(
    occupied.indexOf('class="claim-note"'),
    occupied.indexOf("<form"),
  );
  assert.match(occupied, /class="studio studio-open-occupied"/);
  assert.match(occupied, /class="claim occupied-claim"[^>]*id="claim"[^>]*data-claim-state="open-occupied"/);
  assert.match(claimBlock, /data-occupied-window/);
  assert.match(claimBlock, /data-occupied-raise/);
  assert.match(claimNote, /data-occupied-raise/);
  assert.match(claimNote, /You pay only the difference/);
  assert.match(claimBlock, /Paid placements remain eligible for seven days/);
  assert.match(claimBlock, />Outbid/);
  assert.match(claimBlock, /class="fields"/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(occupied, /data-first-click="guest"/);
  assert.match(occupied, /data-guest-prize/);
  assert.match(occupied, /Ada Lovelace/);
  assert.match(occupied, /Paid placements remain eligible for seven days\./);
  assert.match(occupied, /class="week-window"/);
  assert.match(occupied, /data-host-lock/);
  assert.equal(countAttr(occupied, "data-occupied-raise"), 1);
  assert.equal(countExact(claimNote, "You pay only the difference"), 1);
  assert.equal(countExact(occupied, "data-identity-fields"), 1);
  assert.equal(countExact(occupied, 'data-first-click="guest"'), 1);
  assert.equal(countAttr(occupied, 'data-claim-state="open-occupied"'), 1);
  assert.doesNotMatch(occupied, /class="obsolete-identity-wrapper"/);
  assert.doesNotMatch(occupied, /data-empty-claim-window/);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /data-guest-before-claim/);
  assert.doesNotMatch(occupied, /occupied-claim-raise-after/);
  const occupiedCss = occupiedHtml.slice(
    occupiedHtml.indexOf("<style>"),
    occupiedHtml.indexOf("</style>"),
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.claim-note\[data-occupied-raise\]/,
  );
  assert.match(occupiedCss, /\.studio\.studio-open-occupied \.week-window\[data-rolling-week\]/);
  assert.match(occupiedCss, /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.bid-field\[data-raise-amount-field\]/);
  assert.doesNotMatch(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.obsolete-identity-wrapper\[data-identity-fields\]/,
  );

  const emptyDb = memoryDb();
  createEpisode(emptyDb, {
    id: "ep_empty_claim_note_stays_shipped",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const emptyApp = await buildApp({ db: emptyDb });
  after(() => emptyApp.close());
  const emptyBoard = await emptyApp.inject({ method: "GET", url: "/" });
  const emptyStudio = studioMarkup(emptyBoard.body);
  const emptyOutbidAt = emptyStudio.indexOf(">Outbid</button>");
  const emptyClaimWindowAt = emptyStudio.indexOf("data-empty-claim-window");
  const emptyClaimNote = emptyStudio.slice(
    emptyStudio.indexOf('class="claim-note"'),
    emptyStudio.indexOf("<form"),
  );
  assert.match(emptyStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(emptyStudio, /Claim #1 for/);
  assert.match(emptyStudio, /data-empty-claim-window/);
  assert.match(emptyStudio, /Paid placements remain eligible for seven days/);
  assert.match(emptyStudio, /data-identity-fields/);
  assert.match(emptyStudio, /data-identity-fields/);
  assert.ok(emptyClaimWindowAt !== -1 && emptyClaimWindowAt < emptyOutbidAt);
  assert.doesNotMatch(emptyClaimNote, /You pay only the difference/);
  assert.doesNotMatch(emptyStudio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(emptyStudio, /data-occupied-window/);
  assert.doesNotMatch(emptyStudio, /data-occupied-raise/);
  assert.doesNotMatch(emptyStudio, /Already on this episode\?/);
  assert.doesNotMatch(emptyStudio, /class="claim occupied-claim"/);
  assert.doesNotMatch(emptyStudio, /studio-open-occupied/);
  const emptyCss = emptyBoard.body.slice(
    emptyBoard.body.indexOf("<style>"),
    emptyBoard.body.indexOf("</style>"),
  );
  assert.match(emptyCss, /Empty open: claim-note names rolling last-7-days beside Claim #1/);
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-occupied-raise\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-occupied-raise\]/);
  assert.doesNotMatch(
    emptyCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.claim-note\[data-occupied-raise\]/,
  );

  const db = memoryDb();
  createEpisode(db, {
    id: "ep_live_claim_raise",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-16T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: "ep_live_claim_raise",
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const live = await app.inject({ method: "GET", url: "/" });
  assert.equal(live.statusCode, 200);
  const liveStudio = studioMarkup(live.body);
  const liveGuestAt = liveStudio.indexOf('data-first-click="guest"');
  const liveLaterClaimAt = liveStudio.indexOf('data-claim-state="open-occupied"');
  const liveWindowAt = liveStudio.indexOf("data-occupied-window");
  const liveRaiseAt = liveStudio.indexOf("data-occupied-raise>");
  const liveRaiseCopyAt = liveStudio.indexOf("You pay only the difference");
  const liveOutbidAt = liveStudio.indexOf(">Outbid");
  const liveNameAt = liveStudio.indexOf('name="name"');
  assert.ok(liveGuestAt > -1 && liveLaterClaimAt < liveGuestAt);
  assert.ok(liveLaterClaimAt < liveWindowAt);
  assert.ok(liveWindowAt < liveRaiseAt);
  assert.ok(liveRaiseAt < liveRaiseCopyAt);
  assert.ok(liveRaiseCopyAt < liveOutbidAt);
  assert.match(liveStudio, /class="studio studio-open-occupied"/);
  assert.match(liveStudio, /class="claim occupied-claim"/);
  assert.match(liveStudio, /data-occupied-raise/);
  assert.match(liveStudio, /You pay only the difference/);
  assert.match(liveStudio, /data-identity-fields/);
  assert.match(liveStudio, /data-identity-fields/);
  assert.match(liveStudio, /data-first-click="guest"/);
  assert.match(liveStudio, /data-host-lock/);
  assert.match(liveStudio, /Claim #1 for/);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_live_claim_raise&name=Raise%20Co&siteUrl=https%3A%2F%2Fraise.example%2F&oneLiner=Still%20live.&bidUsd=13",
  });
  assert.equal(checkout.statusCode, 303);
  assert.match(String(checkout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);
  assert.doesNotMatch(checkout.body, /episode_locked/);

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=ep_live_claim_raise&session=${encodeURIComponent(DEV_HOST_SESSION_SECRET)}`,
  });
  assert.equal(locked.statusCode, 303);
  const afterLock = await app.inject({ method: "GET", url: "/" });
  const lockedStudio = studioMarkup(afterLock.body);
  assert.match(lockedStudio, /Episode 12 is locked/);
  assert.match(lockedStudio, /data-checkout-state="locked"/);
  assert.match(lockedStudio, /Ada Lovelace/);
  assert.doesNotMatch(lockedStudio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(lockedStudio, /data-occupied-raise/);
  assert.doesNotMatch(lockedStudio, /You pay only the difference/);
  assert.doesNotMatch(lockedStudio, /class="claim occupied-claim"/);
  const lockedCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_live_claim_raise&name=Too%20Late&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Locked.&bidUsd=13",
  });
  assert.equal(lockedCheckout.statusCode, 409);
  assert.match(lockedCheckout.body, /data-checkout-state="locked"/);
  assert.match(lockedCheckout.body, /This episode is locked/);
});

test("GET / on occupied live names the Waffo charge as the raise difference on occupied-claim dashed $amount", async () => {
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const episode = {
    id: "ep_occupied_claim_raise_amount",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat" as const,
    vetoEnabled: true,
    opensAt: "2026-08-16T00:00:00.000Z",
    locksAt: null,
    lockedAt: null,
  };
  const listings: Listing[] = [
    {
      id: "lst_ada",
      episodeId: episode.id,
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 12,
      firstBidAt: "2026-08-16T12:00:00.000Z",
      paidAt: "2026-08-16T12:00:00.000Z",
      clicks: 3,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_hold",
      episodeId: episode.id,
      name: "Hold Co",
      siteUrl: "https://hold.example/",
      oneLiner: "Still listed below #1.",
      bidUsd: 8,
      firstBidAt: "2026-08-16T18:00:00.000Z",
      paidAt: "2026-08-16T18:00:00.000Z",
      clicks: 2,
      vetoedAt: null,
      vetoReason: null,
    },
  ];
  const occupiedHtml = renderBoardHtml(episode, listings, monday);
  const occupied = studioMarkup(occupiedHtml);
  const ticketAt = occupied.indexOf("data-show-ticket");
  const rundownAt = occupied.indexOf("data-rundown");
  const guestClickAt = occupied.indexOf('data-first-click="guest"');
  const laterClaimClassAt = occupied.indexOf('class="claim occupied-claim"');
  const laterClaimAt = occupied.indexOf('data-claim-state="open-occupied"');
  const claimAt = occupied.indexOf('id="claim"');
  const claimTitleAt = occupied.indexOf("Claim #1 for");
  const bidFieldAt = occupied.indexOf('class="bid-field"');
  const raiseAmountAt = occupied.indexOf("data-raise-amount-field");
  const bidAmountAt = occupied.indexOf('class="bid-amount"');
  const providerChargeAt = occupied.indexOf("New listing: $");
  const raiseAmountUsdAt = occupied.indexOf("data-raise-amount-usd");
  const laterClaimWindowAt = occupied.indexOf("data-occupied-window");
  const laterClaimRaiseAt = occupied.indexOf("data-occupied-raise>");
  const raiseCopyAt = occupied.indexOf("You pay only the difference");
  const outbidAt = occupied.indexOf(">Outbid");
  const deskAt = occupied.indexOf("data-host-lock");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(guestClickAt, -1);
  assert.notEqual(laterClaimClassAt, -1);
  assert.notEqual(laterClaimAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(claimTitleAt, -1);
  assert.notEqual(bidFieldAt, -1);
  assert.notEqual(raiseAmountAt, -1);
  assert.notEqual(bidAmountAt, -1);
  assert.notEqual(providerChargeAt, -1);
  assert.notEqual(raiseAmountUsdAt, -1);
  assert.notEqual(laterClaimWindowAt, -1);
  assert.notEqual(laterClaimRaiseAt, -1);
  assert.notEqual(raiseCopyAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.notEqual(deskAt, -1);
  assert.ok(ticketAt < rundownAt);
  assert.ok(rundownAt < guestClickAt);
  assert.ok(laterClaimClassAt < rundownAt);
  assert.ok(laterClaimClassAt < claimAt);
  assert.ok(claimAt < laterClaimAt);
  assert.ok(laterClaimAt < claimTitleAt);
  assert.ok(claimTitleAt < bidFieldAt);
  assert.ok(bidFieldAt < raiseAmountAt);
  assert.ok(raiseAmountAt < bidAmountAt);
  assert.ok(bidAmountAt < providerChargeAt);
  assert.ok(providerChargeAt < raiseAmountUsdAt);
  assert.ok(raiseAmountUsdAt < laterClaimWindowAt);
  assert.ok(laterClaimWindowAt < laterClaimRaiseAt);
  assert.ok(laterClaimRaiseAt < raiseCopyAt);
  assert.ok(raiseCopyAt < outbidAt);
  const claimBlock = occupied.slice(laterClaimClassAt, deskAt);
  const bidField = occupied.slice(bidFieldAt, laterClaimWindowAt);
  assert.match(occupied, /class="studio studio-open-occupied"/);
  assert.match(occupied, /class="claim occupied-claim"[^>]*id="claim"[^>]*data-claim-state="open-occupied"/);
  assert.match(bidField, /data-raise-amount-field/);
  assert.match(bidField, /class="bid-amount"/);
  assert.match(
    bidField,
    /New listing: \$<span data-new-bid-usd>13<\/span>\. Raise: \$<span data-raise-amount-usd>1<\/span>/,
  );
  assert.match(bidField, /name="bidUsd"[^>]*value="13"/);
  assert.match(bidField, /data-current-usd="12"/);
  assert.match(claimBlock, /data-occupied-raise>/);
  assert.match(claimBlock, /You pay only the difference/);
  assert.match(claimBlock, />Outbid/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(occupied, /data-first-click="guest"/);
  assert.match(occupied, /Ada Lovelace/);
  assert.equal(countExact(occupied, "data-raise-amount-field"), 1);
  assert.equal(countExact(occupied, "data-new-bid-usd"), 1);
  assert.equal(countExact(occupied, "data-raise-amount-usd"), 1);
  assert.equal(countExact(occupied, "New listing: $"), 1);
  assert.equal(countAttr(occupied, 'data-claim-state="open-occupied"'), 1);
  assert.equal(countExact(occupied, 'data-first-click="guest"'), 1);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /occupied-claim-raise-amount-after/);
  assert.doesNotMatch(occupied, /occupied-raise-amount-after/);
  assert.doesNotMatch(occupied, /raise-amount-after-outbid/);
  const occupiedCss = occupiedHtml.slice(
    occupiedHtml.indexOf("<style>"),
    occupiedHtml.indexOf("</style>"),
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.bid-field\[data-raise-amount-field\]/,
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.bid-field\[data-raise-amount-field\] \.raise-amount\s*\{/,
  );
  assert.match(occupiedCss, /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.bid-field\[data-raise-amount-field\] \.bid-amount\s*\{[\s\S]*text-decoration:\s*none/);
  assert.match(occupiedCss, /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.bid-field\[data-raise-amount-field\] \.raise-amount\s*\{[\s\S]*color:\s*var\(--muted-foreground\)/);

  const emptyDb = memoryDb();
  createEpisode(emptyDb, {
    id: "ep_empty_claim_amount_stays_shipped",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const emptyApp = await buildApp({ db: emptyDb });
  after(() => emptyApp.close());
  const emptyBoard = await emptyApp.inject({ method: "GET", url: "/" });
  const emptyStudio = studioMarkup(emptyBoard.body);
  const emptyOutbidAt = emptyStudio.indexOf(">Outbid</button>");
  assert.match(emptyStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(emptyStudio, /Claim #1 for/);
  assert.match(emptyStudio, /value="5"/);
  assert.match(emptyStudio, /data-identity-fields/);
  assert.doesNotMatch(emptyStudio, /Waffo charges \$/);
  assert.doesNotMatch(emptyStudio, /data-raise-amount-field/);
  assert.doesNotMatch(emptyStudio, /data-new-bid-usd/);
  assert.doesNotMatch(emptyStudio, /data-raise-amount-usd/);
  assert.doesNotMatch(emptyStudio, /data-current-usd/);
  assert.doesNotMatch(emptyStudio, /class="bid-amount"/);
  assert.doesNotMatch(emptyStudio, /class="raise-amount"/);
  assert.doesNotMatch(emptyStudio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(emptyStudio, /class="claim occupied-claim"/);
  assert.doesNotMatch(emptyStudio, /studio-open-occupied/);
  const emptyCss = emptyBoard.body.slice(
    emptyBoard.body.indexOf("<style>"),
    emptyBoard.body.indexOf("</style>"),
  );
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-raise-amount-field\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-raise-amount-field\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-raise-amount\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-raise-amount\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-new-bid-usd\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-new-bid-usd\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \.raise-amount/);
  assert.doesNotMatch(
    emptyCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.bid-field\[data-raise-amount-field\]/,
  );

  const db = memoryDb();
  createEpisode(db, {
    id: "ep_live_claim_raise_amount",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-16T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: "ep_live_claim_raise_amount",
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const live = await app.inject({ method: "GET", url: "/" });
  assert.equal(live.statusCode, 200);
  const liveStudio = studioMarkup(live.body);
  const liveGuestAt = liveStudio.indexOf('data-first-click="guest"');
  const liveLaterClaimAt = liveStudio.indexOf('data-claim-state="open-occupied"');
  const liveRaiseAmountAt = liveStudio.indexOf("data-raise-amount-field");
  const liveWaffoChargeAt = liveStudio.indexOf("New listing: $");
  const liveOutbidAt = liveStudio.indexOf(">Outbid");
  assert.ok(liveGuestAt > -1 && liveLaterClaimAt < liveGuestAt);
  assert.ok(liveLaterClaimAt < liveRaiseAmountAt);
  assert.ok(liveRaiseAmountAt < liveWaffoChargeAt);
  assert.ok(liveWaffoChargeAt < liveOutbidAt);
  assert.match(liveStudio, /class="studio studio-open-occupied"/);
  assert.match(liveStudio, /class="claim occupied-claim"/);
  assert.match(liveStudio, /data-raise-amount-field/);
  assert.match(
    liveStudio,
    /New listing: \$<span data-new-bid-usd>13<\/span>\. Raise: \$<span data-raise-amount-usd>1<\/span>/,
  );
  assert.match(liveStudio, /name="bidUsd"[^>]*value="13"/);
  assert.match(liveStudio, /data-identity-fields/);
  assert.match(liveStudio, /data-first-click="guest"/);
  assert.match(liveStudio, /data-host-lock/);
  assert.match(liveStudio, /Claim #1 for/);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_live_claim_raise_amount&name=Raise%20Co&siteUrl=https%3A%2F%2Fraise.example%2F&oneLiner=Still%20live.&bidUsd=13",
  });
  assert.equal(checkout.statusCode, 303);
  assert.match(String(checkout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);
  assert.doesNotMatch(checkout.body, /episode_locked/);

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=ep_live_claim_raise_amount&session=${encodeURIComponent(DEV_HOST_SESSION_SECRET)}`,
  });
  assert.equal(locked.statusCode, 303);
  const afterLock = await app.inject({ method: "GET", url: "/" });
  const lockedStudio = studioMarkup(afterLock.body);
  assert.match(lockedStudio, /Episode 12 is locked/);
  assert.match(lockedStudio, /data-checkout-state="locked"/);
  assert.match(lockedStudio, /Ada Lovelace/);
  assert.doesNotMatch(lockedStudio, /data-raise-amount-field/);
  assert.doesNotMatch(lockedStudio, /Waffo charges \$/);
  assert.doesNotMatch(lockedStudio, /data-new-bid-usd/);
  assert.doesNotMatch(lockedStudio, /data-raise-amount-usd/);
  assert.doesNotMatch(lockedStudio, /class="bid-amount"/);
  assert.doesNotMatch(lockedStudio, /class="claim occupied-claim"/);
  const lockedCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_live_claim_raise_amount&name=Too%20Late&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Locked.&bidUsd=13",
  });
  assert.equal(lockedCheckout.statusCode, 409);
  assert.match(lockedCheckout.body, /data-checkout-state="locked"/);
  assert.match(lockedCheckout.body, /This episode is locked/);
});

test("GET / on occupied live names Waffo's full new bid for a new guest — raise stays the difference", async () => {
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const episode = {
    id: "ep_occupied_claim_new_bid",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat" as const,
    vetoEnabled: true,
    opensAt: "2026-08-16T00:00:00.000Z",
    locksAt: null,
    lockedAt: null,
  };
  const listings: Listing[] = [
    {
      id: "lst_ada",
      episodeId: episode.id,
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 12,
      firstBidAt: "2026-08-16T12:00:00.000Z",
      paidAt: "2026-08-16T12:00:00.000Z",
      clicks: 3,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_hold",
      episodeId: episode.id,
      name: "Hold Co",
      siteUrl: "https://hold.example/",
      oneLiner: "Still listed below #1.",
      bidUsd: 8,
      firstBidAt: "2026-08-16T18:00:00.000Z",
      paidAt: "2026-08-16T18:00:00.000Z",
      clicks: 2,
      vetoedAt: null,
      vetoReason: null,
    },
  ];
  const occupiedHtml = renderBoardHtml(episode, listings, monday);
  const occupied = studioMarkup(occupiedHtml);
  const ticketAt = occupied.indexOf("data-show-ticket");
  const rundownAt = occupied.indexOf("data-rundown");
  const guestClickAt = occupied.indexOf('data-first-click="guest"');
  const laterClaimClassAt = occupied.indexOf('class="claim occupied-claim"');
  const laterClaimAt = occupied.indexOf('data-claim-state="open-occupied"');
  const claimAt = occupied.indexOf('id="claim"');
  const claimTitleAt = occupied.indexOf("Claim #1 for");
  const bidFieldAt = occupied.indexOf('class="bid-field"');
  const raiseAmountAt = occupied.indexOf("data-raise-amount-field");
  const providerChargeAt = occupied.indexOf("New listing: $");
  const newBidUsdAt = occupied.indexOf("data-new-bid-usd");
  const raiseAmountUsdAt = occupied.indexOf("data-raise-amount-usd");
  const laterClaimWindowAt = occupied.indexOf("data-occupied-window");
  const laterClaimRaiseAt = occupied.indexOf("data-occupied-raise>");
  const newGuestCopyAt = occupied.indexOf(
    "A new guest pays the full bid",
    laterClaimRaiseAt,
  );
  const raiseCopyAt = occupied.indexOf("You pay only the difference");
  const outbidAt = occupied.indexOf(">Outbid");
  const deskAt = occupied.indexOf("data-host-lock");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(guestClickAt, -1);
  assert.notEqual(laterClaimClassAt, -1);
  assert.notEqual(laterClaimAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(claimTitleAt, -1);
  assert.notEqual(bidFieldAt, -1);
  assert.notEqual(raiseAmountAt, -1);
  assert.notEqual(providerChargeAt, -1);
  assert.notEqual(newBidUsdAt, -1);
  assert.notEqual(raiseAmountUsdAt, -1);
  assert.notEqual(laterClaimWindowAt, -1);
  assert.notEqual(laterClaimRaiseAt, -1);
  assert.notEqual(newGuestCopyAt, -1);
  assert.notEqual(raiseCopyAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.notEqual(deskAt, -1);
  assert.ok(ticketAt < rundownAt);
  assert.ok(rundownAt < guestClickAt);
  assert.ok(laterClaimClassAt < rundownAt);
  assert.ok(laterClaimClassAt < claimAt);
  assert.ok(claimAt < laterClaimAt);
  assert.ok(laterClaimAt < claimTitleAt);
  assert.ok(claimTitleAt < bidFieldAt);
  assert.ok(bidFieldAt < raiseAmountAt);
  assert.ok(raiseAmountAt < providerChargeAt);
  assert.ok(providerChargeAt < newBidUsdAt);
  assert.ok(newBidUsdAt < raiseAmountUsdAt);
  assert.ok(raiseAmountUsdAt < laterClaimWindowAt);
  assert.ok(laterClaimWindowAt < laterClaimRaiseAt);
  assert.ok(laterClaimRaiseAt < newGuestCopyAt);
  assert.ok(newGuestCopyAt < raiseCopyAt);
  assert.ok(raiseCopyAt < outbidAt);
  const claimBlock = occupied.slice(laterClaimClassAt, deskAt);
  const bidField = occupied.slice(bidFieldAt, laterClaimWindowAt);
  const claimNote = occupied.slice(
    occupied.indexOf('class="claim-note"'),
    occupied.indexOf("<form"),
  );
  assert.match(occupied, /class="studio studio-open-occupied"/);
  assert.match(occupied, /class="claim occupied-claim"[^>]*id="claim"[^>]*data-claim-state="open-occupied"/);
  assert.match(
    bidField,
    /New listing: \$<span data-new-bid-usd>13<\/span>\. Raise: \$<span data-raise-amount-usd>1<\/span>/,
  );
  assert.match(bidField, /name="bidUsd"[^>]*value="13"/);
  assert.match(bidField, /data-current-usd="12"/);
  assert.match(claimNote, /A new guest pays the full bid/);
  assert.match(claimNote, /Same site raises/);
  assert.match(claimNote, /You pay only the difference/);
  assert.match(claimBlock, />Outbid/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(occupied, /data-first-click="guest"/);
  assert.match(occupied, /Ada Lovelace/);
  assert.match(occupied, /data-host-lock/);
  assert.equal(countExact(occupied, "data-new-bid-usd"), 1);
  assert.equal(countExact(occupied, "data-raise-amount-usd"), 1);
  assert.equal(countExact(occupied, "New listing: $"), 1);
  assert.equal(countExact(claimNote, "A new guest pays the full bid"), 1);
  assert.equal(countExact(claimNote, "You pay only the difference"), 1);
  assert.equal(countExact(occupied, 'data-first-click="guest"'), 1);
  assert.doesNotMatch(bidField, /Waffo charges \$<span data-raise-amount-usd>1<\/span>/);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /occupied-claim-new-bid-after/);
  assert.doesNotMatch(occupied, /new-bid-after-outbid/);
  assert.doesNotMatch(occupied, /occupied-claim-full-bid-after/);
  const occupiedCss = occupiedHtml.slice(
    occupiedHtml.indexOf("<style>"),
    occupiedHtml.indexOf("</style>"),
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.bid-field\[data-raise-amount-field\] \[data-new-bid-usd\]/,
  );
  assert.match(occupiedCss, /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.bid-field\[data-raise-amount-field\] \.bid-amount/);
  assert.match(occupiedCss, /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.bid-field\[data-raise-amount-field\] \.raise-amount/);

  const emptyDb = memoryDb();
  createEpisode(emptyDb, {
    id: "ep_empty_claim_new_bid_stays_shipped",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const emptyApp = await buildApp({ db: emptyDb });
  after(() => emptyApp.close());
  const emptyBoard = await emptyApp.inject({ method: "GET", url: "/" });
  const emptyStudio = studioMarkup(emptyBoard.body);
  const emptyOutbidAt = emptyStudio.indexOf(">Outbid</button>");
  const emptyClaimNote = emptyStudio.slice(
    emptyStudio.indexOf('class="claim-note"'),
    emptyStudio.indexOf("<form"),
  );
  assert.match(emptyStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(emptyStudio, /Claim #1 for/);
  assert.match(emptyStudio, /data-identity-fields/);
  assert.doesNotMatch(emptyClaimNote, /A new guest pays the full bid/);
  assert.doesNotMatch(emptyClaimNote, /You pay only the difference/);
  assert.doesNotMatch(emptyStudio, /Waffo charges \$/);
  assert.doesNotMatch(emptyStudio, /data-new-bid-usd/);
  assert.doesNotMatch(emptyStudio, /data-raise-amount-usd/);
  assert.doesNotMatch(emptyStudio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(emptyStudio, /class="claim occupied-claim"/);
  assert.doesNotMatch(emptyStudio, /studio-open-occupied/);
  const emptyCss = emptyBoard.body.slice(
    emptyBoard.body.indexOf("<style>"),
    emptyBoard.body.indexOf("</style>"),
  );
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-new-bid-usd\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-new-bid-usd\]/);
  assert.doesNotMatch(
    emptyCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.bid-field\[data-raise-amount-field\] \.raise-amount\[data-raise-amount\] \[data-new-bid-usd\]/,
  );

  const db = memoryDb();
  createEpisode(db, {
    id: "ep_live_claim_new_bid",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-16T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: "ep_live_claim_new_bid",
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const live = await app.inject({ method: "GET", url: "/" });
  assert.equal(live.statusCode, 200);
  const liveStudio = studioMarkup(live.body);
  const liveGuestAt = liveStudio.indexOf('data-first-click="guest"');
  const liveLaterClaimAt = liveStudio.indexOf('data-claim-state="open-occupied"');
  const liveNewBidAt = liveStudio.indexOf("data-new-bid-usd");
  const liveRaiseAmountUsdAt = liveStudio.indexOf("data-raise-amount-usd");
  const liveNewGuestCopyAt = liveStudio.indexOf(
    "A new guest pays the full bid",
    liveRaiseAmountUsdAt,
  );
  const liveRaiseCopyAt = liveStudio.indexOf("You pay only the difference");
  const liveOutbidAt = liveStudio.indexOf(">Outbid");
  assert.ok(liveGuestAt > -1 && liveLaterClaimAt < liveGuestAt);
  assert.ok(liveLaterClaimAt < liveNewBidAt);
  assert.ok(liveNewBidAt < liveRaiseAmountUsdAt);
  assert.ok(liveRaiseAmountUsdAt < liveNewGuestCopyAt);
  assert.ok(liveNewGuestCopyAt < liveRaiseCopyAt);
  assert.ok(liveRaiseCopyAt < liveOutbidAt);
  assert.match(liveStudio, /class="studio studio-open-occupied"/);
  assert.match(liveStudio, /class="claim occupied-claim"/);
  assert.match(
    liveStudio,
    /New listing: \$<span data-new-bid-usd>13<\/span>\. Raise: \$<span data-raise-amount-usd>1<\/span>/,
  );
  assert.match(liveStudio, /A new guest pays the full bid/);
  assert.match(liveStudio, /Same site raises/);
  assert.match(liveStudio, /You pay only the difference/);
  assert.match(liveStudio, /data-identity-fields/);
  assert.match(liveStudio, /data-first-click="guest"/);
  assert.match(liveStudio, /data-host-lock/);
  assert.doesNotMatch(liveStudio, /Waffo charges \$<span data-raise-amount-usd>1<\/span>/);
  assert.match(liveStudio, /Claim #1 for/);

  const newGuestCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: "ep_live_claim_new_bid",
      name: "Raise Co",
      siteUrl: "https://raise.example/",
      oneLiner: "Still live.",
      bidUsd: 13,
    },
  });
  assert.equal(newGuestCheckout.statusCode, 200);
  const newGuestBody = newGuestCheckout.json() as {
    kind: string;
    chargeUsd: number;
  };
  assert.equal(newGuestBody.kind, "open");
  assert.equal(newGuestBody.chargeUsd, 13);

  const raiseCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: "ep_live_claim_new_bid",
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 13,
    },
  });
  assert.equal(raiseCheckout.statusCode, 200);
  const raiseBody = raiseCheckout.json() as { kind: string; chargeUsd: number };
  assert.equal(raiseBody.kind, "raise");
  assert.equal(raiseBody.chargeUsd, 1);

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=ep_live_claim_new_bid&session=${encodeURIComponent(DEV_HOST_SESSION_SECRET)}`,
  });
  assert.equal(locked.statusCode, 303);
  const afterLock = await app.inject({ method: "GET", url: "/" });
  const lockedStudio = studioMarkup(afterLock.body);
  assert.match(lockedStudio, /Episode 12 is locked/);
  assert.match(lockedStudio, /data-checkout-state="locked"/);
  assert.match(lockedStudio, /Ada Lovelace/);
  assert.doesNotMatch(lockedStudio, /A new guest pays the full bid/);
  assert.doesNotMatch(lockedStudio, /data-new-bid-usd/);
  assert.doesNotMatch(lockedStudio, /Waffo charges \$/);
  assert.doesNotMatch(lockedStudio, /class="claim occupied-claim"/);
  const lockedCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_live_claim_new_bid&name=Too%20Late&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Locked.&bidUsd=13",
  });
  assert.equal(lockedCheckout.statusCode, 409);
  assert.match(lockedCheckout.body, /data-checkout-state="locked"/);
  assert.match(lockedCheckout.body, /This episode is locked/);
});

test("GET / on occupied live Waffo charge leads with the raise difference when the guest is raising — new guest still pays the full bid", async () => {
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const episode = {
    id: "ep_occupied_claim_raise_lead",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat" as const,
    vetoEnabled: true,
    opensAt: "2026-08-16T00:00:00.000Z",
    locksAt: null,
    lockedAt: null,
  };
  const listings: Listing[] = [
    {
      id: "lst_ada",
      episodeId: episode.id,
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 12,
      firstBidAt: "2026-08-16T12:00:00.000Z",
      paidAt: "2026-08-16T12:00:00.000Z",
      clicks: 3,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_hold",
      episodeId: episode.id,
      name: "Hold Co",
      siteUrl: "https://hold.example/",
      oneLiner: "Still listed below #1.",
      bidUsd: 8,
      firstBidAt: "2026-08-16T18:00:00.000Z",
      paidAt: "2026-08-16T18:00:00.000Z",
      clicks: 2,
      vetoedAt: null,
      vetoReason: null,
    },
  ];
  const liveRefs = [
    { identity: "example.com/ada", bidUsd: 12 },
    { identity: "hold.example/", bidUsd: 8 },
  ];
  assert.deepEqual(matchLiveListing("https://example.com/ada", liveRefs), {
    identity: "example.com/ada",
    bidUsd: 12,
  });
  assert.deepEqual(matchLiveListing("https://example.com/ada/", liveRefs), {
    identity: "example.com/ada",
    bidUsd: 12,
  });
  assert.deepEqual(matchLiveListing("example.com/ada", liveRefs), {
    identity: "example.com/ada",
    bidUsd: 12,
  });
  assert.deepEqual(matchLiveListing("https://hold.example/", liveRefs), {
    identity: "hold.example/",
    bidUsd: 8,
  });
  assert.equal(matchLiveListing("https://raise.example/", liveRefs), undefined);
  assert.equal(matchLiveListing("", liveRefs), undefined);
  const adaRaise = matchLiveListing("https://example.com/ada", liveRefs);
  assert.equal(13 - (adaRaise?.bidUsd ?? 0), 1);
  const holdRaise = matchLiveListing("https://hold.example/", liveRefs);
  assert.equal(13 - (holdRaise?.bidUsd ?? 0), 5);

  const occupiedHtml = renderBoardHtml(episode, listings, monday);
  const occupied = studioMarkup(occupiedHtml);
  const ticketAt = occupied.indexOf("data-show-ticket");
  const rundownAt = occupied.indexOf("data-rundown");
  const guestClickAt = occupied.indexOf('data-first-click="guest"');
  const laterClaimClassAt = occupied.indexOf('class="claim occupied-claim"');
  const laterClaimAt = occupied.indexOf('data-claim-state="open-occupied"');
  const claimAt = occupied.indexOf('id="claim"');
  const claimTitleAt = occupied.indexOf("Claim #1 for");
  const bidFieldAt = occupied.indexOf('class="bid-field"');
  const raiseAmountAt = occupied.indexOf("data-raise-amount-field");
  const newGuestChargeAt = occupied.indexOf("data-new-guest-waffo-charge");
  const providerChargeAt = occupied.indexOf("New listing: $");
  const newBidUsdAt = occupied.indexOf("data-new-bid-usd");
  const raiseAmountUsdAt = occupied.indexOf("data-raise-amount-usd");
  const raiserChargeAt = occupied.indexOf("data-raiser-waffo-charge");
  const raiseLeadUsdAt = occupied.indexOf("data-raise-lead-usd");
  const laterClaimWindowAt = occupied.indexOf("data-occupied-window");
  const laterClaimRaiseAt = occupied.indexOf("data-occupied-raise>");
  const newGuestCopyAt = occupied.indexOf(
    "A new guest pays the full bid",
    laterClaimRaiseAt,
  );
  const raiseCopyAt = occupied.indexOf("You pay only the difference");
  const outbidAt = occupied.indexOf(">Outbid");
  const siteAt = occupied.indexOf('name="siteUrl"');
  const deskAt = occupied.indexOf("data-host-lock");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(guestClickAt, -1);
  assert.notEqual(laterClaimClassAt, -1);
  assert.notEqual(laterClaimAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(claimTitleAt, -1);
  assert.notEqual(bidFieldAt, -1);
  assert.notEqual(raiseAmountAt, -1);
  assert.notEqual(newGuestChargeAt, -1);
  assert.notEqual(providerChargeAt, -1);
  assert.notEqual(newBidUsdAt, -1);
  assert.notEqual(raiseAmountUsdAt, -1);
  assert.notEqual(raiserChargeAt, -1);
  assert.notEqual(raiseLeadUsdAt, -1);
  assert.notEqual(laterClaimWindowAt, -1);
  assert.notEqual(laterClaimRaiseAt, -1);
  assert.notEqual(newGuestCopyAt, -1);
  assert.notEqual(raiseCopyAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.notEqual(siteAt, -1);
  assert.notEqual(deskAt, -1);
  assert.ok(ticketAt < rundownAt);
  assert.ok(rundownAt < guestClickAt);
  assert.ok(laterClaimClassAt < rundownAt);
  assert.ok(laterClaimClassAt < claimAt);
  assert.ok(claimAt < laterClaimAt);
  assert.ok(laterClaimAt < claimTitleAt);
  assert.ok(claimTitleAt < bidFieldAt);
  assert.ok(bidFieldAt < raiseAmountAt);
  assert.ok(raiseAmountAt < newGuestChargeAt);
  assert.ok(newGuestChargeAt < providerChargeAt);
  assert.ok(providerChargeAt < newBidUsdAt);
  assert.ok(newBidUsdAt < raiseAmountUsdAt);
  assert.ok(raiseAmountUsdAt < raiserChargeAt);
  assert.ok(raiserChargeAt < raiseLeadUsdAt);
  assert.ok(raiseLeadUsdAt < laterClaimWindowAt);
  assert.ok(laterClaimWindowAt < laterClaimRaiseAt);
  assert.ok(laterClaimRaiseAt < newGuestCopyAt);
  assert.ok(newGuestCopyAt < raiseCopyAt);
  assert.ok(raiseCopyAt < outbidAt);
  assert.ok(siteAt < deskAt);
  const claimBlock = occupied.slice(laterClaimClassAt, deskAt);
  const bidField = occupied.slice(bidFieldAt, laterClaimWindowAt);
  const newGuestCharge = occupied.slice(newGuestChargeAt, raiserChargeAt);
  const raiserCharge = occupied.slice(raiserChargeAt, laterClaimWindowAt);
  const claimNote = occupied.slice(
    occupied.indexOf('class="claim-note"'),
    occupied.indexOf("<form"),
  );
  assert.match(occupied, /class="studio studio-open-occupied"/);
  assert.match(occupied, /class="claim occupied-claim"[^>]*id="claim"[^>]*data-claim-state="open-occupied"/);
  assert.match(bidField, /data-live-listings="/);
  assert.match(bidField, /example.com\/ada/);
  assert.match(bidField, /hold.example\//);
  assert.match(bidField, /data-waffo-lead="new"/);
  assert.match(
    newGuestCharge,
    /New listing: \$<span data-new-bid-usd>13<\/span>\. Raise: \$<span data-raise-amount-usd>1<\/span>/,
  );
  assert.doesNotMatch(newGuestCharge, /\bhidden\b/);
  assert.match(
    raiserCharge,
    /data-raiser-waffo-charge hidden>Raise charge: \$<span data-raise-lead-usd>1<\/span> — only the difference/,
  );
  assert.doesNotMatch(raiserCharge, /Waffo charges \$<span data-new-bid-usd>13<\/span>/);
  assert.doesNotMatch(raiserCharge, /you pay \$13/i);
  assert.match(bidField, /name="bidUsd"[^>]*value="13"/);
  assert.match(bidField, /data-current-usd="12"/);
  assert.match(claimNote, /A new guest pays the full bid/);
  assert.match(claimNote, /Same site raises/);
  assert.match(claimNote, /You pay only the difference/);
  assert.match(claimBlock, />Outbid/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(occupied, /data-first-click="guest"/);
  assert.match(occupied, /Ada Lovelace/);
  assert.match(occupied, /data-host-lock/);
  assert.equal(countExact(occupied, "data-new-guest-waffo-charge"), 1);
  assert.equal(countExact(occupied, "data-raiser-waffo-charge"), 1);
  assert.equal(countExact(occupied, "data-raise-lead-usd"), 1);
  assert.equal(countExact(occupied, "data-new-bid-usd"), 1);
  assert.equal(countExact(occupied, "data-raise-amount-usd"), 1);
  assert.equal(countExact(occupied, "New listing: $"), 1);
  assert.equal(countExact(claimNote, "A new guest pays the full bid"), 1);
  assert.equal(countExact(occupied, 'data-first-click="guest"'), 1);
  assert.doesNotMatch(bidField, /Waffo charges \$<span data-raise-amount-usd>1<\/span>/);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /occupied-claim-raise-lead-after/);
  assert.doesNotMatch(occupied, /raise-lead-after-outbid/);
  assert.doesNotMatch(occupied, /occupied-claim-new-bid-after/);
  const occupiedCss = occupiedHtml.slice(
    occupiedHtml.indexOf("<style>"),
    occupiedHtml.indexOf("</style>"),
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.bid-field\[data-raise-amount-field\] \[data-raiser-waffo-charge\]/,
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.bid-field\[data-raise-amount-field\] \[data-raise-lead-usd\]/,
  );
  assert.match(occupiedCss, /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.bid-field\[data-raise-amount-field\] \.raise-amount/);

  const script = occupiedHtml.slice(
    occupiedHtml.indexOf("<script>"),
    occupiedHtml.indexOf("</script>"),
  );
  assert.match(script, /data-live-listings/);
  assert.match(script, /input\[name="siteUrl"\]/);
  assert.match(script, /data-new-guest-waffo-charge/);
  assert.match(script, /data-raiser-waffo-charge/);
  assert.match(script, /data-raise-lead-usd/);
  assert.match(script, /data-waffo-lead/);
  assert.match(script, /setAttribute\("hidden"/);
  assert.match(script, /removeAttribute\("hidden"/);
  assert.match(script, /raising \? "raise" : "new"/);

  const emptyDb = memoryDb();
  createEpisode(emptyDb, {
    id: "ep_empty_claim_raise_lead_stays_shipped",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const emptyApp = await buildApp({ db: emptyDb });
  after(() => emptyApp.close());
  const emptyBoard = await emptyApp.inject({ method: "GET", url: "/" });
  const emptyStudio = studioMarkup(emptyBoard.body);
  const emptyOutbidAt = emptyStudio.indexOf(">Outbid</button>");
  const emptyClaimNote = emptyStudio.slice(
    emptyStudio.indexOf('class="claim-note"'),
    emptyStudio.indexOf("<form"),
  );
  assert.match(emptyStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(emptyStudio, /Claim #1 for/);
  assert.match(emptyStudio, /data-identity-fields/);
  assert.doesNotMatch(emptyClaimNote, /A new guest pays the full bid/);
  assert.doesNotMatch(emptyClaimNote, /You pay only the difference/);
  assert.doesNotMatch(emptyStudio, /Waffo charges \$/);
  assert.doesNotMatch(emptyStudio, /Same site: only the difference/);
  assert.doesNotMatch(emptyStudio, /data-new-guest-waffo-charge/);
  assert.doesNotMatch(emptyStudio, /data-raiser-waffo-charge/);
  assert.doesNotMatch(emptyStudio, /data-raise-lead-usd/);
  assert.doesNotMatch(emptyStudio, /data-live-listings/);
  assert.doesNotMatch(emptyStudio, /data-new-bid-usd/);
  assert.doesNotMatch(emptyStudio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(emptyStudio, /class="claim occupied-claim"/);
  assert.doesNotMatch(emptyStudio, /studio-open-occupied/);
  const emptyCss = emptyBoard.body.slice(
    emptyBoard.body.indexOf("<style>"),
    emptyBoard.body.indexOf("</style>"),
  );
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-raiser-waffo-charge\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-raiser-waffo-charge\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-raise-lead-usd\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-raise-lead-usd\]/);
  assert.doesNotMatch(
    emptyCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.bid-field\[data-raise-amount-field\] \.raise-amount\[data-raise-amount\] \[data-raiser-waffo-charge\]/,
  );

  const db = memoryDb();
  createEpisode(db, {
    id: "ep_live_claim_raise_lead",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-16T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: "ep_live_claim_raise_lead",
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const live = await app.inject({ method: "GET", url: "/" });
  assert.equal(live.statusCode, 200);
  const liveStudio = studioMarkup(live.body);
  const liveGuestAt = liveStudio.indexOf('data-first-click="guest"');
  const liveLaterClaimAt = liveStudio.indexOf('data-claim-state="open-occupied"');
  const liveNewGuestChargeAt = liveStudio.indexOf("data-new-guest-waffo-charge");
  const liveNewBidAt = liveStudio.indexOf("data-new-bid-usd");
  const liveRaiserChargeAt = liveStudio.indexOf("data-raiser-waffo-charge");
  const liveRaiseLeadAt = liveStudio.indexOf("data-raise-lead-usd");
  const liveNewGuestCopyAt = liveStudio.indexOf(
    "A new guest pays the full bid",
    liveRaiseLeadAt,
  );
  const liveOutbidAt = liveStudio.indexOf(">Outbid");
  assert.ok(liveGuestAt > -1 && liveLaterClaimAt < liveGuestAt);
  assert.ok(liveLaterClaimAt < liveNewGuestChargeAt);
  assert.ok(liveNewGuestChargeAt < liveNewBidAt);
  assert.ok(liveNewBidAt < liveRaiserChargeAt);
  assert.ok(liveRaiserChargeAt < liveRaiseLeadAt);
  assert.ok(liveRaiseLeadAt < liveNewGuestCopyAt);
  assert.ok(liveNewGuestCopyAt < liveOutbidAt);
  assert.match(liveStudio, /class="studio studio-open-occupied"/);
  assert.match(liveStudio, /class="claim occupied-claim"/);
  assert.match(
    liveStudio,
    /New listing: \$<span data-new-bid-usd>13<\/span>\. Raise: \$<span data-raise-amount-usd>1<\/span>/,
  );
  assert.match(
    liveStudio,
    /data-raiser-waffo-charge hidden>Raise charge: \$<span data-raise-lead-usd>1<\/span> — only the difference/,
  );
  assert.match(liveStudio, /A new guest pays the full bid/);
  assert.match(liveStudio, /data-live-listings="/);
  assert.match(liveStudio, /data-identity-fields/);
  assert.match(liveStudio, /data-first-click="guest"/);
  assert.match(liveStudio, /data-host-lock/);
  assert.doesNotMatch(liveStudio, /Waffo charges \$<span data-raise-amount-usd>1<\/span>/);
  assert.match(liveStudio, /Claim #1 for/);
  const liveScript = live.body.slice(live.body.indexOf("<script>"), live.body.indexOf("</script>"));
  assert.match(liveScript, /input\[name="siteUrl"\]/);
  assert.match(liveScript, /data-raiser-waffo-charge/);

  const newGuestCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: "ep_live_claim_raise_lead",
      name: "Raise Co",
      siteUrl: "https://raise.example/",
      oneLiner: "Still live.",
      bidUsd: 13,
    },
  });
  assert.equal(newGuestCheckout.statusCode, 200);
  const newGuestBody = newGuestCheckout.json() as {
    kind: string;
    chargeUsd: number;
  };
  assert.equal(newGuestBody.kind, "open");
  assert.equal(newGuestBody.chargeUsd, 13);

  const raiseCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: "ep_live_claim_raise_lead",
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 13,
    },
  });
  assert.equal(raiseCheckout.statusCode, 200);
  const raiseBody = raiseCheckout.json() as { kind: string; chargeUsd: number };
  assert.equal(raiseBody.kind, "raise");
  assert.equal(raiseBody.chargeUsd, 1);

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=ep_live_claim_raise_lead&session=${encodeURIComponent(DEV_HOST_SESSION_SECRET)}`,
  });
  assert.equal(locked.statusCode, 303);
  const afterLock = await app.inject({ method: "GET", url: "/" });
  const lockedStudio = studioMarkup(afterLock.body);
  assert.match(lockedStudio, /Episode 12 is locked/);
  assert.match(lockedStudio, /data-checkout-state="locked"/);
  assert.match(lockedStudio, /Ada Lovelace/);
  assert.doesNotMatch(lockedStudio, /A new guest pays the full bid/);
  assert.doesNotMatch(lockedStudio, /Same site: only the difference/);
  assert.doesNotMatch(lockedStudio, /data-new-guest-waffo-charge/);
  assert.doesNotMatch(lockedStudio, /data-raiser-waffo-charge/);
  assert.doesNotMatch(lockedStudio, /data-raise-lead-usd/);
  assert.doesNotMatch(lockedStudio, /data-live-listings/);
  assert.doesNotMatch(lockedStudio, /Waffo charges \$/);
  assert.doesNotMatch(lockedStudio, /class="claim occupied-claim"/);
  const lockedCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_live_claim_raise_lead&name=Too%20Late&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Locked.&bidUsd=13",
  });
  assert.equal(lockedCheckout.statusCode, 409);
  assert.match(lockedCheckout.body, /data-checkout-state="locked"/);
  assert.match(lockedCheckout.body, /This episode is locked/);
});

test("GET / on occupied live occupied-claim note names the raise difference after the same site is entered — new guest still reads the full bid", async () => {
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const episode = {
    id: "ep_occupied_claim_note_raise",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat" as const,
    vetoEnabled: true,
    opensAt: "2026-08-16T00:00:00.000Z",
    locksAt: null,
    lockedAt: null,
  };
  const listings: Listing[] = [
    {
      id: "lst_ada",
      episodeId: episode.id,
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 12,
      firstBidAt: "2026-08-16T12:00:00.000Z",
      paidAt: "2026-08-16T12:00:00.000Z",
      clicks: 3,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_hold",
      episodeId: episode.id,
      name: "Hold Co",
      siteUrl: "https://hold.example/",
      oneLiner: "Still listed below #1.",
      bidUsd: 8,
      firstBidAt: "2026-08-16T18:00:00.000Z",
      paidAt: "2026-08-16T18:00:00.000Z",
      clicks: 2,
      vetoedAt: null,
      vetoReason: null,
    },
  ];
  const liveRefs = [
    { identity: "example.com/ada", bidUsd: 12 },
    { identity: "hold.example/", bidUsd: 8 },
  ];
  assert.deepEqual(matchLiveListing("https://example.com/ada", liveRefs), {
    identity: "example.com/ada",
    bidUsd: 12,
  });
  assert.equal(matchLiveListing("https://raise.example/", liveRefs), undefined);
  const adaRaise = matchLiveListing("https://example.com/ada", liveRefs);
  assert.equal(13 - (adaRaise?.bidUsd ?? 0), 1);

  const occupiedHtml = renderBoardHtml(episode, listings, monday);
  const occupied = studioMarkup(occupiedHtml);
  const ticketAt = occupied.indexOf("data-show-ticket");
  const rundownAt = occupied.indexOf("data-rundown");
  const guestClickAt = occupied.indexOf('data-first-click="guest"');
  const laterClaimClassAt = occupied.indexOf('class="claim occupied-claim"');
  const laterClaimAt = occupied.indexOf('data-claim-state="open-occupied"');
  const claimAt = occupied.indexOf('id="claim"');
  const claimTitleAt = occupied.indexOf("Claim #1 for");
  const bidFieldAt = occupied.indexOf('class="bid-field"');
  const raiseAmountAt = occupied.indexOf("data-raise-amount-field");
  const newGuestChargeAt = occupied.indexOf("data-new-guest-waffo-charge");
  const raiserChargeAt = occupied.indexOf("data-raiser-waffo-charge");
  const laterClaimWindowAt = occupied.indexOf("data-occupied-window");
  const claimNoteLeadAt = occupied.indexOf('data-claim-note-lead="new"');
  const laterClaimRaiseAt = occupied.indexOf("data-occupied-raise>");
  const newGuestNoteAt = occupied.indexOf("data-new-guest-claim-note");
  const newGuestCopyAt = occupied.indexOf(
    "A new guest pays the full bid",
    newGuestNoteAt,
  );
  const raiseCopyAt = occupied.indexOf("You pay only the difference");
  const raiserNoteAt = occupied.indexOf("data-raiser-claim-note");
  const raiserClaimUsdAt = occupied.indexOf("data-raiser-claim-usd");
  const raiserNoteCopyAt = occupied.indexOf("the raise difference, not a full bid");
  const outbidAt = occupied.indexOf(">Outbid");
  const siteAt = occupied.indexOf('name="siteUrl"');
  const deskAt = occupied.indexOf("data-host-lock");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(guestClickAt, -1);
  assert.notEqual(laterClaimClassAt, -1);
  assert.notEqual(laterClaimAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(claimTitleAt, -1);
  assert.notEqual(bidFieldAt, -1);
  assert.notEqual(raiseAmountAt, -1);
  assert.notEqual(newGuestChargeAt, -1);
  assert.notEqual(raiserChargeAt, -1);
  assert.notEqual(laterClaimWindowAt, -1);
  assert.notEqual(claimNoteLeadAt, -1);
  assert.notEqual(laterClaimRaiseAt, -1);
  assert.notEqual(newGuestNoteAt, -1);
  assert.notEqual(newGuestCopyAt, -1);
  assert.notEqual(raiseCopyAt, -1);
  assert.notEqual(raiserNoteAt, -1);
  assert.notEqual(raiserClaimUsdAt, -1);
  assert.notEqual(raiserNoteCopyAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.notEqual(siteAt, -1);
  assert.notEqual(deskAt, -1);
  assert.ok(ticketAt < rundownAt);
  assert.ok(rundownAt < guestClickAt);
  assert.ok(laterClaimClassAt < rundownAt);
  assert.ok(laterClaimClassAt < claimAt);
  assert.ok(claimAt < laterClaimAt);
  assert.ok(laterClaimAt < claimTitleAt);
  assert.ok(claimTitleAt < bidFieldAt);
  assert.ok(bidFieldAt < raiseAmountAt);
  assert.ok(raiseAmountAt < newGuestChargeAt);
  assert.ok(newGuestChargeAt < raiserChargeAt);
  assert.ok(raiserChargeAt < laterClaimWindowAt);
  assert.ok(laterClaimWindowAt < claimNoteLeadAt);
  assert.ok(claimNoteLeadAt < laterClaimRaiseAt);
  assert.ok(laterClaimRaiseAt < newGuestNoteAt);
  assert.ok(newGuestNoteAt < newGuestCopyAt);
  assert.ok(newGuestCopyAt < raiseCopyAt);
  assert.ok(raiseCopyAt < raiserNoteAt);
  assert.ok(raiserNoteAt < raiserClaimUsdAt);
  assert.ok(raiserClaimUsdAt < raiserNoteCopyAt);
  assert.ok(raiserNoteCopyAt < outbidAt);
  assert.ok(siteAt < deskAt);
  const claimBlock = occupied.slice(laterClaimClassAt, deskAt);
  const bidField = occupied.slice(bidFieldAt, laterClaimWindowAt);
  const claimNote = occupied.slice(
    occupied.indexOf('class="claim-note"'),
    occupied.indexOf("<form"),
  );
  const newGuestNote = occupied.slice(newGuestNoteAt, raiserNoteAt);
  const raiserNote = occupied.slice(raiserNoteAt, occupied.indexOf("<form"));
  assert.match(occupied, /class="studio studio-open-occupied"/);
  assert.match(occupied, /class="claim occupied-claim"[^>]*id="claim"[^>]*data-claim-state="open-occupied"/);
  assert.match(bidField, /data-waffo-lead="new"/);
  assert.match(
    bidField,
    /New listing: \$<span data-new-bid-usd>13<\/span>\. Raise: \$<span data-raise-amount-usd>1<\/span>/,
  );
  assert.match(
    bidField,
    /data-raiser-waffo-charge hidden>Raise charge: \$<span data-raise-lead-usd>1<\/span> — only the difference/,
  );
  assert.match(claimNote, /data-claim-note-lead="new"/);
  assert.match(claimNote, /data-occupied-raise/);
  assert.match(
    newGuestNote,
    /data-new-guest-claim-note>A new guest pays the full bid\. Same site raises\. You pay only the difference/,
  );
  assert.doesNotMatch(newGuestNote, /\bhidden\b/);
  assert.match(
    raiserNote,
    /data-raiser-claim-note hidden>You pay \$<span data-raiser-claim-usd>1<\/span>\. Same site: the raise difference, not a full bid/,
  );
  assert.doesNotMatch(raiserNote, /A new guest pays the full bid/);
  assert.doesNotMatch(raiserNote, /pays the full bid/);
  assert.doesNotMatch(raiserNote, /you pay a new bid/i);
  assert.match(claimBlock, />Outbid/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(occupied, /data-first-click="guest"/);
  assert.match(occupied, /Ada Lovelace/);
  assert.match(occupied, /data-host-lock/);
  assert.equal(countExact(occupied, "data-new-guest-claim-note"), 1);
  assert.equal(countExact(occupied, "data-raiser-claim-note"), 1);
  assert.equal(countExact(occupied, "data-raiser-claim-usd"), 1);
  assert.equal(countExact(occupied, 'data-claim-note-lead="new"'), 1);
  assert.equal(countExact(claimNote, "A new guest pays the full bid"), 1);
  assert.equal(countExact(claimNote, "You pay only the difference"), 1);
  assert.equal(countExact(occupied, 'data-first-click="guest"'), 1);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /occupied-claim-note-raise-after/);
  assert.doesNotMatch(occupied, /occupied-claim-note-after/);
  assert.doesNotMatch(occupied, /claim-note-raise-after/);
  assert.doesNotMatch(occupied, /occupied-claim-note-after/);
  assert.doesNotMatch(occupied, /claim-note-lead-after/);
  assert.doesNotMatch(occupied, /occupied-claim-raise-lead-after/);
  const occupiedCss = occupiedHtml.slice(
    occupiedHtml.indexOf("<style>"),
    occupiedHtml.indexOf("</style>"),
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.claim-note\[data-occupied-raise\] \[data-new-guest-claim-note\]/,
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.claim-note\[data-occupied-raise\]/,
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \[data-raiser-claim-usd\]/,
  );
  assert.match(occupiedCss, /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.claim-note\[data-occupied-raise\]/);

  const script = occupiedHtml.slice(
    occupiedHtml.indexOf("<script>"),
    occupiedHtml.indexOf("</script>"),
  );
  assert.match(script, /data-live-listings/);
  assert.match(script, /input\[name="siteUrl"\]/);
  assert.match(script, /data-new-guest-claim-note/);
  assert.match(script, /data-raiser-claim-note/);
  assert.match(script, /data-raiser-claim-usd/);
  assert.match(script, /data-claim-note-lead/);
  assert.match(script, /data-new-guest-waffo-charge/);
  assert.match(script, /data-raiser-waffo-charge/);
  assert.match(script, /setAttribute\("hidden"/);
  assert.match(script, /removeAttribute\("hidden"/);
  assert.match(script, /raising \? "raise" : "new"/);

  const emptyDb = memoryDb();
  createEpisode(emptyDb, {
    id: "ep_empty_claim_note_raise_stays_shipped",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const emptyApp = await buildApp({ db: emptyDb });
  after(() => emptyApp.close());
  const emptyBoard = await emptyApp.inject({ method: "GET", url: "/" });
  const emptyStudio = studioMarkup(emptyBoard.body);
  const emptyOutbidAt = emptyStudio.indexOf(">Outbid</button>");
  const emptyClaimNote = emptyStudio.slice(
    emptyStudio.indexOf('class="claim-note"'),
    emptyStudio.indexOf("<form"),
  );
  assert.match(emptyStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(emptyStudio, /Claim #1 for/);
  assert.match(emptyStudio, /data-identity-fields/);
  assert.doesNotMatch(emptyClaimNote, /A new guest pays the full bid/);
  assert.doesNotMatch(emptyClaimNote, /You pay only the difference/);
  assert.doesNotMatch(emptyClaimNote, /the raise difference, not a full bid/);
  assert.doesNotMatch(emptyStudio, /data-new-guest-claim-note/);
  assert.doesNotMatch(emptyStudio, /data-raiser-claim-note/);
  assert.doesNotMatch(emptyStudio, /data-raiser-claim-usd/);
  assert.doesNotMatch(emptyStudio, /data-claim-note-lead/);
  assert.doesNotMatch(emptyStudio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(emptyStudio, /class="claim occupied-claim"/);
  assert.doesNotMatch(emptyStudio, /studio-open-occupied/);
  const emptyCss = emptyBoard.body.slice(
    emptyBoard.body.indexOf("<style>"),
    emptyBoard.body.indexOf("</style>"),
  );
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-raiser-claim-note\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-raiser-claim-note\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-new-guest-claim-note\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-new-guest-claim-note\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-claim-note-lead\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-claim-note-lead\]/);
  assert.doesNotMatch(
    emptyCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.claim-note\[data-occupied-raise\] \[data-raiser-claim-note\]/,
  );

  const db = memoryDb();
  createEpisode(db, {
    id: "ep_live_claim_note_raise",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-16T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: "ep_live_claim_note_raise",
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const live = await app.inject({ method: "GET", url: "/" });
  assert.equal(live.statusCode, 200);
  const liveStudio = studioMarkup(live.body);
  const liveGuestAt = liveStudio.indexOf('data-first-click="guest"');
  const liveLaterClaimAt = liveStudio.indexOf('data-claim-state="open-occupied"');
  const liveNewGuestChargeAt = liveStudio.indexOf("data-new-guest-waffo-charge");
  const liveRaiserChargeAt = liveStudio.indexOf("data-raiser-waffo-charge");
  const liveNewGuestNoteAt = liveStudio.indexOf("data-new-guest-claim-note");
  const liveNewGuestCopyAt = liveStudio.indexOf(
    "A new guest pays the full bid",
    liveNewGuestNoteAt,
  );
  const liveRaiserNoteAt = liveStudio.indexOf("data-raiser-claim-note");
  const liveOutbidAt = liveStudio.indexOf(">Outbid");
  assert.ok(liveGuestAt > -1 && liveLaterClaimAt < liveGuestAt);
  assert.ok(liveLaterClaimAt < liveNewGuestChargeAt);
  assert.ok(liveNewGuestChargeAt < liveRaiserChargeAt);
  assert.ok(liveRaiserChargeAt < liveNewGuestNoteAt);
  assert.ok(liveNewGuestNoteAt < liveNewGuestCopyAt);
  assert.ok(liveNewGuestCopyAt < liveRaiserNoteAt);
  assert.ok(liveRaiserNoteAt < liveOutbidAt);
  assert.match(liveStudio, /class="studio studio-open-occupied"/);
  assert.match(liveStudio, /class="claim occupied-claim"/);
  assert.match(
    liveStudio,
    /data-new-guest-claim-note>A new guest pays the full bid\. Same site raises\. You pay only the difference/,
  );
  assert.match(
    liveStudio,
    /data-raiser-claim-note hidden>You pay \$<span data-raiser-claim-usd>1<\/span>\. Same site: the raise difference, not a full bid/,
  );
  assert.match(
    liveStudio,
    /data-raiser-waffo-charge hidden>Raise charge: \$<span data-raise-lead-usd>1<\/span> — only the difference/,
  );
  assert.match(liveStudio, /data-identity-fields/);
  assert.match(liveStudio, /data-first-click="guest"/);
  assert.match(liveStudio, /data-host-lock/);
  assert.match(liveStudio, /Claim #1 for/);
  const liveScript = live.body.slice(live.body.indexOf("<script>"), live.body.indexOf("</script>"));
  assert.match(liveScript, /input\[name="siteUrl"\]/);
  assert.match(liveScript, /data-raiser-claim-note/);
  assert.match(liveScript, /data-claim-note-lead/);

  const newGuestCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: "ep_live_claim_note_raise",
      name: "Raise Co",
      siteUrl: "https://raise.example/",
      oneLiner: "Still live.",
      bidUsd: 13,
    },
  });
  assert.equal(newGuestCheckout.statusCode, 200);
  const newGuestBody = newGuestCheckout.json() as {
    kind: string;
    chargeUsd: number;
  };
  assert.equal(newGuestBody.kind, "open");
  assert.equal(newGuestBody.chargeUsd, 13);

  const raiseCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: "ep_live_claim_note_raise",
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 13,
    },
  });
  assert.equal(raiseCheckout.statusCode, 200);
  const raiseBody = raiseCheckout.json() as { kind: string; chargeUsd: number };
  assert.equal(raiseBody.kind, "raise");
  assert.equal(raiseBody.chargeUsd, 1);

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=ep_live_claim_note_raise&session=${encodeURIComponent(DEV_HOST_SESSION_SECRET)}`,
  });
  assert.equal(locked.statusCode, 303);
  const afterLock = await app.inject({ method: "GET", url: "/" });
  const lockedStudio = studioMarkup(afterLock.body);
  assert.match(lockedStudio, /Episode 12 is locked/);
  assert.match(lockedStudio, /data-checkout-state="locked"/);
  assert.match(lockedStudio, /Ada Lovelace/);
  assert.doesNotMatch(lockedStudio, /A new guest pays the full bid/);
  assert.doesNotMatch(lockedStudio, /the raise difference, not a full bid/);
  assert.doesNotMatch(lockedStudio, /data-new-guest-claim-note/);
  assert.doesNotMatch(lockedStudio, /data-raiser-claim-note/);
  assert.doesNotMatch(lockedStudio, /data-raiser-claim-usd/);
  assert.doesNotMatch(lockedStudio, /data-claim-note-lead/);
  assert.doesNotMatch(lockedStudio, /class="claim occupied-claim"/);
  const lockedCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_live_claim_note_raise&name=Too%20Late&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Locked.&bidUsd=13",
  });
  assert.equal(lockedCheckout.statusCode, 409);
  assert.match(lockedCheckout.body, /data-checkout-state="locked"/);
  assert.match(lockedCheckout.body, /This episode is locked/);
});

test("GET / on occupied live occupied-claim form-hint names the raise difference after the same site is entered — new guest still reads the full bid", async () => {
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const episode = {
    id: "ep_occupied_claim_form_hint_raise",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat" as const,
    vetoEnabled: true,
    opensAt: "2026-08-16T00:00:00.000Z",
    locksAt: null,
    lockedAt: null,
  };
  const listings: Listing[] = [
    {
      id: "lst_ada",
      episodeId: episode.id,
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 12,
      firstBidAt: "2026-08-16T12:00:00.000Z",
      paidAt: "2026-08-16T12:00:00.000Z",
      clicks: 3,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_hold",
      episodeId: episode.id,
      name: "Hold Co",
      siteUrl: "https://hold.example/",
      oneLiner: "Still listed below #1.",
      bidUsd: 8,
      firstBidAt: "2026-08-16T18:00:00.000Z",
      paidAt: "2026-08-16T18:00:00.000Z",
      clicks: 2,
      vetoedAt: null,
      vetoReason: null,
    },
  ];
  const liveRefs = [
    { identity: "example.com/ada", bidUsd: 12 },
    { identity: "hold.example/", bidUsd: 8 },
  ];
  assert.deepEqual(matchLiveListing("https://example.com/ada", liveRefs), {
    identity: "example.com/ada",
    bidUsd: 12,
  });
  assert.equal(matchLiveListing("https://raise.example/", liveRefs), undefined);
  const adaRaise = matchLiveListing("https://example.com/ada", liveRefs);
  assert.equal(13 - (adaRaise?.bidUsd ?? 0), 1);

  const occupiedHtml = renderBoardHtml(episode, listings, monday);
  const occupied = studioMarkup(occupiedHtml);
  const ticketAt = occupied.indexOf("data-show-ticket");
  const rundownAt = occupied.indexOf("data-rundown");
  const guestClickAt = occupied.indexOf('data-first-click="guest"');
  const laterClaimClassAt = occupied.indexOf('class="claim occupied-claim"');
  const laterClaimAt = occupied.indexOf('data-claim-state="open-occupied"');
  const claimAt = occupied.indexOf('id="claim"');
  const claimTitleAt = occupied.indexOf("Claim #1 for");
  const bidFieldAt = occupied.indexOf('class="bid-field"');
  const raiseAmountAt = occupied.indexOf("data-raise-amount-field");
  const newGuestChargeAt = occupied.indexOf("data-new-guest-waffo-charge");
  const raiserChargeAt = occupied.indexOf("data-raiser-waffo-charge");
  const laterClaimWindowAt = occupied.indexOf("data-occupied-window");
  const claimNoteLeadAt = occupied.indexOf('data-claim-note-lead="new"');
  const laterClaimRaiseAt = occupied.indexOf("data-occupied-raise>");
  const newGuestNoteAt = occupied.indexOf("data-new-guest-claim-note");
  const raiserNoteAt = occupied.indexOf("data-raiser-claim-note");
  const outbidAt = occupied.indexOf(">Outbid");
  const siteAt = occupied.indexOf('name="siteUrl"');
  const formHintAt = occupied.indexOf('class="form-hint"');
  const formHintMarkAt = occupied.indexOf("data-occupied-form-hint");
  const formHintLeadAt = occupied.indexOf('data-form-hint-lead="new"');
  const newGuestHintAt = occupied.indexOf("data-new-guest-form-hint");
  const newGuestHintCopyAt = occupied.indexOf("Already on this episode?");
  const raiserHintAt = occupied.indexOf("data-raiser-form-hint hidden");
  const raiserHintUsdAt = occupied.indexOf("data-raiser-form-hint-usd");
  const raiserHintCopyAt = occupied.indexOf("Already on this episode: you pay");
  const deskAt = occupied.indexOf("data-host-lock");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(guestClickAt, -1);
  assert.notEqual(laterClaimClassAt, -1);
  assert.notEqual(laterClaimAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(claimTitleAt, -1);
  assert.notEqual(bidFieldAt, -1);
  assert.notEqual(raiseAmountAt, -1);
  assert.notEqual(newGuestChargeAt, -1);
  assert.notEqual(raiserChargeAt, -1);
  assert.notEqual(laterClaimWindowAt, -1);
  assert.notEqual(claimNoteLeadAt, -1);
  assert.notEqual(laterClaimRaiseAt, -1);
  assert.notEqual(newGuestNoteAt, -1);
  assert.notEqual(raiserNoteAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.notEqual(siteAt, -1);
  assert.notEqual(formHintAt, -1);
  assert.notEqual(formHintMarkAt, -1);
  assert.notEqual(formHintLeadAt, -1);
  assert.notEqual(newGuestHintAt, -1);
  assert.notEqual(newGuestHintCopyAt, -1);
  assert.notEqual(raiserHintAt, -1);
  assert.notEqual(raiserHintUsdAt, -1);
  assert.notEqual(raiserHintCopyAt, -1);
  assert.notEqual(deskAt, -1);
  assert.ok(ticketAt < rundownAt);
  assert.ok(rundownAt < guestClickAt);
  assert.ok(laterClaimClassAt < rundownAt);
  assert.ok(laterClaimClassAt < claimAt);
  assert.ok(claimAt < laterClaimAt);
  assert.ok(laterClaimAt < claimTitleAt);
  assert.ok(claimTitleAt < bidFieldAt);
  assert.ok(bidFieldAt < raiseAmountAt);
  assert.ok(raiseAmountAt < newGuestChargeAt);
  assert.ok(newGuestChargeAt < raiserChargeAt);
  assert.ok(raiserChargeAt < laterClaimWindowAt);
  assert.ok(laterClaimWindowAt < claimNoteLeadAt);
  assert.ok(claimNoteLeadAt < laterClaimRaiseAt);
  assert.ok(laterClaimRaiseAt < newGuestNoteAt);
  assert.ok(newGuestNoteAt < raiserNoteAt);
  assert.ok(raiserNoteAt < outbidAt);
  assert.ok(siteAt < formHintAt);
  assert.ok(formHintAt < formHintMarkAt);
  assert.ok(formHintMarkAt < formHintLeadAt);
  assert.ok(formHintLeadAt < newGuestHintAt);
  assert.ok(newGuestHintAt < newGuestHintCopyAt);
  assert.ok(newGuestHintCopyAt < raiserHintAt);
  assert.ok(raiserHintAt < raiserHintCopyAt);
  assert.ok(raiserHintCopyAt < raiserHintUsdAt);
  assert.ok(raiserHintUsdAt < deskAt);
  const claimBlock = occupied.slice(laterClaimClassAt, deskAt);
  const bidField = occupied.slice(bidFieldAt, laterClaimWindowAt);
  const claimNote = occupied.slice(
    occupied.indexOf('class="claim-note"'),
    occupied.indexOf("<form"),
  );
  const formHint = occupied.slice(formHintAt, occupied.indexOf("</section>", formHintAt));
  const newGuestHint = occupied.slice(newGuestHintAt, raiserHintAt);
  const raiserHint = occupied.slice(raiserHintAt, occupied.indexOf("</p>", raiserHintAt));
  assert.match(occupied, /class="studio studio-open-occupied"/);
  assert.match(occupied, /class="claim occupied-claim"[^>]*id="claim"[^>]*data-claim-state="open-occupied"/);
  assert.match(bidField, /data-waffo-lead="new"/);
  assert.match(
    bidField,
    /New listing: \$<span data-new-bid-usd>13<\/span>\. Raise: \$<span data-raise-amount-usd>1<\/span>/,
  );
  assert.match(
    bidField,
    /data-raiser-waffo-charge hidden>Raise charge: \$<span data-raise-lead-usd>1<\/span> — only the difference/,
  );
  assert.match(claimNote, /data-claim-note-lead="new"/);
  assert.match(
    claimNote,
    /data-new-guest-claim-note>A new guest pays the full bid\. Same site raises\. You pay only the difference/,
  );
  assert.match(
    claimNote,
    /data-raiser-claim-note hidden>You pay \$<span data-raiser-claim-usd>1<\/span>\. Same site: the raise difference, not a full bid/,
  );
  assert.match(formHint, /data-occupied-form-hint/);
  assert.match(formHint, /data-form-hint-lead="new"/);
  assert.match(
    newGuestHint,
    /data-new-guest-form-hint>A new guest pays the full bid\. Already on this episode\? Enter the same site and raise\. You pay only the difference/,
  );
  assert.doesNotMatch(newGuestHint, /\bhidden\b/);
  assert.match(
    raiserHint,
    /data-raiser-form-hint hidden>Already on this episode: you pay \$<span data-raiser-form-hint-usd>1<\/span>, the raise difference/,
  );
  assert.doesNotMatch(raiserHint, /A new guest pays the full bid/);
  assert.doesNotMatch(raiserHint, /pays the full bid/);
  assert.doesNotMatch(raiserHint, /you pay a new bid/i);
  assert.doesNotMatch(raiserHint, /a new guest/i);
  assert.match(claimBlock, />Outbid/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(occupied, /data-first-click="guest"/);
  assert.match(occupied, /Ada Lovelace/);
  assert.match(occupied, /data-host-lock/);
  assert.equal(countExact(occupied, "data-new-guest-form-hint"), 1);
  assert.equal(countExact(occupied, "data-raiser-form-hint hidden"), 1);
  assert.equal(countExact(occupied, "data-raiser-form-hint-usd"), 1);
  assert.equal(countExact(occupied, 'data-form-hint-lead="new"'), 1);
  assert.equal(countExact(occupied, "data-occupied-form-hint"), 1);
  assert.equal(countExact(formHint, "A new guest pays the full bid"), 1);
  assert.equal(countExact(formHint, "Already on this episode?"), 1);
  assert.equal(countExact(formHint, "Already on this episode: you pay"), 1);
  assert.equal(countExact(claimNote, "A new guest pays the full bid"), 1);
  assert.equal(countExact(occupied, 'data-first-click="guest"'), 1);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /occupied-claim-form-hint-after/);
  assert.doesNotMatch(occupied, /form-hint-raise-after/);
  assert.doesNotMatch(occupied, /occupied-claim-hint-after/);
  assert.doesNotMatch(occupied, /form-hint-lead-after/);
  const occupiedCss = occupiedHtml.slice(
    occupiedHtml.indexOf("<style>"),
    occupiedHtml.indexOf("</style>"),
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.form-hint\[data-occupied-form-hint\] \[data-new-guest-form-hint\]/,
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.form-hint\[data-occupied-form-hint\] \[data-raiser-form-hint\]/,
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \[data-raiser-form-hint-usd\]/,
  );
  const script = occupiedHtml.slice(
    occupiedHtml.indexOf("<script>"),
    occupiedHtml.indexOf("</script>"),
  );
  assert.match(script, /data-live-listings/);
  assert.match(script, /input\[name="siteUrl"\]/);
  assert.match(script, /data-new-guest-form-hint/);
  assert.match(script, /data-raiser-form-hint/);
  assert.match(script, /data-raiser-form-hint-usd/);
  assert.match(script, /data-form-hint-lead/);
  assert.match(script, /data-new-guest-claim-note/);
  assert.match(script, /data-raiser-claim-note/);
  assert.match(script, /data-new-guest-waffo-charge/);
  assert.match(script, /data-raiser-waffo-charge/);
  assert.match(script, /setAttribute\("hidden"/);
  assert.match(script, /removeAttribute\("hidden"/);
  assert.match(script, /raising \? "raise" : "new"/);

  const emptyDb = memoryDb();
  createEpisode(emptyDb, {
    id: "ep_empty_claim_form_hint_raise_stays_shipped",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const emptyApp = await buildApp({ db: emptyDb });
  after(() => emptyApp.close());
  const emptyBoard = await emptyApp.inject({ method: "GET", url: "/" });
  const emptyStudio = studioMarkup(emptyBoard.body);
  const emptyOutbidAt = emptyStudio.indexOf(">Outbid</button>");
  const emptyFormHint = emptyStudio.slice(
    emptyStudio.indexOf('class="form-hint"'),
    emptyStudio.indexOf("</section>", emptyStudio.indexOf('class="form-hint"')),
  );
  assert.match(emptyStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(emptyStudio, /Claim #1 for/);
  assert.match(emptyStudio, /data-identity-fields/);
  assert.doesNotMatch(emptyFormHint, /A new guest pays the full bid/);
  assert.doesNotMatch(emptyFormHint, /Already on this episode\?/);
  assert.doesNotMatch(emptyFormHint, /Already on this episode: you pay/);
  assert.doesNotMatch(emptyStudio, /data-new-guest-form-hint/);
  assert.doesNotMatch(emptyStudio, /data-raiser-form-hint/);
  assert.doesNotMatch(emptyStudio, /data-raiser-form-hint-usd/);
  assert.doesNotMatch(emptyStudio, /data-form-hint-lead/);
  assert.doesNotMatch(emptyStudio, /data-occupied-form-hint/);
  assert.doesNotMatch(emptyStudio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(emptyStudio, /class="claim occupied-claim"/);
  assert.doesNotMatch(emptyStudio, /studio-open-occupied/);
  const emptyCss = emptyBoard.body.slice(
    emptyBoard.body.indexOf("<style>"),
    emptyBoard.body.indexOf("</style>"),
  );
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-new-guest-form-hint\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-new-guest-form-hint\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-raiser-form-hint\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-raiser-form-hint\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-form-hint-lead\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-form-hint-lead\]/);
  assert.doesNotMatch(
    emptyCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.form-hint\[data-occupied-form-hint\] \[data-raiser-form-hint\]/,
  );

  const db = memoryDb();
  createEpisode(db, {
    id: "ep_live_claim_form_hint_raise",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-16T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: "ep_live_claim_form_hint_raise",
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const live = await app.inject({ method: "GET", url: "/" });
  assert.equal(live.statusCode, 200);
  const liveStudio = studioMarkup(live.body);
  const liveGuestAt = liveStudio.indexOf('data-first-click="guest"');
  const liveLaterClaimAt = liveStudio.indexOf('data-claim-state="open-occupied"');
  const liveNewGuestChargeAt = liveStudio.indexOf("data-new-guest-waffo-charge");
  const liveRaiserChargeAt = liveStudio.indexOf("data-raiser-waffo-charge");
  const liveNewGuestNoteAt = liveStudio.indexOf("data-new-guest-claim-note");
  const liveRaiserNoteAt = liveStudio.indexOf("data-raiser-claim-note");
  const liveOutbidAt = liveStudio.indexOf(">Outbid");
  const liveSiteAt = liveStudio.indexOf('name="siteUrl"');
  const liveFormHintAt = liveStudio.indexOf("data-occupied-form-hint");
  const liveNewGuestHintAt = liveStudio.indexOf("data-new-guest-form-hint");
  const liveRaiserHintAt = liveStudio.indexOf("data-raiser-form-hint hidden");
  assert.ok(liveGuestAt > -1 && liveLaterClaimAt < liveGuestAt);
  assert.ok(liveLaterClaimAt < liveNewGuestChargeAt);
  assert.ok(liveNewGuestChargeAt < liveRaiserChargeAt);
  assert.ok(liveRaiserChargeAt < liveNewGuestNoteAt);
  assert.ok(liveNewGuestNoteAt < liveRaiserNoteAt);
  assert.ok(liveRaiserNoteAt < liveOutbidAt);
  assert.ok(liveSiteAt < liveFormHintAt);
  assert.ok(liveFormHintAt < liveNewGuestHintAt);
  assert.ok(liveNewGuestHintAt < liveRaiserHintAt);
  assert.match(liveStudio, /class="studio studio-open-occupied"/);
  assert.match(liveStudio, /class="claim occupied-claim"/);
  assert.match(
    liveStudio,
    /data-new-guest-form-hint>A new guest pays the full bid\. Already on this episode\? Enter the same site and raise\. You pay only the difference/,
  );
  assert.match(
    liveStudio,
    /data-raiser-form-hint hidden>Already on this episode: you pay \$<span data-raiser-form-hint-usd>1<\/span>, the raise difference/,
  );
  assert.match(
    liveStudio,
    /data-raiser-claim-note hidden>You pay \$<span data-raiser-claim-usd>1<\/span>\. Same site: the raise difference, not a full bid/,
  );
  assert.match(
    liveStudio,
    /data-raiser-waffo-charge hidden>Raise charge: \$<span data-raise-lead-usd>1<\/span> — only the difference/,
  );
  assert.match(liveStudio, /data-identity-fields/);
  assert.match(liveStudio, /data-first-click="guest"/);
  assert.match(liveStudio, /data-host-lock/);
  assert.match(liveStudio, /Claim #1 for/);
  const liveScript = live.body.slice(live.body.indexOf("<script>"), live.body.indexOf("</script>"));
  assert.match(liveScript, /input\[name="siteUrl"\]/);
  assert.match(liveScript, /data-raiser-form-hint/);
  assert.match(liveScript, /data-form-hint-lead/);
  assert.match(liveScript, /data-raiser-claim-note/);
  assert.match(liveScript, /data-claim-note-lead/);

  const newGuestCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: "ep_live_claim_form_hint_raise",
      name: "Raise Co",
      siteUrl: "https://raise.example/",
      oneLiner: "Still live.",
      bidUsd: 13,
    },
  });
  assert.equal(newGuestCheckout.statusCode, 200);
  const newGuestBody = newGuestCheckout.json() as {
    kind: string;
    chargeUsd: number;
  };
  assert.equal(newGuestBody.kind, "open");
  assert.equal(newGuestBody.chargeUsd, 13);

  const raiseCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: "ep_live_claim_form_hint_raise",
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 13,
    },
  });
  assert.equal(raiseCheckout.statusCode, 200);
  const raiseBody = raiseCheckout.json() as { kind: string; chargeUsd: number };
  assert.equal(raiseBody.kind, "raise");
  assert.equal(raiseBody.chargeUsd, 1);

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=ep_live_claim_form_hint_raise&session=${encodeURIComponent(DEV_HOST_SESSION_SECRET)}`,
  });
  assert.equal(locked.statusCode, 303);
  const afterLock = await app.inject({ method: "GET", url: "/" });
  const lockedStudio = studioMarkup(afterLock.body);
  assert.match(lockedStudio, /Episode 12 is locked/);
  assert.match(lockedStudio, /data-checkout-state="locked"/);
  assert.match(lockedStudio, /Ada Lovelace/);
  assert.doesNotMatch(lockedStudio, /A new guest pays the full bid/);
  assert.doesNotMatch(lockedStudio, /Already on this episode\?/);
  assert.doesNotMatch(lockedStudio, /Already on this episode: you pay/);
  assert.doesNotMatch(lockedStudio, /data-new-guest-form-hint/);
  assert.doesNotMatch(lockedStudio, /data-raiser-form-hint/);
  assert.doesNotMatch(lockedStudio, /data-form-hint-lead/);
  assert.doesNotMatch(lockedStudio, /data-occupied-form-hint/);
  assert.doesNotMatch(lockedStudio, /class="claim occupied-claim"/);
  const lockedCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_live_claim_form_hint_raise&name=Too%20Late&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Locked.&bidUsd=13",
  });
  assert.equal(lockedCheckout.statusCode, 409);
  assert.match(lockedCheckout.body, /data-checkout-state="locked"/);
  assert.match(lockedCheckout.body, /This episode is locked/);
});

test("GET / on occupied live occupied-claim names the matched guest after the same site is entered — raise-difference copy stays", async () => {
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const episode = {
    id: "ep_occupied_claim_raise_guest",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat" as const,
    vetoEnabled: true,
    opensAt: "2026-08-16T00:00:00.000Z",
    locksAt: null,
    lockedAt: null,
  };
  const listings: Listing[] = [
    {
      id: "lst_ada",
      episodeId: episode.id,
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 12,
      firstBidAt: "2026-08-16T12:00:00.000Z",
      paidAt: "2026-08-16T12:00:00.000Z",
      clicks: 3,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_hold",
      episodeId: episode.id,
      name: "Hold Co",
      siteUrl: "https://hold.example/",
      oneLiner: "Still listed below #1.",
      bidUsd: 8,
      firstBidAt: "2026-08-16T18:00:00.000Z",
      paidAt: "2026-08-16T18:00:00.000Z",
      clicks: 2,
      vetoedAt: null,
      vetoReason: null,
    },
  ];
  const liveRefs = [
    { identity: "example.com/ada", bidUsd: 12, name: "Ada Lovelace" },
    { identity: "hold.example/", bidUsd: 8, name: "Hold Co" },
  ];
  assert.deepEqual(matchLiveListing("https://example.com/ada", liveRefs), {
    identity: "example.com/ada",
    bidUsd: 12,
    name: "Ada Lovelace",
  });
  assert.deepEqual(matchLiveListing("https://hold.example/", liveRefs), {
    identity: "hold.example/",
    bidUsd: 8,
    name: "Hold Co",
  });
  assert.equal(matchLiveListing("https://raise.example/", liveRefs), undefined);
  const adaRaise = matchLiveListing("https://example.com/ada", liveRefs);
  assert.equal(13 - (adaRaise?.bidUsd ?? 0), 1);
  assert.equal(adaRaise?.name, "Ada Lovelace");

  const occupiedHtml = renderBoardHtml(episode, listings, monday);
  const occupied = studioMarkup(occupiedHtml);
  const ticketAt = occupied.indexOf("data-show-ticket");
  const rundownAt = occupied.indexOf("data-rundown");
  const guestClickAt = occupied.indexOf('data-first-click="guest"');
  const laterClaimClassAt = occupied.indexOf('class="claim occupied-claim"');
  const laterClaimAt = occupied.indexOf('data-claim-state="open-occupied"');
  const claimAt = occupied.indexOf('id="claim"');
  const claimTitleAt = occupied.indexOf("Claim #1 for");
  const bidFieldAt = occupied.indexOf('class="bid-field"');
  const raiseAmountAt = occupied.indexOf("data-raise-amount-field");
  const raiserChargeAt = occupied.indexOf("data-raiser-waffo-charge");
  const raiserGuestAt = occupied.indexOf("data-raiser-guest hidden>. Raising");
  const laterClaimWindowAt = occupied.indexOf("data-occupied-window");
  const laterClaimRaiseAt = occupied.indexOf("data-occupied-raise>");
  const raiserNoteAt = occupied.indexOf("data-raiser-claim-note");
  const noteGuestAt = occupied.indexOf("data-raiser-guest hidden> Raising");
  const outbidAt = occupied.indexOf(">Outbid");
  const siteAt = occupied.indexOf('name="siteUrl"');
  const formHintAt = occupied.indexOf('class="form-hint"');
  const raiserHintAt = occupied.indexOf("data-raiser-form-hint hidden");
  const hintGuestAt = occupied.lastIndexOf("data-raiser-guest hidden> Raising");
  const guestNameAt = occupied.indexOf("data-raiser-guest-name");
  const deskAt = occupied.indexOf("data-host-lock");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(guestClickAt, -1);
  assert.notEqual(laterClaimClassAt, -1);
  assert.notEqual(laterClaimAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(claimTitleAt, -1);
  assert.notEqual(bidFieldAt, -1);
  assert.notEqual(raiseAmountAt, -1);
  assert.notEqual(raiserChargeAt, -1);
  assert.notEqual(raiserGuestAt, -1);
  assert.notEqual(laterClaimWindowAt, -1);
  assert.notEqual(laterClaimRaiseAt, -1);
  assert.notEqual(raiserNoteAt, -1);
  assert.notEqual(noteGuestAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.notEqual(siteAt, -1);
  assert.notEqual(formHintAt, -1);
  assert.notEqual(raiserHintAt, -1);
  assert.notEqual(hintGuestAt, -1);
  assert.notEqual(guestNameAt, -1);
  assert.notEqual(deskAt, -1);
  assert.ok(ticketAt < rundownAt);
  assert.ok(rundownAt < guestClickAt);
  assert.ok(laterClaimClassAt < rundownAt);
  assert.ok(laterClaimClassAt < claimAt);
  assert.ok(claimAt < laterClaimAt);
  assert.ok(laterClaimAt < claimTitleAt);
  assert.ok(claimTitleAt < bidFieldAt);
  assert.ok(bidFieldAt < raiseAmountAt);
  assert.ok(raiseAmountAt < raiserChargeAt);
  assert.ok(raiserChargeAt < raiserGuestAt);
  assert.ok(raiserGuestAt < laterClaimWindowAt);
  assert.ok(laterClaimWindowAt < laterClaimRaiseAt);
  assert.ok(laterClaimRaiseAt < raiserNoteAt);
  assert.ok(raiserNoteAt < noteGuestAt);
  assert.ok(noteGuestAt < outbidAt);
  assert.ok(siteAt < formHintAt);
  assert.ok(formHintAt < raiserHintAt);
  assert.ok(raiserHintAt < hintGuestAt);
  assert.ok(hintGuestAt < deskAt);
  const claimBlock = occupied.slice(laterClaimClassAt, deskAt);
  const bidField = occupied.slice(bidFieldAt, laterClaimWindowAt);
  const claimNote = occupied.slice(
    occupied.indexOf('class="claim-note"'),
    occupied.indexOf("<form"),
  );
  const formHint = occupied.slice(formHintAt, occupied.indexOf("</section>", formHintAt));
  assert.match(occupied, /class="studio studio-open-occupied"/);
  assert.match(occupied, /class="claim occupied-claim"[^>]*id="claim"[^>]*data-claim-state="open-occupied"/);
  assert.match(
    bidField,
    /data-raiser-waffo-charge hidden>Raise charge: \$<span data-raise-lead-usd>1<\/span> — only the difference/,
  );
  assert.match(
    bidField,
    /data-raiser-guest hidden>\. Raising <span data-raiser-guest-name><\/span>\./,
  );
  assert.match(
    claimNote,
    /data-raiser-claim-note hidden>You pay \$<span data-raiser-claim-usd>1<\/span>\. Same site: the raise difference, not a full bid/,
  );
  assert.match(
    claimNote,
    /data-raiser-guest hidden> Raising <span data-raiser-guest-name><\/span>\./,
  );
  assert.match(
    formHint,
    /data-raiser-form-hint hidden>Already on this episode: you pay \$<span data-raiser-form-hint-usd>1<\/span>, the raise difference/,
  );
  assert.match(
    formHint,
    /data-raiser-guest hidden> Raising <span data-raiser-guest-name><\/span>\./,
  );
  assert.match(occupied, /&quot;name&quot;:&quot;Ada Lovelace&quot;/);
  assert.match(occupied, /&quot;name&quot;:&quot;Hold Co&quot;/);
  assert.match(claimBlock, />Outbid/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(occupied, /data-first-click="guest"/);
  assert.match(occupied, /Ada Lovelace/);
  assert.match(occupied, /Hold Co/);
  assert.match(occupied, /data-host-lock/);
  assert.equal(countExact(occupied, "data-raiser-guest hidden"), 3);
  assert.equal(countExact(occupied, "data-raiser-guest-name"), 3);
  assert.equal(countExact(occupied, "Raising"), 3);
  assert.equal(countAttr(occupied, 'data-claim-state="open-occupied"'), 1);
  assert.equal(countExact(occupied, 'data-first-click="guest"'), 1);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /occupied-claim-raise-guest-after/);
  assert.doesNotMatch(occupied, /occupied-raise-guest-after/);
  assert.doesNotMatch(occupied, /raise-guest-after/);
  assert.doesNotMatch(occupied, /occupied-claim-guest-after/);
  assert.doesNotMatch(occupied, /raiser-guest-after/);
  const occupiedCss = occupiedHtml.slice(
    occupiedHtml.indexOf("<style>"),
    occupiedHtml.indexOf("</style>"),
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \[data-raiser-guest\]/,
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \[data-raiser-guest\]/,
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \[data-raiser-guest\]/,
  );
  const script = occupiedHtml.slice(
    occupiedHtml.indexOf("<script>"),
    occupiedHtml.indexOf("</script>"),
  );
  assert.match(script, /data-live-listings/);
  assert.match(script, /input\[name="siteUrl"\]/);
  assert.match(script, /data-raiser-guest/);
  assert.match(script, /data-raiser-guest-name/);
  assert.match(script, /matchedListing/);
  assert.match(script, /match\.name/);
  assert.match(script, /data-raiser-form-hint/);
  assert.match(script, /data-raiser-claim-note/);
  assert.match(script, /data-raiser-waffo-charge/);
  assert.match(script, /setAttribute\("hidden"/);
  assert.match(script, /removeAttribute\("hidden"/);

  const emptyDb = memoryDb();
  createEpisode(emptyDb, {
    id: "ep_empty_claim_raise_guest_stays_shipped",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const emptyApp = await buildApp({ db: emptyDb });
  after(() => emptyApp.close());
  const emptyBoard = await emptyApp.inject({ method: "GET", url: "/" });
  const emptyStudio = studioMarkup(emptyBoard.body);
  const emptyOutbidAt = emptyStudio.indexOf(">Outbid</button>");
  assert.match(emptyStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(emptyStudio, /Claim #1 for/);
  assert.match(emptyStudio, /data-identity-fields/);
  assert.doesNotMatch(emptyStudio, /data-raiser-guest/);
  assert.doesNotMatch(emptyStudio, /data-raiser-guest-name/);
  assert.doesNotMatch(emptyStudio, /Raising /);
  assert.doesNotMatch(emptyStudio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(emptyStudio, /class="claim occupied-claim"/);
  assert.doesNotMatch(emptyStudio, /studio-open-occupied/);
  const emptyCss = emptyBoard.body.slice(
    emptyBoard.body.indexOf("<style>"),
    emptyBoard.body.indexOf("</style>"),
  );
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-raiser-guest\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-raiser-guest\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-raiser-guest-name\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-raiser-guest-name\]/);
  assert.doesNotMatch(
    emptyCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.claim-note\[data-occupied-raise\] \[data-raiser-guest\]/,
  );

  const db = memoryDb();
  createEpisode(db, {
    id: "ep_live_claim_raise_guest",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-16T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: "ep_live_claim_raise_guest",
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  insertListing(db, {
    id: "lst_hold",
    episodeId: "ep_live_claim_raise_guest",
    name: "Hold Co",
    siteUrl: "https://hold.example/",
    oneLiner: "Still listed below #1.",
    bidUsd: 8,
    firstBidAt: "2026-08-22T02:00:00.000Z",
    paidAt: "2026-08-22T02:00:05.000Z",
    clicks: 2,
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const live = await app.inject({ method: "GET", url: "/" });
  assert.equal(live.statusCode, 200);
  const liveStudio = studioMarkup(live.body);
  const liveGuestAt = liveStudio.indexOf('data-first-click="guest"');
  const liveLaterClaimAt = liveStudio.indexOf('data-claim-state="open-occupied"');
  const liveRaiserChargeAt = liveStudio.indexOf("data-raiser-waffo-charge");
  const liveWaffoGuestAt = liveStudio.indexOf("data-raiser-guest hidden>. Raising");
  const liveRaiserNoteAt = liveStudio.indexOf("data-raiser-claim-note");
  const liveNoteGuestAt = liveStudio.indexOf("data-raiser-guest hidden> Raising");
  const liveOutbidAt = liveStudio.indexOf(">Outbid");
  const liveSiteAt = liveStudio.indexOf('name="siteUrl"');
  const liveRaiserHintAt = liveStudio.indexOf("data-raiser-form-hint hidden");
  const liveHintGuestAt = liveStudio.lastIndexOf("data-raiser-guest hidden> Raising");
  assert.ok(liveGuestAt > -1 && liveLaterClaimAt < liveGuestAt);
  assert.ok(liveLaterClaimAt < liveRaiserChargeAt);
  assert.ok(liveRaiserChargeAt < liveWaffoGuestAt);
  assert.ok(liveWaffoGuestAt < liveRaiserNoteAt);
  assert.ok(liveRaiserNoteAt < liveNoteGuestAt);
  assert.ok(liveNoteGuestAt < liveOutbidAt);
  assert.ok(liveSiteAt < liveRaiserHintAt);
  assert.ok(liveRaiserHintAt < liveHintGuestAt);
  assert.match(liveStudio, /class="studio studio-open-occupied"/);
  assert.match(liveStudio, /class="claim occupied-claim"/);
  assert.match(
    liveStudio,
    /data-raiser-waffo-charge hidden>Raise charge: \$<span data-raise-lead-usd>1<\/span> — only the difference/,
  );
  assert.match(
    liveStudio,
    /data-raiser-guest hidden>\. Raising <span data-raiser-guest-name><\/span>\./,
  );
  assert.match(
    liveStudio,
    /data-raiser-claim-note hidden>You pay \$<span data-raiser-claim-usd>1<\/span>\. Same site: the raise difference, not a full bid/,
  );
  assert.match(
    liveStudio,
    /data-raiser-form-hint hidden>Already on this episode: you pay \$<span data-raiser-form-hint-usd>1<\/span>, the raise difference/,
  );
  assert.match(liveStudio, /&quot;name&quot;:&quot;Ada Lovelace&quot;/);
  assert.match(liveStudio, /&quot;name&quot;:&quot;Hold Co&quot;/);
  assert.match(liveStudio, /data-identity-fields/);
  assert.match(liveStudio, /data-first-click="guest"/);
  assert.match(liveStudio, /data-host-lock/);
  assert.match(liveStudio, /Claim #1 for/);
  const liveScript = live.body.slice(live.body.indexOf("<script>"), live.body.indexOf("</script>"));
  assert.match(liveScript, /input\[name="siteUrl"\]/);
  assert.match(liveScript, /data-raiser-guest-name/);
  assert.match(liveScript, /match\.name/);
  assert.match(liveScript, /data-raiser-claim-note/);
  assert.match(liveScript, /data-raiser-form-hint/);

  const newGuestCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: "ep_live_claim_raise_guest",
      name: "Raise Co",
      siteUrl: "https://raise.example/",
      oneLiner: "Still live.",
      bidUsd: 13,
    },
  });
  assert.equal(newGuestCheckout.statusCode, 200);
  const newGuestBody = newGuestCheckout.json() as {
    kind: string;
    chargeUsd: number;
  };
  assert.equal(newGuestBody.kind, "open");
  assert.equal(newGuestBody.chargeUsd, 13);

  const raiseCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: "ep_live_claim_raise_guest",
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 13,
    },
  });
  assert.equal(raiseCheckout.statusCode, 200);
  const raiseBody = raiseCheckout.json() as { kind: string; chargeUsd: number };
  assert.equal(raiseBody.kind, "raise");
  assert.equal(raiseBody.chargeUsd, 1);

  const holdRaiseCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: "ep_live_claim_raise_guest",
      name: "Hold Co",
      siteUrl: "https://hold.example/",
      oneLiner: "Still listed below #1.",
      bidUsd: 13,
    },
  });
  assert.equal(holdRaiseCheckout.statusCode, 200);
  const holdRaiseBody = holdRaiseCheckout.json() as { kind: string; chargeUsd: number };
  assert.equal(holdRaiseBody.kind, "raise");
  assert.equal(holdRaiseBody.chargeUsd, 5);

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=ep_live_claim_raise_guest&session=${encodeURIComponent(DEV_HOST_SESSION_SECRET)}`,
  });
  assert.equal(locked.statusCode, 303);
  const afterLock = await app.inject({ method: "GET", url: "/" });
  const lockedStudio = studioMarkup(afterLock.body);
  assert.match(lockedStudio, /Episode 12 is locked/);
  assert.match(lockedStudio, /data-checkout-state="locked"/);
  assert.match(lockedStudio, /Ada Lovelace/);
  assert.doesNotMatch(lockedStudio, /data-raiser-guest/);
  assert.doesNotMatch(lockedStudio, /data-raiser-guest-name/);
  assert.doesNotMatch(lockedStudio, /Raising /);
  assert.doesNotMatch(lockedStudio, /class="claim occupied-claim"/);
  const lockedCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_live_claim_raise_guest&name=Too%20Late&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Locked.&bidUsd=13",
  });
  assert.equal(lockedCheckout.statusCode, 409);
  assert.match(lockedCheckout.body, /data-checkout-state="locked"/);
  assert.match(lockedCheckout.body, /This episode is locked/);
});

test("GET / on occupied live occupied-claim Outbid names the matched guest after the same site is entered", async () => {
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const episode = {
    id: "ep_occupied_claim_outbid_guest",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat" as const,
    vetoEnabled: true,
    opensAt: "2026-08-16T00:00:00.000Z",
    locksAt: null,
    lockedAt: null,
  };
  const listings: Listing[] = [
    {
      id: "lst_ada",
      episodeId: episode.id,
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 12,
      firstBidAt: "2026-08-16T12:00:00.000Z",
      paidAt: "2026-08-16T12:00:00.000Z",
      clicks: 3,
      vetoedAt: null,
      vetoReason: null,
    },
    {
      id: "lst_hold",
      episodeId: episode.id,
      name: "Hold Co",
      siteUrl: "https://hold.example/",
      oneLiner: "Still listed below #1.",
      bidUsd: 8,
      firstBidAt: "2026-08-16T18:00:00.000Z",
      paidAt: "2026-08-16T18:00:00.000Z",
      clicks: 2,
      vetoedAt: null,
      vetoReason: null,
    },
  ];
  const liveRefs = [
    { identity: "example.com/ada", bidUsd: 12, name: "Ada Lovelace" },
    { identity: "hold.example/", bidUsd: 8, name: "Hold Co" },
  ];
  assert.deepEqual(matchLiveListing("https://example.com/ada", liveRefs), {
    identity: "example.com/ada",
    bidUsd: 12,
    name: "Ada Lovelace",
  });
  assert.deepEqual(matchLiveListing("https://hold.example/", liveRefs), {
    identity: "hold.example/",
    bidUsd: 8,
    name: "Hold Co",
  });
  assert.equal(matchLiveListing("https://raise.example/", liveRefs), undefined);
  const adaRaise = matchLiveListing("https://example.com/ada", liveRefs);
  assert.equal(13 - (adaRaise?.bidUsd ?? 0), 1);
  assert.equal(adaRaise?.name, "Ada Lovelace");

  const occupiedHtml = renderBoardHtml(episode, listings, monday);
  const occupied = studioMarkup(occupiedHtml);
  const ticketAt = occupied.indexOf("data-show-ticket");
  const rundownAt = occupied.indexOf("data-rundown");
  const guestClickAt = occupied.indexOf('data-first-click="guest"');
  const laterClaimClassAt = occupied.indexOf('class="claim occupied-claim"');
  const laterClaimAt = occupied.indexOf('data-claim-state="open-occupied"');
  const claimAt = occupied.indexOf('id="claim"');
  const raiserChargeAt = occupied.indexOf("data-raiser-waffo-charge");
  const raiserGuestAt = occupied.indexOf("data-raiser-guest hidden>. Raising");
  const raiserNoteAt = occupied.indexOf("data-raiser-claim-note");
  const noteGuestAt = occupied.indexOf("data-raiser-guest hidden> Raising");
  const outbidMarkAt = occupied.indexOf("data-occupied-outbid");
  const outbidAt = occupied.indexOf(">Outbid");
  const outbidGuestAt = occupied.indexOf("data-raiser-outbid-guest hidden");
  const outbidGuestNameAt = occupied.indexOf("data-raiser-outbid-guest-name");
  const siteAt = occupied.indexOf('name="siteUrl"');
  const raiserHintAt = occupied.indexOf("data-raiser-form-hint hidden");
  const hintGuestAt = occupied.lastIndexOf("data-raiser-guest hidden> Raising");
  const deskAt = occupied.indexOf("data-host-lock");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(guestClickAt, -1);
  assert.notEqual(laterClaimClassAt, -1);
  assert.notEqual(laterClaimAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(raiserChargeAt, -1);
  assert.notEqual(raiserGuestAt, -1);
  assert.notEqual(raiserNoteAt, -1);
  assert.notEqual(noteGuestAt, -1);
  assert.notEqual(outbidMarkAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.notEqual(outbidGuestAt, -1);
  assert.notEqual(outbidGuestNameAt, -1);
  assert.notEqual(siteAt, -1);
  assert.notEqual(raiserHintAt, -1);
  assert.notEqual(hintGuestAt, -1);
  assert.notEqual(deskAt, -1);
  assert.ok(ticketAt < rundownAt);
  assert.ok(rundownAt < guestClickAt);
  assert.ok(laterClaimClassAt < rundownAt);
  assert.ok(laterClaimClassAt < claimAt);
  assert.ok(claimAt < laterClaimAt);
  assert.ok(raiserChargeAt < raiserGuestAt);
  assert.ok(raiserGuestAt < raiserNoteAt);
  assert.ok(raiserNoteAt < noteGuestAt);
  assert.ok(noteGuestAt < outbidMarkAt);
  assert.ok(outbidMarkAt < outbidAt);
  assert.ok(outbidAt < outbidGuestAt);
  assert.ok(outbidGuestAt < outbidGuestNameAt);
  assert.ok(siteAt < raiserHintAt);
  assert.ok(raiserHintAt < hintGuestAt);
  assert.ok(hintGuestAt < deskAt);
  const claimBlock = occupied.slice(laterClaimClassAt, deskAt);
  const outbidButtonEnd = occupied.indexOf("</button>", outbidMarkAt);
  const outbidButton = occupied.slice(outbidMarkAt, outbidButtonEnd + "</button>".length);
  assert.match(occupied, /class="studio studio-open-occupied"/);
  assert.match(occupied, /class="claim occupied-claim"[^>]*id="claim"[^>]*data-claim-state="open-occupied"/);
  assert.match(
    outbidButton,
    /data-occupied-outbid data-slot="claim-button" data-business-action="Outbid" aria-label="Outbid — Claim rank">Outbid<span data-raiser-outbid-guest hidden> <span data-raiser-outbid-guest-name><\/span><\/span><\/button>/,
  );
  assert.doesNotMatch(outbidButton, /Raising /);
  assert.match(
    claimBlock,
    /data-raiser-waffo-charge hidden>Raise charge: \$<span data-raise-lead-usd>1<\/span> — only the difference/,
  );
  assert.match(
    claimBlock,
    /data-raiser-guest hidden>\. Raising <span data-raiser-guest-name><\/span>\./,
  );
  assert.match(
    claimBlock,
    /data-raiser-claim-note hidden>You pay \$<span data-raiser-claim-usd>1<\/span>\. Same site: the raise difference, not a full bid/,
  );
  assert.match(
    claimBlock,
    /data-raiser-form-hint hidden>Already on this episode: you pay \$<span data-raiser-form-hint-usd>1<\/span>, the raise difference/,
  );
  assert.match(occupied, /&quot;name&quot;:&quot;Ada Lovelace&quot;/);
  assert.match(occupied, /&quot;name&quot;:&quot;Hold Co&quot;/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(claimBlock, /data-identity-fields/);
  assert.match(occupied, /data-first-click="guest"/);
  assert.match(occupied, /Ada Lovelace/);
  assert.match(occupied, /Hold Co/);
  assert.match(occupied, /data-host-lock/);
  assert.equal(countExact(occupied, "data-occupied-outbid"), 1);
  assert.equal(countExact(occupied, "data-raiser-outbid-guest hidden"), 1);
  assert.equal(countExact(occupied, "data-raiser-outbid-guest-name"), 1);
  assert.equal(countExact(occupied, "data-raiser-guest hidden"), 3);
  assert.equal(countExact(occupied, "data-raiser-guest-name"), 3);
  assert.equal(countExact(occupied, "Raising"), 3);
  assert.equal(countAttr(occupied, 'data-claim-state="open-occupied"'), 1);
  assert.equal(countExact(occupied, 'data-first-click="guest"'), 1);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /occupied-claim-outbid-after/);
  assert.doesNotMatch(occupied, /occupied-outbid-guest-after/);
  assert.doesNotMatch(occupied, /outbid-guest-after/);
  assert.doesNotMatch(occupied, /outbid-after-guest/);
  assert.doesNotMatch(occupied, /raiser-outbid-after/);
  const occupiedCss = occupiedHtml.slice(
    occupiedHtml.indexOf("<style>"),
    occupiedHtml.indexOf("</style>"),
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.outbid\[data-occupied-outbid\] \[data-raiser-outbid-guest\]/,
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.outbid\[data-occupied-outbid\] \[data-raiser-outbid-guest-name\]/,
  );
  const script = occupiedHtml.slice(
    occupiedHtml.indexOf("<script>"),
    occupiedHtml.indexOf("</script>"),
  );
  assert.match(script, /data-live-listings/);
  assert.match(script, /input\[name="siteUrl"\]/);
  assert.match(script, /data-raiser-outbid-guest/);
  assert.match(script, /data-raiser-outbid-guest-name/);
  assert.match(script, /outbidGuestName\.textContent = guestName/);
  assert.match(script, /match\.name/);
  assert.match(script, /data-raiser-guest-name/);
  assert.match(script, /data-raiser-form-hint/);
  assert.match(script, /data-raiser-claim-note/);
  assert.match(script, /data-raiser-waffo-charge/);
  assert.match(script, /setAttribute\("hidden"/);
  assert.match(script, /removeAttribute\("hidden"/);

  const emptyDb = memoryDb();
  createEpisode(emptyDb, {
    id: "ep_empty_claim_outbid_guest_stays_shipped",
    showId: "show_english",
    label: "Episode 1",
    seatKind: "guest_seat",
    opensAt: "2026-08-24T00:00:00.000Z",
  });
  const emptyApp = await buildApp({ db: emptyDb });
  after(() => emptyApp.close());
  const emptyBoard = await emptyApp.inject({ method: "GET", url: "/" });
  const emptyStudio = studioMarkup(emptyBoard.body);
  const emptyOutbidAt = emptyStudio.indexOf(">Outbid</button>");
  assert.match(emptyStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(emptyStudio, /Claim #1 for/);
  assert.match(emptyStudio, /data-identity-fields/);
  assert.match(emptyStudio, />Outbid<\/button>/);
  assert.doesNotMatch(emptyStudio, /data-occupied-outbid/);
  assert.doesNotMatch(emptyStudio, /data-raiser-outbid-guest/);
  assert.doesNotMatch(emptyStudio, /data-raiser-outbid-guest-name/);
  assert.doesNotMatch(emptyStudio, /data-raiser-guest/);
  assert.doesNotMatch(emptyStudio, /Raising /);
  assert.doesNotMatch(emptyStudio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(emptyStudio, /class="claim occupied-claim"/);
  assert.doesNotMatch(emptyStudio, /studio-open-occupied/);
  const emptyCss = emptyBoard.body.slice(
    emptyBoard.body.indexOf("<style>"),
    emptyBoard.body.indexOf("</style>"),
  );
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-occupied-outbid\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-occupied-outbid\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-raiser-outbid-guest\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-raiser-outbid-guest\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-raiser-outbid-guest-name\]/);
  assert.match(emptyCss, /\.studio\.studio-open-empty \[data-raiser-outbid-guest-name\]/);
  assert.doesNotMatch(
    emptyCss,
    /\.studio\.studio-open-occupied \.claim\[data-claim-state="open-occupied"\] \.outbid\[data-occupied-outbid\] \[data-raiser-outbid-guest\]/,
  );

  const db = memoryDb();
  createEpisode(db, {
    id: "ep_live_claim_outbid_guest",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-16T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: "ep_live_claim_outbid_guest",
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  insertListing(db, {
    id: "lst_hold",
    episodeId: "ep_live_claim_outbid_guest",
    name: "Hold Co",
    siteUrl: "https://hold.example/",
    oneLiner: "Still listed below #1.",
    bidUsd: 8,
    firstBidAt: "2026-08-22T02:00:00.000Z",
    paidAt: "2026-08-22T02:00:05.000Z",
    clicks: 2,
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const live = await app.inject({ method: "GET", url: "/" });
  assert.equal(live.statusCode, 200);
  const liveStudio = studioMarkup(live.body);
  const liveGuestAt = liveStudio.indexOf('data-first-click="guest"');
  const liveLaterClaimAt = liveStudio.indexOf('data-claim-state="open-occupied"');
  const liveOutbidMarkAt = liveStudio.indexOf("data-occupied-outbid");
  const liveOutbidAt = liveStudio.indexOf(">Outbid");
  const liveOutbidGuestAt = liveStudio.indexOf("data-raiser-outbid-guest hidden");
  const liveSiteAt = liveStudio.indexOf('name="siteUrl"');
  assert.ok(liveGuestAt > -1 && liveLaterClaimAt < liveGuestAt);
  assert.ok(liveLaterClaimAt < liveOutbidMarkAt);
  assert.ok(liveOutbidMarkAt < liveOutbidAt);
  assert.ok(liveOutbidAt < liveOutbidGuestAt);
  assert.match(liveStudio, /class="studio studio-open-occupied"/);
  assert.match(liveStudio, /class="claim occupied-claim"/);
  assert.match(
    liveStudio,
    /data-occupied-outbid data-slot="claim-button" data-business-action="Outbid" aria-label="Outbid — Claim rank">Outbid<span data-raiser-outbid-guest hidden> <span data-raiser-outbid-guest-name><\/span><\/span><\/button>/,
  );
  assert.match(
    liveStudio,
    /data-raiser-waffo-charge hidden>Raise charge: \$<span data-raise-lead-usd>1<\/span> — only the difference/,
  );
  assert.match(
    liveStudio,
    /data-raiser-guest hidden>\. Raising <span data-raiser-guest-name><\/span>\./,
  );
  assert.match(liveStudio, /&quot;name&quot;:&quot;Ada Lovelace&quot;/);
  assert.match(liveStudio, /&quot;name&quot;:&quot;Hold Co&quot;/);
  assert.match(liveStudio, /data-identity-fields/);
  assert.match(liveStudio, /data-first-click="guest"/);
  assert.match(liveStudio, /data-host-lock/);
  assert.match(liveStudio, /Claim #1 for/);
  const liveScript = live.body.slice(live.body.indexOf("<script>"), live.body.indexOf("</script>"));
  assert.match(liveScript, /input\[name="siteUrl"\]/);
  assert.match(liveScript, /data-raiser-outbid-guest-name/);
  assert.match(liveScript, /outbidGuestName\.textContent = guestName/);
  assert.match(liveScript, /match\.name/);

  const newGuestCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: "ep_live_claim_outbid_guest",
      name: "Raise Co",
      siteUrl: "https://raise.example/",
      oneLiner: "Still live.",
      bidUsd: 13,
    },
  });
  assert.equal(newGuestCheckout.statusCode, 200);
  const newGuestBody = newGuestCheckout.json() as {
    kind: string;
    chargeUsd: number;
  };
  assert.equal(newGuestBody.kind, "open");
  assert.equal(newGuestBody.chargeUsd, 13);

  const raiseCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: "ep_live_claim_outbid_guest",
      name: "Ada Lovelace",
      siteUrl: "https://example.com/ada",
      oneLiner: "Notes on the analytical engine.",
      bidUsd: 13,
    },
  });
  assert.equal(raiseCheckout.statusCode, 200);
  const raiseBody = raiseCheckout.json() as { kind: string; chargeUsd: number };
  assert.equal(raiseBody.kind, "raise");
  assert.equal(raiseBody.chargeUsd, 1);

  const holdRaiseCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: "ep_live_claim_outbid_guest",
      name: "Hold Co",
      siteUrl: "https://hold.example/",
      oneLiner: "Still listed below #1.",
      bidUsd: 13,
    },
  });
  assert.equal(holdRaiseCheckout.statusCode, 200);
  const holdRaiseBody = holdRaiseCheckout.json() as { kind: string; chargeUsd: number };
  assert.equal(holdRaiseBody.kind, "raise");
  assert.equal(holdRaiseBody.chargeUsd, 5);

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=ep_live_claim_outbid_guest&session=${encodeURIComponent(DEV_HOST_SESSION_SECRET)}`,
  });
  assert.equal(locked.statusCode, 303);
  const afterLock = await app.inject({ method: "GET", url: "/" });
  const lockedStudio = studioMarkup(afterLock.body);
  assert.match(lockedStudio, /Episode 12 is locked/);
  assert.match(lockedStudio, /data-checkout-state="locked"/);
  assert.match(lockedStudio, /Ada Lovelace/);
  assert.doesNotMatch(lockedStudio, /data-occupied-outbid/);
  assert.doesNotMatch(lockedStudio, /data-raiser-outbid-guest/);
  assert.doesNotMatch(lockedStudio, /data-raiser-outbid-guest-name/);
  assert.doesNotMatch(lockedStudio, /data-raiser-guest/);
  assert.doesNotMatch(lockedStudio, /Raising /);
  assert.doesNotMatch(lockedStudio, /class="claim occupied-claim"/);
  const lockedCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_live_claim_outbid_guest&name=Too%20Late&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Locked.&bidUsd=13",
  });
  assert.equal(lockedCheckout.statusCode, 409);
  assert.match(lockedCheckout.body, /data-checkout-state="locked"/);
  assert.match(lockedCheckout.body, /This episode is locked/);
});

test("unpaid stays off the rundown — No #1 guest until Waffo reports paid", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_unpaid_off",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  const waffo = new FixtureWaffo();
  const app = await buildApp({ db, waffo, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());

  const unpaidCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_unpaid_off&name=Ghost%20Guest&siteUrl=https%3A%2F%2Fghost.example%2F&oneLiner=Abandoned%20Waffo%20checkout.&bidUsd=99",
  });
  assert.equal(unpaidCheckout.statusCode, 303);
  assert.match(String(unpaidCheckout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);

  const leftover = await app.inject({ method: "GET", url: "/" });
  assert.equal(leftover.statusCode, 200);
  const leftoverStudio = studioMarkup(leftover.body);
  assert.match(leftoverStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(leftoverStudio, /Claim #1 for/);
  assert.match(leftoverStudio, /data-first-click="claim"/);
  assert.match(leftoverStudio, /data-identity-fields/);
  assert.match(leftoverStudio, /data-identity-fields/);
  assert.match(leftoverStudio, /\$5 takes #1/);
  assert.match(leftoverStudio, /No paid listings/);
  assert.match(leftoverStudio, /Paid placements remain eligible for seven days/);
  assert.match(leftoverStudio, /data-empty-window/);
  assert.match(leftoverStudio, /data-empty-claim-window/);
  assert.doesNotMatch(leftoverStudio, /data-rolling-week/);
  assert.doesNotMatch(leftoverStudio, /class="week-window"/);
  assert.doesNotMatch(leftoverStudio, /Ghost Guest/);
  assert.doesNotMatch(leftoverStudio, /ghost.example/);
  assert.doesNotMatch(leftoverStudio, /Abandoned Waffo checkout/);
  assert.doesNotMatch(leftoverStudio, /data-rundown/);
  assert.doesNotMatch(leftoverStudio, /data-guest-prize/);
  assert.doesNotMatch(leftoverStudio, /data-first-click="guest"/);
  assert.doesNotMatch(leftoverStudio, /data-paid-at/);
  assert.doesNotMatch(leftoverStudio, /data-later-seat/);
  assert.doesNotMatch(leftoverStudio, /data-later-foot/);
  assert.doesNotMatch(leftoverStudio, /data-later-facts/);
  assert.doesNotMatch(leftoverStudio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(leftoverStudio, /data-occupied-window/);
  assert.doesNotMatch(leftoverStudio, /class="claim occupied-claim"/);
  assert.doesNotMatch(leftoverStudio, /data-host-lock/);
  assert.doesNotMatch(leftoverStudio, /studio-open-occupied/);
  assert.doesNotMatch(leftoverStudio, /data-unpaid-off/);
  const leftoverCss = leftover.body.slice(
    leftover.body.indexOf("<style>"),
    leftover.body.indexOf("</style>"),
  );
  assert.doesNotMatch(
    leftoverCss,
    /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name/,
  );

  const goUnpaid = await app.inject({ method: "GET", url: "/go/lst_ghost" });
  assert.equal(goUnpaid.statusCode, 404);

  const unpaidRow: Listing = {
    id: "lst_ghost",
    episodeId: episode.id,
    name: "Ghost Guest",
    siteUrl: "https://ghost.example/",
    oneLiner: "Abandoned Waffo checkout.",
    bidUsd: 99,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "",
    clicks: 9,
    vetoedAt: null,
    vetoReason: null,
  };
  const epochRow: Listing = {
    ...unpaidRow,
    id: "lst_epoch",
    name: "Vapor Co",
    siteUrl: "https://vapor.example/",
    oneLiner: "Epoch paidAt is not Waffo paid.",
    paidAt: "1970-01-01T00:00:00.000Z",
  };
  assert.deepEqual(boardRows([unpaidRow, epochRow]), []);
  const leaked = renderBoardHtml(episode, [unpaidRow, epochRow]);
  const leakedStudio = studioMarkup(leaked);
  assert.match(leakedStudio, /class="studio studio-open-empty"/);
  assert.match(leakedStudio, /Claim #1 for/);
  assert.match(leakedStudio, /data-first-click="claim"/);
  assert.doesNotMatch(leakedStudio, /Ghost Guest|Vapor Co/);
  assert.doesNotMatch(leakedStudio, /data-guest-prize/);
  assert.doesNotMatch(leakedStudio, /data-first-click="guest"/);
  assert.doesNotMatch(leakedStudio, /data-paid-at/);
  assert.doesNotMatch(leakedStudio, /data-rundown/);
  assert.doesNotMatch(leakedStudio, /studio-open-occupied/);

  insertListing(db, {
    id: "lst_ada",
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  insertListing(db, {
    id: "lst_hold",
    episodeId: episode.id,
    name: "Hold Co",
    siteUrl: "https://hold.example/",
    oneLiner: "Still listed below #1.",
    bidUsd: 8,
    firstBidAt: "2026-08-22T01:10:00.000Z",
    paidAt: "2026-08-22T01:10:05.000Z",
    clicks: 2,
  });
  insertListing(db, {
    id: "lst_veto",
    episodeId: episode.id,
    name: "Hard Sell Co",
    siteUrl: "https://hardsell.example/",
    oneLiner: "Buy my course on air.",
    bidUsd: 20,
    firstBidAt: "2026-08-22T00:30:00.000Z",
    paidAt: "2026-08-22T00:30:05.000Z",
    clicks: 1,
    vetoedAt: "2026-08-22T02:00:00.000Z",
    vetoReason: "hard sell",
  });

  const occupied = await app.inject({ method: "GET", url: "/" });
  assert.equal(occupied.statusCode, 200);
  const studio = studioMarkup(occupied.body);
  const ticketAt = studio.indexOf("data-show-ticket");
  const claimAt = studio.indexOf('id="claim"');
  const rundownAt = studio.indexOf("data-rundown");
  const adaStart = studio.indexOf('data-listing-id="lst_ada"');
  const holdStart = studio.indexOf('data-listing-id="lst_hold"');
  const vetoStart = studio.indexOf('data-listing-id="lst_veto"');
  const deskAt = studio.indexOf("data-host-lock");
  const lockBtnAt = studio.indexOf('class="lock-episode"');
  assert.ok(ticketAt !== -1 && rundownAt > ticketAt);
  assert.ok(claimAt < rundownAt);
  assert.ok(adaStart > rundownAt);
  assert.ok(holdStart > adaStart);
  assert.ok(vetoStart > holdStart);
  assert.ok(claimAt < rundownAt);
  assert.ok(deskAt > claimAt);
  assert.ok(lockBtnAt > rundownAt);
  const adaCard = studio.slice(adaStart, holdStart);
  const holdCard = studio.slice(holdStart, vetoStart);
  const vetoCard = studio.slice(vetoStart, deskAt);
  assert.match(adaCard, /data-guest-prize/);
  assert.match(adaCard, /data-paid-at="2026-08-22T01:00:05.000Z"/);
  assert.match(adaCard, /data-first-click="guest"/);
  assert.match(adaCard, /class="later-facts"[^>]*data-later-facts/);
  assert.match(holdCard, /data-later-seat/);
  assert.match(holdCard, /class="later-foot"[^>]*data-later-foot/);
  assert.match(holdCard, /data-paid-at="2026-08-22T01:10:05.000Z"/);
  assert.match(vetoCard, /data-vetoed="true"/);
  assert.match(vetoCard, /Hard Sell Co/);
  assert.match(vetoCard, /Vetoed: hard sell/);
  assert.match(vetoCard, /data-paid-at="2026-08-22T00:30:05.000Z"/);
  assert.doesNotMatch(studio, /Ghost Guest|Vapor Co/);
  assert.match(studio, /Claim #1 for/);
  assert.doesNotMatch(studio, /data-first-click="claim"/);
  assert.match(studio, /class="claim occupied-claim"/);
  assert.match(studio, /data-claim-state="open-occupied"/);
  assert.doesNotMatch(studio, /data-unpaid-off/);
  assert.equal(countExact(studio, 'data-first-click="guest"'), 1);
  assert.equal(countExact(studio, "data-guest-prize"), 1);
  assert.match(studio, /class="studio studio-open-occupied"/);
  assert.match(occupied.body, /Claim #1 for/);
  const occupiedCss = occupied.body.slice(
    occupied.body.indexOf("<style>"),
    occupied.body.indexOf("</style>"),
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name/,
  );
  assert.match(
    occupiedCss,
    /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name a\[data-first-click="guest"\]/,
  );

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload: `episodeId=ep_unpaid_off&session=${encodeURIComponent(DEV_HOST_SESSION_SECRET)}`,
  });
  assert.equal(locked.statusCode, 303);
  const afterLock = await app.inject({ method: "GET", url: "/" });
  const lockedStudio = studioMarkup(afterLock.body);
  assert.match(lockedStudio, /Episode 12 is locked/);
  assert.match(lockedStudio, /data-checkout-state="locked"/);
  assert.match(lockedStudio, /Hard Sell Co/);
  assert.match(lockedStudio, /data-listing-id="lst_veto"[^>]*data-vetoed="true"/);
  assert.doesNotMatch(lockedStudio, /Ghost Guest/);

  const lockedCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_unpaid_off&name=Too%20Late&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Locked.&bidUsd=13",
  });
  assert.equal(lockedCheckout.statusCode, 409);
  assert.match(lockedCheckout.body, /data-checkout-state="locked"/);
  assert.match(lockedCheckout.body, /This episode is locked/);
});

test("GET / on an occupied open episode makes locking the episode the host action", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_lock_desk",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_ada",
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  insertListing(db, {
    id: "lst_veto",
    episodeId: episode.id,
    name: "Hard Sell Co",
    siteUrl: "https://hardsell.example/",
    oneLiner: "Buy my course on air.",
    bidUsd: 20,
    firstBidAt: "2026-08-22T00:30:00.000Z",
    paidAt: "2026-08-22T00:30:05.000Z",
    vetoedAt: "2026-08-22T02:00:00.000Z",
    vetoReason: "hard sell",
  });

  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const board = await app.inject({ method: "GET", url: "/" });
  assert.equal(board.statusCode, 200);
  const body = board.body;
  const studio = studioMarkup(body);
  const deskAt = studio.indexOf("data-host-lock");
  const claimAt = studio.indexOf('id="claim"');
  const lockBtnAt = studio.indexOf('class="lock-episode"');
  const outbidAt = studio.indexOf("Claim rank");
  const rundownAt = studio.indexOf("data-rundown");
  const guestClickAt = studio.indexOf('data-first-click="guest"');
  assert.notEqual(deskAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockBtnAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(guestClickAt, -1);
  assert.ok(claimAt < rundownAt);
  assert.ok(claimAt < guestClickAt);
  assert.ok(guestClickAt < deskAt);
  assert.ok(rundownAt < deskAt);
  assert.ok(claimAt < deskAt);
  assert.ok(outbidAt !== -1 && outbidAt < rundownAt && outbidAt < deskAt);
  assert.ok(lockBtnAt > rundownAt);
  assert.match(body, /data-host-only/);
  assert.match(body, /data-guest-skip/);
  assert.match(body, /Guests skip this\. This desk is for the host — it is not a bid\./);
  assert.match(body, /Lock episode/);
  assert.match(body, /Lock Episode 12 — book Ada Lovelace\./);
  assert.match(body, /Lock books Ada Lovelace at \$12, the highest remaining eligible bid/);
  assert.match(body, /Vetoed rows stay visible/);
  assert.match(body, /checkout closes/i);
  assert.match(body, /action="\/host\/lock"/);
  assert.match(body, /name="episodeId" value="ep_lock_desk"/);
  assert.match(body, /Lock Episode 12/);
  assert.match(body, /class="lock-episode"/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /Ada Lovelace/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /Already on this episode\?/);
  assert.match(body, />Outbid/);
  assert.match(studio, /class="studio studio-open-occupied"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /data-host-open/);
  assert.match(studio, /Claim #1 for/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.match(studio, /class="claim occupied-claim"/);
  assert.match(studio, /data-claim-state="open-occupied"/);
  assert.equal(countExact(studio, "data-claim-locked"), 0);
  assert.equal(countExact(studio, 'data-checkout-state="locked"'), 0);
  assert.equal(countExact(studio, "data-empty-honest"), 0);
  assert.equal(countAttr(studio, "data-later-fact"), 1);
  assert.equal(countExact(studio, 'class="bid lead-bid later-fact"'), 1);
  assert.doesNotMatch(body, /action="\/host\/open"/);
  assert.doesNotMatch(body, /Open guest seat/);
  assert.doesNotMatch(body, /class="lock-episode outbid"/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, /Seat is open/);
  assert.doesNotMatch(body, /This episode is locked/);
});

test("POST /host/lock from the desk locks the occupied episode so Waffo cannot charge", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_html_lock",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_book",
    episodeId: episode.id,
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());

  const missing = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
    payload: "episodeId=ep_html_lock",
  });
  assert.equal(missing.statusCode, 401);
  assert.match(missing.body, /Episode did not lock/);
  assert.match(missing.body, /Checkout remains open until the lock succeeds/);
  assert.equal(getCurrentEpisode(db)?.lockedAt, null);

  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
    payload: `episodeId=ep_html_lock&session=${DEV_HOST_SESSION_SECRET}`,
  });
  assert.equal(locked.statusCode, 303);
  assert.equal(locked.headers.location, "/");
  const lockedEpisode = getCurrentEpisode(db);
  assert.ok(lockedEpisode);
  assert.equal(lockedEpisode.id, "ep_html_lock");
  assert.ok(lockedEpisode.lockedAt);

  const board = await app.inject({ method: "GET", url: "/" });
  assert.equal(board.statusCode, 200);
  assert.match(board.body, /data-episode-open="false"/);
  assert.match(board.body, /This episode is locked/);
  assert.match(board.body, /Booked Co/);
  assert.match(board.body, /data-host-open/);
  assert.match(board.body, /Open Episode 13/);
  assert.match(board.body, /data-claim-locked/);
  assert.match(board.body, /data-claim-locked/);
  assert.match(board.body, /data-checkout-state="locked"/);
  assert.match(board.body, /Episode 12 is locked/);
  assert.doesNotMatch(board.body, /class="outbid"/);
  assert.doesNotMatch(board.body, /name="bidUsd"/);
  assert.doesNotMatch(board.body, /action="\/checkout"/);
  assert.doesNotMatch(studioMarkup(board.body), /data-host-lock/);
  assert.doesNotMatch(board.body, /action="\/host\/lock"/);
  assert.doesNotMatch(board.body, /data-claim-live/);
  assert.doesNotMatch(board.body, /data-open-seat/);
  assert.doesNotMatch(studioMarkup(board.body), /data-empty-honest/);
  assert.doesNotMatch(studioMarkup(board.body), /data-later-fact/);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_html_lock&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /This episode is locked/);
  assert.match(checkout.body, /No charge was started/);
  assert.match(checkout.body, /data-checkout-state="locked"/);
});

test("SPEC 15: public click /go/:id 302 + clicks increment", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_click",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_click",
    episodeId: episode.id,
    name: "Click Co",
    siteUrl: "https://click.example/path?utm_campaign=x#frag",
    oneLiner: "Public clicks increment.",
    bidUsd: 5,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  assert.equal(getListing(db, "lst_click")?.clicks, 0);

  const app = await buildApp({ db });
  after(() => app.close());

  const first = await app.inject({
    method: "GET",
    url: "/go/lst_click?utm_source=injected",
  });
  assert.equal(first.statusCode, 302);
  assert.equal(first.headers.location, "https://click.example/path");
  assert.doesNotMatch(String(first.headers.location), /[?#]/);
  assert.equal(getListing(db, "lst_click")?.clicks, 1);

  const second = await app.inject({ method: "GET", url: "/go/lst_click" });
  assert.equal(second.statusCode, 302);
  assert.equal(second.headers.location, "https://click.example/path");
  assert.equal(getListing(db, "lst_click")?.clicks, 2);

  const missing = await app.inject({ method: "GET", url: "/go/does-not-exist" });
  assert.equal(missing.statusCode, 404);
});

test("HTML Outbid form posts to /checkout and fixture checkout claims the seat", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_form",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  const app = await buildApp({ db });
  after(() => app.close());

  const started = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_form&name=Ada%20Lovelace&siteUrl=https%3A%2F%2Fada.example%2Fnotes&oneLiner=Notes%20on%20the%20engine.&bidUsd=5",
  });
  assert.equal(started.statusCode, 303);
  const location = String(started.headers.location ?? "");
  assert.match(location, /\/checkout\/complete\?checkoutId=/);
  assert.doesNotMatch(location, /https?:\/\/api\./i);

  const complete = await app.inject({ method: "GET", url: location });
  assert.equal(complete.statusCode, 303);

  const board = await app.inject({ method: "GET", url: "/" });
  assert.match(board.body, /Ada Lovelace/);
  assert.match(board.body, /ada.example\/notes/);
  assert.match(board.body, /\$5/);
  assert.match(board.body, /data-rank="1"/);
});

test("all-vetoed live board stays truthful without an occupied claim or host lock", () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_all_vetoed",
    showId: "show_english",
    label: "Episode all vetoed",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_vetoed_only",
    episodeId: episode.id,
    name: "Vetoed Guest",
    siteUrl: "https://vetoed.example/",
    oneLiner: "Not eligible for this seat.",
    bidUsd: 12,
    firstBidAt: "2026-08-27T00:00:00.000Z",
    paidAt: "2026-08-27T00:00:01.000Z",
    vetoedAt: "2026-08-27T00:01:00.000Z",
    vetoReason: "Editorial fit",
  });

  const body = renderBoardHtml(
    episode,
    listListingsForEpisode(db, episode.id),
    new Date("2026-08-27T01:00:00.000Z"),
  );
  const studio = studioMarkup(body);
  assert.match(body, /data-no-eligible/);
  assert.match(body, /Every paid listing on Episode all vetoed is vetoed/);
  assert.match(body, /Vetoed Guest/);
  assert.match(
    studio,
    /class="studio studio-all-vetoed"[^>]*data-studio-state="all-vetoed"[^>]*data-all-vetoed/,
  );
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.match(studio, /<ol class="rundown[^>]*data-rundown/);
  assert.match(
    studio,
    /<li class="guest vetoed"[^>]*data-listing-id="lst_vetoed_only"[^>]*data-vetoed="true"[^>]*data-paid-at=/,
  );
  assert.match(studio, /<p class="guest-veto">Vetoed: Editorial fit<\/p>/);
  assert.match(
    body,
    /\.studio\.studio-all-vetoed \.rundown\[data-rundown\],\s*\.studio\.studio-all-vetoed \.guest\[data-vetoed="true"\]/,
  );
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.doesNotMatch(studio, /data-host-lock/);
  assert.doesNotMatch(studio, /data-claim-state="open-occupied"/);
  assert.match(studio, /class="claim empty-claim-first no-eligible"/);
  assert.match(studio, /data-claim-live/);
  assert.match(studio, /Claim #1 for/);
  assert.match(studio, /name="bidUsd"/);
  assert.match(studio, /action="\/checkout"/);
  assert.match(studio, /full bid of at least \$5/);
  assert.doesNotMatch(body, /data-rank="1"/);
});
