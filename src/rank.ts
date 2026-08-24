import type { AppDb } from "./db.js";
import {
  getListing,
  insertListing,
  listListingsForEpisode,
  siteIdentity,
  type InsertListingInput,
  type Listing,
} from "./listings.js";

/** SPEC §4. First bid on a listing. */
export const MIN_BID_USD = 5;

export type RankableListing = Pick<
  Listing,
  "id" | "episodeId" | "bidUsd" | "firstBidAt" | "paidAt" | "vetoedAt"
>;

export type RankedListing<T extends RankableListing = Listing> = T & {
  rank: number;
};

export type BidQuote = {
  kind: "open" | "raise";
  chargeUsd: number;
  nextUsd: number;
};

export type RankErrorCode =
  | "min_bid"
  | "invalid_bid"
  | "raise_too_low"
  | "full_bid_required"
  | "not_a_raise";

export class RankError extends Error {
  readonly code: RankErrorCode;

  constructor(code: RankErrorCode, message: string) {
    super(message);
    this.name = "RankError";
    this.code = code;
  }
}

export type ApplyPaidRaiseInput = {
  episodeId: string;
  siteUrl: string;
  newTotalUsd: number;
  paidAt: string;
  /** When set, siteUrl must match this listing’s identity. */
  listingId?: string;
};

/** Polar (or the fixture) reported paid. Empty / epoch / unpaid never ranks. */
export function isPaidListing(listing: Pick<RankableListing, "paidAt">): boolean {
  const paidAt = listing.paidAt.trim();
  if (!paidAt) {
    return false;
  }
  const ms = Date.parse(paidAt);
  if (!Number.isFinite(ms)) {
    return false;
  }
  return ms > 0;
}

/** Polar-paid rows only. Unpaid or abandoned checkout never occupies the board. */
export function paidListings<T extends Pick<RankableListing, "paidAt">>(
  listings: readonly T[],
): T[] {
  return listings.filter(isPaidListing);
}

/** Paid, not vetoed, same episode when `episodeId` is passed. */
export function isEligible(
  listing: RankableListing,
  episodeId?: string,
): boolean {
  if (!isPaidListing(listing)) {
    return false;
  }
  if (listing.vetoedAt !== null) {
    return false;
  }
  if (episodeId !== undefined && listing.episodeId !== episodeId) {
    return false;
  }
  return true;
}

/**
 * Eligible only. Order: bidUsd DESC, firstBidAt ASC, id ASC.
 * Rank is the bid — clicks and name are not keys.
 */
export function rankListings<T extends RankableListing>(
  listings: readonly T[],
  episodeId?: string,
): RankedListing<T>[] {
  const eligible = paidListings(listings).filter((listing) =>
    isEligible(listing, episodeId),
  );
  const ordered = [...eligible].sort((a, b) => {
    if (a.bidUsd !== b.bidUsd) {
      return b.bidUsd - a.bidUsd;
    }
    if (a.firstBidAt !== b.firstBidAt) {
      return a.firstBidAt < b.firstBidAt ? -1 : 1;
    }
    if (a.id !== b.id) {
      return a.id < b.id ? -1 : 1;
    }
    return 0;
  });
  return ordered.map((listing, index) => ({ ...listing, rank: index + 1 }));
}

export function rankedListingsForEpisode(
  db: AppDb,
  episodeId: string,
): RankedListing[] {
  return rankListings(listListingsForEpisode(db, episodeId), episodeId);
}

function requireWholeUsd(amountUsd: number): number {
  if (!Number.isInteger(amountUsd)) {
    throw new RankError("invalid_bid", "bid must be a whole-dollar USD amount");
  }
  return amountUsd;
}

/** First bid. Charge the full amount. Min $5. */
export function quoteOpenBid(amountUsd: number): BidQuote {
  const nextUsd = requireWholeUsd(amountUsd);
  if (nextUsd < MIN_BID_USD) {
    throw new RankError("min_bid", `first bid must be at least $${MIN_BID_USD}`);
  }
  return { kind: "open", chargeUsd: nextUsd, nextUsd };
}

/**
 * Same listing (episode + site identity) may raise.
 * New total ≥ current #1 + $1 when another listing is top, else existing + $1.
 * Charge is the difference only.
 */
export function quoteRaise(
  existing: Pick<RankableListing, "id" | "bidUsd">,
  newTotalUsd: number,
  board: readonly RankableListing[],
  episodeId?: string,
): BidQuote {
  const nextUsd = requireWholeUsd(newTotalUsd);
  const ranked = rankListings(board, episodeId);
  const top = ranked[0];
  const raiserIsTop = top?.id === existing.id;
  const minTotal =
    top !== undefined && !raiserIsTop ? top.bidUsd + 1 : existing.bidUsd + 1;
  if (nextUsd < minTotal) {
    throw new RankError(
      "raise_too_low",
      top !== undefined && !raiserIsTop
        ? `raise must be at least $1 above the current #1 ($${top.bidUsd})`
        : `raise must be at least $${existing.bidUsd + 1}`,
    );
  }
  return {
    kind: "raise",
    chargeUsd: nextUsd - existing.bidUsd,
    nextUsd,
  };
}

function listingForIdentity(
  listings: readonly Listing[],
  siteUrl: string,
): Listing | undefined {
  const identity = siteIdentity(siteUrl);
  return listings.find((row) => siteIdentity(row.siteUrl) === identity);
}

/**
 * A different site identity always pays a full new bid, never an
 * incumbent’s raise difference.
 */
export function quoteCompetingBid(amountUsd: number): BidQuote {
  return quoteOpenBid(amountUsd);
}

/** Completed payment claims an open (first) bid. */
export function applyPaidOpen(
  db: AppDb,
  input: InsertListingInput,
): { listing: Listing; chargeUsd: number } {
  const listings = listListingsForEpisode(db, input.episodeId);
  if (listingForIdentity(listings, input.siteUrl)) {
    throw new RankError(
      "not_a_raise",
      "same site identity must raise; other bidders pay a full new bid",
    );
  }
  const quote = quoteOpenBid(input.bidUsd);
  const listing = insertListing(db, { ...input, bidUsd: quote.nextUsd });
  return { listing, chargeUsd: quote.chargeUsd };
}

/** Completed payment applies a raise. Keeps original firstBidAt. */
export function applyPaidRaise(
  db: AppDb,
  input: ApplyPaidRaiseInput,
): { listing: Listing; chargeUsd: number } {
  const listings = listListingsForEpisode(db, input.episodeId);
  const byId = input.listingId
    ? listings.find((row) => row.id === input.listingId)
    : undefined;
  const byIdentity = listingForIdentity(listings, input.siteUrl);

  if (input.listingId !== undefined) {
    if (byId === undefined || byIdentity === undefined || byId.id !== byIdentity.id) {
      throw new RankError(
        "full_bid_required",
        "other bidders pay a full new bid",
      );
    }
  }

  const existing = byIdentity;
  if (existing === undefined) {
    throw new RankError(
      "full_bid_required",
      "other bidders pay a full new bid",
    );
  }

  const quote = quoteRaise(existing, input.newTotalUsd, listings, input.episodeId);
  db.prepare("UPDATE listings SET bid_usd = ?, paid_at = ? WHERE id = ?").run(
    quote.nextUsd,
    input.paidAt,
    existing.id,
  );
  const listing = getListing(db, existing.id);
  if (listing === undefined) {
    throw new Error("listing missing after raise");
  }
  return { listing, chargeUsd: quote.chargeUsd };
}
