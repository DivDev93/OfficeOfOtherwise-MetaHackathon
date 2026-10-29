# Chronos skin visual verification

Captured on 2026-10-29 from the local replay-only server at 1920×1080 and 390×844. No live generation or purchase was used.

| State | Desktop | Mobile |
| --- | --- | --- |
| Invitation | [Home](home-1920.jpg) | [Home](home-390.jpg) |
| Alexandria scene | [Scene](scene-1920.jpg) | [Scene](scene-390.jpg) |
| SAM cutout | [Cutout](cutout-1920.jpg) | [Cutout](cutout-390.jpg) |
| 3D object | [Object](object-1920.jpg) | [Object](object-390.jpg) |
| Alternate selection | [Alternate](alternate-1920.jpg) | [Alternate](alternate-390.jpg) |
| Simulated guardrail | [Guardrail](guardrail-1920.jpg) | [Guardrail](guardrail-390.jpg) |
| Globe CDN fallback | [Fallback](globe-fallback-1920.jpg) | [Fallback](globe-fallback-390.jpg) |
| Reduced motion | [Reduced motion](reduced-motion-1920.jpg) | [Reduced motion](reduced-motion-390.jpg) |

The `beringia-*`, `green-sahara-*`, and `mechanisms-*` files cover all three artifact views at both sizes. Each run loaded its saved model without a model error. Viewport checks found no horizontal overflow. The `before-*` files show the previous public deployment.

Verified keyboard tabs, pin/card selection, truthful alternate-path labels, arrow-key orbit/zoom/reset, automatic orbit, return focus, and reduced-motion behavior. Blocking the globe.gl CDN still allowed the independent model viewer to load a saved GLB. Existing replay, policy, spend gates and provenance remain in place. The Node 22 suite passes 148 tests.

Production Chronos references and side-by-side comparisons are local-only under `docs/scouting/chronos-ref/` and its `comparisons/` directory, excluded from Git and release images. Home, history pins and Chronicle surfaces were inspected without signing in. The inspected production file required an account for 3D; its desktop access gate was captured, rather than starting generation or signing in. A genuine production 3D viewport comparison was therefore unavailable.

Intentional differences: the public app uses bundled NASA imagery and a NOAA elevation-derived bump, with no Esri tiles; its night sky is independently drawn in CSS. It has the event-built Meta workflow and an object viewer, rather than Chronos's account, billing, time-machine navigation and explorable-world feature set. No private Chronos code, data or assets were copied.

The dedicated fixed-desktop browser rehearsal took 160.07 s, including scripted narration holds, with a 44.99 s full-width cutout-to-orbit beat. See `docs/DEMO_SCRIPT.md` for timings and the remaining cutout limitation.
