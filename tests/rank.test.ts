import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { openDatabase } from "../src/db.js";
import { createEpisode } from "../src/episodes.js";
import { insertListing, type Listing } from "../src/listings.js";
import {
  applyPaidOpen,
  applyPaidRaise,
  isPaidListing,
  livePaidListings,
  MIN_BID_USD,
  paidListings,
  quoteCompetingBid,
  quoteOpenBid,
  quoteRaise,
  RankError,
  rankListings,
  rankedListingsForEpisode,
  type RankableListing,
} from "../src/rank.js";

// Keep default-now raise paths inside the rolling window for fixed fixtures.
const TEST_NOW = new Date("2026-08-27T12:00:00.000Z");
mock.timers.enable({ apis: ["Date"], now: TEST_NOW });
after(() => mock.timers.reset());

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

function paidListing(
  partial: Partial<Listing> &
    Pick<Listing, "id" | "episodeId" | "bidUsd" | "firstBidAt">,
): Listing {
  return {
    name: partial.name ?? `Guest ${partial.id}`,
    siteUrl: partial.siteUrl ?? `https://${partial.id}.example/`,
    oneLiner: partial.oneLiner ?? `One-liner ${partial.id}`,
    paidAt: partial.paidAt ?? partial.firstBidAt,
    clicks: partial.clicks ?? 0,
    vetoedAt: partial.vetoedAt ?? null,
    vetoReason: partial.vetoReason ?? null,
    ...partial,
  };
}

test("SPEC 1: first bid $5 on empty guest-seat episode is rank #1 after payment", () => {
  const db = memoryDb();
  const episode = guestSeat(db);

  const quote = quoteOpenBid(MIN_BID_USD);
  assert.deepEqual(quote, { kind: "open", chargeUsd: 5, nextUsd: 5 });

  const { listing, chargeUsd } = applyPaidOpen(db, {
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 5,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });

  assert.equal(chargeUsd, 5);
  assert.equal(listing.bidUsd, 5);
  const ranked = rankedListingsForEpisode(db, episode.id);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.id, listing.id);
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.bidUsd, 5);
});

test("SPEC 2: bid $4 is rejected (min $5)", () => {
  const db = memoryDb();
  const episode = guestSeat(db);

  assert.throws(
    () => quoteOpenBid(4),
    (err: unknown) => err instanceof RankError && err.code === "min_bid",
  );
  assert.throws(
    () =>
      applyPaidOpen(db, {
        episodeId: episode.id,
        name: "Too Low",
        siteUrl: "https://low.example/",
        oneLiner: "Four dollars is not enough.",
        bidUsd: 4,
        firstBidAt: "2026-08-22T01:00:00.000Z",
        paidAt: "2026-08-22T01:00:05.000Z",
      }),
    (err: unknown) => err instanceof RankError && err.code === "min_bid",
  );
  assert.deepEqual(rankedListingsForEpisode(db, episode.id), []);
});

test("SPEC 3: two listings, $10 then $12 — $12 is #1", () => {
  const db = memoryDb();
  const episode = guestSeat(db);

  applyPaidOpen(db, {
    id: "lst_ten",
    episodeId: episode.id,
    name: "Ten Co",
    siteUrl: "https://ten.example/",
    oneLiner: "Opened at ten.",
    bidUsd: 10,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  applyPaidOpen(db, {
    id: "lst_twelve",
    episodeId: episode.id,
    name: "Twelve Co",
    siteUrl: "https://twelve.example/",
    oneLiner: "Opened at twelve.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T02:00:00.000Z",
    paidAt: "2026-08-22T02:00:05.000Z",
  });

  const ranked = rankedListingsForEpisode(db, episode.id);
  assert.deepEqual(
    ranked.map((row) => ({ id: row.id, rank: row.rank, bidUsd: row.bidUsd })),
    [
      { id: "lst_twelve", rank: 1, bidUsd: 12 },
      { id: "lst_ten", rank: 2, bidUsd: 10 },
    ],
  );
});

test("SPEC 4: two listings both $10 — older firstBidAt is #1", () => {
  const ranked = rankListings([
    paidListing({
      id: "lst_newer",
      episodeId: "ep_12",
      bidUsd: 10,
      firstBidAt: "2026-08-22T02:00:00.000Z",
      clicks: 99,
    }),
    paidListing({
      id: "lst_older",
      episodeId: "ep_12",
      bidUsd: 10,
      firstBidAt: "2026-08-22T01:00:00.000Z",
      clicks: 0,
    }),
  ]);

  assert.equal(ranked[0]?.id, "lst_older");
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[1]?.id, "lst_newer");
  assert.equal(ranked[1]?.rank, 2);
});

test("SPEC 5: raise own $10 to $13 when #1 is $12 — pay $3; become #1", () => {
  const db = memoryDb();
  const episode = guestSeat(db);

  applyPaidOpen(db, {
    id: "lst_ten",
    episodeId: episode.id,
    name: "Ten Co",
    siteUrl: "https://ten.example/",
    oneLiner: "Opened at ten.",
    bidUsd: 10,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  applyPaidOpen(db, {
    id: "lst_twelve",
    episodeId: episode.id,
    name: "Twelve Co",
    siteUrl: "https://twelve.example/",
    oneLiner: "Opened at twelve.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T02:00:00.000Z",
    paidAt: "2026-08-22T02:00:05.000Z",
  });

  const quote = quoteRaise(
    { id: "lst_ten", bidUsd: 10 },
    13,
    rankedListingsForEpisode(db, episode.id),
    episode.id,
  );
  assert.deepEqual(quote, { kind: "raise", chargeUsd: 3, nextUsd: 13 });

  const raised = applyPaidRaise(db, {
    episodeId: episode.id,
    siteUrl: "https://ten.example/",
    newTotalUsd: 13,
    paidAt: "2026-08-22T03:00:00.000Z",
  });
  assert.equal(raised.chargeUsd, 3);
  assert.equal(raised.listing.bidUsd, 13);
  assert.equal(raised.listing.firstBidAt, "2026-08-22T01:00:00.000Z");
  assert.equal(raised.listing.id, "lst_ten");

  const ranked = rankedListingsForEpisode(db, episode.id);
  assert.deepEqual(
    ranked.map((row) => ({ id: row.id, rank: row.rank, bidUsd: row.bidUsd })),
    [
      { id: "lst_ten", rank: 1, bidUsd: 13 },
      { id: "lst_twelve", rank: 2, bidUsd: 12 },
    ],
  );
});

test("SPEC 6: other bidder cannot pay only the $1 difference", () => {
  const db = memoryDb();
  const episode = guestSeat(db);

  applyPaidOpen(db, {
    id: "lst_twelve",
    episodeId: episode.id,
    name: "Twelve Co",
    siteUrl: "https://twelve.example/",
    oneLiner: "Opened at twelve.",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });

  assert.throws(
    () => quoteCompetingBid(1),
    (err: unknown) => err instanceof RankError && err.code === "min_bid",
  );
  assert.throws(
    () =>
      applyPaidOpen(db, {
        episodeId: episode.id,
        name: "Rival",
        siteUrl: "https://rival.example/",
        oneLiner: "Tries to pay only the difference.",
        bidUsd: 1,
        firstBidAt: "2026-08-22T02:00:00.000Z",
        paidAt: "2026-08-22T02:00:05.000Z",
      }),
    (err: unknown) => err instanceof RankError && err.code === "min_bid",
  );
  assert.throws(
    () =>
      applyPaidRaise(db, {
        episodeId: episode.id,
        listingId: "lst_twelve",
        siteUrl: "https://rival.example/",
        newTotalUsd: 13,
        paidAt: "2026-08-22T02:00:05.000Z",
      }),
    (err: unknown) =>
      err instanceof RankError && err.code === "full_bid_required",
  );
  assert.throws(
    () =>
      applyPaidRaise(db, {
        episodeId: episode.id,
        siteUrl: "https://rival.example/",
        newTotalUsd: 13,
        paidAt: "2026-08-22T02:00:05.000Z",
      }),
    (err: unknown) =>
      err instanceof RankError && err.code === "full_bid_required",
  );

  const full = quoteCompetingBid(13);
  assert.deepEqual(full, { kind: "open", chargeUsd: 13, nextUsd: 13 });
  assert.equal(full.chargeUsd, 13);

  const ranked = rankedListingsForEpisode(db, episode.id);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.id, "lst_twelve");
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.bidUsd, 12);
});

test("equal firstBidAt falls back to id ASC", () => {
  const ranked = rankListings([
    paidListing({
      id: "b",
      episodeId: "ep_12",
      bidUsd: 10,
      firstBidAt: "2026-08-22T01:00:00.000Z",
    }),
    paidListing({
      id: "a",
      episodeId: "ep_12",
      bidUsd: 10,
      firstBidAt: "2026-08-22T01:00:00.000Z",
    }),
  ]);
  assert.deepEqual(
    ranked.map((row) => row.id),
    ["a", "b"],
  );
});

test("unpaid and vetoed rows do not take rank", () => {
  const ranked = rankListings([
    paidListing({
      id: "lst_paid",
      episodeId: "ep_12",
      bidUsd: 5,
      firstBidAt: "2026-08-22T03:00:00.000Z",
    }),
    {
      ...paidListing({
        id: "lst_unpaid",
        episodeId: "ep_12",
        bidUsd: 40,
        firstBidAt: "2026-08-22T01:00:00.000Z",
      }),
      paidAt: "",
    } satisfies RankableListing,
    paidListing({
      id: "lst_vetoed",
      episodeId: "ep_12",
      bidUsd: 30,
      firstBidAt: "2026-08-22T02:00:00.000Z",
      vetoedAt: "2026-08-22T04:00:00.000Z",
      vetoReason: "hard sell",
    }),
  ]);
  assert.deepEqual(
    ranked.map((row) => ({ id: row.id, rank: row.rank })),
    [{ id: "lst_paid", rank: 1 }],
  );
});

test("unpaid stays off the rundown — No #1 guest until Waffo reports paid", () => {
  const unpaid = {
    ...paidListing({
      id: "lst_unpaid",
      episodeId: "ep_12",
      name: "Ghost Guest",
      siteUrl: "https://ghost.example/",
      oneLiner: "Abandoned Waffo checkout.",
      bidUsd: 99,
      firstBidAt: "2026-08-22T01:00:00.000Z",
    }),
    paidAt: "",
  } satisfies RankableListing;
  const abandoned = {
    ...paidListing({
      id: "lst_abandoned",
      episodeId: "ep_12",
      name: "Vapor Co",
      siteUrl: "https://vapor.example/",
      oneLiner: "Epoch paidAt is not Waffo paid.",
      bidUsd: 80,
      firstBidAt: "2026-08-22T01:30:00.000Z",
    }),
    paidAt: "1970-01-01T00:00:00.000Z",
  } satisfies RankableListing;
  const paid = paidListing({
    id: "lst_paid_only",
    episodeId: "ep_12",
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 5,
    firstBidAt: "2026-08-22T03:00:00.000Z",
    paidAt: "2026-08-22T03:00:05.000Z",
  });
  const vetoed = paidListing({
    id: "lst_vetoed",
    episodeId: "ep_12",
    name: "Hard Sell Co",
    siteUrl: "https://hardsell.example/",
    oneLiner: "Buy my course on air.",
    bidUsd: 20,
    firstBidAt: "2026-08-22T00:30:00.000Z",
    paidAt: "2026-08-22T00:30:05.000Z",
    vetoedAt: "2026-08-22T04:00:00.000Z",
    vetoReason: "hard sell",
  });

  assert.equal(isPaidListing(unpaid), false);
  assert.equal(isPaidListing(abandoned), false);
  assert.equal(isPaidListing(paid), true);
  assert.equal(isPaidListing(vetoed), true);
  assert.deepEqual(
    paidListings([unpaid, abandoned, paid, vetoed]).map((row) => row.id),
    ["lst_paid_only", "lst_vetoed"],
  );
  assert.deepEqual(rankListings([unpaid, abandoned]), []);
  const mixed = rankListings([unpaid, abandoned, paid, vetoed]);
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0]?.id, "lst_paid_only");
  assert.equal(mixed[0]?.rank, 1);
  assert.doesNotMatch(
    mixed.map((row) => row.id).join(","),
    /lst_unpaid|lst_abandoned/,
  );
});

test("rankListings does not mutate the input and stays per episode", () => {
  const rows = [
    paidListing({
      id: "lst_here",
      episodeId: "ep_12",
      bidUsd: 5,
      firstBidAt: "2026-08-22T01:00:00.000Z",
    }),
    paidListing({
      id: "lst_there",
      episodeId: "ep_13",
      bidUsd: 50,
      firstBidAt: "2026-08-22T01:00:00.000Z",
    }),
  ];
  const before = rows.map((row) => row.id);
  const ranked = rankListings(rows, "ep_12");
  assert.deepEqual(
    rows.map((row) => row.id),
    before,
  );
  assert.deepEqual(
    ranked.map((row) => row.id),
    ["lst_here"],
  );
});

test("SQLite raise keeps firstBidAt; insertListing rows still rank", () => {
  const db = memoryDb();
  const episode = guestSeat(db, "ep_sqlite");
  insertListing(db, {
    id: "lst_seed",
    episodeId: episode.id,
    name: "Seeded",
    siteUrl: "https://seed.example/",
    oneLiner: "Inserted by tests.",
    bidUsd: 8,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });

  const raised = applyPaidRaise(db, {
    episodeId: episode.id,
    listingId: "lst_seed",
    siteUrl: "https://seed.example/",
    newTotalUsd: 9,
    paidAt: "2026-08-22T02:00:00.000Z",
  });
  assert.equal(raised.chargeUsd, 1);
  assert.equal(raised.listing.firstBidAt, "2026-08-22T01:00:00.000Z");
  assert.equal(rankedListingsForEpisode(db, episode.id)[0]?.rank, 1);
});

test("rankListings uses only the rolling last-7-days paidAt window", () => {
  const now = new Date("2026-08-24T00:00:00.000Z");
  const ranked = rankListings(
    [
      paidListing({
        id: "lst_then",
        episodeId: "ep_12",
        bidUsd: 99,
        firstBidAt: "2026-08-16T23:59:59.000Z",
        paidAt: "2026-08-16T23:59:59.000Z",
      }),
      paidListing({
        id: "lst_now",
        episodeId: "ep_12",
        bidUsd: 5,
        firstBidAt: "2026-08-17T00:00:00.000Z",
        paidAt: "2026-08-17T00:00:00.000Z",
      }),
    ],
    "ep_12",
    now,
  );
  assert.deepEqual(
    ranked.map((row) => ({ id: row.id, rank: row.rank, bidUsd: row.bidUsd })),
    [{ id: "lst_now", rank: 1, bidUsd: 5 }],
  );
  assert.deepEqual(
    livePaidListings(
      [
        paidListing({
          id: "lst_then",
          episodeId: "ep_12",
          bidUsd: 99,
          firstBidAt: "2026-08-16T23:59:59.000Z",
          paidAt: "2026-08-16T23:59:59.000Z",
        }),
        paidListing({
          id: "lst_now",
          episodeId: "ep_12",
          bidUsd: 5,
          firstBidAt: "2026-08-17T00:00:00.000Z",
          paidAt: "2026-08-17T00:00:00.000Z",
        }),
      ],
      now,
    ).map((row) => row.id),
    ["lst_now"],
  );
});

test("Monday 00:00 UTC does not drop a rolling-week #1", () => {
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const ranked = rankListings(
    [
      paidListing({
        id: "lst_sunday",
        episodeId: "ep_12",
        bidUsd: 12,
        firstBidAt: "2026-08-16T12:00:00.000Z",
        paidAt: "2026-08-16T12:00:00.000Z",
      }),
    ],
    "ep_12",
    monday,
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.id, "lst_sunday");
  assert.equal(ranked[0]?.rank, 1);
});
