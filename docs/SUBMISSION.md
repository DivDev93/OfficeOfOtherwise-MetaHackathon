# Submission draft

**Public replay demo:** [Office of Otherwise](https://office-otherwise-875096283797.northamerica-northeast2.run.app) (deployed revision `office-otherwise-00001-84n`; replay-only, live generation disabled)

## Project description

Office of Otherwise is a Meta-powered branching layer for Chronos, an alternate-history explorer. Start with a question about science, technology, culture or geography; the system checks the topic, proposes geographically anchored branches, reviews them for consistency and selects a hero scene. Muse Spark 1.3 handles the current topic-policy path; Muse Wonder proposes and reviews branches. Muse Image renders the hero scene, while SAM 3.1 isolates a subject. Alexandria, Beringia, Green Sahara and Mechanisms each include a separately generated SAM 3D Objects model, with the actual generation time recorded and unknown cost left null. The browser prefers Meshopt-compressed copies while retaining each original GLB: Alexandria loads as 2,628,148 bytes instead of 13,385,656 bytes, an 80.4% reduction. All eight model files bring the cached demo archive to 52,811,787 bytes under its 80 MB limit. The orrery cutout missed some thin components. Chronos, including its globe, accounts, credits and 3D infrastructure, existed before the event. The proposed product uses credits to support interactive exploration.

## Built during the hackathon

Public repository: https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon

All four curated replays record SAM 3D Objects as `3D: Meta SAM 3D Objects (via Tattva Cloud Run)`; the models were generated separately and attached to the cached runs. This repository provides validated attachment and provenance display, not the provider service.

The first functional commit after the 2026-10-26 12:00 ET kickoff is `ba7110f`, authored 2026-10-26 13:38:22 -04:00 (Eastern Daylight Time). The earlier scaffold `53a83c0` predates kickoff and has no functional code. The working range is `ba7110f` through `HEAD`, inclusive; resolve `HEAD` to the final integration commit and verify ancestry before submission. Inspect with `git log --reverse --format="%h %aI %s"`.

Muse Spark 1.3 handles current prompt and per-branch topic-policy checks; Muse Wonder proposes and reviews branches; Muse Image generates the hero scene; SAM 3.1 generates the subject mask; Meta SAM 3D Objects supplies the separately generated replay models. Older cached traces retain the model and timing/cost information actually recorded at generation time, including Muse Wonder policy calls. The hosted demo is replay-only and the simulated guardrail fixture is not a live Muse verdict.

## Judge setup

1. Install Node 22 (at least 22.9.0), clone the public repository and run `npm ci --ignore-scripts` and `npm test`.
2. Open the public replay demo above or run `npm run demo` for local replay. Alexandria, Beringia, Green Sahara and Mechanisms are completed 3D replays. The hosted deployment does not enable live model generation.
3. For optional local live work, copy `.env.example` to `.env`, provide credentials privately, initialize the task checkpoint once using `npm run init-demo-budget`, and configure verified Chronos capability. For 2D-only generation use `npm run harness -- "What if the Library of Alexandria never burned?" --no-3d`. These commands make metered calls. Do not put credentials in the repository or submission.
