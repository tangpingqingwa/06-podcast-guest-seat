import { randomUUID } from "node:crypto";
import type { AppDb } from "./db.js";

export const SEAT_KINDS = ["guest_seat", "sixty_second_open"] as const;

export type SeatKind = (typeof SEAT_KINDS)[number];

/** SPEC §5 */
export type Episode = {
  id: string;
  showId: string;
  label: string;
  seatKind: SeatKind;
  vetoEnabled: boolean;
  opensAt: string;
  locksAt: string | null;
  lockedAt: string | null;
};

export type CreateEpisodeInput = {
  id?: string;
  showId: string;
  label: string;
  seatKind: SeatKind;
  /** Omit to apply SPEC §6 defaults. */
  vetoEnabled?: boolean;
  opensAt: string;
  locksAt?: string | null;
  lockedAt?: string | null;
};

type EpisodeRow = {
  id: string;
  show_id: string;
  label: string;
  seat_kind: SeatKind;
  veto_enabled: number;
  opens_at: string;
  locks_at: string | null;
  locked_at: string | null;
};

export function isSeatKind(value: string): value is SeatKind {
  return (SEAT_KINDS as readonly string[]).includes(value);
}

/** Default on for guest_seat, off for sixty_second_open. */
export function defaultVetoEnabled(seatKind: SeatKind): boolean {
  return seatKind === "guest_seat";
}

export const DEFAULT_SHOW_ID = "show_english";

export type EpisodeErrorCode = "episode_already_open" | "invalid_open";

const EPISODE_STATUS: Record<EpisodeErrorCode, number> = {
  episode_already_open: 409,
  invalid_open: 400,
};

export class EpisodeError extends Error {
  readonly code: EpisodeErrorCode;
  readonly statusCode: number;

  constructor(code: EpisodeErrorCode, message: string) {
    super(message);
    this.name = "EpisodeError";
    this.code = code;
    this.statusCode = EPISODE_STATUS[code];
  }
}

export function countEpisodes(db: AppDb): number {
  const row = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM episodes").get();
  return row?.n ?? 0;
}

export function nextEpisodeLabel(db: AppDb): string {
  const latest = db
    .prepare<[], { label: string }>(
      `SELECT label FROM episodes ORDER BY opens_at DESC, id DESC LIMIT 1`,
    )
    .get();
  const match = latest ? /^Episode\s+(\d+)$/i.exec(latest.label.trim()) : null;
  if (match) {
    return `Episode ${Number(match[1]) + 1}`;
  }
  return `Episode ${countEpisodes(db) + 1}`;
}

/** Open the next empty board. Refuses when an unlocked episode already exists. */
export function openNextEpisode(
  db: AppDb,
  input: {
    showId?: string;
    label?: string;
    seatKind?: SeatKind;
    opensAt?: string;
  } = {},
): Episode {
  const current = getCurrentEpisode(db);
  if (current && current.lockedAt === null) {
    throw new EpisodeError(
      "episode_already_open",
      "an unlocked episode already accepts bids",
    );
  }
  const seatKind = input.seatKind ?? "guest_seat";
  if (!isSeatKind(seatKind)) {
    throw new EpisodeError("invalid_open", "seatKind must be guest_seat or sixty_second_open");
  }
  const showId = input.showId?.trim() || DEFAULT_SHOW_ID;
  const label = input.label?.trim() || nextEpisodeLabel(db);
  return createEpisode(db, {
    showId,
    label,
    seatKind,
    opensAt: input.opensAt?.trim() || new Date().toISOString(),
  });
}

export function createEpisode(db: AppDb, input: CreateEpisodeInput): Episode {
  if (!isSeatKind(input.seatKind)) {
    throw new Error(`invalid seatKind: ${input.seatKind}`);
  }
  const showId = input.showId.trim();
  const label = input.label.trim();
  const opensAt = input.opensAt.trim();
  if (!showId) {
    throw new Error("showId is required");
  }
  if (!label) {
    throw new Error("label is required");
  }
  if (!opensAt) {
    throw new Error("opensAt is required");
  }

  const episode: Episode = {
    id: input.id ?? randomUUID(),
    showId,
    label,
    seatKind: input.seatKind,
    vetoEnabled: input.vetoEnabled ?? defaultVetoEnabled(input.seatKind),
    opensAt,
    locksAt: input.locksAt ?? null,
    lockedAt: input.lockedAt ?? null,
  };

  db.prepare(
    `INSERT INTO episodes (
       id, show_id, label, seat_kind, veto_enabled, opens_at, locks_at, locked_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    episode.id,
    episode.showId,
    episode.label,
    episode.seatKind,
    episode.vetoEnabled ? 1 : 0,
    episode.opensAt,
    episode.locksAt,
    episode.lockedAt,
  );

  return episode;
}

const EPISODE_COLUMNS = `id, show_id, label, seat_kind, veto_enabled, opens_at, locks_at, locked_at`;

export function getEpisode(db: AppDb, id: string): Episode | undefined {
  const row = db
    .prepare<[string], EpisodeRow>(
      `SELECT ${EPISODE_COLUMNS} FROM episodes WHERE id = ?`,
    )
    .get(id);
  return row ? mapEpisode(row) : undefined;
}

/** Unlocked episode with the latest opensAt, else the latest episode. */
export function getCurrentEpisode(db: AppDb): Episode | undefined {
  const unlocked = db
    .prepare<[], EpisodeRow>(
      `SELECT ${EPISODE_COLUMNS} FROM episodes
       WHERE locked_at IS NULL
       ORDER BY opens_at DESC, id DESC
       LIMIT 1`,
    )
    .get();
  if (unlocked) {
    return mapEpisode(unlocked);
  }
  const latest = db
    .prepare<[], EpisodeRow>(
      `SELECT ${EPISODE_COLUMNS} FROM episodes
       ORDER BY opens_at DESC, id DESC
       LIMIT 1`,
    )
    .get();
  return latest ? mapEpisode(latest) : undefined;
}

function mapEpisode(row: EpisodeRow): Episode {
  return {
    id: row.id,
    showId: row.show_id,
    label: row.label,
    seatKind: row.seat_kind,
    vetoEnabled: row.veto_enabled === 1,
    opensAt: row.opens_at,
    locksAt: row.locks_at,
    lockedAt: row.locked_at,
  };
}
