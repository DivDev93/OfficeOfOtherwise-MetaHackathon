import { mkdir, mkdtemp, readdir, lstat, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTopicPolicy } from '../src/guardrails/topicPolicy.js';

// A deliberately simulated unavailable classifier demonstrates the real fail-closed
// policy without committing prohibited subject matter or implying a live model call.
export async function cacheGuardrailFixture(root = 'demo/runs') {
  const divergence = 'What if an ancient library survived?';
  const gate = await createTopicPolicy({ classify: async () => null }).checkPrompt(divergence);
  if (gate.allowed || gate.category !== 'unverifiable') throw new Error('Fail-closed policy did not block the fixture');
  const branch = { status: 'blocked', divergence, branches: [], rejected: [], hero: null, reason: gate.reason, reframe: gate.reframe, trace: [], costUsd: 0 };
  const trace = { steps: [], costUsd: 0, simulated: true };
  const manifest = { status: 'simulated', reason: 'Fixture: classifier unavailable; no live model call' };
  const files = { 'branch.json': branch, 'trace.json': trace, 'manifest.json': manifest };
  async function size(path) {
    let total = 0;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Symlinks are not accepted in cache');
      const full = join(path, entry.name);
      if (entry.isDirectory()) total += await size(full); else if (entry.isFile()) total += (await lstat(full)).size;
    }
    return total;
  }
  await mkdir(root, { recursive: true });
  const projected = (await size(root)) + Object.values(files).reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value, null, 2) + '\n'), 0);
  if (projected >= 40_000_000) throw new Error('Cache size cap exceeded');
  const destination = join(root, 'guardrail');
  try { await lstat(destination); throw new Error('Guardrail replay already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stage = await mkdtemp(join(resolve(root), '.guardrail-stage-'));
  try {
    for (const [name, value] of Object.entries(files)) await writeFile(join(stage, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    await rename(stage, destination);
  } finally {
    if (!resolve(stage).startsWith(resolve(root) + sep)) throw new Error('Invalid staging directory');
    await rm(stage, { recursive: true, force: true });
  }
  return { destination, status: manifest.status };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  cacheGuardrailFixture().then(result => console.log(`Saved ${result.status} guardrail replay: ${result.destination}`)).catch(() => { console.error('Could not create guardrail fixture'); process.exitCode = 1; });
}
