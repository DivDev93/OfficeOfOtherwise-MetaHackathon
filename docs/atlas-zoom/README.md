# Atlas zoom implementation record

This page records the local Atlas implementation and the evidence captured on 2026-10-31. The work uses saved public replay data; it made no live Meta calls and does not require hosted app access.

## Phase status

- **P0 — Data model and migration:** implemented in `web/atlas/worldModel.js` and `scripts/migrate-atlas-worlds.js`. The migration preserves stable world and question IDs, normalizes authored attachments, and derives legacy theme, boldness, and divergence-year values deterministically.
- **P1 — Surface, lift, and orbit:** implemented in the single Atlas scene. The initial Sundaland → Kuching path is recorded in [`p1-sundaland-kuching.webm`](p1-sundaland-kuching.webm) (9.40 seconds). Default zoom scrubs the spatial Lift continuously. The separate direct-cut travel mode fades through its midpoint instead of compositing two complete scenes.
- **P2 — Atlas timeline:** implemented with a logarithmic history axis, axis modes, levels of detail, and folded dense nodes. Captures cover all four levels. Dense Atlas labels are intentionally thinned; the complete exploration tree remains available for navigation. The captures do not establish perfect label spacing at every graph size.
- **P3 — New-question attachment and travel:** present-day and current-world attachment metadata, travel modes, and ghost trail controls are implemented. The Atlas options capture is included below. Integration and final interaction review remain distinct from the static captures.
- **P4 — Accessibility and release evidence:** the evidence package contains screenshots at desktop and mobile sizes, with local checks and normal draft-PR CI. Physical-device behavior is not proven by these browser captures. Later review corrections are recorded below.

## Time scale

The real-history trunk ends at present-day Earth (2026). Earlier years use a continuous logarithmic distance-back-from-present scale so deep-time questions do not leave most of the trunk empty while chronological order remains visible. Future event dates use a separate bounded extension to the right of 2026; that extension does not move the trunk endpoint or assign dates to undated records.

## Data and terrain limits

The captured graph contains 30 worlds in the active question, 42 known worlds, and 5 questions. The scene, camera, and renderer counts are each 1. The October 31 terrain integration correction now renders both v1 regional states and v2 water-level/continent states into the current Earth and mini-worlds using the shared local terrain data. The initial four-level capture set predates that restoration. Dataset provenance, resolution, datum and interpretation limits are recorded in [TERRAIN_DATA.md](../TERRAIN_DATA.md).

## Screenshots

The four zoom levels were captured at 1440×900 and 390×844. [`screenshots/capture-metadata.json`](screenshots/capture-metadata.json) records the viewport and scene metrics for each capture.

| Level | 1440×900 | 390×844 |
|---|---|---|
| Surface | [surface-1440.jpg](screenshots/surface-1440.jpg) | [surface-390.jpg](screenshots/surface-390.jpg) |
| Lift | [lift-1440.jpg](screenshots/lift-1440.jpg) | [lift-390.jpg](screenshots/lift-390.jpg) |
| Orbit | [orbit-1440.jpg](screenshots/orbit-1440.jpg) | [orbit-390.jpg](screenshots/orbit-390.jpg) |
| Atlas | [atlas-1440.jpg](screenshots/atlas-1440.jpg) | [atlas-390.jpg](screenshots/atlas-390.jpg) |

Additional captures show [Atlas options](screenshots/atlas-options-1440.jpg), a [saved-event preview](screenshots/saved-event-preview-1440.jpg), and a [scenario geography example](screenshots/green-sahara-scenario-1440.jpg).

## Frame-cadence observation

[`performance.json`](performance.json) records 12 samples per level after a 3-second warmup, sampled every 500 ms in local in-app Chromium at 1440×900. These are browser `requestAnimationFrame` cadence observations, not GPU timings, and do not prove 60 fps on other hardware or devices. Values near 240 Hz are consistent with the browser/display cadence ceiling in this capture.

| Level | Observed cadence, min / median / max (Hz) | Max real spheres |
|---|---:|---:|
| Surface | 233.67 / 240.00 / 240.00 | 5 |
| Lift | 239.70 / 240.00 / 240.00 | 7 |
| Orbit | 222.73 / 239.70 / 240.00 | 7 |
| Atlas | 233.95 / 239.85 / 240.30 | 9 |

## Validation

Automated tests use local fixtures and recorded outputs. The initial P4 explicit Node 22.23.3 run covered 46 `test/*.test.js` files: **420 passed, 0 failed** (7.70 seconds). Its raw TAP output is in the ignored local QA artifact `out/atlas-product-qa/restart-final-suite.log`.

The initial P4 Gitleaks 8.30.1 checks found **0 findings** in both the public-source export (382 files, 41.43 MB; `.env`, `node_modules`, and ignored `out` excluded) and the then-current source history range (4 commits, 372.64 KB). The screenshot and cadence metadata document that capture session only, not cross-device acceptance.

## Surface anchoring review — October 31

Surface event markers are now tangent, depth-tested geographic rings. They become mini-Earths during Lift; the parent remains a navigation label and trail until its mini-Earth appears during Lift. Labels use the same geographic anchor, recompute during dragging, and disappear beyond the perspective horizon. Lift click/preview centers share the rendered positions, and Orbit/Atlas sphere sizing remains unchanged.

Current screenshots: [before panning](screenshots/surface-pins-fixed-1544.jpg) and [after panning](screenshots/surface-pins-panned-1544.jpg), both at 1544×822. The earlier four-level capture set and P1 recording remain the original checkpoint evidence and predate this correction.

The review update passed **423/423 tests** on Node 22.23.3 (46 files, 8.14 seconds). Raw output: ignored local artifact `out/atlas-surface-anchor-review/full-suite-final.log`. The local keyless walkthrough made zero generation POSTs or external model calls.

## Terrain and preview integration review — October 31

The [integration audit](INTEGRATION_AUDIT.md) records the branch-baseline mistake and restored parity. The active implementation remains on `feat/atlas-zoom`.

Restored terrain-backed vegetation, lakes and shorelines, global water-level and continent controls, coordinate projection for moved terrain, and the rich saved-image hover card with internal scrolling. High-latitude Surface views now center the selected place in latitude as well as longitude. These are local rendering and preview operations; they do not call a model.

Current review captures: [Sahara](screenshots/terrain-restored-sahara-1440.jpg), [Sundaland](screenshots/terrain-restored-sundaland-1440.jpg), [Beringia](screenshots/terrain-restored-beringia-1440.jpg), [continent adjustment](screenshots/terrain-continent-adjustment-1440.jpg), and [scrollable scene preview](screenshots/terrain-restored-hover-1440.jpg). The older polygon screenshot is retained as historical failing-baseline evidence.

The combined correction passed **449/449 tests** on Node 22.23.3. Raw TAP output is preserved locally at `out/atlas-terrain-restore-review/full-suite-final.log`. Live keyless verification confirmed a decoded scene thumbnail, pointer transfer into its card, scroll movement from 0 to 7 pixels with Atlas zoom unchanged at 0, and dismissal after leaving both node and card. All generation POST counters remained zero.
