# Design QA — Wealth header option 1

## Evidence

- Source visual truth: `/Users/zz/.codex/generated_images/019f7608-e1e4-7300-9595-610f9dae03c3/exec-d9e46bd3-f38f-416e-ba57-d1bcea4d4ffa.png`
- Browser-rendered implementation screenshot: `artifacts/ui-design-qa/wealth-header-option-1-390x844.png`
- Full-view comparison: `artifacts/ui-design-qa/wealth-header-option-1-side-by-side.png`
- Focused header comparison: `artifacts/ui-design-qa/wealth-header-option-1-header-compare.png`
- Viewport: 390 × 844 CSS pixels
- State: simulation node at age 28 years 8 months; attributes 58/50/62/56/50; real net worth 142万; estimated; period change +32万.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: all five primary values use the same 12px semibold tabular treatment and share the same measured value row (`y=88.5`, `height=18`). Wealth keeps `142万` as the primary value; `+32万` is a deliberately subordinate 7px inline value.
- Spacing and layout rhythm: every card measures 68 × 80px. All five progress tracks share `y=132`, all five value rows share the same baseline, and the 390px viewport has no horizontal overflow (`scrollWidth=390`).
- Colors and visual tokens: the existing near-black surfaces, warm-gray borders, ivory/gold primary values, muted estimate badge, green positive change, and red negative-change mapping are preserved.
- Image quality and asset fidelity: the header is interface-led and adds no raster imagery. Existing Lucide icons are retained; no placeholder, custom SVG, CSS drawing, or approximate asset was introduced.
- Copy and content: the visible wealth label is `财富`; the real amount is `142万`; the estimate badge is `估`; and the period change is `+32万`. The card title retains the complete accessible explanation, including the hidden wealth resource score.
- Interaction and accessibility: the estimate badge exposes `估算值`; the wealth card title describes the real amount, estimate state, period change, and resource score. The biography button still opens and closes correctly.

## Comparison history

### Final comparison

- The selected mock and browser implementation were normalized to the same 390px width and placed side by side for full-view and focused-header inspection.
- The implementation preserves the selected option's two compact wealth rows: `财富 + 估` and `142万 +32万`.
- The implementation intentionally keeps the production screen's existing header scale while matching the selected hierarchy and alignment. No P0/P1/P2 correction loop was required.

## Primary interactions tested

- Opened `生平纪事 1` from the redesigned header.
- Verified the biography sheet rendered its existing timeline content.
- Closed the biography sheet with its visible close action.
- Confirmed no horizontal overflow at 390 × 844.

## Console and build checks

- Application console errors: none.
- TypeScript check: passed.
- Production build: passed. Vite reports only the existing bundle-size advisory.
- `git diff --check`: passed.

## Follow-up polish

- None required for the selected scope.

final result: passed
