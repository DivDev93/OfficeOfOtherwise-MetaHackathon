# Acceptance evidence

The operator's four-phase objective remains the acceptance standard. A phase commit
does not prove later phases or every browser interaction. This ledger is updated when
current source, tests and rendered evidence establish the listed behavior.

| Requirement | Evidence / status |
| --- | --- |
| PR #11 on main; phase commits and pushes; no deployment | PR #11 already merged. P1 `ed3a9eb`, P2 `d47a2f2`, P3 `1f069a2` pushed with passing CI; P4 final commit carries this completed ledger. No app deployment. |
| Questions contain chronological histories; event fields/media retained | P1 domain/store/API source and history regression tests. |
| Deepest visited path first; other visited paths fork; unvisited candidates cached; legacy readable; no migration calls | P1 migration fixtures, source tests and local saved sea-levels API read; P1 receipt. |
| Geography union through date, later region+kind override, zero removal; existing schema | P1 v1/v2 composition tests; P3 rendered composed surface and reset-to-composition checks. |
| Wonder proposes about three window events; strict fits/conflicts names event/reason; known Chad fixtures | P2 source, fixture and browser evidence in P2/STATUS.md; final phase checks recorded at commit. |
| Default-on toggle; 800ms debounce; stable cached windows; explicit Suggest/More; empty-cache reuse | P2 source, fixture and browser evidence in P2/STATUS.md; final phase checks recorded at commit. |
| Caps pause auto-suggest clearly; uncertain calls never silently retried; hover makes no calls | P2 source, fixture and browser evidence in P2/STATUS.md; final phase checks recorded at commit. |
| Weave inserts fits chronologically; only deliberate/conflict fork; shared prefix preserved | P2 source, fixture and browser evidence in P2/STATUS.md; final phase checks recorded at commit. |
| Spark checks every later event; flags only; Keep and explicit metered Regenerate | P2 source, fixture and browser evidence in P2/STATUS.md; final phase checks recorded at commit. |
| Unwoven suggestions persist and remain discoverable by window | P2 source, fixture and browser evidence in P2/STATUS.md; final phase checks recorded at commit. |
| Per-user/session generated-world/window/history counts; no stored-suggestion cap | P2 durable counter tests cover completed batches and per-session/event generated-world deduplication. |
| Rail year/title, collapsible eras, cause links, flags, per-event What if instead | P3 source, Node22 tests and rendered evidence in P3/STATUS.md. |
| History tabs, >4 dropdown; below-rail window suggestions/verdict/actions; no duplicate breadcrumb | P3 seven-history dropdown and suggestions; P4 removes active fallback to tree/breadcrumb presentation. |
| Surface gold events through date, latest highlighted; cyan current-window suggestions | P3 source, Node22 tests and rendered evidence in P3/STATUS.md. |
| Bottom globe time bar with event/era ticks, pointer and arrow stepping; only visible slider | P3 source, Node22 tests and rendered evidence in P3/STATUS.md. |
| Wheel/pinch zoom; +/- in View options; event sheet as-of header and event details | P3 source, Node22 tests and rendered evidence in P3/STATUS.md. |
| Orbit optional only for >=2 histories; sibling Earths at same date; one history skips Orbit | P4 executable projection/zoom tests, mounted View options control and browser zoom recording. |
| Atlas gold/dim history spines at divergence/fork, real trunk, other-question count chips | P4 history-spine geometry/selection tests and rendered desktop/phone evidence. |
| Suggestions only current history/window; no other unwoven worlds; routed wiring removed | P4 exact-window/history filtering tests; active history scene uses independent records and dedicated spine geometry, with no legacy routed edges. |
| Gold=current history/user, cyan=suggestions, parchment=authored | P3 gold/cyan browser evidence; authored/history-spine styling verified in P4. |
| Both named stories at 1440x900 and 375px, every phase | Captures in P1, P2, P3 and p4 directories. P1/P2 UI is explicitly transitional. |
| P3 scrub recording and P4 zoom-out recording | P3 `date-scrub-phone.webm`; p4 zoom recording with input/frame receipt. |
| Node22 tests, Gitleaks, dated HACKATHON log, paths/call-cost/remaining-work receipt per phase | P1/P2/P3 pushed with passing CI. P4 local verification and capture hashes are recorded in `p4/capture-receipt.json`; phase STATUS files record model-call costs. |
| Fresh questions and explicit media work end to end with the new model | P4 native question/API/media/restart tests; empty H1, canonical URL reread, explicit scene/cutout revision identity and shared caps. Keyless replay offers Meta setup before fresh generation. |

Fixture tests establish deterministic parsing, actions and invariants. They do not
establish the factual quality of new live model suggestions. No live paid model calls
or cloud deployments are part of the validation procedure.
