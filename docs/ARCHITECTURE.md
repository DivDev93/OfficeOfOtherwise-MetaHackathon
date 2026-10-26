# Architecture

```
what-if prompt
   │
   ▼
topicPolicy (pre-check) ──✗──▶ polite refusal + suggested reframe
   │ ✓
   ▼
branchAgent (Muse Wonder)
   propose N branches → consistency check → topicPolicy (post-check) → pick hero scene
   │
   ├─▶ metaText (Muse Spark): streamed narration per branch
   │
   ▼
metaImage (Muse Image): scene render
   │
   ▼
samMask (SAM 3.1): subject mask
   │
   ▼
CHRONOS_3D_ENDPOINT (private Chronos pipeline): .glb object / splat world
```

## Contracts

These match the Chronos provider registry, so Chronos can register each provider as a `text` / `image` entry with no adapter.

- `metaText.generate({ prompt, system, stream }) → { text | AsyncIterable<string>, usage }`
- `metaImage.generate({ prompt, aspect }) → { buffer, mime, usage }`
- `samMask.segment({ image, prompt? }) → { maskPng, bbox, usage }`
- `branchAgent.run({ divergence, count }) → { branches[], hero, trace[] }`. `trace` drives the provenance badges in the UI.

## Cost control

Every call goes through one client that keeps a running total against `META_SPEND_CAP_USD` and refuses once the total reaches it. Demo content is generated once and cached; the live product rate-limits each session.
