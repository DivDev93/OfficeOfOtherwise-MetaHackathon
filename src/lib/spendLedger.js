import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, openSync, closeSync, fsyncSync, rmdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

function validate(state) {
  if (!state || !Number.isFinite(state.totalUsd) || state.totalUsd < 0 || !Array.isArray(state.entries) || (state.reservations !== undefined && (!state.reservations || typeof state.reservations !== 'object' || Array.isArray(state.reservations)))) throw new Error('Invalid spend ledger');
  for (const entry of state.entries) if (!Number.isFinite(entry.usd) || entry.usd < 0 || typeof entry.at !== 'string') throw new Error('Invalid spend ledger entry');
  state.reservations ??= {};
  for (const r of Object.values(state.reservations)) if (!Number.isFinite(r.usd) || r.usd < 0 || typeof r.day !== 'string') throw new Error('Invalid spend reservation');
  return state;
}
function totalReserved(state) { return Object.values(state.reservations).reduce((sum, r) => sum + r.usd, 0); }
function dailySpent(state, day) { return state.entries.filter(e => e.at?.slice(0, 10) === day && e.label !== 'chronos-3d').reduce((sum, e) => sum + e.usd, 0) + totalReserved(state); }
function operations(transact) {
  return {
    initialize: () => transact('init', () => undefined),
    total: () => transact(false, state => state.totalUsd),
    reserved: () => transact(false, totalReserved),
    entries: () => transact(false, state => state.entries.map(e => ({ ...e }))),
    add(entry) { transact(true, state => { if (!Number.isFinite(entry.usd) || entry.usd < 0) throw new Error('Invalid ledger entry'); state.totalUsd += entry.usd; state.entries.push({ ...entry, at: new Date().toISOString() }); }); },
    reserveChronosJob({ idempotencyKey, maxJobs }) { return transact(true, state => {
      if (!/^relic:[a-f0-9]{64}$/.test(idempotencyKey) || !Number.isInteger(maxJobs) || maxJobs < 0 || maxJobs > 6) throw new Error('Invalid Chronos reservation');
      const entries = state.entries.filter(e => e.label === 'chronos-3d');
      if (entries.some(e => e.idempotencyKey === idempotencyKey)) throw new Error('Chronos job key already reserved; investigate before retrying');
      if (entries.length >= maxJobs) throw new Error('Chronos job cap reached');
      state.entries.push({ label: 'chronos-3d', usd: 0, idempotencyKey, at: new Date().toISOString() });
    }); },
    reserveMeta({ estimateUsd, capUsd, dailyCapUsd, day = new Date().toISOString().slice(0, 10) }) { return transact(true, state => {
      if (![estimateUsd, capUsd].every(x => Number.isFinite(x) && x >= 0) || (dailyCapUsd !== undefined && (!Number.isFinite(dailyCapUsd) || dailyCapUsd < 0))) throw new Error('Invalid Meta reservation');
      const spent = state.totalUsd + totalReserved(state);
      if (state.budgetUncertain) return { refused: true, spent, cap: capUsd };
      if (spent + estimateUsd > capUsd) return { refused: true, spent, cap: capUsd };
      const daily = dailySpent(state, day);
      if (dailyCapUsd !== undefined && daily + estimateUsd > dailyCapUsd) return { refused: true, spent: daily, cap: dailyCapUsd };
      const id = randomUUID(); state.reservations[id] = { usd: estimateUsd, day }; return { id };
    }); },
    settleMeta(id, entry) { transact(true, state => {
      const reservation = state.reservations[id]; if (!reservation || !Number.isFinite(entry.usd) || entry.usd < 0) throw new Error('Invalid Meta settlement');
      state.totalUsd += entry.usd; state.entries.push({ ...entry, at: new Date().toISOString(), reservationDay: reservation.day });
      if (entry.usd > reservation.usd) state.budgetUncertain = true;
      delete state.reservations[id];
    }); },
    markMetaUncertain(id) { transact(true, state => { if (!state.reservations[id]) throw new Error('Invalid Meta reservation'); state.budgetUncertain = true; }); },
  };
}
/** Memory implementation is shared between clients that share the same instance. */
export function memoryLedger(initial = 0) {
  const state = validate({ totalUsd: initial, entries: [], reservations: {} });
  return operations((_write, fn) => fn(state));
}
/** Synchronous lock is intentionally never recovered automatically after a crash. */
export function fileLedger(path = 'out/spend.json', { requireExisting = false } = {}) {
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  return operations((write, fn) => {
    let acquired = false;
    const start = Date.now();
    while (!acquired) {
      try { mkdirSync(lock); acquired = true; }
      catch (error) { if (error.code !== 'EEXIST') throw error; if (Date.now() - start >= 3000) throw new Error('Spend ledger lock is busy; investigate before recovery'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); }
    }
    let temporary;
    try {
      const existed = existsSync(path);
      let state;
      try { state = validate(JSON.parse(readFileSync(path, 'utf8'))); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (requireExisting) throw new Error('Spend ledger is missing; investigate before continuing');
        state = validate({ totalUsd: 0, entries: [], reservations: {} });
      }
      const result = fn(state);
      if (write === true || (write === 'init' && !existed)) {
        temporary = `${path}.${randomUUID()}.tmp`;
        const fd = openSync(temporary, 'wx', 0o600);
        try { writeFileSync(fd, JSON.stringify(state, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(temporary, path); temporary = undefined;
      }
      return result;
    } finally { if (temporary) { try { unlinkSync(temporary); } catch {} } rmdirSync(lock); }
  });
}
