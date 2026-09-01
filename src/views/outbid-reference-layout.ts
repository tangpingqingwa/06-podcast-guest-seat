import {
  boardTimeZone,
  dayKey,
  formatIssueDate,
} from "./outbid-reference-day.js";
import {
  escapeHtml,
  formatFolioDate,
  html,
} from "./outbid-reference-html.js";
import { BOARD_CSS } from "./outbid-reference-styles.js";

export const SITE_NAME = "picks.daily";
export const SITE_TITLE = "DTC Picks Daily";

export type NavId = "leaderboard" | "about" | "rules";

export type LayoutInput = {
  title?: string;
  description?: string;
  active: NavId;
  body: string;
  day?: string;
  tz?: string;
  now?: Date;
};

function navItem(href: string, label: string, current: boolean): string {
  return html`<li><a href="${href}"${current ? ' aria-current="page"' : ""}>${label}</a></li>`;
}

function navUnavailable(label: string): string {
  // Keep unavailable source surfaces visible as honest context, but do not
  // expose dead links until their route/data owner ships them.
  return html`<li><span class="nav-unavailable" aria-disabled="true">${label}</span></li>`;
}

type SiteHeaderInput = {
  active: NavId;
  day: string;
  folio: string;
  issueSpoken: string;
};

function renderSearchButton(active: NavId): string {
  return active === "leaderboard"
    ? '<button type="button" class="search-button" id="search-button" aria-label="Find paid listings" aria-expanded="false" aria-controls="listing-search"><img src="/icons/search.svg" alt="" aria-hidden="true"/></button>'
    : '<button type="button" class="search-button" aria-label="Find unavailable" aria-disabled="true" disabled><img src="/icons/search.svg" alt="" aria-hidden="true"/></button>';
}

/** The shared header is a view component so its geometry stays independent of page content. */
export function renderSiteHeader(input: SiteHeaderInput): string {
  const day = escapeHtml(input.day);
  const folio = escapeHtml(input.folio);
  const issueSpoken = escapeHtml(input.issueSpoken);
  return html`<header class="site-header" data-site-header="" data-slot="site-header">
    <div class="site-header-inner" data-site-header-inner="" data-slot="shell">
      <a class="brand" href="/" data-slot="brand">
        <img class="brand-mark" src="/icons/outbid-mark.svg" alt="" aria-hidden="true"/>
        <span>outbid<span class="brand-dot">.</span>lol</span>
      </a>
      <p class="rail-folio">
        <span class="rail-kicker">Morning edition</span>
        <time datetime="${day}" data-issue-date="${day}">${folio}</time>
      </p>
      <div class="nav-wrap">
        <nav aria-label="Main" data-slot="primary-nav">
          <ul>
            ${navItem("/", "Leaderboard", input.active === "leaderboard")}
            ${navUnavailable("Daily")}
            ${navUnavailable("Categories")}
            ${navItem("/about", "About", input.active === "about")}
            <li class="nav-rules"><a href="/rules"${input.active === "rules" ? ' aria-current="page"' : ""}>Rules</a></li>
          </ul>
        </nav>
        ${renderSearchButton(input.active)}
        <button type="button" class="theme-toggle" id="theme-toggle" aria-label="Switch to dark mode">
          <img src="/icons/moon.svg" alt="" aria-hidden="true"/>
        </button>
      </div>
    </div>
    <p class="sr-only">${issueSpoken}. Date is the issue.</p>
  </header>`;
}

export function renderLayout(input: LayoutInput): string {
  const tz = input.tz ?? boardTimeZone();
  const day = input.day ?? dayKey(input.now, tz);
  const title = escapeHtml(input.title ?? SITE_TITLE);
  const description = escapeHtml(
    input.description ??
      "Bid USD. Own this morning’s cover. Sellers see your product link first.",
  );
  const folio = formatFolioDate(day);
  const issueSpoken = formatIssueDate(day, tz);
  const siteHeader = renderSiteHeader({
    active: input.active,
    day,
    folio,
    issueSpoken,
  });
  return `<!DOCTYPE html>
<html lang="en" class="h-full">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <meta name="description" content="${description}"/>
  <style>${BOARD_CSS}</style>
</head>
<body>
  ${siteHeader}
  <div class="page">
    ${input.body}
  </div>
  <script>
    (function () {
      var root = document.documentElement;
      var key = "theme";
      var btn = document.getElementById("theme-toggle");
      function apply(theme) {
        root.classList.toggle("dark", theme === "dark");
        if (btn) btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
      }
      try { apply(localStorage.getItem(key) || "light"); } catch (e) { apply("light"); }
      if (btn) {
        btn.addEventListener("click", function () {
          var next = root.classList.contains("dark") ? "light" : "dark";
          try { localStorage.setItem(key, next); } catch (e) {}
          apply(next);
        });
      }
    })();
  </script>
</body>
</html>`;
}
