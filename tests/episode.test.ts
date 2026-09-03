import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.js";
import {
  countEpisodes,
  createEpisode,
  defaultVetoEnabled,
  EpisodeError,
  ensureCurrentOpenEpisode,
  getCurrentEpisode,
  getEpisode,
  getLatestLockedEpisode,
  isEpisodeLockDue,
  isEpisodeLockMalformed,
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

test("ensureCurrentOpenEpisode opens one empty board and is idempotent", () => {
  const db = memoryDb();
  const first = ensureCurrentOpenEpisode(db, {
    opensAt: "2026-08-23T00:00:00.000Z",
  });
  const again = ensureCurrentOpenEpisode(db, {
    opensAt: "2026-08-24T00:00:00.000Z",
  });

  assert.equal(first.label, "Episode 1");
  assert.equal(first.seatKind, "guest_seat");
  assert.equal(first.vetoEnabled, true);
  assert.equal(first.lockedAt, null);
  assert.deepEqual(again, first);
  assert.equal(countEpisodes(db), 1);
  assert.deepEqual(listListingsForEpisode(db, first.id), []);
});

test("ensureCurrentOpenEpisode opens the next empty board after a host lock", () => {
  const db = memoryDb();
  const locked = createEpisode(db, {
    id: "ep_locked_for_auto_open",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-01T00:00:00.000Z",
    lockedAt: "2026-08-08T00:00:00.000Z",
  });

  const next = ensureCurrentOpenEpisode(db, {
    opensAt: "2026-08-09T00:00:00.000Z",
  });

  assert.equal(next.label, "Episode 13");
  assert.equal(next.lockedAt, null);
  assert.equal(next.vetoEnabled, true);
  assert.equal(countEpisodes(db), 2);
  assert.deepEqual(listListingsForEpisode(db, next.id), []);
  assert.equal(getEpisode(db, locked.id)?.lockedAt, "2026-08-08T00:00:00.000Z");
});

test("ensureCurrentOpenEpisode serializes a cold-database open across SQLite connections", () => {
  const directory = mkdtempSync(join(tmpdir(), "podcast-guest-seat-"));
  const databasePath = join(directory, "guest-seat.sqlite");
  const firstDb = openDatabase(databasePath);
  const secondDb = openDatabase(databasePath);
  try {
    const first = ensureCurrentOpenEpisode(firstDb, {
      opensAt: "2026-08-23T00:00:00.000Z",
    });
    const second = ensureCurrentOpenEpisode(secondDb, {
      opensAt: "2026-08-24T00:00:00.000Z",
    });

    assert.equal(second.id, first.id);
    assert.equal(countEpisodes(firstDb), 1);
    assert.equal(countEpisodes(secondDb), 1);
    assert.deepEqual(listListingsForEpisode(secondDb, first.id), []);
  } finally {
    firstDb.close();
    secondDb.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ensureCurrentOpenEpisode atomically rolls an episode past locksAt", () => {
  const db = memoryDb();
  const expiring = createEpisode(db, {
    id: "ep_scheduled_rollover",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    locksAt: "2000-01-01T00:00:00.000Z",
  });

  assert.equal(isEpisodeLockDue(expiring, new Date("1999-12-31T23:59:59.999Z")), false);
  assert.equal(isEpisodeLockDue(expiring, new Date("2000-01-01T00:00:00.000Z")), true);
  const next = ensureCurrentOpenEpisode(db, {
    opensAt: "2026-08-27T12:00:00.000Z",
  });

  assert.equal(next.label, "Episode 13");
  assert.equal(next.lockedAt, null);
  assert.equal(getEpisode(db, expiring.id)?.lockedAt, "2000-01-01T00:00:00.000Z");
  assert.equal(countEpisodes(db), 2);
  assert.deepEqual(listListingsForEpisode(db, next.id), []);
  assert.equal(ensureCurrentOpenEpisode(db).id, next.id);
  assert.equal(countEpisodes(db), 2);
});

test("scheduled rollover serializes one replacement board across SQLite connections", () => {
  const directory = mkdtempSync(join(tmpdir(), "podcast-guest-seat-expiry-"));
  const databasePath = join(directory, "guest-seat.sqlite");
  const firstDb = openDatabase(databasePath);
  const secondDb = openDatabase(databasePath);
  try {
    createEpisode(firstDb, {
      id: "ep_scheduled_concurrent",
      showId: "show_english",
      label: "Episode 12",
      seatKind: "guest_seat",
      opensAt: "2026-08-22T00:00:00.000Z",
      locksAt: "2000-01-01T00:00:00.000Z",
    });
    const first = ensureCurrentOpenEpisode(firstDb);
    const second = ensureCurrentOpenEpisode(secondDb);

    assert.equal(second.id, first.id);
    assert.equal(first.label, "Episode 13");
    assert.equal(countEpisodes(firstDb), 2);
    assert.equal(countEpisodes(secondDb), 2);
    assert.deepEqual(listListingsForEpisode(secondDb, second.id), []);
    assert.equal(getEpisode(secondDb, "ep_scheduled_concurrent")?.lockedAt, "2000-01-01T00:00:00.000Z");
  } finally {
    firstDb.close();
    secondDb.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("malformed locksAt quarantine serializes one replacement across SQLite connections", () => {
  const directory = mkdtempSync(join(tmpdir(), "podcast-guest-seat-malformed-lock-"));
  const databasePath = join(directory, "guest-seat.sqlite");
  const firstDb = openDatabase(databasePath);
  const secondDb = openDatabase(databasePath);
  try {
    const corrupt = createEpisode(firstDb, {
      id: "ep_malformed_concurrent",
      showId: "show_english",
      label: "Episode 12",
      seatKind: "guest_seat",
      opensAt: "2026-08-22T00:00:00.000Z",
      locksAt: "not-a-timestamp",
    });
    assert.equal(isEpisodeLockMalformed(corrupt), true);
    const first = ensureCurrentOpenEpisode(firstDb);
    const second = ensureCurrentOpenEpisode(secondDb);

    assert.equal(second.id, first.id);
    assert.equal(first.label, "Episode 13");
    assert.equal(first.lockedAt, null);
    assert.equal(countEpisodes(firstDb), 2);
    assert.equal(countEpisodes(secondDb), 2);
    assert.ok(getEpisode(secondDb, corrupt.id)?.lockedAt);
    assert.deepEqual(listListingsForEpisode(secondDb, second.id), []);
  } finally {
    firstDb.close();
    secondDb.close();
    rmSync(directory, { recursive: true, force: true });
  }
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
  const prior = getLatestLockedEpisode(db, next.id);
  assert.ok(prior);
  assert.equal(prior.id, first.id);
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
