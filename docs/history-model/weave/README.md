# Batch weave verification

The saved question “What if Buddhism Spread to Arabia” started with zero canonical events and six cached suggestions from 1000 BCE–1 BCE. The six source records were woven atomically with no new model calls. Their saved scenes remain attached, and the resulting causal chain includes Jeddah arrival → sailors’ shrine. See the [woven-chain receipt](woven-chain.json) and [six-event plan receipt](verified-plan.json).

## Batch preview and saved chain

The checked preview uses the same projection as commit. It links the Jeddah arrival to the later shrine and offers optional art and healing consolidations across different towns; both default to Keep separate. [1440×900 preview](batch-preview-1440.png) · [375×812 preview](batch-preview-375.png).

The saved result retains all six scenes: [1440px](woven-six-1440.png) · [375px](woven-six-375.png). The [comparison receipt](call-comparison.json) records the offline six-source comparison with the previous service at `f223b59`. That comparison excludes suggestion generation and image preparation. Three development Wonder calls cost $0.234952 total: an initial plan, a reasoning-starved attempt, and the successful minimal-reasoning retry. The corrected six-source batch check cost $0.031432.

## Suggestion deck

The six list checkboxes are independent of the review deck. Native desktop keyboard and 375px pointer-drag checks covered Keep, Pass, Undo, Keep all fits including passed items, reduced motion without a flight, and Cancel without reopening auto-suggestions. On November 4, the repaired Chrome connection also enabled the native browser touch-input checks described below.

- [1440px keyboard deck](deck-keys-1440.png)
- [375px pointer-drag deck](deck-drag-375.png)
- [375px touch deck](deck-touch-375.jpg) · [Passed state](deck-touch-passed-375.jpg) · [Touch-triggered preview](deck-touch-preview-375.jpg)
- [Desktop tray](tray-1440.png) · [375px tray](tray-375.png)

## Fresh auto-weave and pending events

One explicit More request generated three new suggestions, checked and committed them as pending, and made three scenes. The three events are later than the six saved events, so this run correctly needed zero Spark ripple calls. Total measured cost was **$0.388439**: one Wonder suggestion call ($0.060652), three Spark topic-policy checks ($0.009919 total), one Wonder batch check ($0.017868), and three images ($0.30 total).

The saved history now has nine events total, with all three new events pending and all nine scenes complete. A reload preserved the pending flags and batch metadata. See the [pending-batch receipt](pending-batch.json), [1440px view](pending-auto-1440.png), and [375px view](pending-auto-375.png). The updated phone capture places the drawer above the time bar without occlusion.

## Native pending-event follow-up

Removing middle Aden (44 BCE) left two events pending and eight canonical. It restored one source suggestion, retaining its ready 1600px scene and inspiration link to Hegra (75 BCE). This action made no model calls; the spend ledger remained at $44.57822830208354 across 1,247 entries.

Navigating to 1 CE finalized the two remaining pending events. Returning to the cached −1 BCE window showed zero pending events and no removal tags, while the source suggestion remained available. At verification, Auto-weave was off and Auto-suggest was on. Keep all for pending events is covered by API and unit checks only; it was not clicked in the native session.

The 375px drawer sits at z-index 16 above the time bar at z-index 12.

## Touch verification — November 4

Chrome accepted native `Input.dispatchTouchEvent` at a 375×812 mobile viewport with touch emulation enabled. Touch taps opened the timeline and deck; right swipe kept Aden and opened its checked preview; left swipe moved it to Passed; Undo restored it. Short, cancelled and vertical gestures left the card unreviewed. Keep all fits recovered the passed-only set and opened the same preview; explicit Review reused it, and Cancel did not reopen it. Returning to List preserved its independent checkbox selection. These are browser-emulated touch results, not a physical phone test.

This uncovered and corrected a UI gate that disabled Keep all fits when all fitting cards had been passed. Both List and Deck now allow that recovery, and an explicit Keep all request opens review even after an earlier empty deck. The passed-only message now correctly states that the suggestions remain available.

One new Wonder batch-plan call checked the single restored Aden suggestion against the eight saved events: **$0.012156**. Reopening and recovering the same selection reused the plan. No suggestion generation, images, Spark ripple or weave commit was requested. The saved history remains eight permanent events and one unwoven suggestion; the ledger is $44.590384302083535. The full Node 22 suite passed 835/835; focused deck/timeline checks cover the passed-only regression.
