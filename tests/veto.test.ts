import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { createEpisode, defaultVetoEnabled, getEpisode } from "../src/episodes.js";
import { DEV_HOST_SESSION_SECRET } from "../src/http/routes/host.js";
import { insertListing, listListingsForEpisode } from "../src/listings.js";
import { rankedListingsForEpisode } from "../src/rank.js";
import {
  bookedGuest,
  isVetoFlagFrozen,
  lockEpisode,
  setVetoEnabled,
  VetoError,
  vetoListing,
} from "../src/veto.js";

function memoryDb() {
  const db = openDatabase(":memory:");
  after(() => db.close());
  return db;
}

function guestSeat(
  db: ReturnType<typeof memoryDb>,
  id = "ep_12",
  vetoEnabled?: boolean,
) {
  return createEpisode(db, {
    id,
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    ...(vetoEnabled === undefined ? {} : { vetoEnabled }),
    opensAt: "2026-08-22T00:00:00.000Z",
  });
}

function sixtySecond(db: ReturnType<typeof memoryDb>, id = "ep_open") {
  return createEpisode(db, {
    id,
    showId: "show_english",
    label: "Episode 12 open",
    seatKind: "sixty_second_open",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
}

function pay(
  db: ReturnType<typeof memoryDb>,
  input: {
    id: string;
    episodeId: string;
    name: string;
    siteUrl: string;
    oneLiner: string;
    bidUsd: number;
    firstBidAt: string;
  },
) {
  return insertListing(db, {
    ...input,
    paidAt: input.firstBidAt,
  });
}

const HOST_HEADERS = {
  authorization: `Bearer ${DEV_HOST_SESSION_SECRET}`,
};

async function hostApp(db: ReturnType<typeof memoryDb>) {
  const app = await buildApp({ db, hostSessionSecret: DEV_HOST_SESSION_SECRET });
  after(() => app.close());
  return app;
}

test("guest_seat default on", () => {
  const db = memoryDb();
  assert.equal(defaultVetoEnabled("guest_seat"), true);
  const episode = guestSeat(db);
  assert.equal(episode.vetoEnabled, true);
  assert.equal(getEpisode(db, episode.id)?.vetoEnabled, true);
});

test("sixty_second_open default off", () => {
  const db = memoryDb();
  assert.equal(defaultVetoEnabled("sixty_second_open"), false);
  const episode = sixtySecond(db);
  assert.equal(episode.vetoEnabled, false);
  assert.equal(getEpisode(db, episode.id)?.vetoEnabled, false);
});

test("SPEC 10: guest-seat episode default flag is vetoEnabled === true", () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  assert.equal(episode.vetoEnabled, true);
});

test("SPEC 11: 60-second episode default flag is vetoEnabled === false", () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    showId: "show_english",
    label: "Episode 12 open",
    seatKind: "sixty_second_open",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
  assert.equal(episode.vetoEnabled, false);
});

test("SPEC 12: Veto #1 on guest seat — next eligible listing books; vetoed row stays visible", async () => {
  const db = memoryDb();
  const episode = guestSeat(db, "ep_veto");
  pay(db, {
    id: "lst_twelve",
    episodeId: episode.id,
    name: "Twelve Co",
    siteUrl: "https://twelve.example/",
    oneLiner: "Opened at twelve.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T02:00:00.000Z",
  });
  pay(db, {
    id: "lst_ten",
    episodeId: episode.id,
    name: "Ten Co",
    siteUrl: "https://ten.example/",
    oneLiner: "Opened at ten.",
    bidUsd: 10,
    firstBidAt: "2026-08-22T01:00:00.000Z",
  });
  assert.equal(rankedListingsForEpisode(db, episode.id)[0]?.id, "lst_twelve");

  const app = await hostApp(db);
  const vetoed = await app.inject({
    method: "POST",
    url: "/host/veto",
    headers: HOST_HEADERS,
    payload: {
      episodeId: episode.id,
      listingId: "lst_twelve",
      reason: "hard sell",
    },
  });
  assert.equal(vetoed.statusCode, 200);
  const body = vetoed.json() as {
    ok: true;
    listing: { id: string; vetoedAt: string | null; vetoReason: string | null };
    booked: { id: string; name: string } | null;
  };
  assert.equal(body.ok, true);
  assert.equal(body.listing.id, "lst_twelve");
  assert.ok(body.listing.vetoedAt);
  assert.equal(body.listing.vetoReason, "hard sell");
  assert.equal(body.booked?.id, "lst_ten");
  assert.equal(body.booked?.name, "Ten Co");

  const ranked = rankedListingsForEpisode(db, episode.id);
  assert.deepEqual(
    ranked.map((row) => ({ id: row.id, rank: row.rank, bidUsd: row.bidUsd })),
    [{ id: "lst_ten", rank: 1, bidUsd: 10 }],
  );
  const visible = listListingsForEpisode(db, episode.id);
  const vetoRow = visible.find((row) => row.id === "lst_twelve");
  assert.ok(vetoRow);
  assert.ok(vetoRow.vetoedAt);
  assert.equal(vetoRow.vetoReason, "hard sell");
  assert.equal(visible.length, 2);

  const board = await app.inject({ method: "GET", url: "/" });
  assert.equal(board.statusCode, 200);
  assert.match(board.body, /Twelve Co/);
  assert.match(board.body, /Vetoed: hard sell/);
  assert.match(board.body, /Ten Co/);
  assert.match(board.body, /data-vetoed="true"/);
  assert.doesNotMatch(board.body, /data-listing-id="lst_twelve"[^>]*data-rank="1"/);

  const locked = lockEpisode(db, episode.id, "2026-08-22T04:00:00.000Z");
  assert.equal(locked.episode.lockedAt, "2026-08-22T04:00:00.000Z");
  assert.equal(locked.booked?.id, "lst_ten");
  assert.equal(bookedGuest(db, episode.id)?.id, "lst_ten");
});

test("SPEC 13: Veto when flag off is 403 / documented error", async () => {
  const db = memoryDb();
  const episode = sixtySecond(db, "ep_off");
  pay(db, {
    id: "lst_open",
    episodeId: episode.id,
    name: "Open Co",
    siteUrl: "https://open.example/",
    oneLiner: "Sixty-second default is no veto.",
    bidUsd: 8,
    firstBidAt: "2026-08-22T01:00:00.000Z",
  });

  const app = await hostApp(db);
  const rejected = await app.inject({
    method: "POST",
    url: "/host/veto",
    headers: HOST_HEADERS,
    payload: {
      episodeId: episode.id,
      listingId: "lst_open",
      reason: "not a fit",
    },
  });
  assert.equal(rejected.statusCode, 403);
  assert.deepEqual(rejected.json(), { error: "veto_disabled" });
  assert.equal(listListingsForEpisode(db, episode.id)[0]?.vetoedAt, null);
  assert.equal(rankedListingsForEpisode(db, episode.id)[0]?.id, "lst_open");

  assert.throws(
    () =>
      vetoListing(db, {
        episodeId: episode.id,
        listingId: "lst_open",
        reason: "not a fit",
      }),
    (err: unknown) =>
      err instanceof VetoError &&
      err.code === "veto_disabled" &&
      err.statusCode === 403,
  );
});

test("host session can veto when the flag is on", async () => {
  const db = memoryDb();
  const episode = guestSeat(db, "ep_session");
  pay(db, {
    id: "lst_ada",
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 5,
    firstBidAt: "2026-08-22T01:00:00.000Z",
  });

  const app = await hostApp(db);
  const missing = await app.inject({
    method: "POST",
    url: "/host/veto",
    payload: {
      episodeId: episode.id,
      listingId: "lst_ada",
      reason: "off topic",
    },
  });
  assert.equal(missing.statusCode, 401);
  assert.deepEqual(missing.json(), { error: "unauthorized" });

  const wrong = await app.inject({
    method: "POST",
    url: "/host/veto",
    headers: { authorization: "Bearer not-the-host" },
    payload: {
      episodeId: episode.id,
      listingId: "lst_ada",
      reason: "off topic",
    },
  });
  assert.equal(wrong.statusCode, 401);

  const viaHeader = await app.inject({
    method: "POST",
    url: "/host/veto",
    headers: { "x-host-session": DEV_HOST_SESSION_SECRET },
    payload: {
      episodeId: episode.id,
      listingId: "lst_ada",
      reason: "off topic",
    },
  });
  assert.equal(viaHeader.statusCode, 200);
  assert.equal(viaHeader.json().listing.vetoReason, "off topic");
});

test("veto flag is frozen after the first paid bid", async () => {
  const db = memoryDb();
  const episode = guestSeat(db, "ep_freeze");
  assert.equal(isVetoFlagFrozen(db, episode.id), false);

  const flipped = setVetoEnabled(db, episode.id, false);
  assert.equal(flipped.vetoEnabled, false);
  const restored = setVetoEnabled(db, episode.id, true);
  assert.equal(restored.vetoEnabled, true);

  pay(db, {
    id: "lst_paid",
    episodeId: episode.id,
    name: "Paid Co",
    siteUrl: "https://paid.example/",
    oneLiner: "First paid bid freezes the flag.",
    bidUsd: 5,
    firstBidAt: "2026-08-22T01:00:00.000Z",
  });
  assert.equal(isVetoFlagFrozen(db, episode.id), true);

  assert.throws(
    () => setVetoEnabled(db, episode.id, false),
    (err: unknown) =>
      err instanceof VetoError && err.code === "veto_flag_frozen",
  );
  assert.equal(getEpisode(db, episode.id)?.vetoEnabled, true);

  const app = await hostApp(db);
  const frozen = await app.inject({
    method: "POST",
    url: "/host/veto-enabled",
    headers: HOST_HEADERS,
    payload: { episodeId: episode.id, vetoEnabled: false },
  });
  assert.equal(frozen.statusCode, 409);
  assert.deepEqual(frozen.json(), { error: "veto_flag_frozen" });
  assert.equal(getEpisode(db, episode.id)?.vetoEnabled, true);
});

test("lock freezes the episode; booked guest is highest remaining eligible bid", async () => {
  const db = memoryDb();
  const episode = guestSeat(db, "ep_lock");
  pay(db, {
    id: "lst_high",
    episodeId: episode.id,
    name: "High Co",
    siteUrl: "https://high.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 15,
    firstBidAt: "2026-08-22T02:00:00.000Z",
  });
  pay(db, {
    id: "lst_low",
    episodeId: episode.id,
    name: "Low Co",
    siteUrl: "https://low.example/",
    oneLiner: "Stays below after lock.",
    bidUsd: 6,
    firstBidAt: "2026-08-22T01:00:00.000Z",
  });

  const app = await hostApp(db);
  const locked = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: HOST_HEADERS,
    payload: { episodeId: episode.id },
  });
  assert.equal(locked.statusCode, 200);
  const body = locked.json() as {
    ok: true;
    episode: { id: string; lockedAt: string | null };
    booked: { id: string; bidUsd: number } | null;
  };
  assert.equal(body.ok, true);
  assert.equal(body.episode.id, episode.id);
  assert.ok(body.episode.lockedAt);
  assert.equal(body.booked?.id, "lst_high");
  assert.equal(body.booked?.bidUsd, 15);
  assert.ok(getEpisode(db, episode.id)?.lockedAt);

  const again = await app.inject({
    method: "POST",
    url: "/host/lock",
    headers: HOST_HEADERS,
    payload: { episodeId: episode.id },
  });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().booked.id, "lst_high");

  const vetoAfter = await app.inject({
    method: "POST",
    url: "/host/veto",
    headers: HOST_HEADERS,
    payload: {
      episodeId: episode.id,
      listingId: "lst_high",
      reason: "too late",
    },
  });
  assert.equal(vetoAfter.statusCode, 409);
  assert.deepEqual(vetoAfter.json(), { error: "episode_locked" });
  assert.equal(listListingsForEpisode(db, episode.id)[0]?.vetoedAt, null);

  const checkout = await app.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      episodeId: episode.id,
      name: "Late Co",
      siteUrl: "https://late.example/",
      oneLiner: "Should not bid after lock.",
      bidUsd: 20,
    },
  });
  assert.equal(checkout.statusCode, 409);
  assert.deepEqual(checkout.json(), { error: "episode_locked" });
  assert.equal(bookedGuest(db, episode.id)?.id, "lst_high");
});

test("lock after veto books the next eligible listing, not the vetoed row", async () => {
  const db = memoryDb();
  const episode = guestSeat(db, "ep_book");
  pay(db, {
    id: "lst_veto_me",
    episodeId: episode.id,
    name: "Veto Me Co",
    siteUrl: "https://vetome.example/",
    oneLiner: "Highest bid, then vetoed.",
    bidUsd: 20,
    firstBidAt: "2026-08-22T01:00:00.000Z",
  });
  pay(db, {
    id: "lst_book_me",
    episodeId: episode.id,
    name: "Book Me Co",
    siteUrl: "https://bookme.example/",
    oneLiner: "Highest remaining eligible bid.",
    bidUsd: 9,
    firstBidAt: "2026-08-22T02:00:00.000Z",
  });

  vetoListing(db, {
    episodeId: episode.id,
    listingId: "lst_veto_me",
    reason: "off brand",
    at: "2026-08-22T03:00:00.000Z",
  });
  const locked = lockEpisode(db, episode.id, "2026-08-22T04:00:00.000Z");
  assert.equal(locked.booked?.id, "lst_book_me");
  assert.equal(locked.booked?.bidUsd, 9);

  const stillThere = listListingsForEpisode(db, episode.id).find(
    (row) => row.id === "lst_veto_me",
  );
  assert.ok(stillThere);
  assert.equal(stillThere.vetoReason, "off brand");
  assert.equal(stillThere.vetoedAt, "2026-08-22T03:00:00.000Z");
});

test("guest-seat flag can be flipped off only before the first paid bid", async () => {
  const db = memoryDb();
  const episode = guestSeat(db, "ep_flip");
  const app = await hostApp(db);
  const flipped = await app.inject({
    method: "POST",
    url: "/host/veto-enabled",
    headers: HOST_HEADERS,
    payload: { episodeId: episode.id, vetoEnabled: false },
  });
  assert.equal(flipped.statusCode, 200);
  assert.equal(flipped.json().episode.vetoEnabled, false);

  pay(db, {
    id: "lst_after",
    episodeId: episode.id,
    name: "After Flip",
    siteUrl: "https://after.example/",
    oneLiner: "Flag was off before this bid.",
    bidUsd: 5,
    firstBidAt: "2026-08-22T01:00:00.000Z",
  });
  const rejected = await app.inject({
    method: "POST",
    url: "/host/veto",
    headers: HOST_HEADERS,
    payload: {
      episodeId: episode.id,
      listingId: "lst_after",
      reason: "too late to enable",
    },
  });
  assert.equal(rejected.statusCode, 403);
  assert.deepEqual(rejected.json(), { error: "veto_disabled" });
});

test("empty veto reason is rejected and does not hide the row", () => {
  const db = memoryDb();
  const episode = guestSeat(db, "ep_reason");
  pay(db, {
    id: "lst_reason",
    episodeId: episode.id,
    name: "Reason Co",
    siteUrl: "https://reason.example/",
    oneLiner: "Needs a public reason.",
    bidUsd: 7,
    firstBidAt: "2026-08-22T01:00:00.000Z",
  });
  assert.throws(
    () =>
      vetoListing(db, {
        episodeId: episode.id,
        listingId: "lst_reason",
        reason: "   ",
      }),
    (err: unknown) => err instanceof VetoError && err.code === "invalid_reason",
  );
  assert.equal(
    listListingsForEpisode(db, episode.id)[0]?.vetoedAt,
    null,
  );
});
