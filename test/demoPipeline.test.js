import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configuredSpendCap, configuredDailyCap, configuredRateLimit, validateStartupConfig, taskSpendCap } from '../src/demo/budget.js';
import { createDemoRunner } from '../src/demo/pipeline.js';
import { createConfiguredDemoServer } from '../server/index.js';

test('configuredSpendCap uses META_SPEND_CAP_USD directly, initializes a missing ledger, and preserves existing ledger history', t => {
  const root = mkdtempSync(join(tmpdir(), 'demo-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(configuredSpendCap({ outputRoot: root, env: {} }), 100);
  const ledgerPath = join(root, 'spend.json');
  assert.equal(JSON.parse(readFileSync(ledgerPath, 'utf8')).totalUsd, 0);

  const history = {
    totalUsd: 22.0748,
    entries: [{ label: 'responses', model: 'muse-wonder-1.0', usd: 22.0748, at: '2026-10-30T12:00:00.000Z' }],
    reservations: { 'res-1': { usd: 0.1, day: '2026-10-30' } },
  };
  writeFileSync(ledgerPath, JSON.stringify(history));
  assert.equal(taskSpendCap({ outputRoot: root, env: { META_SPEND_CAP_USD: '143.30' } }), 143.3);
  assert.deepEqual(JSON.parse(readFileSync(ledgerPath, 'utf8')), history);

  for (const invalid of ['-1', 'NaN', 'Infinity', 'not-a-number']) {
    assert.throws(() => configuredSpendCap({ outputRoot: root, env: { META_SPEND_CAP_USD: invalid } }), /Invalid META_SPEND_CAP_USD/);
  }
  assert.equal(configuredDailyCap({ env: { META_SPEND_CAP_USD: '143.30' } }), 143.3);
  assert.equal(configuredDailyCap({ env: { META_SPEND_CAP_USD: '143.30', DEMO_DAILY_CAP_USD: '12.5' } }), 12.5);
  for (const invalidDaily of ['0', '-3', 'abc']) {
    assert.throws(() => configuredDailyCap({ env: { DEMO_DAILY_CAP_USD: invalidDaily } }), /Invalid DEMO_DAILY_CAP_USD/);
  }
});

test('configuredRateLimit documents loopback live and other-mode defaults and accepts an explicit positive integer', () => {
  assert.equal(configuredRateLimit({ env: {}, isLoopback: true, replayOnly: false }), 60);
  assert.equal(configuredRateLimit({ env: {}, isLoopback: true, replayOnly: true }), 5);
  assert.equal(configuredRateLimit({ env: {}, isLoopback: false, replayOnly: false }), 5);
  assert.equal(configuredRateLimit({ env: { DEMO_RATE_LIMIT: '25' }, isLoopback: false, replayOnly: true }), 25);
  assert.equal(configuredRateLimit({ env: { DEMO_RATE_LIMIT: '' }, isLoopback: true, replayOnly: false }), 60);
  for (const invalid of ['0', '-1', '2.5', 'Infinity', 'not-a-number']) {
    assert.throws(() => configuredRateLimit({ env: { DEMO_RATE_LIMIT: invalid } }), /Invalid DEMO_RATE_LIMIT/);
  }
});

test('validateStartupConfig and createConfiguredDemoServer support replay-only without a key and loopback live mode with META_API_KEY', async t => {
  const root = mkdtempSync(join(tmpdir(), 'demo-startup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const replayConfig = validateStartupConfig({ outputRoot: root, env: {} });
  assert.equal(replayConfig.replayOnly, true);
  assert.equal(replayConfig.hasMetaKey, false);
  assert.throws(() => createConfiguredDemoServer({ outputRoot: root, env: { DEMO_RATE_LIMIT: 'invalid' } }), /Invalid DEMO_RATE_LIMIT/);

  const replayInstance = createConfiguredDemoServer({ outputRoot: root, env: { PORT: '0' } });
  await new Promise(resolve => replayInstance.server.listen(0, replayInstance.host, resolve));
  t.after(() => new Promise(resolve => replayInstance.server.close(resolve)));
  const replayUrl = `http://${replayInstance.host}:${replayInstance.server.address().port}`;
  assert.deepEqual(await (await fetch(`${replayUrl}/health`)).json(), { status: 'ok', replayOnly: true, voiceEnabled: false, expansionLimit:20, expansionUsed:0 });

  const liveInstance = createConfiguredDemoServer({
    outputRoot: root,
    env: { META_API_KEY: 'fixture-key', META_SPEND_CAP_USD: '143.30', PORT: '0' },
  });
  await new Promise(resolve => liveInstance.server.listen(0, liveInstance.host, resolve));
  t.after(() => new Promise(resolve => liveInstance.server.close(resolve)));
  const liveUrl = `http://${liveInstance.host}:${liveInstance.server.address().port}`;
  const health = await (await fetch(`${liveUrl}/health`, { headers: { origin: liveUrl, 'sec-fetch-site': 'same-origin' } })).json();
  assert.deepEqual(health, { status: 'ok', replayOnly: false, voiceEnabled: true, localReviewAccess: true, expansionLimit:20, expansionUsed:0 });
  assert.doesNotMatch(JSON.stringify(health), /fixture-key/);

  assert.throws(() => validateStartupConfig({ outputRoot: root, env: { DEMO_ACCESS_CODE: 'code-only', DEMO_REPLAY_ONLY: 'false' } }), /META_API_KEY is required/);
  assert.throws(() => validateStartupConfig({ outputRoot: root, env: { META_API_KEY: 'k', META_API_BASE_URL: 'http://example.com' } }), /Invalid META_API_BASE_URL/);
  assert.throws(() => validateStartupConfig({ outputRoot: root, env: { META_API_KEY: 'k', DEMO_3D_ENABLED: 'true' } }), /Confirmed Chronos TRELLIS/);
});

test('Meta-only live runner does not require 3D configuration or a task checkpoint, while enabled 3D remains gated', async t => {
  const root = mkdtempSync(join(tmpdir(), 'demo-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runner = createDemoRunner({ env: { META_API_KEY: 'fixture-key', META_SPEND_CAP_USD: '0' }, outputRoot: root });
  assert.equal(runner.enforcesDailyCap, true);
  await assert.rejects(runner({ divergence: 'What if a library survived?' }), /spend cap reached/i);
  const with3d = createDemoRunner({ env: { DEMO_3D_ENABLED: 'true' }, outputRoot: root, dailyCapUsd: 3 });
  await assert.rejects(with3d({ divergence: 'What if a library survived?' }), /Confirmed Chronos/i);
});

test('branch and smoke scripts enforce configured spend ceiling before dispatching live calls and redact credentials', t => {
  const root = mkdtempSync(join(tmpdir(), 'demo-scripts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ['branch', 'smoke']) {
    const script = fileURLToPath(new URL(`../scripts/${name}.js`, import.meta.url));
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, META_API_KEY: 'fixture-sentinel', META_SPEND_CAP_USD: '0' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /spend cap reached/i);
    assert.doesNotMatch(result.stderr, /fixture-sentinel/);
  }
});
