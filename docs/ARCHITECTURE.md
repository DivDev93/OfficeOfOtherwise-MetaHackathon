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

For a fresh run, retrieval follows prompt policy and precedes branch proposal/review. The fixed registry covers Alexandria, Beringia, Green Sahara climate, and ancient mechanisms; there is no arbitrary web search. Partial retrieval can continue with successful excerpts. Extraction preserves whole paragraphs (with a MacTutor paired-`br` fallback), omitting oversized units rather than clipping them. Baseline text must exactly equal one complete unit with one source ID; runtime validation and saved selection enforce this. The UI and Markdown exporter apply the same rule and classify unmatched or legacy claims as unverified. Legacy fresh envelopes without the complete-unit marker are rejected by the saved selector. Curated evidence is unchanged. Complete retrieval failure or no valid grounded branch stops image/3D generation. Exact quotation checks text fidelity, not historical truth or counterfactual causality.

The current live proof is run `1793334705465` on 2026-10-30 UTC: 58.666 s, US$0.2507162 in Meta ledger estimates, three exact whole-unit baselines accepted by the saved selector, scene plus SAM mask/cutout, no 3D call. MacTutor succeeded and the other registered Alexandria source timed out. None of its chosen quotes contains the specific study hedge; offline fixtures cover that regression. The local Node 22 suite passed 214/214 tests. See the [source-preservation record](evaluation/2026-10-30-source-uncertainty.md) for limits, historical-defect preservation, and current artifact hashes.

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
