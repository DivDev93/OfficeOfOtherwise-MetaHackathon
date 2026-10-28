# Office of Otherwise

**Ask "what if?" and walk into the answer.**

Office of Otherwise is the Meta-powered branching layer for [Chronos](#relationship-to-chronos), an alternate-history explorer. You give it a point of divergence. Meta's models branch the timeline, check that the branches hold together, render a scene for each one, and cut out the subject so the existing Chronos pipeline can turn it into a 3D object or a world you can explore.

Built for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026). Startups track.

> Status: local branch → image → subject cutout harness, validated with fixtures and live fresh-agent and saved-branch runs. Alexandria, Beringia, Green Sahara and Mechanisms now have separately generated SAM 3D Objects models; all four show `3D: Meta SAM 3D Objects (via Tattva Cloud Run)`. See [Built during the hackathon](#built-during-the-hackathon).

## Public demo

[Open the Office of Otherwise replay demo](https://office-otherwise-875096283797.northamerica-northeast2.run.app). The deployed revision, `office-otherwise-00001-84n`, is replay-only: live model generation is disabled. Explore the four cached 3D runs for Alexandria, Beringia, Green Sahara and Mechanisms; they do not make live Meta or 3D provider calls.

## How it works

| Step | Meta model | Module |
|---|---|---|
| Plan branches, check consistency, choose the hero scene | **Muse Wonder** | `src/agents/branchAgent.js` |
| Narrate each branch (streamed) | **Muse Spark** | `src/providers/metaText.js` |
| Keep branches out of war and political territory | Muse Wonder + rules | `src/guardrails/topicPolicy.js` |
| Render the branch scene | **Muse Image** | `src/providers/metaImage.js` |
| Cut out the subject for 3D | **SAM 3.1** | `src/providers/samMask.js` |
| Generate 3D models for cached demos | **SAM 3D Objects** | Separately generated; GLBs attached by `scripts/attach-glb.js` and labeled in replay provenance. |
| Image + mask → 3D object or world | *(existing Chronos pipeline, private)* | via `CHRONOS_3D_ENDPOINT` |

Divergence points are drawn from science, technology, culture and geography. War and political scenarios are out of scope by design (see `src/guardrails/`).

## Run it

```bash
npm ci --ignore-scripts  # Node >=22.9.0 (CI uses Node 22)
cp .env.example .env   # add META_API_KEY
npm test
npm run init-demo-budget  # once, before the first live task call
npm run harness -- "What if the Library of Alexandria never burned?" --no-3d
# Reuse a saved branch run without paying for the agent again:
npm run harness -- --from out/branch-<timestamp>.json --no-3d
# If the subject is not found, retry a saved branch using a concrete noun:
npm run harness -- --from out/branch-<timestamp>.json --subject book --no-3d
npm run demo           # local replay, http://localhost:3000
```

The harness uses one metered Meta client and writes `branch.json`, `hero.png`, `mask.png`, `cutout.png`, and `trace.json` to `out/<timestamp>/`. It prints each step's timing and cost, and the selected mask's confidence. Saved branch traces remain available as provenance but are excluded from the new run's cost. An optional subject override is recorded in the trace and does not alter the saved branch. Reused content and any override get one fresh policy check before generation, billed separately. Blocked or empty branches stop before image generation.

The harness defaults to a 3D handoff and fails before Meta calls if verified Chronos configuration is unavailable; use `--no-3d` for local 2D-only runs. The deployed public demo is replay-only, with live model generation disabled. For local live generation, the demo server requires a configured access code, budget checkpoint and verified Chronos TRELLIS configuration. Alexandria, Beringia, Green Sahara and Mechanisms are completed 3D replays. The guardrail replay is a labeled simulation of an unavailable classifier, not a recorded model verdict. The four model files bring the cached demo archive to 46,343,279 bytes; the cache cap is 80 MB. See [deployment notes](docs/DEPLOY.md).

For a separately generated GLB, attach it to a provisional cached run with `npm run attach-glb -- <slug> <path-to-model.glb> --provider sam3dobjects --ms <actual-elapsed-ms>`. The command validates the GLB structure and records it as pre-generated, without claiming a live Chronos job. `sam3dobjects` displays the `3D: Meta SAM 3D Objects (via Tattva Cloud Run)` provenance badge; use it only when that provider produced the attached model. Omit `--ms` if the actual duration is unknown. The local demo cache is capped at 80 MB.

Muse Image defaults to $0.01 per image. SAM defaults to a conservative estimated $0.05 per call; Meta now lists $2.50 per 1,000 images on its [SAM model page](https://dev.meta.ai/models/sam-3-1). The ledger records the configured estimate, not an invoice. Token estimates use Meta's published Wonder and Spark rates, but cannot guarantee that provider charges never exceed a reservation. An empty segmentation gets at most one retry with the subject's head noun. All calls use the persistent spend ledger and respect `META_SPEND_CAP_USD`; tests use fixtures and do not call Meta.

PNG encoding uses Node's built-in zlib; decoding uses MIT-licensed `pngjs`. SAM output decoding uses the unmodified `@meta-sam/parser` npm dependency under Meta's separate **SAM License**, including its use and redistribution restrictions. It is not covered by this repository's MIT license. See [third-party notices](THIRD_PARTY_NOTICES.md).

## Relationship to Chronos

Chronos (globe, accounts, credits, 3D/world rendering) existed before this hackathon and stays private. Chronos uses this repo as a dependency through its provider registry, so this repo holds all of the hackathon work.

## Built during the hackathon

Everything in this repository was written during the event window (first functional commit after 2026-10-26 12:00 PM ET). The day-by-day log is in [`docs/HACKATHON.md`](docs/HACKATHON.md).

## License

Application code: MIT. Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
