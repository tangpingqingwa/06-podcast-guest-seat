import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { createEpisode } from "../src/episodes.js";
import {
  claimPaidCheckout,
  createPolarPort,
  startCheckout,
} from "../src/http/routes/checkout.js";
import { listListingsForEpisode } from "../src/listings.js";
import { FixturePolar } from "../src/polar/fixture.js";
import { LivePolar } from "../src/polar/live.js";
import { polarLiveEnabled } from "../src/polar/port.js";
import { rankedListingsForEpisode } from "../src/rank.js";

function memoryDb() {
  const db = openDatabase(":memory:");
  after(() => db.close());
  return db;
}

function guestSeat(db: ReturnType<typeof memoryDb>, id = "ep_12") {
  return createEpisode(db, {
    id,
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
}

async function boardMentions(app: Awaited<ReturnType<typeof buildApp>>, name: string) {
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  return response.body.includes(name);
}

test("createPolarPort is fixture; POLAR_FIXTURE_ONLY=1 wins over POLAR_LIVE", () => {
  assert.equal(polarLiveEnabled({}), false);
  assert.equal(polarLiveEnabled({ POLAR_LIVE: "0" }), false);
  assert.equal(polarLiveEnabled({ POLAR_LIVE: "true" }), false);
  assert.equal(polarLiveEnabled({ POLAR_LIVE: "1" }), true);
  assert.equal(
    polarLiveEnabled({ POLAR_LIVE: "1", POLAR_FIXTURE_ONLY: "1" }),
    false,
  );

  assert.ok(createPolarPort({}) instanceof FixturePolar);
  assert.ok(createPolarPort({ POLAR_LIVE: "0" }) instanceof FixturePolar);
  assert.ok(
    createPolarPort({
      POLAR_LIVE: "1",
      POLAR_FIXTURE_ONLY: "1",
      POLAR_ACCESS_TOKEN: "polar_tok_unused",
    }) instanceof FixturePolar,
  );

  assert.throws(
    () => createPolarPort({ POLAR_LIVE: "1" }),
    /BLOCKED-SECRET: POLAR_ACCESS_TOKEN/,
  );
  assert.throws(
    () =>
      new LivePolar({
        env: { POLAR_LIVE: "1", POLAR_FIXTURE_ONLY: "1", POLAR_ACCESS_TOKEN: "x" },
      }),
    /POLAR_FIXTURE_ONLY/,
  );
  assert.throws(
    () => new LivePolar({ env: {} }),
    /POLAR_LIVE=1/,
  );
  assert.throws(
    () => new LivePolar({ env: { POLAR_LIVE: "1" } }),
    /BLOCKED-SECRET: POLAR_ACCESS_TOKEN/,
  );

  let fetched = false;
  const live = new LivePolar({
    env: { POLAR_LIVE: "1", POLAR_ACCESS_TOKEN: "polar_tok_test" },
    fetch: (async () => {
      fetched = true;
      throw new Error("live Polar must not fetch in tests");
    }) as typeof fetch,
  });
  assert.equal(live.kind, "live");
  assert.equal(fetched, false);
});

test("SPEC 17: POLAR_LIVE unset in test — no live Polar host", () => {
  assert.notEqual(process.env.POLAR_LIVE, "1");
  assert.equal(process.env.POLAR_FIXTURE_ONLY, "1");
  assert.equal(polarLiveEnabled(process.env), false);
  const polar = createPolarPort(process.env);
  assert.equal(polar.kind, "fixture");
  assert.ok(polar instanceof FixturePolar);
});

test("SPEC 16: fixture checkout without network claims rank", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network forbidden in fixture Polar");
  }) as typeof fetch;
  after(() => {
    globalThis.fetch = originalFetch;
  });

  const db = memoryDb();
  const episode = guestSeat(db);
  const polar = new FixturePolar();
  const app = await buildApp({ db, polar });
  after(() => app.close());

  const started = await startCheckout(db, polar, {
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada?utm_source=x",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 5,
  });
  assert.match(started.checkoutId, /^fix_/);
  assert.doesNotMatch(started.url, /https?:\/\//);
  assert.equal(started.kind, "open");
  assert.equal(started.chargeUsd, 5);
  assert.equal(polar.getCheckout(started.checkoutId)?.status, "pending");
  assert.deepEqual(listListingsForEpisode(db, episode.id), []);
  assert.equal(await boardMentions(app, "Ada Lovelace"), false);

  const complete = await app.inject({
    method: "GET",
    url: `/checkout/complete?checkoutId=${encodeURIComponent(started.checkoutId)}`,
  });
  assert.equal(complete.statusCode, 303);
  assert.equal(complete.headers.location, "/");

  const ranked = rankedListingsForEpisode(db, episode.id);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.bidUsd, 5);
  assert.equal(ranked[0]?.name, "Ada Lovelace");
  assert.equal(ranked[0]?.siteUrl, "https://example.com/ada");
  assert.equal(polar.getCheckout(started.checkoutId)?.status, "paid");
  assert.equal(await boardMentions(app, "Ada Lovelace"), true);
});

test("POST /checkout does not publish an unpaid row", async () => {
  const db = memoryDb();
  const episode = guestSeat(db, "ep_unpaid");
  const polar = new FixturePolar();
  const app = await buildApp({ db, polar });
  after(() => app.close());

  const created = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: episode.id,
      name: "Pending Co",
      siteUrl: "https://pending.example/",
      oneLiner: "Should stay off the board until paid.",
      bidUsd: 8,
    },
  });
  assert.equal(created.statusCode, 200);
  const body = created.json() as { checkoutId: string; url: string; kind: string };
  assert.equal(body.kind, "open");
  assert.match(body.checkoutId, /^fix_/);
  assert.doesNotMatch(body.url, /polar/i);
  assert.deepEqual(listListingsForEpisode(db, episode.id), []);
  assert.equal(await boardMentions(app, "Pending Co"), false);

  const abandoned = await app.inject({ method: "GET", url: "/" });
  assert.match(abandoned.body, /No paid listings/);
});

test("fixture raise pays the difference and claims #1 after payment", async () => {
  const db = memoryDb();
  const episode = guestSeat(db, "ep_raise");
  const polar = new FixturePolar();
  const app = await buildApp({ db, polar });
  after(() => app.close());

  const first = await startCheckout(db, polar, {
    episodeId: episode.id,
    name: "Ten Co",
    siteUrl: "https://ten.example/",
    oneLiner: "Opened at ten.",
    bidUsd: 10,
  });
  await polar.completeCheckout(first.checkoutId);
  const ten = polar.getCheckout(first.checkoutId);
  assert.ok(ten);
  claimPaidCheckout(db, { ...ten, status: "paid" }, "2026-08-22T01:00:05.000Z");

  const rival = await startCheckout(db, polar, {
    episodeId: episode.id,
    name: "Twelve Co",
    siteUrl: "https://twelve.example/",
    oneLiner: "Opened at twelve.",
    bidUsd: 12,
  });
  const paidRival = await polar.completeCheckout(rival.checkoutId);
  assert.equal(paidRival.paid, true);
  assert.equal(paidRival.amountUsd, 12);
  const twelve = polar.getCheckout(rival.checkoutId);
  assert.ok(twelve);
  claimPaidCheckout(db, { ...twelve, status: "paid" }, "2026-08-22T02:00:05.000Z");
  assert.equal(rankedListingsForEpisode(db, episode.id)[0]?.bidUsd, 12);
  assert.equal(rankedListingsForEpisode(db, episode.id)[0]?.name, "Twelve Co");

  const raise = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: episode.id,
      name: "Ten Co",
      siteUrl: "https://ten.example/",
      oneLiner: "Opened at ten.",
      bidUsd: 13,
    },
  });
  assert.equal(raise.statusCode, 200);
  const raiseBody = raise.json() as { checkoutId: string; kind: string; chargeUsd: number };
  assert.equal(raiseBody.kind, "raise");
  assert.equal(raiseBody.chargeUsd, 3);
  assert.equal(rankedListingsForEpisode(db, episode.id)[0]?.bidUsd, 12);

  const hook = await app.inject({
    method: "POST",
    url: "/webhooks/polar",
    payload: { checkoutId: raiseBody.checkoutId },
  });
  assert.equal(hook.statusCode, 200);
  assert.equal(hook.json().ok, true);

  const ranked = rankedListingsForEpisode(db, episode.id);
  assert.deepEqual(
    ranked.map((row) => ({ name: row.name, rank: row.rank, bidUsd: row.bidUsd })),
    [
      { name: "Ten Co", rank: 1, bidUsd: 13 },
      { name: "Twelve Co", rank: 2, bidUsd: 12 },
    ],
  );
  assert.equal(ranked[0]?.firstBidAt, "2026-08-22T01:00:05.000Z");
});

test("POST /checkout rejects $4 and never ranks it", async () => {
  const db = memoryDb();
  const episode = guestSeat(db, "ep_low");
  const app = await buildApp({ db });
  after(() => app.close());

  const created = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: episode.id,
      name: "Too Low",
      siteUrl: "https://low.example/",
      oneLiner: "Four dollars is not enough.",
      bidUsd: 4,
    },
  });
  assert.equal(created.statusCode, 400);
  assert.deepEqual(created.json(), { error: "min_bid" });
  assert.deepEqual(listListingsForEpisode(db, episode.id), []);
});

test("unknown checkout webhook is 404 and leaves the board empty", async () => {
  const db = memoryDb();
  guestSeat(db, "ep_hook");
  const app = await buildApp({ db, polar: new FixturePolar() });
  after(() => app.close());

  const missing = await app.inject({
    method: "POST",
    url: "/webhooks/polar",
    payload: { checkoutId: "does-not-exist" },
  });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: "unknown_checkout" });
  const board = await app.inject({ method: "GET", url: "/" });
  assert.match(board.body, /No paid listings/);
});

test("chat and NSFW checkout is rejected before Polar", async () => {
  const db = memoryDb();
  const episode = guestSeat(db, "ep_hygiene");
  const polar = new FixturePolar();
  const app = await buildApp({ db, polar });
  after(() => app.close());

  const discord = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: episode.id,
      name: "Invite",
      siteUrl: "https://discord.gg/guest",
      oneLiner: "Come chat instead of bidding.",
      bidUsd: 5,
    },
  });
  assert.equal(discord.statusCode, 400);
  assert.deepEqual(discord.json(), { error: "chat_link" });

  const nsfw = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: episode.id,
      name: "Adult Co",
      siteUrl: "https://onlyfans.com/guest",
      oneLiner: "Not allowed on this board.",
      bidUsd: 5,
    },
  });
  assert.equal(nsfw.statusCode, 400);
  assert.deepEqual(nsfw.json(), { error: "nsfw" });
  assert.deepEqual(listListingsForEpisode(db, episode.id), []);
});

test("other bidder cannot checkout only the raise difference", async () => {
  const db = memoryDb();
  const episode = guestSeat(db, "ep_identity");
  const polar = new FixturePolar();
  const app = await buildApp({ db, polar });
  after(() => app.close());

  const first = await startCheckout(db, polar, {
    episodeId: episode.id,
    name: "Twelve Co",
    siteUrl: "https://twelve.example/",
    oneLiner: "Opened at twelve.",
    bidUsd: 12,
  });
  await polar.completeCheckout(first.checkoutId);
  const twelve = polar.getCheckout(first.checkoutId);
  assert.ok(twelve);
  claimPaidCheckout(db, { ...twelve, status: "paid" }, "2026-08-22T01:00:05.000Z");

  const steal = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: episode.id,
      listingId: twelve.listingId,
      name: "Rival",
      siteUrl: "https://rival.example/",
      oneLiner: "Tries to pay only the difference.",
      bidUsd: 13,
    },
  });
  assert.equal(steal.statusCode, 400);
  assert.deepEqual(steal.json(), { error: "full_bid_required" });
  assert.equal(rankedListingsForEpisode(db, episode.id).length, 1);
  assert.equal(rankedListingsForEpisode(db, episode.id)[0]?.bidUsd, 12);
});
