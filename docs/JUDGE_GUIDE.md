# Judge guide

## Start an offline replay

The [published replay](https://office-otherwise-875096283797.northamerica-northeast2.run.app) serves source `925c110` on revision `office-otherwise-00008-hkl`, including replay onboarding and evidence-linked briefs. The [2026-10-30 deployment record](deployment/2026-10-30.md) verifies replay-only HTTP behavior and saved asset integrity. Later self-service pilot work requires its own validation and deployment.

Requires Node.js 22.9 or newer. From the repository root:

```bash
npm ci --ignore-scripts
npm test
npm run demo:replay
```

Open `http://127.0.0.1:3000` and click the **Library of Alexandria** starter suggestion in the invitation panel; replay-only mode opens its matching cached story. This dedicated entry point binds to loopback, forces replay-only mode, and does not load `.env`; it does not require credentials or contact Meta or a 3D provider. The four complete saved stories are Alexandria, Beringia, Green Sahara, and Mechanisms. **Simulated guardrail** is a fixture, not an actual classifier result.

## Three-minute inspection

1. Alexandria: compare the three dated, geographically anchored branches; select a different pin and return to the gold hero.
2. Select a branch and inspect **Evidence & brief**: open a baseline source, then compare its scope with the changed assumption, hypothetical causal steps, and uncertainty. The sources ground the starting facts, not the imagined outcome.
3. Inspect Scene, SAM cutout, and 3D object; orbit the saved model. Treat it as an illustration, not a scientific simulation.
4. Open Beringia or Green Sahara to see how a different divergence yields different places and consequences.
5. Open Simulated guardrail to inspect the clearly labeled fail-closed example.

Watch the published [178.733-second primary demonstration](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-preview-2026-10-30/office-of-otherwise-judge-primary.mp4). It uses saved local replay captures with synthetic narration and makes no live-generation claim. The [80.333-second companion](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-preview-2026-10-30/office-of-otherwise-fresh-proof.mp4) shows actual fresh generation and a separately captured, labeled same-run source review; it makes no fresh 3D claim. The [review prerelease](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/tag/hackathon-preview-2026-10-30) also contains captions, a judge package, and an exact `925c110` source ZIP. See the [release manifest](RELEASE_ARTIFACTS.md) for hashes and the [recording note](recording/JUDGE_PACKAGE.md) for editing and review limits. Publication does not submit the entry.

## What the current evidence supports

- New model-assisted text runs route prompt and branch policy checks to Muse Spark 1.3 by default; Muse Wonder proposes and reviews branches. The cached traces are historical and record Wonder for those steps.
- Muse Image generates the hero scene and SAM 3.1 segments a selected subject in fresh runs.
- The four saved 3D models were generated separately and attached to replay records. The attachment tool validates a supplied GLB; it does not generate a model.
- The product’s value to writers, worldbuilders, and concept artists is an unvalidated hypothesis; no user feedback has been collected. Curated source notes link to baseline facts; counterfactual causal chains remain speculative, and the orbitable object does not establish them.
- Chronos is pre-existing and private. No Chronos code is part of this public repository.

## Fresh evidence path and limits

Fresh model-assisted runs re-fetch public excerpts after prompt-policy approval and before branch proposal/review. Retrieval is restricted to a fixed registry for Alexandria, Beringia, Green Sahara climate, and ancient mechanisms; the prompt is never sent to an arbitrary search service. Some registered source fetches may fail while others succeed, in which case only successful excerpts are used and the failure is surfaced. If no source is retrieved, or no branch has valid source links and uncertainty fields, the run stops before image/3D generation.

The UI and exported fresh brief label baselines as **Model-selected source text**. A baseline must exactly quote one complete retrieved unit; quotation does not independently verify its truth or the imagined timeline. The latest fresh run, `1793334705465`, completed on 2026-10-30 UTC in **58.666 seconds**, recording **US$0.2507162** in Meta ledger estimates. MacTutor was retrieved; the other Alexandria source timed out. All three saved baselines exactly match complete source units, and the saved selector accepts the run. It produced a scene and SAM mask/cutout, with no 3D call. None of the chosen baselines selects the specific “it is thought” study paragraph; offline fixtures cover that regression. The earlier run's dropped qualifier remains documented as a historical defect. Five attempts total US$0.95696825 in estimates. The companion video is published; the hackathon entry is not submitted and PR #7 remains draft. See the [source-preservation record](evaluation/2026-10-30-source-uncertainty.md) for 214 passing fixture tests, artifacts, hashes, and recording limits.

## Event-built boundary

Office of Otherwise, represented by sole contributor Divakar Dev, is preparing a Startups Track entry under Build for Your World. Functional hackathon work begins at `ba7110f` on October 26, 2026, at 13:38 EDT, after the noon kickoff. The earlier `53a83c0` commit is a README/license/CI scaffold with no functional code. The latest deployed implementation and supplemental source archive end at `29b2741`; the original media/source snapshot at `925c110` remains preserved. Subsequent receipt-only documentation records deployment and verification. The pre-existing private reconstruction backend is excluded. The [release manifest](RELEASE_ARTIFACTS.md#event-built-scope) records the comparison and precise provenance.

The event criteria published in the [official waiver](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver) weight Impact 30%, Meta tooling 25%, Demo 25%, and Technical 20%. This submission should foreground a concrete creator task while being candid that user value has not yet been measured.
