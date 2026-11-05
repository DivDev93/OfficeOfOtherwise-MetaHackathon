# Submission package — Office of Otherwise

Office of Otherwise turns one “what if?” question into one alternate history that you scrub by date. Writers and worldbuilders weave suggestions into a chronological timeline with causes, scenes and illustrative geography.

Muse Wonder checks suggestions against the full history: each **fits**, or **conflicts** with a named event and an explanation. Fitting suggestions are woven in by date; conflicts fork through **What if instead…**. A right swipe in the deck weaves a fitting suggestion after its selection check. Wonder also checks batches together and proposes optional merges; conflicts and merges open review. Muse Spark 1.3 runs ripple checks after weaves to flag later events that may no longer fit, and rechecks cached suggestions as the history changes.

The **Chronicle** rail is organized by era. Muse Image supplies scenes, SAM 3.1 supplies cutouts, and the globe shows scenario geography as of the selected date. Geography is illustrative, not a scientific simulation or historical claim.

- **Project / team:** Office of Otherwise
- **Solo founder and sole contributor:** Divakar Dev
- **Startup stage:** Pre-launch, no users
- **Track:** Startups Track
- **Theme:** Build for Your World
- **Public repository:** [DivDev93/OfficeOfOtherwise-MetaHackathon](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon)

## Video

VIDEO_URL_TBD

## How Meta models power the core loop

| Role | Meta model | Implementation |
| --- | --- | --- |
| Frame a question with a title, divergence date and place | **Muse Wonder** (`muse-wonder-1.0`) | `src/demo/historyQuestion.js` |
| Generate dated suggestions, causes, eras, geography and fits/conflicts verdicts; propose fork replacements | **Muse Wonder** (`muse-wonder-1.0`) | `src/agents/historyAgent.js` |
| Check batch selections together, build chronological causal chains and propose optional merges | **Muse Wonder** (`muse-wonder-1.0`) | `src/agents/historyAgent.js` |
| Enforce topic policy | **Muse Spark 1.3** (`muse-spark-1.3`) + keyword guardrails | `src/guardrails/topicPolicy.js` |
| Check ripples after weaves and recheck cached suggestions against the current history | **Muse Spark 1.3** (`muse-spark-1.3`) | `src/agents/historyAgent.js` |
| Render event scenes | **Muse Image** (`muse-image-1.0`) | `src/demo/pipeline.js`, `src/demo/eventSceneStore.js` |
| Isolate subject cutouts | **SAM 3.1** (`sam-3.1`) | `src/demo/pipeline.js`, `src/demo/eventCutoutStore.js` |
| Transcribe optional push-to-talk prompts | **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`) | `src/providers/metaVoice.js`, `web/voice.js` |
| Four curated saved root 3D objects | **Meta SAM 3D Objects**, generated separately through the preexisting private Tattva runner | `scripts/attach-glb.js`; provenance in saved traces |

All Meta calls use the shared metered client and spend ledger. Cached suggestions and media are reused; hover previews read saved data. Topic guardrails exclude political and war content.

## Judge setup

Use **Node >= 22.9**. Clone the repository, then run:

```bash
npm ci --ignore-scripts
npm run demo
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

**Without a key:** browse saved histories and legacy stories, scrub dates, inspect cached suggestions, view saved scenes and cutouts, play available saved 3D objects, and explore scenario geography. Fresh model actions ask for a Meta key.

**Optional Meta key:** use the app’s **Meta API setup** panel (the key stays in local server memory for the session), or configure `META_API_KEY` in the ignored server-side `.env`. Review `META_SPEND_CAP_USD` before generating. Preserve the existing `.env` and `out/spend.json` ledger. A key enables fresh questions, suggestions, weave checks, forks, scenes, cutouts and voice transcription; fresh private 3D generation is outside the judge setup.

## Built during the hackathon vs. preexisting platform

Hackathon implementation begins with functional commit `ba7110f` on **October 26, 2026, 13:38:22 EDT**, after kickoff; `53a83c0` is a pre-kickoff scaffold. The work includes:

- History framing and suggestion agents, checked causal weaving, forks and ripple checks (`src/demo/historyQuestion.js`, `src/agents/historyAgent.js`, `server/`).
- The era-based Chronicle, date scrubber, swipe deck, scenario geography globe, scene/cutout display and saved 3D viewer (`web/`).
- Meta providers, topic policy, shared spend ledger, reusable scene/cutout storage and voice transcription (`src/providers/`, `src/guardrails/`, `src/lib/`, `src/demo/`).
- The earlier branching and continuation workbench, saved stories, validated GLB attachment and provenance display.

**Tattva3d.ai / Chronos is preexisting.** Its private 3D reconstruction backend, authentication and GPU infrastructure predate the hackathon and are excluded from this public repository. The four curated roots (`alexandria`, `beringia`, `green-sahara`, `mechanisms`) have attached **SAM 3D Objects** meshes (`.glb` and `.meshopt.glb`), with generation durations recorded and unknown costs left `null`. The public live adapter supports separately configured TRELLIS, not SAM 3D Objects. A Meta API key alone does not provide private 3D access.

See [the build log](HACKATHON.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).
