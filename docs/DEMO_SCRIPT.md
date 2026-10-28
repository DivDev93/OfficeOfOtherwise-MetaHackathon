# Three-minute judging demo

The public deployment is replay-only. Use a cached story throughout; do not trigger live generation. The guardrail fixture is simulated and deliberately represents an unavailable classifier, so call that out. The Alexandria replay contains a separately generated SAM 3D Objects model; playback uses the saved model and makes no live model calls.

| Time | Screen and narration |
| --- | --- |
| 0:00–0:15 | Start with the archive picker in view and Alexandria selected. Click **Open story**. Open on the Earth as it flies to the first branch pin. “Office of Otherwise turns a question about the past into places and possible futures. These saved paths are replaying; no credits are used here.” |
| 0:15–0:27 | Choose **Simulated guardrail** and open it. Show the reframe. “This is a simulated fail-closed screen for an unavailable topic classifier. No Muse policy call was made for this fixture.” |
| 0:27–0:54 | Click **Try the suggestion**. Let all three saved paths stream as pins and arcs; let review settle on the gold hero pin. Click another pin, show its selected label and matching accessible card, then return to the gold hero. “Muse Wonder proposes and reviews the paths. Each pin is a real place and year. Watch the provenance move from policy to branches and review. The old Alexandria replay records Muse Wonder policy checks; current topic policy uses Muse Spark.” |
| 0:54–1:08 | Show **Scene**, then point to the model cards. “Muse Image rendered this scene. The panel and provenance strip keep each Meta model and its measured time and cost visible.” |
| 1:08–1:58 | Select **SAM cutout**; the subject fills the page. Select **3D object**, then click **Orbit object** or drag the model. Keep the full-width viewer on screen for the complete 50-second beat. “SAM 3.1 isolates the subject; Meta SAM 3D Objects supplies this saved model. Its original GLB is 13.39 MB; the local Meshopt viewer copy is 2.63 MB. This is replay, not a new 3D generation.” |
| 1:58–2:22 | Choose **Back to atlas** and show the provenance strip. “Muse Spark was not called in this older run. Muse Wonder’s saved policy checks, branches and review, Muse Image, SAM 3.1, and SAM 3D Objects each show recorded timing and cost. Unknown values stay unknown.” |
| 2:22–2:52 | Show the public repository, then end on the Earth and hero. “The technical core is a shared metered Meta client, fail-closed topic policy, reviewed geo-anchored branches, saved image and cutout artifacts, replayable provenance, and a full-width interactive 3D viewer. The impact is a way for people to explore how places and ideas might have changed.” |

**Timing target:** 2:52, with an 8-second trim margin. The cutout-to-orbit sequence stays full width for 50 seconds. The orrery cutout misses Saturn and some thin components; the source scene and saved 3D model remain available.

**Measured dry run:** 2:52 (172.0 seconds) on 2026-10-28 against the local replay, including browser action time. No live generation was invoked.
