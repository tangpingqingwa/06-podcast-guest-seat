import type { FastifyPluginAsync } from "fastify";
import {
  getCurrentEpisode,
  getEpisode,
  getLatestLockedEpisode,
  nextEpisodeLabel,
  type Episode,
} from "../../episodes.js";
import { listListingsForEpisode, type Listing } from "../../listings.js";
import { MIN_BID_USD, rankListings, type RankedListing } from "../../rank.js";
import { BOARD_CSS, STUDIO_CSS } from "../../views/skin.js";

export const BOARD_PATH = "/" as const;
export const EPISODE_BOARD_PATH = "/e/:episodeId" as const;
export const ABOUT_PATH = "/about" as const;
export const RULES_PATH = "/rules" as const;

type BoardRow = {
  id: string;
  rank: number | null;
  name: string;
  oneLiner: string;
  siteUrl: string;
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

export function displaySite(siteUrl: string): string {
  try {
    const parsed = new URL(siteUrl);
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.host}${path === "/" ? "" : path}`;
  } catch {
    return siteUrl;
  }
}

export function boardRows(listings: readonly Listing[]): BoardRow[] {
  const ranked = rankListings(listings);
  const rankedIds = new Set(ranked.map((row) => row.id));
  const visible: BoardRow[] = ranked.map((row: RankedListing) => ({
    id: row.id,
    rank: row.rank,
    name: row.name,
    oneLiner: row.oneLiner,
    siteUrl: row.siteUrl,
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
      siteUrl: row.siteUrl,
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
  css?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <style>${input.css ?? STUDIO_CSS}</style>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/"><span class="on-air">ON AIR</span> Guest Seat</a>
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

function defaultClaimBidUsd(rows: readonly BoardRow[]): number {
  const top = rows.find((row) => row.rank === 1)?.bidUsd ?? 0;
  return top > 0 ? top + 1 : MIN_BID_USD;
}

function renderShowTicket(episode: Episode | undefined): string {
  if (!episode) {
    return `<aside class="show-ticket" data-show-ticket data-episode-open="false">
  <div class="ticket-main">
    <p class="ticket-kicker">Show ticket</p>
    <p class="ticket-label">No episode open</p>
    <p class="ticket-seat">guest seat</p>
    <p class="ticket-veto">The next seat is not for sale. Polar cannot charge yet.</p>
  </div>
  <div class="ticket-stub">
    <p class="stub-state">WAIT</p>
    <p class="stub-admit">ADMIT ONE</p>
  </div>
</aside>`;
  }
  const open = episode.lockedAt === null;
  const veto =
    episode.vetoEnabled
      ? episode.seatKind === "guest_seat"
        ? "Host veto is on (default on for guest seat)."
        : "Host veto is on."
      : "Host veto is off.";
  return `<aside class="show-ticket" data-show-ticket data-episode-open="${open ? "true" : "false"}">
  <div class="ticket-main">
    <p class="ticket-kicker">Show ticket</p>
    <p class="ticket-label">${escapeHtml(episode.label)}</p>
    <p class="ticket-seat">${escapeHtml(seatLabel(episode.seatKind))}</p>
    <p class="ticket-veto">${veto}</p>
  </div>
  <div class="ticket-stub">
    <p class="stub-state">${open ? "OPEN" : "LOCK"}</p>
    <p class="stub-admit">ADMIT ONE</p>
  </div>
</aside>`;
}

function renderGuestCard(row: BoardRow, now: Date, live = false): string {
  const cue = row.vetoed ? "VETO" : row.rank === null ? "—" : `#${row.rank}`;
  const kind = row.vetoed ? "CUT" : row.rank === 1 ? "SEAT" : "HOLD";
  const prize = live && row.rank === 1 && !row.vetoed;
  const laterSeat = live && row.rank !== null && row.rank > 1 && !row.vetoed;
  const klass = row.vetoed
    ? " guest vetoed"
    : row.rank === 1
      ? " guest booked"
      : laterSeat
        ? " guest later-seat"
        : " guest";
  const laterFact = prize ? " later-fact" : "";
  const laterMark = prize ? " data-later-fact" : "";
  const veto = row.vetoed
    ? `<p class="guest-veto">Vetoed${row.vetoReason ? `: ${escapeHtml(row.vetoReason)}` : ""}</p>`
    : "";
  const go = `/go/${escapeHtml(row.id)}`;
  const name = prize
    ? `<h2 class="guest-name"><a href="${go}" data-first-click="guest">${escapeHtml(row.name)}</a></h2>`
    : laterSeat
      ? `<p class="guest-name later-name">${escapeHtml(row.name)}</p>`
      : `<h2 class="guest-name"><a href="${go}">${escapeHtml(row.name)}</a></h2>`;
  const site = laterSeat
    ? `<p class="guest-site later-go"><a href="${go}" data-later-go>${escapeHtml(displaySite(row.siteUrl))}</a></p>`
    : `<p class="guest-site"><a href="${go}">${escapeHtml(displaySite(row.siteUrl))}</a></p>`;
  const marks = `${prize ? " data-guest-prize" : ""}${laterSeat ? " data-later-seat" : ""}`;
  return `<article class="${klass.trim()}" data-listing-id="${escapeHtml(row.id)}" data-rank="${row.rank ?? ""}" data-vetoed="${row.vetoed ? "true" : "false"}"${marks}>
  <div class="cue">
    <span class="cue-num">${cue}</span>
    <span class="cue-kind">${kind}</span>
  </div>
  <div class="person">
    ${name}
    <p class="guest-line">${escapeHtml(row.oneLiner)}</p>
    ${site}
    ${veto}
  </div>
  <div class="tally">
    <p class="bid${laterFact}"${laterMark}>$${row.bidUsd}</p>
    <p class="clicks">${row.clicks} clicks</p>
    <p class="when"><time datetime="${escapeHtml(row.firstBidAt)}">${escapeHtml(relativeTime(row.firstBidAt, now))}</time></p>
  </div>
</article>`;
}

function vetoNote(episode: Episode): string {
  const state = episode.vetoEnabled ? "on" : "off";
  const guestDefault =
    episode.seatKind === "guest_seat" ? " (default on for guest seat)" : "";
  return `Host veto is ${state}${guestDefault}.`;
}

function renderLockedClaim(episode: Episode): string {
  const label = escapeHtml(episode.label);
  return `<section class="claim lock-after-open-first lock-after-open-two lock-after-open-three lock-after-open-four lock-after-open-five" id="claim" data-claim-locked data-lock-certain data-lock-409 data-lock-after-open data-lock-after-open-first data-lock-after-open-two data-lock-after-open-three data-lock-after-open-four data-lock-after-open-five>
  <h1 class="claim-title">${label} is locked</h1>
  <p class="claim-note">Rank is the bid. This episode is locked. Polar cannot charge. The next episode opens empty.</p>
  <p class="form-hint">This episode is locked. Polar cannot charge. Prior bids do not carry. Unpaid checkout does not rank.</p>
</section>`;
}

function renderClaim(input: {
  episode: Episode | undefined;
  canCharge: boolean;
  defaultBid: number;
  emptyBoard: boolean;
  nextSeat?: boolean;
}): string {
  const episode = input.episode;
  if (episode && !input.canCharge) {
    return renderLockedClaim(episode);
  }
  const seat = episode ? seatLabel(episode.seatKind) : "guest seat";
  const openEmpty = Boolean(episode && input.canCharge && input.emptyBoard);
  const nextSeat = Boolean(openEmpty && input.nextSeat && episode);
  const label = episode ? escapeHtml(episode.label) : "";
  const note = !episode
    ? "Rank is the bid. No episode is open. Polar cannot charge yet."
    : nextSeat
      ? `Rank is the bid. ${label} is open. Polar can charge. $${MIN_BID_USD} takes #1 on this empty board. ${vetoNote(episode)}`
      : openEmpty
        ? `Rank is the bid. The ${seat} is open. Polar can charge. $${MIN_BID_USD} takes #1. ${vetoNote(episode)}`
        : `Rank is the bid. ${vetoNote(episode)}`;
  const hint = !episode
    ? "No seat is for sale until the host opens an episode."
    : nextSeat
      ? `${label} is a new empty board. First paid bid of at least $${MIN_BID_USD} takes #1. Prior bids do not carry. Unpaid checkout does not rank.`
      : openEmpty
        ? `First paid bid of at least $${MIN_BID_USD} takes #1. Unpaid checkout does not rank.`
        : "Already on this episode? Enter the same site and raise. You pay only the difference.";
  const disabled = input.canCharge ? "" : " disabled";
  const live = input.canCharge ? " data-claim-live" : "";
  const openSeat = openEmpty ? " data-open-seat" : "";
  const honest = openEmpty ? " data-empty-honest" : "";
  const nextMark = nextSeat ? " data-next-seat" : "";
  const title = nextSeat
    ? `Claim ${label} for`
    : `Claim the ${escapeHtml(seat)} for`;
  return `<section class="claim" id="claim"${live}${openSeat}${honest}${nextMark}>
  <h1 class="claim-title">
    <span>${title}</span>
    <span class="bid-stepper">
      <button type="button" class="step" data-bid-step="-1" aria-label="Decrease bid by one dollar"${disabled}>−</button>
      <label class="bid-field">
        <span class="sr-only">Amount in dollars</span>
        $<input id="bid" name="bidUsd" form="bid-form" inputmode="numeric" pattern="[0-9]*" value="${input.defaultBid}"${disabled}/>
      </label>
      <button type="button" class="step" data-bid-step="1" aria-label="Increase bid by one dollar"${disabled}>+</button>
    </span>
  </h1>
  <p class="claim-note">${note}</p>
  <form id="bid-form" class="bid-form" method="post" action="/checkout"${input.canCharge ? "" : ' aria-disabled="true"'}>
    ${episode && input.canCharge ? `<input type="hidden" name="episodeId" value="${escapeHtml(episode.id)}"/>` : ""}
    <div class="fields">
      <input name="name" required maxlength="80" placeholder="Name or company"${disabled}/>
      <input name="siteUrl" type="url" required placeholder="https://your-site"${disabled}/>
      <input class="span-2" name="oneLiner" required maxlength="140" placeholder="One-liner for the host"${disabled}/>
    </div>
    <button type="submit" class="outbid"${disabled}>Outbid</button>
  </form>
  <p class="form-hint">${hint}</p>
</section>`;
}

function renderWaitingRundown(): string {
  return `<section class="empty waiting" data-empty-board data-waiting-on-host>
  <p class="empty-kicker">No seat for sale</p>
  <p class="empty-lead">No open episode yet.</p>
  <p>Skip the host desk. That session form is not a bid.</p>
  <p>The host opens the next board. Until then this claim is a preview — Polar cannot charge.</p>
  <p class="empty-path"><a href="/about#when-open">When the next episode opens</a></p>
</section>`;
}

function renderOpenEmptyRundown(episode: Episode, nextSeat = false): string {
  const label = escapeHtml(episode.label);
  const kicker = nextSeat ? `${label} is open` : "Seat is open";
  const body = nextSeat
    ? `No paid listings on ${label} yet. Polar can charge. Outbid claims this empty ${escapeHtml(seatLabel(episode.seatKind))}. Prior bids do not carry.`
    : `No paid listings on this episode yet. Polar can charge. Outbid claims the ${escapeHtml(seatLabel(episode.seatKind))} after payment.`;
  return `<section class="empty open-seat" data-empty-board data-open-seat data-empty-honest${nextSeat ? " data-next-seat" : ""}>
  <p class="empty-kicker">${kicker}</p>
  <p class="empty-lead">$${MIN_BID_USD} takes #1.</p>
  <p>${body}</p>
</section>`;
}

function renderHostOpenDesk(input: {
  nextLabel: string;
  lockedEpisode?: Episode;
}): string {
  const next = escapeHtml(input.nextLabel);
  const locked = input.lockedEpisode;
  const kicker = locked ? "Next episode" : "Host desk";
  const lead = locked
    ? `${escapeHtml(locked.label)} is locked. Open ${next} empty.`
    : "Open the next episode so guests can bid.";
  const note = locked
    ? `${escapeHtml(locked.label)} stays booked. ${next} opens empty — prior bids do not carry. Polar cannot charge on N+1 until you open it.`
    : "Guest seat opens with host veto on. Polar cannot charge until this board exists.";
  const afterLock = locked
    ? " open-after-lock-first open-after-lock-two open-after-lock-three open-after-lock-four open-after-lock-five"
    : "";
  const afterLockMarks = locked
    ? " data-open-next data-open-after-lock data-open-after-lock-first data-open-after-lock-two data-open-after-lock-three data-open-after-lock-four data-open-after-lock-five"
    : "";
  return `<section class="host-open${afterLock}" data-host-open data-host-only${afterLockMarks}>
  <p class="empty-kicker">${kicker}</p>
  <p class="empty-lead">${lead}</p>
  <p class="host-open-note" data-guest-skip>Guests skip this. This desk is for the host — it is not a bid.</p>
  <p class="host-open-note">${note}</p>
  <form id="host-open-form" class="host-open-form" method="post" action="/host/open">
    <input type="hidden" name="seatKind" value="guest_seat"/>
    <label class="host-open-label">
      <span class="sr-only">Episode label</span>
      <input name="label" maxlength="80" value="${next}" placeholder="${next}" autocomplete="off"/>
    </label>
    <input name="session" type="password" required placeholder="Host session" autocomplete="current-password"/>
    <button type="submit" class="open-next">Open ${next}</button>
  </form>
</section>`;
}

function studioShell(input: {
  episode: Episode | undefined;
  canCharge: boolean;
  emptyBoard: boolean;
}): { className: string; marks: string } {
  if (!input.episode) {
    return { className: "studio studio-waiting", marks: "" };
  }
  if (!input.canCharge) {
    return { className: "studio studio-locked", marks: "" };
  }
  if (input.emptyBoard) {
    return { className: "studio studio-open-empty", marks: " data-empty-honest" };
  }
  return { className: "studio studio-open-occupied", marks: "" };
}

function renderHostLockDesk(episode: Episode, booked: BoardRow | undefined): string {
  const label = escapeHtml(episode.label);
  const lead = booked
    ? `Lock ${label} — book ${escapeHtml(booked.name)}.`
    : `Lock ${label}. Polar cannot charge after lock.`;
  const bookedLine = booked
    ? episode.vetoEnabled
      ? `Lock books ${escapeHtml(booked.name)} at $${booked.bidUsd}, the highest remaining eligible bid. Vetoed rows stay visible. Polar cannot charge after lock.`
      : `Lock books ${escapeHtml(booked.name)} at $${booked.bidUsd}, the highest paid bid. Polar cannot charge after lock.`
    : episode.vetoEnabled
      ? "Lock books the highest remaining eligible bid. Vetoed rows stay visible. Polar cannot charge after lock."
      : "Lock books the highest paid bid. Polar cannot charge after lock.";
  return `<section class="host-open host-lock" data-host-lock data-host-only>
  <p class="empty-kicker">Lock episode</p>
  <p class="empty-lead">${lead}</p>
  <p class="host-open-note" data-guest-skip>Guests skip this. This desk is for the host — it is not a bid.</p>
  <p class="host-open-note">${bookedLine}</p>
  <form id="host-lock-form" class="host-open-form" method="post" action="/host/lock">
    <input type="hidden" name="episodeId" value="${escapeHtml(episode.id)}"/>
    <input name="session" type="password" required placeholder="Host session" autocomplete="current-password"/>
    <button type="submit" class="lock-episode">Lock ${label}</button>
  </form>
</section>`;
}

export function renderBoardHtml(
  episode: Episode | undefined,
  listings: readonly Listing[],
  now: Date = new Date(),
  path: string = "/",
  nextLabel: string = "Episode 1",
  priorLocked?: Episode,
): string {
  const canCharge = Boolean(episode && episode.lockedAt === null);
  const rows = episode ? boardRows(listings) : [];
  const nextSeat = Boolean(canCharge && rows.length === 0 && priorLocked);
  const rundown =
    !episode
      ? renderWaitingRundown()
      : rows.length === 0
        ? canCharge
          ? renderOpenEmptyRundown(episode, nextSeat)
          : `<p class="empty" data-empty-board>No paid listings on this episode yet.</p>`
        : `<div class="rundown" data-rundown>
    <div class="rundown-head"><span>Rundown</span><span>Rank is the bid</span></div>
    ${rows.map((row) => renderGuestCard(row, now, canCharge)).join("\n    ")}
  </div>`;

  const lockedEpisode = episode && !canCharge ? episode : undefined;
  const booked = rows.find((row) => row.rank === 1);
  const claim = renderClaim({
    episode,
    canCharge,
    defaultBid: defaultClaimBidUsd(rows),
    emptyBoard: rows.length === 0,
    nextSeat,
  });
  const desk = !canCharge
    ? renderHostOpenDesk({ nextLabel, lockedEpisode })
    : episode && rows.length > 0
      ? renderHostLockDesk(episode, booked)
      : "";
  const ticket = renderShowTicket(episode);
  const shell = studioShell({
    episode,
    canCharge,
    emptyBoard: rows.length === 0,
  });
  const occupiedLive = Boolean(canCharge && rows.length > 0);
  const studio = nextSeat
    ? `${claim}
${ticket}
${rundown}`
    : lockedEpisode
      ? `${claim}
${ticket}
${desk}
${rundown}`
      : `${ticket}
${desk}
${claim}
${rundown}`;
  return renderLayout({
    title: episode ? `${episode.label} · Podcast Guest Seat` : "Podcast Guest Seat",
    path,
    css: occupiedLive ? BOARD_CSS : STUDIO_CSS,
    body: `<div class="${shell.className}"${shell.marks}>
${studio}
</div>
<script>
  (function () {
    var min = ${MIN_BID_USD};
    var input = document.getElementById("bid");
    if (!input || input.disabled) return;
    function parseBid(raw) {
      var n = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
      return Number.isFinite(n) ? Math.max(min, n) : min;
    }
    document.querySelectorAll("[data-bid-step]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        input.value = String(Math.max(min, parseBid(input.value) + Number(btn.getAttribute("data-bid-step"))));
      });
    });
  })();
</script>`,
  });
}

export function renderAboutHtml(): string {
  return renderLayout({
    title: "About · Podcast Guest Seat",
    path: "/about",
    body: `<article class="doc">
<h1>About</h1>
<p>This is a public auction for the next episode’s <strong>guest seat</strong> or a <strong>60-second open</strong>. People and companies bid whole US dollars. Rank is the bid — nothing else.</p>
<p id="when-open">The host opens each episode from the desk on <a href="/">/</a>. Until that board exists, the claim is a preview — Polar cannot charge. When episode N opens, the first paid bid of at least $5 takes #1.</p>
<p>Cadence is <strong>per episode</strong>. When the host locks episode N, the highest remaining eligible bid is booked. Episode N+1 opens empty. Prior bids do not carry.</p>
<p>The host can still say no. <strong>Veto defaults on for guest seat</strong> and off for a 60-second open. A vetoed row stays visible with a public reason.</p>
<p>Clicks go through this board so the click count is public. Tracking query strings are stripped. Chat invites and adult platforms are rejected.</p>
</article>`,
  });
}

export function renderRulesHtml(): string {
  return renderLayout({
    title: "Rules · Podcast Guest Seat",
    path: "/rules",
    body: `<article class="doc">
<h1>Rules</h1>
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
<p>A show may flip the flag before the first paid bid. After the first paid bid, the flag is frozen. Host may veto any listed bidder with a public reason. Money already paid is not refunded here. The vetoed row stays visible. Rank recomputes among remaining paid listings. Older still wins ties. When the flag is off, the highest paid bid is booked at lock.</p>
</article>`,
  });
}

export function renderCheckoutErrorHtml(code: string): string {
  const locked = code === "episode_locked";
  const mark = locked ? " data-lock-409" : "";
  return renderLayout({
    title: "Checkout · Podcast Guest Seat",
    path: "/",
    body: `<article class="doc"${mark}>
<h1>Checkout did not start</h1>
<p class="empty">${escapeHtml(code)}. Polar did not charge.</p>
<p><a href="/">Back to the rundown</a></p>
</article>`,
  });
}

export function renderHostOpenErrorHtml(code: string): string {
  return renderLayout({
    title: "Host · Podcast Guest Seat",
    path: "/",
    body: `<article class="doc">
<h1>Episode did not open</h1>
<p class="empty">${escapeHtml(code)}. Polar cannot charge yet.</p>
<p><a href="/">Back to the rundown</a></p>
</article>`,
  });
}

export function renderHostLockErrorHtml(code: string): string {
  return renderLayout({
    title: "Host · Podcast Guest Seat",
    path: "/",
    body: `<article class="doc">
<h1>Episode did not lock</h1>
<p class="empty">${escapeHtml(code)}. Polar can still charge until this episode locks.</p>
<p><a href="/">Back to the rundown</a></p>
</article>`,
  });
}

export const pageRoutes: FastifyPluginAsync = async (app) => {
  app.get(BOARD_PATH, async (_request, reply) => {
    const episode = getCurrentEpisode(app.db);
    const listings = episode ? listListingsForEpisode(app.db, episode.id) : [];
    const priorLocked =
      episode && episode.lockedAt === null
        ? getLatestLockedEpisode(app.db, episode.id)
        : undefined;
    return reply
      .type("text/html; charset=utf-8")
      .send(
        renderBoardHtml(
          episode,
          listings,
          new Date(),
          "/",
          nextEpisodeLabel(app.db),
          priorLocked,
        ),
      );
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
      const priorLocked =
        episode.lockedAt === null
          ? getLatestLockedEpisode(app.db, episode.id)
          : undefined;
      return reply
        .type("text/html; charset=utf-8")
        .send(
          renderBoardHtml(
            episode,
            listings,
            new Date(),
            `/e/${episode.id}`,
            nextEpisodeLabel(app.db),
            priorLocked,
          ),
        );
    },
  );

  app.get(ABOUT_PATH, async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(renderAboutHtml());
  });

  app.get(RULES_PATH, async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(renderRulesHtml());
  });
};
