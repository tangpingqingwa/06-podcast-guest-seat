import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { createEpisode } from "../src/episodes.js";
import {
  canonicalizeSiteUrl,
  HygieneError,
} from "../src/hygiene.js";
import { getListing, insertListing } from "../src/listings.js";

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

test("SPEC 7: URL with ?utm_source=x is stored and /go has no query", async () => {
  const db = memoryDb();
  const episode = guestSeat(db);
  const listing = insertListing(db, {
    id: "lst_utm",
    episodeId: episode.id,
    name: "Tracked Co",
    siteUrl: "https://example.com/guest?utm_source=x&utm_medium=cpc&fbclid=abc#hash",
    oneLiner: "Tracking must not survive.",
    bidUsd: 5,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });

  assert.equal(listing.siteUrl, "https://example.com/guest");
  assert.equal(getListing(db, listing.id)?.siteUrl, "https://example.com/guest");
  assert.doesNotMatch(listing.siteUrl, /[?#]/);

  const app = await buildApp({ db });
  after(() => app.close());
  const response = await app.inject({
    method: "GET",
    url: "/go/lst_utm?utm_source=injected&ref=spam",
  });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, "https://example.com/guest");
  assert.doesNotMatch(String(response.headers.location), /[?#]/);
  assert.equal(getListing(db, "lst_utm")?.clicks, 1);
});

test("SPEC 8: Discord / Telegram invite is rejected", () => {
  assert.throws(
    () => canonicalizeSiteUrl("https://discord.gg/abc123"),
    (err: unknown) => err instanceof HygieneError && err.code === "chat_link",
  );
  assert.throws(
    () => canonicalizeSiteUrl("https://discord.com/invite/abc123"),
    (err: unknown) => err instanceof HygieneError && err.code === "chat_link",
  );
  assert.throws(
    () => canonicalizeSiteUrl("https://t.me/guestseat"),
    (err: unknown) => err instanceof HygieneError && err.code === "chat_link",
  );
  assert.throws(
    () => canonicalizeSiteUrl("https://telegram.me/joinchat/xyz"),
    (err: unknown) => err instanceof HygieneError && err.code === "chat_link",
  );
  assert.throws(
    () => canonicalizeSiteUrl("https://wa.me/15551234567"),
    (err: unknown) => err instanceof HygieneError && err.code === "chat_link",
  );
  assert.throws(
    () => canonicalizeSiteUrl("https://chat.whatsapp.com/invite"),
    (err: unknown) => err instanceof HygieneError && err.code === "chat_link",
  );
  assert.throws(
    () => canonicalizeSiteUrl("https://m.me/page"),
    (err: unknown) => err instanceof HygieneError && err.code === "chat_link",
  );
  assert.throws(
    () => canonicalizeSiteUrl("https://signal.me/#p/+15551234567"),
    (err: unknown) => err instanceof HygieneError && err.code === "chat_link",
  );

  const db = memoryDb();
  const episode = guestSeat(db, "ep_chat");
  assert.throws(
    () =>
      insertListing(db, {
        episodeId: episode.id,
        name: "Chat Guest",
        siteUrl: "https://discord.gg/nope",
        oneLiner: "Come hang in Discord.",
        bidUsd: 5,
        firstBidAt: "2026-08-22T01:00:00.000Z",
        paidAt: "2026-08-22T01:00:05.000Z",
      }),
    (err: unknown) => err instanceof HygieneError && err.code === "chat_link",
  );
});

test("SPEC 9: NSFW host is rejected", () => {
  assert.throws(
    () => canonicalizeSiteUrl("https://onlyfans.com/someone"),
    (err: unknown) => err instanceof HygieneError && err.code === "nsfw",
  );
  assert.throws(
    () => canonicalizeSiteUrl("https://www.pornhub.com/view_video.php?viewkey=1"),
    (err: unknown) => err instanceof HygieneError && err.code === "nsfw",
  );
  assert.throws(
    () => canonicalizeSiteUrl("https://fansly.com/profile"),
    (err: unknown) => err instanceof HygieneError && err.code === "nsfw",
  );

  const db = memoryDb();
  const episode = guestSeat(db, "ep_nsfw");
  assert.throws(
    () =>
      insertListing(db, {
        episodeId: episode.id,
        name: "Adult Co",
        siteUrl: "https://onlyfans.com/x",
        oneLiner: "Should not list.",
        bidUsd: 5,
        firstBidAt: "2026-08-22T01:00:00.000Z",
        paidAt: "2026-08-22T01:00:05.000Z",
      }),
    (err: unknown) => err instanceof HygieneError && err.code === "nsfw",
  );
});

test("https required; javascript and data URLs rejected; shorteners rejected", () => {
  assert.throws(
    () => canonicalizeSiteUrl("javascript:alert(1)"),
    (err: unknown) =>
      err instanceof HygieneError &&
      (err.code === "https_required" || err.code === "invalid_url"),
  );
  assert.throws(
    () => canonicalizeSiteUrl("data:text/html,hi"),
    (err: unknown) =>
      err instanceof HygieneError &&
      (err.code === "https_required" || err.code === "invalid_url"),
  );
  assert.throws(
    () => canonicalizeSiteUrl("http://example.com/guest"),
    (err: unknown) => err instanceof HygieneError && err.code === "https_required",
  );
  assert.throws(
    () => canonicalizeSiteUrl("https://bit.ly/abc"),
    (err: unknown) => err instanceof HygieneError && err.code === "url_shortener",
  );
  assert.throws(
    () => canonicalizeSiteUrl("https://t.co/x"),
    (err: unknown) => err instanceof HygieneError && err.code === "url_shortener",
  );
});

test("canonicalize drops userinfo, hash, all query, default port", () => {
  assert.equal(
    canonicalizeSiteUrl(
      "https://user:pass@apps.apple.com/app/id123?utm_source=x&gclid=1#frag",
    ),
    "https://apps.apple.com/app/id123",
  );
  assert.equal(
    canonicalizeSiteUrl("https://github.com/acme/app/?ref=twitter"),
    "https://github.com/acme/app",
  );
  assert.equal(
    canonicalizeSiteUrl("https://play.google.com/store/apps/details?id=a.b"),
    "https://play.google.com/store/apps/details",
  );
  assert.equal(
    canonicalizeSiteUrl("https://EXAMPLE.com:443/Path/"),
    "https://example.com/Path",
  );
});

test("bare site domains default to https before the existing hygiene checks", () => {
  assert.equal(
    canonicalizeSiteUrl(" Example.COM/guest/?utm_source=board#fragment "),
    "https://example.com/guest",
  );
  assert.equal(canonicalizeSiteUrl("//EXAMPLE.com/path/"), "https://example.com/path");
  assert.equal(canonicalizeSiteUrl("example.com:8443/path"), "https://example.com:8443/path");
  assert.throws(
    () => canonicalizeSiteUrl("discord.gg/invite/abc"),
    (err: unknown) => err instanceof HygieneError && err.code === "chat_link",
  );
  assert.throws(
    () => canonicalizeSiteUrl("onlyfans.com/guest"),
    (err: unknown) => err instanceof HygieneError && err.code === "nsfw",
  );
  assert.throws(
    () => canonicalizeSiteUrl("bit.ly/guest"),
    (err: unknown) => err instanceof HygieneError && err.code === "url_shortener",
  );

  const db = memoryDb();
  const episode = guestSeat(db, "ep_bare_domain");
  const listing = insertListing(db, {
    id: "lst_bare_domain",
    episodeId: episode.id,
    name: "Bare Domain Guest",
    siteUrl: "bare.example/guest",
    oneLiner: "A bare domain is canonicalized on insert.",
    bidUsd: 5,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:05.000Z",
  });
  assert.equal(listing.siteUrl, "https://bare.example/guest");
  assert.equal(getListing(db, listing.id)?.siteUrl, "https://bare.example/guest");
});

test("URL inference rejects schemes, malformed authorities, and private targets", () => {
  const rejected = [
    "javascript:123",
    "data:123",
    "ftp:123",
    "mailto:123",
    "custom:123",
    "javascript:foo@evil.com",
    "javascript\n://example.com",
    "data\t://example.com",
    "ftp\r://example.com",
    "http\n://example.com",
    "javascript" + String.fromCharCode(92) + "://example.com",
    "https" + String.fromCharCode(92) + "://example.com",
    "//" + String.fromCharCode(92) + "evil.com",
    "//evil.com" + String.fromCharCode(92) + "path",
    "/path",
    "///example.com",
    "////example.com",
    "https:///example.com",
    "example.com:/path",
    "example.com:bad/path",
    "example.com:65536/path",
    "//example.com:65536/path",
  ];
  for (const value of rejected) {
    assert.throws(
      () => canonicalizeSiteUrl(value),
      (err: unknown) =>
        err instanceof HygieneError &&
        (err.code === "invalid_url" || err.code === "https_required"),
      value,
    );
  }

  for (const value of [
    "localhost",
    "localhost:3000",
    "internal",
    "dev.local",
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.51.100.1",
    "203.0.113.1",
    "[::]",
    "[::1]",
    "[fc00::1]",
    "[fe80::1]",
    "[fec0::1]",
    "[ff02::1]",
    "[::ffff:127.0.0.1]",
    "[::ffff:192.168.1.1]",
    "[2001:db8::1]",
  ]) {
    assert.throws(
      () => canonicalizeSiteUrl(value),
      (err: unknown) => err instanceof HygieneError && err.code === "invalid_url",
      value,
    );
  }

  assert.equal(canonicalizeSiteUrl("public.example/path"), "https://public.example/path");
  assert.equal(
    canonicalizeSiteUrl("public.example:8443/path"),
    "https://public.example:8443/path",
  );
  assert.equal(canonicalizeSiteUrl("//public.example/path"), "https://public.example/path");
  assert.equal(canonicalizeSiteUrl("//public-host"), "https://public-host/");
  assert.equal(canonicalizeSiteUrl("8.8.8.8:443/dns"), "https://8.8.8.8/dns");
  assert.equal(
    canonicalizeSiteUrl("https://[2001:4860:4860::8888]/dns"),
    "https://[2001:4860:4860::8888]/dns",
  );
});

test("denylisted hosts cannot bypass policy with repeated trailing dots", () => {
  for (const [value, code] of [
    ["t.me..", "chat_link"],
    ["sub.onlyfans.com...", "nsfw"],
    ["bit.ly....", "url_shortener"],
  ] as const) {
    assert.throws(
      () => canonicalizeSiteUrl(value),
      (err: unknown) => err instanceof HygieneError && err.code === code,
      value,
    );
  }
});
