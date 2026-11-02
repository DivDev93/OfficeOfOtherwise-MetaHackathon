# P1 — data, migration and geography

Validated locally on November 1, 2026 (America/Toronto).

- `web/historyModel.js`: deterministic saved-tree migration; chronological histories,
  causes and derived eras; safe event media references; date-bounded geography union.
- `src/demo/historyStore.js`: versioned atomic storage, non-destructive legacy refresh,
  stable history IDs across path extensions, and hashed per-user/session usage hooks.
- `server/index.js`: authenticated `GET /api/histories`, optionally with `asOfYear`;
  existing run and history routes remain readable.
- Regression coverage includes selected root events, fork prefixes, explicit question
  causes, media identities, v1/v2 geography, persistence/restart, incremental migration,
  corrupt-state handling and access controls.

## Verification

The active source suite passed **691 tests** on Node **22.23.3**. The command expands
`rg --files test -g '*.test.js'` into `node --test`; ignored historical test copies under
`out/` are excluded, as they are absent from clean CI checkouts. `git diff --check`
passed. Secret scanning is recorded in the phase commit validation.

Local API verification of the preserved deep sea-levels fixture returned one question,
seven migrated histories, 23 history-event occurrences and 15 cached suggestions.
`asOfYear=1978` returned date-filtered events, eras and composed geography. This used
only saved records and made **zero model calls**.

## Captures and limits

The four JPEGs capture Green Sahara and the exact saved 1978 Canopy Walkway event at
1440×900 and 375×812. The deep story comes from a preserved review-fixture snapshot,
copied into the ignored local review area without modifying its source. Raw original
runtime directories were not available in this checkout. No saved fixture data was
fabricated and no live model requests were made.

These are **transitional UI captures**: the existing tree/zoom controls and event-only
geography panel still appear. The deep fixture's legacy tree loader remains displayed
while its selected event and saved image are readable. P3 replaces the rail/date UI;
P4 replaces tree wiring and Orbit semantics. These captures do not claim those phases
are complete. The final date control, history sheet header and composed surface
presentation remain pending.

Migration, date composition, cached reads and hover cost **0 calls / $0**. Suggestion
generation, weave ripple checks and browser auto-suggest behavior are P2 work.
