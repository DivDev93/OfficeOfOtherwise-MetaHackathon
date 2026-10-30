# Submission notes — draft, not a submitted entry

| Project | Office of Otherwise |
| --- | --- |
| Draft track | Startup — confirm the registered entrant and eligibility before filing |
| Theme | Build for Your World |

**Repository:** [DivDev93/OfficeOfOtherwise-MetaHackathon](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon)

## Project description

Office of Otherwise explores science, technology, culture, and geography counterfactuals as paths across a globe. A prompt produces geographically anchored branches with years, short causal narratives, review notes, and a selected hero scene. Users can compare branches, inspect the generated scene and SAM 3.1 cutout, and orbit a saved 3D object for four curated replays. Fresh text runs re-fetch baseline excerpts from fixed public-source registries for four supported topics: Alexandria, Beringia, Green Sahara climate, and ancient mechanisms. They do not perform arbitrary web search.

Our impact hypothesis is that scenario creators can explore visual consequences of a what-if while distinguishing source-linked baseline context from imagined outcomes. Curated replays link baseline facts and separately label changed assumptions, hypothetical causal chains, and uncertainty. Fresh baselines must quote complete retrieved source units exactly, preserving their wording and qualifications; source selection and quotation do not establish historical truth or the imagined timeline. No user feedback has been collected. We propose a small, task-based creator-usability pilot in [docs/USER_VALIDATION.md](USER_VALIDATION.md).

The project uses Meta Muse Wonder for branch proposals and review; Muse Spark 1.3 is the default model for topic-policy checks on fresh runs; Muse Image renders scenes; SAM 3.1 segments a subject. The four saved traces are historical records and attribute policy/proposal/review to Wonder, not Spark. None records Spark narration. Cached SAM 3D Objects models were generated separately and attached to replay runs; their costs are unknown. This repository provides GLB validation/attachment and replay provenance, not the 3D generation service.

Chronos provides the pre-existing private product context and infrastructure. It is not the hackathon deliverable, and no private Chronos code or assets are included here. The official event details allow existing products when the hackathon contribution is clearly identified; the exact registered entrant remains unconfirmed. The [published replay](https://office-otherwise-875096283797.northamerica-northeast2.run.app) was verified as replay-only on 2026-10-29. This local evidence-and-brief batch is not deployed there; recheck its status before submission.

## Judge setup

For an offline replay, install Node.js 22.9 or newer and run:

```bash
npm ci --ignore-scripts
npm test
npm run demo:replay
```

Open `http://127.0.0.1:3000`, select a saved story in the archive, and inspect its branches, **Evidence & brief**, hero scene, cutout, and 3D object when available. Replay uses cached assets and makes no provider calls. The guardrail story is an explicitly simulated unavailable-classifier case.

Fresh model generation is optional and separate. It requires private credentials and a configured budget; it makes metered Meta calls. A fresh harness run can generate branches, an image, and a subject mask. A fresh 3D generation is not demonstrated by the public replay; saved models were generated separately. Do not put secrets in the repository or submission.

Fresh retrieval precedes branch proposal/review; partial retrieval may continue, while unsupported topics, complete failure, or no valid whole-unit baselines stop before image/3D generation. The latest fresh run, `1793334705465`, completed on 2026-10-30 UTC in **58.666 seconds**, recording **US$0.2507162** in Meta ledger estimates. MacTutor was retrieved; the other Alexandria source timed out. All three saved baselines exactly match complete source units, and the saved selector accepts the run. It produced a scene and SAM mask/cutout, with no 3D call. None of the chosen baselines selects the specific “it is thought” study paragraph; offline fixtures cover that regression. The earlier run's dropped qualifier remains documented as a historical defect. Five attempts total US$0.95696825 in estimates. No capture has been uploaded or submitted; PR #7 remains draft. See the [source-preservation record](evaluation/2026-10-30-source-uncertainty.md) for 214 passing fixture tests, artifacts, hashes, and recording limits.

The bounded four-prompt evaluation completed on 2026-10-29 under a separately authorized allowance; see [docs/EVALUATION.md](EVALUATION.md) and its sanitized [evidence summary](evaluation/2026-10-29-live.md). It records pipeline completion and one 2D-only result, not source quality, product impact, or user feedback. The evaluator’s one-time scope is consumed and cannot be repeated.

## Official criteria reference

The event waiver lists **Impact (30%)**, **Meta tooling (25%)**, **Demo (25%)**, and **Technical (20%)**. The central submission risk is Impact: creator value is a hypothesis with no user feedback yet. The demo should show a scenario path from divergent premise to spatial exploration and evidence-linked brief, while making clear that sources support baseline facts, not the imagined outcome. The technical explanation should separate fresh Meta work from historical replay artifacts. See the [official event waiver](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver) for judging weights and [official event details](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details) for project-type and submission rules.

## Submission checklist

- [ ] Recheck the published replay and enter its current URL in the official form. The existing URL was verified as replay-only on 2026-10-29, before this local evidence-and-brief batch.
- [ ] Review and publish the locally assembled three-minute demo video by Nov 4, 2026, 9:00 PM ET; add its public video URL to the official entry. No upload or submission receipt is recorded here.
- [ ] Confirm the legal/applicant name, track, and final code range against registration and the final integration commit. Git history identifies `DivDev93` as repository code author; it does not establish the official entrant, entity, team, or behalf-of relationship.
- [ ] Run the proposed creator-usability pilot or state explicitly in the entry that no user feedback has yet been collected.
- [ ] Confirm whether Meta API credits were claimed in the official account/form; this repository does not establish that status.
- [ ] Recheck topic policy, licenses, assets, and public repository scan before final submission.
