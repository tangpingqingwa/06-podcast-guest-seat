import type { FastifyPluginAsync } from "fastify";
import {
  ensureCurrentOpenEpisode,
  getCurrentEpisode,
  getEpisode,
  getLatestLockedEpisode,
  isEpisodeLockDue,
  isEpisodeLockMalformed,
  nextEpisodeLabel,
  rolloverEpisodeIfDue,
  type Episode,
} from "../../episodes.js";
import { listListingsForEpisode, siteIdentity, type Listing } from "../../listings.js";
import {
  isPaidListing,
  livePaidListings,
  MIN_BID_USD,
  paidListings,
  rankListings,
  type RankedListing,
} from "../../rank.js";
import { canonicalizeSiteUrl } from "../../hygiene.js";
import { BOARD_CSS, STUDIO_CSS } from "../../views/skin.js";

function publicCss(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    /waffo|fixture|reference|outbid|local-only|test-only|implementation|development/i.test(comment)
      ? ""
      : comment,
  );
}

export const BOARD_PATH = "/" as const;
export const EPISODE_INDEX_PATH = "/e" as const;
export const EPISODE_BOARD_PATH = "/e/:episodeId" as const;
export const ABOUT_PATH = "/about" as const;
export const RULES_PATH = "/rules" as const;

type ContextMode = "current" | "episode";

type ContextState = {
  mode: ContextMode;
  currentHref: string;
  perEpisodeHref: string;
};

type SearchEntry = {
  kind: "episode" | "guest";
  href: string;
  title: string;
  detail: string;
  summary: string;
  searchText: string;
};

const DEFAULT_CONTEXT: ContextState = {
  mode: "current",
  currentHref: BOARD_PATH,
  perEpisodeHref: EPISODE_INDEX_PATH,
};

function episodePath(id: string): string {
  return `/e/${encodeURIComponent(id)}`;
}

type BoardRow = {
  id: string;
  rank: number | null;
  name: string;
  oneLiner: string;
  siteUrl: string;
  bidUsd: number;
  firstBidAt: string;
  paidAt: string;
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

export function boardRows(
  listings: readonly Listing[],
  now?: Date,
): BoardRow[] {
  const paid =
    now !== undefined ? livePaidListings(listings, now) : paidListings(listings);
  const ranked = rankListings(paid, undefined, now);
  const rankedIds = new Set(ranked.map((row) => row.id));
  const visible: BoardRow[] = ranked.map((row: RankedListing) => ({
    id: row.id,
    rank: row.rank,
    name: row.name,
    oneLiner: row.oneLiner,
    siteUrl: row.siteUrl,
    bidUsd: row.bidUsd,
    firstBidAt: row.firstBidAt,
    paidAt: row.paidAt,
    clicks: row.clicks,
    vetoed: false,
    vetoReason: null,
  }));
  const vetoed = paid
    .filter((row) => !rankedIds.has(row.id) && row.vetoedAt !== null)
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
      paidAt: row.paidAt,
      clicks: row.clicks,
      vetoed: true,
      vetoReason: row.vetoReason,
    }));
  return [...visible, ...vetoed];
}

export type LiveListingRef = {
  identity: string;
  bidUsd: number;
  name?: string;
  oneLiner?: string;
};

/** Occupied live listings a returning guest can raise. Vetoed rows are not a raise. */
function liveListingRefs(rows: readonly BoardRow[]): LiveListingRef[] {
  return rows
    .filter((row) => !row.vetoed && row.rank !== null)
    .map((row) => ({
      identity: siteIdentity(row.siteUrl),
      bidUsd: row.bidUsd,
      name: row.name,
      oneLiner: row.oneLiner,
    }));
}

/** Host + path from a guest-typed site, including a missing https://. */
export function siteIdentityFromGuestInput(raw: string): string | undefined {
  try {
    return siteIdentity(canonicalizeSiteUrl(raw));
  } catch {
    return undefined;
  }
}

/** Same episode + same site identity is a raise. Waffo bills only the difference. */
export function matchLiveListing(
  rawSiteUrl: string,
  listings: readonly LiveListingRef[],
): LiveListingRef | undefined {
  const identity = siteIdentityFromGuestInput(rawSiteUrl);
  if (!identity) return undefined;
  return listings.find((row) => row.identity === identity);
}

/**
 * A small, route-free function rail keeps the board useful without inventing
 * category routes that the guest-seat domain does not model. The menu is
 * intentionally finite and the client behavior only changes local state.
 */
function renderFunctionRail(): string {
  return `<nav class="function-rail" aria-label="Categories" data-function-rail data-slot="category-rail">
  <button class="rail-chip" type="button" data-function="all" aria-pressed="true">All seats</button>
  <button class="rail-chip" type="button" data-function="guest_seat" aria-pressed="false">Guest seat</button>
  <button class="rail-chip" type="button" data-function="sixty_second_open" aria-pressed="false">60-second open</button>
  <button class="rail-chip" type="button" data-function="on-mic" aria-pressed="false">On the mic</button>
  <button class="rail-chip rail-more" type="button" data-function-more aria-expanded="false">More cues</button>
  <div class="rail-menu" data-function-menu hidden>
    <button type="button" data-function="in-wings" aria-pressed="false">In the wings</button>
    <button type="button" data-function="vetoed" aria-pressed="false">Vetoed</button>
    <button type="button" data-function="host-notes" aria-pressed="false">Host notes</button>
    <button type="button" data-function="episode-history" aria-pressed="false">Episode history</button>
  </div>
</nav>`;
}

function renderCueLedger(episode: Episode | undefined): string {
  const seat = episode ? seatLabel(episode.seatKind) : "guest seat";
  const state = !episode
    ? "Opening next board"
    : episode.lockedAt === null
      ? "Live board"
      : "Locked archive";
  const veto = episode
    ? episode.vetoEnabled
      ? "Veto enabled"
      : "Veto off"
    : "Automatic opening";
  return [
    '<section class="cue-ledger" data-cue-ledger aria-label="Episode cue ledger">',
    '  <p class="cue-ledger-kicker">Cue ledger</p>',
    '  <dl class="cue-ledger-list">',
    '    <div><dt>Seat</dt><dd>' + escapeHtml(seat) + "</dd></div>",
    '    <div><dt>State</dt><dd>' + state + "</dd></div>",
    '    <div><dt>Host</dt><dd>' + veto + "</dd></div>",
    "  </dl>",
    '  <p class="cue-ledger-note">Paid rows only. Rank is the bid.</p>',
    "</section>",
  ].join("\n");
}

function navLink(href: string, label: string, current: string): string {
  const active = href === current ? ' aria-current="page"' : "";
  return `<a href="${href}"${active}>${escapeHtml(label)}</a>`;
}

export const MAKER_CONTACT_EMAIL = "tangpingqingwa@gmail.com";

/** A quiet production credit shared by every server-rendered public page. */
export function renderMakerFooter(): string {
  const email = escapeHtml(MAKER_CONTACT_EMAIL);
  return `<footer class="maker-footer" data-maker-contact="">
    <p>Built by <a href="mailto:${email}">${email}</a></p>
  </footer>`;
}

function renderContextTabs(context: ContextState): string {
  const currentSelected = context.mode === "current";
  const episodeSelected = context.mode === "episode";
  const currentMarks = currentSelected
    ? ' aria-selected="true" aria-current="page"'
    : ' aria-selected="false"';
  const episodeMarks = episodeSelected
    ? ' aria-selected="true" aria-current="page"'
    : ' aria-selected="false"';
  return `<div class="ranking-tabs" role="tablist" aria-label="Rundown context" data-slot="period-tabs">
  <button class="ranking-tab" type="button" role="tab" data-context-href="${escapeHtml(context.currentHref)}" data-context-tab="current"${currentMarks}>Current</button>
  <button class="ranking-tab" type="button" role="tab" data-context-href="${escapeHtml(context.perEpisodeHref)}" data-context-tab="episode"${episodeMarks}>Per episode</button>
</div>`;
}

function renderSearchPopover(entries: readonly SearchEntry[]): string {
  const results = entries
    .map(
      (entry) => `<a class="search-result" role="option" data-search-result data-search-text="${escapeHtml(entry.searchText.toLowerCase())}" href="${escapeHtml(entry.href)}" hidden>
    <span class="search-result-kind">${entry.kind === "episode" ? "Episode" : "Guest"}</span>
    <strong class="search-result-title">${escapeHtml(entry.title)}</strong>
    <span class="search-result-detail">${escapeHtml(entry.detail)}</span>
    ${entry.summary ? `<span class="search-result-summary">${escapeHtml(entry.summary)}</span>` : ""}
  </a>`,
    )
    .join("\n  ");
  return `<div class="search-popover" id="rundown-search" role="search" aria-label="Search paid guests and episodes" hidden>
  <div class="search-toolbar">
    <label class="sr-only" for="rundown-search-input">Search paid guests and episodes</label>
    <input id="rundown-search-input" class="search-input" type="search" placeholder="Search guests or episodes" autocomplete="off" spellcheck="false"/>
    <button class="search-close" type="button" data-search-close aria-label="Close search">Close</button>
  </div>
  <p class="search-prompt" data-search-prompt>Search paid guests or episodes.</p>
  <p class="search-empty" data-search-empty hidden>No matching paid guests or episodes.</p>
  <div class="search-results" data-search-results role="listbox" aria-live="polite">
  ${results}
  </div>
</div>`;
}

function renderLayout(input: {
  title: string;
  path: string;
  body: string;
  css?: string;
  context?: ContextState;
  search?: readonly SearchEntry[];
  description?: string;
  canonicalPath?: string;
  noIndex?: boolean;
}): string {
  const siteUrl = "https://podcastseat.lol";
  const siteName = "Podcast Guest Seat";
  const defaultDescription =
    "Discover podcast guests competing for the featured seat on a transparent rolling seven-day studio rundown. Rank is the bid.";
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description ?? defaultDescription);
  const canonicalPath = input.canonicalPath ??
    (input.path === "/about" ? "/about" : input.path === "/rules" ? "/rules" : "/");
  const canonical = `${siteUrl}${canonicalPath}`;
  const noIndex = input.noIndex ?? /(checkout|payment|return|host)/i.test(input.title);
  const robots = noIndex
    ? "noindex,nofollow"
    : "index,follow,max-image-preview:large,max-snippet:-1";
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteName,
    url: siteUrl,
    description: input.description ?? defaultDescription,
    inLanguage: "en",
    isAccessibleForFree: true,
  }).replace(/</g, "\\u003c");
  const context = input.context ?? DEFAULT_CONTEXT;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="/icons/brand-mark.svg">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="canonical" href="${canonical}">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="robots" content="${robots}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${siteName}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${siteUrl}/icons/brand-mark.png">
  <meta property="og:image:width" content="512">
  <meta property="og:image:height" content="512">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${siteUrl}/icons/brand-mark.png">
  <script type="application/ld+json">${structuredData}</script>
  <style>${publicCss(input.css ?? STUDIO_CSS)}</style>
</head>
<body>
  <header class="site-header" data-slot="site-header">
    <div class="header-shell" data-slot="shell">
      <a class="brand" href="/" aria-label="Guest Seat Studio Rundown" data-slot="brand">
        <img class="brand-mark" src="/icons/brand-mark.svg" width="30" height="30" alt="" aria-hidden="true">
        <span class="brand-wordmark">Guest Seat</span>
        <span class="brand-descriptor">STUDIO RUNDOWN</span>
      </a>
      <div class="header-cluster">
        <nav aria-label="Main" data-slot="primary-nav">
        ${navLink("/", "Rundown", input.path)}
        ${navLink("/about", "About", input.path)}
        ${navLink("/rules", "Rules", input.path)}
        </nav>
        <div class="header-actions">
          <button class="header-icon search-toggle" type="button" aria-label="Search the rundown" aria-expanded="false" aria-controls="rundown-search" data-search-toggle>
            Search
          </button>
          <button class="header-icon theme-toggle" type="button" aria-label="Switch to dark mode" aria-pressed="false" data-theme-toggle>
            <span data-theme-label>Dark mode</span>
          </button>
        </div>
      </div>
    </div>
    ${renderSearchPopover(input.search ?? [])}
  </header>
  <main data-slot="home-shell">
    ${input.body}
  </main>
  <footer>
    Independent board. Listing details are supplied by the people and companies shown.
  </footer>
  ${renderMakerFooter()}
  <script>
    (function () {
      var root = document.documentElement;
      var toggle = document.querySelector("[data-theme-toggle]");
      var search = document.querySelector("[data-search-toggle]");
      var searchPanel = document.getElementById("rundown-search");
      var searchInput = document.getElementById("rundown-search-input");
      var searchClose = document.querySelector("[data-search-close]");
      var searchPrompt = document.querySelector("[data-search-prompt]");
      var searchEmpty = document.querySelector("[data-search-empty]");
      var searchResults = searchPanel ? searchPanel.querySelectorAll("[data-search-result]") : [];
      function setTheme(theme) {
        root.setAttribute("data-theme", theme);
        if (toggle) {
          toggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
          toggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
          var themeLabel = toggle.querySelector("[data-theme-label]");
          if (themeLabel) themeLabel.textContent = theme === "dark" ? "Light mode" : "Dark mode";
        }
        try { window.localStorage.setItem("guest-seat-theme", theme); } catch (err) {}
      }
      var saved = "";
      try { saved = window.localStorage.getItem("guest-seat-theme") || ""; } catch (err) {}
      var initial = saved === "dark" || root.getAttribute("data-theme") === "dark" ? "dark" : "light";
      setTheme(initial);
      if (toggle) toggle.addEventListener("click", function () { setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark"); });
      function syncSearch() {
        var query = String(searchInput && searchInput.value || "").trim().toLowerCase();
        var matches = 0;
        searchResults.forEach(function (result) {
          var text = String(result.getAttribute("data-search-text") || "");
          var visible = Boolean(query && text.indexOf(query) !== -1);
          if (visible) { result.removeAttribute("hidden"); matches += 1; }
          else result.setAttribute("hidden", "");
        });
        if (searchPrompt) searchPrompt.hidden = Boolean(query);
        if (searchEmpty) searchEmpty.hidden = !query || matches > 0;
      }
      function setSearch(open, restoreFocus) {
        if (!search || !searchPanel) return;
        search.setAttribute("aria-expanded", open ? "true" : "false");
        searchPanel.hidden = !open;
        if (open) {
          syncSearch();
          if (searchInput) searchInput.focus();
        } else {
          if (searchInput) searchInput.value = "";
          syncSearch();
          if (restoreFocus) search.focus();
        }
      }
      if (search) search.addEventListener("click", function () {
        setSearch(search.getAttribute("aria-expanded") !== "true", false);
      });
      if (searchInput) searchInput.addEventListener("input", syncSearch);
      if (searchClose) searchClose.addEventListener("click", function () { setSearch(false, true); });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && searchPanel && !searchPanel.hidden) {
          event.preventDefault();
          setSearch(false, true);
        }
      });
      document.addEventListener("click", function (event) {
        if (!searchPanel || searchPanel.hidden) return;
        if (event.target === search || searchPanel.contains(event.target)) return;
        setSearch(false, false);
      });
      document.querySelectorAll("[data-context-tab]").forEach(function (tab) {
        tab.addEventListener("click", function () {
          var target = tab.getAttribute("data-context-href");
          if (target) window.location.assign(target);
        });
      });
    })();
  </script>
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

function searchEntriesForBoard(
  episode: Episode | undefined,
  rows: readonly BoardRow[],
  path: string,
): SearchEntry[] {
  if (!episode) return [];
  const episodeHref = path === BOARD_PATH ? BOARD_PATH : episodePath(episode.id);
  const episodeState = episode.lockedAt === null ? "current open episode" : "locked episode";
  const entries: SearchEntry[] = [
    {
      kind: "episode",
      href: episodeHref,
      title: episode.label,
      detail: seatLabel(episode.seatKind),
      summary: episodeState,
      searchText: `${episode.label} ${seatLabel(episode.seatKind)} ${episodeState}`,
    },
  ];
  for (const row of rows) {
    const status = row.vetoed ? "vetoed" : row.rank === null ? "listed" : `rank ${row.rank}`;
    entries.push({
      kind: "guest",
      href: `/go/${encodeURIComponent(row.id)}`,
      title: row.name,
      detail: `${episode.label} · ${displaySite(row.siteUrl)} · ${status}`,
      summary: row.oneLiner,
      searchText: `${row.name} ${displaySite(row.siteUrl)} ${row.oneLiner} ${episode.label} ${status}`,
    });
  }
  return entries;
}

function renderShowTicket(
  episode: Episode | undefined,
  context: ContextState = DEFAULT_CONTEXT,
): string {
  if (!episode) {
    return `<aside class="show-ticket" data-show-ticket data-episode-slate data-slot="stats-pill" data-episode-open="false">
  <div class="ticket-main">
    <p class="ticket-kicker">Show ticket</p>
    <p class="ticket-label">Next board opens automatically</p>
    <p class="ticket-seat">guest seat</p>
    <p class="ticket-veto">Visit the rundown to open the next empty seat.</p>
  </div>
  <div class="ticket-stub">
    <p class="stub-state">WAIT</p>
    <p class="stub-admit">ADMIT ONE</p>
  </div>
</aside>
<div class="mobile-context" aria-label="Rundown context">
  ${renderContextTabs(context)}
</div>`;
  }
  const open = episode.lockedAt === null;
  const veto = episode.vetoEnabled
    ? "Host review is on."
    : "Host review is off.";
  return `<aside class="show-ticket" data-show-ticket data-episode-slate data-slot="stats-pill" data-episode-open="${open ? "true" : "false"}">
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
</aside>
<div class="mobile-context" aria-label="Rundown context">
  ${renderContextTabs(context)}
</div>`;
}

function renderGuestCard(row: BoardRow, now: Date, live = false): string {
  const paid = isPaidListing(row);
  const cue = row.vetoed ? "VETO" : row.rank === null ? "—" : `#${row.rank}`;
  const kind = row.vetoed ? "CUT" : row.rank === 1 ? "SEAT" : "HOLD";
  const prize = live && paid && row.rank === 1 && !row.vetoed;
  const laterSeat = live && paid && row.rank !== null && row.rank > 1 && !row.vetoed;
  const klass = row.vetoed
    ? " guest vetoed"
    : prize
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
    ? ""
    : prize
      ? `<p class="guest-site">${escapeHtml(displaySite(row.siteUrl))}</p>`
      : `<p class="guest-site"><a href="${go}">${escapeHtml(displaySite(row.siteUrl))}</a></p>`;
  const laterFoot = laterSeat
    ? `<footer class="later-foot" data-later-foot>
    <div class="later-meta" data-later-meta>
      <a class="later-go" href="${go}" data-later-go>${escapeHtml(displaySite(row.siteUrl))}</a>
      <span class="clicks">${row.clicks} clicks</span>
      <time class="when" datetime="${escapeHtml(row.firstBidAt)}">${escapeHtml(relativeTime(row.firstBidAt, now))}</time>
    </div>
  </footer>`
    : "";
  const prizeFacts = prize
    ? `<p class="later-facts" data-later-facts>
    <span class="clicks">${row.clicks} clicks</span>
    <time class="when" datetime="${escapeHtml(row.firstBidAt)}">${escapeHtml(relativeTime(row.firstBidAt, now))}</time>
  </p>`
    : "";
  const leadPrice = prize
    ? `<span class="bid lead-bid${laterFact}"${laterMark} data-slot="price">$${row.bidUsd}</span>`
    : "";
  const laterPrice = laterSeat
    ? `<span class="bid later-bid" data-slot="price">$${row.bidUsd}</span>`
    : "";
  const footer = site || prizeFacts || veto
    ? `<div class="guest-footer" data-guest-footer>
    ${site}
    ${prizeFacts}
    ${veto}
  </div>`
    : "";
  const tally = prize || laterSeat
    ? ""
    : `<div class="tally">
    <p class="bid${laterFact}"${laterMark}>$${row.bidUsd}</p>
    <p class="clicks">${row.clicks} clicks</p>
    <p class="when"><time datetime="${escapeHtml(row.firstBidAt)}">${escapeHtml(relativeTime(row.firstBidAt, now))}</time></p>
  </div>`;
  const paidMark = paid ? ` data-paid-at="${escapeHtml(row.paidAt)}"` : "";
  const marks = `${prize ? " data-guest-prize" : ""}${laterSeat ? " data-later-seat" : ""}${paidMark}`;
  const placement = row.vetoed
    ? "vetoed"
    : row.rank === 1
      ? "on-mic"
      : row.rank !== null
        ? "in-wings"
        : "history";
  const slot = paid ? "paid-card" : "guest-card";
  return `<li class="${klass.trim()}" data-slot="${slot}" data-listing-id="${escapeHtml(row.id)}" data-rank="${row.rank ?? ""}" data-placement="${placement}" data-vetoed="${row.vetoed ? "true" : "false"}"${marks}>
  <div class="cue">
    <span class="cue-num">${cue}</span>
    <span class="cue-kind">${kind}</span>
  </div>
  ${leadPrice}
  ${laterPrice}
  <div class="person">
    ${name}
    <p class="guest-line">${escapeHtml(row.oneLiner)}</p>
    ${footer}
  </div>
  ${tally}
  ${laterFoot}
</li>`;
}

/**
 * The studio desk has a compact lower fold after the first three seats.
 * Keep that fold honest: it is derived only from the current paid guest-seat
 * rows and carries no synthetic activity or cross-show statistics.
 */
function renderLowerFold(
  rows: readonly BoardRow[],
  episode: Episode,
  now: Date,
): string {
  const ranked = rows
    .filter((row) => row.rank !== null && !row.vetoed && isPaidListing(row))
    .slice(0, 3);
  const activity = rows
    .filter((row) => row.rank !== null && !row.vetoed && isPaidListing(row))
    .slice()
    .sort((a, b) => {
      const aPaid = Date.parse(a.paidAt);
      const bPaid = Date.parse(b.paidAt);
      if (aPaid !== bPaid) return bPaid - aPaid;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, 5);
  if (ranked.length === 0 || activity.length === 0) return "";
  const show = escapeHtml(episode.label);
  return `<div class="lower-fold" data-lower-fold data-episode-id="${escapeHtml(episode.id)}">
  <section class="compact-section compact-ranking" data-slot="today-strip" data-today-ranking aria-labelledby="today-ranking-heading">
    <div class="compact-section-head">
      <h2 id="today-ranking-heading">Episode ledger</h2>
      <span class="compact-section-context">${show}</span>
    </div>
    <div class="compact-ranking-grid">
      ${ranked
        .map(
          (row) => `<article class="compact-ranking-item" data-lower-ranking data-lower-listing-id="${escapeHtml(row.id)}" data-placement-rank="${row.rank}">
        <span class="compact-ranking-rank">#${row.rank}</span>
        <span class="compact-ranking-copy">
          <strong class="compact-ranking-name">${escapeHtml(row.name)}</strong>
          <span class="compact-ranking-site">${escapeHtml(displaySite(row.siteUrl))}</span>
        </span>
        <strong class="compact-ranking-bid">$${row.bidUsd}</strong>
      </article>`,
        )
        .join("\n      ")}
    </div>
  </section>
  <section class="compact-section activity-section" data-slot="activity-strip" data-latest-activity aria-labelledby="latest-activity-heading">
    <div class="compact-section-head">
      <h2 id="latest-activity-heading">Recent paid placements</h2>
      <span class="compact-section-context">paid placements</span>
    </div>
    <div class="activity-grid">
      ${activity
        .map(
          (row) => `<article class="activity-item" data-activity-listing-id="${escapeHtml(row.id)}" data-activity-paid-at="${escapeHtml(row.paidAt)}" data-activity-rank="${row.rank}" data-activity-clicks="${row.clicks}">
        <span class="activity-kind">Paid placement</span>
        <span class="activity-copy">
          <strong>${escapeHtml(row.name)}</strong>
          <span>${show} · #${row.rank} · $${row.bidUsd}</span>
        </span>
        <span class="activity-facts">
          <time datetime="${escapeHtml(row.paidAt)}">${escapeHtml(relativeTime(row.paidAt, now))}</time>
          <span>${row.clicks} clicks</span>
        </span>
      </article>`,
        )
        .join("\n      ")}
    </div>
  </section>
</div>`;
}

function vetoNote(episode: Episode): string {
  const state = episode.vetoEnabled ? "on" : "off";
  return `Host review is ${state}.`;
}

const ROLLING_WINDOW_COPY =
  "Paid placements remain eligible for seven days. The window does not reset at Monday midnight. A host lock still closes the episode.";

function renderLockedClaim(episode: Episode): string {
  const label = escapeHtml(episode.label);
  return `<section class="claim" id="claim" data-slot="claim-hero" data-claim-state="locked" data-claim-locked data-checkout-state="locked">
  <h1 class="claim-title" data-slot="claim-heading">${label} is locked</h1>
  <p class="claim-note">Rank is the bid. This episode is locked; the next visit to the current rundown opens an empty board.</p>
  <p class="form-hint">Bidding is closed for this episode. Prior bids do not carry into the next one.</p>
</section>`;
}

function renderClaim(input: {
  episode: Episode | undefined;
  canCharge: boolean;
  defaultBid: number;
  emptyBoard: boolean;
  nextSeat?: boolean;
  topUsd?: number;
  liveListings?: readonly LiveListingRef[];
  noEligible?: boolean;
}): string {
  const episode = input.episode;
  if (episode && !input.canCharge) {
    return renderLockedClaim(episode);
  }
  const seat = episode ? seatLabel(episode.seatKind) : "guest seat";
  const openEmpty = Boolean(episode && input.canCharge && input.emptyBoard);
  const nextSeat = Boolean(openEmpty && input.nextSeat && episode);
  const noEligible = Boolean(openEmpty && input.noEligible);
  const occupiedLive = Boolean(episode && input.canCharge && !input.emptyBoard);
  const label = episode ? escapeHtml(episode.label) : "";
  const topUsd = input.topUsd;
  const raiseChargeUsd =
    occupiedLive && topUsd !== undefined && topUsd > 0
      ? Math.max(0, input.defaultBid - topUsd)
      : undefined;
  const occupiedRaiserNote =
    raiseChargeUsd !== undefined
      ? `You pay $<span data-raiser-claim-usd>${raiseChargeUsd}</span>. Same site: the raise difference, not a full bid.`
      : "You pay the raise difference, not a full bid.";
  const occupiedRaiserHint =
    raiseChargeUsd !== undefined
      ? `Already on this episode: you pay $<span data-raiser-form-hint-usd>${raiseChargeUsd}</span>, the raise difference.`
      : "Already on this episode: you pay the raise difference.";
  const occupiedRaiserGuest =
    '<span data-raiser-guest hidden> Raising <span data-raiser-guest-name></span>.</span>';
  const occupiedNote = episode
    ? `Rank is the bid. ${ROLLING_WINDOW_COPY} ${vetoNote(episode)} <span data-new-guest-claim-note>A new guest pays the full bid. Same site raises. You pay only the difference.</span><span data-raiser-claim-note hidden>${occupiedRaiserNote}</span>${occupiedRaiserGuest}`
    : "";
  const note = !episode
    ? "Rank is the bid. The next empty episode opens automatically when the rundown is visited."
    : noEligible
      ? `Rank is the bid. ${label} has paid listings, but every one is vetoed. A new bidder may submit a full bid.`
    : nextSeat
      ? `Rank is the bid. ${label} is open. $${MIN_BID_USD} takes #1 on this empty board. ${ROLLING_WINDOW_COPY} ${vetoNote(episode)}`
      : openEmpty
        ? `Rank is the bid. The ${seat} is open. $${MIN_BID_USD} takes #1. ${ROLLING_WINDOW_COPY} ${vetoNote(episode)}`
        : occupiedNote;
  const hint = !episode
    ? "Refresh the rundown to claim the next empty seat."
    : noEligible
      ? `Enter a new identity and a full bid of at least $${MIN_BID_USD}. Vetoed rows stay visible; they do not become a hidden raise. Unpaid checkout does not rank.`
    : nextSeat
      ? `${label} is a new empty board. First paid bid of at least $${MIN_BID_USD} takes #1. Prior bids do not carry. Unpaid checkout does not rank.`
      : openEmpty
        ? `First paid bid of at least $${MIN_BID_USD} takes #1. Unpaid checkout does not rank.`
        : `<span data-new-guest-form-hint>A new guest pays the full bid. Already on this episode? Enter the same site and raise. You pay only the difference.</span><span data-raiser-form-hint hidden>${occupiedRaiserHint}</span>${occupiedRaiserGuest}`;
  const disabled = input.canCharge ? "" : " disabled";
  const live = input.canCharge ? " data-claim-live" : "";
  const openSeat = openEmpty ? " data-open-seat" : "";
  const honest = openEmpty ? " data-empty-honest" : "";
  const nextMark = nextSeat ? " data-next-seat" : "";
  const emptyClaimFirst = openEmpty;
  const title = emptyClaimFirst || occupiedLive
    ? "Claim #1 for"
    : `Claim the ${escapeHtml(seat)} for`;
  const identityFields = `<div class="fields" data-identity-fields>
      <div class="identity-primary">
        <label class="sr-only" for="claim-site">Site</label>
        <input id="claim-site" name="siteUrl" type="text" inputmode="url" autocomplete="url" required placeholder="your-site.example"${disabled} data-slot="url-input"/>
      </div>
      <details class="identity-details">
        <summary data-slot="category-control">Guest details</summary>
        <div class="identity-details-fields">
          <label class="sr-only" for="claim-name">Name or company</label>
          <input id="claim-name" name="name" required maxlength="80" placeholder="Name or company"${disabled}/>
          <label class="sr-only" for="claim-one-liner">One-liner for the host</label>
          <input id="claim-one-liner" class="span-2" name="oneLiner" required maxlength="140" placeholder="One-liner for the host"${disabled}/>
        </div>
      </details>
    </div>`;
  const bidForm = `${identityFields}
    <button type="submit" class="outbid"${disabled}${occupiedLive ? " data-occupied-outbid" : ""} data-slot="claim-button" data-business-action="Outbid" aria-label="Claim rank">Claim rank${occupiedLive ? '<span data-raiser-outbid-guest hidden> <span data-raiser-outbid-guest-name></span></span>' : ""}</button>`;
  const claimClass = emptyClaimFirst
    ? `claim empty-claim-first${noEligible ? " no-eligible" : ""}`
    : occupiedLive
      ? "claim occupied-claim"
      : "claim";
  const claimState = !episode
    ? "waiting"
    : !input.canCharge
      ? "locked"
      : occupiedLive
        ? "open-occupied"
        : "open-empty";
  const emptyClaimMarks = emptyClaimFirst
    ? ` data-empty-claim-first aria-label="Claim #1"${noEligible ? " data-no-eligible" : ""}`
    : "";
  const titleMarks = emptyClaimFirst ? ' data-empty-claim data-first-click="claim"' : "";
  const claimWindow = emptyClaimFirst
    ? " data-empty-claim-window"
    : occupiedLive
      ? " data-occupied-window"
      : "";
  const claimNoteLead = occupiedLive ? ' data-claim-note-lead="new"' : "";
  const formHintLead = occupiedLive ? ' data-form-hint-lead="new"' : "";
  const formHintMark = occupiedLive ? " data-occupied-form-hint" : "";
  const claimRaise = occupiedLive ? " data-occupied-raise" : "";
  const liveListingsJson =
    occupiedLive && input.liveListings && input.liveListings.length > 0
      ? escapeHtml(JSON.stringify(input.liveListings))
      : "";
  const liveListingsAttr = liveListingsJson
    ? ` data-live-listings="${liveListingsJson}"`
    : "";
  const bidField =
    raiseChargeUsd !== undefined && topUsd !== undefined
      ? `<label class="bid-field" data-raise-amount-field${liveListingsAttr}>
        <span class="sr-only">New total in dollars. A new guest pays the full bid; the same listing pays only the raise difference.</span>
        <span class="bid-amount">$<input id="bid" name="bidUsd" form="bid-form" inputmode="numeric" pattern="[0-9]*" value="${input.defaultBid}" data-current-usd="${topUsd}" data-bid-input${disabled}/></span>
        <span class="raise-amount" data-raise-amount data-waffo-lead="new"><span data-new-guest-waffo-charge>New listing: $<span data-new-bid-usd>${input.defaultBid}</span>. Raise: $<span data-raise-amount-usd>${raiseChargeUsd}</span></span><span data-raiser-waffo-charge hidden>Raise charge: $<span data-raise-lead-usd>${raiseChargeUsd}</span> — only the difference</span><span data-raiser-guest hidden>. Raising <span data-raiser-guest-name></span>.</span></span>
      </label>`
      : `<label class="bid-field">
        <span class="sr-only">Amount in dollars</span>
        $<input id="bid" name="bidUsd" form="bid-form" inputmode="numeric" pattern="[0-9]*" value="${input.defaultBid}" data-bid-input${disabled}/>
      </label>`;
  return `<section class="${claimClass}" id="claim" data-slot="claim-hero" data-claim-state="${claimState}"${live}${openSeat}${honest}${nextMark}${emptyClaimMarks}>
  <h1 class="claim-title" data-slot="claim-heading"${titleMarks}>
    <span>${title}</span>
    <span class="bid-stepper">
      <button type="button" class="step" data-bid-step="-1" aria-label="Decrease bid by one dollar"${disabled}>−</button>
      ${bidField}
      <button type="button" class="step" data-bid-step="1" aria-label="Increase bid by one dollar"${disabled}>+</button>
    </span>
  </h1>
  <p class="claim-note"${claimWindow}${claimNoteLead}${claimRaise}>${note}</p>
  <form id="bid-form" class="bid-form" data-slot="claim-form" method="post" action="/checkout"${input.canCharge ? "" : ' aria-disabled="true"'}>
    ${episode && input.canCharge ? `<input type="hidden" name="episodeId" value="${escapeHtml(episode.id)}"/>` : ""}
    ${bidForm}
  </form>
  <p class="form-hint"${formHintMark}${formHintLead}>${hint}</p>
</section>`;
}

function renderWaitingRundown(): string {
  return `<section class="empty waiting" data-empty-board data-opening-next>
  <p class="empty-kicker">Opening the next seat</p>
  <p class="empty-lead">The next empty episode is being prepared.</p>
  <p>Visit the current rundown again to bid on the newly opened seat.</p>
  <p class="empty-path"><a href="/about#when-open">How episode opening works</a></p>
</section>`;
}

function renderOpenEmptyRundown(episode: Episode, nextSeat = false): string {
  const label = escapeHtml(episode.label);
  const kicker = nextSeat ? `${label} is open` : "Seat is open";
  const body = nextSeat
    ? `No paid listings on ${label} yet. A confirmed bid claims this empty ${escapeHtml(seatLabel(episode.seatKind))}. Prior bids do not carry.`
    : `No paid listings on this episode yet. A confirmed bid claims the ${escapeHtml(seatLabel(episode.seatKind))}.`;
  return `<section class="empty open-seat" data-empty-board data-open-seat data-empty-honest${nextSeat ? " data-next-seat" : ""}>
  <p class="empty-kicker">${kicker}</p>
  <p class="empty-lead">$${MIN_BID_USD} takes #1.</p>
  <p class="empty-window" data-empty-window>${ROLLING_WINDOW_COPY}</p>
  <p>${body}</p>
</section>`;
}

function renderNoEligibleState(episode: Episode): string {
  return `<section class="empty no-eligible" data-no-eligible>
  <p class="empty-kicker">No eligible #1</p>
  <p class="empty-lead">Every paid listing on ${escapeHtml(episode.label)} is vetoed.</p>
  <p>Paid vetoed rows stay visible for the record, but none can be raised, booked, or held as the occupied seat.</p>
</section>`;
}

function renderNoEligibleClaim(episode: Episode): string {
  return renderClaim({
    episode,
    canCharge: true,
    defaultBid: MIN_BID_USD,
    emptyBoard: true,
    noEligible: true,
  });
}

function renderDeskHeading(
  episode: Episode | undefined,
  rows: readonly BoardRow[],
  canCharge: boolean,
): string {
  const paidCount = rows.filter((row) => isPaidListing(row)).length;
  const kicker = !episode
    ? "Opening next episode"
    : canCharge
      ? "Current episode"
      : "Episode archive";
  const title = !episode ? "The desk is waiting" : "On the mic";
  const context = !episode
    ? "The next empty board opens automatically."
    : seatLabel(episode.seatKind) +
      " · " +
      (paidCount === 0
        ? "No paid guests yet"
        : paidCount + (paidCount === 1 ? " paid placement" : " paid placements")) +
      " · Rank is the bid.";
  return [
    '<header class="desk-heading" data-slot="rundown-heading">',
    '  <p class="desk-kicker">' + kicker + "</p>",
    '  <h2>' + title + "</h2>",
    '  <p class="desk-summary">' + escapeHtml(context) + "</p>",
    "</header>",
  ].join("\n");
}

function renderHostOpenDesk(input: {
  nextLabel: string;
  lockedEpisode?: Episode;
  replacementEpisode?: Episode;
}): string {
  const next = escapeHtml(input.nextLabel);
  const locked = input.lockedEpisode;
  const replacement = input.replacementEpisode;
  if (locked && replacement) {
    return `<section class="archive-current-status" data-archive-current>
  <p class="empty-kicker">Episode archive</p>
  <p class="empty-lead">${escapeHtml(locked.label)} is archived.</p>
  <p class="host-open-note">A fresh board is already open for new claims. Prior bids stay with the archive.</p>
  <p><a href="/" data-current-board>View the current rundown</a></p>
</section>`;
  }
  const kicker = locked ? "Next episode" : "Host desk";
  const lead = locked
    ? `${escapeHtml(locked.label)} is locked. Open ${next} empty.`
    : "Open the next episode so guests can bid.";
  const note = locked
    ? `${escapeHtml(locked.label)} stays booked. ${next} opens empty — prior bids do not carry, and checkout stays closed until you open it.`
    : "Guest-seat bidding begins when the host opens this board.";
  const nextMark = locked ? " data-open-next" : "";
  return `<section class="host-open" data-host-open data-host-only data-host-action="open"${nextMark}>
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
  allVetoed: boolean;
}): { className: string; marks: string } {
  if (!input.episode) {
    return { className: "studio studio-waiting", marks: ' data-studio-state="waiting"' };
  }
  if (!input.canCharge) {
    return { className: "studio studio-locked", marks: ' data-studio-state="locked"' };
  }
  if (input.allVetoed) {
    return {
      className: "studio studio-all-vetoed",
      marks: ' data-studio-state="all-vetoed" data-all-vetoed',
    };
  }
  if (input.emptyBoard) {
    return { className: "studio studio-open-empty", marks: ' data-studio-state="open-empty" data-empty-honest' };
  }
  return { className: "studio studio-open-occupied", marks: ' data-studio-state="open-occupied"' };
}

function renderHostLockDesk(episode: Episode, booked: BoardRow | undefined): string {
  const label = escapeHtml(episode.label);
  const lead = booked
    ? `Lock ${label} — book ${escapeHtml(booked.name)}.`
    : `Lock ${label}. Checkout closes with the episode.`;
  const bookedLine = booked
    ? episode.vetoEnabled
      ? `Lock books ${escapeHtml(booked.name)} at $${booked.bidUsd}, the highest remaining eligible bid. Vetoed rows stay visible and checkout closes.`
      : `Lock books ${escapeHtml(booked.name)} at $${booked.bidUsd}, the highest paid bid, and closes checkout.`
    : episode.vetoEnabled
      ? "Lock books the highest remaining eligible bid. Vetoed rows stay visible and checkout closes."
      : "Lock books the highest paid bid and closes checkout.";
  return `<section class="host-open host-lock" data-host-lock data-host-only data-host-action="lock">
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
  contextMode: ContextMode = "current",
  perEpisodeHref: string = EPISODE_INDEX_PATH,
  replacementEpisode?: Episode,
): string {
  const context: ContextState = {
    mode: contextMode,
    currentHref: BOARD_PATH,
    perEpisodeHref,
  };
  const canCharge = Boolean(
    episode &&
      episode.lockedAt === null &&
      !isEpisodeLockDue(episode, now) &&
      !isEpisodeLockMalformed(episode),
  );
  const rows = episode
    ? boardRows(listings, canCharge ? now : undefined)
    : [];
  const searchEntries = searchEntriesForBoard(episode, rows, path);
  const hasEligibleLive = rows.some((row) => row.rank !== null && !row.vetoed);
  const allVetoed = Boolean(canCharge && rows.length > 0 && !hasEligibleLive);
  const nextSeat = Boolean(canCharge && rows.length === 0 && priorLocked);
  const lowerFold =
    canCharge && hasEligibleLive && rows.length > 3 && episode
      ? renderLowerFold(rows, episode, now)
      : "";
  const topRows = rows.slice(0, 3);
  const laterRows = rows.slice(3);
  const rundown =
    !episode
      ? renderWaitingRundown()
      : rows.length === 0
        ? canCharge
          ? renderOpenEmptyRundown(episode, nextSeat)
          : `<p class="empty" data-empty-board>No paid listings on this episode yet.</p>`
        : canCharge
        ? `${allVetoed ? `${renderNoEligibleState(episode)}\n    ` : ""}<p class="rundown-head"><span>Rundown</span><span>Rank is the bid</span></p>
  <ol class="rundown top-rundown" data-rundown data-slot="top-three" aria-label="Top three" data-rolling-week="">
    ${topRows.map((row) => renderGuestCard(row, now, canCharge)).join("\n    ")}
  </ol>
  ${lowerFold}
  ${laterRows.length > 0 ? `<ol class="rundown later-rundown" data-rundown data-slot="later-rows" aria-label="Later rows">
    ${laterRows.map((row) => renderGuestCard(row, now, canCharge)).join("\n    ")}
  </ol>` : ""}
  <p class="week-window" data-rolling-week="">Paid placements remain eligible for seven days.</p>`
        : `<p class="rundown-head"><span>Rundown</span><span>Rank is the bid</span></p>
  <ol class="rundown" data-rundown data-slot="top-three" aria-label="Top three">
    ${rows.map((row) => renderGuestCard(row, now, canCharge)).join("\n    ")}
  </ol>`;

  const lockedEpisode = episode && !canCharge ? episode : undefined;
  const booked = rows.find((row) => row.rank === 1);
  const occupiedLive = Boolean(canCharge && hasEligibleLive);
  const claim = allVetoed
    ? renderNoEligibleClaim(episode!)
    : renderClaim({
    episode,
    canCharge,
    defaultBid: defaultClaimBidUsd(rows),
    emptyBoard: rows.length === 0,
    nextSeat,
    topUsd: rows.find((row) => row.rank === 1)?.bidUsd,
    liveListings: occupiedLive ? liveListingRefs(rows) : undefined,
      });
  const desk = !canCharge
    ? renderHostOpenDesk({ nextLabel, lockedEpisode, replacementEpisode })
    : episode && occupiedLive
      ? renderHostLockDesk(episode, booked)
      : "";
  const ticket = renderShowTicket(episode, context);
  const rail = renderFunctionRail();
  const shell = studioShell({
    episode,
    canCharge,
    emptyBoard: rows.length === 0 || allVetoed,
    allVetoed,
  });
  const deskHeading = renderDeskHeading(episode, rows, canCharge);
  const seatKindMark = ' data-seat-kind="' + (episode?.seatKind ?? "none") + '"';
  const studio = [
    '<div class="studio-board" data-slot="studio-board">',
    '  <div class="studio-intro" data-slot="studio-intro">',
    '    <div class="episode-slate-column" data-slot="episode-slate">' + ticket + "</div>",
    '    <div class="claim-console" data-slot="claim-console">' + claim + "</div>",
    "  </div>",
    '  <div class="rundown-desk" data-slot="rundown-desk">',
    '    <aside class="cue-column" data-slot="cue-column">' + rail + renderCueLedger(episode) + "</aside>",
    '    <section class="rundown-column" data-slot="rundown-stack">' + deskHeading + rundown + "</section>",
    "  </div>",
    '  <div class="host-desk-slot" data-slot="host-desk">' + desk + "</div>",
    "</div>",
  ].join("\n");
  return renderLayout({
    title: episode ? `${episode.label} · Podcast Guest Seat` : "Podcast Guest Seat",
    path,
    css: occupiedLive ? BOARD_CSS : STUDIO_CSS,
    context,
    search: searchEntries,
    body: `<div class="${shell.className}"${shell.marks}${seatKindMark}>
${studio}
</div>
<script>
  function hasInvalidSiteChars(value) {
    for (var i = 0; i < value.length; i++) {
      var code = value.charCodeAt(i);
      if (code < 32 || code === 127 || code === 92) return true;
    }
    return false;
  }
  function normalizeSiteHost(raw) {
    var host = String(raw || "").toLowerCase();
    if (host.charAt(0) === "[") host = host.slice(1);
    if (host.charAt(host.length - 1) === "]") host = host.slice(0, -1);
    while (host.charAt(host.length - 1) === ".") host = host.slice(0, -1);
    return host;
  }
  function siteIdentityHost(parsed) {
    var host = normalizeSiteHost(parsed.hostname);
    return host.indexOf(":") >= 0 ? "[" + host + "]" : host;
  }
  function numericPortSuffix(value) {
    if (value.charAt(0) !== ":" || value.length < 2) return false;
    for (var i = 1; i < value.length; i++) {
      var code = value.charCodeAt(i);
      if (code < 48 || code > 57) return false;
    }
    return true;
  }
  function authoritySchemeSiteUrl(value) {
    var schemeEnd = value.indexOf("://");
    if (schemeEnd <= 0) return false;
    var first = value.charCodeAt(0);
    if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) return false;
    for (var i = 1; i < schemeEnd; i++) {
      var code = value.charCodeAt(i);
      if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) || code === 43 || code === 45 || code === 46)) return false;
    }
    return true;
  }
  function authorityOfSite(value) {
    var schemeEnd = authoritySchemeSiteUrl(value) ? value.indexOf("://") : -1;
    var start = value.indexOf("//") === 0
      ? 2
      : schemeEnd >= 0
        ? schemeEnd + 3
        : 0;
    for (var i = start; i < value.length; i++) {
      var code = value.charCodeAt(i);
      if (code === 47 || code === 63 || code === 35) return value.slice(start, i);
    }
    return value.slice(start);
  }
  function hostPartOfSiteAuthority(authority, allowUserinfo) {
    if (!authority) return "";
    if (allowUserinfo) {
      var userinfoEnd = authority.lastIndexOf("@");
      if (userinfoEnd >= 0) authority = authority.slice(userinfoEnd + 1);
    } else if (authority.indexOf("@") >= 0) {
      return "";
    }
    if (authority.indexOf(String.fromCharCode(92)) >= 0) return "";
    if (authority.charAt(0) === "[") {
      var closing = authority.indexOf("]");
      if (closing < 0) return "";
      var suffix = authority.slice(closing + 1);
      if (suffix && !numericPortSuffix(suffix)) return "";
      return authority.slice(0, closing + 1);
    }
    if (authority.indexOf("[") >= 0 || authority.indexOf("]") >= 0) return "";
    var colon = authority.indexOf(":");
    if (colon < 0) return authority;
    if (colon !== authority.lastIndexOf(":") || !numericPortSuffix(authority.slice(colon))) return "";
    return authority.slice(0, colon);
  }
  function dottedSiteHost(host) {
    var labels = host.split(".");
    if (labels.length < 2) return false;
    for (var i = 0; i < labels.length; i++) {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(labels[i])) return false;
    }
    return true;
  }
  function plausibleSingleLabelSiteHost(host) {
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host) && host.indexOf("-") >= 0;
  }
  function ipv4SiteHost(host) {
    var parts = host.split(".");
    if (parts.length !== 4) return false;
    for (var i = 0; i < parts.length; i++) {
      if (!/^[0-9]+$/.test(parts[i]) || Number(parts[i]) > 255) return false;
    }
    return true;
  }
  function plausibleSiteAuthorityClient(value, parsed, allowUserinfo, allowSingleLabel) {
    var authority = authorityOfSite(value);
    if (!authority || authority.charAt(0) === "/") return false;
    var hostPart = hostPartOfSiteAuthority(authority, allowUserinfo);
    if (!hostPart) return false;
    var host = normalizeSiteHost(parsed.hostname);
    if (!host) return false;
    if (hostPart.charAt(0) === "[") return host.indexOf(":") >= 0;
    if (ipv4SiteHost(host)) return ipv4SiteHost(hostPart);
    return host === "localhost" || dottedSiteHost(host) ||
      (allowSingleLabel && plausibleSingleLabelSiteHost(host));
  }
  function unsafeSiteHost(rawHost) {
    var host = normalizeSiteHost(rawHost);
    if (
      !host ||
      host === "localhost" ||
      host === "local" ||
      host === "internal" ||
      host.endsWith(".local") ||
      host.endsWith(".localhost") ||
      host.endsWith(".internal") ||
      host.endsWith(".home.arpa")
    ) return true;
    if (ipv4SiteHost(host)) {
      var parts = host.split(".").map(Number);
      var first = parts[0];
      var second = parts[1];
      return first === 0 || first === 10 || first === 127 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && (second === 0 || second === 2 || second === 168)) ||
        (first === 198 && (second === 18 || second === 19 || second === 51)) ||
        (first === 203 && second === 0) || first >= 224;
    }
    if (host.indexOf(":") < 0) return false;
    var firstGroup = host.split(":")[0];
    return host === "::" || host === "::1" ||
      host.indexOf("::ffff:") === 0 ||
      host.indexOf("fc") === 0 || host.indexOf("fd") === 0 ||
      host.indexOf("ff") === 0 ||
      (firstGroup.indexOf("fe") === 0 && "89abcdef".indexOf(firstGroup.charAt(2)) >= 0) ||
      host.indexOf("2001:db8:") === 0;
  }
  function denylistedSiteHost(rawHost) {
    var host = normalizeSiteHost(rawHost);
    var listed = [
      "t.me", "telegram.me", "telegram.dog", "wa.me", "whatsapp.com",
      "api.whatsapp.com", "chat.whatsapp.com", "web.whatsapp.com", "discord.gg",
      "discord.com", "discordapp.com", "discord.me", "m.me", "messenger.com",
      "signal.me", "signal.group", "line.me", "onlyfans.com", "fansly.com",
      "pornhub.com", "pornhub.org", "pornhubpremium.com", "xvideos.com", "xnxx.com",
      "xhamster.com", "chaturbate.com", "stripchat.com", "manyvids.com", "redtube.com",
      "youporn.com", "brazzers.com", "adultfriendfinder.com", "bit.ly", "t.co",
      "tinyurl.com", "lnkd.in", "ow.ly", "buff.ly", "is.gd", "cutt.ly", "rb.gy",
    ];
    for (var i = 0; i < listed.length; i++) {
      if (host === listed[i] || host.endsWith("." + listed[i])) return true;
    }
    return false;
  }
  function httpSiteUrl(value) {
    var lower = value.toLowerCase();
    return lower.indexOf("http://") === 0 || lower.indexOf("https://") === 0;
  }
  function parseGuestSiteUrl(raw) {
    var original = String(raw || "");
    if (!original || hasInvalidSiteChars(original)) return null;
    var value = original.trim();
    if (!value || /\\s/.test(value)) return null;
    if (value.indexOf("///") === 0 ||
        (value.indexOf("/") === 0 && value.indexOf("//") !== 0)) return null;
    var protocolRelative = value.indexOf("//") === 0;
    var explicitHttp = httpSiteUrl(value);
    if (!explicitHttp && !protocolRelative && authoritySchemeSiteUrl(value)) return null;
    var candidateText = protocolRelative ? "https:" + value : explicitHttp ? value : "https://" + value;
    var authority = authorityOfSite(value);
    if (!authority || authority.charAt(0) === "/") return null;
    var parsed;
    try {
      parsed = new URL(candidateText);
    } catch (err) {
      return null;
    }
    if (parsed.protocol !== "https:" || !parsed.hostname) return null;
    if (!plausibleSiteAuthorityClient(value, parsed, explicitHttp || protocolRelative, protocolRelative)) return null;
    if (unsafeSiteHost(parsed.hostname)) return null;
    if (denylistedSiteHost(parsed.hostname)) return null;
    return parsed;
  }
  (function () {
    var min = ${MIN_BID_USD};
    var input = document.getElementById("bid");
    if (!input || input.disabled) return;
    function parseBid(raw) {
      var n = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
      return Number.isFinite(n) ? Math.max(min, n) : min;
    }
    function sizeBidInput(value) {
      var digits = String(Math.max(min, value)).length;
      input.style.width = String(Math.max(2, Math.min(8, digits))) + "ch";
    }
    var current = parseInt(String(input.getAttribute("data-current-usd") || ""), 10);
    var chargeUsd = document.querySelector("[data-raise-amount-usd]");
    var newBidUsd = document.querySelector("[data-new-bid-usd]");
    var raiseLeadUsd = document.querySelector("[data-raise-lead-usd]");
    var newGuestCharge = document.querySelector("[data-new-guest-waffo-charge]");
    var raiserCharge = document.querySelector("[data-raiser-waffo-charge]");
    var waffoLead = document.querySelector("[data-waffo-lead]");
    var newGuestNote = document.querySelector("[data-new-guest-claim-note]");
    var raiserNote = document.querySelector("[data-raiser-claim-note]");
    var raiserClaimUsd = document.querySelector("[data-raiser-claim-usd]");
    var claimNoteLead = document.querySelector("[data-claim-note-lead]");
    var newGuestHint = document.querySelector("[data-new-guest-form-hint]");
    var raiserHint = document.querySelector("[data-raiser-form-hint]");
    var raiserHintUsd = document.querySelector("[data-raiser-form-hint-usd]");
    var formHintLead = document.querySelector("[data-form-hint-lead]");
    var bidField = document.querySelector("[data-raise-amount-field]");
    var raiserGuests = document.querySelectorAll("[data-raiser-guest]");
    var raiserGuestNames = document.querySelectorAll("[data-raiser-guest-name]");
    var outbidGuest = document.querySelector("[data-raiser-outbid-guest]");
    var outbidGuestName = document.querySelector("[data-raiser-outbid-guest-name]");
    var nameInput = document.querySelector('input[name="name"]');
    var siteInput = document.querySelector('input[name="siteUrl"]');
    var lineInput = document.querySelector('input[name="oneLiner"]');
    var listings = [];
    try {
      listings = JSON.parse((bidField && bidField.getAttribute("data-live-listings")) || "[]");
    } catch (err) {
      listings = [];
    }
    function identityFrom(raw) {
      var parsed = parseGuestSiteUrl(raw);
      if (!parsed) return "";
      var path = parsed.pathname.replace(/\\/+$/, "") || "/";
      return siteIdentityHost(parsed) + path;
    }
    function matchedListing() {
      var id = identityFrom(siteInput && siteInput.value);
      if (!id) return null;
      for (var i = 0; i < listings.length; i++) {
        if (listings[i].identity === id) return listings[i];
      }
      return null;
    }
    function syncCharge() {
      var next = parseBid(input.value);
      sizeBidInput(next);
      if (newBidUsd) newBidUsd.textContent = String(next);
      if (chargeUsd && Number.isFinite(current)) {
        chargeUsd.textContent = String(next > current ? next - current : 0);
      }
      var match = matchedListing();
      var raising = Boolean(match);
      var existing = match ? match.bidUsd : NaN;
      var difference = raising
        ? Math.max(0, next - existing)
        : Number.isFinite(current) && next > current
          ? next - current
          : 0;
      if (raiseLeadUsd) raiseLeadUsd.textContent = String(difference);
      if (raiserClaimUsd) raiserClaimUsd.textContent = String(difference);
      if (raiserHintUsd) raiserHintUsd.textContent = String(difference);
      var guestName = match && match.name ? String(match.name) : "";
      var guestLine = match && match.oneLiner ? String(match.oneLiner) : "";
      raiserGuestNames.forEach(function (el) {
        el.textContent = guestName;
      });
      raiserGuests.forEach(function (el) {
        if (raising) el.removeAttribute("hidden");
        else el.setAttribute("hidden", "");
      });
      if (outbidGuestName) outbidGuestName.textContent = guestName;
      if (outbidGuest) {
        if (raising) outbidGuest.removeAttribute("hidden");
        else outbidGuest.setAttribute("hidden", "");
      }
      if (nameInput) {
        if (raising) {
          nameInput.value = guestName;
          nameInput.setAttribute("data-raiser-identity-filled", "");
        } else if (nameInput.hasAttribute("data-raiser-identity-filled")) {
          nameInput.value = "";
          nameInput.removeAttribute("data-raiser-identity-filled");
        }
      }
      if (lineInput) {
        if (raising) {
          lineInput.value = guestLine;
          lineInput.setAttribute("data-raiser-identity-filled", "");
        } else if (lineInput.hasAttribute("data-raiser-identity-filled")) {
          lineInput.value = "";
          lineInput.removeAttribute("data-raiser-identity-filled");
        }
      }
      if (newGuestCharge) {
        if (raising) newGuestCharge.setAttribute("hidden", "");
        else newGuestCharge.removeAttribute("hidden");
      }
      if (raiserCharge) {
        if (raising) raiserCharge.removeAttribute("hidden");
        else raiserCharge.setAttribute("hidden", "");
      }
      if (waffoLead) waffoLead.setAttribute("data-waffo-lead", raising ? "raise" : "new");
      if (newGuestNote) {
        if (raising) newGuestNote.setAttribute("hidden", "");
        else newGuestNote.removeAttribute("hidden");
      }
      if (raiserNote) {
        if (raising) raiserNote.removeAttribute("hidden");
        else raiserNote.setAttribute("hidden", "");
      }
      if (claimNoteLead) claimNoteLead.setAttribute("data-claim-note-lead", raising ? "raise" : "new");
      if (newGuestHint) {
        if (raising) newGuestHint.setAttribute("hidden", "");
        else newGuestHint.removeAttribute("hidden");
      }
      if (raiserHint) {
        if (raising) raiserHint.removeAttribute("hidden");
        else raiserHint.setAttribute("hidden", "");
      }
      if (formHintLead) formHintLead.setAttribute("data-form-hint-lead", raising ? "raise" : "new");
    }
    document.querySelectorAll("[data-bid-step]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        input.value = String(Math.max(min, parseBid(input.value) + Number(btn.getAttribute("data-bid-step"))));
        syncCharge();
      });
    });
    input.addEventListener("input", syncCharge);
    if (siteInput) {
      siteInput.addEventListener("input", syncCharge);
      siteInput.addEventListener("change", syncCharge);
    }
    syncCharge();
  })();
  (function () {
    var form = document.getElementById("bid-form");
    var submit = form && form.querySelector("button.outbid");
    var fields = form ? form.querySelectorAll('input[name="name"], input[name="siteUrl"], input[name="oneLiner"]') : [];
    function claimReady() {
      if (!form || !submit) return;
      var name = form.querySelector('input[name="name"]');
      var site = form.querySelector('input[name="siteUrl"]');
      var line = form.querySelector('input[name="oneLiner"]');
      var validSite = Boolean(parseGuestSiteUrl(site && site.value));
      var ready = Boolean(name && String(name.value).trim() && line && String(line.value).trim() && validSite);
      if (!submit.hasAttribute("data-locked-action")) submit.disabled = !ready;
      submit.setAttribute("aria-disabled", ready ? "false" : "true");
      submit.setAttribute("data-claim-ready", ready ? "true" : "false");
    }
    if (form && submit) {
      fields.forEach(function (field) { field.addEventListener("input", claimReady); field.addEventListener("change", claimReady); });
      claimReady();
    }
    document.querySelectorAll("[data-function-rail]").forEach(function (rail) {
      var more = rail.querySelector("[data-function-more]");
      var menu = rail.querySelector("[data-function-menu]");
      if (more && menu) {
        more.addEventListener("click", function () {
          var open = more.getAttribute("aria-expanded") === "true";
          more.setAttribute("aria-expanded", open ? "false" : "true");
          menu.hidden = open;
        });
      }
      rail.querySelectorAll("[data-function]").forEach(function (item) {
        item.addEventListener("click", function () {
          var value = item.getAttribute("data-function");
          rail.querySelectorAll('[data-function]').forEach(function (chip) {
            chip.setAttribute("aria-pressed", chip.getAttribute("data-function") === value ? "true" : "false");
          });
          var studio = rail.closest(".studio");
          var seatKind = studio && studio.getAttribute("data-seat-kind");
          var cards = studio ? studio.querySelectorAll("[data-placement]") : [];
          cards.forEach(function (card) {
            var placement = card.getAttribute("data-placement");
            var visible = true;
            if (value === "guest_seat" || value === "sixty_second_open") {
              visible = seatKind === value;
            } else if (value === "on-mic" || value === "in-wings" || value === "vetoed") {
              visible = placement === value;
            }
            if (visible) card.removeAttribute("hidden");
            else card.setAttribute("hidden", "");
          });
          if (menu && more) { menu.hidden = true; more.setAttribute("aria-expanded", "false"); }
        });
      });
    });
  })();
</script>`,
  });
}

export function renderEpisodeHistoryEmptyHtml(): string {
  const context: ContextState = {
    mode: "episode",
    currentHref: BOARD_PATH,
    perEpisodeHref: EPISODE_INDEX_PATH,
  };
  return renderLayout({
    title: "Episode history · Podcast Guest Seat",
    path: EPISODE_INDEX_PATH,
    context,
    body: `<div class="mobile-context" aria-label="Rundown context">
  ${renderContextTabs(context)}
</div>
<article class="doc episode-history-empty" data-episode-history-empty>
  <p class="empty-kicker">Per episode</p>
  <h1>No episode history yet</h1>
  <p class="empty-lead">No previous episode is available yet.</p>
  <p>This view shows paid placements from locked episodes. History is read-only.</p>
  <p><a href="/">Back to Current</a></p>
</article>`,
  });
}

export function renderAboutHtml(): string {
  return renderLayout({
    title: "About · Podcast Guest Seat",
    path: "/about",
    body: `<article class="doc">
<h1>About</h1>
<p>This is a public auction for the next episode’s <strong>guest seat</strong> or a <strong>60-second open</strong>. People and companies bid whole US dollars. Rank is the bid — nothing else.</p>
<p id="when-open">The current rundown keeps one episode open. If none is unlocked, visiting this page opens the next empty guest-seat board automatically; opening creates no listing or payment. The first confirmed bid of at least $5 takes #1. The host can still choose the seat kind when opening an episode manually from the host desk.</p>
<p>Each episode has its own auction. Paid placements remain eligible for seven days unless the host locks the episode sooner. When an episode is locked, the highest eligible bid is booked and the next visit to the current rundown opens a new empty episode.</p>
<p>The host can still say no to a guest-seat placement. Any vetoed row remains visible with a public reason. The 60-second open follows the published highest-bid result.</p>
<p>Clicks go through this board so the click count is public. Tracking parameters are removed. Chat invites and adult platforms are rejected.</p>
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
    <tr><th>Currency</th><td>Whole US dollars only.</td></tr>
    <tr><th>Minimum</th><td><strong>$5</strong> first bid.</td></tr>
    <tr><th>Increment</th><td>$1.</td></tr>
    <tr><th>Rank</th><td>Rank is the bid. Below #1 still lists at the rank that bid can take.</td></tr>
    <tr><th>Ties</th><td>When bids are equal, the listing placed first keeps the higher rank.</td></tr>
    <tr><th>Raise</th><td>The same listing may raise. To take #1, the new total must be at least $1 above the current leader. The original payer is charged only the <strong>difference</strong>.</td></tr>
    <tr><th>Identity</th><td>Another bidder cannot steal a listing by paying only that difference. They pay a full new bid.</td></tr>
    <tr><th>Claim</th><td>A completed payment claims the rank. Unpaid checkout does not.</td></tr>
    <tr><th>Opening</th><td>If no episode is unlocked, the current rundown opens the next empty episode automatically. Opening creates no paid listing; the first confirmed bid of at least $5 claims #1.</td></tr>
    <tr><th>Window</th><td>Paid placements remain eligible for <strong>seven days</strong>. The window follows each placement time rather than resetting at Monday midnight. A host lock still closes the episode.</td></tr>
    <tr><th>Tracking</th><td>Tracking, affiliate, and referral parameters are removed from listing links.</td></tr>
    <tr><th>Shorteners</th><td>Not allowed as the stored URL.</td></tr>
    <tr><th>Chat / adult content</th><td>Chat invitations and adult-platform links are rejected before checkout.</td></tr>
  </tbody>
</table>
<h2>Host veto</h2>
<p>Guest-seat auctions allow host review; the 60-second open does not unless the show states otherwise before bidding begins.</p>
<p>Once the first paid bid arrives, that choice is fixed for the episode. The host may veto an eligible guest with a public reason. The row remains visible, ranking is recalculated among the remaining paid listings, and previously paid bids are not automatically refunded. Without host review, the highest paid bid is booked when the episode locks.</p>
</article>`,
  });
}

export function renderCheckoutErrorHtml(code: string): string {
  const copy: Record<string, { title: string; lead: string; note: string }> = {
    episode_locked: {
      title: "This episode is locked",
      lead: "No new claim can start on this episode.",
      note: "No charge was started. Return to the rundown to see the next episode.",
    },
    waffo_unavailable: {
      title: "Payment is temporarily unavailable",
      lead: "We could not open a usable checkout page.",
      note: "No rank was added. Return later or contact support if you saw a payment page.",
    },
    waffo_checkout_rejected: {
      title: "Checkout was not accepted",
      lead: "The payment request was not accepted.",
      note: "No rank was added. Return to the rundown and try again with a different bid.",
    },
    invalid_checkout: {
      title: "Check your claim details",
      lead: "We could not start checkout from those details.",
      note: "No charge was started. Return to the rundown and enter a name, site, one-liner, and whole-dollar bid.",
    },
    invalid_bid: {
      title: "Check your bid",
      lead: "The bid must be a whole-dollar amount of at least $5.",
      note: "No charge was started. Return to the rundown and try again.",
    },
    episode_not_found: {
      title: "Episode not found",
      lead: "That episode is no longer available for checkout.",
      note: "No charge was started. Return to the rundown for the current episode.",
    },
    checkout_not_open: {
      title: "Checkout is no longer open",
      lead: "This saved checkout cannot be paid again.",
      note: "No local rank was added. Return to the rundown for the current claim.",
    },
    unknown_checkout: {
      title: "Checkout status is unavailable",
      lead: "This checkout could not be matched to a saved request.",
      note: "The board was not changed. Return to the rundown; if a payment page opened, keep its details for support.",
    },
    intent_required: {
      title: "Checkout link is incomplete",
      lead: "This return link is missing its checkout reference.",
      note: "The board was not changed. Return to the rundown and use the original checkout link.",
    },
    webhook_only: {
      title: "Payment is still being confirmed",
      lead: "The payment network has not confirmed this checkout yet.",
      note: "Return to the rundown after confirmation.",
    },
    checkout_persistence: {
      title: "Checkout could not be saved",
      lead: "We could not safely save this checkout request.",
      note: "No local rank was added. If a payment page opened, keep its reference for support before trying again.",
    },
  };
  const locked = code === "episode_locked";
  const mark = locked ? ' data-checkout-state="locked"' : "";
  const state = copy[code] ?? {
    title: "Checkout could not start",
    lead: "We could not start this checkout safely.",
    note: "No local rank was added. Return to the rundown and try again; if a payment page opened, keep its reference for support.",
  };
  return renderLayout({
    title: "Checkout · Podcast Guest Seat",
    path: "/",
    body: `<article class="doc"${mark}>
<h1>${state.title}</h1>
<p class="empty">${state.lead}</p>
<p>${state.note}</p>
<p class="empty-path"><a href="/">Back to the rundown</a></p>
</article>`,
  });
}

export type CheckoutStatusView =
  | "creating"
  | "open"
  | "unknown"
  | "paid"
  | "rejected"
  | "needs_reconciliation";

/** Read-only provider return surface. It never claims a listing. */
export function renderCheckoutStatusHtml(input: {
  intentId: string;
  status: CheckoutStatusView;
  checkoutUrl?: string | null;
  listingId?: string;
}): string {
  const copy: Record<CheckoutStatusView, { title: string; lead: string; note: string }> = {
    creating: {
      title: "Checkout is starting",
      lead: "Your payment page is being prepared.",
      note: "Return here after checkout. The board changes only after payment is confirmed.",
    },
    open: {
      title: "Checkout is open",
      lead: "Payment has not been confirmed yet.",
      note: "The board changes only after confirmation. An incomplete checkout does not rank.",
    },
    unknown: {
      title: "Payment is being confirmed",
      lead: "The final result is not known yet.",
      note: "Keep your receipt and check the rundown again shortly.",
    },
    paid: {
      title: "Payment received",
      lead: "Your paid guest-seat claim is on the rundown.",
      note: "Return to the rundown to see the current rolling rank.",
    },
    rejected: {
      title: "Payment was not accepted",
      lead: "No rank was added and no listing was created.",
      note: "Return to the rundown to try again.",
    },
    needs_reconciliation: {
      title: "Payment received — board update pending",
      lead: "The payment is recorded, but the board still needs confirmation before it can rank.",
      note: "Do not pay again. Keep your receipt and contact support if the listing does not appear.",
    },
  };
  const state = copy[input.status];
  const continueLink =
    (input.status === "open" || input.status === "unknown") && input.checkoutUrl
      ? `<p><a href="${escapeHtml(input.checkoutUrl)}" rel="nofollow">Return to checkout</a></p>`
      : "";
  const listing = input.status === "paid" && input.listingId
    ? `<p class="status-detail">Your listing is recorded.</p>`
    : "";
  return renderLayout({
    title: `${state.title} · Podcast Guest Seat`,
    path: "/checkout/complete",
    body: `<article class="doc checkout-status" data-checkout-status="${escapeHtml(input.status)}" data-intent-id="${escapeHtml(input.intentId)}">
<p class="empty-kicker">Checkout status</p>
<h1>${state.title}</h1>
<p class="empty-lead">${state.lead}</p>
<p>${state.note}</p>
${listing}
${continueLink}
<p><a href="/">Back to the rundown</a></p>
</article>`,
  });
}

export function renderHostOpenErrorHtml(_code: string): string {
  return renderLayout({
    title: "Host · Podcast Guest Seat",
    path: "/",
    body: `<article class="doc">
<h1>Episode did not open</h1>
<p class="empty">The episode could not be opened. Checkout remains closed.</p>
<p><a href="/">Back to the rundown</a></p>
</article>`,
  });
}

export function renderHostLockErrorHtml(_code: string): string {
  return renderLayout({
    title: "Host · Podcast Guest Seat",
    path: "/",
    body: `<article class="doc">
<h1>Episode did not lock</h1>
<p class="empty">The episode could not be locked. Checkout remains open until the lock succeeds.</p>
<p><a href="/">Back to the rundown</a></p>
</article>`,
  });
}

export const pageRoutes: FastifyPluginAsync = async (app) => {
  app.get(BOARD_PATH, async (_request, reply) => {
    // The public current rundown is the entry point for a new episode. Keep
    // the conditional open inside SQLite's immediate transaction so a cold
    // database or a post-lock visit cannot strand ordinary bidders behind the
    // host desk or create duplicate empty episodes.
    const episode = ensureCurrentOpenEpisode(app.db);
    const listings = episode
      ? paidListings(listListingsForEpisode(app.db, episode.id))
      : [];
    const priorEpisode = episode
      ? getLatestLockedEpisode(app.db, episode.id)
      : undefined;
    const priorLocked = episode && episode.lockedAt === null ? priorEpisode : undefined;
    const perEpisodeHref = priorEpisode ? episodePath(priorEpisode.id) : EPISODE_INDEX_PATH;
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
          "current",
          perEpisodeHref,
        ),
      );
  });

  app.get(EPISODE_INDEX_PATH, async (_request, reply) => {
    let current = getCurrentEpisode(app.db);
    if (current && (isEpisodeLockDue(current) || isEpisodeLockMalformed(current))) {
      current = ensureCurrentOpenEpisode(app.db);
    }
    const episode = current
      ? getLatestLockedEpisode(app.db, current.id)
      : getLatestLockedEpisode(app.db);
    if (!episode) {
      return reply
        .type("text/html; charset=utf-8")
        .send(renderEpisodeHistoryEmptyHtml());
    }
    const listings = paidListings(listListingsForEpisode(app.db, episode.id));
    const replacementEpisode = current && current.id !== episode.id && current.lockedAt === null
      ? current
      : undefined;
    return reply
      .type("text/html; charset=utf-8")
      .send(
        renderBoardHtml(
          episode,
          listings,
          new Date(),
          episodePath(episode.id),
          nextEpisodeLabel(app.db),
          undefined,
          "episode",
          episodePath(episode.id),
          replacementEpisode,
        ),
      );
  });

  app.get<{ Params: { episodeId: string } }>(
    EPISODE_BOARD_PATH,
    async (request, reply) => {
      let episode = getEpisode(app.db, request.params.episodeId);
      if (!episode) {
        return reply.code(404).type("text/html; charset=utf-8").send(
          renderLayout({
            title: "Episode not found · Podcast Guest Seat",
            path: "/",
            body: `<h1>Episode not found</h1><p class="empty">No board for that id.</p>`,
          }),
        );
      }
      // A direct public episode URL is also a lifecycle boundary. First
      // converge the latest board, then handle an older due/corrupt target so
      // this page can never keep a chargeable stale schedule alive.
      ensureCurrentOpenEpisode(app.db);
      let replacementEpisode: Episode | undefined;
      if (isEpisodeLockDue(episode) || isEpisodeLockMalformed(episode)) {
        const rolled = rolloverEpisodeIfDue(app.db, episode.id);
        episode = rolled.episode;
        replacementEpisode = rolled.current.id === episode?.id ? undefined : rolled.current;
        if (!episode) {
          return reply.code(404).type("text/html; charset=utf-8").send(
            renderLayout({
              title: "Episode not found · Podcast Guest Seat",
              path: "/",
              body: `<h1>Episode not found</h1><p class="empty">No board for that id.</p>`,
            }),
          );
        }
      }
      if (!replacementEpisode && episode.lockedAt !== null) {
        const current = getCurrentEpisode(app.db);
        if (current && current.id !== episode.id && current.lockedAt === null) {
          replacementEpisode = current;
        }
      }
      const listings = paidListings(
        listListingsForEpisode(app.db, episode.id),
      );
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
            "episode",
            episodePath(episode.id),
            replacementEpisode,
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
