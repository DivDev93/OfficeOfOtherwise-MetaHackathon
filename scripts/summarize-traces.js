#!/usr/bin/env node
// Recompute public-safe execution summaries from saved trace/task metadata only.
// This script never reads images, masks, the spend ledger, or calls a provider.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const readJson = async path => {
  const text = await readFile(path, 'utf8');
  return { text, value: JSON.parse(text), hash: sha256(text) };
};
const parseArgs = argv => {
  const args = { runsRoots: [], taskRoots: [], output: null, markdown: null, manifest: null, verifyManifest: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runs-root') args.runsRoots.push(resolve(argv[++i]));
    else if (arg === '--task-root') args.taskRoots.push(resolve(argv[++i]));
    else if (arg === '--output') args.output = resolve(argv[++i]);
    else if (arg === '--markdown') args.markdown = resolve(argv[++i]);
    else if (arg === '--private-manifest') args.manifest = resolve(argv[++i]);
    else if (arg === '--verify-manifest') args.verifyManifest = resolve(argv[++i]);
    else if (arg === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.help && (!args.runsRoots.length || !args.taskRoots.length || !args.output || !args.manifest)) {
    throw new Error('Required: --runs-root <dir> (repeatable) --task-root <dir> (repeatable) --output <public-json> --private-manifest <private-json>');
  }
  return args;
};

async function jsonFiles(directory) {
  try { return (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => join(directory, entry.name)).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

// A runs root is a record directory: read only trace/branch/manifest JSON in
// immediate child run directories. A completion snapshot may wrap such a root
// under demo/runs or demo/replay-history; find only those named record roots.
async function findRunRoots(root) {
  const found = new Set();
  async function walk(dir, depth) {
    if (depth > 5) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const child = join(dir, entry.name);
      if (entry.name === 'runs' || entry.name === 'replay-history') found.add(child);
      else await walk(child, depth + 1);
    }
  }
  found.add(root);
  await walk(root, 0);
  return [...found].sort();
}

const recordedErrors = trace => [
  ...(typeof trace?.error === 'string' ? [{ step: 'run', error: true }] : []),
  ...(Array.isArray(trace?.steps) ? trace.steps.filter(step => step?.error || step?.status === 'failed') : [])
].filter(step => !/^(?:3d)$/i.test(step.step ?? ''));
const runEvidenceState = ({ branch, trace }) => {
  if (!branch || typeof branch.status !== 'string') return 'branchArtifactMissing';
  const errors = recordedErrors(trace);
  if (branch.status === 'ok') return errors.length ? 'branchOkWithRecordedStageError' : 'branchOkNoRecordedStageError';
  if (branch.status === 'blocked') return 'branchBlocked';
  if (branch.status === 'empty') return 'branchEmpty';
  if (branch.status === 'failed' || branch.status === 'error') return 'branchStatusFailed';
  return 'branchStatusOther';
};
const percentile = (sorted, p) => sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null;
const median = sorted => {
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? {
    n: sorted.length,
    minMs: sorted[0],
    medianMs: median(sorted),
    p90Ms: percentile(sorted, 0.9),
    maxMs: sorted.at(-1),
  } : { n: 0, minMs: null, medianMs: null, p90Ms: null, maxMs: null };
};
const md = value => String(value ?? '').replaceAll('|', '\\|');
const number = value => value == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
function renderMarkdown(summary) {
  const runTypes = ['root', 'continuation'];
  const stateLabels = [...new Set(runTypes.flatMap(type => Object.keys(summary.cohort.runsByType[type].branchEvidenceStates)))];
  const taskRows = Object.entries(summary.cohort.tasksByType);
  const labels = {
    branchOkNoRecordedStageError: 'Branch status ok, no recorded stage error',
    branchOkWithRecordedStageError: 'Branch status ok, recorded stage error',
    branchBlocked: 'Branch status blocked',
    branchEmpty: 'Branch status empty',
    branchStatusFailed: 'Branch status failed/error',
    branchStatusOther: 'Other branch status',
    branchArtifactMissing: 'No branch artifact/status'
  };
  const runTable = stateLabels.map(state => `| ${md(labels[state] ?? state)} | ${runTypes.map(type => summary.cohort.runsByType[type].branchEvidenceStates[state] ?? 0).join(' | ')} |`).join('\n');
  const taskTable = taskRows.map(([type, task]) => `| ${md(type)} | ${task.recordedTasks} | ${task.succeeded} | ${task.failed} | ${task.incomplete} | ${task.dispatchUnknown} | ${task.empty} | ${task.completeOverInProgress} |`).join('\n');
  const durations = summary.durations.map(row => `| ${md(row.runType)} | ${md(row.stage)} | ${md(row.model)} | ${md(row.outcome)} | ${md(row.cacheStatus)} | ${row.n} | ${number(row.minMs)} | ${number(row.medianMs)} | ${number(row.p90Ms)} | ${number(row.maxMs)} | ${md(row.reviewFlag ?? '')} |`).join('\n');
  const errors = summary.recordedStageErrorRecords.map(row => `| ${md(row.runType)} | ${md(row.reasonCategory)} | ${row.records} |`).join('\n');
  return `# Recomputed local trace metrics

This offline summary is generated from saved trace, branch, and task metadata. The machine-readable aggregate is [metrics.json](metrics.json), and the recomputation code is [summarize-traces.js](../scripts/summarize-traces.js). It makes no model calls and does not read the shared spend ledger.

## Branch/status records

The fixed captured cohort has **${summary.cohort.uniqueRunRecords} unique trace records**: ${summary.cohort.runsByType.root.savedBranchRecords} root records and ${summary.cohort.runsByType.continuation.savedBranchRecords} continuation records. ${summary.cohort.copiedTraceRecordsExcluded} copied trace files were excluded by run ID. ${summary.cohort.excludedHumanNamedFixtures} human-named run-artifact fixtures and ${summary.cohort.excludedPackagedNamedReplayDirectories} packaged named replay directories were excluded from the observed-run denominator.

A saved \`branch.json\` status of \`ok\` records that branch generation produced an artifact; it does **not** establish that image generation, segmentation, or the full pipeline completed. The disjoint categories below sum to the fixed cohort and keep \`ok\` records with saved stage errors separate from those without a recorded error. No branch artifact means the saved branch file/status was absent. These are branch/status records, not end-to-end reliability outcomes.

| Branch evidence state | Root | Continuation |
| --- | ---: | ---: |
${runTable}

Recorded stage error categories are counts of affected run records, not raw error messages; one record can appear in more than one category.

| Run type | Error category | Affected records |
| --- | --- | ---: |
${errors}

## Separate task-store statuses

Task records are deduplicated by continuation parent/branch or event run/branch identity. \`Dispatch unknown\` includes uncertain and in-progress states and overlaps with \`Incomplete\`. Event-scene metadata had **${summary.cohort.tasksByType.eventScene.completeOverInProgress} identities** where a later \`complete\` record resolved an earlier \`in-progress\` record. Empty cutouts are terminal with no output and are included in succeeded.

| Task type | Recorded tasks | Succeeded | Failed | Incomplete | Dispatch unknown | Empty | Complete over in-progress |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${taskTable}

## Application-measured elapsed spans

These values are **application-instrumented elapsed spans**, including client and local parsing work. They are not provider-reported model processing latency or end-to-end wall-clock time. Concurrent spans overlap and are not summed. Median is the conventional middle value (average of the middle pair for even samples); p90 uses nearest-rank. The model column is the recorded trace label, not a claim about provider-internal timing.

| Run type | Stage | Trace model label | Recorded outcome | Cache status | n | Min ms | Median ms | P90 ms | Max ms | Review flag |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
${durations}

Every span in this cohort has cache status **unknown** because traces contain no explicit cache-hit/miss marker. In particular, the ${summary.durations.filter(row => row.reviewFlag).map(row => `\`${row.runType}/${row.stage}\` ${row.minMs} ms (${row.outcome})`).join(' and ') || 'flagged short spans'} are shown as measured outcome spans, not inferred cache hits or provider latency. Event-scene and event-cutout records contain no duration field and therefore have status counts only.

## Method and limits

- Inputs were limited to the ${summary.sourceFileCount} pinned JSON files listed in the private provenance manifest: saved \`trace.json\`, \`branch.json\`, continuation-edge, event-scene, and event-cutout status metadata. Their SHA-256 hashes were revalidated unchanged before recomputation. Images, masks, asset payloads, and spend ledgers were not read.
- Trace copies were deduplicated by run ID. When copies differed, the copy with more timed steps won; ties were resolved by trace SHA-256 order. Task identities use run/branch or continuation parent/branch.
- Recorded stage errors are aggregated into safe stage categories only. Their raw messages are omitted. A missing branch artifact remains distinct from a branch status and from task-store dispatch uncertainty.
- The available captured records may omit runs or earlier attempts; this scoped cohort is not a global reliability estimate. Uncertain task metadata cannot establish dispatch or completion.
`;
}

async function summarize(args) {
  const inputFiles = new Map();
  const records = new Map();
  const allRunIds = new Set();
  const excludedHumanNames = new Set();
  const excludedHumanRootNames = new Set();
  let traceCopies = 0;
  for (const root of args.runsRoots) {
    for (const recordRoot of await findRunRoots(root)) {
      let children;
      try { children = await readdir(recordRoot, { withFileTypes: true }); } catch { continue; }
      for (const child of children) {
        if (!child.isDirectory() || child.name.startsWith('.')) continue;
        const dir = join(recordRoot, child.name);
        const tracePath = join(dir, 'trace.json');
        let traceFile;
        try { traceFile = await readJson(tracePath); } catch { continue; }
        // Static replay fixtures have human-readable names. Captured local run
        // IDs use UUIDs or the legacy 13-digit timestamp form, including runs
        // that failed before any duration could be recorded.
        const runId = child.name;
        if (!/^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|\d{13})$/i.test(runId)) {
          if (Array.isArray(traceFile.value?.steps) && traceFile.value.steps.some(step => Number.isFinite(step?.ms))) {
            excludedHumanNames.add(runId);
            if (recordRoot === root) excludedHumanRootNames.add(runId);
          }
          continue;
        }
        traceCopies++;
        inputFiles.set(tracePath, traceFile.hash);
        const branchPath = join(dir, 'branch.json');
        let branch = null;
        try { const f = await readJson(branchPath); branch = f.value; inputFiles.set(branchPath, f.hash); } catch {}
        allRunIds.add(runId);
        const candidate = { runId, trace: traceFile.value, traceHash: traceFile.hash, branch, source: tracePath };
        const previous = records.get(runId);
        const weight = item => Array.isArray(item.trace?.steps) ? item.trace.steps.filter(step => Number.isFinite(step?.ms)).length : 0;
        if (!previous || weight(candidate) > weight(previous) || (weight(candidate) === weight(previous) && candidate.traceHash < previous.traceHash)) records.set(runId, candidate);
      }
    }
  }

  const events = { continuation: [], eventScene: [], eventCutout: [] };
  const continuationRunIds = new Set();
  for (const root of args.taskRoots) {
    for (const [kind, relative] of [['continuation', '.continuation/edges'], ['continuationAttempt', '.continuation/attempts'], ['eventScene', '.event-scenes'], ['eventCutout', '.event-cutouts']]) {
      const directory = join(root, relative);
      for (const path of await jsonFiles(directory)) {
        let file;
        try { file = await readJson(path); } catch { continue; }
        inputFiles.set(path, file.hash);
        const task = file.value;
        if (kind === 'continuationAttempt') {
          if (task?.runId) continuationRunIds.add(task.runId);
          continue; // archived reservations are separately counted as undispatched evidence
        }
        if (kind === 'continuation') {
          if (task?.runId) continuationRunIds.add(task.runId);
          const identity = `${task?.parentRunId ?? ''}\0${task?.parentBranchId ?? ''}`;
          events.continuation.push({ identity, status: task?.status ?? 'unknown', runId: task?.runId });
        } else {
          const identity = `${task?.runId ?? ''}\0${task?.branchId ?? ''}`;
          events[kind].push({ identity, status: task?.status ?? 'unknown' });
        }
      }
    }
  }

  const selected = [...records.values()];
  const rows = new Map();
  for (const record of selected) {
    const type = continuationRunIds.has(record.runId) || record.trace?.continuation ? 'continuation' : 'root';
    const run = rows.get(type) ?? { total: 0, states: {} };
    run.total++;
    const state = runEvidenceState(record);
    run.states[state] = (run.states[state] ?? 0) + 1;
    rows.set(type, run);
  }

  const durationGroups = new Map();
  const errorGroups = new Map();
  for (const record of selected) {
    const type = continuationRunIds.has(record.runId) || record.trace?.continuation ? 'continuation' : 'root';
    const perRecordReasons = new Set();
    for (const step of (Array.isArray(record.trace?.steps) ? record.trace.steps : [])) {
      if (!Number.isFinite(step?.ms) || step.ms < 0 || typeof step?.step !== 'string') continue;
      const name = step.step;
      // The harness records elapsed application spans around a call and its
      // local parsing. These are not provider-reported processing latencies.
      if (['branch-agent:propose', 'branch-agent:review', 'cutout', '3d'].includes(name)) continue;
      if (/tattva|chronos/i.test(step.model ?? '')) continue;
      const outcome = step.error || step.status === 'failed' ? 'error-recorded' : step.ok === false ? 'response-not-parsed' : 'no-error-recorded';
      const cacheStatus = typeof step.cacheHit === 'boolean' ? (step.cacheHit ? 'cache-hit-recorded' : 'cache-miss-recorded')
        : typeof step.cached === 'boolean' ? (step.cached ? 'cache-hit-recorded' : 'cache-miss-recorded') : 'cache-status-unknown';
      const group = `${type}\0${name}\0${step.model ?? 'unlabeled'}\0${outcome}\0${cacheStatus}`;
      if (!durationGroups.has(group)) durationGroups.set(group, []);
      durationGroups.get(group).push(step.ms);
    }
    for (const step of recordedErrors(record.trace)) {
      const name = step.step ?? 'run';
      const reason = /^agent$|branch-agent/i.test(name) ? 'branch-agent-stage'
        : /^image$/i.test(name) ? 'image-stage'
          : /^segment(?::error)?$/i.test(name) ? 'segmentation-stage'
            : /^policy|topic-policy/i.test(name) ? 'policy-stage' : 'other-recorded-stage';
      perRecordReasons.add(reason);
    }
    for (const reason of perRecordReasons) {
      const key = `${type}\0${reason}`;
      errorGroups.set(key, (errorGroups.get(key) ?? 0) + 1);
    }
  }

  let expectedManifest = null;
  if (args.verifyManifest) {
    const { text, value } = await readJson(args.verifyManifest);
    expectedManifest = value;
    const expected = new Map(value.sourceFiles.map(file => [resolve(file.path), file.sha256]));
    const actual = inputFiles;
    const changed = [...expected].filter(([path, hash]) => actual.get(path) !== hash);
    const added = [...actual.keys()].filter(path => !expected.has(path));
    if (changed.length || added.length || expected.size !== actual.size) {
      throw new Error(`Pinned manifest mismatch: ${changed.length} changed/missing and ${added.length} added source files`);
    }
    expectedManifest = { ...value, manifestSha256: sha256(text) };
  }

  const publicSummary = {
    schemaVersion: 1,
    sourceFileCount: inputFiles.size,
    generatedFrom: 'saved-local-traces-and-task-metadata',
    privacy: 'Aggregated counts and durations only; run/task IDs, prompts, paths, hashes, costs, outputs, and asset contents excluded.',
    cohort: {
      scope: 'Available captured local run and task records; copies across snapshots deduplicated by run ID or task identity.',
      uniqueRunRecords: selected.length,
      copiedTraceRecordsExcluded: Math.max(0, traceCopies - selected.length),
      excludedHumanNamedFixtures: excludedHumanRootNames.size,
      excludedPackagedNamedReplayDirectories: Math.max(0, excludedHumanNames.size - excludedHumanRootNames.size),
      runsByType: Object.fromEntries(['root', 'continuation'].map(type => {
        const run = rows.get(type) ?? { total: 0, states: {} };
        return [type, { savedBranchRecords: run.total, branchEvidenceStates: run.states }];
      })),
      tasksByType: Object.fromEntries(Object.entries(events).map(([type, tasks]) => {
        const deduped = new Map();
        const statusesByIdentity = new Map();
        for (const task of tasks) {
          const seen = statusesByIdentity.get(task.identity) ?? new Set();
          seen.add(task.status);
          statusesByIdentity.set(task.identity, seen);
          const prior = deduped.get(task.identity);
          const rank = status => ({ complete: 4, empty: 3, uncertain: 2, 'in-progress': 1, unknown: 0 }[status] ?? 0);
          if (!prior || rank(task.status) > rank(prior.status)) deduped.set(task.identity, task);
        }
        const counts = {};
        for (const task of deduped.values()) counts[task.status] = (counts[task.status] ?? 0) + 1;
        const succeeded = (counts.complete ?? 0) + (counts.empty ?? 0);
        const failed = counts.failed ?? 0;
        const incomplete = counts['in-progress'] ?? 0;
        const dispatchUnknown = incomplete + (counts.uncertain ?? 0);
        const completeOverInProgress = [...statusesByIdentity.values()].filter(seen => seen.has('complete') && seen.has('in-progress')).length;
        return [type, { recordedTasks: deduped.size, succeeded, failed, incomplete, dispatchUnknown, empty: counts.empty ?? 0, completeOverInProgress, recordedStatuses: counts }];
      })),
      note: 'These are saved task statuses, not request-attempt or dispatch counts. In-progress and uncertain outcomes cannot be resolved from metadata; completeOverInProgress counts identities where a complete record superseded a stale in-progress record. Archived continuation reservations are excluded because they record pre-dispatch release.'
    },
    durations: [...durationGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => {
      const [type, stage, model, outcome, cacheStatus] = key.split('\0');
      const summary = stats(values);
      return { runType: type, stage, model, instrumentation: 'application-measured-elapsed-span', outcome, cacheStatus,
        ...(summary.minMs < 250 && cacheStatus === 'cache-status-unknown' ? { reviewFlag: 'sub-second-span-cache-unverified' } : {}), ...summary };
    }),
    recordedStageErrorRecords: [...errorGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, records]) => {
      const [runType, reasonCategory] = key.split('\0');
      return { runType, reasonCategory, records };
    }),
    limitations: [
      'A branch status of ok certifies the branch-generation artifact only. It does not establish that image, segmentation, or all later work completed; branchOkWithRecordedStageError is reported separately.',
      'Durations are application-measured elapsed spans around work, including client and local parsing overhead; they are not provider-reported model latency. Concurrent spans are not summed.',
      'Cache state is unknown unless an explicit cacheHit/cached marker exists in the saved span; no cache markers were observed in this cohort.',
      'No persisted event-scene or event-cutout duration field was found, so those task types have status counts only.',
      'The available captures may omit runs or earlier records; this is a scoped saved-record cohort, not a global reliability estimate.'
    ]
  };

  const privateManifest = {
    schemaVersion: 1,
    purpose: 'Private provenance for offline trace recomputation. Do not publish.',
    createdAt: new Date().toISOString(),
    scriptSha256: sha256(await readFile(new URL(import.meta.url))),
    ...(expectedManifest ? { pinnedInputManifestSha256: expectedManifest.manifestSha256 } : {}),
    sourceFiles: [...inputFiles.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, hash]) => ({ path, sha256: hash })),
    deduplication: { runIdentity: 'runId folder name', selectedTraceIds: selected.map(item => item.runId).sort(), uniqueRunIdsObserved: allRunIds.size, uniqueRunsSelected: selected.length },
    output: publicSummary
  };
  await mkdir(dirname(args.output), { recursive: true });
  await mkdir(dirname(args.manifest), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(publicSummary, null, 2)}\n`);
  if (args.markdown) {
    await mkdir(dirname(args.markdown), { recursive: true });
    await writeFile(args.markdown, renderMarkdown(publicSummary));
  }
  await writeFile(args.manifest, `${JSON.stringify(privateManifest, null, 2)}\n`);
  return publicSummary;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write('Offline trace aggregation. Reads trace/branch/task JSON only; never image or spend data.\n');
} else {
  const result = await summarize(args);
  process.stdout.write(`${JSON.stringify({ uniqueRunRecords: result.cohort.uniqueRunRecords, runsByType: result.cohort.runsByType, tasksByType: result.cohort.tasksByType, recordedStageErrorRecords: result.recordedStageErrorRecords, durationGroups: result.durations.length }, null, 2)}\n`);
}
