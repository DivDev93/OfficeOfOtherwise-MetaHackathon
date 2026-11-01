import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileLedger, memoryLedger } from '../src/lib/spendLedger.js';

const key = n => `relic:${n.toString(16).padStart(64, '0')}`;
const setup = () => { const dir = mkdtempSync(join(tmpdir(), 'office-ledger-')); return { dir, path: join(dir, 'spend.json') }; };
test('Chronos reservations survive reopening and refuse replays and new keys at cap', () => { const { dir, path } = setup(); try { const l = fileLedger(path); l.add({ label: 'meta', usd: .5 }); l.reserveChronosJob({ idempotencyKey: key(1), maxJobs: 1 }); const again = fileLedger(path); assert.throws(() => again.reserveChronosJob({ idempotencyKey: key(1), maxJobs: 1 }), /already reserved/); assert.throws(() => again.reserveChronosJob({ idempotencyKey: key(2), maxJobs: 1 }), /cap/); assert.equal(again.total(), .5); assert.equal(again.entries().length, 2); } finally { rmSync(dir, { recursive: true, force: true }); } });
test('unresolved reservations count against later daily limits', () => { const l = memoryLedger(); l.reserveMeta({ estimateUsd: .7, capUsd: 2, dailyCapUsd: 1, day: '2026-10-27' }); assert.equal(l.reserveMeta({ estimateUsd: .4, capUsd: 2, dailyCapUsd: 1, day: '2026-10-28' }).refused, true); });
test('an underestimated settlement records actual spending and only numerical cap stops later calls', () => { const l = memoryLedger(); const a = l.reserveMeta({ estimateUsd: .1, capUsd: 2 }); l.settleMeta(a.id, { label: 'text', usd: .2 }); assert.equal(l.total(), .2); assert.equal(l.reserved(), 0); assert.equal(l.reserveMeta({ estimateUsd: .01, capUsd: 2 }).id !== undefined, true); assert.equal(l.reserveMeta({ estimateUsd: 1.8, capUsd: 2 }).refused, true); });
test('legacy uncertainty latch remains diagnostic while settled spend and held reservations determine headroom', () => {
  const { dir, path } = setup();
  try {
    const id = 'legacy-pending';
    writeFileSync(path, JSON.stringify({ totalUsd: 40.6581, budgetUncertain: true, entries: [], reservations: { [id]: { usd: .247056, day: '2026-11-01' } } }));
    const l = fileLedger(path);
    const next = l.reserveMeta({ estimateUsd: .1, capUsd: 143.3, day: '2026-11-01' });
    assert.ok(next.id, 'legacy held exposure must not blanket-block a call with headroom');
    assert.ok(Math.abs(l.reserved() - .347056) < 1e-12, 'legacy and new reservations both remain held');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).budgetUncertain, true, 'preserve old diagnostic history');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('known over-estimate is fully accounted and the historical latch does not block headroom', () => {
  const l = memoryLedger(); const a = l.reserveMeta({ estimateUsd: .1, capUsd: 2 });
  l.settleMeta(a.id, { label: 'text', usd: .2 });
  assert.equal(l.total(), .2); assert.equal(l.reserved(), 0);
  assert.ok(l.reserveMeta({ estimateUsd: .01, capUsd: 2 }).id);
});
test('reservations enforce total and UTC daily budgets across clients and settlement', () => { const l = memoryLedger(); const a = l.reserveMeta({ estimateUsd: .6, capUsd: 2, dailyCapUsd: 1, day: '2026-10-27' }); assert.equal(l.reserveMeta({ estimateUsd: .5, capUsd: 2, dailyCapUsd: 1, day: '2026-10-27' }).refused, true); l.settleMeta(a.id, { label: 'image', usd: .4 }); assert.equal(l.reserved(), 0); assert.equal(l.total(), .4); assert.equal(l.reserveMeta({ estimateUsd: 1.7, capUsd: 2, day: '2026-10-28' }).refused, true); });
test('malformed ledger fails closed', () => { const { dir, path } = setup(); try { writeFileSync(path, '{'); assert.throws(() => fileLedger(path).total()); } finally { rmSync(dir, { recursive: true, force: true }); } });
test('requireExisting makes a missing ledger fail closed', () => { const { dir, path } = setup(); try { const ledger = fileLedger(path, { requireExisting: true }); assert.throws(() => ledger.total(), /ledger is missing/i); assert.throws(() => ledger.initialize(), /ledger is missing/i); assert.throws(() => ledger.reserveChronosJob({ idempotencyKey: key(1), maxJobs: 6 }), /ledger is missing/i); } finally { rmSync(dir, { recursive: true, force: true }); } });
test('concurrent processes reserve at most six unique jobs', async () => { const { dir, path } = setup(); try {
  const moduleUrl = new URL('../src/lib/spendLedger.js', import.meta.url).href;
  const code = `import {fileLedger} from ${JSON.stringify(moduleUrl)}; try {const l=fileLedger(process.argv[1]); l.reserveChronosJob({idempotencyKey:'relic:'+Number(process.argv[2]).toString(16).padStart(64,'0'),maxJobs:6}); process.exitCode=0;} catch(e) {if(String(e?.message).toLowerCase().includes('cap')) process.exitCode=1; else {process.stderr.write('UNEXPECTED_LEDGER_ERROR\\n'); process.exitCode=2;}}`;
  const children = Array.from({ length: 12 }, (_, i) => new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, path, String(i + 1)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { if (stderr.length < 512) stderr += chunk.slice(0, 512 - stderr.length); });
    child.on('error', rejectChild);
    child.on('close', (code, signal) => resolveChild({ code, signal, stderr: stderr.trim() }));
  }));
  const results = await Promise.all(children);
  const summary = results.map((result, i) => `child ${i + 1}: exit=${result.code ?? 'null'}${result.signal ? ` signal=${result.signal}` : ''}${result.stderr ? ` stderr=${result.stderr}` : ''}`).join('; ');
  assert.equal(results.filter(result => result.code === 0).length, 6, `expected six successful reservations; ${summary}`);
  assert.equal(results.filter(result => result.code === 1).length, 6, `expected six cap refusals; ${summary}`);
  assert.equal(results.filter(result => result.code !== 0 && result.code !== 1).length, 0, `unexpected child result; ${summary}`);
  assert.equal(fileLedger(path).entries().length, 6);
} finally { rmSync(dir, { recursive: true, force: true }); } });

test('concurrent Meta reservations include a legacy uncertainty hold atomically', async () => { const { dir, path } = setup(); try {
  writeFileSync(path, JSON.stringify({ totalUsd: 0, budgetUncertain: true, entries: [], reservations: { held: { usd: .06, day: '2026-11-01' } } }));
  const moduleUrl = new URL('../src/lib/spendLedger.js', import.meta.url).href;
  const code = `import {fileLedger} from ${JSON.stringify(moduleUrl)}; try {const r=fileLedger(process.argv[1]).reserveMeta({estimateUsd:.06,capUsd:.3,day:'2026-11-01'}); process.exitCode=r.refused?1:0;} catch {process.exitCode=2;}`;
  const results = await Promise.all(Array.from({ length: 10 }, () => new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, path], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { if (stderr.length < 512) stderr += chunk.slice(0, 512 - stderr.length); });
    child.on('error', rejectChild); child.on('close', (code, signal) => resolveChild({ code, signal, stderr }));
  })));
  const summary = results.map(x => `${x.code}${x.signal ? `:${x.signal}` : ''}${x.stderr ? `:${x.stderr}` : ''}`).join(',');
  assert.equal(results.filter(x => x.code === 0).length, 4, `the $0.06 hold leaves exactly four $0.06 slots; ${summary}`);
  assert.equal(results.filter(x => x.code === 1).length, 6, `remaining reservations must hit the numeric cap; ${summary}`);
  assert.equal(results.filter(x => x.code !== 0 && x.code !== 1).length, 0, summary);
  assert.ok(Math.abs(fileLedger(path).reserved() - .3) < 1e-12);
} finally { rmSync(dir, { recursive: true, force: true }); } });
