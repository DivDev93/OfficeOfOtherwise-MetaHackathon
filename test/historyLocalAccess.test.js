import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfiguredDemoServer } from '../server/index.js';

async function start(t, { localHistoryAccess, localReviewAccess, host = '127.0.0.1' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'office-local-history-replay-'));
  const runsDir = join(root, 'runs'), runDir = join(runsDir, 'replay-root');
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'branch.json'), JSON.stringify({ status: 'ok', divergence: 'What if the Sahara remained green?', branches: [
    { id: 'visited', year: -4000, title: 'Lake settlements grow', summary: 'Communities live by the lakes.', place: { name: 'Sahara', lat: 20, lon: 10 },
      causeEventId: 'replay-root', geography: { version: 1, changes: [] } },
    { id: 'candidate', year: -3000, title: 'Shallow canal gardens spread', summary: 'Communities share water channels.', place: { name: 'Sahara', lat: 20, lon: 10 },
      causeEventId: 'replay-root', geography: { version: 1, changes: [] } },
  ], hero: { branchId: 'visited' } }));
  const instance = createConfiguredDemoServer({ outputRoot: join(root, 'out'), runsDir, host,
    ...(localHistoryAccess === undefined ? {} : { localHistoryAccess }),
    ...(localReviewAccess === undefined ? {} : { localReviewAccess }),
    env: { PORT: '0' },
  });
  await new Promise(resolve => instance.server.listen(instance.port, instance.host, resolve));
  t.after(async () => {
    if (instance.server.listening) await new Promise((resolve, reject) => instance.server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : instance.host}:${instance.server.address().port}`;
  const health = await fetch(`${url}/health`, { headers: { origin: url, 'sec-fetch-site': 'same-origin' } });
  return { url, instance, cookie: health.headers.get('set-cookie')?.split(';', 1)[0] };
}

test('keyless loopback permits same-origin saved history reads and cached edits only', async t => {
  const { url, instance, cookie } = await start(t);
  assert.equal(instance.hasMetaKey, false);
  assert.equal(instance.localHistoryAccess, true);
  assert.equal(instance.localReviewAccess, false, 'the broader local preview capability stays off');
  const headers = { cookie, origin: url, 'sec-fetch-site': 'same-origin' };
  const health = await (await fetch(`${url}/health`, { headers })).json();
  assert.equal(health.localHistoryAccess, true, 'the narrow history capability has its own UI health flag');
  assert.equal(health.metaKeyConfigured, false);
  assert.equal('replayOnly' in health, false);
  assert.equal(health.localReviewAccess, false, 'the health flag does not turn on live or voice access');
  const read = await fetch(`${url}/api/histories`, { headers });
  assert.equal(read.status, 200);
  const question = (await read.json()).questions.find(item => item.id === 'replay-root');
  assert.ok(question, 'the saved replay appears in the history timeline');
  const history = question.histories[0];
  const candidate = history.suggestions.find(item => item.suggestionForEventId === 'replay-root:candidate');
  assert.ok(candidate, 'the unvisited replay branch is available as a saved suggestion');

  const weave = await fetch(`${url}/api/history/weave`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ questionId: question.id, historyId: history.id, suggestionId: candidate.id }) });
  assert.equal(weave.status, 200, 'a saved replay suggestion can be woven without a Meta key');
  assert.equal((await weave.json()).event.id, candidate.id);

  assert.equal((await fetch(`${url}/api/histories`)).status, 403, 'missing browser context stays unauthorized');
  assert.equal((await fetch(`${url}/api/histories`, { headers: { ...headers, origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' } })).status, 403,
    'remote origins cannot use the loopback exception');
});

test('explicit access settings can disable keyless replay history access', async t => {
  const disabled = await start(t, { localReviewAccess: false });
  assert.equal(disabled.instance.localHistoryAccess, false);
  assert.equal((await fetch(`${disabled.url}/api/histories`, { headers: {
    cookie: disabled.cookie, origin: disabled.url, 'sec-fetch-site': 'same-origin',
  } })).status, 403);

  const explicitlyDisabled = await start(t, { localHistoryAccess: false });
  assert.equal(explicitlyDisabled.instance.localHistoryAccess, false);
  assert.equal((await fetch(`${explicitlyDisabled.url}/api/histories`, { headers: {
    cookie: explicitlyDisabled.cookie, origin: explicitlyDisabled.url, 'sec-fetch-site': 'same-origin',
  } })).status, 403);
});

test('keyless replay history access is never enabled on a non-loopback bind', async t => {
  const publicBind = await start(t, { host: '0.0.0.0' });
  assert.equal(publicBind.instance.localHistoryAccess, false);
  assert.equal((await fetch(`${publicBind.url}/api/histories`, { headers: {
    cookie: publicBind.cookie, origin: publicBind.url, 'sec-fetch-site': 'same-origin',
  } })).status, 403);
});
