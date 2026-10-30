import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileLedger } from '../lib/spendLedger.js';

// A missing or damaged checkpoint fails closed; never silently reset the task budget.
export function taskSpendCap({ env = process.env, outputRoot = 'out', checkpointPath = join(outputRoot, 'demo-task-budget.json'), taskBudgetUsd = 2 } = {}) {
  let budget;
  try { budget = JSON.parse(readFileSync(checkpointPath, 'utf8')); } catch { throw new Error('Demo task budget checkpoint is required'); }
  if (![1, 2].includes(taskBudgetUsd) || !Number.isFinite(budget.startingMetaSpendUsd) || budget.startingMetaSpendUsd < 0 || budget.taskBudgetUsd !== taskBudgetUsd) throw new Error('Invalid demo task budget checkpoint');
  const ledger = fileLedger(join(outputRoot, 'spend.json'), { requireExisting: true });
  if (ledger.total() < budget.startingMetaSpendUsd) throw new Error('Spend ledger is below the task budget checkpoint');
  const configuredCap = Number(env.META_SPEND_CAP_USD ?? 100);
  if (!Number.isFinite(configuredCap) || configuredCap < 0) throw new Error('Invalid Meta spend cap');
  return Math.min(configuredCap, budget.startingMetaSpendUsd + budget.taskBudgetUsd);
}
