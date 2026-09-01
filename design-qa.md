# Design QA — dollar underline removal (2026-08-31)

## Evidence

- Source visual truth: `/var/folders/wr/2073jwr96_q68h23sfdqtvf00000gn/T/codex-clipboard-c7a079c8-3b1a-4024-ae1e-ae43d1ab390b.png`
- Single source-versus-render comparison: `/Users/yann/chat2/artifacts/design-qa/2026-08-31-dollar-underline/comparison-source-vs-ten-sites.png`
- Podcast seat desktop render: `/Users/yann/chat2/artifacts/design-qa/2026-08-31-dollar-underline/4216-desktop-full.png`
- Podcast seat mobile render: `/Users/yann/chat2/artifacts/design-qa/2026-08-31-dollar-underline/4216-mobile-full.png`
- Focused desktop amount crop: `/Users/yann/chat2/artifacts/design-qa/2026-08-31-dollar-underline/4216-desktop-amount.png`
- Focused mobile amount crop: `/Users/yann/chat2/artifacts/design-qa/2026-08-31-dollar-underline/4216-mobile-amount.png`

## Findings

- No actionable P0, P1, or P2 findings remain for this scoped correction.
- The dollar sign and numeric value render with `text-decoration-line: none`; the amount wrapper and input both have `border-bottom-style: none` and `border-bottom-width: 0px`.
- Existing typography, spacing, buttons, project skin, and Waffo payment behavior are unchanged.
- Existing keyboard focus selectors remain in place; only the persistent dashed amount decoration was removed.
- At `390 x 844`, the amount control remains inside the viewport with no horizontal overflow.
- Increase/decrease interaction passed: `$5 → $6 → $5`.
- Chrome console errors: `0`.

## Comparison History

1. Source defect — a dashed line appeared directly below the dollar amount.
2. Fix — removed the amount wrapper/input underline or dashed bottom border without changing form geometry.
3. Post-fix evidence — desktop and mobile crops show the amount cleanly, while controls stay aligned and interactive.

## Verification

- `npm test`: passed, 0 failed.
- `git diff --check`: passed.
- Chrome desktop computed-style check: passed.
- Chrome `390 x 844` responsive computed-style and containment check: passed.
- Chrome amount stepper interaction and console checks: passed.

## Follow-up Polish

- None required for this scoped correction.

final result: passed

## Prelaunch public-copy cleanup — 2026-08-31

- Chrome routes checked: home, About, and Rules at the normal desktop viewport and `390 x 844`.
- Public copy contains no clone, development, test-fixture, internal field-name, or payment-provider implementation language.
- Claim controls share one visual centerline; amount decoration is clean and the step buttons stay inside their boxes.
- Responsive result: no horizontal document overflow on any checked route.
- Regression result: `npm test` passed `130/130`; `git diff --check` passed.
- Payment behavior remains unchanged; customer-facing wording is provider-neutral while Waffo stays internal.

## Maker contact footer · 2026-09-01

- Source visual truth: `/var/folders/wr/2073jwr96_q68h23sfdqtvf00000gn/T/codex-clipboard-856d0520-4293-4865-a587-ff7cf0f23936.png` (`2400 x 1664`, browser chrome included).
- Browser-rendered implementation: `/Users/yann/chat2/artifacts/design-qa/2026-09-01-maker-footer/06-desktop.jpg` (`1200 x 689`) and `/Users/yann/chat2/artifacts/design-qa/2026-09-01-maker-footer/06-mobile.jpg` (`390 x 844`), normalized in the shared comparison sheets.
- State: podcast seat board, independent-board note visible, maker-email link keyboard-focused.
- Full-view evidence: the author contact follows the existing disclosure at the actual page bottom and adopts the quiet studio divider treatment.
- Focused evidence: one visible marker; exact copy/href; `2px` coral focus outline; `0px` horizontal overflow desktop/mobile.
- Required surfaces: studio typography, centered spacing, coral/neutral palette, and public copy remain legible and native; no image/icon asset was needed.
- Findings: P0 `0`, P1 `0`, P2 `0`; legal/badge elements in the source are intentionally out of the requested contact scope.
- Comparison history: pass 1 found no actionable P0/P1/P2 issue; no correction loop was required.
- Regression: `132/132` tests passed; Waffo/payment behavior remained unchanged.

final result: passed
