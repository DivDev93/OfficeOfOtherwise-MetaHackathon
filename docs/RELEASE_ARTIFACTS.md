# Published review artifacts — 2026-10-30

The public [hackathon review prerelease](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/tag/hackathon-preview-2026-10-30) was published on **2026-10-30**, targeting `925c110064503f25fcb6fbfa81c3344668299105`. It is a prerelease for review. [Integration PR #7](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/pull/7) remains draft; the release does not merge the work or submit the hackathon entry.

| Download | Size / runtime | Scope |
|---|---|---|
| [Primary demonstration MP4](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-preview-2026-10-30/office-of-otherwise-judge-primary.mp4) | 11,085,903 bytes; 2:58.733 | Synthetic narration over saved-story replay: a speculative-fiction worldbuilder compares paths, inspects sources and assumptions, exports a brief, and explores an illustrative saved 3D object. Persistent replay labeling; no live generation claim. |
| [Fresh-generation proof MP4](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-preview-2026-10-30/office-of-otherwise-fresh-proof.mp4) | 2,884,211 bytes; 1:20.333 | Silent edited composite: 70 seconds continuous real-time generation, then 10.333 seconds of separately captured, labeled same-run source review. No 3D call. |
| [Complete judge package ZIP](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-preview-2026-10-30/office-of-otherwise-judge-package-20261030.zip) | 14,783,558 bytes | Both videos, caption files, exact transcript, chapter timings, thumbnails, actual fresh-run brief, publication text, credits, notices, edit provenance and SHA-256 manifest. |
| [Source snapshot ZIP](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-preview-2026-10-30/office-of-otherwise-source-925c110.zip) | 52,384,092 bytes | Public tracked repository files at `925c110`; excludes credentials, installed dependencies, ignored raw outputs and private reconstruction backend code. |
| [SRT captions](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-preview-2026-10-30/primary-captions.srt) / [VTT captions](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-preview-2026-10-30/primary-captions.vtt) | Primary narration | Import beside the primary MP4; synthetic speech word positions normalized to the encoded audio clock. |
| [Exact transcript](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-preview-2026-10-30/primary-transcript.txt) | Eight chapters | Spoken text and chapter start times. |
| [Fresh-run scenario brief](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-preview-2026-10-30/fresh-run-scenario-brief.md) | Exported Markdown | Actual export from run `1793334705465`, retaining source quotations, imagined assumptions, uncertainty and comparison. |
| [Media licensing and credits](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-preview-2026-10-30/LICENSE_AND_CREDITS.md) / [package checksums](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-preview-2026-10-30/SHA256SUMS.txt) | Companion records | Attribution and license boundaries; checksums of the 27 files inside the judge package. The ZIP and source-archive hashes are recorded below. |

| Artifact | SHA-256 |
|---|---|
| Primary MP4 | `d239e1a0f8292ef016266eb4d92689201ae93a02405d4e1cb7b042449e0351b8` |
| Fresh-proof MP4 | `01b070b6c89a59da928b65f1e3a8c17f24eebcf2f3882ed5eb371d0a70f93d1b` |
| Judge package ZIP | `864bed1ff4a0fb5bc7ddf15d616c62d2ec0f5bc7ee99cef2327343f701bf94f7` |
| Source snapshot ZIP | `80e59544b59ef1b2a166218a5fc911a48ead2136500eef8f100337f2c7baec56` |

## Event-built scope

The pre-kickoff baseline is [`53a83c0`](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/commit/53a83c0), **2026-10-26 at 09:17 EDT**: README, license, CI secret scan and repository structure, with no functional code. Kickoff was **12:00 PM EDT** that day. Functional implementation begins with [`ba7110f`](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/commit/ba7110f), **13:38 EDT**, introducing the shared Meta client and hard spend cap. The published implementation ends at [`925c110`](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/commit/925c110), **2026-10-30 at 00:39 EDT**. The [baseline-to-release comparison](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/compare/53a83c0...925c110) identifies the event-built changes.

The event contribution is the public Meta orchestration, topic guardrails, spend controls, saved-story interface, provenance, complete-source-wording preservation, and scenario-brief export. The private reconstruction backend predates the event and is not included in the source ZIP. Attached SAM 3D Objects assets were generated separately; they illustrate creative concepts, their generation cost is unrecorded, and neither video demonstrates fresh 3D generation.

The archived source ZIP is the exact `925c110` snapshot. Later release-documentation edits do not silently change that archived implementation identity. The package's preserved README and publication text reflect its earlier preparation state; this manifest records the subsequent public release.

## Evidence and licensing boundaries

Both videos fully decoded locally, the original primary audio is unchanged, encoded frame/contact-sheet review checked labels and visual content, and all 27 judge-package archive entries matched their checksums. See the [recording details](recording/JUDGE_PACKAGE.md). These checks do not claim a subjective audio-listening assessment or judge acceptance.

The fresh run completed in **58.666 seconds** and recorded **US$0.2507162** in Meta ledger estimates. One registered source was fetched and another timed out. All three saved baseline quotations match complete retrieved source units; this checks fidelity to source wording, not historical truth or counterfactual causality. Consequences remain hypothetical, and branch scores are rankings rather than probabilities. No measured creator-impact or learning-gain claim is made.

Application code is MIT licensed. Generated media, source excerpts, synthetic Microsoft Zira narration, globe imagery and fonts retain their applicable terms; the code license is not a blanket media license. Preserve the [media credits](https://github.com/DivDev93/OfficeOfOtherwise-MetaHackathon/releases/download/hackathon-preview-2026-10-30/LICENSE_AND_CREDITS.md) and [third-party notices](../THIRD_PARTY_NOTICES.md), including NASA/GSFC Blue Marble, NOAA NCEI ETOPO1, and font attribution. No private backend source is distributed.
