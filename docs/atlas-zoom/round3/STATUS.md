# Round 3 status — 2026-11-01

Reviewed on the requested saved event at 1440×900 and 375×812. Current screenshots and the wheel recording are in [current-20261101](current-20261101/); the sanitized receipt identifies the captured source and limits.

| Item | Result | Evidence |
| --- | --- | --- |
| Panel transitions | Fixed-width panel exit, sheet/card handoff, reverse transition and reduced-motion instant swaps implemented. | Surface/Lift/Orbit/Atlas captures; panel tests; local computed-style checks. |
| Atlas layout | Time-based tree layout, validated route/node clearance, rounded curves, gold lineage and hover highlighting implemented. Connected reveal coordinates rendering and hit targets. | Saved Canopy graph and synthetic routing tests; desktop/mobile Atlas captures. |
| Wheel range | Browser input reaches 0→100→0 and exits the Orbit stop on the next input. | Refreshed synthetic-wheel video and receipt. |
| Labels | Directional ancestor markers retain short titles; Orbit child labels obey Unfolded worlds and use overflow controls when crowded. | Label tests, phone capture, local cluster fixture. |
| Polish | Ring thickness, framing, single present-day label, axis title placement and shortened question labels implemented. | Current captures and layout/axis tests. |
| Phone | Orbit zoom-out default, active-question Atlas and Other questions toggle implemented. | 375px captures; local toggle and button checks. |
| Hit areas and motion | Nominal targets meet 44px sizing, overlap ownership uses nearest anchors, and the paged overflow control is fully inside the phone viewport at 58×58px. Reduced-motion details swap instantly. | Geometry tests, representative actual pointer checks, cluster fixture, local computed styles. |

## Validation and limits

The explicit source test suite passed 584 tests under Node 22. Gitleaks passed staged source changes. No live model requests were used by tests or captures. This is local browser verification, not physical-device acceptance.

Curves retain straight portions where required for clearance. Labels shorten long titles on narrow screens; the full information remains available through preview/details. The overflow trigger has a complete accessible name, although its visible text is clipped inside its fixed-size target. Extremely crowded or malformed graphs are not exhaustively proven: unresolved reveal plans preserve the prior renderer, and intermediate fallback geometry can still cross. The legacy simplified transition measurement is a bound, not a claim of zero crossings in every frame or graph.

The video uses Chrome/CDP synthetic wheel input and is encoded at 12 fps; this does not measure application frame rate. Prior captures are preserved as historical evidence. No deployment, merge, pilot work or hackathon submission is part of this batch.
