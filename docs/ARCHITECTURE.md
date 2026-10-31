# Architecture

```
what-if prompt (typed or transcribed via Muse Voice Transcribe)
   │
   ▼
topicPolicy (keyword rules + Muse Spark 1.3 pre-check)
   ├── ✗ ──▶ polite refusal + suggested reframe
   │ ✓
   ▼
branchAgent (Muse Wonder)
   propose geo-anchored branches + scenario geography
   → consistency review → topicPolicy post-check → select hero
   │
   ├─▶ pipeline (Muse Image): render hero scene & on-demand/prefetched event scenes
   │     └─▶ eventSceneStore: persist/reopen event scenes
   │
   ├─▶ pipeline (SAM 3.1): isolate hero cutout & on-demand event cutouts
   │     └─▶ eventCutoutStore: persist/reopen event cutouts
   │
   ├─▶ continuation + pipeline (Muse Wonder + Muse Spark 1.3):
   │     on explicit event selection, generate immediate child consequences,
   │     then prefetch scenes ONLY for those immediate children (sceneOnly)
   │
   └─▶ 3D object view:
         • 4 curated roots: attached Meta SAM 3D Objects GLBs (.glb + .meshopt.glb)
         • optional live 3D adapter (CHRONOS_3D_ENDPOINT): TRELLIS-only when configured
```

## Core contracts

- `createMetaClient(...).respond({ model, input, instructions, ... })` in `src/lib/metaClient.js`, used by `src/demo/pipeline.js` for Meta calls (`muse-spark-1.3` / `muse-wonder-1.0`)
- `metaImage.generate({ prompt, aspect }) → { buffer, mime, usage }` (`muse-image-1.0`)
- `samMask.segment({ image, prompt }) → { maskPng, cutoutPng, score, bbox, usage }` (`sam-3.1`)
- `metaVoice.transcribe({ wavBuffer }) → { transcript, durationSeconds, costUsd, model, ms }` (`muse-voice-transcribe-1.0`)
- `createDemoRunner` in `src/demo/pipeline.js` runs branching and review; `continuationFor` in `src/demo/continuation.js` validates saved ancestry and continuation input
- `createDemoEventSceneRunner` / `createDemoEventCutoutRunner` in `src/demo/pipeline.js`, with `eventSceneStore.js` / `eventCutoutStore.js` for reusable results

## Prefetch and exploration boundary

1. Selecting an event keeps that exact event selected and updates the scene stage, scenario geography, and ancestry path.
2. The selected event's scene (`GET/POST /api/event-scene`) and immediate consequences (`POST /api/continue` or saved child manifest) load automatically.
3. Once an event's immediate consequences exist, `prefetchEventScenes` queues background `sceneOnly` jobs for those immediate children's scenes only.
4. Child consequences are **never** generated until the user explicitly selects that child event.

## Cost control and safety

Every Meta API call passes through `createMetaClient` (`src/lib/metaClient.js`) and `configuredSpendCap` / `configuredDailyCap` (`src/demo/budget.js`), backed by atomic file reservations in `out/spend.json`. API keys remain strictly server-side; tests use deterministic local fixtures and never make live network calls.
