import { randomUUID } from "node:crypto";
import type { AppDb } from "./db.js";
import { canonicalizeSiteUrl } from "./hygiene.js";

const MAX_ONE_LINER = 140;

/** SPEC §5. Person or company + site + one-liner. Per-episode. */
export type Listing = {
  id: string;
  episodeId: string;
  name: string;
  siteUrl: string;
  oneLiner: string;
  bidUsd: number;
  firstBidAt: string;
  paidAt: string;
  clicks: number;
  vetoedAt: string | null;
  vetoReason: string | null;
};

export type InsertListingInput = {
  id?: string;
  episodeId: string;
  name: string;
  siteUrl: string;
  oneLiner: string;
  bidUsd: number;
  firstBidAt: string;
  paidAt: string;
  clicks?: number;
  vetoedAt?: string | null;
  vetoReason?: string | null;
};

type ListingRow = {
  id: string;
  episode_id: string;
  name: string;
  site_url: string;
  one_liner: string;
  bid_usd: number;
  first_bid_at: string;
  paid_at: string;
  clicks: number;
  vetoed_at: string | null;
  veto_reason: string | null;
};

/** Host + path after dropping query/hash. Rank key with episodeId. */
export function siteIdentity(siteUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(siteUrl);
  } catch {
    throw new Error("invalid siteUrl");
  }
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  return `${parsed.hostname.toLowerCase()}${path}`;
}

/** Test-only insert. Payments are not wired yet. */
export function insertListing(db: AppDb, input: InsertListingInput): Listing {
  const episodeId = input.episodeId.trim();
  const name = input.name.trim();
  const siteUrl = canonicalizeSiteUrl(input.siteUrl);
  const oneLiner = input.oneLiner.trim();
  const firstBidAt = input.firstBidAt.trim();
  const paidAt = input.paidAt.trim();

  if (!episodeId) {
    throw new Error("episodeId is required");
  }
  if (!name) {
    throw new Error("name is required");
  }
  if (!oneLiner) {
    throw new Error("oneLiner is required");
  }
  if (/[\r\n]/.test(oneLiner)) {
    throw new Error("oneLiner must be a single line");
  }
  if (oneLiner.length > MAX_ONE_LINER) {
    throw new Error(`oneLiner must be at most ${MAX_ONE_LINER} characters`);
  }
  if (!Number.isInteger(input.bidUsd) || input.bidUsd < 5) {
    throw new Error("bidUsd must be an integer >= 5");
  }
  if (!firstBidAt) {
    throw new Error("firstBidAt is required");
  }
  if (!paidAt) {
    throw new Error("paidAt is required");
  }

  const listing: Listing = {
    id: input.id ?? randomUUID(),
    episodeId,
    name,
    siteUrl,
    oneLiner,
    bidUsd: input.bidUsd,
    firstBidAt,
    paidAt,
    clicks: input.clicks ?? 0,
    vetoedAt: input.vetoedAt ?? null,
    vetoReason: input.vetoReason ?? null,
  };
  const identity = siteIdentity(listing.siteUrl);

  db.prepare(
    `INSERT INTO listings (
       id, episode_id, name, site_url, site_identity, one_liner, bid_usd,
       first_bid_at, paid_at, clicks, vetoed_at, veto_reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    listing.id,
    listing.episodeId,
    listing.name,
    listing.siteUrl,
    identity,
    listing.oneLiner,
    listing.bidUsd,
    listing.firstBidAt,
    listing.paidAt,
    listing.clicks,
    listing.vetoedAt,
    listing.vetoReason,
  );

  return listing;
}

export function getListing(db: AppDb, id: string): Listing | undefined {
  const row = db
    .prepare<[string], ListingRow>(
      `SELECT id, episode_id, name, site_url, one_liner, bid_usd,
              first_bid_at, paid_at, clicks, vetoed_at, veto_reason
       FROM listings WHERE id = ?`,
    )
    .get(id);
  return row ? mapListing(row) : undefined;
}

export function incrementListingClicks(
  db: AppDb,
  id: string,
): Listing | undefined {
  const result = db
    .prepare("UPDATE listings SET clicks = clicks + 1 WHERE id = ?")
    .run(id);
  if (result.changes === 0) {
    return undefined;
  }
  return getListing(db, id);
}

export function listListingsForEpisode(db: AppDb, episodeId: string): Listing[] {
  return db
    .prepare<[string], ListingRow>(
      `SELECT id, episode_id, name, site_url, one_liner, bid_usd,
              first_bid_at, paid_at, clicks, vetoed_at, veto_reason
       FROM listings WHERE episode_id = ? ORDER BY first_bid_at ASC, id ASC`,
    )
    .all(episodeId)
    .map(mapListing);
}

function mapListing(row: ListingRow): Listing {
  return {
    id: row.id,
    episodeId: row.episode_id,
    name: row.name,
    siteUrl: row.site_url,
    oneLiner: row.one_liner,
    bidUsd: row.bid_usd,
    firstBidAt: row.first_bid_at,
    paidAt: row.paid_at,
    clicks: row.clicks,
    vetoedAt: row.vetoed_at,
    vetoReason: row.veto_reason,
  };
}
