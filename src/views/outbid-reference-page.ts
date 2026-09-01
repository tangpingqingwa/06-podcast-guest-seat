import type { Episode } from "../episodes.js";
import type { Listing } from "../listings.js";
import {
  renderBoardPage,
  type BoardViewModel,
} from "./outbid-reference-board.js";
import type { RankedListing } from "./outbid-reference-core.js";
import { escapeHtml } from "./outbid-reference-html.js";

export const OUTBID_REFERENCE_NOW = new Date("2026-08-29T12:00:00.000Z");
export const OUTBID_REFERENCE_EPISODE_ID = "ep_visual_reference";

export const OUTBID_REFERENCE_FIXTURE_ROWS = [
  ["lst_visual_one", "Signal Studio", "Signal Studio: Midnight Frequency", 17_000, "https://see.io/"],
  ["lst_visual_two", "Canvas Radio", "Canvas Radio: Canvas Night Drive", 16_000, "https://tutti.so/"],
  ["lst_visual_three", "Morrow", "Morrow: First Light Mix", 14_028, "https://joni.ai/"],
  ["lst_visual_four", "Low Tide", "Low Tide: Low Tide Session", 13_005, "https://example.com/low-tide"],
  ["lst_visual_five", "Sunday Side", "Sunday Side: Sunday Side A", 12_080, "https://example.com/sunday-side"],
  ["lst_visual_six", "Paper Planes", "Paper Planes: Paper Planes", 11_004, "https://example.com/paper-planes"],
] as const;

export function isOutbidReferenceFixture(
  episode: Episode,
  listings: readonly Listing[],
): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.WAFFO_MODE !== "fixture") return false;
  if (
    episode.id !== OUTBID_REFERENCE_EPISODE_ID ||
    episode.lockedAt !== null ||
    episode.seatKind !== "guest_seat" ||
    listings.length !== OUTBID_REFERENCE_FIXTURE_ROWS.length
  ) {
    return false;
  }
  return OUTBID_REFERENCE_FIXTURE_ROWS.every(
    ([id, name, oneLiner, bidUsd, siteUrl], index) => {
      const listing = listings[index];
      return (
        listing?.id === id &&
        listing.episodeId === episode.id &&
        listing.name === name &&
        listing.oneLiner === oneLiner &&
        listing.bidUsd === bidUsd &&
        listing.siteUrl === siteUrl &&
        listing.vetoedAt === null
      );
    },
  );
}

function referenceListings(listings: readonly Listing[]): RankedListing[] {
  const day = OUTBID_REFERENCE_NOW.toISOString().slice(0, 10);
  return listings.slice(0, 3).map((listing, index) => ({
    id: listing.id,
    day,
    productUrl: listing.siteUrl,
    whyTestThisToday: listing.oneLiner,
    bidUsd: listing.bidUsd,
    paidUsd: listing.bidUsd,
    clicks: listing.clicks,
    createdAt: listing.firstBidAt,
    updatedAt: listing.paidAt,
    rank: index + 1,
  }));
}

/**
 * Preserve Podcast Guest Seat's real POST /checkout contract while the exact
 * six-row disposable fixture uses the shared Outbid visual surface.
 */
export function adaptReferenceDocument(
  documentHtml: string,
  episodeId: string,
): string {
  const formOpen = '<form id="bid-form" class="bid-form" method="post" action="/checkout" data-slot="claim-form">';
  return documentHtml
    .replace("<body>", '<body><div class="outbid-reference-root" data-reference-fixture-root="">')
    .replace("</body>", "</div></body>")
    .replace(
      formOpen,
      `${formOpen}\n    <input type="hidden" name="episodeId" value="${escapeHtml(episodeId)}"/>`,
    )
    .replaceAll("productUrl", "siteUrl")
    .replaceAll("whyTestThisToday", "oneLiner")
    .replaceAll("venueName", "name")
    .replace(
      '<input id="bid-display" type="text"',
      '<input id="bid-display" name="bidUsd" form="bid-form" type="text"',
    )
    .replace(
      '<input id="bid" name="bidUsd"',
      '<input id="bid" data-ui-field="bidUsd"',
    )
    .replace('name="category"', 'data-ui-field="category"')
    .replace('name="kind"', 'data-ui-field="kind"')
    .replace('maxlength="140" minlength="8"', 'maxlength="140" minlength="1"')
    .replace('maxlength="120"', 'maxlength="80"')
    .replaceAll(
      '<span class="sr-only">Product URL</span>',
      '<span class="sr-only">Site URL</span>',
    )
    .replace("Product URL", "Site URL")
    .replace("Why test this today", "One-line guest pitch")
    .replace("What a seller should try this morning", "One line for the podcast host")
    .replace(
      "A short, specific reason helps sellers decide what to test.",
      "This one-line pitch appears on the paid guest seat.",
    )
    .replace("Choose a category and enter venue details", "Choose a category and enter guest details")
    .replace("Weekend venue details", "Guest details")
    .replace("Venue details", "Guest details")
    .replace("Venue name", "Name or company")
    .replace('placeholder="Venue name"', 'placeholder="Name or company"')
    .replaceAll(/href="\/r\/([^"#?]+)"/g, 'href="/go/$1"')
    .replaceAll(/data-target="\/r\/([^"#?]+)"/g, 'data-target="/go/$1"')
    .replace("<title>DTC Picks Daily</title>", "<title>Podcast Guest Seat</title>");
}

export function renderPodcastReferencePage(
  episode: Episode,
  listings: readonly Listing[],
): string | null {
  if (!isOutbidReferenceFixture(episode, listings)) return null;
  const day = OUTBID_REFERENCE_NOW.toISOString().slice(0, 10);
  const ranked = referenceListings(listings);
  const model: BoardViewModel = {
    day,
    tz: "UTC",
    listings: ranked,
    last24h: ranked,
    defaultBidUsd: 17_001,
    now: OUTBID_REFERENCE_NOW,
    fixtureMode: true,
  };
  return adaptReferenceDocument(renderBoardPage(model), episode.id);
}
