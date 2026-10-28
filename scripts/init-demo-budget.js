import { existsSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { fileLedger } from '../src/lib/spendLedger.js';

const checkpoint = 'out/demo-task-budget.json';
if (existsSync(checkpoint)) throw new Error('Demo budget checkpoint already exists; it will not be reset automatically');
const ledger = fileLedger();
ledger.initialize();
if (ledger.reserved() !== 0) throw new Error('Resolve outstanding Meta reservations before initializing a demo budget');
try {
  const fd = openSync(checkpoint, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify({ startingMetaSpendUsd: ledger.total(), taskBudgetUsd: 2 }, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  console.log('Demo budget checkpoint initialized.');
} catch (error) {
  if (error.code === 'EEXIST') throw new Error('Demo budget checkpoint already exists; it will not be reset automatically');
  throw error;
}
