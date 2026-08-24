import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { createEpisode, getCurrentEpisode } from "../src/episodes.js";
import { DEV_HOST_SESSION_SECRET } from "../src/http/routes/host.js";
import { boardRows, renderBoardHtml } from "../src/http/routes/pages.js";
import { getListing, insertListing, type Listing } from "../src/listings.js";
import { FixturePolar } from "../src/polar/fixture.js";

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
  assert.match(studio, /class="studio studio-waiting"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.equal(countExact(studio, "data-open-after-lock"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 0);
  assert.equal(countExact(studio, "open-after-lock-first"), 0);
  assert.equal(countExact(studio, "open-after-lock-two"), 0);
  assert.equal(countExact(studio, "open-after-lock-three"), 0);
  assert.equal(countExact(studio, "open-after-lock-four"), 0);
  assert.equal(countExact(studio, "open-after-lock-five"), 0);
  assert.equal(countExact(studio, "data-lock-certain"), 0);
  assert.equal(countExact(studio, "data-lock-409"), 0);
  assert.equal(countExact(studio, "data-empty-honest"), 0);
  assert.equal(countExact(studio, "data-later-fact"), 0);
  assert.equal(countExact(studio, "data-lock-after-open"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 0);
  assert.equal(countExact(studio, "lock-after-open-first"), 0);
  assert.equal(countExact(studio, "lock-after-open-two"), 0);
  assert.equal(countExact(studio, "lock-after-open-three"), 0);
  assert.equal(countExact(studio, "lock-after-open-four"), 0);
  assert.equal(countExact(studio, "lock-after-open-five"), 0);
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
  assert.match(studio, /class="studio studio-waiting"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.equal(countExact(studio, "data-open-after-lock"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 0);
  assert.equal(countExact(studio, "open-after-lock-first"), 0);
  assert.equal(countExact(studio, "open-after-lock-two"), 0);
  assert.equal(countExact(studio, "open-after-lock-three"), 0);
  assert.equal(countExact(studio, "open-after-lock-four"), 0);
  assert.equal(countExact(studio, "open-after-lock-five"), 0);
  assert.equal(countExact(studio, "data-lock-certain"), 0);
  assert.equal(countExact(studio, "data-lock-409"), 0);
  assert.equal(countExact(studio, "data-empty-honest"), 0);
  assert.equal(countExact(studio, "data-later-fact"), 0);
  assert.equal(countExact(studio, "data-lock-after-open"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 0);
  assert.equal(countExact(studio, "lock-after-open-first"), 0);
  assert.equal(countExact(studio, "lock-after-open-two"), 0);
  assert.equal(countExact(studio, "lock-after-open-three"), 0);
  assert.equal(countExact(studio, "lock-after-open-four"), 0);
  assert.equal(countExact(studio, "lock-after-open-five"), 0);
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
  assert.match(board.body, /data-empty-honest/);
  assert.match(board.body, /Seat is open/);
  assert.match(board.body, /\$5 takes #1/);
  assert.match(board.body, /Polar can charge/);
  const openedStudio = studioMarkup(board.body);
  assert.match(openedStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.equal(countExact(openedStudio, "data-empty-honest"), 3);
  assert.doesNotMatch(openedStudio, /studio-open-occupied/);
  assert.doesNotMatch(openedStudio, /data-lock-certain/);
  assert.doesNotMatch(openedStudio, /data-lock-409/);
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
  assert.match(board.body, /data-open-after-lock(?!-(?:first|two|three|four|five))/);
  assert.match(board.body, /data-open-after-lock-first/);
  assert.match(board.body, /data-open-after-lock-two/);
  assert.match(board.body, /data-open-after-lock-three/);
  assert.match(board.body, /data-open-after-lock-four/);
  assert.match(board.body, /data-open-after-lock-five/);
  assert.match(board.body, /class="host-open open-after-lock-first open-after-lock-two open-after-lock-three open-after-lock-four open-after-lock-five"/);
  assert.match(board.body, /data-lock-after-open(?!-(?:first|two|three|four|five))/);
  assert.match(board.body, /data-lock-after-open-first/);
  assert.match(board.body, /data-lock-after-open-two/);
  assert.match(board.body, /data-lock-after-open-three/);
  assert.match(board.body, /data-lock-after-open-four/);
  assert.match(board.body, /data-lock-after-open-five/);
  assert.match(board.body, /class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five"/);
  assert.match(board.body, /Episode 12 is locked\. Open Episode 13 empty\./);
  assert.match(board.body, /Episode 12 stays booked/);
  assert.match(board.body, /prior bids do not carry/);
  assert.match(board.body, /name="label"[^>]*value="Episode 13"/);
  assert.match(board.body, /Booked Co/);
  assert.match(board.body, /This episode is locked/);
  assert.match(board.body, /data-claim-locked/);
  assert.match(board.body, /data-lock-certain/);
  assert.match(board.body, /data-lock-409/);
  assert.match(board.body, /Episode 12 is locked/);
  assert.doesNotMatch(board.body, /data-claim-live/);
  assert.doesNotMatch(board.body, /data-open-seat/);
  assert.doesNotMatch(studioMarkup(board.body), /data-empty-honest/);
  assert.doesNotMatch(studioMarkup(board.body), /data-later-fact/);
  assert.doesNotMatch(board.body, /Seat is open/);
  assert.doesNotMatch(board.body, /class="outbid"/);
  assert.doesNotMatch(board.body, /name="bidUsd"/);
  assert.doesNotMatch(board.body, /action="\/checkout"/);
  assert.doesNotMatch(board.body, /class="open-next outbid"/);
  assert.doesNotMatch(studioMarkup(board.body), /data-host-lock/);
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
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const deskAt = studio.indexOf("data-host-open");
  const openNextAt = studio.indexOf("data-open-next");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const afterLockThreeAt = studio.indexOf("data-open-after-lock-three");
  const afterLockFourAt = studio.indexOf("data-open-after-lock-four");
  const afterLockFiveAt = studio.indexOf("data-open-after-lock-five");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const lockAfterThreeAt = studio.indexOf("data-lock-after-open-three");
  const lockAfterFourAt = studio.indexOf("data-lock-after-open-four");
  const lockAfterFiveAt = studio.indexOf("data-lock-after-open-five");
  const rundownAt = studio.indexOf("data-rundown");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(openNextAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(afterLockThreeAt, -1);
  assert.notEqual(afterLockFourAt, -1);
  assert.notEqual(afterLockFiveAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(lockAfterThreeAt, -1);
  assert.notEqual(lockAfterFourAt, -1);
  assert.notEqual(lockAfterFiveAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(claimAt < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(claimAt < deskAt);
  assert.ok(deskAt < rundownAt);
  assert.ok(lockedAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < afterLockFiveAt);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "open-after-lock-three"), 2);
  assert.equal(countExact(studio, "open-after-lock-four"), 2);
  assert.equal(countExact(studio, "open-after-lock-five"), 2);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "lock-after-open-three"), 2);
  assert.equal(countExact(studio, "lock-after-open-four"), 2);
  assert.equal(countExact(studio, "lock-after-open-five"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.match(body, /data-episode-open="false"/);
  assert.match(body, /data-lock-after-open(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-lock-after-open-first/);
  assert.match(body, /data-lock-after-open-two/);
  assert.match(body, /data-lock-after-open-three/);
  assert.match(body, /data-lock-after-open-four/);
  assert.match(body, /data-lock-after-open-five/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five"/);
  assert.match(body, /data-lock-certain/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Polar cannot charge/);
  assert.match(body, /The next episode opens empty/);
  assert.match(body, /Prior bids do not carry/);
  assert.match(body, /Unpaid checkout does not rank/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Highest remaining eligible bid/);
  assert.doesNotMatch(studio, /data-guest-prize/);
  assert.doesNotMatch(studio, /data-later-fact/);
  const lockedTitleAt = studio.indexOf("Episode 12 is locked");
  const bookedAt = studio.indexOf("Booked Co");
  assert.notEqual(lockedTitleAt, -1);
  assert.notEqual(bookedAt, -1);
  assert.ok(lockedTitleAt < bookedAt);
  assert.match(body, /Guests skip this/);
  assert.match(body, /Open Episode 13/);
  assert.doesNotMatch(body, /Claim the guest seat for/);
  assert.doesNotMatch(body, /Already on this episode\?/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(studioMarkup(body), /Claim #1 for/);
  assert.doesNotMatch(studioMarkup(body), /Then the guest site/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-claim-first/);
  assert.doesNotMatch(studioMarkup(body), /data-later-write/);
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
  const afterLockThreeAt = studio.indexOf("data-open-after-lock-three");
  const afterLockFourAt = studio.indexOf("data-open-after-lock-four");
  const afterLockFiveAt = studio.indexOf("data-open-after-lock-five");
  const claimAt = studio.indexOf('id="claim"');
  const lockedAt = studio.indexOf("data-claim-locked");
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const lockAfterThreeAt = studio.indexOf("data-lock-after-open-three");
  const lockAfterFourAt = studio.indexOf("data-lock-after-open-four");
  const lockAfterFiveAt = studio.indexOf("data-lock-after-open-five");
  const openBtnAt = studio.indexOf('class="open-next"');
  const outbidAt = studio.indexOf("Outbid");
  assert.notEqual(deskAt, -1);
  assert.notEqual(openNextAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(afterLockThreeAt, -1);
  assert.notEqual(afterLockFourAt, -1);
  assert.notEqual(afterLockFiveAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(lockAfterThreeAt, -1);
  assert.notEqual(lockAfterFourAt, -1);
  assert.notEqual(lockAfterFiveAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.ok(claimAt < deskAt);
  assert.ok(lockCertainAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockedAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < afterLockFiveAt);
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
  const afterLockThreeAt = studio.indexOf("data-open-after-lock-three");
  const afterLockFourAt = studio.indexOf("data-open-after-lock-four");
  const afterLockFiveAt = studio.indexOf("data-open-after-lock-five");
  const openNextAt = studio.indexOf("data-open-next");
  const claimAt = studio.indexOf('id="claim"');
  const lockedAt = studio.indexOf("data-claim-locked");
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const lockAfterThreeAt = studio.indexOf("data-lock-after-open-three");
  const lockAfterFourAt = studio.indexOf("data-lock-after-open-four");
  const lockAfterFiveAt = studio.indexOf("data-lock-after-open-five");
  const rundownAt = studio.indexOf("data-rundown");
  const openFormAt = studio.indexOf('action="/host/open"');
  assert.notEqual(ticketAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(afterLockThreeAt, -1);
  assert.notEqual(afterLockFourAt, -1);
  assert.notEqual(afterLockFiveAt, -1);
  assert.notEqual(openNextAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(lockAfterThreeAt, -1);
  assert.notEqual(lockAfterFourAt, -1);
  assert.notEqual(lockAfterFiveAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.ok(claimAt < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockedAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < afterLockFiveAt);
  assert.ok(claimAt < openFormAt);
  assert.ok(deskAt < rundownAt);
  assert.match(body, /data-open-after-lock(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /data-open-after-lock-three/);
  assert.match(body, /data-open-after-lock-four/);
  assert.match(body, /data-open-after-lock-five/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two open-after-lock-three open-after-lock-four open-after-lock-five"/);
  assert.match(body, /data-lock-after-open(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-lock-after-open-first/);
  assert.match(body, /data-lock-after-open-two/);
  assert.match(body, /data-lock-after-open-three/);
  assert.match(body, /data-lock-after-open-four/);
  assert.match(body, /data-lock-after-open-five/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five"/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /Episode 12 is locked\. Open Episode 13 empty\./);
  assert.match(body, /Polar cannot charge on N\+1 until you open it/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-host-open"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 6);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "open-after-lock-three"), 2);
  assert.equal(countExact(studio, "open-after-lock-four"), 2);
  assert.equal(countExact(studio, "open-after-lock-five"), 2);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "lock-after-open-three"), 2);
  assert.equal(countExact(studio, "lock-after-open-four"), 2);
  assert.equal(countExact(studio, "lock-after-open-five"), 2);
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
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const lockAfterThreeAt = studio.indexOf("data-lock-after-open-three");
  const lockAfterFourAt = studio.indexOf("data-lock-after-open-four");
  const lockAfterFiveAt = studio.indexOf("data-lock-after-open-five");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const afterLockThreeAt = studio.indexOf("data-open-after-lock-three");
  const afterLockFourAt = studio.indexOf("data-open-after-lock-four");
  const afterLockFiveAt = studio.indexOf("data-open-after-lock-five");
  const openBtnAt = studio.indexOf('class="open-next"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(lockAfterThreeAt, -1);
  assert.notEqual(lockAfterFourAt, -1);
  assert.notEqual(lockAfterFiveAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(afterLockThreeAt, -1);
  assert.notEqual(afterLockFourAt, -1);
  assert.notEqual(afterLockFiveAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(claimAt < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < deskAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < afterLockFiveAt);
  assert.ok(deskAt < rundownAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-lock-after-open(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-lock-after-open-first/);
  assert.match(body, /data-lock-after-open-two/);
  assert.match(body, /data-lock-after-open-three/);
  assert.match(body, /data-lock-after-open-four/);
  assert.match(body, /data-lock-after-open-five/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five"/);
  assert.match(body, /data-lock-certain/);
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
  assert.match(body, /data-open-after-lock(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-lock-after-open"), 6);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "lock-after-open-three"), 2);
  assert.equal(countExact(studio, "lock-after-open-four"), 2);
  assert.equal(countExact(studio, "lock-after-open-five"), 2);
  assert.equal(countExact(studio, "data-claim-locked"), 1);
  assert.equal(countExact(studio, "data-lock-certain"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 6);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "open-after-lock-three"), 2);
  assert.equal(countExact(studio, "open-after-lock-four"), 2);
  assert.equal(countExact(studio, "open-after-lock-five"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(studioMarkup(body), /Claim #1 for/);
  assert.doesNotMatch(studioMarkup(body), /Then the guest site/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-claim-first/);
  assert.doesNotMatch(studioMarkup(body), /data-later-write/);
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
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const lockAfterThreeAt = studio.indexOf("data-lock-after-open-three");
  const lockAfterFourAt = studio.indexOf("data-lock-after-open-four");
  const lockAfterFiveAt = studio.indexOf("data-lock-after-open-five");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const afterLockThreeAt = studio.indexOf("data-open-after-lock-three");
  const afterLockFourAt = studio.indexOf("data-open-after-lock-four");
  const afterLockFiveAt = studio.indexOf("data-open-after-lock-five");
  const openBtnAt = studio.indexOf('class="open-next"');
  const openFormAt = studio.indexOf('action="/host/open"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(lockAfterThreeAt, -1);
  assert.notEqual(lockAfterFourAt, -1);
  assert.notEqual(lockAfterFiveAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(afterLockThreeAt, -1);
  assert.notEqual(afterLockFourAt, -1);
  assert.notEqual(afterLockFiveAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(claimAt < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < afterLockFiveAt);
  assert.ok(afterLockFirstAt < rundownAt);
  assert.ok(deskAt === afterLockAt || deskAt < afterLockFirstAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-open-after-lock(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /data-open-after-lock-three/);
  assert.match(body, /data-open-after-lock-four/);
  assert.match(body, /data-open-after-lock-five/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two open-after-lock-three open-after-lock-four open-after-lock-five"/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five"/);
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
  assert.equal(countExact(studio, "data-open-after-lock"), 6);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "open-after-lock-three"), 2);
  assert.equal(countExact(studio, "open-after-lock-four"), 2);
  assert.equal(countExact(studio, "open-after-lock-five"), 2);
  assert.equal(countExact(studio, "data-lock-after-open"), 6);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "lock-after-open-three"), 2);
  assert.equal(countExact(studio, "lock-after-open-four"), 2);
  assert.equal(countExact(studio, "lock-after-open-five"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(studioMarkup(body), /Claim #1 for/);
  assert.doesNotMatch(studioMarkup(body), /Then the guest site/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-claim-first/);
  assert.doesNotMatch(studioMarkup(body), /data-later-write/);
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
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const lockAfterThreeAt = studio.indexOf("data-lock-after-open-three");
  const lockAfterFourAt = studio.indexOf("data-lock-after-open-four");
  const lockAfterFiveAt = studio.indexOf("data-lock-after-open-five");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const afterLockThreeAt = studio.indexOf("data-open-after-lock-three");
  const afterLockFourAt = studio.indexOf("data-open-after-lock-four");
  const afterLockFiveAt = studio.indexOf("data-open-after-lock-five");
  const openBtnAt = studio.indexOf('class="open-next"');
  const openFormAt = studio.indexOf('action="/host/open"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(lockAfterThreeAt, -1);
  assert.notEqual(lockAfterFourAt, -1);
  assert.notEqual(lockAfterFiveAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(afterLockThreeAt, -1);
  assert.notEqual(afterLockFourAt, -1);
  assert.notEqual(afterLockFiveAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(claimAt < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < deskAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < afterLockFiveAt);
  assert.ok(lockAfterFirstAt < rundownAt);
  assert.ok(claimAt === lockAfterAt || claimAt < lockAfterFirstAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-lock-after-open(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-lock-after-open-first/);
  assert.match(body, /data-lock-after-open-two/);
  assert.match(body, /data-lock-after-open-three/);
  assert.match(body, /data-lock-after-open-four/);
  assert.match(body, /data-lock-after-open-five/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five"/);
  assert.match(body, /data-lock-certain/);
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
  assert.match(body, /data-open-after-lock(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /data-open-after-lock-three/);
  assert.match(body, /data-open-after-lock-four/);
  assert.match(body, /data-open-after-lock-five/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two open-after-lock-three open-after-lock-four open-after-lock-five"/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-claim-locked"), 1);
  assert.equal(countExact(studio, "data-lock-certain"), 1);
  assert.equal(countExact(studio, "data-lock-after-open"), 6);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "lock-after-open-three"), 2);
  assert.equal(countExact(studio, "lock-after-open-four"), 2);
  assert.equal(countExact(studio, "lock-after-open-five"), 2);
  assert.equal(countExact(studio, "data-host-open"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 6);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "open-after-lock-three"), 2);
  assert.equal(countExact(studio, "open-after-lock-four"), 2);
  assert.equal(countExact(studio, "open-after-lock-five"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(studioMarkup(body), /Claim #1 for/);
  assert.doesNotMatch(studioMarkup(body), /Then the guest site/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-claim-first/);
  assert.doesNotMatch(studioMarkup(body), /data-later-write/);
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
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const lockAfterThreeAt = studio.indexOf("data-lock-after-open-three");
  const lockAfterFourAt = studio.indexOf("data-lock-after-open-four");
  const lockAfterFiveAt = studio.indexOf("data-lock-after-open-five");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const afterLockThreeAt = studio.indexOf("data-open-after-lock-three");
  const afterLockFourAt = studio.indexOf("data-open-after-lock-four");
  const afterLockFiveAt = studio.indexOf("data-open-after-lock-five");
  const openBtnAt = studio.indexOf('class="open-next"');
  const openFormAt = studio.indexOf('action="/host/open"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(lockAfterThreeAt, -1);
  assert.notEqual(lockAfterFourAt, -1);
  assert.notEqual(lockAfterFiveAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(afterLockThreeAt, -1);
  assert.notEqual(afterLockFourAt, -1);
  assert.notEqual(afterLockFiveAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(claimAt < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < deskAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < afterLockFiveAt);
  assert.ok(afterLockTwoAt < rundownAt);
  assert.ok(deskAt === afterLockAt || deskAt < afterLockTwoAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-open-after-lock(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /data-open-after-lock-three/);
  assert.match(body, /data-open-after-lock-four/);
  assert.match(body, /data-open-after-lock-five/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two open-after-lock-three open-after-lock-four open-after-lock-five"/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five"/);
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
  assert.equal(countExact(studio, "data-open-after-lock"), 6);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "open-after-lock-three"), 2);
  assert.equal(countExact(studio, "open-after-lock-four"), 2);
  assert.equal(countExact(studio, "open-after-lock-five"), 2);
  assert.equal(countExact(studio, "data-lock-after-open"), 6);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "lock-after-open-three"), 2);
  assert.equal(countExact(studio, "lock-after-open-four"), 2);
  assert.equal(countExact(studio, "lock-after-open-five"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(studioMarkup(body), /Claim #1 for/);
  assert.doesNotMatch(studioMarkup(body), /Then the guest site/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-claim-first/);
  assert.doesNotMatch(studioMarkup(body), /data-later-write/);
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
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const lockAfterThreeAt = studio.indexOf("data-lock-after-open-three");
  const lockAfterFourAt = studio.indexOf("data-lock-after-open-four");
  const lockAfterFiveAt = studio.indexOf("data-lock-after-open-five");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const afterLockThreeAt = studio.indexOf("data-open-after-lock-three");
  const afterLockFourAt = studio.indexOf("data-open-after-lock-four");
  const afterLockFiveAt = studio.indexOf("data-open-after-lock-five");
  const openBtnAt = studio.indexOf('class="open-next"');
  const openFormAt = studio.indexOf('action="/host/open"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(lockAfterThreeAt, -1);
  assert.notEqual(lockAfterFourAt, -1);
  assert.notEqual(lockAfterFiveAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(afterLockThreeAt, -1);
  assert.notEqual(afterLockFourAt, -1);
  assert.notEqual(afterLockFiveAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(claimAt < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < deskAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < afterLockFiveAt);
  assert.ok(lockAfterTwoAt < rundownAt);
  assert.ok(claimAt === lockAfterAt || claimAt < lockAfterTwoAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-lock-after-open(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-lock-after-open-first/);
  assert.match(body, /data-lock-after-open-two/);
  assert.match(body, /data-lock-after-open-three/);
  assert.match(body, /data-lock-after-open-four/);
  assert.match(body, /data-lock-after-open-five/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five"/);
  assert.match(body, /data-lock-certain/);
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
  assert.match(body, /data-open-after-lock(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /data-open-after-lock-three/);
  assert.match(body, /data-open-after-lock-four/);
  assert.match(body, /data-open-after-lock-five/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two open-after-lock-three open-after-lock-four open-after-lock-five"/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-claim-locked"), 1);
  assert.equal(countExact(studio, "data-lock-certain"), 1);
  assert.equal(countExact(studio, "data-lock-after-open"), 6);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "lock-after-open-three"), 2);
  assert.equal(countExact(studio, "lock-after-open-four"), 2);
  assert.equal(countExact(studio, "lock-after-open-five"), 2);
  assert.equal(countExact(studio, "data-host-open"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 6);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "open-after-lock-three"), 2);
  assert.equal(countExact(studio, "open-after-lock-four"), 2);
  assert.equal(countExact(studio, "open-after-lock-five"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(studioMarkup(body), /Claim #1 for/);
  assert.doesNotMatch(studioMarkup(body), /Then the guest site/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-claim-first/);
  assert.doesNotMatch(studioMarkup(body), /data-later-write/);
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

test("GET / after lock concentrates opening the next empty episode after the locked claim is louder", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_open_after_lock_three",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_open_three",
    episodeId: "ep_open_after_lock_three",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  insertListing(db, {
    id: "lst_open_three_veto",
    episodeId: "ep_open_after_lock_three",
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
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const lockAfterThreeAt = studio.indexOf("data-lock-after-open-three");
  const lockAfterFourAt = studio.indexOf("data-lock-after-open-four");
  const lockAfterFiveAt = studio.indexOf("data-lock-after-open-five");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const afterLockThreeAt = studio.indexOf("data-open-after-lock-three");
  const afterLockFourAt = studio.indexOf("data-open-after-lock-four");
  const afterLockFiveAt = studio.indexOf("data-open-after-lock-five");
  const openBtnAt = studio.indexOf('class="open-next"');
  const openFormAt = studio.indexOf('action="/host/open"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(lockAfterThreeAt, -1);
  assert.notEqual(lockAfterFourAt, -1);
  assert.notEqual(lockAfterFiveAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(afterLockThreeAt, -1);
  assert.notEqual(afterLockFourAt, -1);
  assert.notEqual(afterLockFiveAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(claimAt < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < deskAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < afterLockFiveAt);
  assert.ok(afterLockTwoAt < afterLockThreeAt);
  assert.ok(afterLockThreeAt < rundownAt);
  assert.ok(deskAt === afterLockAt || deskAt < afterLockThreeAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-open-after-lock(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /data-open-after-lock-three/);
  assert.match(body, /data-open-after-lock-four/);
  assert.match(body, /data-open-after-lock-five/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two open-after-lock-three open-after-lock-four open-after-lock-five"/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five"/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /Episode 12 is locked\. Open Episode 13 empty\./);
  assert.match(body, /Polar cannot charge on N\+1 until you open it/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_open_three_veto"[^>]*data-vetoed="true"/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-host-open"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 6);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "open-after-lock-three"), 2);
  assert.equal(countExact(studio, "open-after-lock-four"), 2);
  assert.equal(countExact(studio, "open-after-lock-five"), 2);
  assert.equal(countExact(studio, "data-lock-after-open"), 6);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "lock-after-open-three"), 2);
  assert.equal(countExact(studio, "lock-after-open-four"), 2);
  assert.equal(countExact(studio, "lock-after-open-five"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(studioMarkup(body), /Claim #1 for/);
  assert.doesNotMatch(studioMarkup(body), /Then the guest site/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-claim-first/);
  assert.doesNotMatch(studioMarkup(body), /data-later-write/);
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
      "episodeId=ep_open_after_lock_three&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
});

test("GET / after lock concentrates the locked episode after Open N+1 is louder", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_lock_after_open_three",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_lock_three",
    episodeId: "ep_lock_after_open_three",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  insertListing(db, {
    id: "lst_lock_three_veto",
    episodeId: "ep_lock_after_open_three",
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
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const lockAfterThreeAt = studio.indexOf("data-lock-after-open-three");
  const lockAfterFourAt = studio.indexOf("data-lock-after-open-four");
  const lockAfterFiveAt = studio.indexOf("data-lock-after-open-five");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const afterLockThreeAt = studio.indexOf("data-open-after-lock-three");
  const afterLockFourAt = studio.indexOf("data-open-after-lock-four");
  const afterLockFiveAt = studio.indexOf("data-open-after-lock-five");
  const openBtnAt = studio.indexOf('class="open-next"');
  const openFormAt = studio.indexOf('action="/host/open"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(lockAfterThreeAt, -1);
  assert.notEqual(lockAfterFourAt, -1);
  assert.notEqual(lockAfterFiveAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(afterLockThreeAt, -1);
  assert.notEqual(afterLockFourAt, -1);
  assert.notEqual(afterLockFiveAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(claimAt < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < deskAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < afterLockFiveAt);
  assert.ok(lockAfterThreeAt < rundownAt);
  assert.ok(claimAt === lockAfterAt || claimAt < lockAfterThreeAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-lock-after-open(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-lock-after-open-first/);
  assert.match(body, /data-lock-after-open-two/);
  assert.match(body, /data-lock-after-open-three/);
  assert.match(body, /data-lock-after-open-four/);
  assert.match(body, /data-lock-after-open-five/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five"/);
  assert.match(body, /data-lock-certain/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Polar cannot charge/);
  assert.match(body, /The next episode opens empty/);
  assert.match(body, /Prior bids do not carry/);
  assert.match(body, /Unpaid checkout does not rank/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_lock_three_veto"[^>]*data-vetoed="true"/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /data-open-after-lock(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /data-open-after-lock-three/);
  assert.match(body, /data-open-after-lock-four/);
  assert.match(body, /data-open-after-lock-five/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two open-after-lock-three open-after-lock-four open-after-lock-five"/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-claim-locked"), 1);
  assert.equal(countExact(studio, "data-lock-certain"), 1);
  assert.equal(countExact(studio, "data-lock-after-open"), 6);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "lock-after-open-three"), 2);
  assert.equal(countExact(studio, "lock-after-open-four"), 2);
  assert.equal(countExact(studio, "lock-after-open-five"), 2);
  assert.equal(countExact(studio, "data-host-open"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 6);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "open-after-lock-three"), 2);
  assert.equal(countExact(studio, "open-after-lock-four"), 2);
  assert.equal(countExact(studio, "open-after-lock-five"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(studioMarkup(body), /Claim #1 for/);
  assert.doesNotMatch(studioMarkup(body), /Then the guest site/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-claim-first/);
  assert.doesNotMatch(studioMarkup(body), /data-later-write/);
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
      "episodeId=ep_lock_after_open_three&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
});

test("GET / after lock concentrates opening the next empty episode after the locked claim is re-concentrated again", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_open_after_lock_four",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_open_four",
    episodeId: "ep_open_after_lock_four",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  insertListing(db, {
    id: "lst_open_four_veto",
    episodeId: "ep_open_after_lock_four",
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
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const lockAfterThreeAt = studio.indexOf("data-lock-after-open-three");
  const lockAfterFourAt = studio.indexOf("data-lock-after-open-four");
  const lockAfterFiveAt = studio.indexOf("data-lock-after-open-five");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const afterLockThreeAt = studio.indexOf("data-open-after-lock-three");
  const afterLockFourAt = studio.indexOf("data-open-after-lock-four");
  const afterLockFiveAt = studio.indexOf("data-open-after-lock-five");
  const openBtnAt = studio.indexOf('class="open-next"');
  const openFormAt = studio.indexOf('action="/host/open"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(lockAfterThreeAt, -1);
  assert.notEqual(lockAfterFourAt, -1);
  assert.notEqual(lockAfterFiveAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(afterLockThreeAt, -1);
  assert.notEqual(afterLockFourAt, -1);
  assert.notEqual(afterLockFiveAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(claimAt < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < deskAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterThreeAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < afterLockFiveAt);
  assert.ok(afterLockThreeAt < afterLockFourAt);
  assert.ok(afterLockFourAt < rundownAt);
  assert.ok(deskAt === afterLockAt || deskAt < afterLockFourAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-open-after-lock(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /data-open-after-lock-three/);
  assert.match(body, /data-open-after-lock-four/);
  assert.match(body, /data-open-after-lock-five/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two open-after-lock-three open-after-lock-four open-after-lock-five"/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five"/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /Episode 12 is locked\. Open Episode 13 empty\./);
  assert.match(body, /Polar cannot charge on N\+1 until you open it/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_open_four_veto"[^>]*data-vetoed="true"/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-host-open"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 6);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "open-after-lock-three"), 2);
  assert.equal(countExact(studio, "open-after-lock-four"), 2);
  assert.equal(countExact(studio, "open-after-lock-five"), 2);
  assert.equal(countExact(studio, "data-lock-after-open"), 6);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "lock-after-open-three"), 2);
  assert.equal(countExact(studio, "lock-after-open-four"), 2);
  assert.equal(countExact(studio, "lock-after-open-five"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(studioMarkup(body), /Claim #1 for/);
  assert.doesNotMatch(studioMarkup(body), /Then the guest site/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-claim-first/);
  assert.doesNotMatch(studioMarkup(body), /data-later-write/);
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
      "episodeId=ep_open_after_lock_four&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
});

test("GET / after lock concentrates the locked episode after Open N+1 is re-concentrated again", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_lock_after_open_four",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_lock_four",
    episodeId: "ep_lock_after_open_four",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  insertListing(db, {
    id: "lst_lock_four_veto",
    episodeId: "ep_lock_after_open_four",
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
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const lockAfterThreeAt = studio.indexOf("data-lock-after-open-three");
  const lockAfterFourAt = studio.indexOf("data-lock-after-open-four");
  const lockAfterFiveAt = studio.indexOf("data-lock-after-open-five");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const afterLockThreeAt = studio.indexOf("data-open-after-lock-three");
  const afterLockFourAt = studio.indexOf("data-open-after-lock-four");
  const afterLockFiveAt = studio.indexOf("data-open-after-lock-five");
  const openBtnAt = studio.indexOf('class="open-next"');
  const openFormAt = studio.indexOf('action="/host/open"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(lockAfterThreeAt, -1);
  assert.notEqual(lockAfterFourAt, -1);
  assert.notEqual(lockAfterFiveAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(afterLockThreeAt, -1);
  assert.notEqual(afterLockFourAt, -1);
  assert.notEqual(afterLockFiveAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(claimAt < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < deskAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < afterLockFiveAt);
  assert.ok(lockAfterFourAt < rundownAt);
  assert.ok(claimAt === lockAfterAt || claimAt < lockAfterFourAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-lock-after-open(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-lock-after-open-first/);
  assert.match(body, /data-lock-after-open-two/);
  assert.match(body, /data-lock-after-open-three/);
  assert.match(body, /data-lock-after-open-four/);
  assert.match(body, /data-lock-after-open-five/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five"/);
  assert.match(body, /data-lock-certain/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Polar cannot charge/);
  assert.match(body, /The next episode opens empty/);
  assert.match(body, /Prior bids do not carry/);
  assert.match(body, /Unpaid checkout does not rank/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_lock_four_veto"[^>]*data-vetoed="true"/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /data-open-after-lock(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /data-open-after-lock-three/);
  assert.match(body, /data-open-after-lock-four/);
  assert.match(body, /data-open-after-lock-five/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two open-after-lock-three open-after-lock-four open-after-lock-five"/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-claim-locked"), 1);
  assert.equal(countExact(studio, "data-lock-certain"), 1);
  assert.equal(countExact(studio, "data-lock-after-open"), 6);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "lock-after-open-three"), 2);
  assert.equal(countExact(studio, "lock-after-open-four"), 2);
  assert.equal(countExact(studio, "lock-after-open-five"), 2);
  assert.equal(countExact(studio, "data-host-open"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 6);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "open-after-lock-three"), 2);
  assert.equal(countExact(studio, "open-after-lock-four"), 2);
  assert.equal(countExact(studio, "open-after-lock-five"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(studioMarkup(body), /Claim #1 for/);
  assert.doesNotMatch(studioMarkup(body), /Then the guest site/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-claim-first/);
  assert.doesNotMatch(studioMarkup(body), /data-later-write/);
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
      "episodeId=ep_lock_after_open_four&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
});

test("GET / after lock concentrates opening the next empty episode after the locked claim is re-concentrated again, once more", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_open_after_lock_five",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_open_five",
    episodeId: "ep_open_after_lock_five",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  insertListing(db, {
    id: "lst_open_five_veto",
    episodeId: "ep_open_after_lock_five",
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
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const lockAfterThreeAt = studio.indexOf("data-lock-after-open-three");
  const lockAfterFourAt = studio.indexOf("data-lock-after-open-four");
  const lockAfterFiveAt = studio.indexOf("data-lock-after-open-five");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const afterLockThreeAt = studio.indexOf("data-open-after-lock-three");
  const afterLockFourAt = studio.indexOf("data-open-after-lock-four");
  const afterLockFiveAt = studio.indexOf("data-open-after-lock-five");
  const openBtnAt = studio.indexOf('class="open-next"');
  const openFormAt = studio.indexOf('action="/host/open"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(lockAfterThreeAt, -1);
  assert.notEqual(lockAfterFourAt, -1);
  assert.notEqual(lockAfterFiveAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(afterLockThreeAt, -1);
  assert.notEqual(afterLockFourAt, -1);
  assert.notEqual(afterLockFiveAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(claimAt < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < deskAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterThreeAt < afterLockThreeAt);
  assert.ok(lockAfterFourAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < afterLockFiveAt);
  assert.ok(afterLockFourAt < afterLockFiveAt);
  assert.ok(afterLockFiveAt < rundownAt);
  assert.ok(deskAt === afterLockAt || deskAt < afterLockFiveAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-open-after-lock(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /data-open-after-lock-three/);
  assert.match(body, /data-open-after-lock-four/);
  assert.match(body, /data-open-after-lock-five/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two open-after-lock-three open-after-lock-four open-after-lock-five"/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five"/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /Episode 12 is locked\. Open Episode 13 empty\./);
  assert.match(body, /Polar cannot charge on N\+1 until you open it/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_open_five_veto"[^>]*data-vetoed="true"/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-host-open"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 6);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "open-after-lock-three"), 2);
  assert.equal(countExact(studio, "open-after-lock-four"), 2);
  assert.equal(countExact(studio, "open-after-lock-five"), 2);
  assert.equal(countExact(studio, "data-lock-after-open"), 6);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "lock-after-open-three"), 2);
  assert.equal(countExact(studio, "lock-after-open-four"), 2);
  assert.equal(countExact(studio, "lock-after-open-five"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(studioMarkup(body), /Claim #1 for/);
  assert.doesNotMatch(studioMarkup(body), /Then the guest site/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-claim-first/);
  assert.doesNotMatch(studioMarkup(body), /data-later-write/);
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
      "episodeId=ep_open_after_lock_five&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
});

test("GET / after lock concentrates the locked episode after Open N+1 is re-concentrated again, once more", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_lock_after_open_five",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_lock_five",
    episodeId: "ep_lock_after_open_five",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  insertListing(db, {
    id: "lst_lock_five_veto",
    episodeId: "ep_lock_after_open_five",
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
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const lockAfterAt = studio.indexOf("data-lock-after-open");
  const lockAfterFirstAt = studio.indexOf("data-lock-after-open-first");
  const lockAfterTwoAt = studio.indexOf("data-lock-after-open-two");
  const lockAfterThreeAt = studio.indexOf("data-lock-after-open-three");
  const lockAfterFourAt = studio.indexOf("data-lock-after-open-four");
  const lockAfterFiveAt = studio.indexOf("data-lock-after-open-five");
  const deskAt = studio.indexOf("data-host-open");
  const afterLockAt = studio.indexOf("data-open-after-lock");
  const afterLockFirstAt = studio.indexOf("data-open-after-lock-first");
  const afterLockTwoAt = studio.indexOf("data-open-after-lock-two");
  const afterLockThreeAt = studio.indexOf("data-open-after-lock-three");
  const afterLockFourAt = studio.indexOf("data-open-after-lock-four");
  const afterLockFiveAt = studio.indexOf("data-open-after-lock-five");
  const openBtnAt = studio.indexOf('class="open-next"');
  const openFormAt = studio.indexOf('action="/host/open"');
  const rundownAt = studio.indexOf("data-rundown");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(ticketAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockAfterAt, -1);
  assert.notEqual(lockAfterFirstAt, -1);
  assert.notEqual(lockAfterTwoAt, -1);
  assert.notEqual(lockAfterThreeAt, -1);
  assert.notEqual(lockAfterFourAt, -1);
  assert.notEqual(lockAfterFiveAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(afterLockAt, -1);
  assert.notEqual(afterLockFirstAt, -1);
  assert.notEqual(afterLockTwoAt, -1);
  assert.notEqual(afterLockThreeAt, -1);
  assert.notEqual(afterLockFourAt, -1);
  assert.notEqual(afterLockFiveAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(openFormAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.ok(claimAt < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(claimAt < deskAt);
  assert.ok(lockedAt < afterLockAt);
  assert.ok(lockAfterAt < deskAt);
  assert.ok(lockAfterFirstAt < afterLockFirstAt);
  assert.ok(lockAfterFirstAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockTwoAt);
  assert.ok(lockAfterTwoAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockThreeAt);
  assert.ok(lockAfterThreeAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFourAt);
  assert.ok(lockAfterFourAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < afterLockFiveAt);
  assert.ok(lockAfterFiveAt < rundownAt);
  assert.ok(claimAt === lockAfterAt || claimAt < lockAfterFiveAt);
  assert.ok(vetoAt !== -1 && rundownAt < vetoAt);
  assert.match(body, /data-lock-after-open(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-lock-after-open-first/);
  assert.match(body, /data-lock-after-open-two/);
  assert.match(body, /data-lock-after-open-three/);
  assert.match(body, /data-lock-after-open-four/);
  assert.match(body, /data-lock-after-open-five/);
  assert.match(body, /class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five"/);
  assert.match(body, /data-lock-certain/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Polar cannot charge/);
  assert.match(body, /The next episode opens empty/);
  assert.match(body, /Prior bids do not carry/);
  assert.match(body, /Unpaid checkout does not rank/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_lock_five_veto"[^>]*data-vetoed="true"/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /data-open-after-lock(?!-(?:first|two|three|four|five))/);
  assert.match(body, /data-open-after-lock-first/);
  assert.match(body, /data-open-after-lock-two/);
  assert.match(body, /data-open-after-lock-three/);
  assert.match(body, /data-open-after-lock-four/);
  assert.match(body, /data-open-after-lock-five/);
  assert.match(body, /class="host-open open-after-lock-first open-after-lock-two open-after-lock-three open-after-lock-four open-after-lock-five"/);
  assert.match(body, /Guests skip this/);
  assert.equal(countExact(studio, "data-claim-locked"), 1);
  assert.equal(countExact(studio, "data-lock-certain"), 1);
  assert.equal(countExact(studio, "data-lock-after-open"), 6);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 1);
  assert.equal(countExact(studio, "lock-after-open-first"), 2);
  assert.equal(countExact(studio, "lock-after-open-two"), 2);
  assert.equal(countExact(studio, "lock-after-open-three"), 2);
  assert.equal(countExact(studio, "lock-after-open-four"), 2);
  assert.equal(countExact(studio, "lock-after-open-five"), 2);
  assert.equal(countExact(studio, "data-host-open"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock"), 6);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 1);
  assert.equal(countExact(studio, "open-after-lock-first"), 2);
  assert.equal(countExact(studio, "open-after-lock-two"), 2);
  assert.equal(countExact(studio, "open-after-lock-three"), 2);
  assert.equal(countExact(studio, "open-after-lock-four"), 2);
  assert.equal(countExact(studio, "open-after-lock-five"), 2);
  assert.equal(countExact(studio, 'class="open-next"'), 1);
  assert.equal(countExact(studio, 'action="/host/open"'), 1);
  assert.doesNotMatch(body, /href="#host-open-form"/);
  assert.doesNotMatch(body, /href="#claim"/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(studioMarkup(body), /Claim #1 for/);
  assert.doesNotMatch(studioMarkup(body), /Then the guest site/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-claim-first/);
  assert.doesNotMatch(studioMarkup(body), /data-later-write/);
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
      "episodeId=ep_lock_after_open_five&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
});

test("GET / after lock keeps Episode N is locked the first read so Open N+1 and the rundown cannot bury it", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_lock_certain",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    lockedAt: "2026-08-22T12:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_lock_certain",
    episodeId: "ep_lock_certain",
    name: "Booked Co",
    siteUrl: "https://booked.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  insertListing(db, {
    id: "lst_lock_certain_veto",
    episodeId: "ep_lock_certain",
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
  const lockedAt = studio.indexOf("data-claim-locked");
  const lockCertainAt = studio.indexOf("data-lock-certain");
  const lockedTitleAt = studio.indexOf("Episode 12 is locked");
  const ticketAt = studio.indexOf("data-show-ticket");
  const deskAt = studio.indexOf("data-host-open");
  const openNextAt = studio.indexOf("data-open-next");
  const openBtnAt = studio.indexOf('class="open-next"');
  const rundownAt = studio.indexOf("data-rundown");
  const bookedAt = studio.indexOf("Booked Co");
  const vetoAt = studio.indexOf("Hard Sell Co");
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockedAt, -1);
  assert.notEqual(lockCertainAt, -1);
  assert.notEqual(lockedTitleAt, -1);
  assert.notEqual(ticketAt, -1);
  assert.notEqual(deskAt, -1);
  assert.notEqual(openNextAt, -1);
  assert.notEqual(openBtnAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(bookedAt, -1);
  assert.notEqual(vetoAt, -1);
  assert.ok(claimAt < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(lockedTitleAt < ticketAt);
  assert.ok(lockedTitleAt < deskAt);
  assert.ok(lockedTitleAt < openNextAt);
  assert.ok(lockedTitleAt < openBtnAt);
  assert.ok(lockedTitleAt < rundownAt);
  assert.ok(lockedTitleAt < bookedAt);
  assert.ok(claimAt < deskAt);
  assert.ok(deskAt < rundownAt);
  assert.ok(rundownAt < bookedAt);
  assert.ok(rundownAt < vetoAt);
  assert.match(body, /data-lock-certain/);
  assert.match(body, /data-claim-locked/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Polar cannot charge/);
  assert.match(body, /The next episode opens empty/);
  assert.match(body, /Prior bids do not carry/);
  assert.match(body, /Unpaid checkout does not rank/);
  assert.match(body, /Open Episode 13/);
  assert.match(body, /Guests skip this/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_lock_certain_veto"[^>]*data-vetoed="true"/);
  assert.equal(countExact(studio, "data-lock-certain"), 1);
  assert.equal(countExact(studio, "data-claim-locked"), 1);
  assert.equal(countExact(studio, "data-open-next"), 1);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 1);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 1);
  assert.doesNotMatch(studio, /data-guest-prize/);
  assert.doesNotMatch(studio, /data-later-fact/);
  assert.doesNotMatch(studio, /data-empty-honest/);
  assert.match(studio, /class="studio studio-locked"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.match(body, /data-lock-409/);
  assert.equal(countExact(studio, "data-lock-409"), 1);
  assert.doesNotMatch(body, /data-lock-409-first/);
  assert.doesNotMatch(body, /data-lock-409-six/);
  assert.doesNotMatch(body, /data-lock-certain-first/);
  assert.doesNotMatch(body, /data-lock-certain-six/);
  assert.doesNotMatch(body, /lock-after-open-six/);
  assert.doesNotMatch(body, /open-after-lock-six/);
  assert.doesNotMatch(body, /Claim the guest seat for/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, / data-next-seat/);
  assert.doesNotMatch(studioMarkup(body), /Claim #1 for/);
  assert.doesNotMatch(studioMarkup(body), /Then the guest site/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-claim-first/);
  assert.doesNotMatch(studioMarkup(body), /data-later-write/);
  assert.doesNotMatch(body, /Seat is open/);
  assert.doesNotMatch(body, /\$5 takes #1/);
  assert.doesNotMatch(body, /name="bidUsd"/);
  assert.doesNotMatch(body, /class="outbid"/);
  assert.doesNotMatch(body, /action="\/checkout"/);
  assert.doesNotMatch(body, /featured guest/i);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /\.claim\[data-lock-certain\]/);
  assert.match(studioCss, /\.claim\[data-lock-409\]/);
  assert.doesNotMatch(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name/);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_lock_certain&name=Late%20Co&siteUrl=https%3A%2F%2Flate.example%2F&oneLiner=Should%20not%20bid.&bidUsd=20",
  });
  assert.equal(checkout.statusCode, 409);
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
  assert.match(checkout.body, /data-lock-409/);
  assert.doesNotMatch(checkout.body, /data-claim-live/);
  assert.doesNotMatch(checkout.body, /action="\/checkout"/);
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
  const lock409At = studio.indexOf("data-lock-409");
  const lockCertainAt = studio.indexOf("data-lock-certain");
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
  assert.ok(claimAt < ticketAt);
  assert.ok(lock409At < ticketAt);
  assert.ok(lockCertainAt < ticketAt);
  assert.ok(lockedTitleAt < ticketAt);
  assert.ok(lockedTitleAt < rundownAt);
  assert.ok(rundownAt < bookedAt);
  assert.ok(rundownAt < vetoAt);
  assert.match(body, /data-lock-409/);
  assert.match(body, /data-lock-certain/);
  assert.match(body, /data-claim-locked/);
  assert.match(body, /Episode 12 is locked/);
  assert.match(body, /This episode is locked/);
  assert.match(body, /Polar cannot charge/);
  assert.match(body, /Booked Co/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_lock_409_veto"[^>]*data-vetoed="true"/);
  assert.equal(countExact(studio, "data-lock-409"), 1);
  assert.equal(countExact(studio, "data-lock-certain"), 1);
  assert.equal(countExact(studio, "data-claim-locked"), 1);
  assert.doesNotMatch(studio, /data-guest-prize/);
  assert.doesNotMatch(studio, /data-later-fact/);
  assert.doesNotMatch(studio, /data-empty-honest/);
  assert.match(studio, /class="studio studio-locked"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /data-lock-409-first/);
  assert.doesNotMatch(studio, /data-lock-409-six/);
  assert.doesNotMatch(studio, /data-lock-409-after/);
  assert.doesNotMatch(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, /Seat is open/);
  assert.doesNotMatch(body, /\$5 takes #1/);
  assert.doesNotMatch(body, /name="bidUsd"/);
  assert.doesNotMatch(body, /class="outbid"/);
  assert.doesNotMatch(body, /action="\/checkout"/);
  assert.doesNotMatch(body, /featured guest/i);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /\.claim\[data-lock-409\]/);
  assert.match(studioCss, /\.doc\[data-lock-409\] \.empty/);
  assert.match(studioCss, /\.claim\[data-lock-certain\]/);
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
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
  assert.match(checkout.body, /data-lock-409/);
  assert.match(checkout.body, /Checkout did not start/);
  const checkoutDoc = checkout.body.slice(
    checkout.body.indexOf("<article"),
    checkout.body.indexOf("</article>") + "</article>".length,
  );
  assert.match(checkoutDoc, /data-lock-409/);
  assert.match(checkoutDoc, /episode_locked/);
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
  assert.match(body, /Claim #1 for/);
  assert.match(body, /class="claim empty-claim-first"/);
  assert.match(body, /data-first-click="claim"/);
  assert.match(body, /Then the guest site/);
  assert.match(body, /data-later-write/);
  assert.doesNotMatch(body, /Claim Episode 13 for/);
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
  const studio = studioMarkup(body);
  assert.doesNotMatch(studio, /data-host-open/);
  assert.doesNotMatch(studio, /data-host-lock/);
  assert.doesNotMatch(studio, / data-open-next/);
  assert.equal(countExact(studio, "data-open-after-lock"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 0);
  assert.equal(countExact(studio, "open-after-lock-first"), 0);
  assert.equal(countExact(studio, "open-after-lock-two"), 0);
  assert.equal(countExact(studio, "open-after-lock-three"), 0);
  assert.equal(countExact(studio, "open-after-lock-four"), 0);
  assert.equal(countExact(studio, "open-after-lock-five"), 0);
  assert.equal(countExact(studio, "data-lock-certain"), 0);
  assert.equal(countExact(studio, "data-lock-409"), 0);
  assert.match(studio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.equal(countExact(studio, "data-empty-honest"), 3);
  assert.equal(countExact(studio, "data-later-fact"), 0);
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.doesNotMatch(studio, /studio-locked/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /Episode 13 is locked/);
  assert.equal(countExact(studio, "data-lock-after-open"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 0);
  assert.equal(countExact(studio, "lock-after-open-first"), 0);
  assert.equal(countExact(studio, "lock-after-open-two"), 0);
  assert.equal(countExact(studio, "lock-after-open-three"), 0);
  assert.equal(countExact(studio, "lock-after-open-four"), 0);
  assert.equal(countExact(studio, "lock-after-open-five"), 0);
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
  assert.match(body, /Claim #1 for/);
  assert.match(body, /class="claim empty-claim-first"/);
  assert.match(body, /data-empty-claim-first/);
  assert.match(body, /data-first-click="claim"/);
  assert.match(body, /Then the guest site/);
  assert.match(body, /data-later-write/);
  assert.match(body, /name="episodeId"/);
  assert.match(body, /value="5"/);
  assert.match(body, />Outbid<\/button>/);
  assert.doesNotMatch(body, /Claim the guest seat for/);
  assert.match(body, /The guest seat is open/);
  assert.match(body, /Polar can charge/);
  assert.match(body, /\$5 takes #1/);
  assert.match(body, /Seat is open/);
  assert.match(body, /First paid bid of at least \$5 takes #1/);
  assert.match(body, /No paid listings on this episode yet/);
  assert.match(body, /Host veto is on \(default on for guest seat\)/);
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
  assert.equal(countExact(studio, "data-open-after-lock"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 0);
  assert.equal(countExact(studio, "open-after-lock-first"), 0);
  assert.equal(countExact(studio, "open-after-lock-two"), 0);
  assert.equal(countExact(studio, "open-after-lock-three"), 0);
  assert.equal(countExact(studio, "open-after-lock-four"), 0);
  assert.equal(countExact(studio, "open-after-lock-five"), 0);
  assert.equal(countExact(studio, "data-lock-certain"), 0);
  assert.equal(countExact(studio, "data-lock-409"), 0);
  assert.equal(countExact(studio, "data-lock-after-open"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 0);
  assert.equal(countExact(studio, "lock-after-open-first"), 0);
  assert.equal(countExact(studio, "lock-after-open-two"), 0);
  assert.equal(countExact(studio, "lock-after-open-three"), 0);
  assert.equal(countExact(studio, "lock-after-open-four"), 0);
  assert.equal(countExact(studio, "lock-after-open-five"), 0);
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
  const lockCertainAt = studio.indexOf("data-lock-certain");
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
  assert.match(body, /Then the guest site/);
  assert.match(body, /The guest seat is open/);
  assert.match(body, /\$5 takes #1/);
  assert.match(body, /First paid bid of at least \$5 takes #1/);
  assert.match(body, /Polar can charge/);
  assert.match(body, /name="episodeId" value="ep_open_honest"/);
  assert.match(body, /value="5"/);
  assert.match(body, />Outbid<\/button>/);
  assert.match(body, /data-episode-open="true"/);
  assert.match(studio, /class="studio studio-open-empty"/);
  assert.match(studio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.equal(countExact(studio, "data-empty-honest"), 3);
  assert.equal(countExact(studio, "data-lock-certain"), 0);
  assert.equal(countExact(studio, "data-lock-409"), 0);
  assert.equal(countExact(studio, "data-claim-locked"), 0);
  assert.equal(countExact(studio, "data-lock-after-open"), 0);
  assert.equal(countExact(studio, "data-open-after-lock"), 0);
  assert.doesNotMatch(studio, /data-guest-prize/);
  assert.doesNotMatch(studio, /data-later-fact/);
  assert.doesNotMatch(studio, /data-rundown/);
  assert.doesNotMatch(studio, /data-empty-honest-first/);
  assert.doesNotMatch(studio, /data-empty-honest-six/);
  assert.doesNotMatch(studio, /data-empty-honest-after/);
  assert.doesNotMatch(studio, /data-lock-certain/);
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
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-lock-certain\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-lock-409\]/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.empty\.open-seat/);
  assert.match(studioCss, /\.claim\[data-lock-certain\]/);
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
  assert.match(body, /Then the guest site/);
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
  assert.doesNotMatch(studio, /data-lock-certain/);
  assert.doesNotMatch(studio, /data-lock-409/);
  assert.doesNotMatch(studio, /data-lock-after-open/);
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
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-lock-certain\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-lock-409\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-claim-locked\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \[data-host-lock\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \.rundown/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \.guest/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.empty\.open-seat/);
  assert.match(studioCss, /\.studio\.studio-locked \.empty\.open-seat/);
  assert.match(studioCss, /\.studio\.studio-open-empty\[data-empty-honest\] \.empty\.open-seat\[data-empty-honest\]/);
  assert.doesNotMatch(studio, /empty-honest-first/);
  assert.doesNotMatch(studio, /empty-honest-six/);
  assert.doesNotMatch(studio, /lock-after-open-six/);

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
  assert.match(body, /Then the guest site/);
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
  assert.doesNotMatch(studio, /class="guest later-seat"/);
  assert.doesNotMatch(studio, /later-name/);
  assert.doesNotMatch(studio, /class="later-foot"/);
  assert.doesNotMatch(studio, /class="later-facts"/);
  assert.doesNotMatch(studio, /data-rundown/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /data-lock-certain/);
  assert.doesNotMatch(studio, /data-lock-409/);
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
  assert.match(studioCss, /\.studio\.studio-open-empty \[data-guest-prize\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \[data-first-click="guest"\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \[data-later-seat\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \[data-later-go\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \[data-later-foot\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \[data-later-facts\]/);
  assert.match(studioCss, /\.studio\.studio-open-empty \.later-fact/);
  assert.match(studioCss, /\.studio\.studio-open-empty \.later-facts/);
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

test("GET / on a fresh-open empty episode has one first click: Claim #1, then the guest site", async () => {
  const db = memoryDb();
  createEpisode(db, {
    id: "ep_open_one_first",
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
  const claimAt = studio.indexOf('id="claim"');
  const firstClickAt = studio.indexOf('data-first-click="claim"');
  const claimCopyAt = studio.indexOf("Claim #1 for");
  const outbidAt = studio.indexOf(">Outbid</button>");
  const laterWriteAt = studio.indexOf("data-later-write");
  const laterLabelAt = studio.indexOf("Then the guest site");
  const nameAt = studio.indexOf('name="name"');
  const siteAt = studio.indexOf('name="siteUrl"');
  const lineAt = studio.indexOf('name="oneLiner"');
  const guestClickAt = studio.indexOf('data-first-click="guest"');
  assert.notEqual(claimAt, -1);
  assert.notEqual(firstClickAt, -1);
  assert.notEqual(claimCopyAt, -1);
  assert.notEqual(outbidAt, -1);
  assert.notEqual(laterWriteAt, -1);
  assert.notEqual(laterLabelAt, -1);
  assert.notEqual(nameAt, -1);
  assert.notEqual(siteAt, -1);
  assert.notEqual(lineAt, -1);
  assert.ok(firstClickAt > claimAt);
  assert.ok(claimCopyAt > firstClickAt);
  assert.ok(outbidAt > claimCopyAt);
  assert.ok(laterWriteAt > outbidAt);
  assert.ok(laterLabelAt > laterWriteAt);
  assert.ok(nameAt > laterLabelAt);
  assert.ok(siteAt > nameAt);
  assert.ok(lineAt > siteAt);
  assert.equal(guestClickAt, -1);
  assert.equal(countExact(studio, 'data-first-click="claim"'), 1);
  assert.equal(countExact(studio, "data-later-write"), 1);
  assert.equal(countExact(studio, "data-listing-identity"), 1);
  assert.equal(countExact(studio, "data-empty-claim-first"), 1);
  assert.match(studio, /class="claim empty-claim-first"/);
  assert.match(studio, /aria-label="Claim #1"/);
  assert.match(studio, /data-empty-claim/);
  assert.match(body, /Claim #1 for/);
  assert.match(body, /Then the guest site/);
  assert.match(body, /\$5 takes #1/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /data-open-seat/);
  assert.match(body, /data-empty-honest/);
  assert.match(body, /name="episodeId" value="ep_open_one_first"/);
  assert.match(body, />Outbid<\/button>/);
  assert.match(body, /action="\/checkout"/);
  assert.match(body, /placeholder="Name or company"/);
  assert.match(body, /placeholder="https:\/\/your-site"/);
  assert.match(body, /placeholder="One-liner for the host"/);
  assert.doesNotMatch(body, /Claim the guest seat for/);
  assert.doesNotMatch(studio, /class="fields"[^]*class="outbid"/);
  assert.doesNotMatch(studio, /data-first-click="guest"/);
  assert.doesNotMatch(studio, /data-guest-prize/);
  assert.doesNotMatch(studio, /data-later-seat/);
  assert.doesNotMatch(studio, /data-later-foot/);
  assert.doesNotMatch(studio, /data-later-facts/);
  assert.doesNotMatch(studio, /data-later-fact/);
  assert.doesNotMatch(studio, /studio-open-occupied/);
  assert.doesNotMatch(studio, /data-claim-locked/);
  assert.doesNotMatch(studio, /data-lock-certain/);
  assert.doesNotMatch(studio, /data-empty-claim-after/);
  assert.doesNotMatch(studio, /lock-after-open-six/);
  assert.doesNotMatch(body, /featured guest/i);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /Empty open: guest site is a later write after Claim #1 \/ Outbid/);
  assert.match(
    studioCss,
    /\.studio\.studio-open-empty\[data-empty-honest\] \.claim\.empty-claim-first\[data-empty-claim-first\] \.listing-identity\[data-later-write\]/,
  );
  assert.match(
    studioCss,
    /\.studio\.studio-open-empty\[data-empty-honest\] \.claim\.empty-claim-first\[data-empty-claim-first\] \.later-write-label/,
  );
  const laterCss = (
    studioCss.split("Empty open: guest site is a later write after Claim #1 / Outbid", 2)[1] ?? ""
  ).split(".empty[data-empty-honest]")[0] ?? "";
  assert.match(laterCss, /border-top:\s*1px dashed var\(--line\)/);
  assert.match(laterCss, /color:\s*var\(--muted\)/);
  assert.doesNotMatch(laterCss, /background:/);
  assert.doesNotMatch(laterCss, /var\(--lamp\)/);
  assert.doesNotMatch(laterCss, /var\(--on-air\)/);
  assert.doesNotMatch(studioCss, /data-empty-claim-after|data-claim-after-empty|lock-after-open-six/);
  assert.doesNotMatch(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name/);

  const occupied = memoryDb();
  createEpisode(occupied, {
    id: "ep_occupied_one_first",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  insertListing(occupied, {
    id: "lst_ada",
    episodeId: "ep_occupied_one_first",
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
    clicks: 3,
  });
  insertListing(occupied, {
    id: "lst_hold",
    episodeId: "ep_occupied_one_first",
    name: "Hold Co",
    siteUrl: "https://hold.example/",
    oneLiner: "Still listed below #1.",
    bidUsd: 8,
    firstBidAt: "2026-08-22T01:10:00.000Z",
    paidAt: "2026-08-22T01:10:05.000Z",
    clicks: 2,
  });
  insertListing(occupied, {
    id: "lst_veto",
    episodeId: "ep_occupied_one_first",
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
  const occupiedApp = await buildApp({ db: occupied });
  after(() => occupiedApp.close());
  const occupiedBoard = await occupiedApp.inject({ method: "GET", url: "/" });
  assert.equal(occupiedBoard.statusCode, 200);
  const paid = studioMarkup(occupiedBoard.body);
  const paidClaim = paid.slice(paid.indexOf('id="claim"'));
  const paidNameAt = paidClaim.indexOf('name="name"');
  const paidSiteAt = paidClaim.indexOf('name="siteUrl"');
  const paidOutbidAt = paidClaim.indexOf(">Outbid</button>");
  assert.match(paid, /class="studio studio-open-occupied"/);
  assert.match(paid, /data-first-click="guest"/);
  assert.match(paid, /data-guest-prize/);
  assert.match(paid, /data-later-seat/);
  assert.match(paid, /data-later-foot/);
  assert.match(paid, /Hard Sell Co/);
  assert.match(paid, /data-listing-id="lst_veto"[^>]*data-vetoed="true"/);
  assert.match(paid, /Claim the guest seat for/);
  assert.doesNotMatch(paid, /data-empty-claim-first/);
  assert.doesNotMatch(paid, /empty-claim-first/);
  assert.doesNotMatch(paid, /data-first-click="claim"/);
  assert.doesNotMatch(paid, /data-later-write/);
  assert.doesNotMatch(paid, /data-listing-identity/);
  assert.doesNotMatch(paid, /Then the guest site/);
  assert.doesNotMatch(paid, /Claim #1 for/);
  assert.ok(paidNameAt !== -1 && paidSiteAt > paidNameAt);
  assert.ok(paidOutbidAt > paidSiteAt);
  assert.equal(countExact(paid, 'data-first-click="guest"'), 1);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_open_one_first&name=First%20Guest&siteUrl=https%3A%2F%2Ffirst.example%2F&oneLiner=First%20bid%20on%20a%20live%20seat.&bidUsd=5",
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
  assert.match(body, /Claim the guest seat for/);
  assert.match(body, />Outbid</);
  assert.match(body, /action="\/checkout"/);
  assert.match(body, /name="name"/);
  assert.match(body, /name="siteUrl"/);
  assert.match(body, /name="oneLiner"/);
  assert.match(body, /data-claim-live/);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(studioMarkup(body), /data-empty-honest/);
  assert.match(studioMarkup(body), /class="later-facts"[^>]*data-later-facts/);
  assert.match(studioMarkup(body), /class="bid later-fact"[^>]*data-later-fact/);
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
  assert.ok(nameAt < bidAt);
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
  assert.match(body, /Claim the guest seat for/);
  assert.doesNotMatch(studio, /Claim #1 for/);
  assert.doesNotMatch(studio, /Then the guest site/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.match(body, /Hard Sell Co/);
  assert.match(body, /Vetoed: hard sell/);
  assert.match(body, /data-listing-id="lst_veto"[^>]*data-vetoed="true"/);
  assert.equal(countExact(studio, "data-guest-prize"), 1);
  assert.match(adaCard, /class="bid later-fact"[^>]*data-later-fact/);
  assert.doesNotMatch(holdCard, /data-later-fact/);
  assert.doesNotMatch(holdCard, /class="bid later-fact"/);
  assert.doesNotMatch(vetoCard, /data-later-fact/);
  assert.doesNotMatch(vetoCard, /class="bid later-fact"/);
  assert.equal(countAttr(studio, "data-later-fact"), 1);
  assert.equal(countExact(studio, 'class="bid later-fact"'), 1);
  assert.equal(countExact(studio, "data-later-seat"), 1);
  assert.doesNotMatch(studio, /data-lock-certain/);
  assert.doesNotMatch(studio, /data-lock-409/);
  assert.doesNotMatch(studio, /data-empty-honest/);
  assert.match(studio, /class="studio studio-open-occupied"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(body, /downloads/i);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, /This episode is locked/);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.later-facts\[data-later-facts\] \.bid/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.later-facts\[data-later-facts\] \.clicks/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.later-facts\[data-later-facts\] \.bid\.later-fact\[data-later-fact\]/);
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
  assert.ok(nameAt < laterAt);
  assert.ok(laterAt < bidAt);
  assert.ok(nameAt < bidAt);
  assert.ok(bidAt < clicksAt);
  assert.match(adaCard, /data-guest-prize/);
  assert.match(adaCard, /class="guest-name"/);
  assert.match(adaCard, /data-first-click="guest"/);
  assert.match(adaCard, /class="later-facts"[^>]*data-later-facts/);
  assert.match(adaCard, /class="bid later-fact"[^>]*data-later-fact/);
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
  assert.equal(countExact(studio, 'class="bid later-fact"'), 1);
  assert.equal(countExact(studio, "data-later-seat"), 1);
  assert.match(body, /data-claim-live/);
  assert.match(body, /Claim the guest seat for/);
  assert.match(body, />Outbid</);
  assert.match(body, /action="\/checkout"/);
  assert.doesNotMatch(studio, /Claim #1 for/);
  assert.doesNotMatch(studio, /Then the guest site/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.doesNotMatch(studio, /data-lock-certain/);
  assert.doesNotMatch(studio, /data-lock-409/);
  assert.doesNotMatch(studio, /data-empty-honest/);
  assert.match(studio, /class="studio studio-open-occupied"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /data-later-fact-first/);
  assert.doesNotMatch(studio, /data-later-fact-six/);
  assert.doesNotMatch(studio, /lock-after-open-six/);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, /This episode is locked/);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.later-facts\[data-later-facts\] \.bid\.later-fact\[data-later-fact\]/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.later-facts\[data-later-facts\] \.bid\.later-fact\[data-later-fact\]\s*\{[^}]*color:\s*var\(--muted\)/);
  assert.doesNotMatch(
    studioCss,
    /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.later-facts\[data-later-facts\] \.bid\.later-fact\[data-later-fact\]\s*\{[^}]*color:\s*var\(--lamp\)/,
  );
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
  assert.ok(holdBidAt > laterFootAt);
  assert.equal(holdTallyAt, -1);
  assert.equal(holdNameLinkAt, -1);
  assert.match(adaCard, /data-guest-prize/);
  assert.match(studio, /class="guest booked"[^>]*data-listing-id="lst_ada"[^>]*data-guest-prize/);
  assert.match(adaCard, /data-first-click="guest"/);
  assert.match(adaCard, /<h2 class="guest-name"><a href="\/go\/lst_ada" data-first-click="guest">Ada Lovelace<\/a><\/h2>/);
  assert.match(adaCard, /class="later-facts"[^>]*data-later-facts/);
  assert.match(adaCard, /class="bid later-fact"[^>]*data-later-fact/);
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
  assert.equal(countExact(studio, 'class="bid later-fact"'), 1);
  assert.match(studio, /class="studio studio-open-occupied"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /data-empty-honest/);
  assert.doesNotMatch(studio, /data-lock-certain/);
  assert.doesNotMatch(studio, /data-lock-409/);
  assert.doesNotMatch(studio, /data-guest-one-first/);
  assert.doesNotMatch(studio, /data-later-seat-first/);
  assert.doesNotMatch(studio, /data-later-seat-six/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.doesNotMatch(studio, /empty-claim-first/);
  assert.doesNotMatch(studio, /data-first-click="claim"/);
  assert.doesNotMatch(studio, /data-later-write/);
  assert.doesNotMatch(studio, /data-listing-identity/);
  assert.doesNotMatch(studio, /Then the guest site/);
  assert.doesNotMatch(studio, /Claim #1 for/);
  assert.doesNotMatch(studio, /lock-after-open-six/);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);
  assert.doesNotMatch(body, /data-open-seat/);
  assert.doesNotMatch(body, /This episode is locked/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /Claim the guest seat for/);
  assert.match(body, />Outbid</);
  assert.match(body, /action="\/checkout"/);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  const prizeName = studioCss.match(
    /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name\s*\{[^}]*font-size:\s*clamp\(([\d.]+)rem/,
  );
  const laterName = studioCss.match(
    /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.guest-name\.later-name\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterGo = studioCss.match(
    /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\[data-later-foot\] a\.later-go\[data-later-go\],\s*\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\[data-later-foot\] \.bid,\s*\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\[data-later-foot\] \.clicks,\s*\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\[data-later-foot\] \.when\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  assert.ok(prizeName);
  assert.ok(laterName);
  assert.ok(laterGo);
  assert.ok(Number(laterName[1]) < Number(prizeName[1]));
  assert.ok(Number(laterGo[1]) < Number(laterName[1]));
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name a\[data-first-click="guest"\]/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\]/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.guest-name\.later-name/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\[data-later-foot\]/);
  assert.match(
    studioCss,
    /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\[data-later-foot\] a\.later-go\[data-later-go\]/,
  );
  assert.match(
    studioCss,
    /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\[data-later-foot\] a\.later-go\[data-later-go\],[\s\S]*color:\s*var\(--muted\)/,
  );
  assert.doesNotMatch(
    studioCss,
    /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\[data-later-foot\] a\.later-go\[data-later-go\],[\s\S]*\{[^}]*color:\s*var\(--lamp\)/,
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
  assert.ok(adaNameAt < adaBidAt);
  assert.ok(holdNameAt !== -1 && holdFootAt !== -1 && holdGoAt !== -1);
  assert.ok(holdNameAt < holdFootAt);
  assert.ok(holdFootAt < holdGoAt);
  assert.ok(holdGoAt < holdBidAt);
  assert.ok(thirdNameAt !== -1 && thirdFootAt !== -1 && thirdGoAt !== -1);
  assert.ok(thirdNameAt < thirdFootAt);
  assert.ok(thirdFootAt < thirdGoAt);
  assert.ok(thirdGoAt < thirdBidAt);
  assert.match(adaCard, /class="later-facts"[^>]*data-later-facts/);
  assert.match(adaCard, /<h2 class="guest-name"><a href="\/go\/lst_ada" data-first-click="guest">Ada Lovelace<\/a><\/h2>/);
  assert.doesNotMatch(adaCard, /class="tally"/);
  assert.match(adaCard, /<p class="guest-site">example.com\/ada<\/p>/);
  assert.doesNotMatch(adaCard, /class="guest-site"><a href="\/go\/lst_ada"/);
  assert.doesNotMatch(adaCard, /data-later-foot/);
  assert.doesNotMatch(adaCard, /data-later-seat/);
  assert.match(holdCard, /class="later-foot"[^>]*data-later-foot/);
  assert.match(holdCard, /<a class="later-go" href="\/go\/lst_hold" data-later-go>/);
  assert.match(holdCard, /<span class="bid later-bid">\$8<\/span>/);
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
  assert.doesNotMatch(studio, /Then the guest site/);
  assert.doesNotMatch(studio, /data-later-write/);
  assert.doesNotMatch(studio, /Claim #1 for/);
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
  assert.doesNotMatch(studio, /Then the guest site/);
  assert.doesNotMatch(studio, /data-later-write/);
  assert.doesNotMatch(studio, /Claim #1 for/);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);
  assert.match(body, /data-claim-live/);
  assert.match(body, />Outbid</);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\[data-later-foot\]/);
  assert.match(studioCss, /grid-template-areas:\s*"cue person"\s*"foot foot"/);
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
  assert.ok(factsAt < adaBidAt);
  assert.ok(adaBidAt < adaClicksAt);
  assert.equal(adaGoCount, 1);
  assert.match(adaCard, /<h2 class="guest-name"><a href="\/go\/lst_ada" data-first-click="guest">Ada Lovelace<\/a><\/h2>/);
  assert.match(adaCard, /class="later-facts"[^>]*data-later-facts/);
  assert.match(adaCard, /class="bid later-fact"[^>]*data-later-fact/);
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
  assert.match(holdCard, /<span class="bid later-bid">\$8<\/span>/);
  assert.doesNotMatch(thirdCard, /data-later-facts/);
  assert.doesNotMatch(thirdCard, /data-guest-prize/);
  assert.match(thirdCard, /class="later-foot"[^>]*data-later-foot/);
  assert.match(vetoCard, /data-vetoed="true"/);
  assert.match(vetoCard, /Hard Sell Co/);
  assert.match(vetoCard, /Vetoed: hard sell/);
  assert.match(vetoCard, /class="tally"/);
  assert.doesNotMatch(vetoCard, /data-later-facts/);
  assert.doesNotMatch(vetoCard, /data-later-foot/);
  assert.doesNotMatch(studio, /Claim #1 for/);
  assert.doesNotMatch(studio, /Then the guest site/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.doesNotMatch(studio, /data-later-write/);
  assert.doesNotMatch(studio, /data-prize-not-foot/);
  assert.doesNotMatch(studio, /data-later-foot-first/);
  assert.doesNotMatch(studio, /lock-after-open-six/);
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
  assert.match(body, /Claim the guest seat for/);
  assert.match(body, />Outbid</);
  assert.doesNotMatch(body, /featured guest/i);
  assert.doesNotMatch(body, /play count/i);
  const studioCss = body.slice(body.indexOf("<style>"), body.indexOf("</style>"));
  const prizeName = studioCss.match(
    /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.guest-name\s*\{[^}]*font-size:\s*clamp\(([\d.]+)rem/,
  );
  const prizeBid = studioCss.match(
    /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.later-facts\[data-later-facts\] \.bid\.later-fact\[data-later-fact\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterFoot = studioCss.match(
    /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\[data-later-foot\] a\.later-go\[data-later-go\],\s*\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\[data-later-foot\] \.bid,\s*\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\[data-later-foot\] \.clicks,\s*\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\[data-later-foot\] \.when\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  assert.ok(prizeName);
  assert.ok(prizeBid);
  assert.ok(laterFoot);
  assert.ok(Number(prizeBid[1]) < Number(prizeName[1]));
  assert.ok(Number(laterFoot[1]) < Number(prizeName[1]));
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\[data-guest-prize\]\[data-paid-at\] \.later-facts\[data-later-facts\]/);
  assert.match(studioCss, /\.studio\.studio-open-occupied \.guest\.later-seat\[data-later-seat\]\[data-paid-at\] \.later-foot\[data-later-foot\]/);
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
  const outbidAt = studio.indexOf(">Outbid</button>");
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
  assert.ok(ticketAt < claimAt);
  assert.ok(claimAt < rundownAt);
  assert.ok(rundownAt < adaStart);
  assert.ok(adaStart < holdStart);
  assert.ok(holdStart < vetoStart);
  assert.ok(guestClickAt < deskAt);
  assert.ok(vetoStart < deskAt);
  assert.ok(rundownAt < deskAt);
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
  assert.doesNotMatch(studio, /Claim #1 for/);
  assert.doesNotMatch(studio, /Then the guest site/);
  assert.doesNotMatch(studio, /data-later-write/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.doesNotMatch(studio, /data-lock-after-rundown/);
  assert.doesNotMatch(studio, /data-guest-before-lock/);
  assert.doesNotMatch(studio, /lock-after-guest/);
  assert.doesNotMatch(studio, /data-lock-after-guest/);
  assert.doesNotMatch(studio, /lock-after-open-six/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /data-empty-honest/);
  assert.doesNotMatch(studio, /data-lock-certain/);
  assert.doesNotMatch(studio, /data-lock-409/);
  assert.doesNotMatch(studio, /This episode is locked/);
  assert.match(body, /data-claim-live/);
  assert.match(body, /Claim the guest seat for/);
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

test("unpaid stays off the rundown — No #1 guest until Polar reports paid", async () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    id: "ep_unpaid_off",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  const polar = new FixturePolar();
  const app = await buildApp({ db, polar, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());

  const unpaidCheckout = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    },
    payload:
      "episodeId=ep_unpaid_off&name=Ghost%20Guest&siteUrl=https%3A%2F%2Fghost.example%2F&oneLiner=Abandoned%20Polar%20checkout.&bidUsd=99",
  });
  assert.equal(unpaidCheckout.statusCode, 303);
  assert.match(String(unpaidCheckout.headers.location ?? ""), /\/checkout\/complete\?checkoutId=/);

  const leftover = await app.inject({ method: "GET", url: "/" });
  assert.equal(leftover.statusCode, 200);
  const leftoverStudio = studioMarkup(leftover.body);
  assert.match(leftoverStudio, /class="studio studio-open-empty"[^>]*data-empty-honest/);
  assert.match(leftoverStudio, /Claim #1 for/);
  assert.match(leftoverStudio, /data-first-click="claim"/);
  assert.match(leftoverStudio, /Then the guest site/);
  assert.match(leftoverStudio, /data-later-write/);
  assert.match(leftoverStudio, /\$5 takes #1/);
  assert.match(leftoverStudio, /No paid listings/);
  assert.doesNotMatch(leftoverStudio, /Ghost Guest/);
  assert.doesNotMatch(leftoverStudio, /ghost.example/);
  assert.doesNotMatch(leftoverStudio, /Abandoned Polar checkout/);
  assert.doesNotMatch(leftoverStudio, /data-rundown/);
  assert.doesNotMatch(leftoverStudio, /data-guest-prize/);
  assert.doesNotMatch(leftoverStudio, /data-first-click="guest"/);
  assert.doesNotMatch(leftoverStudio, /data-paid-at/);
  assert.doesNotMatch(leftoverStudio, /data-later-seat/);
  assert.doesNotMatch(leftoverStudio, /data-later-foot/);
  assert.doesNotMatch(leftoverStudio, /data-later-facts/);
  assert.doesNotMatch(leftoverStudio, /data-host-lock/);
  assert.doesNotMatch(leftoverStudio, /studio-open-occupied/);
  assert.doesNotMatch(leftoverStudio, /data-unpaid-off/);
  assert.doesNotMatch(leftoverStudio, /lock-after-open-six/);
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
    oneLiner: "Abandoned Polar checkout.",
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
    oneLiner: "Epoch paidAt is not Polar paid.",
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
  assert.ok(ticketAt !== -1 && claimAt > ticketAt);
  assert.ok(rundownAt > claimAt);
  assert.ok(adaStart > rundownAt);
  assert.ok(holdStart > adaStart);
  assert.ok(vetoStart > holdStart);
  assert.ok(deskAt > vetoStart);
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
  assert.doesNotMatch(studio, /Claim #1 for/);
  assert.doesNotMatch(studio, /data-first-click="claim"/);
  assert.doesNotMatch(studio, /data-later-write/);
  assert.doesNotMatch(studio, /data-unpaid-off/);
  assert.doesNotMatch(studio, /lock-after-open-six/);
  assert.equal(countExact(studio, 'data-first-click="guest"'), 1);
  assert.equal(countExact(studio, "data-guest-prize"), 1);
  assert.match(studio, /class="studio studio-open-occupied"/);
  assert.match(occupied.body, /Claim the guest seat for/);
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
  assert.match(lockedStudio, /data-lock-409/);
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
  assert.match(lockedCheckout.body, /data-lock-409/);
  assert.match(lockedCheckout.body, /episode_locked/);
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
  const outbidAt = studio.indexOf("Outbid");
  const rundownAt = studio.indexOf("data-rundown");
  const guestClickAt = studio.indexOf('data-first-click="guest"');
  assert.notEqual(deskAt, -1);
  assert.notEqual(claimAt, -1);
  assert.notEqual(lockBtnAt, -1);
  assert.notEqual(rundownAt, -1);
  assert.notEqual(guestClickAt, -1);
  assert.ok(claimAt < rundownAt);
  assert.ok(guestClickAt < deskAt);
  assert.ok(rundownAt < deskAt);
  assert.ok(outbidAt !== -1 && outbidAt < deskAt);
  assert.ok(lockBtnAt > rundownAt);
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
  assert.match(studio, /class="studio studio-open-occupied"/);
  assert.doesNotMatch(studio, /studio-open-empty/);
  assert.doesNotMatch(studio, /data-host-open/);
  assert.doesNotMatch(studio, /Claim #1 for/);
  assert.doesNotMatch(studio, /Then the guest site/);
  assert.doesNotMatch(studio, /data-empty-claim-first/);
  assert.doesNotMatch(studio, /data-later-write/);
  assert.equal(countExact(studio, "data-open-after-lock"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-first"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-two"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-three"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-four"), 0);
  assert.equal(countExact(studio, "data-open-after-lock-five"), 0);
  assert.equal(countExact(studio, "open-after-lock-first"), 0);
  assert.equal(countExact(studio, "open-after-lock-two"), 0);
  assert.equal(countExact(studio, "open-after-lock-three"), 0);
  assert.equal(countExact(studio, "open-after-lock-four"), 0);
  assert.equal(countExact(studio, "open-after-lock-five"), 0);
  assert.equal(countExact(studio, "data-lock-certain"), 0);
  assert.equal(countExact(studio, "data-lock-409"), 0);
  assert.equal(countExact(studio, "data-empty-honest"), 0);
  assert.equal(countAttr(studio, "data-later-fact"), 1);
  assert.equal(countExact(studio, 'class="bid later-fact"'), 1);
  assert.equal(countExact(studio, "data-lock-after-open"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-first"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-two"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-three"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-four"), 0);
  assert.equal(countExact(studio, "data-lock-after-open-five"), 0);
  assert.equal(countExact(studio, "lock-after-open-first"), 0);
  assert.equal(countExact(studio, "lock-after-open-two"), 0);
  assert.equal(countExact(studio, "lock-after-open-three"), 0);
  assert.equal(countExact(studio, "lock-after-open-four"), 0);
  assert.equal(countExact(studio, "lock-after-open-five"), 0);
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
  assert.match(board.body, /data-lock-certain/);
  assert.match(board.body, /data-lock-409/);
  assert.match(board.body, /Episode 12 is locked/);
  assert.match(board.body, /data-open-after-lock-first/);
  assert.match(board.body, /data-open-after-lock-two/);
  assert.match(board.body, /data-open-after-lock-three/);
  assert.match(board.body, /data-open-after-lock-four/);
  assert.match(board.body, /data-open-after-lock-five/);
  assert.match(board.body, /data-lock-after-open-first/);
  assert.match(board.body, /data-lock-after-open-two/);
  assert.match(board.body, /data-lock-after-open-three/);
  assert.match(board.body, /data-lock-after-open-four/);
  assert.match(board.body, /data-lock-after-open-five/);
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
  assert.match(checkout.body, /episode_locked/);
  assert.match(checkout.body, /Polar did not charge/);
  assert.match(checkout.body, /data-lock-409/);
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
