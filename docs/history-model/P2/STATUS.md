# P2 — suggestions, weave, ripple and fork

Validated locally on November 1, 2026 (America/Toronto).

## Changes

- `src/agents/historyAgent.js`: bounded Muse Wonder suggestions, strict fit/conflict
  output validation, full-history and fork context, topic checks, Spark ripple checks,
  and explicit event regeneration. Recorded Chad conflict/fit fixtures make no calls.
- `src/demo/historyService.js`: chronological weave, deliberate/conflict forks,
  durable review flags, exact per-weave Keep/Regenerate actions, revision checks and
  concurrency-safe merges. Regeneration clears stale media references.
- `src/demo/historyStore.js` and `server/index.js`: durable window reservations,
  uncertain-attempt recovery, append-only More batches, ready-empty caches, preferences,
  access controls, session caps and generated-world/window/history usage hooks.
- `web/historySession.js`, `web/historyPanel.js` and app integration: default-on,
  800 ms debounced auto-suggest; stable cached windows; manual Suggest/More; fitting
  Weave and explicit fork controls. Hover never requests generation.

The deep fixture exposed duplicate IDs for sibling paths in the P1 migration. Full-path
identity now resolves collisions, and normalization rejects duplicates. Ambiguous
persisted collisions fail closed; only provable legacy recovery writes a recovery
receipt. The earlier isolated browser state is preserved locally as diagnostic evidence.

## Verification

All **730 phase-candidate source tests passed on Node 22.23.3**. They cover real migrated IDs/windows, concurrent requests and edits,
More reservations, restart uncertainty, spent caps, exact ripple flags, last-suggestion
consumption across restart, and four sibling paths. The existing UI test harness now
injects the real history modules. Final test and staged secret-scan results are recorded
with the phase commit. Draft P3 helper tests were excluded from this phase-candidate run.

The local saved sea-levels browser check found **7 histories / 7 unique IDs**. Clicking
Weave on the cached 2003 event changed exactly **one** history, preserved all siblings,
removed that candidate, and left its window **ready with 0 suggestions** after GET.
Auto-suggest was switched off using its visible checkbox. Green Sahara shows the
manual Suggest control. Four phase JPEGs capture both named stories at 1440×900 and
375×812. No horizontal page overflow was observed in the phone captures.

These remain transitional rail/globe captures: the history timeline and date bar are
P3, and sibling Orbit/history spines are P4. Local review servers use replay-only
configuration with no Meta credentials. Tests and browser verification made **zero
paid model calls**. No app deployment was performed.

## Calls and cost

| Action | Model calls |
| --- | --- |
| Migration, cached date/window, hover, Keep, creating a fork | 0 |
| One uncached suggestion window or explicit More batch | 1 Muse Wonder + up to 3 Spark topic checks |
| Weave with L later events | L Muse Spark ripple checks; no automatic content edits |
| Explicit Regenerate event | 1 Muse Wonder + 1 Spark topic check |

The demonstrated cached 2003 weave had no later events, so it made 0 calls. Live dollar
cost depends on recorded token usage and configured rates; the shared Meta client and
durable ledger enforce the existing spend cap. Pending/failed/uncertain attempts consume
session allowance; only completed batches increment the generated-window counter.
Stored suggestions have no count cap and do not expire.
