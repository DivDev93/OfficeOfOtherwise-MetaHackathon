# Chronicle demo recording — November 4, 2026

The 2:50 local demo shows the current Chronicle history model using the saved “What if Buddhism Spread to Arabia” history. Source: main `a9e097932107f167f85c5b61d0df3590ca0cdced`. Playwright used a fresh Chromium profile at 1920×1080, with a disposable copy of saved history. The configured local Meta key and existing spend ledger were used; generation requests were blocked before dispatch. The ledger was unchanged, for $0.00 additional Meta spend.

The capture shows the Chronicle rail, a slow timebar drag, a saved scene, a cached suggestion deck with verdict, and the Atlas. The Arabia history had no cached SAM cutout, so the cutout tab shows its unavailable state. Cached suggestion revisions were stale, so no suggestion was woven and no new pin is shown. Narration remains as requested over the closest available shots.

Narration was generated locally on CPU using Kokoro-82M `af_heart`; captions are burned in from sample-timed narration text. The video is 1920×1080, 30 fps, H.264 (`veryfast`) with AAC audio. The first narration passage runs to 16.015 seconds, so the second beat begins at 16.1 seconds. The browser source was recorded at 25 fps and converted to 30 fps, with the last frame padded to 170 seconds. Capture evidence, source, captions, transcript and encoding logs are preserved under the ignored `out/final-demo-20261104/` directory.

## V3 — tightened Chronicle demo

The v3 edit runs 102.015 seconds, using the same Kokoro `af_heart` narration and sentence-timed burned captions. It removes the long silent holds and adds eased close-ups of the Chronicle, scene and suggestion deck. The source includes the earlier 100% browser capture and a fresh, disposable-history capture of a real suggestion check and weave; it does not demonstrate the requested 125% browser capture or a completed SAM cutout. The copied history gained the 1762 CE Jeddah Tidal Almanac event and its ripple check. The original saved history was not changed.

A SAM 3.1 attempt on the copied history returned an empty result, including its one provider fallback; no cutout was produced. Shared-ledger task spend was $0.133254: $0.019472 for Wonder, $0.013782 for Spark and $0.100000 for two SAM requests. The previously existing reservation remained unchanged. The 1920×1080 video is H.264 at 30 fps, encoded with `veryfast`, with AAC audio. Source clips, captions and evidence are in ignored `out/chronicle-v3/`.
