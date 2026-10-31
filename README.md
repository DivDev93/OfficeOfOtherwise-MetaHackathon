# Office of Otherwise

**Change a premise. Follow the consequences. Explore the world that emerges.**

Office of Otherwise is a counterfactual worldbuilding workbench for writers and worldbuilders. It turns one “what if?” premise into a navigable path of possible events: choose a turning point, follow its consequences with matching illustrative scenes, return to an earlier choice to explore another branch, and compare scenario geography with the present-day globe. The goal is to help writers develop and communicate a complex alternate-world idea while keeping its choices and visuals together. Scenario geography is illustrative, not a scientific simulation or historical claim.

Built for the **Meta Global AI Developer Hackathon** (October 26–November 4, 2026), **Startups Track**, theme **Build for Your World**. Divakar Dev is the sole contributor and startup representative.

## Judge access

Judges can clone this public repository and run its saved replay locally without credentials or model spend. For fresh Meta functionality, supply your own server-side Meta Model API key locally. The [v2 saved-result walkthrough video](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-submission-2026-10-31/office-of-otherwise-submission-1080p-v2.mp4) is available as a GitHub release asset under tag `hackathon-submission-2026-10-31`. No hosted app is part of judge access.

The source documentation describes local judge access; the video tag and its earlier capture provenance remain unchanged and distinct from this corrective source snapshot. PR #7 remains open, draft, and unmerged; `develop` and its parked pilot source remain intact. The hackathon entry is not submitted here.

## Saved replay examples

To inspect the current local replay package, start `npm run demo` without `META_API_KEY`. These links use saved records and do not make model calls:

- **Beringia, 900 → 1380 → 1472 → 1538:** [900 start](http://127.0.0.1:3000/#run=beringia&event=b2) → [1380](http://127.0.0.1:3000/#run=df5e6d97-9f0d-49a0-bb62-ad52c3ae6d09&event=b3) → [1472](http://127.0.0.1:3000/#run=c892b8d0-36c5-4eeb-a70b-022041a25c98&event=b1) → [1538](http://127.0.0.1:3000/#run=1fc70744-d82b-4364-8b78-c79544a4f7d6&event=b1). This follows three saved continuations across four events.
- **1080 Lichen alternate:** [Open the saved event](http://127.0.0.1:3000/#run=df5e6d97-9f0d-49a0-bb62-ad52c3ae6d09&event=b1); its saved continuation has three consequences (1150, 1310, 1380).
- **Complete Beringia Scene → SAM cutout:** [Open the Beringia root](http://127.0.0.1:3000/#run=beringia&event=b2) and switch from **Scene** to **SAM cutout** to see the full sled subject with frame margin. This is the recommended saved SAM example.
- **Additional 1645 nonhero SAM record:** [Open the saved event](http://127.0.0.1:3000/#run=c892b8d0-36c5-4eeb-a70b-022041a25c98&event=b4) to inspect the packaged cutout. Its source scene already clips the foreground animal at the right edge, and the saved cutout preserves that crop; this is a recorded output, not viewer clipping.
- **Ram Setu root:** [Open the saved world](http://127.0.0.1:3000/#run=04f9af4a-f4ee-48da-b8d6-85e73373452a). Its illustrative geography retains its uncertainty note; this example has no 3D model.

## How it works

| Step | Model or implementation | Source |
| --- | --- | --- |
| Check prompts, branches, and continuation context | Deterministic keyword rules + **Muse Spark 1.3** (`muse-spark-1.3`) | `src/guardrails/topicPolicy.js` |
| Propose and review branches, select a hero, and attach scenario geography | **Muse Wonder** (`muse-wonder-1.0`) | `src/agents/branchAgent.js`, `src/demo/pipeline.js` |
| Continue selected paths and validate continuation ancestry | **Muse Wonder** (`muse-wonder-1.0`), checked by keyword guardrails | `src/demo/continuation.js`, `src/demo/pipeline.js` |
| Render hero and per-event scenes; store reusable event scenes | **Muse Image** (`muse-image-1.0`) | `src/demo/pipeline.js`, `src/demo/eventSceneStore.js` |
| Isolate hero and per-event subject cutouts; store reusable event cutouts | **SAM 3.1** (`sam-3.1`) | `src/demo/pipeline.js`, `src/demo/eventCutoutStore.js` |
| Transcribe optional push-to-talk voice prompts | **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`) | `src/providers/metaVoice.js`, `web/voice.js` |
| Supply the four curated root 3D objects | **Meta SAM 3D Objects**, generated separately through the preexisting private Tattva runner | Attached with `scripts/attach-glb.js`; provenance recorded in each replay trace |
| Explore the results | Hackathon-built exploration tree, spatial starmap, scenario geography globe, and 3D viewer | `web/` and `server/` |

The four curated root runs (`alexandria`, `beringia`, `green-sahara`, `mechanisms`) retain their actual recorded **Muse Wonder** policy attribution rather than relabeling older traces as Spark runs. When an event is selected, the app keeps that event in view, loads or generates its matching scene and immediate consequences, and prefetches scenes **only** for those immediate children (`sceneOnly`) without recursively expanding child consequences until the user clicks a child event.

The four SAM 3D Objects replays (`alexandria`, `beringia`, `green-sahara`, `mechanisms`) contain genuine attached `.glb` and `.meshopt.glb` meshes with recorded generation durations and unknown generation costs left `null`; they do not claim an automated public prompt-to-SAM-3D service. Non-hero events and newly generated continuations explain clearly in the UI when a 3D object is not available.

Divergence points stay in science, technology, culture, and geography. Political and war topics are out of scope by design (`src/guardrails/`).

## Run it locally

### 1. Credential-free replay and offline test suite

Replay mode and the offline test suite require no API keys or private services. Use Node **22.9.0 or newer** (CI runs on Node 22):

```bash
npm ci --ignore-scripts
npm test
npm run demo           # http://127.0.0.1:3000 (replay-only when META_API_KEY is unset)
```

Without `META_API_KEY`, `npm run demo` starts cleanly in replay-only mode (`Showing saved runs · live generation disabled`). You can explore the saved stories, switch between **Scene**, **SAM cutout**, and **3D object** across all four curated worlds, inspect the exploration tree and spatial map, and compare present-day vs. scenario geography.

### 2. Local live exploration with a Meta Model API key

To enable fresh local branching, event continuations, event scene generation, SAM 3.1 cutouts, and voice prompt transcription with your own Meta Model API key:

1. Copy `.env.example` to `.env` (in a new clone; preserve any existing `.env` and `out/spend.json`) and set `META_API_KEY` on the server. API keys stay strictly server-side and are never placed in browser storage, URLs, logs, or Git.
2. Review `META_SPEND_CAP_USD` (cumulative ledger ceiling enforced across all calls via `out/spend.json`) and optional `DEMO_DAILY_CAP_USD` (defaults to `META_SPEND_CAP_USD` when unset). Do not delete or reset an existing `out/spend.json` ledger.
3. Start the server on loopback:

```bash
npm run demo           # http://127.0.0.1:3000
```

When `META_API_KEY` is configured and the server binds to loopback (`127.0.0.1`), `npm run demo` automatically enables local browser access (`localReviewAccess`), voice dictation (`DEMO_VOICE_ENABLED=true` by default), and persistent continuations under `out/`, governed by `META_SPEND_CAP_USD` and `DEMO_DAILY_CAP_USD`. If you set `DEMO_ACCESS_CODE` on a non-loopback host, enter that access code in the UI's **Access code** field.

Fresh Meta image spend is reserved at `$0.01` per image by default. `.env.example` uses this application estimate; set `META_IMAGE_COST_USD` explicitly if you want a different conservative estimate. This is a ledger estimate, not a provider invoice.

With `META_API_KEY` configured and `HOST=127.0.0.1`, local live mode allows up to 60 requests per IP per minute by default; other configurations default to 5. Set `DEMO_RATE_LIMIT` to override with a positive integer. Generation routes share a bucket; voice has a separate bucket. This request throttle is separate from cumulative and daily Meta spend ceilings.

Continuation paths support up to six selected events. A seventh continuation is rejected with an explicit depth-limit message; saved ancestors remain available to inspect or continue from an earlier point.

You can also run the CLI harness directly:

```bash
npm run harness -- "What if the Library of Alexandria never burned?" --no-3d
# Reuse a saved branch run without paying for the agent again:
npm run harness -- --from out/branch-<timestamp>.json --no-3d
# Retry segmentation on a saved branch with a specific concrete noun:
npm run harness -- --from out/branch-<timestamp>.json --subject book --no-3d
```

### What works with a Meta key vs. optional private 3D

- **Works with `META_API_KEY` alone (`DEMO_3D_ENABLED=false` or `--no-3d`):** Prompt/branch topic checks (**Muse Spark 1.3**), counterfactual branch generation, consistency review, persistent multi-step event continuations, and structured scenario geography (**Muse Wonder**), hero and event scene generation (**Muse Image**), hero and event subject cutouts (**SAM 3.1**), and push-to-talk prompt transcription (**Muse Voice Transcribe**).
- **Requires separate private 3D infrastructure:** A Meta Model API key does not supply credentials for the preexisting private Tattva/Chronos 3D service. The public live adapter (`src/providers/chronos3d.js`) supports **TRELLIS only** when `CHRONOS_3D_ENDPOINT` and `CHRONOS_API_TOKEN` are configured, while the four saved **SAM 3D Objects** assets were generated separately through the private Tattva runner and attached with `npm run attach-glb`. See [judge access and 3D scope](docs/JUDGE_ACCESS_PLAN.md); fresh private SAM 3D generation is not part of the judge path.

The release video [`office-of-otherwise-submission-1080p-v2.mp4`](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-submission-2026-10-31/office-of-otherwise-submission-1080p-v2.mp4) is 158.28 seconds, 1920×1080, 25 fps (SHA-256 `0C72D0DDE6E25AAF601ECAA80DFB313E55D59317B8B7773703B4EA95221D7F9E`). It is an edited saved-result walkthrough with six replay-only UI chapters and two locally authored title cards; chapter 05 shows the complete saved Beringia root sled cutout. No fresh model generation, transcription, or classification is filmed.

## Metering, provenance, and third-party notices

All Meta calls go through one shared client (`src/lib/metaClient.js`) backed by atomic reservations in `out/spend.json`. Muse Image defaults to `$0.01` per image; SAM 3.1 defaults to a conservative `$0.05` estimate per call (Meta lists `$2.50` per 1,000 images on its [SAM 3.1 model page](https://dev.meta.ai/models/sam-3-1)); Muse Voice Transcribe reserves at `$0.18` per audio hour; Wonder and Spark use published token rates. Failed or interrupted dispatches remain recorded as uncertain rather than silently retried.

PNG encoding uses Node's built-in `zlib`; decoding uses MIT-licensed `pngjs`. SAM mask decoding uses `@meta-sam/parser` under Meta's **SAM License**. See [third-party notices](THIRD_PARTY_NOTICES.md).

## Relationship to Chronos / Tattva3d.ai

**Tattva3d.ai / Chronos predates the hackathon.** Its private 3D reconstruction backend, authentication, and GPU infrastructure are existing platform context and are excluded from this repository. The four saved SAM 3D Objects meshes were generated on that private infrastructure and attached here with validated provenance.

## Built during the hackathon

Hackathon work begins with functional commit `ba7110f` (**2026-10-26 13:38:22 -04:00 EDT**, after the noon kickoff; `53a83c0` is a pre-kickoff scaffold) and includes Meta Model API providers and the shared spend ledger, topic guardrails, Wonder branching and continuation agents, event scene and cutout runners, voice transcription, scenario geography masks and the Ram Setu regional inset, the interactive exploration tree and spatial starmap, the 3D globe and GLB viewer, and provenance display. The preexisting private Tattva/Chronos 3D infrastructure is excluded, as described above. See [docs/HACKATHON.md](docs/HACKATHON.md), [docs/SUBMISSION.md](docs/SUBMISSION.md), and [docs/CONTINUATION.md](docs/CONTINUATION.md).

The October 31 implementation release was integrated through PR #8. The corrective source release documents local judge access; its exact commit and source-package identity are recorded in the release verification asset. The video tag and earlier capture provenance remain unchanged. PR #7 remains open, draft and unmerged, and its parked pilot source on `develop` is preserved. The hackathon entry remains unsubmitted.

## License

Independently authored application code: all rights reserved; see [LICENSE](LICENSE). Dependencies and third-party assets retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Earlier versions distributed under MIT remain subject to the permissions granted for those versions.
