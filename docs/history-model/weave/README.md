# Batch weave verification

The test question is “What if Buddhism Spread to Arabia”, starting with zero events and six cached suggestions in 1,000 BCE–1 BCE. The source fixture is [`history-arabia-weave-batch.json`](../../../test/fixtures/history-arabia-weave-batch.json).

## Checked batch preview

The live plan links the Jeddah arrival to the later sailors' shrine and connects all six events chronologically. It proposes optional art and healing-network consolidations across Hegra and Mecca. Both default to Keep separate. Accepting the healing merge changes the preview to five events; Keep separate restores six. Those controls make no network requests or history changes.

- [1440×900 preview](batch-preview-1440.png)
- [375×812 preview](batch-preview-375.png)
- [Sanitized live plan receipt](verified-plan.json)

The preview and commit use the same pure projection function. Fixture tests cover merge provenance, exclusions, conflict rejection, valid earlier causes, and stale or invalid plans. A restarted service reuses a durably committed batch receipt rather than inserting the events or running Spark again.

## Model calls

These comparisons start from six cached suggestions; initial suggestion generation and image preparation are excluded. The later-event case adds two synthetic events at years 20 and 40. Counts come from an offline run against the previous service at `f223b59` and the checked batch service; see [the comparison receipt](call-comparison.json).

| Case | Six previous individual weaves | One checked batch |
| --- | --- | --- |
| Empty history | 5 Spark compatibility rechecks; no ripple calls | 1 Wonder check; no Spark ripple call |
| Two existing later events | 5 Spark compatibility rechecks + 12 Spark ripple calls | 1 Wonder check + 1 combined Spark ripple call |

An unchanged review reuses its plan. An explicit retry after an uncertain paid attempt can add a call; no automatic retry runs. Development verification used three Wonder calls ($0.234952 total): an initial valid plan, a refined-prompt attempt that exhausted its reasoning budget, and the successful receipt-bound retry after setting minimal reasoning. The corrected six-source check cost $0.031432.

Further tray, pending-event and deck verification artifacts are added with their corresponding implementation items.
