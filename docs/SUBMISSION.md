# Submission notes — draft, not a submitted entry

| Project | Office of Otherwise |
| --- | --- |
| Team / representative | Office of Otherwise / Divakar Dev |
| Contributors | Divakar Dev (sole contributor) |
| Confirmed track | Startups Track; operator confirmed the active-employee and authorized-representative condition |
| Theme | Build for Your World |

**Repository:** [DivDev93/OfficeOfOtherwise-MetaHackathon](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon)

**Paste-ready official form answers:** [SUBMISSION_FIELDS.md](SUBMISSION_FIELDS.md). No entry has been submitted, no form consent checkbox has been accepted, and PR #7 remains draft.

## Project description

Office of Otherwise explores science, technology, culture, and geography counterfactuals as paths across a globe. A prompt produces geographically anchored branches with years, short causal narratives, review notes, and a selected hero scene. Users can compare branches, inspect the generated scene and SAM 3.1 cutout, and orbit a saved 3D object for four curated replays. Fresh text runs re-fetch baseline excerpts from fixed public-source registries for four supported topics: Alexandria, Beringia, Green Sahara climate, and ancient mechanisms. They do not perform arbitrary web search.

Our impact hypothesis is that scenario creators can explore visual consequences of a what-if while distinguishing source-linked baseline context from imagined outcomes. Curated replays link baseline facts and separately label changed assumptions, hypothetical causal chains, and uncertainty. Fresh baselines must quote complete retrieved source units exactly, preserving their wording and qualifications; source selection and quotation do not establish historical truth or the imagined timeline. No user feedback has been collected. We propose a small, task-based creator-usability pilot in [docs/USER_VALIDATION.md](USER_VALIDATION.md).

The project uses Meta Muse Wonder for branch proposals and review; Muse Spark 1.3 is the default model for topic-policy checks on fresh runs; Muse Image renders scenes; SAM 3.1 segments a subject. The four saved traces are historical records and attribute policy/proposal/review to Wonder, not Spark. None records Spark narration. Cached SAM 3D Objects models were generated separately and attached to replay runs; their costs are unknown. This repository provides GLB validation/attachment and replay provenance, not the 3D generation service.

Chronos provides pre-existing private product context and infrastructure; it is excluded from this public deliverable and source archive. The pre-event `53a83c0` scaffold (October 26, 09:17 EDT) contains README, license, CI secret scan and structure, with no functional code. Functional implementation starts at `ba7110f` (October 26, 13:38 EDT), after the noon kickoff, and the deployed implementation extends through `29b2741` (October 30). The [release manifest](RELEASE_ARTIFACTS.md#event-built-scope) records the exact boundary and source ZIP. The current image and supplemental source ZIP identify `29b2741`; later receipt-only documentation is separate. PR #7 remains draft.

The [published replay](https://office-otherwise-875096283797.northamerica-northeast2.run.app) serves `925c110` on revision `office-otherwise-00008-hkl`, including onboarding and evidence-linked briefs; see the [2026-10-30 deployment proof](deployment/2026-10-30.md). The [public review prerelease](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/tag/hackathon-preview-2026-10-30) contains the 178.733-second primary video, 80.333-second fresh-proof companion, judge package, captions and exact source archive. Later self-service pilot changes are work in progress until separately validated and deployed. Publication does not submit the entry.

## Judge setup

For an offline replay, install Node.js 22.9 or newer and run:

```bash
npm ci --ignore-scripts
npm test
npm run demo:replay
```

Open `http://127.0.0.1:3000`, select a saved story in the archive, and inspect its branches, **Evidence & brief**, hero scene, cutout, and 3D object when available. Replay uses cached assets and makes no provider calls. The guardrail story is an explicitly simulated unavailable-classifier case.

Fresh model generation is optional and separate. It requires private credentials and a configured budget; it makes metered Meta calls. A fresh harness run can generate branches, an image, and a subject mask. A fresh 3D generation is not demonstrated by the public replay; saved models were generated separately. Do not put secrets in the repository or submission.

Fresh retrieval precedes branch proposal/review; partial retrieval may continue, while unsupported topics, complete failure, or no valid whole-unit baselines stop before image/3D generation. The latest fresh run, `1793334705465`, completed on 2026-10-30 UTC in **58.666 seconds**, recording **US$0.2507162** in Meta ledger estimates. MacTutor was retrieved; the other Alexandria source timed out. All three saved baselines exactly match complete source units, and the saved selector accepts the run. It produced a scene and SAM mask/cutout, with no 3D call. None of the chosen baselines selects the specific “it is thought” study paragraph; offline fixtures cover that regression. The earlier run's dropped qualifier remains documented as a historical defect. Five attempts total US$0.95696825 in estimates. The fresh-proof capture is now published in the review prerelease; the entry is not submitted and PR #7 remains draft. See the [source-preservation record](evaluation/2026-10-30-source-uncertainty.md) for 214 passing fixture tests, artifacts, hashes, and recording limits.

The bounded four-prompt evaluation completed on 2026-10-29 under a separately authorized allowance; see [docs/EVALUATION.md](EVALUATION.md) and its sanitized [evidence summary](evaluation/2026-10-29-live.md). It records pipeline completion and one 2D-only result, not source quality, product impact, or user feedback. The evaluator’s one-time scope is consumed and cannot be repeated.

## Official criteria reference

The event waiver lists **Impact (30%)**, **Meta tooling (25%)**, **Demo (25%)**, and **Technical (20%)**. The central submission risk is Impact: creator value is a hypothesis with no user feedback yet. The demo should show a scenario path from divergent premise to spatial exploration and evidence-linked brief, while making clear that sources support baseline facts, not the imagined outcome. The technical explanation should separate fresh Meta work from historical replay artifacts. See the [official event waiver](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver) for judging weights and [official event details](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details) for project-type and submission rules.

## Submission checklist

- [x] Publish and HTTP-verify the evidence-and-brief replay at source `925c110`; preserve [deployment evidence](deployment/2026-10-30.md).
- [x] Publish the primary demo, fresh companion, judge package and exact source archive; preserve [downloads and hashes](RELEASE_ARTIFACTS.md). Public binary downloads were independently fetched anonymously and hash-checked.
- [x] Confirm Office of Otherwise, sole contributor/representative Divakar Dev, Startups Track and the applicable active-employee/authorized-representative condition directly with the operator.
- [x] Prepare [paste-ready form answers](SUBMISSION_FIELDS.md), including the operator's future API-use and opinion selections.
- [x] Verify video/audio decoding, unchanged narration, captions, encoded frames, public download access and artifact hashes. These checks do not claim subjective listening or judge acceptance.
- [x] Validate and deploy self-service pilot source `29b2741` on `office-otherwise-00009-t8f`; preserve 223 passing local/container tests, 34 public content checks and browser proof. Keep the integration PR draft as requested.
- [ ] Complete the planned 3–5 observed creator sessions. The prepared entry explicitly states that no user feedback has been collected; this disclosure does not close the validation improvement.
- [x] Verify topic-policy tests, asset/credit records and staged/history Gitleaks scans for this batch. Recheck if the final submission changes.
- [ ] Review any required legal/consent checkboxes personally and submit only under separate operator authorization. No checkbox is accepted and no entry submission is authorized by this package.
