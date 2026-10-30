# Office of Otherwise

**Ask “what if?” and follow the consequences across a map.**

Office of Otherwise is a Meta-model experiment in geographically anchored counterfactual stories. A question about science, technology, culture, or geography becomes several possible paths with dates, places, short explanations, and an illustrated hero scene. The interface lets you compare paths on a globe, inspect the saved scene and subject cutout, and orbit a saved 3D object.

The impact hypothesis is that scenario creators can explore visual consequences of a what-if while keeping documented baseline facts separate from imagined outcomes. No user feedback has been collected. A small creator-usability protocol is in [docs/USER_VALIDATION.md](docs/USER_VALIDATION.md).

Draft materials list the **Startup track** and frame the project around **Build for Your World**; confirm the registered entrant and track eligibility before filing. The project uses the Meta Model API for policy checks, branch proposals and review, image generation, and subject segmentation. It deliberately limits topics to science, technology, culture, and geography; political and war scenarios are out of scope.

## Current capabilities

The public repository contains four cached stories: Alexandria, Beringia, Green Sahara, and Antikythera-style mechanisms. Each has three reviewed branches. The replay demo serves saved artifacts and makes no Meta or 3D provider calls. The guardrail story is a labeled simulation of an unavailable classifier, not a recorded model result.

Fresh model-assisted runs re-fetch public excerpts from a fixed registry for Alexandria, Beringia, Green Sahara climate, or ancient mechanisms before branch proposal/review. They do not perform arbitrary web searches. Baselines must quote one complete retrieved source unit exactly, with one matching source ID; runtime selection, saved evidence, UI, and brief export enforce that boundary. Complete units preserve source qualifiers and attribution; they do not independently verify historical truth. Legacy fresh excerpts fail closed, while curated replay evidence is unchanged. Alternate assumptions and outcomes remain hypothetical. Unsupported topics, complete retrieval failure, or no valid grounded branches stop before image/3D generation. See the [source-preservation record](docs/evaluation/2026-10-30-source-uncertainty.md).

For new model-assisted runs, `src/demo/pipeline.js` routes prompt and branch topic checks to Muse Spark 1.3 by default, while `src/agents/branchAgent.js` uses Muse Wonder for branch proposals and review. Muse Image creates a hero image and SAM 3.1 produces a subject mask. The saved traces in `demo/runs/` are older: they attribute policy, proposal, and review calls to Muse Wonder. They contain no Muse Spark call. The project does not implement a streamed Muse Spark narration step.

The cached 3D objects were generated separately and attached to the replay records. `scripts/attach-glb.js` validates and attaches a supplied GLB; it does not generate one. The offline replay entry point does not invoke a 3D provider. Chronos, including the pre-existing globe, account, credit, and world-rendering systems, is private and predates this hackathon. This repository contains no Chronos code.

| Stage | Current implementation | Evidence and limits |
|---|---|---|
| Topic policy | Muse Spark 1.3 plus keyword checks for new runs | Historical cached traces use Muse Wonder; the guardrail archive entry is simulated. |
| Branches | Muse Wonder proposes, reviews, and selects a hero branch | Curated replays link sources for baseline facts; the changed timeline and causal chain remain hypothetical. |
| Scene and cutout | Muse Image scene, SAM 3.1 subject mask | A cutout can omit thin or small elements; inspect the saved result. |
| 3D replay | Separately generated SAM 3D Objects GLBs attached to saved runs | Unknown generation costs remain unknown; this repository does not provide the model-generation service. |

## Judge onboarding: offline replay

A published replay is available at [Office of Otherwise](https://office-otherwise-875096283797.northamerica-northeast2.run.app). The service was verified as replay-only on 2026-10-29; this local evidence-and-brief batch is not deployed there.

Requirements: Node.js 22.9 or newer and npm.

```bash
npm ci --ignore-scripts
npm test
npm run demo:replay
```

Open `http://127.0.0.1:3000`, open a cached story from **The Archive**, and inspect its branches, scene, cutout, and 3D object where available. Use Alexandria for the full branch-to-object story; then compare Beringia, Green Sahara, and Mechanisms. In a curated story, inspect **Evidence & brief**: linked sources ground the baseline only, while the changed assumption and causal chain are explicitly hypothetical. Open **Simulated guardrail** to see the labeled unavailable-classifier example. This dedicated replay command binds to loopback, forces replay-only mode, and does not load `.env`; it requires no API key or provider budget and makes no live model calls. See [docs/JUDGE_GUIDE.md](docs/JUDGE_GUIDE.md) for a short storyboard.

## Optional fresh Meta run

Fresh text, image, and segmentation generation is a separate, metered path. It requires privately configured credentials and budget settings; never commit credentials. For a 2D-only harness run, use:

```bash
cp .env.example .env
# Configure credentials and a spend cap privately before continuing.
npm run init-demo-budget
npm run harness -- "What if the Library of Alexandria never burned?" --no-3d
```

The harness records model, timing, usage, and cost estimates. Estimates are not invoices. Calls go through the shared metered Meta client and respect `META_SPEND_CAP_USD`. Tests use recorded fixtures, not live calls. The dedicated offline replay entry point does not enable live generation.

Local source-preservation proof is available. The latest fresh run, `1793334705465`, completed on 2026-10-30 UTC in **58.666 seconds**, recording **US$0.2507162** in Meta ledger estimates. MacTutor was retrieved; the other Alexandria source timed out. All three saved baselines exactly match complete source units, and the saved selector accepts the run. It produced a scene and SAM mask/cutout, with no 3D call. None of the chosen baselines selects the specific “it is thought” study paragraph; offline fixtures cover that regression. The earlier run's dropped qualifier remains documented as a historical defect. Five attempts total US$0.95696825 in estimates. No capture has been uploaded or submitted; PR #7 remains draft. See the [source-preservation record](docs/evaluation/2026-10-30-source-uncertainty.md) for 214 passing fixture tests, artifacts, hashes, and recording limits.

## Build and provenance

The repository includes branch generation, topic guardrails, the shared Meta client, image and mask handling, the replay server/UI, cached artifacts, and GLB attachment/provenance tooling. Chronos is a separate, pre-existing private system. A fresh 3D provider job is not part of replay, and an attached GLB must not be presented as a job run by this repository.

See [docs/SUBMISSION.md](docs/SUBMISSION.md) for submission facts and open checklist items, [docs/HACKATHON.md](docs/HACKATHON.md) for the build log, [docs/USER_VALIDATION.md](docs/USER_VALIDATION.md) for the proposed creator-usability study, and [docs/EVALUATION.md](docs/EVALUATION.md) for the dry-run-first live evaluation preflight.

## License and asset notices

Application code is MIT licensed. Dependencies, fonts, and map textures retain their own terms and attribution requirements; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The `@meta-sam/parser` package is under Meta's separate SAM License and is not covered by this repository's MIT license.
