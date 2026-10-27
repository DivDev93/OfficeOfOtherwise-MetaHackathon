import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileLedger } from '../src/lib/spendLedger.js';

// One-time, conservative adjustment of historical Wonder entries. Existing
// entries remain untouched; the adjustment is not charged to this new task.
const root = 'out', checkpoint = join(root, 'demo-task-budget.json');
const budget = JSON.parse(readFileSync(checkpoint, 'utf8'));
const ledger = fileLedger(join(root, 'spend.json'), { requireExisting: true });
if (budget.taskBudgetUsd !== 2 || ledger.reserved() !== 0) throw new Error('Cannot reconcile an invalid budget or outstanding reservations');
if (ledger.entries().some(e => e.label === 'historic-wonder-pricing-adjustment')) throw new Error('Historical pricing adjustment already exists; do not repeat');
if (Math.abs(ledger.total() - budget.startingMetaSpendUsd) > 1e-8) throw new Error('Task spend or another ledger change exists; reconcile manually');
let prior = 0, corrected = 0, count = 0;
for (const entry of ledger.entries()) {
  if (!String(entry.model ?? '').startsWith('muse-wonder')) continue;
  const u = entry.usage, input = u?.input_tokens, output = u?.output_tokens, cached = u?.input_tokens_details?.cached_tokens ?? 0;
  if (![input, output, cached].every(Number.isFinite) || cached < 0 || cached > input || input < 0 || output < 0) throw new Error('Historic Wonder entry lacks valid usage; reconcile manually');
  prior += entry.usd;
  corrected += ((input - cached) * 4 + cached * 0.2 + output * 20) / 1e6;
  count++;
}
const adjustment = Number((corrected - prior).toFixed(8));
if (!count || adjustment <= 0) throw new Error('No positive historical adjustment found');
ledger.add({ label: 'historic-wonder-pricing-adjustment', usd: adjustment, estimated: true, entriesAdjusted: count, basis: 'published Wonder token rates' });
const revised = { ...budget, originalStartingMetaSpendUsd: budget.startingMetaSpendUsd, historicalWonderAdjustmentUsd: adjustment, startingMetaSpendUsd: ledger.total() };
const temp = `${checkpoint}.pricing-adjustment.tmp`;
writeFileSync(temp, JSON.stringify(revised, null, 2), { flag: 'wx', mode: 0o600 });
renameSync(temp, checkpoint);
console.log(JSON.stringify({ entriesAdjusted: count, adjustmentUsd: adjustment, startingMetaSpendUsd: revised.startingMetaSpendUsd, taskBudgetUsd: revised.taskBudgetUsd }));
