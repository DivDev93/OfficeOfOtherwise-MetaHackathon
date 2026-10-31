# Atlas zoom implementation record

This page records the local Atlas implementation and the evidence captured on 2026-10-31. The work uses saved public replay data; it made no live Meta calls and does not require hosted app access.

## Phase status

- **P0 — Data model and migration:** implemented in `web/atlas/worldModel.js` and `scripts/migrate-atlas-worlds.js`. The migration preserves stable world and question IDs, normalizes authored attachments, and derives legacy theme, boldness, and divergence-year values deterministically.
- **P1 — Surface, lift, and orbit:** implemented in the single Atlas scene. The Sundaland → Kuching path is recorded in [`p1-sundaland-kuching.webm`](p1-sundaland-kuching.webm) (9.40 seconds). The transition follows camera zoom, but uses a fade-through-cut around the midpoint rather than rendering a literal simultaneous crossfade. This keeps one scene, camera, and renderer while making the handoff readable; it is a visible continuity tradeoff.
- **P2 — Atlas timeline:** implemented with a logarithmic history axis, axis modes, levels of detail, and folded dense nodes. Captures cover all four levels. Dense Atlas labels are intentionally thinned; the complete exploration tree remains available for navigation. The captures do not establish perfect label spacing at every graph size.
- **P3 — New-question attachment and travel:** present-day and current-world attachment metadata, travel modes, and ghost trail controls are implemented. The Atlas options capture is included below. Integration and final interaction review remain distinct from the static captures.
- **P4 — Accessibility and release evidence:** the evidence package contains screenshots at desktop and mobile sizes. Accessibility behavior has implementation and test coverage, but final repository checks are still pending the remaining selection fix. Physical-device behavior is not proven by these browser captures.

## Time scale

The real-history trunk ends at present-day Earth (2026). Earlier years use a continuous logarithmic distance-back-from-present scale so deep-time questions do not leave most of the trunk empty while chronological order remains visible. Future event dates use a separate bounded extension to the right of 2026; that extension does not move the trunk endpoint or assign dates to undated records.

## Data and terrain limits

The captured graph contains 30 worlds in the active question, 42 known worlds, and 5 questions. The scene, camera, and renderer counts are each 1. The display renders the saved v1 curated geography masks. Some saved v2 deep-geography data is unsupported by this renderer: it remains visible as a present-day warning and falls back to a scene-image disc for mini-worlds. Those discs do not represent rendered scenario terrain. Broader terrain work remains on a separate local `30510ca` branch and is not included here.

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

Automated tests use local fixtures and recorded outputs. The final explicit Node 22.23.3 run covered 46 `test/*.test.js` files: **420 passed, 0 failed** (7.70 seconds). The raw TAP output is in the ignored local QA artifact `out/atlas-product-qa/restart-final-suite.log`.

Gitleaks 8.30.1 found **0 findings** in both the current public-source export (382 files, 41.43 MB; `.env`, `node_modules`, and ignored `out` excluded) and the `6900..HEAD` history range (4 commits, 372.64 KB). The screenshot and cadence metadata document this capture session only, not cross-device acceptance.
