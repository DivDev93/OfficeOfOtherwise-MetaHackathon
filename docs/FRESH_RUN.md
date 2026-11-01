# Fresh interactive run evidence

This is a separate, single-session observation captured against the released app source revision `0254325`. It is not added to the fixed historical trace cohort in [METRICS.md](METRICS.md).

## Capture and scope

One of three recording attempts produced a complete telemetry capture: **1 complete, 2 partial**. The two partial attempts were recorder failures (a busy recorder control and text encoding), not recorded model failures. This is a recording-completeness count, not an API success rate. The complete capture has `failure: null` in its session telemetry. The recording session used the existing local API configuration; this report does not reconcile provider request/response logs or make a per-call success claim.

Telemetry covers **220.389 seconds** from its ISO `startedAt` through `endedAt`. The WebM container is **225.480 seconds** at 1920×1080 and 25 fps. These are different measurement windows and are reported separately.

## Observed interactions

Wall-clock deltas below are calculated by subtracting the ISO timestamps of named telemetry milestones. They measure selection-to-UI-confirmation spans, including app work and rendering. They are **not** first-pixel times, test-suite timings, or provider/model request latency. There is one complete recording, so no percentile or population reliability claim is appropriate.

| Interaction | Start milestone | Ready/confirmation milestone | Elapsed |
| --- | --- | --- | ---: |
| Root submit → root scene ready | `fresh-root-submit` | `root-scene-ready` | 72.026 s |
| Root submit → root scene and automatic children ready | `fresh-root-submit` | `root-event-scene-and-autochildren-ready` | 136.189 s |
| Choose B → B scene ready | `choose-child-B` | `child-B-scene-ready` | 16.188 s |
| Choose B → B scene and automatic children ready | `choose-child-B` | `child-B-scene-and-new-autochildren-ready` | 53.070 s |
| Choose C → C matching scene ready | `choose-grandchild-C` | `grandchild-C-scene-ready` | 1.707 s |
| Choose D → D sibling scene ready | `choose-sibling-D` | `sibling-D-scene-ready` | 0.441 s |

The recorded path was `800 BCE · Fezzan Reed Boat Lake Routes` → `620 BCE · Marker Carvers Teach Channel Reading` → `480 BCE · Flood Calendars Guide Lakeside Planting`. The alternate D scene was `340 BCE · Sealed Pots For Lake Grain`.

C and D showed saved-scene UI state shortly after selection. Their short intervals establish only that the scene was ready in the UI; they do not establish that a new image was generated during either interval. The recording shows B's automatic children and C's scene ready, then backtracks to the root and opens D. At the end, D's own child generation and another event task were still processing, so the video does not establish that all descendant work completed.

## Reproduction and limits

The compact, allowlisted values and milestone IDs are in [fresh-run-evidence.json](fresh-run-evidence.json). Durations can be recomputed as `(ready timestamp − start timestamp)` from the private session telemetry. The full telemetry, progress capture, and WebM remain local evidence; this public summary omits local paths, local URLs, environment values, and raw telemetry. The final submission asset's local review/publication state is separate and remains pending.
