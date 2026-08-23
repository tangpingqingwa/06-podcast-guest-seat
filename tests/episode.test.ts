import assert from "node:assert/strict";
import { after, test } from "node:test";
import { openDatabase } from "../src/db.js";
import {
  createEpisode,
  defaultVetoEnabled,
  EpisodeError,
  getCurrentEpisode,
  getEpisode,
  nextEpisodeLabel,
  openNextEpisode,
} from "../src/episodes.js";
import {
  insertListing,
  listListingsForEpisode,
  siteIdentity,
} from "../src/listings.js";

function memoryDb() {
  const db = openDatabase(":memory:");
  after(() => db.close());
  return db;
}

test("guest-seat episode defaults vetoEnabled to true", () => {
  const db = memoryDb();
  assert.equal(defaultVetoEnabled("guest_seat"), true);

  const episode = createEpisode(db, {
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });

  assert.equal(episode.vetoEnabled, true);
  assert.deepEqual(getEpisode(db, episode.id), episode);
});

test("60-second episode defaults vetoEnabled to false", () => {
  const db = memoryDb();
  assert.equal(defaultVetoEnabled("sixty_second_open"), false);

  const episode = createEpisode(db, {
    showId: "show_english",
    label: "Episode 12 open",
    seatKind: "sixty_second_open",
    opensAt: "2026-08-22T00:00:00.000Z",
  });

  assert.equal(episode.vetoEnabled, false);
  assert.deepEqual(getEpisode(db, episode.id), episode);
});

test("listing is person/company + site + one-liner on one episode", () => {
  const db = memoryDb();
  const episode = createEpisode(db, {
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });

  const listing = insertListing(db, {
    episodeId: episode.id,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada",
    oneLiner: "Notes on the analytical engine.",
    bidUsd: 5,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });

  assert.equal(listing.episodeId, episode.id);
  assert.equal(listing.name, "Ada Lovelace");
  assert.equal(listing.siteUrl, "https://example.com/ada");
  assert.equal(listing.oneLiner, "Notes on the analytical engine.");
  assert.equal(listing.bidUsd, 5);
  assert.equal(listing.firstBidAt, "2026-08-22T01:00:00.000Z");
  assert.equal(listing.paidAt, "2026-08-22T01:00:05.000Z");
  assert.equal(listing.clicks, 0);
  assert.equal(listing.vetoedAt, null);
  assert.equal(listing.vetoReason, null);
  assert.equal(
    siteIdentity(listing.siteUrl),
    "example.com/ada",
  );
  assert.deepEqual(listListingsForEpisode(db, episode.id), [listing]);
});

test("openNextEpisode opens an empty guest-seat board with veto on", () => {
  const db = memoryDb();
  const episode = openNextEpisode(db, {
    label: "Episode 1",
    opensAt: "2026-08-23T00:00:00.000Z",
  });
  assert.equal(episode.label, "Episode 1");
  assert.equal(episode.seatKind, "guest_seat");
  assert.equal(episode.vetoEnabled, true);
  assert.equal(episode.lockedAt, null);
  assert.equal(getCurrentEpisode(db)?.id, episode.id);
  assert.deepEqual(listListingsForEpisode(db, episode.id), []);
});

test("openNextEpisode refuses a second unlocked episode", () => {
  const db = memoryDb();
  openNextEpisode(db, { label: "Episode 1", opensAt: "2026-08-23T00:00:00.000Z" });
  assert.throws(
    () => openNextEpisode(db, { label: "Episode 2" }),
    (err: unknown) => err instanceof EpisodeError && err.code === "episode_already_open",
  );
});

test("nextEpisodeLabel increments from the latest Episode N", () => {
  const db = memoryDb();
  assert.equal(nextEpisodeLabel(db), "Episode 1");
  createEpisode(db, {
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-01T00:00:00.000Z",
    lockedAt: "2026-08-08T00:00:00.000Z",
  });
  assert.equal(nextEpisodeLabel(db), "Episode 13");
});

test("openNextEpisode after lock opens an empty N+1 board", () => {
  const db = memoryDb();
  const first = createEpisode(db, {
    id: "ep_12",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-01T00:00:00.000Z",
    lockedAt: "2026-08-08T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_old",
    episodeId: first.id,
    name: "Old Guest Co",
    siteUrl: "https://old.example/",
    oneLiner: "Was #1 last episode.",
    bidUsd: 40,
    firstBidAt: "2026-08-01T12:00:00.000Z",
    paidAt: "2026-08-01T12:00:10.000Z",
  });
  const next = openNextEpisode(db, {
    label: "Episode 13",
    opensAt: "2026-08-15T00:00:00.000Z",
  });
  assert.equal(next.label, "Episode 13");
  assert.equal(next.vetoEnabled, true);
  assert.deepEqual(listListingsForEpisode(db, next.id), []);
  assert.equal(listListingsForEpisode(db, first.id)[0]?.id, "lst_old");
  assert.equal(getCurrentEpisode(db)?.id, next.id);
});

test("new episode does not carry old bids", () => {
  const db = memoryDb();
  const episode12 = createEpisode(db, {
    id: "ep_12",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-01T00:00:00.000Z",
  });
  insertListing(db, {
    id: "lst_old",
    episodeId: episode12.id,
    name: "Old Guest Co",
    siteUrl: "https://old.example/",
    oneLiner: "Was #1 last episode.",
    bidUsd: 40,
    firstBidAt: "2026-08-01T12:00:00.000Z",
    paidAt: "2026-08-01T12:00:10.000Z",
  });

  const episode13 = createEpisode(db, {
    id: "ep_13",
    showId: "show_english",
    label: "Episode 13",
    seatKind: "guest_seat",
    opensAt: "2026-08-15T00:00:00.000Z",
  });

  assert.deepEqual(listListingsForEpisode(db, episode13.id), []);
  assert.equal(listListingsForEpisode(db, episode12.id).length, 1);
  assert.equal(listListingsForEpisode(db, episode12.id)[0]?.id, "lst_old");
});
