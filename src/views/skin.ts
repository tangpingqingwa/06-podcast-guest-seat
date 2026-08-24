export const STUDIO_CSS = /* css */ `
:root {
  --ink: #1a1610;
  --paper: #efe4c4;
  --paper-2: #e7d7ae;
  --studio: #16120e;
  --studio-2: #221c16;
  --lamp: #e8c27a;
  --on-air: #c23b22;
  --muted: #8a7d68;
  --line: #3a3228;
  --dash: #b79a62;
  --sans: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
html { height: 100%; }
body {
  min-height: 100%;
  font-family: var(--sans);
  background:
    radial-gradient(900px 420px at 50% -80px, rgb(232 194 122 / 0.16), transparent 60%),
    linear-gradient(180deg, #1c1712 0%, var(--studio) 40%, #100d0a 100%);
  color: #f3ead8;
  line-height: 1.5;
}
a { color: inherit; text-decoration: none; }
button, input { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled, input:disabled { cursor: not-allowed; opacity: 0.55; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
.site-header, main, footer {
  width: 100%; max-width: 46rem; margin: 0 auto; padding: 1rem 1.15rem;
}
.site-header {
  display: flex; justify-content: space-between; align-items: center; gap: 1rem;
}
.brand {
  display: inline-flex; align-items: center; gap: 0.55rem;
  font-weight: 650; letter-spacing: -0.03em;
}
.on-air {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.15rem 0.45rem;
  border: 1px solid var(--on-air);
  border-radius: 999px;
  color: #ffd7cf;
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.12em;
}
.on-air::before {
  content: ""; width: 0.45rem; height: 0.45rem; border-radius: 999px;
  background: var(--on-air); box-shadow: 0 0 0.45rem var(--on-air);
}
nav[aria-label="Main"] { display: flex; gap: 0.95rem; font-size: 0.875rem; }
nav[aria-label="Main"] a { color: var(--muted); font-weight: 500; }
nav[aria-label="Main"] a[aria-current="page"],
nav[aria-label="Main"] a:hover { color: #f3ead8; }
.studio { display: grid; gap: 1.15rem; }
.show-ticket {
  display: grid;
  grid-template-columns: 1fr 7.2rem;
  background:
    radial-gradient(circle at 0 50%, var(--studio) 0 0.42rem, transparent 0.44rem),
    radial-gradient(circle at 100% 50%, var(--studio) 0 0.42rem, transparent 0.44rem),
    repeating-linear-gradient(90deg, transparent, transparent 11px, rgb(26 22 16 / 0.06) 12px),
    var(--paper);
  color: var(--ink);
  border-radius: 0.35rem;
  overflow: hidden;
  box-shadow: 0 18px 40px rgb(0 0 0 / 0.28);
}
.ticket-main { padding: 0.95rem 1.05rem 1rem; }
.ticket-kicker {
  margin: 0;
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #6b5740;
}
.ticket-label {
  margin: 0.2rem 0 0;
  font-size: clamp(1.7rem, 4vw, 2.25rem);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1.05;
}
.ticket-seat, .ticket-veto { margin: 0.25rem 0 0; font-size: 0.92rem; }
.ticket-seat { font-weight: 650; }
.ticket-stub {
  display: flex; flex-direction: column; justify-content: space-between;
  padding: 0.85rem 0.55rem;
  border-left: 1px dashed #8a734c;
  text-align: center;
  background: var(--paper-2);
  font-family: var(--mono);
}
.stub-state {
  margin: 0;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  align-self: center;
}
.stub-admit {
  margin: 0;
  font-size: 0.62rem;
  letter-spacing: 0.14em;
}
.claim {
  padding: 0.2rem 0 0.4rem;
}
.claim[data-next-seat] {
  padding: 1rem 0.9rem 1.1rem;
  border: 1px solid var(--lamp);
  background: #241811;
  box-shadow: inset 3px 0 0 var(--on-air);
}
.claim[data-next-seat] .claim-title { justify-content: flex-start; text-align: left; }
.claim[data-next-seat] .claim-note,
.claim[data-next-seat] .form-hint { margin-left: 0; text-align: left; }
.claim[data-next-seat] .outbid { justify-self: start; }
.claim[data-claim-locked] {
  padding: 0.35rem 0 0.55rem;
}
.claim[data-claim-locked] .claim-title {
  justify-content: flex-start;
  text-align: left;
}
.claim[data-claim-locked] .claim-note,
.claim[data-claim-locked] .form-hint {
  margin-left: 0;
  text-align: left;
}
.claim[data-lock-certain] {
  margin-top: 0;
}
.claim[data-lock-certain] .claim-title {
  letter-spacing: -0.04em;
}
.claim[data-lock-409] {
  margin-top: 0;
}
.claim[data-lock-409] .claim-title {
  letter-spacing: -0.04em;
}
.doc[data-lock-409] .empty {
  letter-spacing: -0.02em;
}
.claim[data-empty-honest] {
  margin-top: 0;
}
.claim[data-empty-honest] .claim-title {
  letter-spacing: -0.03em;
}
/* Empty open: guest site is a later write after Claim #1 / Outbid. */
.studio.studio-open-empty[data-empty-honest] .claim.empty-claim-first[data-empty-claim-first] .listing-identity[data-later-write] {
  display: grid;
  gap: 0.55rem;
  width: 100%;
  margin: 0.85rem 0 0;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--line);
}
.studio.studio-open-empty[data-empty-honest] .claim.empty-claim-first[data-empty-claim-first] .later-write-label {
  margin: 0;
  text-align: center;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}
.studio.studio-open-empty[data-empty-honest] .claim.empty-claim-first[data-empty-claim-first] .listing-identity[data-later-write] .fields input {
  height: 2.2rem;
  font-size: 0.88rem;
  color: var(--muted);
}
.studio.studio-open-empty[data-empty-honest] .claim.empty-claim-first[data-empty-claim-first]:not([data-next-seat]) .outbid {
  justify-self: center;
}
.empty[data-empty-honest] .empty-lead {
  letter-spacing: -0.03em;
}
.studio.studio-open-empty[data-empty-honest] [data-guest-prize],
.studio.studio-open-empty[data-empty-honest] [data-first-click="guest"],
.studio.studio-open-empty[data-empty-honest] [data-later-seat],
.studio.studio-open-empty[data-empty-honest] [data-later-go],
.studio.studio-open-empty[data-empty-honest] [data-later-foot],
.studio.studio-open-empty[data-empty-honest] [data-later-facts],
.studio.studio-open-empty[data-empty-honest] [data-later-fact],
.studio.studio-open-empty[data-empty-honest] [data-paid-at],
.studio.studio-open-empty[data-empty-honest] [data-claim-locked],
.studio.studio-open-empty[data-empty-honest] [data-lock-certain],
.studio.studio-open-empty[data-empty-honest] [data-lock-409],
.studio.studio-open-empty[data-empty-honest] [data-lock-after-open],
.studio.studio-open-empty[data-empty-honest] [data-host-lock],
.studio.studio-open-empty[data-empty-honest] [data-host-open],
.studio.studio-open-empty[data-empty-honest] .rundown,
.studio.studio-open-empty[data-empty-honest] .guest,
.studio.studio-open-empty [data-guest-prize],
.studio.studio-open-empty [data-first-click="guest"],
.studio.studio-open-empty [data-later-seat],
.studio.studio-open-empty [data-later-go],
.studio.studio-open-empty [data-later-foot],
.studio.studio-open-empty [data-later-facts],
.studio.studio-open-empty [data-later-fact],
.studio.studio-open-empty [data-paid-at],
.studio.studio-open-empty .later-fact,
.studio.studio-open-empty .later-facts,
.studio.studio-open-empty .guest.later-seat,
.studio.studio-open-empty .later-name,
.studio.studio-open-empty .later-go,
.studio.studio-open-empty .later-foot,
.studio.studio-open-empty .rundown,
.studio.studio-open-empty .guest {
  display: none;
}
.studio.studio-open-occupied .empty.open-seat,
.studio.studio-locked .empty.open-seat,
.studio.studio-waiting .empty.open-seat {
  display: none;
}
.studio.studio-open-empty[data-empty-honest] .empty.open-seat[data-empty-honest],
.studio.studio-open-empty .empty.open-seat[data-empty-honest] {
  display: grid;
}
.claim[data-lock-after-open] {
  padding: 1rem 0.9rem 1.1rem;
  border: 1px solid var(--lamp);
  background: #241811;
  box-shadow: inset 3px 0 0 var(--on-air);
}
.claim[data-lock-after-open] .claim-title {
  justify-content: flex-start;
  text-align: left;
}
.claim[data-lock-after-open] .claim-note,
.claim[data-lock-after-open] .form-hint {
  margin-left: 0;
  text-align: left;
}
.claim.lock-after-open-first {
  padding: 1.55rem 1.15rem 1.45rem;
  border-width: 3px;
}
.claim.lock-after-open-first .claim-title {
  font-size: clamp(1.85rem, 5vw, 2.45rem);
}
.claim.lock-after-open-two {
  padding: 1.9rem 1.25rem 1.8rem;
  border-width: 4px;
}
.claim.lock-after-open-two .claim-title {
  font-size: clamp(2.1rem, 5.6vw, 2.75rem);
}
.claim.lock-after-open-three {
  padding: 2.3rem 1.4rem 2.2rem;
  border-width: 6px;
}
.claim.lock-after-open-three .claim-title {
  font-size: clamp(2.35rem, 6.2vw, 3.05rem);
}
.claim.lock-after-open-four {
  padding: 2.8rem 1.6rem 2.7rem;
  border-width: 8px;
}
.claim.lock-after-open-four .claim-title {
  font-size: clamp(2.65rem, 6.8vw, 3.4rem);
}
.claim.lock-after-open-five {
  padding: 3.4rem 1.85rem 3.3rem;
  border-width: 10px;
}
.claim.lock-after-open-five .claim-title {
  font-size: clamp(2.95rem, 7.4vw, 3.75rem);
}
.claim-title {
  display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 0.5rem;
  margin: 0;
  text-align: center;
  font-size: clamp(1.55rem, 4.4vw, 2.15rem);
  letter-spacing: -0.03em;
  line-height: 1.15;
}
.bid-stepper { display: inline-flex; align-items: center; gap: 0.4rem; }
.step {
  width: 1.55rem; height: 1.55rem; border: 0; border-radius: 999px;
  background: rgb(232 194 122 / 0.16); color: var(--lamp); font-weight: 700;
}
.bid-field {
  color: var(--lamp);
  text-decoration: underline dashed;
  text-underline-offset: 0.28em;
  text-decoration-color: var(--dash);
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}
.bid-field input {
  width: 5.5ch; border: 0; background: transparent; color: inherit; font: inherit; outline: none;
}
.claim-note {
  margin: 0.55rem auto 0; max-width: 32rem; text-align: center;
  color: var(--muted); font-size: 0.92rem;
}
.bid-form { margin-top: 0.95rem; display: grid; gap: 0.55rem; }
.fields { display: grid; gap: 0.5rem; }
@media (min-width: 720px) {
  .fields { grid-template-columns: 1fr 1fr; }
  .fields .span-2 { grid-column: 1 / -1; }
}
.fields input {
  width: 100%; height: 2.7rem;
  border: 1px solid var(--line);
  border-radius: 0.35rem;
  background: var(--studio-2);
  padding: 0 0.8rem;
}
.outbid {
  justify-self: center; height: 2.7rem; border: 0; border-radius: 999px;
  background: var(--lamp); color: var(--ink); font-weight: 700; padding: 0 1.35rem;
}
.form-hint { margin: 0; text-align: center; color: var(--muted); font-size: 0.75rem; }
.rundown { display: grid; gap: 0.65rem; }
.rundown-head {
  display: flex; justify-content: space-between; align-items: baseline;
  font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--muted);
}
.guest {
  display: grid;
  grid-template-columns: 3.4rem 1fr auto;
  gap: 0.75rem;
  align-items: start;
  padding: 0.85rem 0.9rem;
  background: #1d1813;
  border: 1px solid var(--line);
  border-left: 3px solid var(--lamp);
}
.guest.booked { border-left-color: var(--on-air); background: #241811; }
.guest.vetoed {
  border-left-color: #6b5740;
  opacity: 0.92;
}
.cue {
  display: grid; justify-items: center; gap: 0.15rem;
  font-family: var(--mono); text-align: center;
}
.cue-num { font-weight: 700; font-size: 1.05rem; color: var(--lamp); }
.guest.vetoed .cue-num { color: var(--muted); }
.cue-kind { font-size: 0.62rem; letter-spacing: 0.12em; color: var(--muted); }
.person { min-width: 0; }
.guest-name {
  margin: 0; font-size: 1.12rem; font-weight: 700; letter-spacing: -0.02em;
}
.guest-name a:hover { text-decoration: underline; }
.guest-line { margin: 0.2rem 0 0; color: #d9ccb4; }
.guest-site { margin: 0.3rem 0 0; font-family: var(--mono); font-size: 0.82rem; color: var(--lamp); }
.guest-site a { text-decoration: underline dashed; text-underline-offset: 0.18em; }
.guest-veto { margin: 0.35rem 0 0; color: #e7b1a6; font-size: 0.88rem; }
.tally { text-align: right; font-family: var(--mono); }
.bid { margin: 0; color: var(--lamp); font-weight: 700; font-size: 1.05rem; }
.clicks, .when { margin: 0.2rem 0 0; color: var(--muted); font-size: 0.78rem; }
.empty {
  margin: 0; padding: 1.15rem 1rem; text-align: center; color: var(--muted);
  border: 1px dashed var(--line); background: rgb(0 0 0 / 0.15);
}
.empty.waiting,
.empty.open-seat { display: grid; gap: 0.35rem; justify-items: center; }
.empty-kicker {
  margin: 0;
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.empty-lead {
  margin: 0;
  color: #f3ead8;
  font-size: 1.12rem;
  font-weight: 650;
  letter-spacing: -0.02em;
}
.empty.waiting p,
.empty.open-seat p { margin: 0; max-width: 28rem; }
.empty-path a { color: var(--lamp); text-decoration: underline; }
.host-open {
  display: grid; gap: 0.4rem; justify-items: center;
  margin: 0; padding: 1.15rem 1rem; text-align: center;
  border: 1px dashed var(--dash); background: rgb(0 0 0 / 0.15);
}
.host-open .empty-kicker, .host-open .empty-lead { margin: 0; }
.host-open-note { margin: 0; max-width: 28rem; color: var(--muted); font-size: 0.92rem; }
.host-open-form {
  margin-top: 0.45rem; display: grid; gap: 0.5rem; width: min(100%, 22rem);
}
.host-open-form input {
  width: 100%; height: 2.7rem;
  border: 1px solid var(--line);
  border-radius: 0.35rem;
  background: var(--studio-2);
  padding: 0 0.8rem;
}
.host-open-form .open-next {
  justify-self: stretch;
  height: 2.7rem;
  border: 1px solid var(--on-air);
  border-radius: 0.35rem;
  background: var(--on-air);
  color: #ffd7cf;
  font-family: var(--mono);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.host-open-form .lock-episode {
  justify-self: stretch;
  height: 2.7rem;
  border: 1px solid var(--on-air);
  border-radius: 0.35rem;
  background: var(--on-air);
  color: #ffd7cf;
  font-family: var(--mono);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.host-lock {
  justify-items: stretch;
  text-align: left;
  border-style: solid;
  border-color: var(--lamp);
  background: #241811;
  box-shadow: inset 3px 0 0 var(--on-air);
}
.host-lock .empty-kicker,
.host-lock .empty-lead,
.host-lock .host-open-note { justify-self: start; }
.host-lock .empty-lead { color: #f3ead8; }
.host-open[data-open-next] {
  justify-items: stretch;
  text-align: left;
  border-style: solid;
  border-color: var(--lamp);
  background: #241811;
  box-shadow: inset 3px 0 0 var(--on-air);
}
.host-open[data-open-next] .empty-kicker,
.host-open[data-open-next] .empty-lead,
.host-open[data-open-next] .host-open-note { justify-self: start; }
.host-open[data-open-next] .empty-lead { color: #f3ead8; }
.host-open.open-after-lock-first {
  padding: 1.35rem 1.05rem 1.25rem;
  border-width: 2px;
}
.host-open.open-after-lock-first .empty-lead {
  font-size: 1.28rem;
}
.host-open.open-after-lock-first .open-next {
  min-height: 3rem;
  font-size: 1.05rem;
}
.host-open.open-after-lock-two {
  padding: 1.65rem 1.15rem 1.55rem;
  border-width: 3px;
}
.host-open.open-after-lock-two .empty-lead {
  font-size: 1.42rem;
}
.host-open.open-after-lock-two .open-next {
  min-height: 3.35rem;
  font-size: 1.15rem;
}
.host-open.open-after-lock-three {
  padding: 2.05rem 1.35rem 1.95rem;
  border-width: 5px;
}
.host-open.open-after-lock-three .empty-lead {
  font-size: 1.58rem;
}
.host-open.open-after-lock-three .open-next {
  min-height: 3.7rem;
  font-size: 1.25rem;
}
.host-open.open-after-lock-four {
  padding: 2.55rem 1.55rem 2.45rem;
  border-width: 7px;
}
.host-open.open-after-lock-four .empty-lead {
  font-size: 1.78rem;
}
.host-open.open-after-lock-four .open-next {
  min-height: 4.1rem;
  font-size: 1.38rem;
}
.host-open.open-after-lock-five {
  padding: 3.15rem 1.8rem 3.05rem;
  border-width: 9px;
}
.host-open.open-after-lock-five .empty-lead {
  font-size: 2rem;
}
.host-open.open-after-lock-five .open-next {
  min-height: 4.55rem;
  font-size: 1.52rem;
}
footer { color: var(--muted); font-size: 0.85rem; }
.doc { color: #d9ccb4; }
.doc h1, .doc h2 { color: #f3ead8; letter-spacing: -0.03em; }
.doc a { color: var(--lamp); text-decoration: underline; }
.doc table { width: 100%; border-collapse: collapse; }
.doc th, .doc td {
  text-align: left; vertical-align: top; padding: 0.55rem 0.35rem;
  border-bottom: 1px solid var(--line);
}
.doc th { color: var(--muted); font-family: var(--mono); font-size: 0.78rem; font-weight: 500; }
`;

/* Occupied live only: Polar-paid #1 guest is the first click; later seats stay quieter.
   Host Lock is a later write after the rundown. Empty open / unpaid checkout must not inherit this. */
export const OCCUPIED_CSS = /* css */ `
.studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] {
  grid-template-columns: 3.4rem 1fr;
  grid-template-areas:
    "cue person";
  gap: 0.75rem 0.9rem;
}
.studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .cue { grid-area: cue; }
.studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .person { grid-area: person; }
.studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-name {
  font-size: clamp(1.5rem, 3.8vw, 1.95rem);
  letter-spacing: -0.03em;
  line-height: 1.05;
}
.studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-name a[data-first-click="guest"] {
  text-decoration: underline;
  text-underline-offset: 0.14em;
}
.studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .guest-site {
  margin-top: 0.35rem;
  font-size: 0.82rem;
  color: var(--lamp);
}
.studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .later-facts[data-later-facts] {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.45rem 0.85rem;
  margin: 0.55rem 0 0;
  font-family: var(--mono);
}
.studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] {
  grid-template-columns: 2.4rem 1fr;
  grid-template-areas:
    "cue person"
    "foot foot";
  gap: 0.35rem 0.65rem;
  padding: 0.55rem 0.75rem;
  border-left-width: 2px;
  border-left-color: var(--line);
  background: #1a1612;
}
.studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .cue { grid-area: cue; }
.studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .person { grid-area: person; }
.studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-foot[data-later-foot] {
  grid-area: foot;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.55rem 0.85rem;
  margin: 0.15rem 0 0;
  padding: 0;
  border: 0;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.72rem;
}
.studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .cue-num {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--muted);
}
.studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .guest-name.later-name {
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0;
  color: #d9ccb4;
}
.studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-foot[data-later-foot] a.later-go[data-later-go],
.studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-foot[data-later-foot] .bid,
.studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-foot[data-later-foot] .clicks,
.studio.studio-open-occupied .guest.later-seat[data-later-seat][data-paid-at] .later-foot[data-later-foot] .when {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--muted);
}
.studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .later-facts[data-later-facts] .bid { font-size: 0.88rem; font-weight: 600; }
.studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .later-facts[data-later-facts] .bid.later-fact[data-later-fact] {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 500;
}
.studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .later-facts[data-later-facts] .clicks,
.studio.studio-open-occupied .guest[data-guest-prize][data-paid-at] .later-facts[data-later-facts] .when {
  font-size: 0.72rem;
  color: var(--muted);
}
`;

export const BOARD_CSS = `${STUDIO_CSS}
${OCCUPIED_CSS}`;
