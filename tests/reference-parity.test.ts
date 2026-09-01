import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import test from "node:test";
import {
  seedVisualFixture,
  VISUAL_FIXTURE_EPISODE_ID,
  VISUAL_FIXTURE_ROWS,
} from "../scripts/visual-fixture.js";
import type { Episode } from "../src/episodes.js";
import type { Listing } from "../src/listings.js";
import { renderBoardHtml } from "../src/http/routes/pages.js";

function visualEpisode(): Episode {
  return {
    id: VISUAL_FIXTURE_EPISODE_ID,
    showId: "show_guest_seat",
    label: "Episode 42",
    seatKind: "guest_seat",
    vetoEnabled: true,
    opensAt: "2026-08-29T06:00:00.000Z",
    locksAt: "2026-09-05T06:00:00.000Z",
    lockedAt: null,
  };
}

function visualListings(): Listing[] {
  return VISUAL_FIXTURE_ROWS.map(
    ([id, name, oneLiner, bidUsd, siteUrl], index) => ({
      id,
      episodeId: VISUAL_FIXTURE_EPISODE_ID,
      name,
      siteUrl,
      oneLiner,
      bidUsd,
      firstBidAt:
        "2026-08-29T" +
        String(index + 7).padStart(2, "0") +
        ":00:00.000Z",
      paidAt:
        "2026-08-29T" +
        String(index + 7).padStart(2, "0") +
        ":00:00.000Z",
      clicks: [148, 92, 64, 48, 27, 12][index]!,
      vetoedAt: null,
      vetoReason: null,
    }),
  );
}

test("exact six-row fixture uses the ordinary Studio Rundown and all rows", () => {
  const html = renderBoardHtml(
    visualEpisode(),
    visualListings(),
    new Date("2026-08-29T12:00:00.000Z"),
  );

  assert.match(html, /STUDIO RUNDOWN/);
  assert.match(html, /data-slot="studio-board"/);
  assert.match(html, /data-slot="episode-slate"/);
  assert.match(html, /data-slot="claim-console"/);
  assert.match(html, /data-slot="cue-column"/);
  assert.match(html, /data-slot="rundown-stack"/);
  assert.match(html, /data-slot="rundown-heading"/);
  assert.match(html, /On the mic/);
  assert.match(html, /In the wings/);
  assert.match(html, /data-placement="on-mic"/);
  assert.match(html, /data-placement="in-wings"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, /data-bid-step="-1"/);
  assert.match(html, /data-bid-step="1"/);
  assert.match(html, /data-business-action="Outbid"/);
  assert.match(html, /action="\/checkout"/);
  assert.equal((html.match(/data-listing-id="/g) ?? []).length, 6);
  for (const [id, name, oneLiner] of VISUAL_FIXTURE_ROWS) {
    assert.match(html, new RegExp("data-listing-id=\"" + id + "\""));
    assert.match(html, new RegExp(name));
    assert.match(html, new RegExp(oneLiner.slice(0, 18)));
  }
  assert.doesNotMatch(html, /outbid-reference-root|data-reference-fixture/);
  assert.doesNotMatch(
    html,
    /outbid\.lol|Morning edition|DTC Picks Daily|118 online|1,404,927 visitors|Product URL|Why test this today/,
  );
});

test("product page source no longer imports or calls the shared reference renderer", () => {
  const pageSource = readFileSync(
    new URL("../src/http/routes/pages.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(pageSource, /renderPodcastReferencePage/);
  assert.doesNotMatch(pageSource, /outbid-reference-page/);
});

test("visual fixture is podcast-native, disposable, exact, and refuses overwrite", () => {
  const tempRoot = mkdtempSync("/private/tmp/podcast-guest-seat-visual-");
  const databasePath = tempRoot + "/fixture.sqlite";
  try {
    const rows = seedVisualFixture(databasePath);
    assert.deepEqual(
      rows.map(({ id, name, oneLiner, bidUsd, siteUrl, clicks }) => ({
        id,
        name,
        oneLiner,
        bidUsd,
        siteUrl,
        clicks,
      })),
      VISUAL_FIXTURE_ROWS.map(
        ([id, name, oneLiner, bidUsd, siteUrl], index) => ({
          id,
          name,
          oneLiner,
          bidUsd,
          siteUrl,
          clicks: [148, 92, 64, 48, 27, 12][index]!,
        }),
      ),
    );
    assert.equal(VISUAL_FIXTURE_ROWS.length, 6);
    assert.throws(
      () => seedVisualFixture(databasePath),
      /refuses to overwrite an existing database/,
    );
    assert.throws(
      () => seedVisualFixture("./data/podcast-guest-seat.sqlite"),
      /disposable \/private\/tmp database/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("final skin has no remote font dependency or copied icon markup", () => {
  const stylesSource = readFileSync(
    new URL("../src/views/skin.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(stylesSource, /fonts\.googleapis\.com|data:font\/woff2/);
  assert.doesNotMatch(stylesSource, /bot\.svg|megaphone\.svg|trophy\.svg/);
  assert.match(stylesSource, /\.studio-intro/);
  assert.match(stylesSource, /\.rundown-desk/);
  assert.match(stylesSource, /\.cue-column/);
  assert.match(stylesSource, /\.rundown-column/);
});
