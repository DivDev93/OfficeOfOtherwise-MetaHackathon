import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { costFromUsage } from '../src/lib/pricing.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WINDOW_MS = 10 * 60 * 1000;

// Matches each recorded charge independently. No raw ledger fields are copied into the cache.
export async function repriceCachedRun({ cacheDirectory, sourceTimestamp, ledgerPath = join(root, 'out', 'spend.json') }) {
  if (!/^\d{13}$/.test(String(sourceTimestamp))) throw new Error('Invalid source timestamp');
  const started = Number(sourceTimestamp);
  const path = join(resolve(cacheDirectory), 'trace.json');
  const trace = JSON.parse(await readFile(path, 'utf8'));
  if (trace.pricingNote) return { status: 'already-repriced' };
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  if (!Array.isArray(trace.steps) || !Array.isArray(ledger.entries) || !Number.isFinite(trace.costUsd)) throw new Error('Invalid trace or ledger');
  const used = new Set();
  let delta = 0, count = 0;
  for (const step of trace.steps) {
    if (step.summary || step.reused || !/^muse-wonder(?:-|$)/.test(step.model ?? '')) continue;
    if (!Number.isFinite(step.costUsd) || step.costUsd < 0 || typeof step.step !== 'string') throw new Error('Invalid Wonder trace step');
    const matches = ledger.entries.map((entry, index) => ({entry,index})).filter(({entry,index}) => {
      const at = Date.parse(entry.at);
      return !used.has(index) && entry.label === step.step && entry.model === step.model && Number.isFinite(entry.usd) && Math.abs(entry.usd - step.costUsd) < 1e-12 && Number.isFinite(at) && at >= started && at <= started + WINDOW_MS;
    });
    if (matches.length !== 1) throw new Error('Missing or ambiguous ledger match');
    const {entry,index} = matches[0];
    const {usd,estimated} = costFromUsage(step.model, entry.usage);
    if (estimated) throw new Error('Unknown pricing');
    used.add(index); count++;
    step.recordedCostUsd = step.costUsd;
    delta += usd - step.costUsd;
    step.costUsd = usd;
  }
  if (!count) throw new Error('No Wonder charges to reprice');
  trace.recordedCostUsd = trace.costUsd;
  trace.costUsd += delta;
  trace.pricingNote = { method: 'Recomputed from recorded token usage at Muse Wonder rates of $4 input, $0.20 cached input, and $20 output per million tokens.', sourceRunTimestamp: String(sourceTimestamp), windowMs: WINDOW_MS };
  const temp = join(dirname(path), `.trace-reprice-${randomUUID()}.tmp`);
  try { await writeFile(temp, JSON.stringify(trace,null,2)+'\n', {flag:'wx'}); await rename(temp,path); }
  finally { await unlink(temp).catch(error => { if(error.code !== 'ENOENT') throw error; }); }
  return {status:'repriced', steps:count, recordedCostUsd:trace.recordedCostUsd, costUsd:trace.costUsd};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2) { console.error('Usage: node scripts/reprice-cached-run.js <cache-directory> <source-run-timestamp>'); process.exitCode=1; }
  else repriceCachedRun({cacheDirectory:args[0],sourceTimestamp:args[1]}).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Repricing failed: verify the trace and ledger match uniquely.'); process.exitCode=1;});
}
