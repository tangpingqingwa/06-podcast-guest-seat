export const MIN_BID_USD = 5;

export type Listing = {
  id: string;
  day: string;
  productUrl: string;
  whyTestThisToday: string;
  bidUsd: number;
  paidUsd: number;
  clicks: number;
  createdAt: string;
  updatedAt: string;
};

export type RankedListing = Listing & { rank: number };

export function isPaidListing(
  listing: Pick<Listing, "paidUsd">,
): boolean {
  return Number.isInteger(listing.paidUsd) && listing.paidUsd >= 1;
}

export function paidListings<T extends Pick<Listing, "paidUsd">>(
  listings: readonly T[],
): T[] {
  return listings.filter(isPaidListing);
}

export function withRanks(rows: readonly Listing[]): RankedListing[] {
  return [...paidListings(rows)]
    .sort((left, right) => {
      if (right.bidUsd !== left.bidUsd) return right.bidUsd - left.bidUsd;
      return left.createdAt.localeCompare(right.createdAt);
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function rankForBid(
  rows: readonly Pick<Listing, "bidUsd" | "paidUsd">[],
  bidUsd: number,
): number {
  return paidListings(rows).filter((row) => row.bidUsd >= bidUsd).length + 1;
}

export function claimPriceUsd(currentBidUsd: number): number {
  return currentBidUsd + 1;
}

export function defaultClaimBidUsd(
  rows: readonly Pick<Listing, "bidUsd" | "paidUsd">[],
): number {
  const paid = paidListings(rows);
  if (paid.length === 0) return MIN_BID_USD;
  return Math.max(...paid.map((row) => row.bidUsd)) + 1;
}
