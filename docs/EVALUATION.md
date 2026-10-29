# Fresh-run prompt evaluation: bounded protocol

This script measures bounded fresh-run pipeline behavior. It does not evaluate creator value, source quality, or learning. It can make paid Meta calls only with `--live`, an explicit absolute `--cap-usd`, the one-time scoped allowance checkpoint, sufficient remaining limits, and a configured key. Default invocation is read-only dry-run. It never invokes 3D.

## Read-only preflight

```bash
node scripts/evaluate-live.js
# Optional: read a local .env into the process; this still stays dry-run.
node --env-file-if-exists=.env scripts/evaluate-live.js --dry-run
```

The JSON output lists the exact four prompts, the planned 13 logical Meta POST calls per prompt (52 across a complete batch), current ledger/checkpoint/daily headroom, whether a credential exists (never its value), and the historical cost reference. These are logical calls in the current flow; transport-level retries can add provider attempts. The preflight does not create files or acquire a ledger lock; it blocks if a ledger lock is present. `META_SPEND_CAP_USD`, unresolved reservations, and an uncertain ledger remain authoritative. Evaluation daily spend is clamped to the lower of configured `DEMO_DAILY_CAP_USD` and US$3. The evaluator rejects non-Meta `META_API_BASE_URL` overrides and pins the approved Meta endpoint. `--cap-usd` can only tighten the environment and selected checkpoint ceilings.

At the initial preflight, the existing demo checkpoint left about $0.2824 available against the $2.6447512 ledger total, below the four-run historical reference estimate of $1.1434272. The $0.2858568 per-run reference is one observation, not a forecast or guaranteed upper bound. The operator authorized a separate, one-time US$2 allowance; its checkpoint was snapshotted from the then-current ledger. The existing demo checkpoint and spend ledger were not reset. The configured Meta ceiling and daily ceiling (maximum $3 for this evaluator) remained active.

## Execution gate

The operator initialized the separately authorized allowance once, then executed the four-prompt batch once after the scoped preflight was ready. That one-use scope is consumed: the fixed report exists, so the evaluator blocks repeating it. Do not rerun or reinitialize this scope. Initialization refused active locks, uncertainty, and reservations, created only the scoped checkpoint, and left `out/spend.json` and `out/demo-task-budget.json` in place. Every prompt was attempted once, sequentially; the batch stopped on the first thrown run failure (none occurred). Existing bounded provider behavior remained: branch proposal/review JSON parsing has its existing second attempt, and SAM may make its one existing noun fallback. The shared client reserved each call against total and UTC daily limits; recorded costs are estimates, not provider invoices.

The four prompts and model routing are pinned to the curated science/geography/technology evaluation set. The strict war-and-politics policy must remain enabled:

1. What if the Library of Alexandria never burned?
2. What if the Bering land bridge never flooded?
3. What if the Sahara had stayed green?
4. What if Antikythera-style mechanisms had scaled into industry?

## Completed live evaluation — 2026-10-29

The authorized four-prompt run completed all four attempts with no thrown run failures. Three runs produced segmented 2D results; Antikythera-style mechanisms produced an explicit 2D-only result, with no mask or cutout file. No 3D provider was called. Source quality was not reviewed for these generated runs; the curated replay's baseline sources do not transfer to fresh runs. No user feedback or learning outcomes were measured.

| Prompt | First safe branch | Scene | Total | Recorded Meta cost | Result |
|---|---:|---:|---:|---:|---|
| Library of Alexandria never burned | 57.901 s | 81.039 s | 89.136 s | $0.25013050 | segmented |
| Bering land bridge never flooded | 66.022 s | 112.464 s | 118.894 s | $0.28179490 | segmented |
| Sahara had stayed green | 60.532 s | 87.308 s | 94.532 s | $0.27552015 | segmented |
| Antikythera-style mechanisms scaled into industry | 52.260 s | 74.870 s | 85.458 s | $0.30564030 | 2D-only; no mask/cutout |
| **Total / mean** | **59.179 s mean** | **88.920 s mean** | **97.005 s mean** | **$1.11308585** | **3 segmented, 1 2D-only** |

The per-run image charge recorded in this evaluation was $0.10; older benchmark notes showing $0.01 reflect an earlier pricing configuration. SAM was recorded at $0.05 per call; the final run made the existing second bounded SAM attempt before ending 2D-only. These are shared-client cost estimates, not provider invoices. Separately generated replay 3D model costs remain unknown.

At the start, the ledger total was $2.64475120 and the scoped checkpoint allowed an additional $2.00. At completion, the ledger was $3.75783705, an increase of $1.11308585; reservations were empty and no uncertainty flag was set. The separate checkpoint remained anchored at the starting ledger plus its one-time allowance. The pre-existing demo checkpoint remained at its original $0.92717920 starting total and $2.00 allowance.

These are single observations from one sequential run on one day, not a controlled latency or quality benchmark. Provider load, output length, branch retries, image and mask processing affect timings and cost. The results show pipeline completion and one explicit 2D fallback; they do not establish factual accuracy, causality, source quality, creator usefulness, or product impact. The sanitized run record, artifact hashes, and report-input hash are in [the dated evidence summary](evaluation/2026-10-29-live.md). Raw traces and generated artifacts remain in ignored local output and are not copied into this summary.

## Captured measures and evidence

For each prompt, the evaluator records latency to the first nonempty policy-cleared branch event, latency to the generated scene event, and total elapsed time through run completion (including SAM segmentation). Blocked or failed runs can have null stage latencies. The existing harness writes its branch, trace, image, mask/cutout where available, and failure/2D-only evidence under a unique `out/<run-id>/` directory; the evaluation report points to those files and retains the emitted trace. It refuses to overwrite an existing run directory.

The reported Meta cost is the shared-client ledger amount, which can include configured estimates and is not a provider invoice. No 3D provider is called; 3D cost is recorded as unknown/null. Generated source quality is explicitly unreviewed. Curated replay evidence links support historical/scientific baseline facts and separately mark the imagined branch and uncertainty; the fresh-run evaluator does not synthesize or attach that curated review.

The live report is written once to `out/evaluations/fresh-live-evaluation.jsonl`; an existing report blocks a repeat. Dry-run reports only to stdout. This protocol evaluates fresh-run pipeline behavior, not creator value or market demand. A proposed creator usability protocol is in [USER_VALIDATION.md](USER_VALIDATION.md); no feedback has been collected.
