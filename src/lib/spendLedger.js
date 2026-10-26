import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** In-memory ledger (tests, single process). */
export function memoryLedger(initial = 0) {
  let total = initial;
  const entries = [];
  return {
    total: () => total,
    add(entry) { total += entry.usd; entries.push({ ...entry, at: new Date().toISOString() }); },
    entries: () => [...entries],
  };
}

/**
 * File-backed ledger so the cap holds across harness runs, not just one process.
 * Default location is out/spend.json (gitignored).
 */
export function fileLedger(path = 'out/spend.json') {
  let state = { totalUsd: 0, entries: [] };
  try { state = JSON.parse(readFileSync(path, 'utf8')); } catch { /* first run */ }
  const save = () => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(state, null, 2)); };
  return {
    total: () => state.totalUsd,
    add(entry) {
      state.totalUsd += entry.usd;
      state.entries.push({ ...entry, at: new Date().toISOString() });
      save();
    },
    entries: () => [...state.entries],
  };
}
