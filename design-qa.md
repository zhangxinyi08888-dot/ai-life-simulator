# Design QA

- Source visual truth: `/Users/zz/.codex/generated_images/019f70ec-bc69-7fd2-b3d5-14d1b844a8f2/exec-a924198d-4179-43c1-9eb2-9b76c54e03e0.png`
- Implementation screenshot: `/Users/zz/Documents/new life/test---main-phase1/design-qa-implementation.png`
- Options-visible screenshot: `/Users/zz/Documents/new life/test---main-phase1/design-qa-options-visible.png`
- Full-view comparison: `/Users/zz/Documents/new life/test---main-phase1/design-qa-comparison.png`
- Focused bottom-bar comparison: `/Users/zz/Documents/new life/test---main-phase1/design-qa-bottom-comparison.png`
- Viewport: 390 × 844
- State: generated chapter committed; three choices ready; reader remains at the start of the chapter

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: existing serif chapter title and compact sans-serif status copy remain consistent with the product and reference hierarchy. Dynamic fixture copy wraps cleanly without clipping.
- Spacing and layout: the reading area remains dominant; choices are part of the article scroller and the fixed status bar is 65px in both generating and ready states.
- Colors and tokens: black, warm gray, muted gold borders, and gold status accents match the selected direction. Contrast remains readable without turning the status bar into a primary CTA.
- Image quality and asset fidelity: the target contains no raster product imagery. Icons use the existing Lucide family and match the page's stroke treatment.
- Copy and content: `3 个选择已准备好` and `查看选择` match the selected preview. Custom-choice mode updates the same bar instead of leaving stale choice-ready copy.
- Responsiveness and accessibility: 390px mobile width has no horizontal overflow, controls remain keyboard-focusable, the dock action is a semantic button, and reduced-motion behavior remains covered by the existing stylesheet.

## Interaction Verification

- Clicking `查看选择` smoothly scrolls the article to the inline decision area.
- When the decision area enters the readable viewport, the ready dock fades out, becomes `aria-hidden`, and stops receiving pointer events.
- When the decision area is outside the readable viewport, the ready dock fades back in and remains actionable.
- The visibility calculation is animation-frame throttled and rechecks after content or viewport resizing.
- If the ready-dock button owns keyboard focus when it hides, focus moves to the inline decision area without another scroll jump.
- Reduced-motion preference switches scrolling to `auto` and removes the dock fade duration.
- Choosing a preset option enters progressive generation without expanding the bottom dock.
- Generating dock height: 65px.
- Ready dock height: 65px.
- Scrollable reading viewport before and after completion: 622.5px in the verified route.
- Preset → custom choice → preset transition works; the input becomes visible after the existing motion transition.
- Browser console errors checked: none.

## Comparison History

1. Initial implementation: generating dock measured 61px while the ready dock measured 65px. This was a P2 layout-stability mismatch because completion could move the reading boundary by 4px.
2. Fix: added a shared 65px minimum height and centered content in the generation dock.
3. Post-fix evidence: both generating and ready states measure 65px, while the reading viewport remains 622.5px across the transition.
4. Polish: custom-choice mode now changes the inline heading and fixed-bar copy so the persistent status remains truthful.

## Open Questions

- The source preview uses a longer narrative, so its inline choices remain below the fold. The deterministic browser fixture is shorter and naturally reveals the first choices in the same viewport. This is expected content-driven behavior, not layout drift.

## Implementation Checklist

- [x] Move preset, custom, ending, and report interactions into the article scroller.
- [x] Keep one compact fixed-height status/action bar.
- [x] Preserve progressive-generation and error controls.
- [x] Verify smooth navigation to the inline choices.
- [x] Verify preset and custom choice interactions.
- [x] Run typecheck, production build, component regression, and browser console checks.

## Follow-up Polish

- No blocking follow-up.

final result: passed
