# Cached demo 3D handoff

The gen3d MCP was exposed in this session, but the Alexandria and Green Sahara generation calls returned errors without GLBs. Both were submitted around 2026-10-28 02:57:21 UTC; their observed elapsed times were approximately 300 and 600 seconds. The captured results did not retain diagnostic details. Check the service's job history or operator logs for the two object IDs before retrying: either job might have run and incurred charges. Two of the six allowed generation attempts have been used, leaving at most four. Do not run the MCP server directly or move its credentials into this repository.

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
