# Fresh-evidence run evaluation — 2026-10-29 ET

The four sequential attempts were captured on the evening of October 29 in Toronto; their ledger timestamps are October 30 UTC. This is a manual review of saved artifacts and run ledgers, not an accuracy benchmark, peer review, user study, or evidence of learning outcomes. Generated scenarios and images remain counterfactual illustrations.

## Attempts and spend

| Attempt | Saved report | Result | Elapsed | Recorded Meta estimate |
|---|---|---|---:|---:|
| 1 | `out/recordings/fresh-run.jsonl` | `evidence_unavailable`; the Alexandria source fetch timed out before proposal or image generation | 9.806 s | $0.00228250 |
| 2 | `out/recordings/fresh-run-retry-2.jsonl` | `ok`; fresh-evidence run succeeded, but the screen-capture gap made this unsuitable as the clean final recording | 100.544 s | $0.31164095 |
| 3 | `out/recordings/fresh-run-final-3.jsonl` | `ungrounded`; proposal output reached 6,000 output tokens (5,126 reasoning tokens in the captured response), while the parser salvaged an inner object from an incomplete outer array and accepted it as parseable | 76.738 s | $0.12481700 |
| 4 | `out/recordings/fresh-run-final-4.jsonl` | `ok`; proposal/review shape validation passed, image and cutout were saved, no 3D call | 73.146 s | $0.26751160 |
| **Total** |  |  |  | **$0.70625205** |

The third attempt exposed the truncation case. The follow-up change validates the top-level proposal/review shapes, rejects explicitly incomplete responses, retries once, and asks fresh-evidence proposals for low reasoning with a 9,000-token output ceiling. Attempt 4 completed the proposal on its first attempt. These four latency observations are not a controlled benchmark.

The spend ledger moved from $3.75783705 to $4.46408910, a $0.70625205 increase, within the authorized $10 additional allowance. No 3D work was run. The final checkpoint reports zero reservations and no spend-uncertainty flag. Amounts are shared-client ledger estimates, not provider invoices.

## Manual source-to-claim review

The final run retrieved one source excerpt from [MacTutor History of Mathematics, University of St Andrews — Aristarchus of Samos](https://mathshistory.st-andrews.ac.uk/Biographies/Aristarchus/). Its provenance says `bounded-live-fetch` and `retrieved_excerpt`; retrieval is not independent verification. The second registered Alexandria source timed out. There was no general web search or second source for corroboration.

| Saved branch | Baseline claim vs. retrieved excerpt | Counterfactual boundary |
|---|---|---|
| `b1` — Heliocentric Astronomy Taught Earlier | The excerpt says Aristarchus is *thought* to have studied with Strato in Alexandria shortly after 287 BC. The branch's baseline sentence states this directly, so it slightly overstates the source's uncertainty. | Continuous preservation, teaching, and earlier acceptance are scenario hypotheses; the branch labels accelerated acceptance as unverified and says the source cannot establish rapid acceptance. |
| `b2` — Planetary Distances Measured Systematically | The excerpt supports the statement that Greeks called him “Aristarchus the mathematician” while historians often treated him primarily as an astronomer. | Transmission to Rhodes, standardized observations, and improved distances are hypothesized; the branch notes that the excerpt does not describe those methods or their transmission. |
| `b3` — Alexandrian Mathematics Curriculum Endures | The excerpt supports the statement that historians gave Aristarchus too little attention partly because he was seen as an astronomer. | The library's holdings, teaching system, and later discoveries are not established by the excerpt; the branch identifies those gaps and frames outcomes as uncertain. |

No obvious unsupported factual baseline claim appeared in the three saved branches beyond the noted hedge-strengthening in `b1`. This is a text-to-excerpt consistency check only; it does not establish the underlying historical claims, causal plausibility, or source completeness. The other branches from the proposal were not present in the saved final artifact.

## Final artifact digests

SHA-256 values identify the final attempt's saved outputs. The artifacts and complete reports are in ignored local `out/` directories; this document does not include raw model output or absolute local paths.

| Artifact | SHA-256 |
|---|---|
| `branch.json` | `8A73F1249BC61CB30659881F7082FDD5F69E8EA01E2B195DE56BA2AB339ADA27` |
| `trace.json` | `FF2EDC08EE6D50614FEB37133FBDB302BAE83F8470806EB4EC54563D2A7AEE97` |
| `hero.png` | `91D2A49BC0F0D42F8ED70575E99F2BBD8402908EC56E168E0C53B8850F7548BF` |
| `cutout.png` | `475CC65E5811420ADD6D15C3CB3764525191D1DFAFAFDF5A1D3BA494910F7C1D` |
| `fresh-run-final-4.jsonl` | `B88BB73591FED2D7934D0F5D5ACB3DE5B7563D14C899CDB316B51C6AC0742C31` |
