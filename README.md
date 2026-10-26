# Office of Otherwise

**Ask "what if?" and walk into the answer.**

Office of Otherwise is the Meta-powered branching layer for [Chronos](#relationship-to-chronos), an alternate-history explorer. You give it a point of divergence. Meta's models branch the timeline, check that the branches hold together, render a scene for each one, and cut out the subject so the existing Chronos pipeline can turn it into a 3D object or a world you can explore.

Built for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026). Startups track.

> Status: scaffold. Functional code starts after kickoff (2026-10-26 12:00 PM ET). See [Built during the hackathon](#built-during-the-hackathon).

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
cp .env.example .env   # add META_API_KEY
npm test
npm run harness -- "What if the Library of Alexandria never burned?"
```

The harness runs the full Meta chain with no Chronos dependency and writes branches, images and masks to `out/`.

## Relationship to Chronos

Chronos (globe, accounts, credits, 3D/world rendering) existed before this hackathon and stays private. Chronos uses this repo as a dependency through its provider registry, so this repo holds all of the hackathon work.

## Built during the hackathon

Everything in this repository was written during the event window (first functional commit after 2026-10-26 12:00 PM ET). The day-by-day log is in [`docs/HACKATHON.md`](docs/HACKATHON.md).

## License

MIT
