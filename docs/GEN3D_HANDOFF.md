# Cached demo 3D handoff

The gen3d MCP was exposed in this session, but the Alexandria and Green Sahara generation calls returned errors without GLBs. Both were submitted around 2026-10-28 02:57:21 UTC; their observed elapsed times were approximately 300 and 600 seconds. The original captured results did not retain diagnostic details. A subsequent Alexandria attempt at approximately 03:20:53 UTC returned an MCP timeout after 300 seconds with no GLB. Its remote status and cost are unknown. Check the service's job history or operator logs for the object IDs and investigate the call timeout before retrying; any of the jobs might have run and incurred charges. Three of the six allowed generation attempts have been used, leaving at most three. Since all four models remain missing, finishing all four within the limit requires recovering an existing result. Do not run the MCP server directly or move its credentials into this repository.

A later read-only search of accessible Cloud Run logs found failure markers mentioning `alexandria` at 03:05:41 UTC and `green-sahara` at 03:09:38 UTC on 2026-10-28. The checked fields did not supply a request identifier or a cause, so these matching object IDs are useful investigation leads rather than proof of either original call's outcome. Two accessible projects did not permit the log lookup.

Pass `provider="trellis"`, `debug=false`, the full hero image and the explicit mask. These paths are on the local Windows machine; `out/` is not committed. The Beringia mask is fragmented and is **not accepted**. Antikythera has no mask. Do not generate those models until those problems are resolved and their 2D runs are staged.

| object_id | hero image | mask |
| --- | --- | --- |
| `alexandria` | `D:\OfficeOfOtherwise-MetaHackathon\out\1793139066427\hero.png` | `D:\OfficeOfOtherwise-MetaHackathon\out\1793139066427\mask.png` |
| `beringia` | `D:\OfficeOfOtherwise-MetaHackathon\out\1793156040577\hero.png` | `D:\OfficeOfOtherwise-MetaHackathon\out\1793156040577\mask.png` (fragmented; not accepted) |
| `green-sahara` | `D:\OfficeOfOtherwise-MetaHackathon\out\1793155949163\hero.png` | `D:\OfficeOfOtherwise-MetaHackathon\out\1793155949163\mask.png` |
| `mechanisms` | `D:\OfficeOfOtherwise-MetaHackathon\out\1793156096257\hero.png` | `D:\OfficeOfOtherwise-MetaHackathon\out\1793156096257\mask.png` (missing) |

After a GLB has been produced for a staged run, substitute its actual local path in the corresponding command. The optional `--ms` should be the measured generation time; omit it if unknown. Beringia and mechanisms must first have accepted 2D outputs staged under their slugs.

```powershell
npm run attach-glb -- alexandria "C:\path\to\alexandria.glb" --provider trellis
npm run attach-glb -- beringia "C:\path\to\beringia.glb" --provider trellis
npm run attach-glb -- green-sahara "C:\path\to\green-sahara.glb" --provider trellis
npm run attach-glb -- mechanisms "C:\path\to\mechanisms.glb" --provider trellis
```

Attachment validates the GLB header, records pre-generated provenance and enforces the cache size cap. Replay each completed run through the local server after attachment.
