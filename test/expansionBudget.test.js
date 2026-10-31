import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configuredExpansionLimit, createExpansionBudget } from '../src/demo/expansionBudget.js';

test('per-session expansion budget defaults safely and validates the operator limit', () => {
  assert.equal(configuredExpansionLimit({}), 20);
  assert.equal(configuredExpansionLimit({ DEMO_MAX_EXPANSIONS_PER_SESSION: '7' }), 7);
  for (const value of ['0', '-1', '1.2', '1e2', '9007199254740992', 'no']) {
    assert.throws(() => configuredExpansionLimit({ DEMO_MAX_EXPANSIONS_PER_SESSION: value }));
  }
});

test('session ledger deduplicates repeated node entry and caps unique nodes', () => {
  const budget = createExpansionBudget(2), session = budget.issue();
  assert.deepEqual(budget.reserve(session, 'root/a'), { allowed: true, used: 1, duplicate: false });
  assert.deepEqual(budget.reserve(session, 'root/a'), { allowed: true, used: 1, duplicate: true });
  assert.deepEqual(budget.reserve(session, 'root/b'), { allowed: true, used: 2, duplicate: false });
  assert.deepEqual(budget.reserve(session, 'root/c'), { allowed: false, used: 2, limit: 2 });
  assert.equal(budget.usage('22222222-2222-4222-8222-222222222222'), 0);
});

test('session usage survives server recreation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'expansion-budget-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'sessions.json'), first = createExpansionBudget(1, { filePath }), session = first.issue();
  first.reserve(session, 'root/a');
  const restarted = createExpansionBudget(1, { filePath });
  assert.equal(restarted.usage(session), 1);
  assert.equal(restarted.reserve(session, 'root/b').allowed, false);
});
