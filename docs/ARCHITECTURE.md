# Architecture

## Fresh model-assisted run

```text
what-if prompt
  → topic policy (keyword check, then Muse Spark 1.3 by default)
  → bounded retrieval from the fixed public-source registry (four supported topics)
  → Muse Wonder branch proposal
  → parallel per-branch topic checks and Wonder plausibility/causal-consistency review
  → choose the reviewed hero branch
  → Muse Image hero scene
  → SAM 3.1 subject mask and cutout
  → optional configured Chronos provider job (disabled by default)
```

The shared Meta client meters Responses and image/segmentation calls against the spend ledger. Policy rejection, empty proposals, and failures stop later pipeline stages. The branch agent has a bounded retry for unparseable JSON; SAM has at most one noun fallback after a no-match. There is no Muse Spark narration stage in the current implementation.

For a fresh run, retrieval happens after prompt policy and before branch proposal/review. The fixed registry covers Alexandria, Beringia, Green Sahara climate, and ancient mechanisms; prompt text is not used for arbitrary web search. Each run fetches its registered public sources again. Partial retrieval can continue with the excerpts that succeeded; if all sources fail, or no proposal has valid source IDs and required uncertainty fields, the run stops before image or 3D generation. Excerpts are supplied as untrusted baseline context. Citation membership is validated, but retrieval and model review do not independently verify claim accuracy; baseline claims need human source review and alternate outcomes are hypothetical.

A local fresh-run capture completed on 2026-10-29 ET (started 2026-10-30 03:57:48 UTC; pipeline time 73.146 s). One MacTutor Aristarchus excerpt was retrieved while the other registered Alexandria source timed out. The run produced three branches, a scene image, and a SAM 3.1 mask/cutout; it made no 3D call. Across four fresh-run attempts, shared-ledger cost estimates totaled US$0.70625205, including one retrieval failure and one ungrounded result. These observations do not assess source quality or verify model claims. The capture has not been uploaded or submitted.

## Replay and provenance

`npm run demo:replay` starts a local, loopback-only server in forced replay mode without loading `.env`. It serves the four curated branch artifacts, recorded traces, and a separate evidence sidecar. The historical traces attribute policy, proposal, and review to Muse Wonder; current default text routing uses Spark for topic policy and Wonder for proposal/review. A replay makes no Meta or 3D provider calls.

For selected curated branches, the evidence sidecar links sources for historical or scientific baseline facts, then separately describes the changed assumption, hypothetical causal chain, uncertainty, and discussion question. The sources do not support the alternate timeline as a prediction. Fresh live runs use the bounded registry rather than the curated sidecar. Saved fresh evidence is served only when its source links and branch projection match the saved artifact digest.

Cached SAM 3D Objects GLBs were generated separately and attached to saved runs. `scripts/attach-glb.js` validates and attaches an already supplied GLB; it is not a generator. The Chronos 3D service is a separate, pre-existing private system and is not included in this repository.

## Current code contracts

- `src/demo/pipeline.js` wires the shared metered client, topic policy, branch agent, image provider, SAM provider, and optional Chronos client.
- `src/agents/branchAgent.js` proposes, filters, reviews, and selects branches; branch progress is emitted only after the corresponding topic-policy gate.
- `src/guardrails/topicPolicy.js` checks the prompt and each proposed branch; Spark is the default model classifier in the demo runner.
- `src/providers/metaImage.js` returns a generated PNG through the metered image client.
- `src/providers/samMask.js` returns a validated mask and bounded segmentation trace.
- `src/evidence/index.js` validates curated source notes against the exact saved branch content.
- `src/evidence/fresh.js` retrieves excerpts from the fixed four-topic public-source registry and validates saved fresh evidence against its run digest.
- `harness/run.js` persists branch, image, segmentation, cutout, trace, and failure evidence under the run output directory.

## Historical note

Some early cached runs predate the current Spark policy routing. Their archived traces correctly show the model actually used at that time. Older notes describing a proposed streamed narration provider were design documentation, not a shipped stage; the current system does not implement that provider.
