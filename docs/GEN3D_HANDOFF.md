# Cached demo 3D handoff

The gen3d MCP is available, but four generation calls have returned errors without GLBs. The latest Alexandria attempt returned `timed out awaiting tools/call after 300s` even after a project-scoped 900-second timeout override was added; a fresh Codex CLI resolves that override, but the running MCP bridge still used its 300-second deadline. Remote job status and GCP cost are unknown. Investigate the active bridge deadline and check service job history before retrying; timed-out jobs may still run and incur charges. The user has authorized additional necessary gen3d calls and asked to keep spending low. Do not run the MCP server directly or move its credentials into this repository.

A later read-only search of accessible Cloud Run logs found failure markers mentioning `alexandria` at 03:05:41 UTC and `green-sahara` at 03:09:38 UTC on 2026-10-28. The checked fields did not supply a request identifier or a cause, so these matching object IDs are useful investigation leads rather than proof of either original call's outcome. Two accessible projects did not permit the log lookup.

Pass `provider="trellis"`, `debug=false`, the full hero image and the explicit mask. These paths are on the local Windows machine; `out/` is not committed. The four 2D replays are staged provisionally; the Alexandria mask omits some thin parts, and the mechanism mask retains some background within its open frame.

| object_id | hero image | mask |
| --- | --- | --- |
| `alexandria` | `D:\OfficeOfOtherwise-MetaHackathon\out\1793139066427\hero.png` | `D:\OfficeOfOtherwise-MetaHackathon\out\1793139066427\mask.png` |
| `beringia` | `D:\OfficeOfOtherwise-MetaHackathon\out\1793160583959\hero.png` | `D:\OfficeOfOtherwise-MetaHackathon\out\1793160583959\mask.png` |
| `green-sahara` | `D:\OfficeOfOtherwise-MetaHackathon\out\1793155949163\hero.png` | `D:\OfficeOfOtherwise-MetaHackathon\out\1793155949163\mask.png` |
| `mechanisms` | `D:\OfficeOfOtherwise-MetaHackathon\out\mechanisms-selected-source\hero.png` | `D:\OfficeOfOtherwise-MetaHackathon\out\mechanisms-selected-source\mask.png` |

After a GLB has been produced for a staged run, substitute its actual local path in the corresponding command. The optional `--ms` should be the measured generation time; omit it if unknown.

```powershell
npm run attach-glb -- alexandria "C:\path\to\alexandria.glb" --provider trellis
npm run attach-glb -- beringia "C:\path\to\beringia.glb" --provider trellis
npm run attach-glb -- green-sahara "C:\path\to\green-sahara.glb" --provider trellis
npm run attach-glb -- mechanisms "C:\path\to\mechanisms.glb" --provider trellis
```

Attachment validates the GLB header, records pre-generated provenance and enforces the cache size cap. Replay each completed run through the local server after attachment.
