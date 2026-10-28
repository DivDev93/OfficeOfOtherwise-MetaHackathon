# Cached demo 3D handoff

## Current state

| Run | SAM 3D Objects status |
| --- | --- |
| `alexandria` | Generated and attached; 26,693 ms; 13,385,656 bytes. |
| `beringia` | Generated and attached; 20,429 ms; 4,414,028 bytes. |
| `green-sahara` | Generated and attached; 22,000 ms; 7,619,080 bytes. |
| `mechanisms` | Generated and attached; 557,283 ms; 6,973,908 bytes. |

All four replays display `3D: Meta SAM 3D Objects (via Tattva Cloud Run)`. Costs are unknown and remain null. The GLBs were generated separately; this repository validates and attaches a provided GLB but does not implement the generation service. The complete cached archive is 46,343,279 bytes (46.34 MB decimal), below the 80 MB cap.

The successful generation calls bypassed the MCP bridge through an authorized local runner outside this public repository. Each call used that run's cached `hero.png` and explicit `mask.png`, with a 40-minute client request timeout, including header and body timeouts. The first SAM request took 557.283 seconds including cold initialization; subsequent warm requests took 20–27 seconds. No service configuration, quotas or billing settings were changed.

For future model generation, use an authorized external runner, preserve its actual elapsed time and local GLB output, then attach the returned GLB with:

```powershell
npm run attach-glb -- <slug> <path-to-model.glb> --provider sam3dobjects --ms <actual-elapsed-ms>
```

The cache limit is 80 MB to fit the model assets. Replay completed runs through the local demo server after attachment.

## TRELLIS timeout clarification

Four TRELLIS HTTP POSTs returned HTTP 200; observed request latencies were 480.708s, 83.315s, 401.226s and 425.421s. Service summaries recorded `alexandria` and `green-sahara` under `ok` with an empty `failed` list. The earlier MCP callers timed out at their 300-second bridge limit while downstream requests were still running; `failed: []` means no failed jobs were listed. This explains the MCP errors without claiming a failed TRELLIS generation.
