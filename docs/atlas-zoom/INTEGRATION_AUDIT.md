# Prototype integration audit — October 31, 2026

## Cause and active branch

Atlas was created from main `6900be0`, as required by its handoff after PR #10 merged. The completed local terrain work remained in `codex/hackathon-evidence-final` at `30510ca`. Their common ancestor is `0254325`. Treating main as the complete prototype baseline omitted that local work from the new preview.

The terrain source contained five commits after the common ancestor (`99744fc`, `d515d47`, `21f99fa`, `985f3b4`, `30510ca`). Atlas already included PR #10's entry fixes and its own design checkpoints. This was missing integration, not deletion of the source work.

All repairs in this audit are integrated on the existing `feat/atlas-zoom` branch and draft PR #11. Main, develop, parked draft PR #7, and the preserved source worktrees are unchanged. The old map runtime is not reintroduced.

## Confirmed regressions and correction

| Area | What Atlas omitted | Correction |
|---|---|---|
| Geography appearance | The earlier elevation-backed renderer was replaced by main's coarse v1 polygons; valid v2 states were labelled unsupported. | Shared terrain renderer/data now serve v1 and v2 states for the current Earth and mini-worlds, with async readiness and cache invalidation. |
| Local geography adjustments | Existing water-level and continent controls were absent. | Restored per-event local adjustments and reset-to-event controls. No model call or saved-coordinate rewrite. |
| Geographic anchors | The old renderer projected event locations with transformed land; Atlas initially used raw coordinates. | Current marker, pins, labels, route anchors and Surface orientation now use the same geographic projection. |
| Hover cards | The old map's thumbnail and internal scrolling became a noninteractive text-only preview. Old-component tests still passed although that component was inactive. | Active Atlas/tree preview now renders the saved thumbnail, retains pointer/focus transfer, scrolls internally and dismisses after leaving. New tests target this active component. |
| High-latitude focus | Atlas's Surface orientation centered longitude only. Beringia could open on mostly ocean with its event at the top edge. | Latitude pitch and longitude yaw now move the shared Earth/pin/route rig together and unwind through Lift. |

## Verified retained work

The older dirty voice-prototype checkout was compared with main and Atlas. Its Meta voice provider, browser voice module, continuation stores, event-scene/cutout stores and replay packager match the corresponding main/Atlas blobs exactly. Their working routes and newer Atlas entry behavior are present. Four saved SAM 3D replay models remain packaged.

The separate source branch also holds demo/metrics documentation and recorded evidence. Those files and local candidates remain preserved there; this repair does not replace the submission materials or submission video. Parked pilot work remains parked.

No separate implemented remote private-judge gateway was found in the audited voice source. Its judge-access document remains a plan and boundary, not evidence that fresh private SAM 3D was previously available in the public app.

## Scope of the audit

This was a commit/file inventory and focused runtime-feature comparison across main, the terrain source, the voice prototype and Atlas. Large app/server/UI files differ because their interaction models evolved; matching core modules is not proof of every historical behavior. Confirmed omissions above were restored and checked against the active implementation rather than relying on inactive old-map tests.

The public terrain rasters were checked against their source metadata and SHA-256 records. Only their compact outputs, provenance document and reproduction script were carried over; source TIFF/archives, credentials and private backend code were not copied.

Validation and current captures are linked from [README.md](README.md). The full local Node 22 suite passed 449 tests after integration. Browser checks used saved data without model dispatches. No app deployment or hackathon submission was performed.
