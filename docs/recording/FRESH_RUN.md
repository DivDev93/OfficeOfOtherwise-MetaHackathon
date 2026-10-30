# Fresh-run recording procedure

This procedure documents the browser-recordable fresh run for the Alexandria scenario. Each run uses the shared Meta spend ledger and a separate one-use child cap of up to US$1.00 within the approved cumulative allowance. Prompt policy and branch policy stay enabled, model routing is pinned to the Meta stack, fresh evidence is read only from the fixed approved source registry, and 3D is disabled.

## Offline preflight

Run the script with no options for a read-only readiness report:

```powershell
node --env-file-if-exists=.env scripts/record-fresh-run.js
```

The dry run makes no provider call, does not initialize a checkpoint, and prints only whether a Meta credential is present. A missing attempt checkpoint blocks live calls until a one-use child cap is initialized under the approved cumulative ceiling.

## Initialize an attempt cap within the approved cumulative allowance

After the operator authorizes a cumulative allowance for the batch, initialize a separate one-use checkpoint for each attempt. Each child cap can be at most US$1.00 and does not require a new per-attempt authorization when it stays within the approved cumulative ceiling:

```powershell
node --env-file-if-exists=.env scripts/record-fresh-run.js --init-allowance --allowance-usd 1
```

Initialization snapshots the current `out/spend.json` total, checks for ledger locks, uncertainty, and unresolved reservations, and writes only `out/evaluations/fresh-recording.json`. It never resets or edits `out/demo-task-budget.json` or `out/spend.json`. The checkpoint and eventual report are one-use and cannot be replaced by this script.

If an earlier attempt has a report, preserve it and choose a new safe attempt name. Named attempts receive distinct checkpoint and report paths. Their default cumulative ceiling is US$10 above the ledger total recorded in the original run's plan; `--overall-cap-usd` may lower that ceiling but cannot raise it:

```powershell
node --env-file-if-exists=.env scripts/record-fresh-run.js --init-allowance --attempt retry-2 --allowance-usd 1 --overall-cap-usd 13.75783705
```

The ceiling above is illustrative; use the amount derived from the original report's baseline. The named checkpoint snapshots the current shared ledger, and each later named attempt must remain below the same original baseline plus US$10.

## Start local recording mode within the approved allowance

Use the absolute ceiling printed by the initialization step. The command refuses ceilings above the one-use child cap or the current configured Meta cap. It binds only to `127.0.0.1` on an available port and requires the existing private `DEMO_ACCESS_CODE` for the UI. Keep the access code in `.env`; do not paste it into the terminal command or share it in a recording.

```powershell
node --env-file-if-exists=.env scripts/record-fresh-run.js --serve --cap-usd <absolute-ceiling>
```

For a named attempt, pass the same `--attempt` and optionally repeat its tighter `--overall-cap-usd`:

```powershell
node --env-file-if-exists=.env scripts/record-fresh-run.js --serve --attempt retry-2 --cap-usd <absolute-ceiling> --overall-cap-usd <workflow-ceiling>
```

Open the printed local URL, enter the fixed prompt shown in the readiness report, and submit once. The server rejects every other prompt and refuses a second accepted attempt before it reaches the provider runner. The default report is `out/recordings/fresh-run.jsonl`; named attempts use `out/recordings/fresh-run-<attempt>.jsonl`. Generated run artifacts remain under ignored `out/`. Stop the local server with Ctrl+C after the recording.

## Current source-preservation proof — uncertainty-5

The latest actual run is `1793334705465`, completed at `2026-10-30T04:32:44.128Z` in 58.666 s. Report: `out/recordings/fresh-run-uncertainty-5.jsonl`; artifacts: `out/1793334705465/`. It recorded US$0.2507162 additional Meta ledger estimates, bringing all five attempts to US$0.95696825 of the authorized US$10 additional allowance and the shared ledger to US$4.7148053. It saved three branches, a scene image, and SAM mask/cutout, with no 3D call. MacTutor was retrieved; the University of Chicago source timed out.

The saved selector accepts this run, and all three baselines exactly match complete retrieved source units. None selects the particular “it is thought” study paragraph; offline fixtures cover that regression. The existing exporter produced `out/1793334705465/verified-brief.md` from the accepted envelope. See the [implementation, validation, and artifact hashes](../evaluation/2026-10-30-source-uncertainty.md).

The verified local composite is `video/source-uncertainty-2026-10-30/fresh-source-uncertainty.mp4`: 80.333 s, 2,884,211 bytes, H.264 at 1280×720 and 30 fps, with no audio. Its first 70 s show continuous real-time generation; the following 10.333 s are separately captured review labeled “Post-run source review - same run.” It removes 88.846 s of idle full-screen cutout footage, preserving raw frames and timing files. This is an edited composite, not one continuous recording. Full decode and four encoded-frame inspections passed. SHA-256: `01B070B6C89A59DA928B65F1E3A8C17F24EEBCF2F3882ED5EB371D0A70F93D1B`. Edit provenance is `out/source-uncertainty-edit-20261030/edit-provenance.json`. The video remains local and unsubmitted; PR #7 is to remain draft.

## Historical fresh recording — 2026-10-29 ET (ledger timestamps: 2026-10-30 UTC)

Four isolated attempts were preserved, each with its own checkpoint/report. The original workflow baseline was US$3.75783705; the authorized cumulative ceiling was US$13.75783705 (US$10 additional). Total new Meta ledger spend across all four attempts was US$0.70625205. The ending shared ledger total was US$4.46408910, with no reservations and no uncertainty flag. The original attempt outputs were not overwritten.

| Attempt | Result | Run time | Meta spend | Capture |
| --- | --- | ---: | ---: | --- |
| Initial | `evidence_unavailable`; source retrieval timed out before branch generation | 9.806 s | US$0.00228250 | `video/fresh-evidence-2026-10-29/fresh-run-source-timeout-no-generation.mp4`, 44.200 s of captured UI, labeled “no generation” |
| `retry-2` | `ok` | 100.544 s | US$0.31164095 | Capture had a long gap and did not show the final evidence state; no final video was accepted |
| `final-3` | `ungrounded` after a truncated response | 76.738 s | US$0.12481700 | No accepted final video |
| `final-4` | `ok` | 73.146 s | US$0.26751160 | `video/fresh-evidence-2026-10-29-final-4/fresh-evidence-live.mp4`, 90.466 s encoded duration |

The final capture's raw `timing.json` duration is 90.477 s, including page setup and post-run UI time; the run report measures 73.146 s for generation. The MP4 is H.264, 1280×720 at 30 fps, `yuv420p`, with no audio, a “Fresh Meta generation - real time - no replay” label, and an elapsed clock. Its duration was checked with ffprobe and the video decoded fully. Frames at the start, policy-cleared proposal/review stage, and final evidence panel were visually inspected.

The final run used run ID `1793332668066`. Its fresh Alexandria evidence envelope is bound to the saved branch digest and records one fetched excerpt; the other registered source timed out. Manual text-to-excerpt review found a factual-grounding defect: branch b1 drops the source's “it is thought” qualifier. The pipeline's recorded `ok` status does not establish claim accuracy. This review does not independently validate the underlying historical claim or source completeness; see the [fresh-evidence evaluation](../evaluation/2026-10-29-fresh-evidence.md). Counterfactual claims remain hypothetical, and the run made no 3D call. Attempt records are `out/recordings/fresh-run.jsonl`, `out/recordings/fresh-run-retry-2.jsonl`, `out/recordings/fresh-run-final-3.jsonl`, and `out/recordings/fresh-run-final-4.jsonl`; the corresponding one-use checkpoints are under `out/evaluations/`.

### Correction after recording — 2026-10-30 UTC

The MP4 and captured UI show the original, uncorrected output. Preserve that recording, its frames, and all original run/report files. The [operator-correction record](../evaluation/2026-10-30-source-uncertainty.md) identifies a separate corrected brief and derivative artifact that retain the stored source's qualifiers and context. They are manual derivatives of the saved snapshot, with no new model call or retrieval, and must not be presented as content generated during this video. This correction does not constitute submission or acceptance of the recording; PR #7 is to remain draft.

## Evidence and limits

The report records the single top-level run, actual run events, fresh evidence returned by the pipeline, recorded shared-ledger cost, latency, and generated artifact directory. Shared clients may perform their existing bounded retries or SAM prompt fallback under the same ledger cap. Cost is a ledger estimate, not a provider invoice. The historical US$0.2858568 figure is a planning reference and not a guaranteed upper bound. Any 2D-only result remains 2D-only; this run does not call a 3D provider. No provider calls occur during preparation or preflight.
