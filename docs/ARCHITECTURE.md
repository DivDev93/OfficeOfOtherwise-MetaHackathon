# Architecture

## Fresh model-assisted run

```text
what-if prompt
  → topic policy (keyword check, then Muse Spark 1.3 by default)
  → Muse Wonder branch proposal
  → parallel per-branch topic checks and Wonder plausibility/causal-consistency review
  → choose the reviewed hero branch
  → Muse Image hero scene
  → SAM 3.1 subject mask and cutout
  → optional configured Chronos provider job (disabled by default)
```

The shared Meta client meters Responses and image/segmentation calls against the spend ledger. Policy rejection, empty proposals, and failures stop later pipeline stages. The branch agent has a bounded retry for unparseable JSON; SAM has at most one noun fallback after a no-match. There is no Muse Spark narration stage in the current implementation.

## Replay and provenance

`npm run demo:replay` starts a local, loopback-only server in forced replay mode without loading `.env`. It serves the four curated branch artifacts, recorded traces, and a separate evidence sidecar. The historical traces attribute policy, proposal, and review to Muse Wonder; current default text routing uses Spark for topic policy and Wonder for proposal/review. A replay makes no Meta or 3D provider calls.

For selected curated branches, the evidence sidecar links sources for historical or scientific baseline facts, then separately describes the changed assumption, hypothetical causal chain, uncertainty, and discussion question. The sources do not support the alternate timeline as a prediction. Fresh live runs do not receive this curated evidence set. Evidence is matched to a saved branch by its exact digest so stale notes are not shown for changed artifacts.

Cached SAM 3D Objects GLBs were generated separately and attached to saved runs. `scripts/attach-glb.js` validates and attaches an already supplied GLB; it is not a generator. The Chronos 3D service is a separate, pre-existing private system and is not included in this repository.

## Current code contracts

- `src/demo/pipeline.js` wires the shared metered client, topic policy, branch agent, image provider, SAM provider, and optional Chronos client.
- `src/agents/branchAgent.js` proposes, filters, reviews, and selects branches; branch progress is emitted only after the corresponding topic-policy gate.
- `src/guardrails/topicPolicy.js` checks the prompt and each proposed branch; Spark is the default model classifier in the demo runner.
- `src/providers/metaImage.js` returns a generated PNG through the metered image client.
- `src/providers/samMask.js` returns a validated mask and bounded segmentation trace.
- `src/evidence/index.js` validates curated source notes against the exact saved branch content.
- `harness/run.js` persists branch, image, segmentation, cutout, trace, and failure evidence under the run output directory.

## Historical note

Some early cached runs predate the current Spark policy routing. Their archived traces correctly show the model actually used at that time. Older notes describing a proposed streamed narration provider were design documentation, not a shipped stage; the current system does not implement that provider.
