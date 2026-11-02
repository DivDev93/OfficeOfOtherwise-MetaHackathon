# History model migration

Operator objective: migrate the local prototype from permanent branching possibilities
to questions containing chronological histories. PR #11 was already merged before this
work began. Each completed phase is validated locally on Node 22 and committed on main.
No app deployment or hackathon submission is part of this work.

## Phase acceptance

1. **P1:** deterministic legacy migration, durable histories, composed geography, tests.
2. **P2:** cached date windows, strict fit/conflict suggestions, weave/fork, ripple flags,
   auto-suggest preference and existing spending/session limits.
3. **P3:** chronological era rail, history selection, date bar, as-of pins/geography,
   event sheet context, desktop/mobile captures and scrubbing recording.
4. **P4:** optional sibling-history Orbit, history spines in Atlas, removal of active
   tree/breadcrumb/routed-edge presentation, captures and zoom recording.

## Evidence

Phase directories contain local saved-story captures at 1440×900 and 375×812, with
receipts identifying the story, date, viewport and validation limits. P1/P2 captures
document the transitional UI; P3/P4 verify the replacement presentation. Saved stories
and fixture runners are used for verification; no live model calls are made by tests.

## Compatibility and cost

Legacy run and continuation files remain readable and are not rewritten by migration.
The history layer preserves event geography lists and media references. Geography is
composed through the chosen year, with later region/kind changes overriding earlier
ones and zero intensity removing a change.

Migration, cached-window reads, hover and date rendering make zero model calls.
Generation and ripple-call accounting are documented in the completed phase receipts.
