# Hackathon submission fields

Prepared for operator review on October 31, 2026. These are paste-ready draft answers for the released project; nothing here has been pasted into or submitted through the form. The captured form snapshot showed no `maxlength` attributes on its text inputs or textareas; check the live form again before submission.

## Submission fields

### TeamName

Office of Otherwise

### Track

Startups Track

### Theme

Build for Your World

### ProjectDescription

Office of Otherwise is a counterfactual worldbuilding workbench for writers and worldbuilders. It turns one “what if?” premise into a navigable path of possible events: choose a turning point, follow its consequences with matching illustrative scenes, return to an earlier choice to explore another branch, and compare scenario geography with the present-day globe. The intended outcome is to help writers develop and communicate complex alternate-world ideas while keeping their choices and visuals together. Scenario geography is illustrative, not a scientific simulation or historical claim.

### PublicGitHubRepository

https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon

### 3MinuteDemoVideo

**Video:** `https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-submission-2026-10-31/office-of-otherwise-submission-1080p-v2.mp4`. It is 2:38.28 (SHA-256 `0C72D0DDE6E25AAF601ECAA80DFB313E55D59317B8B7773703B4EA95221D7F9E`) and shows six replay-only UI chapters plus two authored cards; chapter 05 shows the complete saved Beringia root sled cutout. It is edited saved-result playback; no fresh model generation, transcription, or policy classification is filmed. The v1 truncated cutout and earlier flickering cut are superseded and must not be uploaded.

### Describe your use of Meta products to build submitted project

Meta models power the project’s core creative loop. Muse Spark checks prompts and proposed branches against the project’s topic policy. Muse Wonder proposes and reviews alternate events, develops the selected path’s consequences, and produces structured scenario geography. Muse Image creates scenes for selected events, while SAM 3.1 makes subject cutouts; Muse Voice Transcribe optionally turns a spoken premise into editable text. These roles take a writer from an open-ended premise to a structured, visual path they can revisit and branch. Four saved root worlds also include SAM 3D Objects meshes generated separately through preexisting private Tattva infrastructure and attached here with provenance. The public project does not provide fresh prompt-to-SAM-3D generation.

### Why are Meta models important to your solution?

The workbench depends on models that can help turn an open-ended premise into a structured sequence of alternate events, then connect that sequence to visual material. Muse Wonder supports branch proposals, reviews, and selected-path consequences; Muse Spark applies the topic policy; Muse Image and SAM 3.1 add scenes and subject cutouts; Voice Transcribe offers spoken prompt entry. This division of model roles supports the central workflow from premise to navigable world, rather than adding an unrelated model feature. Scenario geography is illustrative, and saved 3D meshes are disclosed separately from the hackathon-built loop.

## Operator survey answers

Current paste-ready answers:

- Likelihood of building with Meta Model API: **Somewhat likely**
- Overall opinion of Meta AI / models: **Somewhat favorable**

## Consent and submission state

Consent remains **unchecked**. The form remains **unsubmitted**. This document records draft answers only; it does not record consent, eligibility confirmation, or acceptance by the hackathon. The public video URL resolves to the released v2 asset whose hash matches the local media verification receipt.

## Replay examples for review

These are local replay references, not additional form fields. Start `npm run demo` without `META_API_KEY`; the saved examples do not make model calls. For a fully framed saved SAM example, open the [Beringia root](http://127.0.0.1:3000/#run=beringia&event=b2) and switch from **Scene** to **SAM cutout**. The [README replay guide](../README.md#saved-replay-examples) also links the 900 → 1380 → 1472 → 1538 path, the 1080 Lichen alternate and its three saved consequences, and the Ram Setu root `/#run=04f9af4a-f4ee-48da-b8d6-85e73373452a`. The packaged 1645 nonhero SAM output remains available as a truthful saved record; its source scene already clips the foreground animal at the right frame edge.
