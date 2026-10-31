import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createDemoServer } from '../server/index.js';

async function start(t, { localReviewAccess = true, bind = '127.0.0.1' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'office-local-review-'));
  const runsDir = join(dir, 'runs'), liveRunsDir = join(dir, 'live'), webDir = join(dir, 'web');
  await Promise.all([mkdir(runsDir), mkdir(liveRunsDir), mkdir(webDir)]);
  const runner = async ({ runId }) => ({ runId, branch: { status: 'ok', branches: [], hero: null } });
  runner.enforcesDailyCap = true;
  const server = createDemoServer({ runsDir, liveRunsDir, webDir, env: { DEMO_ACCESS_CODE: 'secret-code', DEMO_VOICE_ENABLED: 'true' }, runPipeline: runner, localReviewAccess });
  await new Promise(resolve => server.listen(0, bind, resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  return `http://127.0.0.1:${server.address().port}`;
}
const request = (url, headers = {}) => fetch(`${url}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ divergence: 'What if a garden grew?' }) });

test('local preview permits same-origin browser requests without revealing or storing a code', async t => {
  const url = await start(t);
  const headers = { origin: url, 'sec-fetch-site': 'same-origin' };
  const health = await (await fetch(`${url}/health`, { headers })).json();
  assert.equal(health.localReviewAccess, true); assert.equal(JSON.stringify(health).includes('secret-code'), false);
  assert.equal((await fetch(`${url}/api/history`, { headers })).status, 200);
  assert.equal((await fetch(`${url}/api/transcribe`, { method: 'POST', headers: { ...headers, 'content-type': 'audio/wav' }, body: 'invalid' })).status, 400);
  const response = await request(url, headers); assert.equal(response.status, 200); assert.match(await response.text(), /event: complete/);
});

test('local exception cannot be activated by remote origins, missing browser context, spoofed host, public bind, or default configuration', async t => {
  const url = await start(t);
  assert.equal((await request(url)).status, 403);
  assert.equal((await request(url, { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' })).status, 403);
  const spoofed = await new Promise((resolve, reject) => { const req = httpRequest(url + '/api/run', { method:'POST', headers:{ origin:url, 'sec-fetch-site':'same-origin', host:'attacker.example', 'content-type':'application/json' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(JSON.stringify({divergence:'What if a garden grew?'})); });
  assert.equal(spoofed, 403);
  assert.equal((await request(url, { 'sec-fetch-site': 'same-origin' })).status, 403);
  const off = await start(t, { localReviewAccess: false });
  assert.equal((await request(off, { origin: off, 'sec-fetch-site': 'same-origin' })).status, 403);
  const publicBind = await start(t, { bind: '0.0.0.0' });
  assert.equal((await request(publicBind, { origin: publicBind, 'sec-fetch-site': 'same-origin' })).status, 403);
  assert.equal((await request(off, { 'x-demo-access-code': 'secret-code' })).status, 200);
});
