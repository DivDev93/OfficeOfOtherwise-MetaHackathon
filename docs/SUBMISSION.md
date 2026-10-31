# Submission package — Office of Otherwise

- **Project / team:** Office of Otherwise
- **Sole contributor and startup representative:** Divakar Dev
- **Track:** Startups Track (operator confirmed startup representative eligibility)
- **Intended theme:** Build for Your World
- **Submission deadline:** November 4, 2026, 9:00 PM America/Toronto
- **Public repository:** [DivDev93/OfficeOfOtherwise-MetaHackathon](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon)
- **Local judge access:** Credential-free saved replay from a repository clone; use your own server-side Meta API key for fresh Meta functionality.
- **3-minute video:** [Download the v2 submission video](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-submission-2026-10-31/office-of-otherwise-submission-1080p-v2.mp4)

The public repository and v2 video are the judge-facing release artifacts. The replay runs locally; no hosted app is required or authorized. The hackathon entry remains unsubmitted and consent unchecked. PR #7 remains open, draft, and unmerged; the parked `develop` pilot source remains intact.

## Primary use and product story

Office of Otherwise is a counterfactual worldbuilding workbench for writers and worldbuilders. It turns one “what if?” premise into a navigable path of possible events: choose a turning point, follow its consequences with matching illustrative scenes, return to an earlier choice to explore another branch, and compare scenario geography with the present-day globe. The intended outcome is to help writers develop and communicate a complex alternate-world idea while keeping its choices and visuals together. Scenario geography is illustrative, not a scientific simulation or historical claim.

## How Meta models power the core loop

| Role in the exploration loop | Meta model | Implementation |
| --- | --- | --- |
| Topic policy check on prompts, branches, and continuations | **Muse Spark 1.3** (`muse-spark-1.3`) + keyword guardrails | `src/guardrails/topicPolicy.js` |
| Propose and review branches, select a hero, and attach structured scenario geography | **Muse Wonder** (`muse-wonder-1.0`) | `src/agents/branchAgent.js`, `src/demo/pipeline.js` |
| Continue selected events and validate saved ancestry | **Muse Wonder** (`muse-wonder-1.0`), checked by keyword guardrails | `src/demo/continuation.js`, `src/demo/pipeline.js` |
| Render the selected hero scene and per-event scenes (including immediate-child `sceneOnly` prefetch) | **Muse Image** (`muse-image-1.0`) | `src/demo/pipeline.js`, `src/demo/eventSceneStore.js` |
| Isolate hero subjects and per-event cutouts | **SAM 3.1** (`sam-3.1`) | `src/demo/pipeline.js`, `src/demo/eventCutoutStore.js` |
| Transcribe optional local push-to-talk voice prompts | **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`) | `src/providers/metaVoice.js`, `web/voice.js` |
| Four curated root 3D objects (`alexandria`, `beringia`, `green-sahara`, `mechanisms`) | **Meta SAM 3D Objects** (generated separately through preexisting private Tattva runner) | Validated and attached via `scripts/attach-glb.js` |

### Prefetch and exploration discipline

Selecting an event keeps that exact event selected, loads or generates its matching scene and immediate consequences automatically, and prefetches scenes **only** (`sceneOnly`) for those immediate children once they exist. It never recursively generates consequences for unselected children. Saved scenes, cutouts, and continuations reopen from disk without duplicate model calls.

### 3D verification and boundaries

All four curated saved roots (`alexandria`, `beringia`, `green-sahara`, `mechanisms`) include genuine **Meta SAM 3D Objects** meshes (`.glb` and `.meshopt.glb`), generated separately through the preexisting private Tattva runner and attached with validated provenance (durations recorded; unknown generation costs left `null`). The earlier repeated story/view switching blank-canvas defect in `web/visuals.js` and `web/app.js` was diagnosed (sizing/camera fitting while `#model-view` was hidden and stale URL state across resets) and fixed. A local headless Chrome check exercised repeated story and `Scene → SAM cutout → 3D object → Scene` switching across the four saved models; this is local replay verification, not a claim about freshly generated models or the hosted service. Non-hero events explain in the UI when a 3D object is unavailable.

## Built during the hackathon vs. preexisting platform

- **Hackathon implementation:** Work begins with functional commit `ba7110f` on 2026-10-26 13:38:22 -04:00 EDT (after kickoff; `53a83c0` is a pre-kickoff nonfunctional scaffold) and includes the following project components. This describes the hackathon work, not the full history of every file:
  - Meta Model API calls through the shared client and adapters (`src/lib/metaClient.js`, `src/providers/metaImage.js`, `src/providers/samMask.js`, `src/providers/metaVoice.js`) with a shared spend ledger (`src/lib/spendLedger.js`, `src/demo/budget.js`)
  - Topic policy guardrails (`src/guardrails/topicPolicy.js`)
  - Counterfactual branching and consistency review, persistent event continuations, and structured scenario geography (`src/agents/branchAgent.js`, `src/demo/pipeline.js`, `src/demo/continuation.js`); reusable scene and cutout storage (`src/demo/eventSceneStore.js`, `src/demo/eventCutoutStore.js`)
  - Interactive browser atlas, exploration tree, spatial exploration starmap popover, illustrative scenario geography surface comparison and Ram Setu regional inset, full-size scene lightbox, and Three.js 3D object viewer (`web/`, `server/`)
  - Validated GLB attachment (`scripts/attach-glb.js`) and per-step provenance display
- **Preexisting platform (`Tattva3d.ai` / `Chronos`):**
  - Private 3D reconstruction backend, authentication, and GPU infrastructure predate the hackathon and are excluded from this public repository.
  - The public live 3D adapter (`src/providers/chronos3d.js`) supports **TRELLIS only** when separately configured; it is not wired to SAM 3D Objects.
  - [`docs/JUDGE_ACCESS_PLAN.md`](JUDGE_ACCESS_PLAN.md) describes the saved-replay judge path; fresh private SAM 3D generation is not part of this submission.

## Historical Argon timing sample (October 30, 2026)

The following figures are the Argon-reported pre-takeover sample from October 30, 2026. They have not been independently recomputed and do not describe the current spend ledger or current cumulative spend. The `$22.0748` amount is that sample's reported cumulative spend; its then-reported `$143.30` ceiling is historical context only.

- **Muse Image (`muse-image-1.0`, `n = 43`):** provider duration min `12.5s`, median `25.3s`, mean `27.5s`, p90 `38.6s`, max `82.2s`.
- **Muse Wonder propose (`muse-wonder-1.0`, `n = 49`):** min `24.2s`, median `35.0s`, mean `36.8s`, p90 `49.7s`, max `55.8s`.
- **Muse Wonder review (`muse-wonder-1.0`, `n = 44`):** min `6.0s`, median `10.5s`, mean `10.9s`, p90 `14.1s`, max `25.7s`.
- **Muse Spark 1.3 policy (`muse-spark-1.3`, `n = 274`):** min `1.3s`, median `3.8s`, mean `5.4s`, p90 `9.3s`, max `41.0s`.
- **SAM 3.1 cutout (`sam-3.1`, `n = 48`):** min `0.01s`, median `4.2s`, mean `5.3s`, p90 `11.1s`, max `27.3s`.
- **Queue / concurrency bound:** Browser event jobs share a 3-slot queue (`MAX_EVENT_JOBS = 3`), overlapping the selected event's scene and consequence requests while deferring child scene prefetches (`sceneOnly`) until the selected event's consequences arrive. Saved scenes and consequences can reopen without duplicate provider calls; no response-time measurement is claimed here.

## Judge setup

1. **Credential-free saved replay:** Clone the public repository. On Node `>= 22.9.0`, run `npm ci --ignore-scripts` and `npm run demo`, then open `http://127.0.0.1:3000`. This reads the packaged records and makes no model calls.
2. **Fresh Meta exploration (optional):** Copy `.env.example` to an ignored local `.env`, set your own server-side `META_API_KEY`, review the configured `META_SPEND_CAP_USD` and optional `DEMO_DAILY_CAP_USD`, and run `npm run demo` on loopback. The key is not sent to the browser. No private Tattva credentials are included or needed for these Meta features.

## Release provenance

The implementation release was integrated through PR #8; the corrective source release documents local judge access. The release verification asset records the exact current source commit and package hash. The immutable October 31 video tag and its earlier capture provenance remain unchanged. PR #7 stays open, draft and unmerged, with the parked pilot source on `develop` preserved. The former cloud service and dedicated image repository were removed; no hosted app is required.

The corrected video is published as `office-of-otherwise-submission-1080p-v2.mp4` under release tag `hackathon-submission-2026-10-31`. Its SHA-256 is `0C72D0DDE6E25AAF601ECAA80DFB313E55D59317B8B7773703B4EA95221D7F9E`. The hackathon entry has not been submitted.
