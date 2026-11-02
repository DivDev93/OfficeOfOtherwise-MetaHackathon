# P4 — history Orbit, Atlas and end-to-end entry

Date: 2026-11-02 (America/Toronto). Local prototype only; no deployment or submission.

## Changes

The active Atlas uses chronological history spines and independent event records,
rather than nested possibility routes. The current history is gold, siblings are dim,
and user-authored questions are parchment. Other questions are count chips on the
trunk. Only the active history's current window contributes cyan suggestions.
Shared event selection preserves the current history. Forks split at their recorded
year, and other-question chips retain their true dates when placed at trunk edges.

View options contains **Show Orbit level**, initially off and available only for
questions with at least two histories. Orbit projects every sibling at the same chosen
date. One history, or Orbit off, transitions directly from Surface to Atlas.
Wheel and pinch ignore the rail, date control, menus, event sheet and geography panel.

Native question creation now creates a question with an empty History 1. It does not
generate a permanent tree or force a first event. Explicit scene/cutout generation
uses canonical question/history/event identities, revision checks and durable media
reservations. Saved media and legacy runs remain readable. A keyless configured
loopback server permits local history reads and editing, without enabling live model
generation or broad remote access.

Canonical URLs retain question, history, chosen date and selected event. Reload and
question/history selection read saved state without generating suggestions. The
saved-question picker exposes the archive; failures show a history status instead of
restoring the nested tree. The active rail and sheet use history/event language.

## Calls and cost

| Action | Calls |
| --- | --- |
| Date rendering, cached windows, hover, zoom, question/history selection, reload, Keep | 0 |
| Uncached auto-suggest window or explicit More | 1 Wonder + up to 3 Spark policy checks |
| Weave with L later events | L Spark ripple checks; an additional Spark check if its cached candidate is stale |
| Explicit event regeneration | 1 Wonder + 1 Spark policy check |
| New question | 1 Spark policy check; 1 Wonder framing call when year/place are missing |
| Explicit scene or cutout | Existing shared Image or SAM runner, once for the event revision and output kind |

No live model calls were made for this phase's tests or browser verification: **$0**
in validation spend. Runtime dollar cost depends on actual usage in the shared ledger,
with the existing spend and session caps. Uncertain reservations are not silently
retried. Stored suggestions remain uncapped and do not expire. Complete parent
history context is supplied when attaching a question; oversized model context is
rejected explicitly, rather than silently dropping events.

## Verification

Final local test, secret scan, capture and recording results are listed in
`capture-receipt.json`. Screenshots and recordings are browser evidence from replay
fixtures, not physical-device proof or evidence of new model-output quality.

All **718 source tests pass on Node 22.23.3**, with zero failures or skips. The
staged Gitleaks scan also passed with no leaks found. The
configured keyless local browser opened both saved questions. At 1978 CE, optional
Orbit rendered seven Earths; Orbit off reached seven history spines directly. The
one-history Sahara hid the Orbit option and reached Atlas directly. Its 550 CE
window retained one gold event and one cyan suggestion, including when their years
were thousands of years apart. Both Atlas frames remained bounded. Rail/geography
scrolling left the camera unchanged, and the phone kept one visible slider with no
horizontal overflow.

The 375×812 zoom recording contains 76 timestamped browser frames and runs for
24.083 seconds at an encoded 12 fps. It follows native wheel input from Surface
through optional Orbit into Atlas, holding the date at 1978 CE. Earlier diagnostic
captures and incomplete recording attempts are preserved in the ignored review area.

The legacy UI regression suite was retargeted to mounted history creation, exact
reload, timeline/date selection, question/history switching, failure status, explicit
media identity and no generation on selection. Independent server, policy, budget,
migration, media and voice coverage remains in the source test inventory. Retired
tree/SSE UI assertions no longer define the product's behavior.

`npm test` explicitly discovers the source `test/*.test.js` suite. Ignored recovery
snapshots under `out/` are preserved and are not accidentally executed as a second,
incomplete copy of the application.
