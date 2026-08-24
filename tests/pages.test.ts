import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { createEpisode, getCurrentEpisode } from "../src/episodes.js";
import { DEV_HOST_SESSION_SECRET } from "../src/http/routes/host.js";
import { getListing, insertListing } from "../src/listings.js";

function memoryDb() {
  const db = openDatabase(":memory:");
  after(() => db.close());
  return db;
}

function studioMarkup(html: string): string {
  const start = html.indexOf('<div class="studio">');
  const end = html.indexOf("<script>", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return html.slice(start, end);
}

function countExact(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
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
  assert.doesNotMatch(body, /api\.polar/);
});

test("GET /e/:episodeId is that episode’s board", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_12",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-01T00:00:00.000Z",
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

test("GET /about describes the seat, cadence, and veto default", async () => {
  const app = await buildApp();
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/about" });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /text\/html/);
  assert.match(response.body, /guest seat/i);
  assert.match(response.body, /per episode/i);
  assert.match(response.body, /Veto defaults on for guest seat/);
  assert.match(response.body, /60-second open/);
});

test("GET /rules states min $5, older wins, veto default on for guest seat", async () => {
  const app = await buildApp();
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/rules" });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /text\/html/);
  const body = response.body;
  assert.match(body, /\$5/);
  assert.match(body, /older/i);
  assert.match(body, /difference/i);
  assert.match(body, /default on for guest seat/i);
  assert.match(body, /Query strings are stripped/);
  assert.match(body, /Chat \/ NSFW/);
  assert.match(body, /Telegram/);
  assert.match(body, /Discord/);
});

test("GET / with no episode keeps the claim visible; Polar cannot charge yet", async () => {
  const app = await buildApp();
  after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  const body = response.body;
  assert.match(body, /Claim the guest seat for/);
  assert.match(body, /data-bid-step="-1"/);
  assert.match(body, /data-bid-step="1"/);
  assert.match(body, /name="bidUsd"/);
  assert.match(body, /Outbid/);
  assert.match(body, /Polar cannot charge yet/);
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
  assert.match(about.body, /Polar cannot charge/);
  assert.match(about.body, /first paid bid of at least \$5 takes #1/);
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
  assert.equal(countExact(studio, "data-open-after-lock"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 0);
  assert.equal(countExact(studio, "open-after-lock-first"), 0);
  assert.equal(countExact(studio, "open-after-lock-two"), 0);
  assert.equal(countExact(studio, "data-lock-after-open"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 0);
  assert.equal(countExact(studio, "lock-after-open-first"), 0);
  assert.equal(countExact(studio, "lock-after-open-two"), 0);
  assert.match(body, /name="session"/);
  assert.match(body, /name="seatKind" value="guest_seat"/);
  assert.match(body, /name="label"[^>]*value="Episode 1"/);
  assert.match(body, /data-waiting-on-host/);
  assert.match(body, /Skip the host desk/);
  assert.match(body, /Polar cannot charge yet/);
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
  assert.equal(countExact(studio, "data-open-after-lock"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 0);
  assert.equal(countExact(studio, "open-after-lock-first"), 0);
  assert.equal(countExact(studio, "open-after-lock-two"), 0);
  assert.equal(countExact(studio, "data-lock-after-open"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 0);
  assert.equal(countExact(studio, "lock-after-open-first"), 0);
  assert.equal(countExact(studio, "lock-after-open-two"), 0);
  assert.doesNotMatch(body, /class="open-next outbid"/);
  assert.doesNotMatch(body, /name="episodeId"/);
  assert.doesNotMatch(body, /Already on this episode\?/);
});

test("POST /host/open from the desk opens a guest-seat episode so Polar can charge", async () => {
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
  assert.match(missing.body, /unauthorized/);
  assert.match(missing.body, /Polar cannot charge yet/);
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
  assert.match(board.body, /Host veto is on \(default on for guest seat\)/);
  assert.match(board.body, /name="episodeId"/);
  assert.match(board.body, /data-claim-live/);
  assert.match(board.body, /data-open-seat/);
  assert.match(board.body, /Seat is open/);
  assert.match(board.body, /\$5 takes #1/);
  assert.match(board.body, /Polar can charge/);
  assert.doesNotMatch(board.body, /data-host-open/);
  assert.doesNotMatch(board.body, /data-host-lock/);
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

test("GET / after lock keeps the host desk so the next empty episode can open", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_locked",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_booked",
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
  const board = await app.inject({ method: "GET", url: "/" });
  assert.equal(board.statusCode, 200);
  assert.match(board.body, /data-host-open/);
  assert.match(board.body, /data-host-only/);
  assert.match(board.body, /data-guest-skip/);
  assert.match(board.body, /Guests skip this/);
  assert.match(board.body, /Open Episode 13/);
  assert.match(board.body, /class="open-next"/);
  assert.match(board.body, /data-open-next/);
  assert.match(board.body, /data-open-after-lock(?!-(?:first|two))/);
  assert.match(board.body, /data-open-after-lock-first/);
  assert.match(board.body, /data-open-after-lock-two/);
  assert.match(board.body, /class="host-open open-after-lock-first open-after-lock-two"/);
  assert.match(board.body, /data-lock-after-open(?!-(?:first|two))/);
  assert.match(board.body, /data-lock-after-open-first/);
  assert.match(board.body, /data-lock-after-open-two/);
  assert.match(board.body, /class="claim lock-after-open-first lock-after-open-two"/);
  assert.match(board.body, /Episode 12 is locked\. Open Episode 13 empty\./);
  assert.match(board.body, /Episode 12 stays booked/);
  assert.match(board.body, /prior bids do not carry/);
  assert.match(board.body, /name="label"[^>]*value="Episode 13"/);
  assert.match(board.body, /Booked Co/);
  assert.match(board.body, /This episode is locked/);
  assert.match(board.body, /data-claim-locked/);
  assert.match(board.body, /Episode 12 is locked/);
  assert.doesNotMatch(board.body, /data-claim-live/);
  assert.doesNotMatch(board.body, /data-open-seat/);
  assert.doesNotMatch(board.body, /Seat is open/);
  assert.doesNotMatch(board.body, /class="outbid"/);
  assert.doesNotMatch(board.body, /name="bidUsd"/);
  assert.doesNotMatch(board.body, /action="\/checkout"/);
  assert.doesNotMatch(board.body, /class="open-next outbid"/);
  assert.doesNotMatch(board.body, /data-host-lock/);
  assert.doesNotMatch(board.body, /action="\/host\/lock"/);
  assert.doesNotMatch(board.body, /Lock this episode/);
});

test("GET / after lock makes the locked episode certain for a first-time guest", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_locked_guest",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_booked_guest",
    episodeId: "ep_locked_guest",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const board = await app.inject({ method: "GET", url: "/" });
  assert.equal(board.statusCode, 200);
  const body = board.body;
  const studio = studioMarkup(body);
  const ticketAt = studio.indexOf("data-show-ticket");
  const claimAt = studio.indexOf('id="claim"');
  const lockedAt = studio.indexOf("data-claim-locked");
  const deskAt = studio.indexOf("data-host-open");
  const openNextAt = studio.indexOf("data-open-next");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const rundownAt = studio.indexOf("data-rundown");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(openNextAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(ticketAt < claimAt);
  assert.ok(claimAt < deskAt);
  assert.ok(deskAt < rundownAt);
  assert.ok(lockedAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.match(body, /data-episode-open="false"/);
  assert.match(body, /data-lock-after-open(?!-(?:first|two))/);
  assert.match(body, /data-lock-after-open-first/);
  assert.match(body, /data-lock-after-open-two/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two"/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Polar cannot charge/);
  assert.match(body, /The next episode opens empty/);
  assert.match(body, /Prior bids do not carry/);
  assert.match(body, /Unpaid checkout does not rank/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Highest remaining eligible bid/);
  assert.match(body, /Guests skip this/);
  assert.match(body, /Open Episode 13/);
  assert.doesNotMatch(body, /Claim the guest seat for/);
  assert.doesNotMatch(body, /Already on this episode\?/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(body, /Seat is open/);
  assert.doesNotMatch(body, /name="bidUsd"/);
  assert.doesNotMatch(body, /class="outbid"/);
  assert.doesNotMatch(body, /action="\/checkout"/);
  assert.doesNotMatch(body, /name="episodeId"/);
  assert.doesNotMatch(body, /featured guest/i);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_locked_guest&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
});

test("GET / after lock makes opening the next empty episode the host action, not a bid", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_locked_next",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const board = await app.inject({ method: "GET", url: "/" });
  assert.equal(board.statusCode, 200);
  const body = board.body;
  const studio = studioMarkup(body);
  const deskAt = studio.indexOf("data-host-open");
  const openNextAt = studio.indexOf("data-open-next");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const claimAt = studio.indexOf('id="claim"');
  const lockedAt = studio.indexOf("data-claim-locked");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const openBtnAt = studio.indexOf('class="open-next"');
  const outbidAt = studio.indexOf("Outbid");
  assert.notEqual(deskAt, -1);
  assert.notEqual(openNextAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockedAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(openBtnAt < outbidAt || outbidAt === -1);
  assert.match(body, /Next episode/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /Polar cannot charge on N\+1 until you open it/);
  assert.match(body, /This desk is for the host — it is not a bid/);
  assert.match(body, /Episode 12 is locked/);
  assert.equal(studio.split("data-open-next").length - 1, 1);
  assert.equal(studio.split('class="open-next"').length - 1, 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /name="bidUsd"/);
  assert.doesNotMatch(body, /class="outbid"/);
  assert.doesNotMatch(body, /action="\/checkout"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /Open guest seat/);
});

test("GET / after lock makes the host desk the certain next host action", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_open_after_lock",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_open_after",
    episodeId: "ep_open_after_lock",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  const board = await app.inject({ method: "GET", url: "/" });
  assert.equal(board.statusCode, 200);
  const body = board.body;
  const studio = studioMarkup(body);
  const ticketAt = studio.indexOf("data-show-ticket");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const openNextAt = studio.indexOf("data-open-next");
  const claimAt = studio.indexOf('id="claim"');
  const lockedAt = studio.indexOf("data-claim-locked");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const rundownAt = studio.indexOf("data-rundown");
  const openFormAt = studio.indexOf('action="/host/open"');
  assert.notEqual(ticketAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(openNextAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.ok(ticketAt < claimAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockedAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(claimAt < openFormAt);
  assert.ok(deskAt < rundownAt);
  assert.match(body, /data-open-after-lock(?!-(?:first|two))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two"/);
  assert.match(body, /data-lock-after-open(?!-(?:first|two))/);
  assert.match(body, /data-lock-after-open-first/);
  assert.match(body, /data-lock-after-open-two/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two"/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /Episode 12 is locked\. Open Episode 13 empty\./);
  assert.match(body, /Polar cannot charge on N\+1 until you open it/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-host-open"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 3);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(body, /name="bidUsd"/);
  assert.doesNotMatch(body, /class="outbid"/);
  assert.doesNotMatch(body, /action="\/checkout"/);
  assert.doesNotMatch(body, /featured guest/i);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_open_after_lock&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
});

test("GET / after lock concentrates the locked episode after the host desk moved up", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_lock_after_open",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_lock_after",
    episodeId: "ep_lock_after_open",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  insertListing(db, {
    id: "lst_lock_veto",
    episodeId: "ep_lock_after_open",
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
  const ticketAt = studio.indexOf("data-show-ticket");
  const claimAt = studio.indexOf('id="claim"');
  const lockedAt = studio.indexOf("data-claim-locked");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const openBtnAt = studio.indexOf('class="open-next"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(ticketAt < claimAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < deskAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(deskAt < rundownAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-lock-after-open(?!-(?:first|two))/);
  assert.match(body, /data-lock-after-open-first/);
  assert.match(body, /data-lock-after-open-two/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two"/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Polar cannot charge/);
  assert.match(body, /The next episode opens empty/);
  assert.match(body, /Prior bids do not carry/);
  assert.match(body, /Unpaid checkout does not rank/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_lock_veto"[^>]*data-vetoed="true"/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /data-open-after-lock(?!-(?:first|two))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-lock-after-open"), 3);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "data-claim-locked"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 3);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(body, /Seat is open/);
  assert.doesNotMatch(body, /\$5 takes #1/);
  assert.doesNotMatch(body, /name="bidUsd"/);
  assert.doesNotMatch(body, /class="outbid"/);
  assert.doesNotMatch(body, /action="\/checkout"/);
  assert.doesNotMatch(body, /Claim the guest seat for/);
  assert.doesNotMatch(body, /featured guest/i);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_lock_after_open&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
});

test("GET / after lock concentrates opening the next empty episode after the locked claim is first", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_open_after_lock_first",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_open_first",
    episodeId: "ep_open_after_lock_first",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  insertListing(db, {
    id: "lst_open_first_veto",
    episodeId: "ep_open_after_lock_first",
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
  const ticketAt = studio.indexOf("data-show-ticket");
  const claimAt = studio.indexOf('id="claim"');
  const lockedAt = studio.indexOf("data-claim-locked");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const openBtnAt = studio.indexOf('class="open-next"');
  const openFormAt = studio.indexOf('action="/host/open"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(ticketAt < claimAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(afterLockFirstAt < rundownAt);
  assert.ok(deskAt === afterLockAt || deskAt < afterLockFirstAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-open-after-lock(?!-(?:first|two))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two"/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two"/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /Episode 12 is locked\. Open Episode 13 empty\./);
  assert.match(body, /Polar cannot charge on N\+1 until you open it/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_open_first_veto"[^>]*data-vetoed="true"/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-host-open"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 3);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "data-lock-after-open"), 3);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(body, /Seat is open/);
  assert.doesNotMatch(body, /\$5 takes #1/);
  assert.doesNotMatch(body, /name="bidUsd"/);
  assert.doesNotMatch(body, /class="outbid"/);
  assert.doesNotMatch(body, /action="\/checkout"/);
  assert.doesNotMatch(body, /featured guest/i);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_open_after_lock_first&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
});

test("GET / after lock concentrates the locked episode after Open N+1 is concentrated", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_lock_after_open_first",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_lock_first",
    episodeId: "ep_lock_after_open_first",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  insertListing(db, {
    id: "lst_lock_first_veto",
    episodeId: "ep_lock_after_open_first",
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
  const ticketAt = studio.indexOf("data-show-ticket");
  const claimAt = studio.indexOf('id="claim"');
  const lockedAt = studio.indexOf("data-claim-locked");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const openBtnAt = studio.indexOf('class="open-next"');
  const openFormAt = studio.indexOf('action="/host/open"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(ticketAt < claimAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < deskAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterFirstAt < rundownAt);
  assert.ok(claimAt === lockAfterAt || claimAt < lockAfterFirstAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-lock-after-open(?!-(?:first|two))/);
  assert.match(body, /data-lock-after-open-first/);
  assert.match(body, /data-lock-after-open-two/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two"/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Polar cannot charge/);
  assert.match(body, /The next episode opens empty/);
  assert.match(body, /Prior bids do not carry/);
  assert.match(body, /Unpaid checkout does not rank/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_lock_first_veto"[^>]*data-vetoed="true"/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /data-open-after-lock(?!-(?:first|two))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two"/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-claim-locked"), 1);
  assert.equal(countExact(studio, "data-lock-after-open"), 3);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "data-host-open"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 3);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(body, /Seat is open/);
  assert.doesNotMatch(body, /\$5 takes #1/);
  assert.doesNotMatch(body, /name="bidUsd"/);
  assert.doesNotMatch(body, /class="outbid"/);
  assert.doesNotMatch(body, /action="\/checkout"/);
  assert.doesNotMatch(body, /Claim the guest seat for/);
  assert.doesNotMatch(body, /featured guest/i);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_lock_after_open_first&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
});

test("GET / after lock concentrates opening the next empty episode after the locked claim is re-concentrated", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_open_after_lock_two",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_open_two",
    episodeId: "ep_open_after_lock_two",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  insertListing(db, {
    id: "lst_open_two_veto",
    episodeId: "ep_open_after_lock_two",
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
  const ticketAt = studio.indexOf("data-show-ticket");
  const claimAt = studio.indexOf('id="claim"');
  const lockedAt = studio.indexOf("data-claim-locked");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const openBtnAt = studio.indexOf('class="open-next"');
  const openFormAt = studio.indexOf('action="/host/open"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(ticketAt < claimAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < deskAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(afterLockTwoAt < rundownAt);
  assert.ok(deskAt === afterLockAt || deskAt < afterLockTwoAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-open-after-lock(?!-(?:first|two))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two"/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two"/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /Episode 12 is locked\. Open Episode 13 empty\./);
  assert.match(body, /Polar cannot charge on N\+1 until you open it/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_open_two_veto"[^>]*data-vetoed="true"/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-host-open"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 3);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "data-lock-after-open"), 3);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(body, /Seat is open/);
  assert.doesNotMatch(body, /\$5 takes #1/);
  assert.doesNotMatch(body, /name="bidUsd"/);
  assert.doesNotMatch(body, /class="outbid"/);
  assert.doesNotMatch(body, /action="\/checkout"/);
  assert.doesNotMatch(body, /featured guest/i);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_open_after_lock_two&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
});

test("GET / after lock concentrates the locked episode after Open N+1 is re-concentrated", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_lock_after_open_two",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_lock_two",
    episodeId: "ep_lock_after_open_two",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  insertListing(db, {
    id: "lst_lock_two_veto",
    episodeId: "ep_lock_after_open_two",
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
  const ticketAt = studio.indexOf("data-show-ticket");
  const claimAt = studio.indexOf('id="claim"');
  const lockedAt = studio.indexOf("data-claim-locked");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const openBtnAt = studio.indexOf('class="open-next"');
  const openFormAt = studio.indexOf('action="/host/open"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(ticketAt < claimAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < deskAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < rundownAt);
  assert.ok(claimAt === lockAfterAt || claimAt < lockAfterTwoAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-lock-after-open(?!-(?:first|two))/);
  assert.match(body, /data-lock-after-open-first/);
  assert.match(body, /data-lock-after-open-two/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two"/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Polar cannot charge/);
  assert.match(body, /The next episode opens empty/);
  assert.match(body, /Prior bids do not carry/);
  assert.match(body, /Unpaid checkout does not rank/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_lock_two_veto"[^>]*data-vetoed="true"/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /data-open-after-lock(?!-(?:first|two))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two"/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-claim-locked"), 1);
  assert.equal(countExact(studio, "data-lock-after-open"), 3);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "data-host-open"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 3);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(body, /Seat is open/);
  assert.doesNotMatch(body, /\$5 takes #1/);
  assert.doesNotMatch(body, /name="bidUsd"/);
  assert.doesNotMatch(body, /class="outbid"/);
  assert.doesNotMatch(body, /action="\/checkout"/);
  assert.doesNotMatch(body, /Claim the guest seat for/);
  assert.doesNotMatch(body, /featured guest/i);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_lock_after_open_two&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
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
  assert.ok(claimAt < ticketAt);
  assert.ok(outbidAt < ticketAt);
  assert.match(body, /data-episode-open="true"/);
  assert.match(body, /Claim Episode 13 for/);
  assert.match(body, /Episode 13 is open/);
  assert.match(body, /\$5 takes #1 on this empty board/);
  assert.match(body, /Prior bids do not carry/);
  assert.match(body, /Polar can charge/);
  assert.match(body, /name="episodeId" value="[^"]+"/);
  assert.match(body, /value="5"/);
  assert.match(body, />Outbid<\/button>/);
  assert.match(body, /Host veto is on \(default on for guest seat\)/);
  assert.doesNotMatch(body, /data-waiting-on-host/);
  assert.doesNotMatch(body, /No open episode yet/);
  assert.doesNotMatch(body, /No seat for sale/);
  assert.doesNotMatch(body, /Skip the host desk/);
  assert.doesNotMatch(body, /data-host-open/);
  assert.doesNotMatch(body, /data-host-lock/);
  const studio = studioMarkup(body);
  assert.doesNotMatch(studio, / data-open-next/);
  assert.equal(countExact(studio, "data-open-after-lock"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 0);
  assert.equal(countExact(studio, "open-after-lock-first"), 0);
  assert.equal(countExact(studio, "open-after-lock-two"), 0);
  assert.equal(countExact(studio, "data-lock-after-open"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 0);
  assert.equal(countExact(studio, "lock-after-open-first"), 0);
  assert.equal(countExact(studio, "lock-after-open-two"), 0);
  assert.doesNotMatch(body, /data-guest-skip/);
  assert.doesNotMatch(body, /Polar cannot charge on N\+1 until you open it/);
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
  assert.match(body, /Claim the guest seat for/);
  assert.match(body, /name="episodeId"/);
  assert.match(body, /value="5"/);
  assert.match(body, />Outbid<\/button>/);
  assert.match(body, /The guest seat is open/);
  assert.match(body, /Polar can charge/);
  assert.match(body, /\$5 takes #1/);
  assert.match(body, /Seat is open/);
  assert.match(body, /First paid bid of at least \$5 takes #1/);
  assert.match(body, /No paid listings on this episode yet/);
  assert.match(body, /Host veto is on \(default on for guest seat\)/);
  assert.doesNotMatch(body, /data-waiting-on-host/);
  assert.doesNotMatch(body, /No open episode yet/);
  assert.doesNotMatch(body, /No seat for sale/);
  assert.doesNotMatch(body, /data-host-open/);
  assert.doesNotMatch(body, /data-host-lock/);
  const studio = studioMarkup(body);
  assert.doesNotMatch(studio, /data-guest-skip/);
  assert.equal(countExact(studio, "data-open-after-lock"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 0);
  assert.equal(countExact(studio, "open-after-lock-first"), 0);
  assert.equal(countExact(studio, "open-after-lock-two"), 0);
  assert.equal(countExact(studio, "data-lock-after-open"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 0);
  assert.equal(countExact(studio, "lock-after-open-first"), 0);
  assert.equal(countExact(studio, "lock-after-open-two"), 0);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(body, /Claim Episode 1 for/);
  assert.doesNotMatch(body, /Already on this episode\?/);
  assert.doesNotMatch(body, /name="bidUsd"[^>]*disabled/);
  assert.doesNotMatch(body, /class="outbid" disabled/);
  assert.doesNotMatch(body, /featured guest/i);
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
  assert.match(body, /Claim the guest seat for/);
  assert.match(body, />Outbid</);
  assert.match(body, /action="\/checkout"/);
  assert.match(body, /name="name"/);
  assert.match(body, /name="siteUrl"/);
  assert.match(body, /name="oneLiner"/);
  assert.match(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
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
  const deskAt = body.indexOf("data-host-lock");
  const claimAt = body.indexOf('id="claim"');
  const lockBtnAt = body.indexOf('class="lock-episode"');
  const outbidAt = body.indexOf("Outbid");
  assert.notEqual(deskAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockBtnAt, -1);
  assert.ok(deskAt < claimAt);
  assert.ok(lockBtnAt < outbidAt || outbidAt === -1);
  assert.match(body, /data-host-only/);
  assert.match(body, /data-guest-skip/);
  assert.match(body, /Guests skip this\. This desk is for the host — it is not a bid\./);
  assert.match(body, /Lock episode/);
  assert.match(body, /Lock Episode 12 — book Ada Lovelace\./);
  assert.match(body, /Lock books Ada Lovelace at \$12, the highest remaining eligible bid/);
  assert.match(body, /Vetoed rows stay visible/);
  assert.match(body, /Polar cannot charge after lock/);
  assert.match(body, /action="\/host\/lock"/);
  assert.match(body, /name="episodeId" value="ep_lock_desk"/);
  assert.match(body, /Lock Episode 12/);
  assert.match(body, /class="lock-episode"/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /Ada Lovelace/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /Already on this episode\?/);
  assert.match(body, />Outbid<\/button>/);
  const studio = studioMarkup(body);
  assert.doesNotMatch(studio, /data-host-open/);
  assert.equal(countExact(studio, "data-open-after-lock"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 0);
  assert.equal(countExact(studio, "open-after-lock-first"), 0);
  assert.equal(countExact(studio, "open-after-lock-two"), 0);
  assert.equal(countExact(studio, "data-lock-after-open"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 0);
  assert.equal(countExact(studio, "lock-after-open-first"), 0);
  assert.equal(countExact(studio, "lock-after-open-two"), 0);
  assert.doesNotMatch(body, /action="\/host\/open"/);
  assert.doesNotMatch(body, /Open guest seat/);
  assert.doesNotMatch(body, /class="lock-episode outbid"/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, /Seat is open/);
  assert.doesNotMatch(body, /This episode is locked/);
});

test("POST /host/lock from the desk locks the occupied episode so Polar cannot charge", async () => {
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
  assert.match(missing.body, /unauthorized/);
  assert.match(missing.body, /Polar can still charge until this episode locks/);
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
  assert.match(board.body, /Episode 12 is locked/);
  assert.match(board.body, /data-open-after-lock-first/);
  assert.match(board.body, /data-open-after-lock-two/);
  assert.match(board.body, /data-lock-after-open-first/);
  assert.match(board.body, /data-lock-after-open-two/);
  assert.doesNotMatch(board.body, /class="outbid"/);
  assert.doesNotMatch(board.body, /name="bidUsd"/);
  assert.doesNotMatch(board.body, /action="\/checkout"/);
  assert.doesNotMatch(board.body, /data-host-lock/);
  assert.doesNotMatch(board.body, /action="\/host\/lock"/);
  assert.doesNotMatch(board.body, /data-claim-live/);
  assert.doesNotMatch(board.body, /data-open-seat/);

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
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
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
  assert.doesNotMatch(location, /polar/i);

  const complete = await app.inject({ method: "GET", url: location });
  assert.equal(complete.statusCode, 303);

  const board = await app.inject({ method: "GET", url: "/" });
  assert.match(board.body, /Ada Lovelace/);
  assert.match(board.body, /ada.example\/notes/);
  assert.match(board.body, /\$5/);
  assert.match(board.body, /data-rank="1"/);
});
