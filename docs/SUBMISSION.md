# Submission draft

**Live demo:** [link pending deployment and verification]

## Project description

Office of Otherwise is a Meta-powered branching layer for Chronos, an alternate-history explorer. Start with a question about science, technology, culture or geography; the system checks the topic, proposes geographically anchored branches, reviews them for consistency and selects a hero scene. Muse Wonder performs the planning and review. Muse Image renders the scene, while SAM 3.1 isolates a subject for a possible 3D handoff. The pipeline records model, timing and estimated cost information so its work can be inspected. The existing local harness has produced an image and cutout in a fresh-agent run; the orrery cutout missed some thin components. A globe demo, replay assets and a 3D handoff are being developed and must be verified before they are presented as working. Chronos, including its globe, accounts, credits and 3D infrastructure, existed before the event. The proposed product uses credits to support interactive exploration.

## Built during the hackathon

Public repository: https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon

The first functional commit after the 2026-10-26 12:00 ET kickoff is `ba7110f`, authored 2026-10-26 13:38:22 -04:00 (Eastern Daylight Time). The earlier scaffold `53a83c0` predates kickoff and has no functional code. The working range is `ba7110f` through `HEAD`, inclusive; resolve `HEAD` to the final integration commit and verify ancestry before submission. Inspect with `git log --reverse --format="%h %aI %s"`.

Muse Wonder handles topic classification, branch proposal and review; Muse Image generates the hero scene; SAM 3.1 generates the subject mask. Muse Spark narration is planned, not implemented. The proposed TRELLIS handoff uses existing Chronos infrastructure and is not a Meta model.

## Judge setup

1. Install Node 22 (at least 22.9.0), clone the public repository and run `npm ci --ignore-scripts` and `npm test`.
2. Run `npm run demo` for local replay. Alexandria is currently a provisional 2D preview, not a completed 3D replay. The 3D handoff and public link require verification.
3. For live work, copy `.env.example` to `.env`, provide credentials privately, initialize the task checkpoint once using `npm run init-demo-budget`, and configure verified Chronos capability. For 2D-only generation use `npm run harness -- "What if the Library of Alexandria never burned?" --no-3d`. These commands make metered calls. Do not put credentials in the repository or submission.
