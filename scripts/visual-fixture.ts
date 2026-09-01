import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db.js";
import { createEpisode } from "../src/episodes.js";
import { insertListing, type Listing } from "../src/listings.js";

export const VISUAL_FIXTURE_EPISODE_ID = "ep_visual_reference";
export const VISUAL_FIXTURE_ROWS = [
  ["lst_audio_one", "Mara Chen", "A civic researcher on asking better questions before a city builds a new service.", 17000, "https://mara-chen.example/"],
  ["lst_audio_two", "Ibrahim Okafor", "A product lead on making humane decisions when a small team’s roadmap keeps moving.", 16000, "https://ibrahim-okafor.example/"],
  ["lst_audio_three", "Juniper Works", "A two-person studio on the hidden craft of maintaining tools people rely on.", 14028, "https://juniper-works.example/"],
  ["lst_audio_four", "Leena Ortiz", "A neighborhood organizer on what survives when a good idea meets a real community.", 13005, "https://leena-ortiz.example/"],
  ["lst_audio_five", "Northstar Commons", "A cooperative’s field notes on trust, governance, and useful software.", 12080, "https://northstar-commons.example/"],
  ["lst_audio_six", "Theo Vale", "An editor’s case for leaving room in the process for better questions to arrive.", 11004, "https://theo-vale.example/"],
] as const;

const CREATED_AT = [
  "2026-08-29T07:00:00.000Z",
  "2026-08-29T08:00:00.000Z",
  "2026-08-29T09:00:00.000Z",
  "2026-08-29T10:00:00.000Z",
  "2026-08-29T11:00:00.000Z",
  "2026-08-29T12:00:00.000Z",
] as const;
const CLICKS = [148, 92, 64, 48, 27, 12] as const;

export function seedVisualFixture(databasePath: string): Listing[] {
  const path = resolve(databasePath);
  if (!path.startsWith("/private/tmp/")) {
    throw new Error("visual fixture requires a disposable /private/tmp database");
  }
  if (existsSync(path)) {
    throw new Error("visual fixture refuses to overwrite an existing database");
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = openDatabase(path);
  try {
    const episode = createEpisode(db, {
      id: VISUAL_FIXTURE_EPISODE_ID,
      showId: "show_guest_seat",
      label: "Episode 42",
      seatKind: "guest_seat",
      vetoEnabled: true,
      opensAt: "2026-08-29T06:00:00.000Z",
      locksAt: "2026-09-05T06:00:00.000Z",
    });
    return VISUAL_FIXTURE_ROWS.map(
      ([id, name, oneLiner, bidUsd, siteUrl], index) =>
        insertListing(db, {
          id,
          episodeId: episode.id,
          name,
          siteUrl,
          oneLiner,
          bidUsd,
          firstBidAt: CREATED_AT[index]!,
          paidAt: CREATED_AT[index]!,
          clicks: CLICKS[index]!,
        }),
    );
  } finally {
    db.close();
  }
}

function runFromCli(): void {
  const requested = process.argv[2] ?? process.env.DATABASE_PATH;
  if (!requested || requested === ":memory:") {
    throw new Error("visual fixture requires a disposable file-backed DATABASE_PATH");
  }
  const rows = seedVisualFixture(requested);
  for (const row of rows) {
    process.stdout.write(
      `${row.id}\t${row.name}\t${row.bidUsd}\t${row.clicks}\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFromCli();
}
