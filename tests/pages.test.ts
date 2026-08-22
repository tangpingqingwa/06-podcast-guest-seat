import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { createEpisode } from "../src/episodes.js";
import { getListing, insertListing } from "../src/listings.js";

function memoryDb() {
  const db = openDatabase(":memory:");
  after(() => db.close());
  return db;
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
