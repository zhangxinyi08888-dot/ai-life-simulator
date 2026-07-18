# Design QA

## Wealth header option 1

### Evidence

- Source visual truth: `/Users/zz/.codex/generated_images/019f7608-e1e4-7300-9595-610f9dae03c3/exec-d9e46bd3-f38f-416e-ba57-d1bcea4d4ffa.png`
- Browser-rendered implementation screenshot: `artifacts/ui-design-qa/wealth-header-option-1-390x844.png`
- Full-view comparison: `artifacts/ui-design-qa/wealth-header-option-1-side-by-side.png`
- Focused header comparison: `artifacts/ui-design-qa/wealth-header-option-1-header-compare.png`
- Viewport: 390 × 844 CSS pixels
- State: simulation node at age 28 years 8 months; attributes 58/50/62/56/50; real net worth 142万; estimated; period change +32万.

### Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: all five primary values use the same 12px semibold tabular treatment and share the same measured value row (`y=88.5`, `height=18`). Wealth keeps `142万` as the primary value; `+32万` is a deliberately subordinate 7px inline value.
- Spacing and layout rhythm: every card measures 68 × 80px. All five progress tracks share `y=132`, all five value rows share the same baseline, and the 390px viewport has no horizontal overflow (`scrollWidth=390`).
- Colors and visual tokens: the existing near-black surfaces, warm-gray borders, ivory/gold primary values, muted estimate badge, green positive change, and red negative-change mapping are preserved.
- Image quality and asset fidelity: the header is interface-led and adds no raster imagery. Existing Lucide icons are retained; no placeholder, custom SVG, CSS drawing, or approximate asset was introduced.
- Copy and content: the visible wealth label is `财富`; the real amount is `142万`; the estimate badge is `估`; and the period change is `+32万`. The card title retains the complete accessible explanation, including the hidden wealth resource score.
- Interaction and accessibility: the estimate badge exposes `估算值`; the wealth card title describes the real amount, estimate state, period change, and resource score. The biography button still opens and closes correctly.

### Interaction verification

- The selected mock and browser implementation were normalized to the same 390px width and placed side by side for full-view and focused-header inspection.
- The implementation preserves the selected option's two compact wealth rows: `财富 + 估` and `142万 +32万`.
- Opened `生平纪事 1`, verified its existing timeline content, and closed the sheet with its visible close action.
- Confirmed no horizontal overflow at 390 × 844.
- Application console errors: none.
- TypeScript check and production build: passed. Vite reports only the existing bundle-size advisory.

## Progressive generation

### Evidence

- Source visual truth: `/Users/zz/.codex/generated_images/019f70ec-bc69-7fd2-b3d5-14d1b844a8f2/exec-a924198d-4179-43c1-9eb2-9b76c54e03e0.png`
- Implementation screenshot: `/Users/zz/Documents/new life/test---main-phase1/design-qa-implementation.png`
- Options-visible screenshot: `/Users/zz/Documents/new life/test---main-phase1/design-qa-options-visible.png`
- Full-view comparison: `/Users/zz/Documents/new life/test---main-phase1/design-qa-comparison.png`
- Focused bottom-bar comparison: `/Users/zz/Documents/new life/test---main-phase1/design-qa-bottom-comparison.png`
- Viewport: 390 × 844
- State: generated chapter committed; three choices ready; reader remains at the start of the chapter.

### Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: existing serif chapter title and compact sans-serif status copy remain consistent with the product and reference hierarchy. Dynamic fixture copy wraps cleanly without clipping.
- Spacing and layout: the reading area remains dominant; choices are part of the article scroller and the fixed status bar is 65px in both generating and ready states.
- Colors and tokens: black, warm gray, muted gold borders, and gold status accents match the selected direction. Contrast remains readable without turning the status bar into a primary CTA.
- Image quality and asset fidelity: the target contains no raster product imagery. Icons use the existing Lucide family and match the page's stroke treatment.
- Copy and content: `3 个选择已准备好` and `查看选择` match the selected preview. Custom-choice mode updates the same bar instead of leaving stale choice-ready copy.
- Responsiveness and accessibility: 390px mobile width has no horizontal overflow, controls remain keyboard-focusable, the dock action is a semantic button, and reduced-motion behavior remains covered by the existing stylesheet.

### Interaction verification

- Clicking `查看选择` smoothly scrolls the article to the inline decision area.
- When the decision area enters the readable viewport, the ready dock fades out, becomes `aria-hidden`, and stops receiving pointer events.
- When the decision area is outside the readable viewport, the ready dock fades back in and remains actionable.
- The visibility calculation is animation-frame throttled and rechecks after content or viewport resizing.
- If the ready-dock button owns keyboard focus when it hides, focus moves to the inline decision area without another scroll jump.
- Reduced-motion preference switches scrolling to `auto` and removes the dock fade duration.
- Choosing a preset option enters progressive generation without expanding the bottom dock.
- Generating and ready dock height: 65px.
- Scrollable reading viewport before and after completion: 622.5px in the verified route.
- Preset → custom choice → preset transition works; the input becomes visible after the existing motion transition.
- Browser console errors checked: none.

### Implementation checklist

- [x] Move preset, custom, ending, and report interactions into the article scroller.
- [x] Keep one compact fixed-height status/action bar.
- [x] Preserve progressive-generation and error controls.
- [x] Verify smooth navigation to the inline choices.
- [x] Verify preset and custom choice interactions.
- [x] Run typecheck, production build, component regression, and browser console checks.

The source preview uses a longer narrative, so its inline choices remain below the fold. The deterministic browser fixture is shorter and naturally reveals the first choices in the same viewport. This is expected content-driven behavior, not layout drift.

Final result: passed.
