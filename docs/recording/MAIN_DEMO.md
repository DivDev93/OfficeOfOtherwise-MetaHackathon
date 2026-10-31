# Video production records — Full-HD release video and preserved drafts (October 31, 2026)

## 1. Full-HD release video (`office-of-otherwise-submission-1080p-v2.mp4`)

The v2 video at `out/main-submission-20261030/fullhd-local-browser-video-20261031/office-of-otherwise-submission-1080p-v2.mp4` is an edited saved-result walkthrough recorded from the local submission candidate based on `main` **`dbb24e4a50ba70dc66a0d3e4022c7a82121876cf`**; that capture source was an uncommitted local state at recording time. The released source is the reviewed integration on `main`. The video contains six replay-only UI chapters recorded in isolated Chrome at native 25 fps, followed by locally authored provenance and end cards. No fresh model generation, voice transcription, or policy classification is filmed. It preserves the full 1920×1080 screen without crop or enlargement.

The public GitHub release is [office-of-otherwise-submission-1080p-v2.mp4](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-submission-2026-10-31/office-of-otherwise-submission-1080p-v2.mp4), published under tag `hackathon-submission-2026-10-31`.

- **Duration**: `158.280` seconds (`2:38.28`, `3,957` frames at `25 fps`; under the `3:00` limit)
- **Format**: `1920 × 1080`, H.264 (`yuv420p`), AAC audio at `48 kHz`, MP4 faststart
- **Size**: `27,196,926` bytes
- **SHA-256**: `0C72D0DDE6E25AAF601ECAA80DFB313E55D59317B8B7773703B4EA95221D7F9E`
- **Verification**: `out/main-submission-20261030/fullhd-local-browser-video-20261031/verification-v2.json`; full FFmpeg decode passed, and the final contact sheet is `review-stills/final-temporal-v2-4s-contact.png`. The right-panel crop was checked on 2,335 frames from chapters 01–05: mean luma ranged 19.18–59.26, with no frames below 5. Selected-world title/header pixels were also checked per native frame in five static intervals (201 opening frames, then 76 frames per interval); their ROI mean-luma ranges are recorded in `review-stills/title-roi-temporal-v2-review.json`. The full-screen lightbox interval is excluded because it intentionally covers the background UI. These pixel metrics check persistence/blanking, not every content detail, and do not replace visual review.
- **Captions and transcript**: `captions.srt`, `captions.vtt`, and `transcript.txt` in the same directory. Their chapter timing follows the 158.267-second narration manifest; the encoded video lasts 158.280 seconds at 25 fps.
- **Source and editing**: The source is `native-video/browser-session.webm` (isolated local Chrome, 1920×1080, 25 fps). The final edit trims six saved-result replay chapters, with authored PNG title cards for chapters 07–08. Full-frame scenes, the lightbox, exploration map, the complete saved Beringia root sled cutout, and all four saved meshes appear. Capture manifests, source segment timing, audio provenance, and the edit map are in the same output directory. Intervening operator time is omitted; this is not a continuous or live-generation recording.

| Beat | Title | Duration | Cumulative window |
| --- | --- | ---: | --- |
| `01` | Explore a Counterfactual World | `18.700 s` | `0:00.00–0:18.70` |
| `02` | Follow a Chain of Consequences | `19.500 s` | `0:18.70–0:38.20` |
| `03` | Branch Back and Open the Exploration Map | `18.300 s` | `0:38.20–0:56.50` |
| `04` | Scenario Geography vs. Present Day | `17.000 s` | `0:56.50–1:13.50` |
| `05` | SAM 3.1 Subject Cutouts and Guardrailed Input | `19.833 s` | `1:13.50–1:33.33` |
| `06` | Four Saved SAM 3D Objects Worlds | `21.000 s` | `1:33.33–1:54.33` |
| `07` | Provenance and Architecture Boundary (authored card) | `23.033 s` | `1:54.33–2:17.37` |
| `08` | Build for Your World (authored card) | `20.900 s` | `2:17.37–2:38.28` |

The prior `158.280 s` v1 candidate (`out/main-submission-20261030/fullhd-local-browser-video-20261031/office-of-otherwise-submission-1080p.mp4`) is preserved unchanged; its selected continuation cutout truncated the animal at the head, so v2 uses the complete saved Beringia root sled cutout. The earlier `169.233 s` Full-HD candidate (`out/main-submission-20261030/fullhd-video-20261030/office-of-otherwise-fullhd-demo.mp4`) is superseded for right-panel flicker and also preserved unchanged. Neither superseded candidate is for upload. The earlier 1280×720 draft and older production drafts follow.
## 2. Superseded 1280×720 predecessor (`office-of-otherwise-candidate-demo-20261030.mp4`)

The former local candidate video at `out/main-submission-20261030/candidate-video-20261030/office-of-otherwise-candidate-demo-20261030.mp4` is superseded and retained unchanged for historical provenance. It was a 1280×720 saved-result walkthrough of the uncommitted candidate based on `main` **`dbb24e4a50ba70dc66a0d3e4022c7a82121876cf`**, with eight replay-only browser captures and no fresh model generation, voice transcription, or policy classification filmed. Its detailed review record follows:

- **Complete exploration loop**: Starting from a counterfactual premise (`beringia`), selecting an event (`900 CE · Reindeer Herders Cross Continents`), viewing its `Muse Image` scene and full-size lightbox, following three successive consequence choices (`1380 CE` → `1472 CE` → `1538 CE`) with immediate child scene-only prefetching, returning to an earlier event (`1080 CE · Rotating Lichen Pastures Sustain Herds`) to explore another branch without duplicate generation, and opening the spatial **Exploration map** popover.
- **Scenario vs. present-day geography**: Comparing `Scenario` and `Present day` surfaces on the **Green Sahara** 3D globe and the **Ram Setu / Palk Strait** regional comparison inset.
- **SAM 3.1 subject cutouts & guardrailed input**: Inspecting a saved `SAM 3.1` cutout on a continuation event (`1645 CE · Interior Pastures Improve Sled Reindeer`), showing push-to-talk **Muse Voice Transcribe** in the prompt bar, and showing the **Muse Spark** topic guardrail reframe flow.
- **All four saved SAM 3D Objects worlds**: Switching across **Alexandria** (`350 CE` geared bronze orrery), **Beringia** (`900 CE` carved driftwood sled), **Green Sahara** (`2800 BCE` Mega-Chad reed sailboat), and **Mechanisms** (`70 BCE` geared brass tide calculator) in `3D object` view with `Orbit object` enabled after fixing the hidden-container camera/resize defect in `web/visuals.js` and `web/app.js`.
- **Provenance & architectural boundary**: Displaying recorded model provenance and the explicit boundary between new hackathon Meta work and the preexisting private Tattva 3D backend.

**Historical status for this superseded video:** It was recorded from an uncommitted working-tree state based on the `main` commit above and was never released. PR #7 remains open, draft, and unmerged. This predecessor is retained for provenance and must not be uploaded.

### Candidate video specifications & checksums

- **Directory**: `out/main-submission-20261030/candidate-video-20261030/`
- **File**: `office-of-otherwise-candidate-demo-20261030.mp4`
- **Size**: `11,560,322` bytes (`11.56 MB`)
- **Duration**: `158.267` seconds (`2:38.27`, `4,748` frames at `30 fps`, well under the `3:00` limit)
- **Format**: `1280 × 720`, H.264 (`yuv420p`, `tv` range, `bt709`), AAC audio at `48 kHz` (`mean_volume: -16.9 dB`, `max_volume: -1.5 dB`), MP4 `faststart` (`moov` before `mdat`)
- **SHA-256 (`office-of-otherwise-candidate-demo-20261030.mp4`)**: `8b024452cd52def9a2956daab404a8f5a03d303a67f65d9bef25d5b0aec570ec`

| Beat | Title | Speech duration | Beat duration | Cumulative window |
| --- | --- | ---: | ---: | --- |
| `01` | Explore a Counterfactual World | `17.920 s` | `18.700 s` | `0:00.00–0:18.70` |
| `02` | Follow a Chain of Consequences | `18.745 s` | `19.500 s` | `0:18.70–0:38.20` |
| `03` | Branch Back and Open the Exploration Map | `17.545 s` | `18.300 s` | `0:38.20–0:56.50` |
| `04` | Scenario Geography vs. Present Day | `14.845 s` | `17.000 s` | `0:56.50–1:13.50` |
| `05` | SAM 3.1 Subject Cutouts and Guardrailed Input | `19.070 s` | `19.833 s` | `1:13.50–1:33.33` |
| `06` | Four Saved SAM 3D Objects Worlds | `18.075 s` | `21.000 s` | `1:33.33–1:54.33` |
| `07` | Provenance and Architecture Boundary | `22.270 s` | `23.033 s` | `1:54.33–2:17.37` |
| `08` | Build for Your World | `17.645 s` | `20.900 s` | `2:17.37–2:38.27` |

### Narration, captions, and verification

- **Offline neural narration**: Generated locally on CPU with **Kokoro-82M** (`onnx-community/Kokoro-82M-v1.0-ONNX`, model SHA-256 `8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb`, voice `af_heart`, fp32, speed 1.0) for video production only, outside the Meta-powered application.
- **Measured sentence captions**: `candidate-captions.srt`, `candidate-captions.vtt`, and `candidate-transcript.txt` derive directly from the 24 kHz PCM sample counts of each synthesized sentence plus explicit 120 ms inter-sentence gaps.
- **Media verification**: Full ffmpeg decode, container box order (`moov` before `mdat`), audio loudness (`-16.9 dBFS` mean, `-1.5 dBFS` peak), 11 full-resolution stills (`still-01-opening.jpg` through `still-08-ending.jpg`, including `still-06a` through `still-06d` for all four 3D worlds), and a 12-frame contact sheet (`candidate-contact-sheet.jpg`) are recorded in `candidate-verification.json`. These checks verify the encoded media and captured replay UI; they do not establish fresh live model calls or independent service availability.

---

## 3. Other preserved earlier drafts in `out/main-submission-20261030/`

Both earlier local drafts remain untouched for historical reference:

1. **Earlier `main`-only neural draft (`out/main-submission-20261030/neural-voice/`)**:
   - Recorded against pre-reconciliation `main` (`dbb24e4a50ba70dc66a0d3e4022c7a82121876cf`) before the continuation workbench, geography overlays, and 3D viewer blank-canvas fix were reconciled.
   - `office-of-otherwise-main-demo-neural-draft-20261030.mp4` (`173.100 s`, `12,461,014` bytes, SHA-256 `678002cc6770b20217126dad8683f2c7dccb2973246524b96291b45c87baa821`).
   - `office-of-otherwise-main-neural-draft-submission-20261030.zip` (SHA-256 `139f0cba9c1bfc668796a16af539d0847eb418724fd4f5f2bc97243effe6319c`).
2. **Rejected Microsoft Zira draft (`out/main-submission-20261030/`)**:
   - Rejected by the operator for robotic SAPI narration quality; retained only as historical evidence.
   - `office-of-otherwise-main-demo-20261030.mp4` (`171.100 s`, SHA-256 `92e2410fc79de1f73d1ed2c81678858bec80347b3dbe1ffbd083393698ab64dd`).
   - `office-of-otherwise-main-submission-20261030.zip` (SHA-256 `7f1544e1031d1bbaaecaa1352a6fa381695dce94256392aca14eb213b56bd103`).
