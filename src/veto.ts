import type { AppDb } from "./db.js";
import { getEpisode, type Episode } from "./episodes.js";
import { getListing, type Listing } from "./listings.js";
import { rankedListingsForEpisode } from "./rank.js";

export type VetoErrorCode =
  | "veto_disabled"
  | "episode_not_found"
  | "listing_not_found"
  | "episode_locked"
  | "veto_flag_frozen"
  | "invalid_reason"
  | "already_vetoed"
  | "listing_not_on_episode";

const VETO_STATUS: Record<VetoErrorCode, number> = {
  veto_disabled: 403,
  episode_not_found: 404,
  listing_not_found: 404,
  episode_locked: 409,
  veto_flag_frozen: 409,
  invalid_reason: 400,
  already_vetoed: 409,
  listing_not_on_episode: 404,
};

export class VetoError extends Error {
  readonly code: VetoErrorCode;
  readonly statusCode: number;

  constructor(code: VetoErrorCode, message: string) {
    super(message);
    this.name = "VetoError";
    this.code = code;
    this.statusCode = VETO_STATUS[code];
  }
}

export type VetoListingInput = {
  episodeId: string;
  listingId: string;
  reason: string;
  at?: string;
};

export type VetoResult = {
  listing: Listing;
  booked: Listing | undefined;
};

export type LockResult = {
  episode: Episode;
  booked: Listing | undefined;
};

const MAX_VETO_REASON = 200;

function nowIso(): string {
  return new Date().toISOString();
}

function requireEpisode(db: AppDb, episodeId: string): Episode {
  const episode = getEpisode(db, episodeId);
  if (!episode) {
    throw new VetoError("episode_not_found", "episode not found");
  }
  return episode;
}

export function normalizeVetoReason(raw: string): string {
  const reason = raw.trim();
  if (!reason || /[\r\n]/.test(reason) || reason.length > MAX_VETO_REASON) {
    throw new VetoError(
      "invalid_reason",
      "veto reason must be a single public line",
    );
  }
  return reason;
}

/** Any paid listing on the episode freezes `vetoEnabled`. */
export function episodeHasPaidBid(db: AppDb, episodeId: string): boolean {
  const row = db
    .prepare<[string], { id: string }>(
      `SELECT id FROM listings
       WHERE episode_id = ? AND paid_at IS NOT NULL AND trim(paid_at) != ''
       LIMIT 1`,
    )
    .get(episodeId);
  return row !== undefined;
}

export function isVetoFlagFrozen(db: AppDb, episodeId: string): boolean {
  return episodeHasPaidBid(db, episodeId);
}

/** Highest remaining eligible paid bid. After lock this is the booked guest. */
export function bookedGuest(
  db: AppDb,
  episodeId: string,
): Listing | undefined {
  return rankedListingsForEpisode(db, episodeId)[0];
}

export function setVetoEnabled(
  db: AppDb,
  episodeId: string,
  vetoEnabled: boolean,
): Episode {
  const episode = requireEpisode(db, episodeId);
  if (episode.vetoEnabled === vetoEnabled) {
    return episode;
  }
  if (isVetoFlagFrozen(db, episodeId)) {
    throw new VetoError(
      "veto_flag_frozen",
      "veto flag is frozen after the first paid bid",
    );
  }
  db.prepare("UPDATE episodes SET veto_enabled = ? WHERE id = ?").run(
    vetoEnabled ? 1 : 0,
    episodeId,
  );
  const updated = getEpisode(db, episodeId);
  if (!updated) {
    throw new Error("episode missing after veto flag update");
  }
  return updated;
}

export function vetoListing(db: AppDb, input: VetoListingInput): VetoResult {
  const episode = requireEpisode(db, input.episodeId);
  if (episode.lockedAt) {
    throw new VetoError("episode_locked", "episode is locked");
  }
  if (!episode.vetoEnabled) {
    throw new VetoError("veto_disabled", "host veto is off for this episode");
  }

  const reason = normalizeVetoReason(input.reason);
  const listing = getListing(db, input.listingId);
  if (!listing) {
    throw new VetoError("listing_not_found", "listing not found");
  }
  if (listing.episodeId !== episode.id) {
    throw new VetoError(
      "listing_not_on_episode",
      "listing is not on this episode",
    );
  }
  if (listing.vetoedAt !== null) {
    throw new VetoError("already_vetoed", "listing is already vetoed");
  }

  const at = input.at ?? nowIso();
  db.prepare(
    "UPDATE listings SET vetoed_at = ?, veto_reason = ? WHERE id = ?",
  ).run(at, reason, listing.id);

  const vetoed = getListing(db, listing.id);
  if (!vetoed) {
    throw new Error("listing missing after veto");
  }
  return { listing: vetoed, booked: bookedGuest(db, episode.id) };
}

export function lockEpisode(
  db: AppDb,
  episodeId: string,
  at: string = nowIso(),
): LockResult {
  const episode = requireEpisode(db, episodeId);
  if (episode.lockedAt) {
    return { episode, booked: bookedGuest(db, episode.id) };
  }
  db.prepare(
    "UPDATE episodes SET locked_at = ? WHERE id = ? AND locked_at IS NULL",
  ).run(at, episodeId);
  const locked = getEpisode(db, episodeId);
  if (!locked) {
    throw new Error("episode missing after lock");
  }
  return { episode: locked, booked: bookedGuest(db, episodeId) };
}
