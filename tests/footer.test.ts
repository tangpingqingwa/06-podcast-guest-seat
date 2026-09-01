import assert from "node:assert/strict";
import { test } from "node:test";
import {
  renderAboutHtml,
  renderBoardHtml,
  renderCheckoutErrorHtml,
  renderCheckoutStatusHtml,
  renderEpisodeHistoryEmptyHtml,
  renderHostLockErrorHtml,
  renderHostOpenErrorHtml,
  renderMakerFooter,
  renderRulesHtml,
} from "../src/http/routes/pages.js";
import { STUDIO_CSS } from "../src/views/skin.js";

const FOOTER_MARKER = 'data-maker-contact=""';
const CONTACT_HREF = 'href="mailto:tangpingqingwa@gmail.com"';

test("all public layouts include one exact maker contact footer", () => {
  const pages = [
    renderBoardHtml(undefined, [], new Date("2026-08-27T12:00:00.000Z")),
    renderEpisodeHistoryEmptyHtml(),
    renderAboutHtml(),
    renderRulesHtml(),
    renderCheckoutErrorHtml("invalid_checkout"),
    renderCheckoutStatusHtml({ intentId: "intent_footer", status: "open" }),
    renderHostOpenErrorHtml("unauthorized"),
    renderHostLockErrorHtml("unauthorized"),
  ];

  for (const page of pages) {
    assert.equal((page.match(new RegExp(FOOTER_MARKER, "g")) ?? []).length, 1);
    assert.equal((page.match(new RegExp(CONTACT_HREF, "g")) ?? []).length, 1);
    assert.match(
      page,
      /<footer class="maker-footer" data-maker-contact="">\s*<p>Built by <a href="mailto:tangpingqingwa@gmail\.com">tangpingqingwa@gmail\.com<\/a><\/p>/,
    );
  }
});

test("maker contact helper and studio skin keep the credit quiet and keyboard-visible", () => {
  assert.match(renderMakerFooter(), /Built by <a href="mailto:tangpingqingwa@gmail\.com">tangpingqingwa@gmail\.com<\/a>/);
  assert.match(STUDIO_CSS, /\.maker-footer\s*\{/);
  assert.match(STUDIO_CSS, /\.maker-footer a:hover\s*\{/);
  assert.match(STUDIO_CSS, /\.maker-footer a:focus-visible\s*\{/);
  assert.match(STUDIO_CSS, /overflow-wrap:\s*anywhere/);
  assert.match(STUDIO_CSS, /@media \(max-width: 760px\)[\s\S]*\.maker-footer\s*\{/);
});
