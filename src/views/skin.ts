/**
 * Guest Seat is a production-control-room surface: an episode slate, claim
 * console, cue rail, and rundown stack. There are no remote assets or product
 * logos here: the visual identity belongs to the guest-seat rundown.
 */
export const STUDIO_CSS = /* css */ `
:root {
  --background: #fffdfb;
  --foreground: #28221e;
  --primary: #d9785b;
  --primary-strong: #cb6346;
  --primary-foreground: #ffffff;
  --primary-soft: #f9ded5;
  --primary-softer: #fff3ee;
  --surface: #ffffff;
  --muted-surface: #f8f2ef;
  --muted-surface-strong: #f1e9e5;
  --muted: #746963;
  --muted-foreground: #746963;
  --border: #eaded9;
  --border-strong: #e6c2b6;
  --ring: #d9785b;
  --radius: 25px;
  --sans: "DM Sans", "DM Sans Fallback", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: "Geist Mono", "SF Mono", ui-monospace, Menlo, monospace;
}

html[data-theme="dark"] {
  --background: #171310;
  --foreground: #f6eee9;
  --primary: #d97a5c;
  --primary-strong: #e18a6d;
  --primary-foreground: #1d1512;
  --primary-soft: #3a211a;
  --primary-softer: #271b17;
  --surface: #1c1714;
  --muted-surface: #241d19;
  --muted-surface-strong: #32251f;
  --muted: #b5a49b;
  --muted-foreground: #b5a49b;
  --border: #4e352d;
  --border-strong: #875042;
  --ring: #e18a6d;
}

*, *::before, *::after { box-sizing: border-box; }
html, body {
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 0;
  overflow-x: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
html::-webkit-scrollbar, body::-webkit-scrollbar { display: none; width: 0; height: 0; }
html { min-height: 100%; background: var(--background); }
body {
  min-height: 100%;
  font-family: var(--sans);
  background: var(--background);
  color: var(--foreground);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
a { color: inherit; text-decoration: none; }
button, input { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled, input:disabled { cursor: not-allowed; opacity: 0.52; }
[hidden] { display: none !important; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

main, body > footer {
  width: min(calc(100% - 32px), 992px);
  max-width: 992px;
  min-width: 0;
  margin: 0 auto;
}
.site-header {
  position: relative;
  width: 100%;
  max-width: none;
  height: 76px;
  min-height: 76px;
  padding: 20px 0 16px;
  display: block;
}
.header-shell {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  width: min(calc(100% - 32px), 992px);
  height: 100%;
  min-width: 0;
  margin: 0 auto;
}
.header-shell > * { min-width: 0; }
.brand {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.055em;
  white-space: nowrap;
}
.mobile-context { display: none; }
.studio > .mobile-context {
  position: absolute;
  top: -56px;
  left: 131.68px;
  display: flex;
  justify-content: center;
  width: 173px;
  margin: 0;
}
.ranking-tabs {
  display: inline-flex;
  align-items: center;
  justify-content: stretch;
  width: 173px;
  height: 40px;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--muted-surface) 66%, transparent);
}
.ranking-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  min-width: 0;
  min-height: 30px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  padding: 4px 8px;
  color: var(--muted-foreground);
  font-size: 13px;
  white-space: nowrap;
}
.ranking-tab[aria-selected="true"], .ranking-tab[aria-current="page"], .ranking-tab:hover {
  background: var(--surface);
  color: var(--foreground);
  box-shadow: 0 1px 3px rgb(42 30 25 / 0.08);
}
.header-cluster { display: inline-flex; align-items: center; justify-content: flex-end; gap: 15px; min-width: 0; }
nav[aria-label="Main"] { display: inline-flex; align-items: center; gap: 22px; font-size: 14px; }
nav[aria-label="Main"] a { color: var(--foreground); font-weight: 500; white-space: nowrap; }
nav[aria-label="Main"] a[aria-current="page"], nav[aria-label="Main"] a:hover { color: var(--primary-strong); }
.header-actions { display: inline-flex; align-items: center; gap: 8px; }
.search-popover {
  position: absolute;
  z-index: 10;
  top: calc(100% + 8px);
  right: 0;
  width: min(320px, calc(100vw - 32px));
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: 0 18px 38px rgb(67 43 34 / 0.16);
}
.search-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; }
.search-input { width: 100%; height: 36px; min-width: 0; padding: 4px 10px; border: 1px solid var(--border); border-radius: 12px; background: transparent; color: var(--foreground); font-size: 13px; line-height: 20px; }
.search-input::placeholder { color: var(--muted-foreground); }
.search-close { height: 36px; padding: 0 9px; border: 1px solid var(--border); border-radius: 12px; background: var(--muted-surface); color: var(--foreground); font-size: 11px; font-weight: 700; }
.search-close:hover, .search-close:focus-visible { border-color: var(--border-strong); background: var(--primary-soft); color: var(--primary-strong); }
.search-prompt, .search-empty { margin: 9px 2px 2px; color: var(--muted-foreground); font-size: 11px; line-height: 16px; }
.search-results { display: grid; gap: 4px; max-height: 280px; margin-top: 8px; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; }
.search-results::-webkit-scrollbar { display: none; width: 0; height: 0; }
.search-result { display: grid; gap: 1px; min-width: 0; padding: 8px 9px; border-radius: 12px; background: var(--muted-surface); }
.search-result:hover, .search-result:focus-visible { background: var(--primary-soft); }
.search-result-kind { color: var(--primary-strong); font-size: 9px; font-weight: 800; letter-spacing: 0.06em; line-height: 13px; text-transform: uppercase; }
.search-result-title { overflow: hidden; color: var(--foreground); font-size: 13px; line-height: 17px; text-overflow: ellipsis; white-space: nowrap; }
.search-result-detail, .search-result-summary { overflow: hidden; color: var(--muted-foreground); font-size: 10px; line-height: 14px; text-overflow: ellipsis; white-space: nowrap; }
.header-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 3px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--foreground);
  font-size: 11px;
  font-weight: 650;
  line-height: 16px;
  white-space: nowrap;
}
.header-icon:hover, .header-icon:focus-visible { background: var(--primary-soft); color: var(--primary-strong); }
.theme-toggle[aria-pressed="true"] { background: var(--primary-soft); }

main { min-height: 420px; padding: 0 0 72px; }
.studio { position: relative; display: flex; flex-direction: column; width: 100%; min-width: 0; }
.studio > * { min-width: 0; }
.show-ticket {
  align-self: center;
  display: flex;
  align-items: center;
  width: 310px;
  max-width: 100%;
  height: 32px;
  min-height: 32px;
  margin: 16px auto 0;
  padding: 6px 12px;
  border: 0;
  border-radius: 999px;
  background: var(--muted-surface);
  color: var(--muted-foreground);
  box-shadow: 0 3px 12px rgb(67 43 34 / 0.04);
  justify-content: center;
  font-size: 13px;
  line-height: 20px;
}
.ticket-main { display: inline-flex; align-items: center; gap: 8px; min-width: 0; padding: 0; }
.ticket-kicker { display: inline-flex; align-items: center; margin: 0; color: var(--foreground); font-size: 13px; font-weight: 700; white-space: nowrap; }
.ticket-label, .ticket-seat, .ticket-veto { margin: 0; }
.ticket-label { font-weight: 600; white-space: nowrap; }
.ticket-seat { color: var(--muted-foreground); white-space: nowrap; }
.ticket-veto, .ticket-stub { display: none; }

.claim { position: relative; width: 100%; margin: 20px auto 0; padding: 0; text-align: center; }
.claim[data-claim-state="locked"] {
  margin-top: 20px;
  padding: 24px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--primary-softer);
  box-shadow: inset 3px 0 0 var(--primary);
  text-align: left;
}
.claim[data-claim-state="locked"] .claim-title { justify-content: flex-start; text-align: left; letter-spacing: -0.045em; }
.claim[data-claim-state="locked"] .claim-note, .claim[data-claim-state="locked"] .form-hint { margin-left: 0; text-align: left; }
.claim[data-empty-honest] { margin-top: 20px; }
.claim-title {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 6px 8px;
  min-height: 60px;
  margin: 0;
  color: var(--foreground);
  text-align: center;
  font-size: 40px;
  font-weight: 750;
  letter-spacing: -0.06em;
  line-height: 60px;
}
.claim-title > span:first-child { flex: 0 1 auto; min-width: 0; max-width: 100%; }
.bid-stepper { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; white-space: nowrap; }
.step { display: inline-grid; flex: 0 0 24px; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 999px; background: var(--primary-soft); color: var(--primary); font-size: 16px; font-weight: 800; line-height: 1; }
.step:hover { background: var(--primary); color: var(--primary-foreground); }
.bid-field { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; min-width: 0; color: var(--primary); font-weight: 750; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bid-field input { width: 2ch; min-width: 2ch; max-width: 8ch; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; font-variant-numeric: tabular-nums; outline: none; text-align: center; }
.bid-field[data-raise-amount-field] { flex-direction: column; gap: 1px; }
.bid-field[data-raise-amount-field] .bid-amount { text-decoration: none; }
.raise-amount { position: absolute; width: 1px; height: 1px; max-width: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
a:focus-visible, button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
.bid-field input:focus-visible { outline: 2px solid var(--ring); outline-offset: 0.15rem; }
.claim-note, .form-hint { max-width: 860px; margin: 0 auto; color: var(--muted-foreground); font-size: 11px; line-height: 16px; }
.claim-note { position: absolute; left: 16px; right: 16px; top: 64px; height: 1px; overflow: hidden; opacity: 0; }
.bid-form { display: flex; align-items: start; gap: 8px; width: 100%; min-height: 44px; margin-top: 24px; text-align: left; }
.fields { display: grid; grid-template-columns: minmax(0, 604fr) minmax(0, 256fr); align-items: start; gap: 8px; flex: 1 1 auto; min-width: 0; }
.fields input { width: 100%; height: 44px; min-width: 0; padding: 4px 12px; border: 1px solid var(--border); border-radius: 20px; background: transparent; color: var(--foreground); font-size: 14px; line-height: 20px; }
.fields input::placeholder { color: var(--muted-foreground); opacity: 0.92; }
.fields input:hover { border-color: var(--border-strong); }
.fields .span-2 { grid-column: auto; }
.identity-primary { display: flex; min-width: 0; }
.identity-details { min-width: 0; }
.identity-details > summary { display: flex; align-items: center; justify-content: space-between; height: 44px; min-width: 0; padding: 4px 13px; border: 1px solid var(--border); border-radius: 20px; color: var(--muted-foreground); cursor: pointer; font-size: 14px; line-height: 20px; list-style: none; }
.identity-details > summary::-webkit-details-marker { display: none; }
.identity-details > summary:hover { border-color: var(--border-strong); color: var(--foreground); }
.identity-details[open] { grid-column: 1 / -1; }
.identity-details[open] > summary { border-color: var(--border-strong); background: var(--primary-softer); color: var(--foreground); }
.identity-details-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 8px; margin-top: 8px; }
.identity-details-fields .span-2 { grid-column: 1 / -1; }
.outbid { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; min-width: 115px; height: 44px; padding: 0 20px; border: 1px solid transparent; border-radius: 999px; background: #e19b87; color: var(--primary-foreground); font-size: 14px; font-weight: 750; line-height: 20px; white-space: nowrap; }
.outbid[data-occupied-outbid] [data-raiser-outbid-guest] { font-size: 11px; line-height: 16px; }
.outbid:hover { background: var(--primary-strong); }
.outbid:disabled { background: #e19b87; color: var(--primary-foreground); opacity: 0.68; }
.form-hint { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }

.function-rail { position: relative; display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; min-height: 32px; margin: 32px 0 0; overflow: visible; border-bottom: 0; }
.rail-chip { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 32px; padding: 5px 11px; border: 1px solid transparent; border-radius: 999px; background: transparent; color: var(--muted-foreground); font-size: 13px; font-weight: 550; line-height: 19px; white-space: nowrap; }
.rail-chip:hover, .rail-chip[aria-pressed="true"] { border-color: var(--border-strong); background: var(--primary-soft); color: var(--primary-strong); }
.rail-chip[aria-pressed="true"] { font-weight: 750; }
.rail-more { margin-left: auto; border-color: var(--border); background: var(--surface); color: var(--foreground); font-weight: 700; }
.rail-menu { position: absolute; z-index: 4; top: calc(100% + 7px); right: 0; display: grid; grid-template-columns: repeat(2, minmax(140px, 1fr)); gap: 4px; width: min(100%, 360px); padding: 8px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); box-shadow: 0 16px 34px rgb(67 43 34 / 0.14); }
.rail-menu button { border: 0; border-radius: 10px; background: transparent; padding: 8px 9px; color: var(--foreground); text-align: left; font-size: 12px; }
.rail-menu button:hover, .rail-menu button:focus-visible { background: var(--primary-soft); color: var(--primary-strong); }

.rundown { display: grid; gap: 12px; width: 100%; margin: 20px 0 0; padding: 0; list-style: none; }
/* Keep the rank explanation in the document for assistive technology, below the visual board. */
.rundown-head { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
.week-window { margin: 0 2px; color: var(--muted-foreground); font-size: 10px; line-height: 14px; }
.later-rundown { margin-top: 20px; }
.lower-fold { display: grid; gap: 54px; width: 100%; margin: 8px 0 19px; }
.compact-section { min-width: 0; }
.compact-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-height: 18px; }
.compact-section-head h2 { margin: 0; color: var(--foreground); font-size: 12px; font-weight: 750; letter-spacing: -0.015em; line-height: 18px; }
.compact-section-context { overflow: hidden; color: var(--muted-foreground); font-size: 10px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.compact-ranking-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.compact-ranking-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 40px; padding: 7px 10px; overflow: hidden; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.compact-ranking-rank { display: inline-flex; align-items: center; justify-content: center; min-width: 25px; height: 22px; border-radius: 999px; background: var(--primary-soft); color: var(--primary-strong); font-size: 10px; font-weight: 800; line-height: 14px; }
.compact-ranking-copy { display: grid; min-width: 0; gap: 1px; }
.compact-ranking-name { overflow: hidden; color: var(--foreground); font-size: 11px; font-weight: 750; line-height: 15px; text-overflow: ellipsis; white-space: nowrap; }
.compact-ranking-site { overflow: hidden; color: var(--muted-foreground); font-size: 9px; line-height: 13px; text-overflow: ellipsis; white-space: nowrap; }
.compact-ranking-bid { color: var(--primary-strong); font-size: 11px; line-height: 15px; white-space: nowrap; }
.activity-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.activity-item { display: grid; align-content: space-between; gap: 7px; min-height: 52px; padding: 8px 9px; overflow: hidden; border-radius: 14px; background: var(--muted-surface); }
.activity-kind { color: var(--primary-strong); font-size: 9px; font-weight: 750; line-height: 13px; white-space: nowrap; }
.activity-copy { display: grid; min-width: 0; gap: 1px; }
.activity-copy strong, .activity-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activity-copy strong { color: var(--foreground); font-size: 10px; font-weight: 700; line-height: 14px; }
.activity-copy span { color: var(--muted-foreground); font-size: 9px; line-height: 13px; }
.activity-facts { display: flex; flex-wrap: wrap; gap: 0 6px; color: var(--muted-foreground); font-size: 9px; line-height: 13px; }
.activity-facts time { white-space: nowrap; }
.guest { position: relative; display: grid; grid-template-columns: 64px minmax(0, 1fr); grid-template-areas: "cue person"; gap: 0 16px; align-items: center; width: 100%; min-height: 110px; padding: 14px 16px; overflow: hidden; border: 2px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--foreground); list-style: none; transition: border-color 120ms ease, background 120ms ease, transform 120ms ease, box-shadow 120ms ease; }
.guest:hover, .guest:focus-within { border-color: var(--border-strong); box-shadow: 0 8px 22px rgb(67 43 34 / 0.08); }
.guest.booked { border-color: var(--primary); background: var(--primary-soft); }
.guest.later-seat, .guest[data-rank="2"] { border-color: #eaccc3; background: #fff6f2; }
.guest[data-rank="3"] { border-color: #eeded8; background: #fffaf8; }
.guest.vetoed { border-color: var(--border); background: var(--muted-surface); opacity: 0.82; }
.cue { grid-area: cue; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 5px; min-width: 0; }
.cue-num { display: inline-flex; align-items: center; justify-content: center; min-width: 40px; min-height: 28px; padding: 3px 9px; border-radius: 999px; background: var(--primary); color: var(--primary-foreground); font-size: 13px; font-weight: 800; line-height: 19px; white-space: nowrap; }
.guest.vetoed .cue-num { background: var(--muted-surface-strong); color: var(--muted-foreground); }
.cue-kind { color: var(--muted-foreground); font-size: 9px; font-weight: 750; letter-spacing: 0.08em; text-transform: uppercase; }
.person { grid-area: person; min-width: 0; padding-right: 112px; }
.guest-footer { min-width: 0; }
.guest-name { margin: 0; overflow: hidden; color: var(--foreground); font-size: 16px; font-weight: 750; letter-spacing: -0.025em; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.guest-name a:hover { color: var(--primary-strong); }
.guest-line { display: -webkit-box; margin: 2px 0 0; overflow: hidden; color: var(--muted-foreground); font-size: 13px; line-height: 19px; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.guest-site { margin: 3px 0 0; color: var(--muted-foreground); font-size: 11px; line-height: 16px; }
.guest-site a { text-decoration: underline dashed; text-underline-offset: 0.18em; }
.guest-veto { margin: 4px 0 0; color: var(--primary-strong); font-size: 11px; line-height: 16px; }
.later-facts, .later-foot, .tally { color: var(--muted-foreground); font-size: 10px; line-height: 14px; }
.later-facts { display: flex; flex-wrap: wrap; gap: 0 8px; margin: 3px 0 0; }
.guest > .lead-bid, .guest > .later-bid, .tally .bid { position: absolute; top: 14px; right: 16px; margin: 0; color: var(--primary-strong); font-size: 16px; font-weight: 750; line-height: 22px; }
.later-facts .bid.later-fact { color: var(--muted-foreground); font-size: 12px; font-weight: 650; }
.later-facts .clicks, .later-facts .when { color: var(--muted-foreground); }
.tally { position: static; }
.tally .clicks, .tally .when { margin: 2px 0 0; }
.later-foot { grid-area: foot; display: flex; flex-wrap: wrap; gap: 0 8px; margin: 4px 0 0; }
.later-go { color: var(--muted-foreground); text-decoration: underline dashed; text-underline-offset: 0.18em; }
.empty { margin: 22px 0 0; padding: 24px 20px; border: 1px dashed var(--border-strong); border-radius: var(--radius); background: var(--muted-surface); color: var(--muted-foreground); text-align: center; }
.empty.waiting, .empty.open-seat { display: grid; gap: 6px; justify-items: center; }
.empty-kicker { margin: 0; color: var(--primary-strong); font-size: 11px; font-weight: 750; letter-spacing: 0.08em; text-transform: uppercase; }
.empty-lead { margin: 0; color: var(--foreground); font-size: 18px; font-weight: 750; letter-spacing: -0.03em; line-height: 25px; }
.empty.waiting p, .empty.open-seat p { margin: 0; max-width: 42rem; }
.empty-window { margin: 0; color: var(--muted-foreground); font-size: 11px; }
.empty-path a { color: var(--primary-strong); text-decoration: underline; }
.no-eligible { border-color: var(--border-strong); }
.host-open { display: grid; gap: 7px; width: 100%; margin: 24px 0 0; padding: 20px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--muted-surface); }
.host-open[data-host-action="open"] { border-style: dashed; }
.host-open[data-host-action="lock"] { border-color: var(--border-strong); }
.host-open .empty-kicker, .host-open .empty-lead { margin: 0; }
.host-open-note { margin: 0; max-width: 42rem; color: var(--muted-foreground); font-size: 12px; line-height: 18px; }
.host-open-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 8px; width: 100%; margin-top: 5px; }
.host-open-form input { width: 100%; height: 42px; border: 1px solid var(--border); border-radius: 12px; background: transparent; padding: 0 11px; }
.host-open-form .open-next, .host-open-form .lock-episode { height: 42px; padding: 0 17px; border: 1px solid var(--primary); border-radius: 999px; background: var(--primary); color: var(--primary-foreground); font-size: 13px; font-weight: 750; white-space: nowrap; }
.host-open-form .open-next:hover, .host-open-form .lock-episode:hover { background: var(--primary-strong); }

body > footer { padding: 0 0 32px; color: var(--muted-foreground); font-size: 12px; line-height: 18px; }
.maker-footer {
  padding: 20px 0 32px;
  border-top: 1px dashed var(--border);
  color: var(--muted-foreground);
  font-family: var(--mono);
  font-size: 10px;
  line-height: 15px;
  letter-spacing: 0.04em;
  text-align: center;
}
.maker-footer p { margin: 0; }
.maker-footer a {
  color: var(--primary-strong);
  text-decoration: underline;
  text-decoration-style: dashed;
  text-underline-offset: 0.2em;
  overflow-wrap: anywhere;
}
.maker-footer a:hover { color: var(--foreground); }
.maker-footer a:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 4px;
  border-radius: 3px;
}
.doc { max-width: 720px; margin: 40px auto 0; color: var(--muted-foreground); }
.doc h1, .doc h2 { color: var(--foreground); letter-spacing: -0.045em; }
.doc h1 { font-size: 40px; line-height: 1.15; }
.doc h2 { margin-top: 32px; font-size: 24px; }
.doc a { color: var(--primary-strong); text-decoration: underline; }
.doc table { width: 100%; border-collapse: collapse; }
.doc th, .doc td { text-align: left; vertical-align: top; padding: 10px 8px; border-bottom: 1px solid var(--border); }
.doc th { width: 25%; color: var(--muted-foreground); font-size: 12px; font-weight: 700; }
.doc code { border-radius: 5px; background: var(--muted-surface); padding: 2px 4px; }
.doc[data-checkout-state="locked"] .empty { letter-spacing: -0.02em; }

/* Empty-open remains honest: no occupied-only rank/prize chrome can leak in. */
/* Empty open: name the fair occupied-rank window without showing occupied chrome. */
.studio.studio-open-empty[data-empty-honest] .empty.open-seat[data-empty-honest] .empty-window[data-empty-window] { margin: 0; color: var(--muted); font-family: var(--mono); font-size: 11px; }
/* Empty open: claim-note names rolling last-7-days beside Claim #1. */
.studio.studio-open-empty[data-empty-honest] .claim.empty-claim-first[data-empty-claim-first] .claim-note[data-empty-claim-window] { color: var(--muted); }
.studio.studio-open-empty[data-empty-honest] [data-guest-prize],
.studio.studio-open-empty[data-empty-honest] [data-first-click="guest"],
.studio.studio-open-empty[data-empty-honest] [data-later-seat],
.studio.studio-open-empty[data-empty-honest] [data-later-go],
.studio.studio-open-empty[data-empty-honest] [data-later-foot],
.studio.studio-open-empty[data-empty-honest] [data-later-facts],
.studio.studio-open-empty[data-empty-honest] [data-later-fact],
.studio.studio-open-empty[data-empty-honest] [data-claim-state="open-occupied"],
.studio.studio-open-empty[data-empty-honest] [data-occupied-window],
.studio.studio-open-empty[data-empty-honest] [data-occupied-raise],
.studio.studio-open-empty[data-empty-honest] [data-raise-amount-field],
.studio.studio-open-empty[data-empty-honest] [data-raise-amount],
.studio.studio-open-empty[data-empty-honest] [data-new-bid-usd],
.studio.studio-open-empty[data-empty-honest] [data-new-guest-waffo-charge],
.studio.studio-open-empty[data-empty-honest] [data-raiser-waffo-charge],
.studio.studio-open-empty[data-empty-honest] [data-raise-lead-usd],
.studio.studio-open-empty[data-empty-honest] [data-new-guest-claim-note],
.studio.studio-open-empty[data-empty-honest] [data-raiser-claim-note],
.studio.studio-open-empty[data-empty-honest] [data-raiser-claim-usd],
.studio.studio-open-empty[data-empty-honest] [data-claim-note-lead],
.studio.studio-open-empty[data-empty-honest] [data-new-guest-form-hint],
.studio.studio-open-empty[data-empty-honest] [data-raiser-form-hint],
.studio.studio-open-empty[data-empty-honest] [data-raiser-form-hint-usd],
.studio.studio-open-empty[data-empty-honest] [data-form-hint-lead],
.studio.studio-open-empty[data-empty-honest] [data-raiser-guest],
.studio.studio-open-empty[data-empty-honest] [data-raiser-guest-name],
.studio.studio-open-empty[data-empty-honest] [data-occupied-outbid],
.studio.studio-open-empty[data-empty-honest] [data-raiser-outbid-guest],
.studio.studio-open-empty[data-empty-honest] [data-raiser-outbid-guest-name],
.studio.studio-open-empty[data-empty-honest] [data-live-listings],
.studio.studio-open-empty[data-empty-honest] [data-rolling-week],
.studio.studio-open-empty[data-empty-honest] .week-window,
.studio.studio-open-empty[data-empty-honest] [data-paid-at],
.studio.studio-open-empty[data-empty-honest] [data-claim-locked],
.studio.studio-open-empty[data-empty-honest] [data-claim-state="locked"],
.studio.studio-open-empty[data-empty-honest] [data-host-lock],
.studio.studio-open-empty[data-empty-honest] [data-host-open],
.studio.studio-open-empty[data-empty-honest] .rundown,
.studio.studio-open-empty[data-empty-honest] .guest { display: none; }
.studio.studio-open-empty [data-guest-prize],
.studio.studio-open-empty [data-first-click="guest"],
.studio.studio-open-empty [data-later-seat],
.studio.studio-open-empty [data-later-go],
.studio.studio-open-empty [data-later-foot],
.studio.studio-open-empty [data-later-facts],
.studio.studio-open-empty [data-later-fact],
.studio.studio-open-empty [data-claim-state="open-occupied"],
.studio.studio-open-empty [data-occupied-window],
.studio.studio-open-empty [data-occupied-raise],
.studio.studio-open-empty [data-raise-amount-field],
.studio.studio-open-empty [data-raise-amount],
.studio.studio-open-empty [data-new-bid-usd],
.studio.studio-open-empty [data-new-guest-waffo-charge],
.studio.studio-open-empty [data-raiser-waffo-charge],
.studio.studio-open-empty [data-raise-lead-usd],
.studio.studio-open-empty [data-new-guest-claim-note],
.studio.studio-open-empty [data-raiser-claim-note],
.studio.studio-open-empty [data-raiser-claim-usd],
.studio.studio-open-empty [data-claim-note-lead],
.studio.studio-open-empty [data-new-guest-form-hint],
.studio.studio-open-empty [data-raiser-form-hint],
.studio.studio-open-empty [data-raiser-form-hint-usd],
.studio.studio-open-empty [data-form-hint-lead],
.studio.studio-open-empty [data-raiser-guest],
.studio.studio-open-empty [data-raiser-guest-name],
.studio.studio-open-empty [data-occupied-outbid],
.studio.studio-open-empty [data-raiser-outbid-guest],
.studio.studio-open-empty [data-raiser-outbid-guest-name],
.studio.studio-open-empty [data-live-listings],
.studio.studio-open-empty [data-rolling-week],
.studio.studio-open-empty .week-window,
.studio.studio-open-empty [data-paid-at],
.studio.studio-open-empty .later-fact,
.studio.studio-open-empty .later-facts,
.studio.studio-open-empty .occupied-claim,
.studio.studio-open-empty .raise-amount,
.studio.studio-open-empty .guest.later-seat,
.studio.studio-open-empty .later-name,
.studio.studio-open-empty .later-go,
.studio.studio-open-empty .later-foot,
.studio.studio-open-empty .rundown,
.studio.studio-open-empty .guest { display: none; }
.empty[data-empty-honest] .empty-lead { color: var(--foreground); }

/* All paid rows vetoed: keep the public record visible while the claim stays non-occupied. */
.studio.studio-all-vetoed .rundown[data-rundown],
.studio.studio-all-vetoed .guest[data-vetoed="true"] {
  display: grid;
}
.studio.studio-open-occupied .empty.open-seat,
.studio.studio-locked .empty.open-seat,
.studio.studio-waiting .empty.open-seat { display: none; }
.studio.studio-open-empty[data-empty-honest] .empty.open-seat[data-empty-honest],
.studio.studio-open-empty .empty.open-seat[data-empty-honest] { display: grid; }

@media (max-width: 760px) {
  main, body > footer { width: calc(100% - 32px); max-width: none; min-width: 0; }
  .site-header { height: 69px; min-height: 69px; padding: 18px 0 17px; }
  .header-shell { width: calc(100% - 32px); max-width: none; grid-template-columns: auto minmax(0, 1fr); gap: 8px; }
  .brand { max-width: 120px; overflow: hidden; text-overflow: ellipsis; font-size: 19px; }
  .header-cluster { min-width: 0; gap: 8px; overflow: hidden; }
  nav[aria-label="Main"] { min-width: 0; gap: 10px; overflow: hidden; font-size: 12px; }
  .header-actions { gap: 1px; }
  .header-icon { min-width: 25px; width: auto; height: 25px; padding: 0 2px; font-size: 10px; }
  .show-ticket { height: 32px; min-height: 32px; margin-top: 16px; font-size: 12px; }
  .ticket-main { gap: 6px; }
  .ticket-seat { display: none; }
  .mobile-context { display: flex; justify-content: center; width: 100%; margin-top: 20px; }
  .studio > .mobile-context { position: static; top: auto; left: auto; width: 100%; margin-top: 22px; }
  .mobile-context .ranking-tabs { padding: 3px; }
  .mobile-context .ranking-tab { min-height: 30px; padding: 4px 10px; }
  .claim { margin-top: 25px; }
  .claim-title { flex-wrap: wrap; justify-content: center; min-width: 0; min-height: 36px; font-size: 24px; line-height: 30px; letter-spacing: -0.055em; gap: 6px 8px; text-align: center; white-space: normal; }
  .claim-title > span:first-child { flex: 0 1 auto; max-width: 100%; }
  .bid-stepper { gap: 6px; }
  .step { width: 22px; height: 22px; font-size: 14px; }
  .step { flex-basis: 22px; }
  .bid-field input { width: 2ch; min-width: 2ch; }
  .bid-form { display: grid; gap: 8px; margin-top: 18px; }
  .fields { grid-template-columns: 1fr; gap: 8px; }
  .fields input { height: 44px; border-radius: 20px; font-size: 14px; }
  .fields .span-2 { grid-column: auto; }
  .identity-details[open] { grid-column: auto; }
  .identity-details-fields { grid-template-columns: 1fr; gap: 8px; }
  .identity-details-fields .span-2 { grid-column: auto; }
  .outbid { width: 100%; height: 44px; }
  .function-rail { margin-top: 32px; gap: 5px; min-height: 32px; }
  .rail-chip { padding: 5px 9px; font-size: 12px; }
  .function-rail > .rail-chip:nth-of-type(n+4):not(.rail-more) { display: none; }
  .rail-more { margin-left: auto; }
  .rail-menu { left: 0; right: 0; width: 100%; grid-template-columns: 1fr; border-radius: 15px; }
  .rundown { margin-top: 22px; gap: 8px; }
  .rundown-head { display: block; }
  .lower-fold { display: grid; gap: 24px; margin-top: 20px; }
  .week-window { font-size: 9px; }
  .guest { grid-template-columns: 38px minmax(0, 1fr); grid-template-areas: "cue person"; gap: 0 10px; height: 123px; min-height: 123px; padding: 12px; border-radius: 20px; }
  .cue { gap: 4px; }
  .cue-num { min-width: 32px; min-height: 26px; padding: 2px 7px; font-size: 11px; line-height: 18px; }
  .cue-kind { display: none; }
  .person { padding-right: 0; }
  .guest-name { font-size: 14px; line-height: 19px; }
  .guest-line { margin-top: 2px; font-size: 12px; line-height: 17px; -webkit-line-clamp: 3; }
  .guest-site { margin-top: 3px; font-size: 10px; }
  .guest-veto { font-size: 10px; }
  .later-facts { gap: 0 6px; margin-top: 4px; font-size: 9px; line-height: 13px; }
  .guest > .lead-bid, .guest > .later-bid, .tally .bid { top: 12px; right: 12px; font-size: 14px; line-height: 19px; }
  .later-facts .bid.later-fact { font-size: 10px; }
  .later-foot { gap: 0 6px; font-size: 9px; line-height: 13px; }
  .empty { margin-top: 22px; padding: 20px 16px; border-radius: 20px; }
  .host-open { margin-top: 20px; padding: 16px; border-radius: 20px; }
  .host-open-form { grid-template-columns: 1fr; }
  .host-open-form .open-next, .host-open-form .lock-episode { width: 100%; }
  .maker-footer { padding: 16px 0 26px; }
  .doc { margin-top: 28px; }
  .doc h1 { font-size: 32px; }
  .doc th, .doc td { display: block; width: 100%; padding: 8px 0; }
  .doc th { border-bottom: 0; padding-bottom: 0; }
}

/* Final Guest Seat identity: an episode slate and claim console feed a cue rail
   and production rundown. This is intentionally a different composition from
   the shared marketplace reference. */
main, body > footer {
  width: min(calc(100% - 32px), 1160px);
  max-width: 1160px;
}
.header-shell { width: min(calc(100% - 32px), 1160px); }
.site-header { height: 84px; min-height: 84px; padding: 24px 0 18px; }
.brand { gap: 10px; }
.brand-mark { display: block; width: 30px; height: 30px; flex: 0 0 30px; border-radius: 9px; }
.brand-wordmark { font-weight: 750; }
.brand-descriptor {
  color: var(--primary-strong);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  line-height: 14px;
  text-transform: uppercase;
}
main { min-height: 520px; padding: 0 0 88px; }
.studio-board { display: flex; flex-direction: column; gap: 22px; width: 100%; }
.studio-intro {
  display: grid;
  grid-template-columns: minmax(236px, 260px) minmax(0, 1fr);
  gap: 20px;
  align-items: stretch;
}
.episode-slate-column { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.episode-slate-column .show-ticket {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: space-between;
  width: 100%;
  height: auto;
  min-height: 196px;
  margin: 0;
  padding: 20px;
  border: 1px solid var(--border-strong);
  border-radius: 24px;
  background: linear-gradient(145deg, var(--primary-softer), var(--surface) 72%);
  box-shadow: inset 4px 0 0 var(--primary), 0 12px 28px rgb(67 43 34 / 0.06);
  text-align: left;
}
.episode-slate-column .ticket-main {
  display: grid;
  align-content: start;
  gap: 7px;
  min-width: 0;
}
.episode-slate-column .ticket-kicker {
  color: var(--primary-strong);
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.episode-slate-column .ticket-label {
  overflow: hidden;
  color: var(--foreground);
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.06em;
  line-height: 28px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.episode-slate-column .ticket-seat {
  color: var(--foreground);
  font-size: 13px;
  font-weight: 700;
  text-transform: capitalize;
}
.episode-slate-column .ticket-veto {
  display: block;
  max-width: 24rem;
  color: var(--muted-foreground);
  font-size: 11px;
  line-height: 16px;
}
.episode-slate-column .ticket-stub {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 8px;
  padding-top: 18px;
  border-top: 1px dashed var(--border-strong);
}
.episode-slate-column .stub-state {
  margin: 0;
  color: var(--primary-strong);
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.12em;
}
.episode-slate-column .stub-admit {
  margin: 0;
  color: var(--muted-foreground);
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.16em;
}
.episode-slate-column .mobile-context {
  display: flex;
  justify-content: flex-start;
  width: 100%;
  margin: 0;
}
.episode-slate-column .ranking-tabs { width: 100%; }
.claim-console {
  min-width: 0;
  padding: 1px;
  border: 1px solid var(--border);
  border-radius: 26px;
  background: var(--surface);
  box-shadow: 0 14px 32px rgb(67 43 34 / 0.06);
}
.claim-console .claim {
  width: 100%;
  min-height: 100%;
  margin: 0;
  padding: 28px 30px;
  border: 0;
  border-radius: 25px;
  background: radial-gradient(circle at 90% 0%, var(--primary-softer), transparent 40%), var(--surface);
  text-align: left;
}
.claim-console .claim-title {
  justify-content: center;
  min-height: 58px;
  min-width: 0;
  color: var(--foreground);
  text-align: center;
  font-size: clamp(30px, 3.4vw, 46px);
  line-height: 1.12;
}
.claim-console .claim-note {
  position: static;
  width: auto;
  height: auto;
  max-width: none;
  margin: 12px 0 0;
  overflow: visible;
  color: var(--muted-foreground);
  opacity: 1;
  text-align: left;
  white-space: normal;
}
.claim-console .form-hint {
  position: static;
  width: auto;
  height: auto;
  max-width: none;
  margin: 10px 0 0;
  overflow: visible;
  clip: auto;
  color: var(--muted-foreground);
  text-align: left;
  white-space: normal;
}
.claim-console .bid-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  min-width: 0;
  gap: 10px;
  margin-top: 22px;
}
.claim-console .fields {
  grid-column: 1;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 0.72fr);
}
.claim-console .identity-primary, .claim-console .identity-details { width: 100%; }
.claim-console .identity-details > summary { width: 100%; }
.claim-console .outbid {
  grid-column: 2;
  align-self: end;
  max-width: 100%;
  min-width: 132px;
}
.rundown-desk {
  display: grid;
  grid-template-columns: minmax(236px, 260px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.cue-column {
  min-width: 0;
  align-self: start;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--muted-surface);
}
.cue-column .function-rail {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  height: auto;
  min-height: 0;
  margin: 0;
}
.cue-column .rail-chip {
  justify-content: flex-start;
  width: 100%;
  min-height: 36px;
  padding: 7px 10px;
  border-radius: 12px;
  text-align: left;
}
.cue-column .rail-more { margin-left: 0; }
.cue-column .rail-menu {
  top: calc(100% + 8px);
  right: 0;
  left: 0;
  grid-template-columns: 1fr;
  width: 100%;
}
.cue-ledger {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px dashed var(--border-strong);
}
.cue-ledger-kicker {
  margin: 0 0 12px;
  color: var(--primary-strong);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.cue-ledger-list { display: grid; gap: 9px; margin: 0; }
.cue-ledger-list > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.cue-ledger-list dt {
  color: var(--muted-foreground);
  font-family: var(--mono);
  font-size: 10px;
  text-transform: uppercase;
}
.cue-ledger-list dd {
  margin: 0;
  color: var(--foreground);
  font-size: 11px;
  font-weight: 700;
  text-align: right;
}
.cue-ledger-note {
  margin: 16px 0 0;
  color: var(--muted-foreground);
  font-size: 10px;
  line-height: 15px;
}
.rundown-column { min-width: 0; }
.desk-heading {
  display: grid;
  gap: 4px;
  padding: 3px 2px 0;
}
.desk-kicker {
  margin: 0;
  color: var(--primary-strong);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.desk-heading h2 {
  margin: 0;
  color: var(--foreground);
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.055em;
  line-height: 32px;
}
.desk-summary {
  margin: 0;
  color: var(--muted-foreground);
  font-size: 12px;
  line-height: 18px;
}
.rundown-column .rundown { margin-top: 16px; gap: 12px; }
.rundown-column .guest {
  grid-template-columns: 78px minmax(0, 1fr) 118px;
  grid-template-areas: "cue person tally";
  min-height: 132px;
  height: auto;
  padding: 18px;
  border-width: 1px;
  border-radius: 18px;
  background: var(--surface);
  box-shadow: 0 8px 22px rgb(67 43 34 / 0.05);
}
.rundown-column .guest.booked {
  grid-template-areas: "cue person price";
  min-height: 156px;
  border-width: 2px;
  border-color: var(--primary);
  background: linear-gradient(120deg, var(--primary-soft), var(--surface) 68%);
  box-shadow: 0 14px 30px rgb(203 99 70 / 0.12);
}
.rundown-column .guest.later-seat {
  grid-template-rows: minmax(0, 1fr) auto;
  grid-template-areas: "cue person price" "cue foot price";
  border-left-width: 4px;
  border-left-color: var(--border-strong);
  background: var(--primary-softer);
}
.rundown-column .guest.vetoed {
  grid-template-areas: "cue person tally";
  background: var(--muted-surface);
  box-shadow: none;
}
.rundown-column .guest > .lead-bid,
.rundown-column .guest > .later-bid {
  position: static;
  grid-area: price;
  align-self: start;
  justify-self: end;
  margin: 0;
  font-size: 18px;
  line-height: 24px;
}
.rundown-column .guest > .later-bid { color: var(--muted-foreground); }
.rundown-column .tally {
  grid-area: tally;
  display: grid;
  align-content: start;
  justify-items: end;
  gap: 2px;
  text-align: right;
}
.rundown-column .tally .bid { position: static; color: var(--primary-strong); font-size: 18px; line-height: 24px; }
.rundown-column .tally .clicks, .rundown-column .tally .when { margin: 0; }
.rundown-column .person { padding-right: 0; }
.rundown-column .guest-name { font-size: 17px; line-height: 22px; }
.rundown-column .guest-line { max-width: 48rem; font-size: 13px; line-height: 19px; }
.rundown-column .guest-footer { margin-top: 7px; }
.rundown-column .guest-site { margin: 0; }
.rundown-column .later-foot { grid-area: foot; min-width: 0; margin: 8px 0 0; }
.rundown-column .cue-num { min-width: 48px; border-radius: 12px; }
.rundown-column [data-placement][hidden] { display: none !important; }
.host-desk-slot:empty { display: none; }
.host-desk-slot > .host-open { margin-top: 0; }
.lower-fold {
  margin: 26px 0 0;
  padding-top: 22px;
  border-top: 1px dashed var(--border-strong);
}
.compact-section-head h2 { font-family: var(--mono); letter-spacing: 0.02em; text-transform: uppercase; }

@media (max-width: 760px) {
  main, body > footer { width: calc(100% - 32px); max-width: none; min-width: 0; }
  .site-header { height: auto; min-height: 102px; padding: 16px 0 12px; }
  .header-shell {
    display: grid;
    grid-template-columns: 1fr;
    gap: 9px;
    width: calc(100% - 32px);
    max-width: none;
    height: auto;
  }
  .brand { width: 100%; max-width: none; overflow: visible; text-overflow: clip; font-size: 19px; }
  .brand-descriptor { display: inline-block; max-width: none; overflow: visible; font-size: 8px; text-overflow: clip; white-space: nowrap; }
  .header-cluster {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    width: 100%;
    min-width: 0;
    gap: 8px;
    overflow: visible;
  }
  nav[aria-label="Main"] {
    display: flex;
    min-width: 0;
    width: 100%;
    gap: 12px;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 3px;
    scrollbar-width: none;
    -ms-overflow-style: none;
    font-size: 12px;
  }
  nav[aria-label="Main"]::-webkit-scrollbar { display: none; width: 0; height: 0; }
  nav[aria-label="Main"] a { flex: 0 0 auto; }
  .header-actions { flex: 0 0 auto; }
  .studio-board { gap: 16px; }
  .studio-intro, .rundown-desk { grid-template-columns: 1fr; gap: 14px; }
  .episode-slate-column .show-ticket {
    flex-direction: row;
    align-items: center;
    min-height: 0;
    padding: 16px;
    border-radius: 20px;
  }
  .episode-slate-column .ticket-main { gap: 4px; }
  .episode-slate-column .ticket-kicker { font-size: 9px; }
  .episode-slate-column .ticket-label { font-size: 19px; line-height: 23px; }
  .episode-slate-column .ticket-seat { display: block; font-size: 11px; }
  .episode-slate-column .ticket-veto { display: block; font-size: 10px; line-height: 14px; }
  .episode-slate-column .ticket-stub { flex: 0 0 auto; display: grid; justify-items: end; padding-top: 0; border-top: 0; }
  .episode-slate-column .stub-admit { display: none; }
  .episode-slate-column .mobile-context { display: flex; margin-top: 0; }
  .episode-slate-column .ranking-tabs { height: 34px; }
  .claim-console .claim { padding: 21px 18px; border-radius: 20px; }
  .claim-console .claim-title { flex-wrap: wrap; justify-content: center; min-height: 0; font-size: 24px; line-height: 30px; text-align: center; white-space: normal; }
  .claim-console .bid-form { grid-template-columns: 1fr; gap: 8px; margin-top: 18px; }
  .claim-console .fields { grid-column: 1; grid-template-columns: 1fr; gap: 8px; }
  .claim-console .outbid { grid-column: 1; width: 100%; }
  .cue-column { padding: 14px; border-radius: 18px; }
  .cue-column .function-rail { flex-direction: row; align-items: center; gap: 5px; min-height: 36px; overflow-x: auto; }
  .cue-column .rail-chip { flex: 0 0 auto; width: auto; min-height: 32px; padding: 6px 9px; }
  .cue-column .rail-chip:nth-of-type(n+4):not(.rail-more) { display: inline-flex; }
  .cue-column .rail-more { margin-left: 0; }
  .cue-column .rail-menu { top: calc(100% + 7px); left: 0; right: 0; width: 100%; }
  .cue-ledger { display: none; }
  .lower-fold { gap: 24px; }
  .compact-ranking-grid, .activity-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: visible;
  }
  .compact-ranking-item {
    grid-template-columns: 34px minmax(0, 1fr) max-content;
    min-width: 0;
    min-height: 50px;
    padding: 9px 11px;
    overflow: visible;
  }
  .compact-ranking-name, .compact-ranking-site {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .compact-ranking-name { font-size: 12px; line-height: 16px; }
  .compact-ranking-site { font-size: 10px; line-height: 14px; }
  .compact-ranking-bid { align-self: start; font-size: 12px; line-height: 16px; }
  .activity-item {
    grid-template-columns: minmax(0, 1fr) max-content;
    grid-template-areas: "kind facts" "copy facts";
    min-width: 0;
    min-height: 61px;
    padding: 10px 11px;
    gap: 4px 10px;
    overflow: visible;
  }
  .activity-kind { grid-area: kind; }
  .activity-copy { grid-area: copy; min-width: 0; }
  .activity-copy strong, .activity-copy span {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .activity-copy strong { font-size: 12px; line-height: 16px; }
  .activity-copy span { font-size: 10px; line-height: 14px; }
  .activity-facts {
    grid-area: facts;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
    flex-wrap: nowrap;
    gap: 2px;
    white-space: nowrap;
  }
  .desk-heading { padding: 0 2px; }
  .desk-heading h2 { font-size: 24px; line-height: 28px; }
  .rundown-column .rundown { margin-top: 12px; gap: 9px; }
  .rundown-column .guest {
    grid-template-columns: 44px minmax(0, 1fr) max-content;
    grid-template-areas: "cue person tally";
    min-height: 138px;
    padding: 14px;
    border-radius: 16px;
  }
  .rundown-column .guest.booked { grid-template-areas: "cue person price"; min-height: 154px; }
  .rundown-column .guest.later-seat {
    grid-template-rows: minmax(0, 1fr) auto;
    grid-template-areas: "cue person price" "cue foot price";
  }
  .rundown-column .guest > .lead-bid,
  .rundown-column .guest > .later-bid,
  .rundown-column .tally .bid { font-size: 14px; line-height: 19px; }
  .rundown-column .tally { gap: 1px; }
  .rundown-column .guest-name { font-size: 14px; line-height: 19px; }
  .rundown-column .guest-line { font-size: 12px; line-height: 17px; -webkit-line-clamp: 3; }
  .rundown-column .guest-footer { margin-top: 5px; }
  .rundown-column .guest-site { font-size: 10px; }
  .rundown-column .later-foot { margin-top: 6px; font-size: 9px; line-height: 13px; }
  .rundown-column .cue-num { min-width: 34px; min-height: 26px; padding: 2px 7px; font-size: 11px; }
  .rundown-column .cue-kind { display: none; }
  .host-desk-slot > .host-open { margin-top: 0; }
  .lower-fold { margin-top: 20px; padding-top: 18px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; }
}
`;

/* Occupied live only: Waffo-paid #1 is emphasized; later seats stay quieter. */
export const OCCUPIED_CSS = /* css */ `
/* Occupied live: keep the paid cards in the shared component tracks. */
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] {
  margin-top: 20px;
  padding: 0;
  border-top: 0;
}
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .claim-title {
  color: var(--foreground);
  font-weight: 750;
  letter-spacing: -0.05em;
}
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .claim-note,
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .form-hint {
  color: var(--muted-foreground);
  font-size: 11px;
}
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .bid-field {
  font-size: 0.95em;
}
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .bid-field[data-raise-amount-field] {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  text-decoration: none;
}
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .bid-field[data-raise-amount-field] .bid-amount {
  text-decoration: none;
  font-variant-numeric: tabular-nums;
}
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .bid-field[data-raise-amount-field] .raise-amount {
  font-size: 10px;
  font-weight: 600;
  color: var(--muted-foreground);
}
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .bid-field[data-raise-amount-field] [data-new-bid-usd],
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .bid-field[data-raise-amount-field] [data-raiser-waffo-charge],
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .bid-field[data-raise-amount-field] [data-raise-lead-usd] {
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .step {
  width: 24px;
  height: 24px;
}
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .outbid {
  height: 44px;
  font-size: 14px;
  font-weight: 750;
}
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .outbid[data-occupied-outbid] [data-raiser-outbid-guest] {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.01em;
}
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .outbid[data-occupied-outbid] [data-raiser-outbid-guest-name] {
  font-weight: 700;
}
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .claim-note[data-occupied-window],
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .claim-note[data-occupied-raise],
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .form-hint[data-occupied-form-hint] {
  color: var(--muted-foreground);
}
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .claim-note[data-occupied-raise] [data-new-guest-claim-note],
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .claim-note[data-occupied-raise],
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .form-hint[data-occupied-form-hint] [data-new-guest-form-hint],
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .form-hint[data-occupied-form-hint] [data-raiser-form-hint],
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] [data-raiser-guest],
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] [data-raiser-guest-name] {
  color: var(--muted-foreground);
}
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] [data-raiser-claim-usd],
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] [data-raiser-form-hint-usd],
.studio.studio-open-occupied .claim[data-claim-state="open-occupied"] [data-raiser-guest-name] {
  font-variant-numeric: tabular-nums;
}

/* Paid card surfaces are the outer 110px desktop / 123px mobile component. */
@media (min-width: 761px) {
  .studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .claim-title {
    height: 60px;
    min-height: 60px;
    line-height: 60px;
  }
  .studio.studio-open-occupied .guest[data-paid-at] {
    height: 110px;
    min-height: 110px;
    align-content: stretch;
  }
  .studio.studio-open-occupied .guest[data-paid-at] .cue {
    align-self: center;
  }
  .studio.studio-open-occupied .guest[data-paid-at] .cue-num {
    font-variant-numeric: tabular-nums;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] {
    grid-template-columns: 64px minmax(0, 1fr);
    grid-template-areas: "cue person";
    gap: 0 16px;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .cue {
    grid-area: cue;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .person {
    display: grid;
    grid-template-rows: 20px 32px minmax(0, 1fr);
    grid-area: person;
    align-content: stretch;
    min-width: 0;
    min-height: 0;
    padding-right: 112px;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-name {
    font-size: 16px;
    line-height: 20px;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-name a[data-first-click="guest"] {
    text-decoration: underline;
    text-underline-offset: 0.14em;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-line {
    min-width: 0;
    max-width: 100%;
    max-height: 32px;
    margin: 0;
    line-height: 16px;
    -webkit-line-clamp: 2;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-footer {
    display: grid;
    grid-template-rows: 13px 13px;
    align-content: space-between;
    min-width: 0;
    min-height: 26px;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-site,
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .later-facts[data-later-facts] {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    line-height: 13px;
    white-space: nowrap;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-site {
    color: var(--muted-foreground);
    font-size: 11px;
    text-overflow: ellipsis;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .later-facts[data-later-facts] {
    display: flex;
    align-items: baseline;
    gap: 0 9px;
    font-size: 10px;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .later-facts .clicks,
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .later-facts .when {
    white-space: nowrap;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] > .lead-bid {
    position: absolute;
    top: 14px;
    right: 16px;
    color: var(--primary-strong);
    font-size: 0.95rem;
    font-weight: 750;
    line-height: 20px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] {
    grid-template-columns: 64px minmax(0, 1fr);
    grid-template-rows: 52px 14px;
    grid-template-areas: "cue person" "foot foot";
    gap: 0 16px;
    padding: 14px 16px;
    align-content: space-between;
    border-left-width: 2px;
    border-left-color: #eaccc3;
    background-color: #fff6f2;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .cue {
    grid-area: cue;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .person {
    display: grid;
    grid-area: person;
    grid-template-rows: 20px 32px;
    align-content: start;
    min-width: 0;
    min-height: 0;
    padding-right: 112px;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .guest-name {
    font-size: 15px;
    line-height: 20px;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .guest-line {
    min-width: 0;
    max-width: 100%;
    max-height: 32px;
    margin: 0;
    line-height: 16px;
    -webkit-line-clamp: 2;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-foot {
    display: flex;
    grid-area: foot;
    align-items: baseline;
    gap: 0 8px;
    min-width: 0;
    min-height: 14px;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    color: var(--muted);
    font-size: 0.625rem;
    line-height: 14px;
    white-space: nowrap;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-meta {
    display: flex;
    align-items: baseline;
    gap: 0 6px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-go {
    min-width: 0;
    max-width: 36%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-meta .clicks,
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-meta .when {
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] > .later-bid {
    position: absolute;
    top: 14px;
    right: 16px;
    color: var(--muted-foreground);
    font-size: 0.95rem;
    font-weight: 750;
    line-height: 20px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .studio.studio-open-occupied .lower-fold {
    margin: 24px 0 19px;
    gap: 25px;
  }
  .studio.studio-open-occupied .compact-ranking-item {
    min-height: 64px;
  }
  .studio.studio-open-occupied .later-rundown {
    margin-top: 12px;
  }
}

/* Occupied live: rolling last-7-days window stays below the real card flow. */
/* The occupied claim note stays in the document but out of the visual hero. */
.studio.studio-open-occupied .week-window[data-rolling-week] {
  margin: 0 2px;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0;
  text-transform: none;
}

@media (max-width: 760px) {
  .show-ticket {
    width: 306px;
  }
  .studio.studio-open-occupied .claim[data-claim-state="open-occupied"] {
    margin-top: 28px;
  }
  .studio.studio-open-occupied .claim[data-claim-state="open-occupied"] .claim-title {
    height: 42px;
    min-height: 42px;
    font-size: 24px;
    line-height: 42px;
  }
  .studio.studio-open-occupied .bid-form {
    margin-top: 16px;
  }
  /* Keep the occupied mobile 44px frames on the measured neutral border token. */
  .studio.studio-open-occupied .fields input,
  .studio.studio-open-occupied .identity-details > summary {
    border-color: #eeebe6;
  }
  .studio.studio-open-occupied .function-rail {
    gap: 5px;
  }
  .studio.studio-open-occupied .rundown {
    margin-top: 20px;
    gap: 6px;
  }
  .studio.studio-open-occupied .guest[data-paid-at] {
    height: 123px;
    min-height: 123px;
    padding: 12px;
  }
  .studio.studio-open-occupied .guest[data-rank="2"][data-paid-at] {
    /* Measured from the reference's muted second-card surface. */
    background-color: #fcf3ee;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] {
    grid-template-columns: 38px minmax(0, 1fr) max-content;
    grid-template-rows: minmax(0, 1fr);
    grid-template-areas: "cue person price";
    gap: 0 10px;
    align-items: stretch;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .cue {
    grid-area: cue;
    /* The 15px content inset plus the card's 14px border/padding places the
       real rank badge at the reference's roughly 29px outer offset. */
    align-self: start;
    margin-top: 15px;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .person {
    display: grid;
    grid-area: person;
    grid-template-rows: 19px 34px minmax(0, 1fr);
    align-content: start;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding-right: 0;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-name {
    font-size: 14px;
    font-weight: 700;
    line-height: 19px;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-name a[data-first-click="guest"] {
    text-decoration: underline;
    text-underline-offset: 0.14em;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-line {
    min-width: 0;
    max-width: 100%;
    max-height: 34px;
    margin: 0;
    line-height: 16px;
    -webkit-line-clamp: 2;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-footer {
    display: flex;
    align-items: center;
    gap: 0 6px;
    min-width: 0;
    min-height: 13px;
    overflow: hidden;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-site {
    flex: 1 1 auto;
    margin: 0;
    overflow: hidden;
    font-size: 10px;
    line-height: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .later-facts[data-later-facts] {
    display: flex;
    flex: 0 1 auto;
    flex-wrap: nowrap;
    align-items: baseline;
    gap: 0 6px;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 9px;
    line-height: 13px;
    white-space: nowrap;
  }
  .studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] > .lead-bid {
    position: static;
    grid-area: price;
    align-self: start;
    justify-self: end;
    margin: 0;
    color: var(--primary-strong);
    font-size: 14px;
    font-weight: 750;
    line-height: 19px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] {
    grid-template-columns: 38px minmax(0, 1fr) max-content;
    grid-template-rows: 19px 34px minmax(0, 1fr);
    grid-template-areas: "cue person price" "cue person price" "cue foot price";
    gap: 0 10px;
    align-items: start;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .cue {
    grid-area: cue;
    align-self: start;
    margin-top: 15px;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .person {
    display: grid;
    grid-area: person;
    grid-template-rows: 19px 34px;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding-right: 0;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .guest-name {
    min-width: 0;
    overflow: hidden;
    font-size: 14px;
    font-weight: 700;
    line-height: 19px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .guest-line {
    min-width: 0;
    max-width: 100%;
    max-height: 34px;
    margin: 0;
    overflow: hidden;
    font-size: 12px;
    line-height: 16px;
    -webkit-line-clamp: 2;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-foot {
    display: flex;
    grid-area: foot;
    align-items: baseline;
    min-width: 0;
    min-height: 14px;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    color: var(--muted-foreground);
    font-size: 9px;
    line-height: 13px;
    white-space: nowrap;
    align-self: center;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-meta {
    display: flex;
    align-items: baseline;
    gap: 0 6px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-go {
    min-width: 0;
    max-width: 36%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-meta .clicks,
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-meta .when {
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] > .later-bid {
    position: static;
    grid-area: price;
    align-self: start;
    justify-self: end;
    margin: 0;
    color: var(--muted-foreground);
    font-size: 14px;
    font-weight: 750;
    line-height: 19px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .studio.studio-open-occupied .lower-fold {
    gap: 24px;
    margin-top: 20px;
  }
  .studio.studio-open-occupied .later-rundown {
    margin-top: 20px;
  }
}
`;


export const OCCUPIED_IDENTITY_CSS = /* css */ `
/* The occupied board is the same production desk, with the paid lead kept
   visually dominant and the later seats arranged as a quieter ledger. */
.studio.studio-open-occupied .claim-console .claim {
  margin: 0 !important;
  padding: 28px 30px !important;
  border: 0 !important;
  border-radius: 25px !important;
  background: radial-gradient(circle at 90% 0%, var(--primary-softer), transparent 40%), var(--surface) !important;
}
.studio.studio-open-occupied .claim-console .claim-title {
  height: auto !important;
  min-height: 58px !important;
  min-width: 0 !important;
  line-height: 1.12 !important;
  justify-content: center !important;
  text-align: center !important;
}
.studio.studio-open-occupied .claim-console .claim-note,
.studio.studio-open-occupied .claim-console .form-hint {
  position: static !important;
  width: auto !important;
  height: auto !important;
  max-width: none !important;
  overflow: visible !important;
  clip: auto !important;
  opacity: 1 !important;
  text-align: left !important;
  white-space: normal !important;
}
.studio.studio-open-occupied .rundown-column .guest {
  grid-template-columns: 78px minmax(0, 1fr) 118px !important;
  grid-template-areas: "cue person tally" !important;
  height: auto !important;
  min-height: 132px !important;
  padding: 18px !important;
  border-width: 1px !important;
  border-radius: 18px !important;
}
.studio.studio-open-occupied .rundown-column .guest.booked {
  grid-template-areas: "cue person price" !important;
  min-height: 156px !important;
  border-width: 2px !important;
  background: linear-gradient(120deg, var(--primary-soft), var(--surface) 68%) !important;
}
.studio.studio-open-occupied .rundown-column .guest.later-seat {
  grid-template-rows: minmax(0, 1fr) auto !important;
  grid-template-areas: "cue person price" "cue foot price" !important;
  border-left-width: 4px !important;
  background: var(--primary-softer) !important;
}
.studio.studio-open-occupied .rundown-column .guest > .lead-bid,
.studio.studio-open-occupied .rundown-column .guest > .later-bid {
  position: static !important;
  grid-area: price !important;
  align-self: start !important;
  justify-self: end !important;
  margin: 0 !important;
  font-size: 18px !important;
  line-height: 24px !important;
}
.studio.studio-open-occupied .rundown-column .guest > .later-bid { color: var(--muted-foreground) !important; }
.studio.studio-open-occupied .rundown-column .tally {
  grid-area: tally !important;
  display: grid !important;
  align-content: start !important;
  justify-items: end !important;
  gap: 2px !important;
  text-align: right !important;
}
.studio.studio-open-occupied .rundown-column .tally .bid {
  position: static !important;
  color: var(--primary-strong) !important;
  font-size: 18px !important;
  line-height: 24px !important;
}
.studio.studio-open-occupied .rundown-column .person { padding-right: 0 !important; }
.studio.studio-open-occupied .rundown-column .guest-name { font-size: 17px !important; line-height: 22px !important; }
.studio.studio-open-occupied .rundown-column .guest-line { font-size: 13px !important; line-height: 19px !important; }
.studio.studio-open-occupied .rundown-column .later-foot {
  grid-area: foot !important;
  min-width: 0 !important;
  margin: 8px 0 0 !important;
}
.studio.studio-open-occupied .rundown-column [data-placement][hidden] { display: none !important; }
@media (max-width: 760px) {
  .studio.studio-open-occupied .claim-console .claim { padding: 21px 18px !important; border-radius: 20px !important; }
  .studio.studio-open-occupied .claim-console .claim-title {
    justify-content: center !important;
    min-height: 0 !important;
    font-size: 30px !important;
    line-height: 35px !important;
    text-align: center !important;
    white-space: normal !important;
  }
  .studio.studio-open-occupied .rundown-column .guest {
    grid-template-columns: 44px minmax(0, 1fr) max-content !important;
    min-height: 138px !important;
    padding: 14px !important;
    border-radius: 16px !important;
  }
  .studio.studio-open-occupied .rundown-column .guest.booked { grid-template-areas: "cue person price" !important; min-height: 154px !important; }
  .studio.studio-open-occupied .rundown-column .guest.later-seat {
    grid-template-rows: minmax(0, 1fr) auto !important;
    grid-template-areas: "cue person price" "cue foot price" !important;
  }
  .studio.studio-open-occupied .rundown-column .guest > .lead-bid,
  .studio.studio-open-occupied .rundown-column .guest > .later-bid,
  .studio.studio-open-occupied .rundown-column .tally .bid {
    font-size: 14px !important;
    line-height: 19px !important;
  }
  .studio.studio-open-occupied .rundown-column .guest-name { font-size: 14px !important; line-height: 19px !important; }
  .studio.studio-open-occupied .rundown-column .guest-line { font-size: 12px !important; line-height: 17px !important; }
  .studio.studio-open-occupied .rundown-column .later-foot { margin-top: 6px !important; font-size: 9px !important; line-height: 13px !important; }
}
`;

export const BOARD_CSS = `${STUDIO_CSS}
${OCCUPIED_CSS}
${OCCUPIED_IDENTITY_CSS}`;
