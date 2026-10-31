# Entry UX map review — 2026-10-31

This A/B review compares **A** (the immutable `main` baseline at `0254325`) with **B** (the local entry UX candidate). All 18 JPEGs below were checked with Pillow; each filename matches its actual pixel dimensions. Captures use a replay of the deep-sea history, not live generated history. A shows the earlier invalid v2 geography depiction as baseline evidence; it is not evidence of validated alternate terrain.

## Changes reviewed (B1–B7)

1. **B1 — Human labels and Details:** Exploration-tree rows use readable event labels with a direct **Details** action.
2. **B2 — Cross-run graph:** Saved descendants remain connected while navigating between runs; world IDs, ancestry, and event-scene references remain stable.
3. **B3 — Timeline:** Flat 2D is the default, with older events left and later events right; branches spread vertically. The root question has a separate undated starting lane. Orbit remains optional and interactive.
4. **B4 — States and lineage:** The map distinguishes root question, explored, saved-unexplored, generating, unavailable, and unrelated-tree states. The selected world and ancestry use a continuous gold thread. A selected parent stays gold while its three pending children stay cyan. Unrelated trees dim at their core and halo; same-question branches remain bright.
5. **B5 — Preview and style:** Hover/focus opens a compact, scrollable preview without entering a world. Pointer transfer keeps it open; wheel input scrolls the preview. Chronos parchment/gold tokens and the Cormorant Garamond title are retained.
6. **B6 — Invitation and entry:** The invitation panel starts collapsed at desktop and mobile sizes. Click or Enter explicitly enters a story node, including when its scene image is absent; repeated hover does not trigger continuation generation.
7. **B7 — Accessibility:** Map labels and helper text exceed 4.5:1 contrast: parchment 15.23:1, muted helper/metadata 10.84:1, and gold 11.15:1. SVG node hit targets measure 44 CSS pixels at narrow widths.

## Screenshot A/B index

| State | A — 1440×900 | A — 390×844 | B — 1440×900 | B — 390×844 |
|---|---|---|---|---|
| Workspace | [before/workspace-1440x900.jpg](before/workspace-1440x900.jpg) | [before/workspace-390x844.jpg](before/workspace-390x844.jpg) | [after/workspace-1440x900.jpg](after/workspace-1440x900.jpg) | [after/workspace-390x844.jpg](after/workspace-390x844.jpg) |
| Map | [before/map-1440x900.jpg](before/map-1440x900.jpg) | [before/map-390x844.jpg](before/map-390x844.jpg) | [after/map-1440x900.jpg](after/map-1440x900.jpg) | [after/map-390x844.jpg](after/map-390x844.jpg) |
| Hover preview | [before/hover-1440x900.jpg](before/hover-1440x900.jpg) | [before/hover-390x844.jpg](before/hover-390x844.jpg) | [after/hover-1440x900.jpg](after/hover-1440x900.jpg) | [after/hover-390x844.jpg](after/hover-390x844.jpg) |
| Enter / pending children | [before/enter-result-1440x900.jpg](before/enter-result-1440x900.jpg) | [before/enter-result-390x844.jpg](before/enter-result-390x844.jpg) | [after/enter-pending-1440x900.jpg](after/enter-pending-1440x900.jpg) | [after/enter-pending-390x844.jpg](after/enter-pending-390x844.jpg) |
| Surface view | — | — | [after/surface-1440x900.jpg](after/surface-1440x900.jpg) | [after/surface-390x844.jpg](after/surface-390x844.jpg) |

The pending screenshots show the **1931 Medicinal Resin** world selected, its three cyan generating children, and the selected parent in gold. The local fake pipeline was held for 60 seconds to capture the pending state, then navigation away aborted it. A separate local stub sequence completed three children over six SSE steps in about 48 seconds. These are fixture timings, not live Meta latency or app performance measurements.

## A/B test contract

A serves the immutable `0254325` source in keyless replay mode. B serves the candidate with a copied recorded replay and an injected local fixture pipeline. The fixture retains the original source untouched and includes the root, nine descendants, and 19 event scenes. The review wrapper caps fake pipeline calls at 12 and sets `DEMO_MAX_EXPANSIONS_PER_SESSION=20`. The pending-run abort and replay counters below contain no identifiers or credentials. No Meta client, live model endpoint, or paid dispatch was used.

## Counter and test receipts

- Hover-only baseline/candidate receipts: `continuePosts` **0 → 0**, external Meta dispatches **0**. See [before](receipts/hover-counter-before.json) and [after](receipts/hover-counter-after.json).
- Explicit re-entry receipts: `continuePosts` **1 → 1**, three completed children and six SSE steps per run, external Meta dispatches **0**. See [before](receipts/reentry-counter-before.json) and [after](receipts/reentry-counter-after.json).
- All-surfaces comparison receipts record one continuation post per run; hover-only receipts remain zero. External Meta dispatches are **0**. See [before](receipts/all-surfaces-hover-before.json) and [after](receipts/all-surfaces-hover-after.json).
- Pending-and-leave receipt: one local continuation started, no child completed before navigation abort, external Meta dispatches **0**. See [pending-and-leave-counters.json](receipts/pending-and-leave-counters.json).
- Pinned Node 22 suite: **335/335 passed**. The ignored run log is named `full-suite-lake-compatibility.log`.
- Public review-folder scan: Gitleaks **8.30.1**, zero findings. Structured results are in [validation.json](validation.json); the ignored scan report remains under `out/`.

## Limits and release status

These screenshots show saved event/place metadata from the replay. They do not validate alternate terrain or sea-level geometry; the separate local terrain branch was not imported. No live Meta QA or paid model dispatch occurred. PR #7 remains parked. No app hosting or deployment was performed.
