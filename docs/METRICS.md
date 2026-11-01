# Recomputed local trace metrics

This offline summary is generated from saved trace, branch, and task metadata. The machine-readable aggregate is [metrics.json](metrics.json), and the recomputation code is [summarize-traces.js](../scripts/summarize-traces.js). It makes no model calls and does not read the shared spend ledger.

A separate complete fresh interactive recording is summarized in [FRESH_RUN.md](FRESH_RUN.md), with allowlisted milestone data in [fresh-run-evidence.json](fresh-run-evidence.json). It is not part of the 86-record fixed historical cohort.

## Branch/status records

The fixed captured cohort has **86 unique trace records**: 29 root records and 57 continuation records. 103 copied trace files were excluded by run ID. 3 human-named run-artifact fixtures and 4 packaged named replay directories were excluded from the observed-run denominator.

A saved `branch.json` status of `ok` records that branch generation produced an artifact; it does **not** establish that image generation, segmentation, or the full pipeline completed. The disjoint categories below sum to the fixed cohort and keep `ok` records with saved stage errors separate from those without a recorded error. No branch artifact means the saved branch file/status was absent. These are branch/status records, not end-to-end reliability outcomes.

| Branch evidence state | Root | Continuation |
| --- | ---: | ---: |
| Branch status ok, no recorded stage error | 24 | 47 |
| Branch status blocked | 1 | 0 |
| No branch artifact/status | 1 | 8 |
| Branch status ok, recorded stage error | 1 | 2 |
| Other branch status | 2 | 0 |

Recorded stage error categories are counts of affected run records, not raw error messages; one record can appear in more than one category.

| Run type | Error category | Affected records |
| --- | --- | ---: |
| continuation | branch-agent-stage | 8 |
| continuation | image-stage | 1 |
| continuation | segmentation-stage | 1 |
| root | branch-agent-stage | 1 |
| root | image-stage | 1 |

## Separate task-store statuses

Task records are deduplicated by continuation parent/branch or event run/branch identity. `Dispatch unknown` includes uncertain and in-progress states and overlaps with `Incomplete`. Event-scene metadata had **2 identities** where a later `complete` record resolved an earlier `in-progress` record. Empty cutouts are terminal with no output and are included in succeeded.

| Task type | Recorded tasks | Succeeded | Failed | Incomplete | Dispatch unknown | Empty | Complete over in-progress |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| continuation | 52 | 46 | 2 | 1 | 4 | 0 | 0 |
| eventScene | 56 | 50 | 0 | 1 | 6 | 0 | 2 |
| eventCutout | 4 | 4 | 0 | 0 | 0 | 3 | 0 |

## Application-measured elapsed spans

These values are **application-instrumented elapsed spans**, including client and local parsing work. They are not provider-reported model processing latency or end-to-end wall-clock time. Concurrent spans overlap and are not summed. Median is the conventional middle value (average of the middle pair for even samples); p90 uses nearest-rank. The model column is the recorded trace label, not a claim about provider-internal timing.

| Run type | Stage | Trace model label | Recorded outcome | Cache status | n | Min ms | Median ms | P90 ms | Max ms | Review flag |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| continuation | image | muse-image-1.0 | error-recorded | cache-status-unknown | 1 | 83 | 83 | 83 | 83 | sub-second-span-cache-unverified |
| continuation | image | muse-image-1.0 | no-error-recorded | cache-status-unknown | 48 | 11,799 | 25,033 | 39,495 | 82,237 |  |
| continuation | policy:branches | muse-spark-1.3 | no-error-recorded | cache-status-unknown | 49 | 3,028 | 5,513 | 9,018 | 23,711 |  |
| continuation | policy:prompt | muse-spark-1.3 | no-error-recorded | cache-status-unknown | 49 | 1,279 | 4,196 | 20,197 | 40,980 |  |
| continuation | propose | muse-wonder-1.0 | no-error-recorded | cache-status-unknown | 49 | 24,087 | 33,681 | 49,042 | 51,706 |  |
| continuation | review | muse-wonder-1.0 | no-error-recorded | cache-status-unknown | 49 | 5,442 | 9,649 | 13,765 | 25,702 |  |
| continuation | segment | sam-3.1 | error-recorded | cache-status-unknown | 1 | 13 | 13 | 13 | 13 | sub-second-span-cache-unverified |
| continuation | segment | sam-3.1 | no-error-recorded | cache-status-unknown | 53 | 2,370 | 4,196 | 8,119 | 27,252 |  |
| continuation | topic-policy | muse-spark-1.3 | no-error-recorded | cache-status-unknown | 302 | 1,277 | 3,916 | 6,960 | 40,978 |  |
| root | evidence:retrieve | unlabeled | no-error-recorded | cache-status-unknown | 5 | 7,009 | 14,010 | 14,024 | 14,024 |  |
| root | image | muse-image-1.0 | error-recorded | cache-status-unknown | 1 | 14,335 | 14,335 | 14,335 | 14,335 |  |
| root | image | muse-image-1.0 | no-error-recorded | cache-status-unknown | 24 | 10,400 | 14,267 | 24,100 | 26,496 |  |
| root | policy:branches | muse-spark-1.3 | no-error-recorded | cache-status-unknown | 13 | 3,390 | 5,174 | 5,677 | 7,064 |  |
| root | policy:branches | muse-wonder-1.0 | no-error-recorded | cache-status-unknown | 12 | 3,546 | 9,547 | 11,554 | 11,554 |  |
| root | policy:prompt | muse-spark-1.3 | no-error-recorded | cache-status-unknown | 16 | 2,046 | 4,178 | 9,970 | 17,920 |  |
| root | policy:prompt | muse-wonder-1.0 | no-error-recorded | cache-status-unknown | 12 | 4,094 | 5,056 | 5,093 | 7,248 |  |
| root | policy:reuse | muse-wonder-1.0 | no-error-recorded | cache-status-unknown | 8 | 2,654 | 5,296 | 6,445 | 6,445 |  |
| root | propose | muse-wonder-1.0 | no-error-recorded | cache-status-unknown | 26 | 16,121 | 31,253 | 55,795 | 60,392 |  |
| root | review | muse-wonder-1.0 | no-error-recorded | cache-status-unknown | 25 | 6,333 | 16,512 | 25,096 | 35,582 |  |
| root | segment | sam-3.1 | no-error-recorded | cache-status-unknown | 28 | 2,075 | 4,490 | 7,024 | 7,866 |  |
| root | topic-policy | muse-spark-1.3 | no-error-recorded | cache-status-unknown | 82 | 2,045 | 3,835 | 5,466 | 17,917 |  |
| root | topic-policy | muse-wonder-1.0 | no-error-recorded | cache-status-unknown | 32 | 2,121 | 5,020.5 | 7,247 | 11,541 |  |

Every span in this cohort has cache status **unknown** because traces contain no explicit cache-hit/miss marker. In particular, the `continuation/image` 83 ms (error-recorded) and `continuation/segment` 13 ms (error-recorded) are shown as measured outcome spans, not inferred cache hits or provider latency. Event-scene and event-cutout records contain no duration field and therefore have status counts only.

## Method and limits

- Inputs were limited to the 579 pinned JSON files listed in the private provenance manifest: saved `trace.json`, `branch.json`, continuation-edge, event-scene, and event-cutout status metadata. Their SHA-256 hashes were revalidated unchanged before recomputation. Images, masks, asset payloads, and spend ledgers were not read.
- Trace copies were deduplicated by run ID. When copies differed, the copy with more timed steps won; ties were resolved by trace SHA-256 order. Task identities use run/branch or continuation parent/branch.
- Recorded stage errors are aggregated into safe stage categories only. Their raw messages are omitted. A missing branch artifact remains distinct from a branch status and from task-store dispatch uncertainty.
- The available captured records may omit runs or earlier attempts; this scoped cohort is not a global reliability estimate. Uncertain task metadata cannot establish dispatch or completion.
