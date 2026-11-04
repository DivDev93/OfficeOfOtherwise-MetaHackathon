# Chronicle verification — November 4, 2026

The separate bug-fix commit is `6d0b6c8`. The row action could be clipped below the old rail; when reached, the legacy compatibility path rejected the saved Aden suggestion with HTTP 409 while the sheet still displayed Ready to explore. Row Weave now uses the existing checked batch flow, keeps progress and errors visible, and selects the newly inserted event/date on success.

The Chronicle is a frontend replacement. History data, server routes and API contracts are unchanged.

| View | 1440×900 | 375×812 |
| --- | --- | --- |
| Arabia: 8 events, 1 suggestion | [Rail](rail-1440.png) | [Rail](rail-375.png) |
| Deck opened from the inline possibilities row | [Deck](deck-1440.png) | [Deck](deck-375.png) |
| Timeline after weaving Aden at 44 BCE | [Woven](woven-1440.png) | [Woven](woven-375.png) |

Native weave verification uses a local copy of the saved Arabia history and the normal configured API with the existing spend ledger. Resetting that disposable verification copy allows both viewport checks without deleting or restoring the user's saved work. The normal app at port 4313 retains its eight events and one unwoven Aden suggestion.

The local recording command remains documented in [the final-day README](../README.md#start-the-app-for-recording).

## Checks

- Node 22.23.3: **851/851 tests passed**, zero failures. Local log: `out/history-model-review/chronicle-final-tests-20261104.log`.
- Native Chrome at 1440×900 and 375×812: the possibilities row opens the scoped Deck; Keep and native right-swipe reach the existing checked preview; committing inserts Aden, selects 44 BCE and closes review. The phone returns to the Chronicle. Native touch scrolling, Close/History, preview Cancel → Deck → List → single-row Weave all passed on the final source.
- The post-weave screenshots are unmodified native screencast frames. The new row is highlighted during the two-second feedback interval and returns to its ordinary selected appearance afterward. The feedback clock starts after the synchronous globe render, so the saving overlay does not consume that interval.
- The final single-row List Weave check also verified the stationary globe pulse: Aden's measured pin width changed between 18.68px and 21.67px while highlighted, then settled at 17.92px after 2.01 seconds. The native measurements are in [weave-feedback.json](weave-feedback.json). Opening review from List no longer throws a DOM reparenting exception before the API request.
- Row clicks and the time bar keep the current-date marker in sync. List review remains an overlay, including after cancel/review cycles. Settings remain accessible through the footer menu.

After the verification weave the Chronicle contains **9 total events**. The time bar and sheet correctly show **8 events as of 44 BCE** because the existing Taif event at 22 BCE is later.

This is Chrome touch emulation, not a physical-device test. Verification did not change the normal app's saved history or replace the configured key/spend ledger. No deployment or submission was performed.

## Follow-up: clear Weave confirmation and browser-session cache

A second browser could receive another session's cached checked plan, then receive `batch_plan_not_found` when confirming Weave. Checked-plan cache keys now include the user/session; store reservations still enforce ownership and history revision checks. A rejected unavailable plan is cleared from the client preview and offers Retry check inline.

Review now fits its contents with a prominent gold Weave action beside the event. Cancelling returns to a visible Weave kept action in the deck header rather than hiding it in the overflow menu. Card actions remain Not now and Keep.

The in-app browser check began at 245 BCE with eight canonical events and the saved Aden possibility. Keep, Cancel, Weave kept and confirmation succeeded in the disposable history copy: HTTP 200, nine events, Aden selected at 44 BCE. The original history remains at eight events with its suggestion available. The normal recording server was restarted with its configured key and existing spend ledger.

The final Node 22 suite passed **853/853**, including cross-session ownership and unavailable-plan recovery checks. Updated confirmation screenshots: [985×822](weave-review-985.png), [375×812](weave-review-375.png).
