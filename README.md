# Office of Otherwise

**Ask "what if?" and walk into the answer.**

Office of Otherwise is the Meta-powered branching layer for [Chronos](#relationship-to-chronos), an alternate-history explorer. You give it a point of divergence. Meta's models branch the timeline, check that the branches hold together, render a scene for each one, and cut out the subject so the existing Chronos pipeline can turn it into a 3D object or a world you can explore.

Built for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026). Startups track.

> Status: local branch → image → subject cutout harness, validated with fixtures. The first live check exposed a large-image decoding bug (fixed); live mask/cutout validation is pending a further authorized run. See [Built during the hackathon](#built-during-the-hackathon).

## How it works

| Step | Meta model | Module |
|---|---|---|
| Plan branches, check consistency, choose the hero scene | **Muse Wonder** | `src/agents/branchAgent.js` |
| Narrate each branch (streamed) | **Muse Spark** | `src/providers/metaText.js` |
| Keep branches out of war and political territory | Muse Wonder + rules | `src/guardrails/topicPolicy.js` |
| Render the branch scene | **Muse Image** | `src/providers/metaImage.js` |
| Cut out the subject for 3D | **SAM 3.1** | `src/providers/samMask.js` |
| Image + mask → 3D object or world | *(existing Chronos pipeline, private)* | via `CHRONOS_3D_ENDPOINT` |

Divergence points are drawn from science, technology, culture and geography. War and political scenarios are out of scope by design (see `src/guardrails/`).

## Run it

```bash
npm ci --ignore-scripts  # Node >=22.9.0 (CI uses Node 22)
cp .env.example .env   # add META_API_KEY
npm test
npm run harness -- "What if the Library of Alexandria never burned?"
# Reuse a saved branch run without paying for the agent again:
npm run harness -- --from out/branch-<timestamp>.json
```

The harness uses one metered Meta client and writes `branch.json`, `hero.png`, `mask.png`, `cutout.png`, and `trace.json` to `out/<timestamp>/`. It prints each step's timing and cost, and the selected mask's confidence. Saved branch traces remain available as provenance but are excluded from the new run's cost. Reused content gets one fresh policy check before generation, billed separately. Blocked or empty branches stop before image generation.

Muse Image defaults to $0.01 per image. SAM defaults to an estimated $0.05 per call because its image price is unpublished. An empty segmentation gets at most one retry with the subject's head noun. All calls use the persistent spend ledger and respect `META_SPEND_CAP_USD`; tests use fixtures and do not call Meta.

PNG encoding uses Node's built-in zlib; decoding uses MIT-licensed `pngjs`. SAM output decoding uses the unmodified `@meta-sam/parser` npm dependency under Meta's separate **SAM License**, including its use and redistribution restrictions. It is not covered by this repository's MIT license. See [third-party notices](THIRD_PARTY_NOTICES.md).

## Relationship to Chronos

Chronos (globe, accounts, credits, 3D/world rendering) existed before this hackathon and stays private. Chronos uses this repo as a dependency through its provider registry, so this repo holds all of the hackathon work.

## Built during the hackathon

Everything in this repository was written during the event window (first functional commit after 2026-10-26 12:00 PM ET). The day-by-day log is in [`docs/HACKATHON.md`](docs/HACKATHON.md).

## License

Application code: MIT. Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
