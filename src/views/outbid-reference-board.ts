import {
  claimPriceUsd,
  defaultClaimBidUsd,
  isPaidListing,
  MIN_BID_USD,
  paidListings,
  rankForBid,
  withRanks,
  type RankedListing,
} from "./outbid-reference-core.js";
import { formatIssueDate } from "./outbid-reference-day.js";
import {
  displayHostPath,
  escapeHtml,
  formatUsd,
  html,
  relativeTime,
} from "./outbid-reference-html.js";
import { renderLayout, SITE_TITLE } from "./outbid-reference-layout.js";

export type BoardViewModel = {
  day: string;
  tz: string;
  listings: RankedListing[];
  last24h?: RankedListing[];
  leftoverUnpaid?: boolean;
  defaultBidUsd: number;
  now?: Date;
  /** Enables a deterministic local-only visual fixture; never set by live checkout ports. */
  fixtureMode?: boolean;
};

type ReferenceListing = {
  title: string;
  summary: string;
  category: "Agents" | "Marketing";
  age: string;
  clicks: number;
  icon: string;
};

const OUTBID_REFERENCE_LISTINGS: Readonly<Record<string, ReferenceListing>> = {
  "see.io": {
    title: "see.io · see your idea live",
    summary:
      "Just describe your idea. AI turns it into a fully built, live website in minutes. Get your own domain whenever you want one. No coding required.",
    category: "Agents",
    age: "3 days ago",
    clicks: 39_412,
    icon: "/icons/bot.svg",
  },
  "tutti.so": {
    title: "Tutti — Your all-in-one marketplace to monetize influence",
    summary:
      "Join campaigns from real brands and get paid on effective exposure and engagement. No minimum followers. Performance-based payouts for creators on X/Twitter.",
    category: "Marketing",
    age: "3 days ago",
    clicks: 8_620,
    icon: "/icons/megaphone.svg",
  },
  "joni.ai": {
    title: "JONI | Your Personal AI Computer",
    summary:
      "JONI is your personal AI computer. Chat once and a team of AI agents and skills gets to work, with the right model picked for every job. None of the complexity.",
    category: "Agents",
    age: "5 days ago",
    clicks: 20_114,
    icon: "/icons/bot.svg",
  },
};

function isOutbidReferenceFixture(
  listings: readonly RankedListing[],
  fixtureMode = false,
): boolean {
  if (!fixtureMode || listings.length !== 3) return false;
  const expected = [
    ["see.io", 17_000],
    ["tutti.so", 16_000],
    ["joni.ai", 14_028],
  ] as const;
  return expected.every(
    ([host, bid], index) =>
      displayHostPath(listings[index]!.productUrl) === host && listings[index]!.bidUsd === bid,
  );
}

export function claimRankUsd(listing: RankedListing): number {
  return claimPriceUsd(listing.bidUsd);
}

export function renderLast24hRow(listing: RankedListing, now?: Date): string {
  if (!isPaidListing(listing)) {
    return "";
  }
  const host = escapeHtml(displayHostPath(listing.productUrl));
  const blurb = escapeHtml(listing.whyTestThisToday);
  const when = escapeHtml(relativeTime(listing.createdAt, now));
  const bid = escapeHtml(formatUsd(listing.bidUsd));
  const isWindowPrize = listing.rank === 1;
  const prizeAttr = isWindowPrize ? ' data-last24h-prize=""' : "";
  const slot = isWindowPrize
    ? html`<span class="last24h-slot" data-last24h-slot="">Rolling 24h spend</span>`
    : "";
  return html`<li class="last24h-row" data-last24h-row="" data-last24h-id="${escapeHtml(listing.id)}"${prizeAttr}>
  <div class="last24h-link">
    <span class="last24h-body">
      ${slot}
      <span class="last24h-host">${host}</span>
      <span class="last24h-why">${blurb}</span>
    </span>
    <span class="last24h-meta">
      <span class="last24h-when"><time datetime="${escapeHtml(listing.createdAt)}">${when}</time></span>
      <span class="last24h-clicks">${listing.clicks} clicks</span>
      <span class="last24h-bid">${bid}</span>
      <span class="last24h-rank" data-last24h-rank="${listing.rank}" data-last24h-fact="" aria-label="Last 24 hours rank ${listing.rank}, not today’s cover">24h ${listing.rank}</span>
    </span>
  </div>
</li>`;
}

export function renderLast24hStrip(listings: RankedListing[], now?: Date): string {
  const paid = paidListings(listings);
  const occupied = paid.length > 0;
  const rows = occupied
    ? html`<ol class="last24h-list">
        ${paid.map((listing) => renderLast24hRow(listing, now)).join("")}
      </ol>`
    : html`<p class="last24h-empty" data-last24h-empty="">
        No paid listings in the last 24 hours. The strip stays empty — not a second cover. No invented #1.
      </p>`;
  return html`<aside id="last24h" class="last24h" data-last24h="" data-last24h-window="rolling-24h" data-ranking-surface="today" data-ranking-window="rolling-24h" data-slot="activity-strip"${occupied ? ' data-last24h-occupied=""' : ' data-last24h-empty-strip=""'}>
  <p class="last24h-kicker">Last 24 hours</p>
  <p class="last24h-dek">Spend in the rolling last 24 hours. Not a midnight UTC reset. Not a second all-time board. Cover #1 is this morning’s slot. A strip rank is a last-24h fact, not today’s cover #1.</p>
  ${rows}
</aside>`;
}

const CATEGORY_OPTIONS = [
  { label: "All", icon: "/icons/layout-grid-light.svg" },
  { label: "Agents", icon: "/icons/rail-bot.svg" },
  { label: "SEO", icon: "/icons/search-check.svg" },
  { label: "Marketing", icon: "/icons/rail-megaphone.svg" },
  { label: "Crypto", icon: "/icons/bitcoin.svg" },
  { label: "Developer", icon: "/icons/code-xml.svg" },
  { label: "Business", icon: "/icons/scale.svg" },
  { label: "Security", icon: "/icons/shield-check.svg" },
  { label: "Health", icon: "/icons/heart-pulse.svg" },
  { label: "Social", icon: "/icons/share-2.svg" },
  { label: "Stores", icon: "/icons/globe.svg" },
  { label: "Subscriptions", icon: "/icons/globe.svg" },
  { label: "Analytics", icon: "/icons/search-check.svg" },
  { label: "Growth", icon: "/icons/share-2.svg" },
  { label: "Launches", icon: "/icons/megaphone.svg" },
  { label: "Retention", icon: "/icons/heart-pulse.svg" },
] as const;

function renderCategoryChoices(className: string): string {
  return CATEGORY_OPTIONS.map(
    (option) => html`<button type="button" class="${className}-option" role="option" aria-selected="${option.label === "All" ? "true" : "false"}" data-category-option="${escapeHtml(option.label)}">
      <img src="${option.icon}" alt="" aria-hidden="true"/>
      ${escapeHtml(option.label)}
    </button>`,
  ).join("");
}

function renderCategoryPicker(): string {
  return html`<div class="category-picker" data-category-picker="">
    <input type="hidden" name="category" value="" data-category-value=""/>
    <input type="hidden" name="kind" value="" data-kind-value=""/>
    <button type="button" class="category-select" id="category-select" role="combobox" aria-haspopup="dialog" aria-expanded="false" aria-controls="category-menu" data-category-select="" data-slot="category-control">
      <span data-category-label>Choose a category</span>
    </button>
    <div class="category-menu" id="category-menu" role="dialog" aria-label="Choose a category and enter venue details" hidden data-category-menu="">
      <fieldset class="project-brief-fields" aria-label="Weekend venue details">
        <legend>Venue details</legend>
        <label>Venue name<input name="venueName" type="text" maxlength="120" autocomplete="organization" required data-required-city-field="" placeholder="Venue name"/></label>
      </fieldset>
      <div class="category-choice-list" role="listbox" aria-label="Choose a category">
        ${renderCategoryChoices("category-menu")}
      </div>
    </div>
  </div>`;
}

function renderCategoryRail(): string {
  return html`<nav class="category-rail" aria-label="Product categories" data-category-rail="" data-slot="category-rail">
    <div class="category-rail-scroll">
      <div class="category-chip-list">
        ${CATEGORY_OPTIONS.map(
          (option, index) => html`<button type="button" class="category-chip${index === 0 ? " is-selected" : ""}" data-category-chip="${escapeHtml(option.label)}"${index === 0 ? ' aria-current="true"' : ""}>
            <img src="${option.icon}" alt="" aria-hidden="true"/>
            ${escapeHtml(option.label)}
          </button>`,
        ).join("")}
      </div>
    </div>
    <button type="button" class="category-more" aria-haspopup="listbox" aria-expanded="false" aria-controls="category-overflow" data-category-more="">
      Explore <img src="/icons/chevron-right.svg" alt="" aria-hidden="true"/>
    </button>
    <div class="category-overflow" id="category-overflow" role="listbox" aria-label="More categories" hidden data-category-overflow="">
      ${renderCategoryChoices("category-overflow")}
    </div>
  </nav>`;
}

function renderStatsPill(referenceFixture = false): string {
  if (referenceFixture) {
    return html`<div class="stats-pill stats-pill-reference" data-stats-pill="" data-slot="stats-pill" data-reference-telemetry="local-fixture-only">
      <span class="stats-live"><span aria-hidden="true"></span>118 online</span>
      <span class="stats-window"> · 1,404,927 visitors</span>
      <a class="stats-link" href="/about"> · see stats→</a>
    </div>`;
  }
  // There is no first-party telemetry model in this vertical. Keep the pill
  // shape without turning a screenshot observation into a production claim.
  return html`<p class="stats-pill" data-stats-pill="" data-slot="stats-pill">
    <span>Public stats unavailable</span>
    <span>no live telemetry</span>
  </p>`;
}

function renderRankingTabs(): string {
  return html`<div class="ranking-tabs" role="tablist" aria-label="Ranking period" data-ranking-tabs="" data-slot="period-tabs">
    <button type="button" role="tab" id="ranking-tab-all-time" aria-controls="leaderboard" aria-selected="true" class="ranking-tab is-selected" data-ranking-tab="all-time" data-ranking-window="board-day" tabindex="0">
      <img src="/icons/trophy.svg" alt="" aria-hidden="true"/> All-time
    </button>
    <button type="button" role="tab" id="ranking-tab-today" aria-controls="last24h" aria-selected="false" class="ranking-tab" data-ranking-tab="today" data-ranking-window="rolling-24h" tabindex="-1">
      <span class="ranking-live-dot" aria-hidden="true"></span> Today
    </button>
  </div>`;
}

function renderSearchPopover(listings: RankedListing[]): string {
  const items = listings
    .filter(isPaidListing)
    .map((listing) => {
      const host = displayHostPath(listing.productUrl);
      const searchText = escapeHtml(`${host} ${listing.whyTestThisToday}`.toLowerCase());
      const target = escapeHtml(listing.id);
      return html`<li data-search-item="" data-search-text="${searchText}">
        <button type="button" class="search-result" data-search-result="" data-search-target="${target}">
          <strong>${escapeHtml(host)}</strong>
          <span>${escapeHtml(listing.whyTestThisToday)}</span>
        </button>
      </li>`;
    })
    .join("");
  const initialStatus = items
    ? "Search today’s paid listings by host or reason."
    : "No paid listings are available.";
  return html`<div id="listing-search" class="listing-search" hidden data-listing-search="">
    <div class="listing-search-panel" role="dialog" aria-modal="false" aria-labelledby="listing-search-title">
      <div class="listing-search-head">
        <h2 id="listing-search-title">Find a paid listing</h2>
        <button type="button" class="listing-search-close" data-search-close="" aria-label="Close listing search">Close</button>
      </div>
      <label class="listing-search-label" for="listing-search-input">
        Search current listings
        <input id="listing-search-input" type="search" autocomplete="off" spellcheck="false" placeholder="Host or why" data-search-input=""/>
      </label>
      <p class="listing-search-status" data-search-status="" role="status" aria-live="polite">${initialStatus}</p>
      <ul class="listing-search-results" data-search-results="">${items}</ul>
    </div>
  </div>`;
}

function renderClaimHero(claimCopy: string, defaultBid: number): string {
  return html`<h2 class="claim-title" data-slot="claim-heading">
    <span data-claim-copy>${claimCopy}</span>
    <span class="bid-stepper">
      <button type="button" class="step" data-bid-step="-1" aria-label="Decrease bid by one dollar">−</button>
      <label class="bid-field">
        <span class="sr-only">Amount in dollars</span>
        <span class="bid-sizer" aria-hidden="true">$${defaultBid}</span>
        <span class="bid-input-wrap">
          <span aria-hidden="true">$</span>
          <input id="bid-display" type="text" inputmode="numeric" pattern="[0-9]*" value="${defaultBid}" aria-label="Bid amount in dollars"/>
        </span>
      </label>
      <button type="button" class="step" data-bid-step="1" aria-label="Increase bid by one dollar">+</button>
    </span>
  </h2>`;
}

function renderProductUrlField(): string {
  return html`<label class="url-field" for="productUrl">
      <span class="sr-only">Product URL</span>
      <input id="productUrl" name="productUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" required placeholder="Your product URL or @handle" data-slot="url-input"/>
    </label>`;
}

function renderWhyField(): string {
  return html`<div class="claim-note-field" data-slot="why-field">
      <label class="field-label" for="whyTestThisToday">Why test this today</label>
      <input id="whyTestThisToday" name="whyTestThisToday" type="text" maxlength="140" minlength="8" required placeholder="What a seller should try this morning"/>
      <p class="claim-note-help">A short, specific reason helps sellers decide what to test.</p>
    </div>`;
}

type ClaimFormView = {
  occupied: boolean;
  defaultBid: number;
  productUrlField: string;
  whyField: string;
};

function renderClaimForm(view: ClaimFormView): string {
  const { productUrlField, whyField } = view;
  const formHint = html`<p class="form-hint">Already on the list? Enter the same URL and up your bid. You pay only the difference.</p>`;
  const occupiedWhyLand = view.occupied
    ? html`<div class="why-first" id="why" data-why-first="" data-list-land="" data-prize-line="">${whyField}</div>`
    : whyField;
  const bidForm = html`<form id="bid-form" class="bid-form" method="post" action="/checkout" data-slot="claim-form">
    ${productUrlField}
    ${occupiedWhyLand}
    ${renderCategoryPicker()}
    <input id="bid" name="bidUsd" type="hidden" value="${view.defaultBid}"/>
    <button type="submit" class="claim-submit outbid" id="claim-submit" data-claim-submit="" data-slot="claim-button" aria-label="Claim rank" disabled>Claim rank<span class="sr-only">Outbid</span></button>
    ${formHint}
  </form>`;
  return bidForm;
}

const OUTBID_TODAY_PRESENTATION = [
  {
    rank: 1,
    title: "Linkie by Publer — Your Unbranded Link in Bio",
    description: "Create your Linkie, a customizable link in bio tool for everything you share.",
    amount: "$3,140",
    icon: "/icons/linkie.svg",
  },
  {
    rank: 2,
    title: "Powerful Social Media Management & Scheduling Tools | Publer",
    description: "Boost your social media strategy with Publer’s suite of publishing tools.",
    amount: "$3,135",
    icon: "/icons/layout-grid-light.svg",
  },
  {
    rank: 3,
    title: "Letter Friend | Handwritten Notes Service - Authentic Letters by Real People, No Robots",
    description: "100% genuine handwritten notes service and authentic letters by real people.",
    amount: "$1,303",
    icon: "/icons/megaphone.svg",
  },
] as const;

function renderTodayPreview(listings: RankedListing[], referenceFixture = false): string {
  if (listings.length === 0) {
    return "";
  }
  if (referenceFixture) {
    return html`<section class="today-preview outbid-today-reference" aria-label="Today’s top ranking" data-today-preview="" data-slot="today-strip">
      <div class="preview-heading"><h2>Today’s top ranking</h2><span class="preview-see-all">See all</span></div>
      <ol class="outbid-today-list">
        ${OUTBID_TODAY_PRESENTATION.map((item) => html`<li>
          <a href="/?period=today">
            <span class="outbid-today-rank">#${item.rank}</span>
            <span class="outbid-today-icon"><img src="${item.icon}" alt="" aria-hidden="true"/></span>
            <span class="outbid-today-copy"><strong>${item.title}</strong><span>${item.description}</span><b>${item.amount}</b></span>
          </a>
        </li>`).join("")}
      </ol>
    </section>`;
  }
  return html`<section class="today-preview" aria-label="Today’s top ranking" data-today-preview="" data-slot="today-strip">
      <div class="preview-heading"><h2>Today’s top ranking</h2><span class="preview-see-all">See all</span></div>
      <div class="preview-grid">
        ${listings.slice(0, 3).map((listing) => html`<div class="preview-card" data-preview-id="${escapeHtml(listing.id)}">
          <span class="preview-rank">#${listing.rank}</span>
          <span class="preview-copy"><strong>${escapeHtml(displayHostPath(listing.productUrl))}</strong><span>${escapeHtml(listing.whyTestThisToday)}</span></span>
          <span class="preview-bid">${escapeHtml(formatUsd(listing.bidUsd))}</span>
        </div>`).join("")}
      </div>
    </section>`;
}

const OUTBID_ACTIVITY_PRESENTATION = [
  { title: "Free Image to Sketch Video", meta: "at #1803 · $5", age: "29 minutes ago", icon: "/icons/search-check.svg" },
  { title: "Earlier Boosts Cost Less", meta: "at #218 · $100", age: "2 hours ago", icon: "/icons/layout-grid-light.svg", blue: true },
  { title: "RankWar — chaque place a son prix", meta: "at #1801 · $5", age: "2 hours ago", icon: "/icons/megaphone.svg" },
  { title: "shipkit.us", meta: "at #1800 · $5", age: "2 hours ago", icon: "/icons/shield-check.svg" },
  { title: "Mylance: Be known for what you know on LinkedIn", meta: "at #1027 · $6", age: "2 hours ago", icon: "/icons/share-2.svg" },
] as const;

/** Exact lower-fold fixture is intentionally unreachable from live Waffo modes. */
function renderReferenceActivity(): string {
  return html`<section id="last24h" class="outbid-activity-reference" data-slot="activity-strip" data-ranking-surface="today" data-ranking-window="rolling-24h" aria-label="Latest activity">
    <h2><span aria-hidden="true"></span>Latest activity</h2>
    <ol class="outbid-activity-list">
      ${OUTBID_ACTIVITY_PRESENTATION.map((item) => html`<li><a href="/?period=today">
        <span class="outbid-activity-icon${"blue" in item && item.blue ? " outbid-activity-icon-blue" : ""}"><img src="${item.icon}" alt="" aria-hidden="true"/></span>
        <span class="outbid-activity-copy"><strong>${item.title}</strong><span>${item.meta}</span><small>${item.age}</small></span>
      </a></li>`).join("")}
    </ol>
  </section>
  <article class="outbid-reference-fourth" data-slot="reference-fourth-card">
    <a class="outbid-reference-fourth-link" href="/about" aria-label="Read about Outrank - Grow Organic Traffic on Auto-Pilot"></a>
    <div class="outbid-reference-fourth-body">
      <span class="outbid-reference-fourth-rank">#4</span>
      <span class="outbid-reference-fourth-icon"><img src="/icons/search-check-accent.svg" alt="" aria-hidden="true"/></span>
      <div class="outbid-reference-fourth-copy">
        <div><h3>Outrank - Grow Organic Traffic on Auto-Pilot</h3><strong>$13,005</strong></div>
        <p>Get traffic and outrank competitors with Backlinks &amp; SEO-optimized content while you sleep.</p>
        <footer><span class="outbid-reference-fourth-category"><img src="/icons/search-check.svg" alt="" aria-hidden="true"/>#1 in SEO</span><span>·</span><span>6 days ago</span><span>·</span><span>outrank.so</span><span>·</span><span>17,447 clicks</span><span>·</span><span>see details</span></footer>
      </div>
    </div>
  </article>`;
}

function renderLaterRows(listings: RankedListing[], now?: Date, visible = listings.length > 0): string {
  if (!visible) {
    return "";
  }
  return html`<section class="later-stack" data-later-stack="" data-slot="later-rows" data-ranking-surface="all-time" data-ranking-window="board-day" aria-label="Also on the desk">
  <p class="later-stack-kicker">Also on the desk</p>
  <p class="later-stack-dek">Paying less than #1 still lists. These product names are not this morning’s cover.</p>
  ${listings.map((listing) => renderListingRow(listing, now)).join("")}
</section>`;
}

function renderLeaderboardSurface(issueSpoken: string, rows: string, todayPreview: string, day: string, tz: string): string {
  return html`<section id="leaderboard" data-slot="top-three" data-ranking-surface="all-time" data-ranking-window="board-day" aria-label="Today’s cover">
<header class="masthead">
  <p class="masthead-kicker">Morning merch desk</p>
  <h1 class="masthead-title">${SITE_TITLE}</h1>
  <p class="masthead-issue">
    <span class="issue-label">Issue</span>
    <time datetime="${escapeHtml(day)}" data-issue-date="${escapeHtml(day)}">${issueSpoken}</time>
    <span class="issue-rule" aria-hidden="true"></span>
    <span class="issue-tz">${escapeHtml(tz)}</span>
  </p>
  <p class="masthead-dek">One cover. Product URL plus why test this today. Rank is the bid.</p>
</header>
  ${rows}
  ${todayPreview}
</section>`;
}

export function renderListingRow(
  listing: RankedListing,
  now?: Date,
  referenceFixture = false,
): string {
  if (!isPaidListing(listing)) {
    return "";
  }
  const rank = listing.rank;
  const isCover = rank === 1;
  const topClass = isCover
    ? " row-cover row-1"
    : rank === 2
      ? " row-stack row-2"
      : rank === 3
        ? " row-stack row-3"
        : " row-stack";
  const rawHost = displayHostPath(listing.productUrl);
  const reference = referenceFixture ? OUTBID_REFERENCE_LISTINGS[rawHost] : undefined;
  const host = escapeHtml(rawHost);
  const title = escapeHtml(reference?.title ?? rawHost);
  const blurb = escapeHtml(reference?.summary ?? listing.whyTestThisToday);
  const when = escapeHtml(reference?.age ?? relativeTime(listing.createdAt, now));
  const clicks = reference?.clicks ?? listing.clicks;
  const category = escapeHtml(reference ? `#1 in ${reference.category}` : `#${rank} in DTC picks`);
  const icon = escapeHtml(reference?.icon ?? "/icons/globe.svg");
  const bid = escapeHtml(formatUsd(listing.bidUsd));
  const href = escapeHtml(`/r/${listing.id}`);
  const coverWhy = isCover
    ? html`<div class="cover-why" data-cover-why="">
      <p class="cover-why-label">Why test this today</p>
      <p class="cover-why-line" data-prize-before-price="">${blurb}</p>
    </div>`
    : "";
  const coverHop = isCover
    ? html`<p class="cover-hop-wrap">
        <button type="button" class="cover-hop cover-hop-first podium-hover-action" data-cover-hop="" data-target="${href}" data-first-click="take" aria-label="Test this today at ${host}">Test this today</button>
      </p>`
    : "";
  const listRoute = isCover
    ? html`<p class="list-route-wrap" data-list-route-wrap="">
        <a class="list-route" href="#why" data-list-route="">List a product</a>
      </p>`
    : "";
  if (isCover) {
    const inner = html`<div class="row-leading" data-slot="card-leading">
      <div class="row-meta"><span class="rank">#${rank}</span></div>
      <span class="card-avatar" data-slot="card-avatar"><img src="${icon}" alt="" aria-hidden="true"/></span>
    </div>
    <a class="podium-hit" href="${href}" aria-label="Open ${host}">
    <div class="row-body podium-body">
      <p class="row-kicker">This morning’s cover</p>
      ${coverWhy}
      <div class="row-top">
        <p class="host" data-cover-name="" data-card-field="title">${title}</p>
        ${reference ? html`<p class="bid reference-card-price">${bid}</p>` : ""}
      </div>
      <p class="podium-description" data-card-field="body">${blurb}</p>
      <p class="podium-meta" data-card-field="footer">
        <span class="podium-category" data-card-meta="rank"><img src="${icon}" alt="" aria-hidden="true"/>${category}</span>
        <span aria-hidden="true">·</span>
        <span class="when" data-card-meta="age"><time datetime="${escapeHtml(listing.createdAt)}">${when}</time></span>
        <span aria-hidden="true">·</span>
        <span class="podium-host" data-card-meta="host">${host}</span>
        <span aria-hidden="true">·</span>
        <span class="podium-clicks" data-card-meta="clicks">${clicks.toLocaleString("en-US")} clicks</span>
        <span aria-hidden="true">·</span>
        <span class="podium-details" data-card-meta="details">see details</span>
      </p>
    </div>
    </a>
    ${coverHop}
    ${listRoute}
    <p class="cover-later" data-later-fact="">
      <span class="bid later-fact" data-later-fact="">${bid}</span>
      <span class="clicks later-fact" data-later-fact="">${clicks.toLocaleString("en-US")} clicks</span>
    </p>`;
    return html`<article class="row${topClass}" data-slot="paid-card" data-rank="${rank}" data-listing-id="${escapeHtml(listing.id)}" data-morning-slot="" data-paid-name=""${reference ? ' data-reference-card=""' : ""}>
  <div class="row-link" data-podium-card="">${inner}</div>
</article>`;
  }
  const claim = escapeHtml(formatUsd(claimRankUsd(listing)));
  const inner = html`<div class="row-leading" data-slot="card-leading">
      <div class="row-meta"><span class="rank">#${rank}</span></div>
      <span class="card-avatar" data-slot="card-avatar"><img src="${icon}" alt="" aria-hidden="true"/></span>
    </div>
    <div class="row-body podium-body">
      <div class="row-top">
        <p class="dek" data-card-field="title">${title}</p>
        <p class="bid">${bid}</p>
      </div>
      <p class="slot" data-card-field="body">${blurb}</p>
      <p class="row-foot" data-card-field="footer">
        <span class="podium-category" data-card-meta="rank"><img src="${icon}" alt="" aria-hidden="true"/>${category}</span>
        <span aria-hidden="true">·</span>
        <span class="when" data-card-meta="age"><time datetime="${escapeHtml(listing.createdAt)}">${when}</time></span>
        <span aria-hidden="true">·</span>
        <span class="podium-host" data-card-meta="host">${host}</span>
        <span aria-hidden="true">·</span>
        <span class="clicks" data-card-meta="clicks">${clicks.toLocaleString("en-US")} clicks</span>
        <span aria-hidden="true">·</span>
        <span class="podium-details" data-card-meta="details">see details</span>
      </p>
    </div>`;
  return html`<article class="row${topClass}" data-slot="${rank <= 3 ? "paid-card" : "later-card"}" data-rank="${rank}" data-listing-id="${escapeHtml(listing.id)}" data-later-rank=""${reference ? ' data-reference-card=""' : ""}>
  <a class="row-link podium-hit" href="${href}" data-podium-card="" aria-label="Open ${host}">${inner}</a>
  <p class="claim-after-row" data-claim-after-row="">
    <button type="button" class="claim-rank" data-claim-bid="${claimRankUsd(listing)}">claim this rank for ${claim}</button>
  </p>
</article>`;
}

export function renderBoardBody(model: BoardViewModel): string {
  const listings = withRanks(paidListings(model.listings));
  const last24h = withRanks(paidListings(model.last24h ?? []));
  const referenceFixture = isOutbidReferenceFixture(listings, model.fixtureMode);
  const searchListings = [...listings];
  for (const listing of last24h) {
    if (!searchListings.some((existing) => existing.id === listing.id)) {
      searchListings.push(listing);
    }
  }
  const leftoverUnpaid =
    Boolean(model.leftoverUnpaid) ||
    model.listings.some((listing) => !isPaidListing(listing)) ||
    (model.last24h ?? []).some((listing) => !isPaidListing(listing));
  const defaultBid = referenceFixture ? 17_005 : model.defaultBidUsd;
  const projected = rankForBid(listings, defaultBid);
  const claimCopy =
    listings.length === 0
      ? "Claim #1 for"
      : projected === 1
        ? "Claim #1 for"
        : `Claim #${projected} for`;
  const issueSpoken = formatIssueDate(model.day, model.tz);
  const occupied = listings.length > 0;
  const stripOccupied = last24h.length > 0;
  const coverListing = listings.find((listing) => listing.rank === 1);
  const podiumListings = listings.filter((listing) => listing.rank <= 3);
  const laterListings = listings.filter((listing) => listing.rank > 3);
  const laterStack = renderLaterRows(laterListings, model.now, occupied);
  const rows = occupied && coverListing
    ? podiumListings
        .map((listing) => renderListingRow(listing, model.now, referenceFixture))
        .join("")
    : html`<div class="empty" data-empty-board="" data-empty-cover="">
          <p class="empty-kicker">Quiet morning</p>
          <p><strong>No listings yet today.</strong></p>
        </div>
        <p class="empty-details">The desk is open. An empty morning is valid — not a broken site, not an invented cover. Bid ${escapeHtml(formatUsd(MIN_BID_USD))} to take the cover.</p>`;
  const deskAttrs = occupied
    ? ` data-occupied="true"${stripOccupied ? ' data-two-prizes=""' : ""}${referenceFixture ? ' data-reference-fixture=""' : ""}`
    : ` data-occupied="false"${leftoverUnpaid ? ' data-unpaid-off=""' : ""}`;
  const claimAttrs = occupied
    ? ""
    : ' aria-label="Claim #1"';
  const productUrlField = renderProductUrlField();
  const whyField = renderWhyField();
  const occupiedUrlAfterRail = occupied
    ? html`<div class="later-listing" data-later-listing=""><span class="sr-only">Product URL is collected in the claim form above.</span></div>`
    : "";
  const bidForm = renderClaimForm({ occupied, defaultBid, productUrlField, whyField });

  // Occupied cover: Test this today is the one first click. List a product is a quiet route to the form.
  // Occupied morning: Take is the first click. Claim #1 is a later write after the cover.
  // The cover keeps one quiet List route; the claim rail is Claim #1 / dashed $amount / ± / Outbid.
  // Occupied listing field after List is Why — the prize line, not a second generic line.
  // Occupied write after List starts at Why — the prize line, not Product URL first.
  // Occupied List landing starts at Why — the prize line, not louder Claim #1 chrome first.
  // Occupied claim rail after Why land is later rail — quieter than Why, not a second first read.
  // Occupied Product URL after later claim rail is later write — not a twin on the bid-row.
  const claimAfterOpen = occupied
    ? html`<div class="claim-after-cover" data-claim-after-cover="">`
    : "";
  const claimAfterClose = occupied ? html`</div>` : "";
  const laterRailOpen = occupied
    ? html`<div class="later-rail" data-later-rail="">`
    : "";
  const laterRailClose = occupied ? html`</div>` : "";

  const todayPreview = renderTodayPreview(occupied ? listings : [], referenceFixture);
  const claimNote = html`<p class="claim-note"${occupied ? ' data-unpaid-off=""' : leftoverUnpaid ? ' data-unpaid-off=""' : ""}>
    ${
      occupied || leftoverUnpaid
        ? html`<span class="unpaid-off-line">An incomplete or abandoned checkout stays off this desk and never becomes cover #1.</span>`
        : ""
    }
    <span class="accent">New spots start at ${escapeHtml(formatUsd(MIN_BID_USD))}.</span>
    Paying less than the #1 price still puts you on the board at whatever place that bid can take.
  </p>`;
  const leaderboard = renderLeaderboardSurface(issueSpoken, rows, todayPreview, model.day, model.tz);

  return html`<div class="desk"${deskAttrs}>
<main class="visual-home" data-visual-home="" data-slot="home-shell" data-ranking-period="all-time">
${claimAfterOpen}
<section id="claim" data-slot="claim-hero"${claimAttrs}>
  <div class="claim-context" data-claim-context="" data-slot="claim-context">
  ${renderStatsPill(referenceFixture)}
  ${renderRankingTabs()}
  </div>
  ${renderClaimHero(claimCopy, defaultBid)}
  ${claimNote}
  ${bidForm}
  ${renderCategoryRail()}
  ${laterRailOpen}
  <span class="legacy-later-rail-copy sr-only">Claim rank and Outbid stay available after the required product URL and test note.</span>
  ${laterRailClose}
  ${occupiedUrlAfterRail}
</section>
${claimAfterClose}
${leaderboard}
${referenceFixture ? renderReferenceActivity() : renderLast24hStrip(last24h, model.now)}
${laterStack}
</main>
</div>
${renderSearchPopover(searchListings)}
<script>
  (function () {
    var min = ${MIN_BID_USD};
    var root = document.querySelector(".outbid-reference-root");
    if (!root) return;
    var input = root.querySelector("#bid-display");
    var formBid = root.querySelector("#bid");
    var sizer = root.querySelector(".bid-sizer");
    var copy = root.querySelector("[data-claim-copy]");
    var submit = root.querySelector("[data-claim-submit]");
    var urlField = root.querySelector("#productUrl");
    var whyField = root.querySelector("#whyTestThisToday");
    var bidForm = root.querySelector("#bid-form");
    var categoryValue = root.querySelector("[data-category-value]");
    var categorySelect = root.querySelector("[data-category-select]");
    var categoryLabel = root.querySelector("[data-category-label]");
    var categoryMenu = root.querySelector("[data-category-menu]");
    var categoryMore = root.querySelector("[data-category-more]");
    var categoryOverflow = root.querySelector("[data-category-overflow]");
    var kindValue = root.querySelector("[data-kind-value]");
    var cityFields = root.querySelectorAll("[data-required-city-field]");
    var home = root.querySelector("[data-visual-home]");
    var rankingTabs = root.querySelectorAll("[data-ranking-tab]");
    var rankingSurfaces = root.querySelectorAll("[data-ranking-surface]");
    var searchButton = root.querySelector("#search-button");
    var searchPopover = root.querySelector("#listing-search");
    var searchInput = root.querySelector("#listing-search-input");
    var searchClose = root.querySelector("[data-search-close]");
    var searchStatus = root.querySelector("[data-search-status]");
    var searchItems = root.querySelectorAll("[data-search-item]");
    var bids = ${JSON.stringify(listings.map((row) => row.bidUsd))};
    function parseBid(raw) {
      var n = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
      return Number.isFinite(n) ? n : min;
    }
    function rankFor(bid) {
      var r = 1;
      for (var i = 0; i < bids.length; i++) if (bids[i] >= bid) r++;
      return r;
    }
    function sync() {
      var bid = Math.max(min, parseBid(input.value));
      input.value = String(bid);
      formBid = root.querySelector("#bid");
      if (formBid) {
        formBid.value = String(bid);
        formBid.setAttribute("value", String(bid));
      }
      if (sizer) sizer.textContent = "$" + bid;
      if (copy) copy.textContent = "Claim #" + rankFor(bid) + " for";
    }
    function validUrl(value) {
      try { return new URL(value).protocol === "https:"; } catch (e) { return false; }
    }
    function ready() {
      if (!submit) return;
      categoryValue = root.querySelector("[data-category-value]");
      kindValue = root.querySelector("[data-kind-value]");
      cityFields = root.querySelectorAll("[data-required-city-field]");
      var cityReady = Array.prototype.every.call(cityFields, function (field) {
        return String(field.value || "").trim().length > 0 && field.checkValidity();
      });
      var isReady = Boolean(urlField && validUrl(urlField.value.trim()) && categoryValue && categoryValue.value && kindValue && kindValue.value && whyField && whyField.value.trim().length >= 8 && input && parseBid(input.value) >= min && cityReady);
      submit.disabled = !isReady;
      submit.setAttribute("aria-disabled", isReady ? "false" : "true");
    }
    function closeMenu(menu, button) {
      if (menu) menu.hidden = true;
      if (button) button.setAttribute("aria-expanded", "false");
    }
    function setCategory(value) {
      categoryValue = root.querySelector("[data-category-value]");
      kindValue = root.querySelector("[data-kind-value]");
      if (categoryValue) {
        categoryValue.value = value;
        categoryValue.setAttribute("value", value);
      }
      if (kindValue) {
        var mappedKind = value === "Marketing" ? "bar" : value === "Agents" ? "restaurant" : value ? "show" : "";
        kindValue.value = mappedKind;
        kindValue.setAttribute("value", mappedKind);
      }
      if (categoryLabel) categoryLabel.textContent = value || "Choose a category";
      if (bidForm && value) bidForm.setAttribute("data-note-open", "");
      root.querySelectorAll("[data-category-option]").forEach(function (option) {
        option.setAttribute("aria-selected", option.getAttribute("data-category-option") === value ? "true" : "false");
      });
      root.querySelectorAll("[data-category-chip]").forEach(function (chip) {
        var selected = chip.getAttribute("data-category-chip") === value || (!value && chip.getAttribute("data-category-chip") === "All");
        chip.classList.toggle("is-selected", selected);
        if (selected) chip.setAttribute("aria-current", "true"); else chip.removeAttribute("aria-current");
      });
      closeMenu(categoryMenu, categorySelect);
      closeMenu(categoryOverflow, categoryMore);
      ready();
    }
    function normalizeRankingPeriod(value) {
      return value === "today" ? "today" : "all-time";
    }
    function rankingPeriodFromUrl() {
      try { return normalizeRankingPeriod(new URL(window.location.href).searchParams.get("period")); } catch (e) { return "all-time"; }
    }
    function setRankingPeriod(period, persist) {
      var activePeriod = normalizeRankingPeriod(period);
      var showToday = activePeriod === "today";
      if (home) home.setAttribute("data-ranking-period", activePeriod);
      rankingTabs.forEach(function (tab) {
        var selected = tab.getAttribute("data-ranking-tab") === activePeriod;
        tab.classList.toggle("is-selected", selected);
        tab.setAttribute("aria-selected", selected ? "true" : "false");
        tab.setAttribute("tabindex", selected ? "0" : "-1");
      });
      rankingSurfaces.forEach(function (surface) {
        var surfacePeriod = surface.getAttribute("data-ranking-surface");
        var selected = surfacePeriod === activePeriod;
        if (surfacePeriod === "today") {
          // Keep the documented rolling strip available below the default board;
          // when Today is selected it becomes the only visible ranking surface.
          surface.hidden = false;
          surface.setAttribute("aria-hidden", "false");
          surface.setAttribute("data-ranking-active", showToday ? "true" : "false");
        } else {
          surface.hidden = !selected;
          surface.setAttribute("aria-hidden", selected ? "false" : "true");
          surface.setAttribute("data-ranking-active", selected ? "true" : "false");
        }
      });
      if (persist && window.history && window.history.replaceState) {
        try {
          var next = new URL(window.location.href);
          if (showToday) next.searchParams.set("period", "today"); else next.searchParams.delete("period");
          window.history.replaceState(null, "", next.pathname + next.search + next.hash);
        } catch (e) { /* keep the in-page state when URL history is unavailable */ }
      }
    }
    function updateSearchResults() {
      var query = searchInput ? searchInput.value.trim().toLowerCase() : "";
      var matches = 0;
      searchItems.forEach(function (item) {
        var match = !query || (item.getAttribute("data-search-text") || "").indexOf(query) >= 0;
        item.hidden = !match;
        if (match) matches++;
      });
      if (searchStatus) {
        if (query) searchStatus.textContent = matches ? matches + (matches === 1 ? " paid listing matches." : " paid listings match.") : "No paid listings match.";
        else searchStatus.textContent = searchItems.length ? "Search today’s paid listings by host or reason." : "No paid listings are available.";
      }
    }
    function setSearchOpen(open, restoreFocus) {
      if (!searchButton || !searchPopover) return;
      searchPopover.hidden = !open;
      searchButton.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        updateSearchResults();
        if (searchInput) { searchInput.focus(); searchInput.select(); }
      } else if (restoreFocus) {
        searchButton.focus();
      }
    }
    if (!input) return;
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);
    [urlField, whyField].concat(Array.prototype.slice.call(cityFields)).forEach(function (field) {
      if (field) { field.addEventListener("input", ready); field.addEventListener("change", ready); }
    });
    if (categorySelect) categorySelect.addEventListener("click", function () {
      var open = categoryMenu && categoryMenu.hidden;
      if (categoryMenu) categoryMenu.hidden = !open;
      categorySelect.setAttribute("aria-expanded", open ? "true" : "false");
    });
    if (categoryMore) categoryMore.addEventListener("click", function () {
      var open = categoryOverflow && categoryOverflow.hidden;
      if (categoryOverflow) categoryOverflow.hidden = !open;
      categoryMore.setAttribute("aria-expanded", open ? "true" : "false");
    });
    root.querySelectorAll("[data-category-option]").forEach(function (option) {
      option.addEventListener("click", function () { setCategory(option.getAttribute("data-category-option") || ""); });
    });
    root.querySelectorAll("[data-category-chip]").forEach(function (chip) {
      chip.addEventListener("click", function () { setCategory(chip.getAttribute("data-category-chip") || ""); });
    });
    rankingTabs.forEach(function (tab, index) {
      tab.addEventListener("click", function () { setRankingPeriod(tab.getAttribute("data-ranking-tab") || "all-time", false); });
      tab.addEventListener("keydown", function (event) {
        var next = -1;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % rankingTabs.length;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + rankingTabs.length - 1) % rankingTabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = rankingTabs.length - 1;
        if (next < 0 || !rankingTabs[next]) return;
        event.preventDefault();
        rankingTabs[next].focus();
        setRankingPeriod(rankingTabs[next].getAttribute("data-ranking-tab") || "all-time", false);
      });
    });
    setRankingPeriod(rankingPeriodFromUrl(), false);
    if (searchButton && searchPopover) {
      searchButton.addEventListener("click", function () { setSearchOpen(searchPopover.hidden, true); });
      if (searchClose) searchClose.addEventListener("click", function () { setSearchOpen(false, true); });
      if (searchInput) searchInput.addEventListener("input", updateSearchResults);
      root.querySelectorAll("[data-search-result]").forEach(function (result) {
        result.addEventListener("click", function () {
          var targetId = result.getAttribute("data-search-target");
          var target = null;
          root.querySelectorAll("[data-listing-id], [data-last24h-id]").forEach(function (row) {
            if (!target && row.getAttribute("data-listing-id") === targetId) target = row;
            if (!target && row.getAttribute("data-last24h-id") === targetId) target = row;
          });
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            var focusable = target.querySelector("a, button");
            if (focusable) focusable.focus();
          }
          setSearchOpen(false, false);
        });
      });
      document.addEventListener("click", function (event) {
        if (!searchPopover.hidden && !searchButton.contains(event.target) && !searchPopover.contains(event.target)) setSearchOpen(false, false);
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !searchPopover.hidden) { event.preventDefault(); setSearchOpen(false, true); }
      });
    }
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { closeMenu(categoryMenu, categorySelect); closeMenu(categoryOverflow, categoryMore); }
    });
    root.querySelectorAll("[data-bid-step]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var step = Number(btn.getAttribute("data-bid-step"));
        var next = Math.max(min, parseBid(input.value) + step);
        input.value = String(next);
        sync();
      });
    });
    root.querySelectorAll("[data-claim-bid]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        input.value = String(btn.getAttribute("data-claim-bid"));
        sync();
        var field = root.querySelector("#whyTestThisToday") || root.querySelector("#productUrl");
        if (field) field.focus();
        var land = root.querySelector("#why") || root.querySelector("#claim");
        if (land) land.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    root.querySelectorAll(".cover-hop").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var href = btn.getAttribute("data-target");
        if (href) window.location.assign(href);
      });
    });
    sync();
    ready();
  })();
</script>`;
}

export function renderBoardPage(model: BoardViewModel): string {
  return renderLayout({
    title: SITE_TITLE,
    description:
      "Daily public auction for this morning’s DTC / Shopify / Amazon picks cover. Rank is the bid.",
    active: "leaderboard",
    day: model.day,
    tz: model.tz,
    now: model.now,
    body: renderBoardBody({
      ...model,
      defaultBidUsd: model.defaultBidUsd || defaultClaimBidUsd(paidListings(model.listings)),
    }),
  });
}
