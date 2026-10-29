# Judge guide

## Start an offline replay

The [published replay](https://office-otherwise-875096283797.northamerica-northeast2.run.app) was verified as replay-only on 2026-10-29. It predates the local evidence-and-brief changes described below; use the local replay to inspect those additions.

Requires Node.js 22.9 or newer. From the repository root:

```bash
npm ci --ignore-scripts
npm test
npm run demo:replay
```

Open `http://127.0.0.1:3000`. In the invitation panel, scroll to **The Archive**, choose **Alexandria**, and select **Open**. This dedicated entry point binds to loopback, forces replay-only mode, and does not load `.env`; it does not require credentials or contact Meta or a 3D provider. The four complete saved stories are Alexandria, Beringia, Green Sahara, and Mechanisms. **Simulated guardrail** is a fixture, not an actual classifier result.

## Three-minute inspection

1. Alexandria: compare the three dated, geographically anchored branches; select a different pin and return to the gold hero.
2. Select a branch and inspect **Evidence & brief**: open a baseline source, then compare its scope with the changed assumption, hypothetical causal steps, and uncertainty. The sources ground the starting facts, not the imagined outcome.
3. Inspect Scene, SAM cutout, and 3D object; orbit the saved model. Treat it as an illustration, not a scientific simulation.
4. Open Beringia or Green Sahara to see how a different divergence yields different places and consequences.
5. Open Simulated guardrail to inspect the clearly labeled fail-closed example.

The recorded three-minute demo is assembled from saved local replay captures with synthetic narration; it makes no live-generation claim. It is a local artifact, not an uploaded or submitted video. See [the recording note](recording/2026-10-29.md) for its scope and review status.

## What the current evidence supports

- New model-assisted text runs route prompt and branch policy checks to Muse Spark 1.3 by default; Muse Wonder proposes and reviews branches. The cached traces are historical and record Wonder for those steps.
- Muse Image generates the hero scene and SAM 3.1 segments a selected subject in fresh runs.
- The four saved 3D models were generated separately and attached to replay records. The attachment tool validates a supplied GLB; it does not generate a model.
- The product’s value to writers, worldbuilders, and concept artists is an unvalidated hypothesis; no user feedback has been collected. Curated source notes link to baseline facts; counterfactual causal chains remain speculative, and the orbitable object does not establish them.
- Chronos is pre-existing and private. No Chronos code is part of this public repository.

The event criteria published in the [official waiver](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver) weight Impact 30%, Meta tooling 25%, Demo 25%, and Technical 20%. This submission should foreground a concrete creator task while being candid that user value has not yet been measured.
