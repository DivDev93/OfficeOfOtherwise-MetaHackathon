# Office of Otherwise

**One question. One alternate history. Scrub through it by date.**

Office of Otherwise is a worldbuilding workbench for writers and worldbuilders. Ask a “what if?” question, then build one alternate history by weaving possibilities into its timeline. Muse Wonder checks each suggestion against the full timeline: it either **fits**, or **conflicts** with a named event and an explanation. Fitting suggestions are woven in by date with links to their causes; conflicts fork through **What if instead…**.

Swipe right in the suggestion deck to weave an event. Wonder checks the selected set together before insertion, with review for conflicts or proposed merges. Muse Spark 1.3 runs ripple checks after weaves to flag later events that may no longer fit. The **Chronicle** rail organizes events by era, while the globe shows scenario geography as of the selected date. Muse Image supplies scenes and SAM 3.1 supplies subject cutouts. Geography is illustrative, not a scientific simulation or historical claim.

Built for the **Meta Global AI Developer Hackathon** (October 26–November 4, 2026), **Startups Track**, theme **Build for Your World**. Divakar Dev is the solo founder and sole contributor. The project is **pre-launch, with no users**.

## Video

VIDEO_URL_TBD

## Judge setup

Use **Node >= 22.9**. Clone this repository, then run:

```bash
npm ci --ignore-scripts
npm run demo
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

**Without a key:** browse saved histories and stories, scrub dates, inspect cached suggestions, view saved scenes and cutouts, play available saved 3D objects, and explore scenario geography. Fresh model actions ask for a Meta key.

**Optional Meta key:** enter your key in the app’s **Meta API setup** panel (kept in local server memory for the session), or set `META_API_KEY` in the ignored server-side `.env`. Review `META_SPEND_CAP_USD` before generating; all Meta calls share that cumulative ceiling and the existing `out/spend.json` ledger. Preserve any existing `.env` and spend ledger. The key enables fresh questions, suggestions, weave checks, forks, scenes, cutouts and voice transcription. Fresh private 3D generation is outside the judge setup.

The offline test suite runs with `npm test` (`node --test "test/*.test.js"`) and requires no API key.

## How it works

| Step | Model or implementation | Source |
| --- | --- | --- |
| Frame a question with a title, divergence date and place | **Muse Wonder** (`muse-wonder-1.0`) | `src/demo/historyQuestion.js` |
| Suggest dated events with causes, eras, geography and fits/conflicts verdicts; propose replacements for forks | **Muse Wonder** (`muse-wonder-1.0`) | `src/agents/historyAgent.js` |
| Check a batch selection against the timeline and itself, build its causal chain, and propose optional merges | **Muse Wonder** (`muse-wonder-1.0`) | `src/agents/historyAgent.js` |
| Enforce topic policy | Keyword guardrails + **Muse Spark 1.3** (`muse-spark-1.3`) | `src/guardrails/topicPolicy.js` |
| Check ripples in later events after weaves and recheck cached suggestions against a changed history | **Muse Spark 1.3** (`muse-spark-1.3`) | `src/agents/historyAgent.js` |
| Render event scenes and reuse saved images | **Muse Image** (`muse-image-1.0`) | `src/demo/pipeline.js`, `src/demo/eventSceneStore.js` |
| Isolate subjects and reuse saved cutouts | **SAM 3.1** (`sam-3.1`) | `src/demo/pipeline.js`, `src/demo/eventCutoutStore.js` |
| Transcribe optional push-to-talk prompts | **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`) | `src/providers/metaVoice.js`, `web/voice.js` |
| Supply four curated saved root 3D objects | **Meta SAM 3D Objects**, generated separately through the preexisting private Tattva runner | `scripts/attach-glb.js`; provenance in saved traces |
| Scrub dates, weave events and explore geography | Chronicle rail, swipe deck, globe and media viewer | `web/`, `server/` |

Hover previews read saved data. With a key configured, auto-suggest prepares an uncached date window after scrubbing stops; scene preparation is bounded to the active window and committed selected event. Cached suggestions and media are reused. Ripple checks flag possible inconsistencies for a decision rather than silently rewriting later events.

Divergence points stay in science, technology, culture and geography. Political and war topics are excluded by the topic guardrails.

## Metering and third-party notices

All Meta calls use the shared metered client (`src/lib/metaClient.js`) and atomic reservations in `out/spend.json`. Cumulative and daily spend caps remain enforced; failed or interrupted dispatches are recorded as uncertain rather than silently retried.

PNG encoding uses Node’s built-in `zlib`; decoding uses MIT-licensed `pngjs`. SAM mask decoding uses `@meta-sam/parser` under Meta’s **SAM License**. See [third-party notices](THIRD_PARTY_NOTICES.md).

## Built during the hackathon

Hackathon work begins with functional commit `ba7110f` (**October 26, 2026, 13:38:22 EDT**, after the noon kickoff; `53a83c0` is a pre-kickoff scaffold). It includes the history question and suggestion agents, checked causal weaving and forks, Spark ripple checks, the era-based Chronicle and swipe deck, Meta providers and spend ledger, topic guardrails, scenes and cutouts, voice transcription, scenario geography, the globe and media viewers, and provenance display. See [the build log](docs/HACKATHON.md) and [submission details](docs/SUBMISSION.md).

**Tattva3d.ai / Chronos predates the hackathon.** Its private reconstruction backend, authentication and GPU infrastructure are excluded from this public repository. The four saved SAM 3D Objects meshes were generated there and attached with provenance; a Meta API key alone does not enable fresh private 3D jobs.

## Legacy saved stories

The earlier branching and continuation replay remains available as saved stories. Explore [Beringia](http://127.0.0.1:3000/#run=beringia&event=b2), [Alexandria](http://127.0.0.1:3000/#run=alexandria), [Green Sahara](http://127.0.0.1:3000/#run=green-sahara), or [Mechanisms](http://127.0.0.1:3000/#run=mechanisms) locally, with saved scenes, SAM cutouts and attached SAM 3D Objects meshes. Beringia includes saved continuations across multiple dates. These older traces retain their recorded model attribution, including Wonder policy checks. See [continuation details](docs/CONTINUATION.md).

## License

Independently authored application code: all rights reserved; see [LICENSE](LICENSE). Dependencies and third-party assets retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Earlier versions distributed under MIT remain subject to the permissions granted for those versions.
