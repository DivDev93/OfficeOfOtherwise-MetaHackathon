# P3 — timeline, time bar and history surface

Validated locally on November 1, 2026 (America/Toronto).

All **761 P3 candidate tests passed on Node 22.23.3**. The unwired P4 spine
helper/tests were excluded from this phase-candidate run.

## Changes

- The active rail is a chronological history timeline: persistent era folds, cause
  links, per-event forks/review actions, tabs or a dropdown above four histories,
  and saved suggestion-window jump controls. The duplicated breadcrumb and legacy
  child-expansion actions are absent from the active history flow.
- The globe's date bar supports native dragging, exact event-tick selection and
  event-to-event arrow keys. Date scrubbing preserves the selected event sheet.
  Zoom buttons are in View options; the date bar is the only visible slider.
- Surface pins show every current-history event through the date in gold, emphasize
  the latest, and show only the selected window's suggestions in cyan. Geography
  composes through that date and the panel names the composed changes.
- Present/Scenario and local geography previews redraw the globe. Previews are
  scoped to history/date, reset to the composed baseline, and do not edit events.
- Phone history mode uses a reopenable timeline drawer and compact event card, so
  Earth and the date bar remain visible. Open details expands the selected event.
- Saved media is restored only from exact matching source events and verified files.
  Regenerated content cannot borrow stale branch media or evidence.

Main paths: `web/historyTimeline.js`, `web/historyTimebar.js`,
`web/historyAtlas.js`, `web/historySession.js`, `web/app.js`,
`web/atlas/controller.js`, `web/atlas/scene.js`, and `server/index.js`.

## Browser verification

The preserved deep sea-levels story has seven distinct histories, exercising the
dropdown. Native phone dragging visited 2368 CE (5 gold pins), 1603 CE (0), and
1991 CE (3), while the selected sheet stayed on the 1978 Canopy event. Clicking
the neighbouring 2003 and 1978 ticks selected the exact event and year. ArrowRight
stepped to the next event. History fork labels remained fixed while dates changed.

The Sahara saved-window control exposed its existing CE suggestion without generating
anything: as of 550 CE, the surface had one gold event and one cyan suggestion, with
Green Sahara and inland lakes in the composed summary. The selected 2800 BCE event
retained its recorded scene/cutout/model references.

Present/Scenario changed the rendered history mode. A 350 m local preview reset to
the composed -115 m baseline in the deep story, with event pins unchanged. Expanding
adjustments still left only the date slider visible; number steppers remained usable.
Phone History/Focus Atlas and Open details controls keep the drawer/card reachable.

The four named JPEGs are rendered at 1440×900 and 375×812. The scrub recording is
`date-scrub-phone.webm`: 75 CDP screencast frames, native Browser pointer dragging,
ArrowRight and an event-tick click, encoded at 12 fps with frame timestamps retained
for a 7.416 s clip. This is interaction evidence, not a render-FPS measurement or a
physical-device test. Earlier diagnostic captures are preserved in the ignored review
area and are not final acceptance images.

## Cache consistency and cost

Unwoven suggestions remain usable after a history changes. An explicit stale
Weave/What-if checks that same saved candidate with one Spark call; it does not
generate a replacement window. A new conflict updates its badge/reason in place,
and an unavailable checker leaves it saved as pending. Forks involving an earlier
conflicting event share only the prefix before the earlier fork year.

Cached scrubbing, hover, era folds, window jumps and Keep cost 0 calls. An uncached
auto-suggest window or explicit More uses one Wonder call and up to three Spark
policy checks. Weave then uses one Spark per later event, plus one compatibility
check only if its candidate is stale. Dollar cost follows actual token usage and the
shared ledger/caps. Verification used fixtures and replay-only local servers with
**zero paid model calls**, no app deployment and no hackathon submission.

## Remaining phase

Optional sibling-history Orbit, Atlas history spines and final removal of legacy
routed wiring are P4 work. Their unwired helper is excluded from the P3 candidate.
