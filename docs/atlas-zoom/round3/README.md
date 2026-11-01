# Atlas round-three review evidence — 2026-10-31

The eight screenshots show the saved deep-tree story at Surface, Lift, Orbit and settled Atlas at 1440×900 and 375×812. `wheel-roundtrip.webm` captures wheel input from Surface (0%) to Atlas (100%) and back to Surface (0%); its 69 frames are from the browser screencast, with capture gaps longer than 0.7 seconds shortened.

Exact settled question-root and parent-child paths were independently checked together for crossings, unrelated edge overlaps and non-endpoint node hits. The saved story reported no unresolved paths. Mixed-date synthetic fixtures, including equal and backward dates and multi-root questions, also passed; these cases do not prove every possible graph. A 500-edge independent fixture took about 2.4 seconds to lay out locally. Links are briefly hidden during an axis-layout morph so moving nodes do not display intersecting in-between routes. During the continuous Orbit-to-Atlas zoom blend, in-between geometry can still temporarily intersect before settling.

At 375px, the Other questions control was checked against saved data: opening it changed the visible world count from 30 to 42 and closing it restored 30. The phone Zoom out button was hit-tested and opened Orbit at 68%. Reduced-motion emulation reported a 0-second transition for the rail, sheet and compact card. Review used the local replay-only fixture and did not dispatch Meta requests.

`details-open-1440.jpg` and `details-open-375.jpg` show the selected-world sheet open in Orbit; `details-atlas-open-375.jpg` shows it in Atlas. Local browser checks confirmed its compact card is hidden while the sheet heading is visible, the close button receives focus after the reveal, and closing returns to the compact card. At 375px the sheet clears both the Orbit toolbar and the Atlas question toggle.

`transition-90-375.jpg` records the phone view at 90% zoom: the Other questions toggle is reserved as a label obstacle. Parent–child route interpolation was adjusted to reduce mid-transition crossings on the saved fixture, but it does not eliminate all crossings or establish clearance for every question connector.

`undated-1440.jpg` and `undated-375.jpg` show a separate in-memory mixed-date fixture. Undated worlds use a labeled lane outside the calendar trunk; the fixture makes no API calls and does not modify saved stories.

`hover-preview-375.jpg` shows a phone Orbit preview. A local pointer check confirmed the original node point remains on the canvas, a slow pointer transfer reaches the preview, and scrolling it leaves globe zoom unchanged.

`large-cluster-375.jpg` shows a disposable in-memory fixture with 27 folded Orbit possibilities. The local scene check covered keyboard opening and Escape, paging and selection, pointer hover and click, and a drag starting on the cluster. The fixture made no model calls or saved-data writes; this fallback handles large clusters and does not resolve the remaining crowded-label or intermediate-crossing limits.

`orbit-labels-1440.png` and `orbit-labels-375.png` show the updated Orbit labels in the same saved story, with the default two unfolded children. These captures do not establish that every dense or blocked layout is collision-free.

`lift-revised-1440.png` and `lift-revised-375.png` capture the revised Lift panel treatment at 30% zoom. At 50% on the phone, a local computed-style check found the compact card visible while fading in; the fading story tree, geography panel, and full sheet were inert at 30%.

`lift-slide-1440.png` and `lift-slide-375.png` capture the later slide treatment at 30% zoom. On desktop, the local computed widths for both the rail and tree remained 320px while the tree translated left; this check does not prove every transition frame or viewport.

`lift-title-clear-375.png` captures the saved story at 30% zoom after reserving the visible details sheet as a label obstacle. At 40%, the local replay continued to show other Atlas labels outside the sheet.

`wheel-roundtrip-timed.webm` and `wheel-roundtrip-timed.json` record a later local desktop wheel journey from 0 to 100 and back to 0. The receipt includes each wheel delta, resulting slider value, and browser frame timestamp. Three buffered frames from an earlier capture were excluded; the remaining capture gaps were not shortened. The WebM uses the encoder's 25 Hz time base, so timestamps are approximate to 40 ms; it does not prove every intermediate frame was captured.

`cluster-hit-1440.png` and `cluster-hit-375.png` show a separate synthetic Surface fixture after hovering approximately 22 CSS pixels to the right of its cluster center. The fan opened at both sizes. This samples one boundary direction and does not establish the hit size of every Atlas or Orbit node.

`atlas-hit-world-{1440,375}.png`, `atlas-hit-chip-{1440,375}.png`, and `orbit-hit-cluster-{1440,375}.png` show a local in-memory fixture after real pointer moves near a target edge. The world and chip previews reported offsets of approximately 21.7–21.9 CSS pixels from their projected centers; the Orbit cluster expanded at an approximately 28px horizontal offset. These sample single directions; they are not exhaustive 44px-boundary or overlap proofs. No saved runs or model calls were used.

In the recorded local replay at 1440×900, successive 120-pixel wheel inputs reached 10, 19, 29, 38, 48, 57 (Orbit), 67, 76, 86, 95 and 100 (Atlas). The reverse pass reached 90, 81, 71, 62, 57 (Orbit), 47, 38, 28, 19, 9 and 0 (Surface). Both passes left the Orbit stop on the next input.
