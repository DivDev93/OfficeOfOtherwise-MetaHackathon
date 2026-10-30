import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { branchDigest, selectRunEvidence, validateEvidence } from '../src/evidence/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataset = JSON.parse(readFileSync(join(root, 'demo/evidence/v1.json'), 'utf8'));
function readRun(runId) {
  return JSON.parse(readFileSync(join(root, 'demo/runs', runId, 'branch.json'), 'utf8'));
}

const validation = validateEvidence(dataset, { readRun });
if (!validation.valid) {
  console.error(JSON.stringify({ valid: false, errors: validation.errors }, null, 2));
  process.exitCode = 1;
} else {
  const report = {
    reportVersion: 1,
    mode: 'offline-structural-and-manual-evidence-audit',
    scope: 'Checks the curated evidence file against the four current saved branch artifacts. Makes no network requests and does not evaluate counterfactual truth.',
    result: {
      valid: true,
      runCount: dataset.runs.length,
      branchCount: dataset.runs.reduce((sum, run) => sum + run.branches.length, 0),
      sourceCount: dataset.sources.length,
      sourceAccessMethods: Object.fromEntries(['full_text', 'abstract', 'search_excerpt'].map(method => [method, dataset.sources.filter(source => source.verificationMethod === method).length])),
    },
    method: dataset.method,
    limitations: [
      'Source access methods record what was manually inspected during curation; this script does not fetch sources or verify that pages remain available.',
      'The sources support baseline claims only. They do not verify the imagined outcomes or prove each causal step.',
      'A structurally complete evidence note is not an independent history, climate, archaeological, or engineering peer review.',
      'Saved model review scores are ordering heuristics, not probabilities or factual confidence.',
    ],
    sources: dataset.sources.map(({ id, title, publisher, url, checkedDate, verificationMethod }) => ({ id, title, publisher, url, checkedDate, verificationMethod })),
    runs: dataset.runs.map(run => {
      const saved = readRun(run.runId);
      const selected = selectRunEvidence(dataset, run.runId, saved);
      return {
        runId: run.runId,
        divergence: run.divergence,
        branchArtifactSha256: branchDigest(saved),
        digestMatches: branchDigest(saved) === run.branchSha256,
        branchCount: run.branches.length,
        branches: run.branches.map(branch => ({
          branchId: branch.branchId,
          title: branch.title,
          baselineSources: branch.baselineSourceIds.map(id => {
            const source = selected.sources.find(item => item.id === id);
            return { id, title: source?.title, verificationMethod: source?.verificationMethod };
          }),
          changedAssumption: branch.changedAssumption,
          causalSteps: branch.causalSteps,
          uncertainty: branch.uncertainty,
          unverifiedClaims: branch.unverifiedClaims,
          demonstrates: branch.demonstrates,
          doesNotEstablish: branch.doesNotEstablish,
          discussionQuestion: branch.discussionQuestion,
        })),
      };
    }),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
