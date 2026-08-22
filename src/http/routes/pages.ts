import type { FastifyPluginAsync } from "fastify";
import { getCurrentEpisode, getEpisode, type Episode } from "../../episodes.js";
import { listListingsForEpisode, type Listing } from "../../listings.js";
import { rankListings, type RankedListing } from "../../rank.js";

export const BOARD_PATH = "/" as const;
export const EPISODE_BOARD_PATH = "/e/:episodeId" as const;
export const ABOUT_PATH = "/about" as const;
export const RULES_PATH = "/rules" as const;

type BoardRow = {
  id: string;
  rank: number | null;
  name: string;
  oneLiner: string;
  bidUsd: number;
  firstBidAt: string;
  clicks: number;
  vetoed: boolean;
  vetoReason: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return iso;
  }
  const deltaSec = Math.round((now.getTime() - then) / 1000);
  if (deltaSec < 45) return "just now";
  if (deltaSec < 90) return "1 minute ago";
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)} minutes ago`;
  if (deltaSec < 5400) return "1 hour ago";
  if (deltaSec < 86400) return `${Math.round(deltaSec / 3600)} hours ago`;
  if (deltaSec < 172800) return "yesterday";
  return `${Math.round(deltaSec / 86400)} days ago`;
}

export function boardRows(listings: readonly Listing[]): BoardRow[] {
  const ranked = rankListings(listings);
  const rankedIds = new Set(ranked.map((row) => row.id));
  const visible: BoardRow[] = ranked.map((row: RankedListing) => ({
    id: row.id,
    rank: row.rank,
    name: row.name,
    oneLiner: row.oneLiner,
    bidUsd: row.bidUsd,
    firstBidAt: row.firstBidAt,
    clicks: row.clicks,
    vetoed: false,
    vetoReason: null,
  }));
  const vetoed = listings
    .filter((row) => !rankedIds.has(row.id))
    .sort((a, b) => {
      if (a.firstBidAt !== b.firstBidAt) {
        return a.firstBidAt < b.firstBidAt ? -1 : 1;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((row) => ({
      id: row.id,
      rank: null,
      name: row.name,
      oneLiner: row.oneLiner,
      bidUsd: row.bidUsd,
      firstBidAt: row.firstBidAt,
      clicks: row.clicks,
      vetoed: row.vetoedAt !== null,
      vetoReason: row.vetoReason,
    }));
  return [...visible, ...vetoed];
}

function navLink(href: string, label: string, current: string): string {
  const active = href === current ? ' aria-current="page"' : "";
  return `<a href="${href}"${active}>${escapeHtml(label)}</a>`;
}

function renderLayout(input: {
  title: string;
  path: string;
  body: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; color: #111; background: #fafafa; line-height: 1.5; }
    header, main, footer { max-width: 44rem; margin: 0 auto; padding: 1rem 1.25rem; }
    header { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; }
    nav { display: flex; gap: 0.85rem; }
    a { color: #0b57d0; }
    h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { text-align: left; padding: 0.55rem 0.65rem; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
    .muted { color: #555; }
    .empty { padding: 1rem 0; }
    footer { color: #555; font-size: 0.9rem; }
  </style>
</head>
<body>
  <header>
    <a href="/">Podcast Guest Seat</a>
    <nav aria-label="Main">
      ${navLink("/", "Board", input.path)}
      ${navLink("/about", "About", input.path)}
      ${navLink("/rules", "Rules", input.path)}
    </nav>
  </header>
  <main>
    ${input.body}
  </main>
  <footer>
    Independent board. Not affiliated with listed people, companies, or Polar beyond payments.
  </footer>
</body>
</html>
`;
}

function seatLabel(kind: Episode["seatKind"]): string {
  return kind === "guest_seat" ? "guest seat" : "60-second open";
}

export function renderBoardHtml(
  episode: Episode | undefined,
  listings: readonly Listing[],
  now: Date = new Date(),
  path: string = "/",
): string {
  if (!episode) {
    return renderLayout({
      title: "Podcast Guest Seat",
      path,
      body: `<h1>Podcast Guest Seat</h1>
<p>Bid dollars to sit in the next episode. Rank is the bid.</p>
<p class="empty" data-empty-board>No open episode yet.</p>`,
    });
  }

  const rows = boardRows(listings);
  const table =
    rows.length === 0
      ? `<p class="empty" data-empty-board>No paid listings on this episode yet.</p>`
      : `<table>
  <thead>
    <tr><th>Rank</th><th>Name</th><th>Bid</th><th>When</th><th>Clicks</th></tr>
  </thead>
  <tbody>
    ${rows
      .map((row) => {
        const rank = row.vetoed ? "vetoed" : row.rank === null ? "—" : `#${row.rank}`;
        const veto = row.vetoed
          ? `<p class="muted">Vetoed${row.vetoReason ? `: ${escapeHtml(row.vetoReason)}` : ""}</p>`
          : "";
        return `<tr data-listing-id="${escapeHtml(row.id)}" data-rank="${row.rank ?? ""}" data-vetoed="${row.vetoed ? "true" : "false"}">
      <td>${rank}</td>
      <td>
        <a href="/go/${escapeHtml(row.id)}">${escapeHtml(row.name)}</a>
        <p class="muted">${escapeHtml(row.oneLiner)}</p>
        ${veto}
      </td>
      <td>$${row.bidUsd}</td>
      <td><time datetime="${escapeHtml(row.firstBidAt)}">${escapeHtml(relativeTime(row.firstBidAt, now))}</time></td>
      <td>${row.clicks} clicks</td>
    </tr>`;
      })
      .join("\n    ")}
  </tbody>
</table>`;

  return renderLayout({
    title: `${episode.label} · Podcast Guest Seat`,
    path,
    body: `<h1>${escapeHtml(episode.label)}</h1>
<p>This episode’s ${escapeHtml(seatLabel(episode.seatKind))}. Rank is the bid. Host veto is ${
      episode.vetoEnabled ? "on" : "off"
    }${episode.seatKind === "guest_seat" ? " (default on for guest seat)" : ""}.</p>
${table}`,
  });
}

export function renderAboutHtml(): string {
  return renderLayout({
    title: "About · Podcast Guest Seat",
    path: "/about",
    body: `<h1>About</h1>
<p>This is a public auction for the next episode’s <strong>guest seat</strong> or a <strong>60-second open</strong>. People and companies bid whole US dollars. Rank is the bid — nothing else.</p>
<p>Cadence is <strong>per episode</strong>. When the host locks episode N, the highest remaining eligible bid is booked. Episode N+1 opens empty. Prior bids do not carry.</p>
<p>The host can still say no. <strong>Veto defaults on for guest seat</strong> and off for a 60-second open. A vetoed row stays visible with a public reason.</p>
<p>Clicks go through this board so the click count is public. Tracking query strings are stripped. Chat invites and adult platforms are rejected.</p>`,
  });
}

export function renderRulesHtml(): string {
  return renderLayout({
    title: "Rules · Podcast Guest Seat",
    path: "/rules",
    body: `<h1>Rules</h1>
<p>A bidder can predict rank from this page alone.</p>
<table>
  <tbody>
    <tr><th>Currency</th><td>Whole US dollars. Integer cents are not a v1 input.</td></tr>
    <tr><th>Minimum</th><td><strong>$5</strong> first bid.</td></tr>
    <tr><th>Increment</th><td>$1.</td></tr>
    <tr><th>Rank</th><td>Rank is the bid. Below #1 still lists at the rank that bid can take.</td></tr>
    <tr><th>Ties</th><td>Same bidUsd: the <strong>older</strong> firstBidAt keeps the higher rank.</td></tr>
    <tr><th>Raise</th><td>Same listing (same episode + same site identity) may raise. New total must be at least $1 above the current #1. Payer pays only the <strong>difference</strong>.</td></tr>
    <tr><th>Identity</th><td>Another bidder cannot steal a listing by paying only that difference. They pay a full new bid.</td></tr>
    <tr><th>Claim</th><td>A completed payment claims the rank. Unpaid checkout does not.</td></tr>
    <tr><th>Tracking</th><td>Query strings are stripped from listing URLs. Affiliate / referral / UTM params do not survive. /go never forwards query junk.</td></tr>
    <tr><th>Shorteners</th><td>Not allowed as the stored URL.</td></tr>
    <tr><th>Chat / NSFW</th><td>Rejected. Telegram, WhatsApp, Discord, Messenger, Signal, and similar invite hosts. Sexual / adult platforms (OnlyFans, Pornhub, Fansly, and the denylist in code).</td></tr>
  </tbody>
</table>
<h2>Host veto</h2>
<p>Veto is a documented flag, <strong>default on for guest seat</strong> (<code>vetoEnabled: true</code> when <code>seatKind === "guest_seat"</code>). Default off for a 60-second open.</p>
<p>A show may flip the flag before the first paid bid. After the first paid bid, the flag is frozen. Host may veto any listed bidder with a public reason. Money already paid is not refunded here. The vetoed row stays visible. Rank recomputes among remaining paid listings. Older still wins ties. When the flag is off, the highest paid bid is booked at lock.</p>`,
  });
}

export const pageRoutes: FastifyPluginAsync = async (app) => {
  app.get(BOARD_PATH, async (_request, reply) => {
    const episode = getCurrentEpisode(app.db);
    const listings = episode ? listListingsForEpisode(app.db, episode.id) : [];
    return reply
      .type("text/html; charset=utf-8")
      .send(renderBoardHtml(episode, listings));
  });

  app.get<{ Params: { episodeId: string } }>(
    EPISODE_BOARD_PATH,
    async (request, reply) => {
      const episode = getEpisode(app.db, request.params.episodeId);
      if (!episode) {
        return reply.code(404).type("text/html; charset=utf-8").send(
          renderLayout({
            title: "Episode not found · Podcast Guest Seat",
            path: "/",
            body: `<h1>Episode not found</h1><p class="empty">No board for that id.</p>`,
          }),
        );
      }
      const listings = listListingsForEpisode(app.db, episode.id);
      return reply
        .type("text/html; charset=utf-8")
        .send(renderBoardHtml(episode, listings, new Date(), `/e/${episode.id}`));
    },
  );

  app.get(ABOUT_PATH, async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(renderAboutHtml());
  });

  app.get(RULES_PATH, async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(renderRulesHtml());
  });
};
