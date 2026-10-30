# Source uncertainty correction — 2026-10-30 UTC

The current live source-preservation proof is run `1793334705465` (`uncertainty-5`), described below. The earlier `final-4` run (`1793332668066`) contains a factual-grounding defect: branch `b1` turned the source's qualified account of Aristarchus's studies into an unqualified statement. The pipeline returned `ok` despite this defect. The original files and recording are retained as historical evidence of that run.

## Implemented prevention and local validation

Fresh baselines must now copy exactly one complete retrieved source unit, with exactly one matching source ID. Extraction preserves complete HTML paragraphs, with a source-specific paired-`br` fallback for MacTutor; oversized units are omitted instead of clipped. New extractions carry `excerptFormat: complete-source-units-v1`. Proposal filtering, saved-run selection, the UI, and Markdown export enforce that boundary. Paraphrases and substrings cannot receive a source link merely because their ID is valid. Legacy fresh excerpts fail closed; curated replay evidence is unchanged.

This checks fidelity to the retrieved text, including its uncertainty, attribution, negation, ranges, and disagreement. It does not prove source quality, historical truth, or counterfactual causality. The local fixture suite passed **214/214 tests under the CI-pinned Node 22 runtime** (`out/uncertainty-tests.txt`). Fixtures cover qualifier removal, sentence fragments, cross-sentence context, clipping, legacy evidence, UI, and export behavior; tests made no live provider calls.

## Current live proof — uncertainty-5

The authorized new run completed at `2026-10-30T04:32:44.128Z` in **58.666 seconds**, recording **US$0.2507162** in additional shared-ledger estimates. MacTutor was fetched; the registered University of Chicago source timed out. Three branches, a Muse Image scene, and SAM 3.1 mask/cutout were saved; no 3D provider was called. The ending ledger total was **US$4.7148053**; all five attempts used **US$0.95696825** of the authorized US$10 additional allowance. Estimates are not provider invoices.

`selectFreshEvidence` accepts the saved run. Each of its three baseline claims exactly equals a complete unit from its linked source snapshot. Branch `b4` quotes the Vitruvius/sundial unit; branches `b1` and `b3` quote the mathematician/astronomer unit. The fetched source also contains the qualified study paragraph, but **none of the selected live baselines quotes it**. This run demonstrates whole-unit fidelity in live output; the specific dropped-hedge regression is demonstrated by offline fixtures and the separately labeled manual correction below.

Saved proof is under ignored `out/1793334705465/`; its report is `out/recordings/fresh-run-uncertainty-5.jsonl`. `verified-brief.md` was exported locally from the accepted envelope using the existing `freshLessonMarkdown` function, selecting `b4` and comparing `b1`. `source-preservation-check.json` records exact-unit checks for all three branches, selector acceptance, export provenance, and preservation of the old correction/capture digests. “Verified” here means source-text fidelity checks passed, not that historical facts or imagined outcomes were independently verified.

The current local video is `video/source-uncertainty-2026-10-30/fresh-source-uncertainty.mp4`: **80.333 s**, 2,884,211 bytes, H.264, 1280×720, 30 fps, no audio. It contains 70 s of continuous real-time generation, followed by 10.333 s of separately captured review labeled “Post-run source review - same run.” It is an edited composite, not an entirely continuous recording. The edit removes 88.846 s of idle full-screen cutout footage; original raw frames and timing records remain intact. Edit provenance is `out/source-uncertainty-edit-20261030/edit-provenance.json`. Full decoding and four encoded-frame visual inspections passed; the output hash was checked against the provenance record. No capture has been uploaded or submitted, and PR #7 is to remain draft.

| Current proof artifact | SHA-256 |
|---|---|
| `branch.json` | `D6C3F041598355F874DF9FA273B430AC2E98BCD350E6EDF1E56A3817F933741C` |
| `trace.json` | `86FE974790FE2D474BD1F9405E3D7646E84A0772077BFA69AB8FE400B7F62BC8` |
| `hero.png` | `E1743D0320048202D8E678783EB3B8C173840B5CFD48DF78A28708D46BDE8E8D` |
| `mask.png` | `6CCCFB302BA6280E14B3C29DDA0D30FEBAFAC4A668B8E6F1A558B73446C69B4F` |
| `cutout.png` | `AC276F4E89E1D38FE71C71F81BDD49E363605241E009923208141E1DA7DA9DE9` |
| `verified-brief.md` | `0346298339ABFDE55C6572EBB247384766E8AD4912E0EF325840BA7572ABDD46` |
| `fresh-run-uncertainty-5.jsonl` | `65D6E8F51051D43A5C3263363BF1F6C45A485DE21B87AF5070F46FF05A6B71C9` |
| `fresh-source-uncertainty.mp4` | `01B070B6C89A59DA928B65F1E3A8C17F24EEBCF2F3882ED5EB371D0A70F93D1B` |

## Corrected source context

The corrected baseline uses this entire first context block verbatim from the MacTutor excerpt stored in the original `branch.json`:

> Aristarchus was a student of Strato of Lampsacus, who was head of Aristotle 's Lyceum. However, it is not thought that Aristarchus studied with Strato in Athens but rather that he studied with him in Alexandria. Strato became head of the Lyceum at Alexandria in 287 BC and it is thought that Aristarchus studied with him there starting his studies shortly after that date.

The operative corrected claim is: “Strato became head of the Lyceum at Alexandria in 287 BC and it is thought that Aristarchus studied with him there starting his studies shortly after that date.” Its qualifier is part of the claim, not an optional disclaimer. The larger context block also retains the source's Athens/Alexandria distinction.

Source: [MacTutor History of Mathematics, University of St Andrews — Aristarchus of Samos](https://mathshistory.st-andrews.ac.uk/Biographies/Aristarchus/). This manual correction uses the snapshot fetched at `2026-10-30T03:57:52.774Z`; no new fetch was used for it. The full stored excerpt remains in the derivative. Its historical extraction is not retroactively marked as the newer complete-source-unit format, and the original HTML paragraph boundary is not independently reconstructed. This is a manual correction of legacy output, not a claim that the derivative passes the new generation validator or that the historical account is independently verified.

## Local derivative and provenance

The ignored directory `out/corrections/1793332668066/source-uncertainty-2026-10-30/` contains:

- `corrected-brief.md`: a readable corrected scenario brief for `b1`, with its counterfactual assumption and causal steps explicitly hypothetical.
- `corrected-branch.json`: an operator-correction envelope containing only the corrected `b1` scenario, its original source snapshot, and the before/after claim. Its status is `operator-corrected-legacy-unverified`; it is not a replacement pipeline result. Model rankings and the old review note are omitted rather than represented as a review of the correction.
- `preservation-before.json` and `preservation-check.json`: SHA-256 inventory and verification covering the original run directory, final attempt report, and final capture directory, including the video, screenshot, timing record, and capture frames.
- `derivative-digests.json`: SHA-256 values for the new correction files.

No provider call, source retrieval, image regeneration, 3D work, or additional Meta spend was needed for this correction. The derivative does not reuse the original branch/evidence binding as a valid binding for changed text. It records the original digests as provenance only. The existing evaluation's final artifact digests continue to identify the unchanged historical files.

The historical recording still shows the defective claim and must be described accordingly. This manual correction does not constitute submission or acceptance of that recording; PR #7 is to remain draft. The implementation and new live run above are separate evidence.

## Preservation verification

All 761 inventoried original files had identical sizes and SHA-256 hashes before and after correction preparation. The original branch, trace, and final report hashes match the [previous evaluation](2026-10-29-fresh-evidence.md#final-artifact-digests). Additional final-capture identifiers are:

| Historical capture artifact | SHA-256 |
|---|---|
| `fresh-evidence-live.mp4` | `B119CC080E34FEF87A1D76A0444CB683EFEB88343A821B40A408C13147486B2B` |
| `final-evidence.jpg` | `ABBDF7852454021F037726ACF06E93D2F04D64794EC73DC88CA6C7B7A20FA4A2` |
