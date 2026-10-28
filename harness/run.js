import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMetaClient } from '../src/lib/metaClient.js';
import { fileLedger } from '../src/lib/spendLedger.js';
import { createTopicPolicy, createModelClassifier, categoriesFromEnv } from '../src/guardrails/topicPolicy.js';
import { createBranchAgent } from '../src/agents/branchAgent.js';
import { createMetaImage } from '../src/providers/metaImage.js';
import { createSamMask } from '../src/providers/samMask.js';
import { writeMaskPng, writeCutoutPng, decodePng } from '../src/lib/png.js';
import { createChronos3dClient, chronosIdempotencyKey } from '../src/providers/chronos3d.js';
import { taskSpendCap } from '../src/demo/budget.js';

/** Run the chain with a single metered client. Dependencies may be injected for tests. */
export async function runHarness({ divergence, from, subjectOverride, client, agent, image, sam, policy, outputRoot = 'out', timestamp = Date.now(), log = console.log, apiCalls = [], onStep, chronos3d, no3d = true, signal }) {
  if (subjectOverride !== undefined && (!from || typeof subjectOverride !== 'string' || !subjectOverride.trim())) throw new Error('A nonempty subject override requires a saved branch');
  if (!no3d && typeof chronos3d?.generate !== 'function') throw new Error('Chronos 3D client is required');
  const throwIfAborted = () => { if (signal?.aborted) throw new Error('Run aborted'); };
  const runId = String(timestamp);
  const emit = event => onStep?.({ ...event, runId });
  const url = name => `/runs/${encodeURIComponent(runId)}/${name}`;
  const startedSpent = client.spent();
  const directory = join(outputRoot, String(timestamp));
  mkdirSync(directory, { recursive: true });
  const trace = [];
  let selection = null;
  const persistTrace = () => writeFileSync(join(directory, 'trace.json'), JSON.stringify({ source: from ? resolve(from) : null, subjectOverride: subjectOverride?.trim() ?? null, steps: trace, selection, costUsd: client.spent() - startedSpent }, null, 2));
  let branch;
  try {
    throwIfAborted();
    branch = from ? JSON.parse(readFileSync(from, 'utf8')) : await agent.run({ divergence, count: 3, onStep: emit, signal });
  } catch (error) {
    trace.push(...apiCalls, { step: 'agent', error: error.message });
    persistTrace();
    throw error;
  }
  if (!branch || !['ok', 'blocked', 'empty'].includes(branch.status)) throw new Error('Invalid saved branch status');
  writeFileSync(join(directory, 'branch.json'), JSON.stringify(branch, null, 2));
  // Agent policy traces are aggregate summaries; record each actual API call separately.
  trace.push(...apiCalls);
  trace.push(...(branch.trace ?? []).map(t => ({ ...t, summary: !from, originalCostUsd: t.costUsd ?? null, costUsd: 0, ...(from ? { reused: true } : {}) })));
  persistTrace();
  log(`status: ${branch.status}`);
  if (branch.status !== 'ok') {
    if (branch.reframe) log(`reframe: ${branch.reframe}`);
    if (branch.reason) log(`reason: ${branch.reason}`);
    for (const r of branch.rejected ?? []) log(`rejected: ${r.category ?? r.reason ?? 'off policy'}`);
    log(`run cost: $${(client.spent() - startedSpent).toFixed(5)} | saved: ${directory}`);
    return { directory, branch, trace, costUsd: client.spent() - startedSpent };
  }
  if (!branch.hero?.imagePrompt || !branch.hero?.subject) throw new Error('Branch hero requires an image prompt and subject');
  if (from) {
    if (!policy?.checkPrompt) throw new Error('Saved branches require a topic policy check');
    const text = [branch.divergence ?? '', ...(branch.branches ?? []).flatMap(b => [b.title ?? '', b.summary ?? '', b.scene ?? '']), branch.hero.imagePrompt, branch.hero.subject, subjectOverride ?? ''].join('\n');
    const callStart = apiCalls.length, start = performance.now(), before = client.spent();
    let gate;
    try { throwIfAborted(); gate = await policy.checkPrompt(text); }
    catch (error) {
      trace.push(...apiCalls.slice(callStart), { step: 'policy:reuse', model: 'policy', ms: Math.round(performance.now() - start), costUsd: 0, summary: true, error: error.message });
      persistTrace();
      throw error;
    }
    trace.push(...apiCalls.slice(callStart), { step: 'policy:reuse', model: gate.layer === 'model' ? (process.env.META_TEXT_MODEL_PLANNER || 'muse-wonder-1.0') : gate.layer, ms: Math.round(performance.now() - start), costUsd: 0, originalCostUsd: client.spent() - before, summary: true, allowed: gate.allowed });
    persistTrace();
    if (!gate.allowed) {
      log(`status: blocked\nreframe: ${gate.reframe ?? ''}\nreason: ${gate.reason ?? gate.matched ?? gate.category ?? 'topic policy'}`);
      log(`run cost: $${(client.spent() - startedSpent).toFixed(5)} | saved: ${directory}`);
      return { directory, branch, trace, costUsd: client.spent() - startedSpent, blocked: true };
    }
  }
  throwIfAborted();
  let start = performance.now();
  let before = client.spent();
  let generated;
  try {
    generated = await image.generate({ prompt: branch.hero.imagePrompt, size: '1024x1024' });
  } catch (error) {
    if (error.rawResponse !== undefined) writeFileSync(join(directory, 'image-response.json'), JSON.stringify(error.rawResponse, null, 2));
    trace.push({ step: 'image', model: process.env.META_IMAGE_MODEL ?? 'muse-image-1.0', ms: Math.round(performance.now() - start), costUsd: client.spent() - before, error: error.message });
    persistTrace();
    throw error;
  }
  trace.push({ step: 'image', model: image.model ?? process.env.META_IMAGE_MODEL ?? 'muse-image-1.0', ms: Math.round(performance.now() - start), costUsd: generated.costUsd });
  writeFileSync(join(directory, 'hero.png'), generated.buffer);
  persistTrace();
  emit({ step: 'image', url: url('hero.png'), ...trace.at(-1) });
  const appendSam = result => {
    for (const step of result.trace ?? []) trace.push({ step: 'segment', ...step });
    for (const [index, raw] of (result.rawOutputs ?? []).entries()) writeFileSync(join(directory, `sam-raw-${index + 1}.txt`), typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2));
    for (const [index, raw] of (result.rawResponses ?? []).entries()) writeFileSync(join(directory, `sam-response-${index + 1}.json`), JSON.stringify(raw, null, 2));
  };
  let segmented;
  start = performance.now();
  before = client.spent();
  try {
    throwIfAborted();
    segmented = await sam.segment({ image: generated.buffer, mime: generated.mime, prompt: subjectOverride?.trim() ?? branch.hero.subject });
  } catch (error) {
    appendSam(error);
    if (!error.trace?.length) trace.push({ step: 'segment', model: process.env.META_SEGMENT_MODEL ?? 'sam-3.1', ms: Math.round(performance.now() - start), costUsd: client.spent() - before, error: error.message });
    else trace.push({ step: 'segment:error', error: error.message });
    persistTrace();
    throw error;
  }
  appendSam(segmented);
  persistTrace();
  const mask = segmented.selectedMask;
  if (!mask) throw new Error(`No segmentation mask found; trace saved in ${directory}`);
  const hero = decodePng(generated.buffer);
  if (hero.width !== mask.width || hero.height !== mask.height || mask.raster.length !== hero.width * hero.height) throw new Error('Mask dimensions do not match hero image');
  const rgba = Buffer.from(hero.data);
  let area = 0;
  for (let i = 0; i < mask.raster.length; i++) { if (mask.raster[i]) area++; else rgba[i * 4 + 3] = 0; }
  selection = { index: (segmented.masks ?? []).indexOf(mask), objectId: mask.objectId ?? null, confidence: mask.confidence ?? null, box: mask.box ?? null, area, prompt: segmented.trace?.at(-1)?.prompt ?? branch.hero.subject };
  persistTrace();
  const maskPng = writeMaskPng(mask.raster, mask.width, mask.height);
  writeFileSync(join(directory, 'mask.png'), maskPng);
  writeFileSync(join(directory, 'cutout.png'), writeCutoutPng(rgba, hero.width, hero.height));
  const segments = segmented.trace ?? [];
  emit({ step: 'cutout', url: url('cutout.png'), model: 'SAM 3.1', ms: segments.reduce((n, t) => n + (t.ms ?? 0), 0), costUsd: segments.reduce((n, t) => n + (t.costUsd ?? 0), 0) });
  if (!no3d) {
    throwIfAborted();
    const start3d = performance.now();
    try {
      const result = await chronos3d.generate({ imagePng: generated.buffer, maskPng, idempotencyKey: chronosIdempotencyKey(runId, branch.hero), signal });
      writeFileSync(join(directory, 'model.glb'), result.glb);
      const record = { step: '3d', model: 'Tattva TRELLIS', ms: result.ms ?? Math.round(performance.now() - start3d), costUsd: 0 };
      trace.push(record); persistTrace(); emit({ ...record, url: url('model.glb') });
    } catch (error) {
      trace.push({ step: '3d', model: 'Tattva TRELLIS', ms: Math.round(performance.now() - start3d), costUsd: 0, error: error.message }); persistTrace(); throw error;
    }
  }
  log(`hero subject: ${subjectOverride?.trim() ?? branch.hero.subject}`);
  log(`selected mask: confidence ${mask.confidence ?? 'unknown'}, area ${area} pixels`);
  for (const t of trace) log(`${t.step}: ${t.model ?? 'unknown'} ${t.ms ?? 0}ms $${(t.costUsd == null ? 'unknown' : Number(t.costUsd).toFixed(5))}${t.reused ? ' (reused)' : ''}`);
  const costUsd = client.spent() - startedSpent;
  log(`run cost: $${costUsd.toFixed(5)} | total spent: $${client.spent().toFixed(5)} | saved: ${directory}`);
  return { directory, branch, trace, costUsd, selectedMask: mask, area };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const no3d = rawArgs.includes('--no-3d');
  const args = rawArgs.filter(arg => arg !== '--no-3d');
  let from, divergence, subjectOverride;
  if (args[0] === '--from') {
    if (args.length !== 2 && !(args.length === 4 && args[2] === '--subject')) throw new Error('Usage: npm run harness -- --from <branch.json> [--subject <noun phrase>] [--no-3d]');
    from = args[1];
    if (args.length === 4) subjectOverride = args[3];
  } else divergence = args.join(' ') || 'What if the Library of Alexandria never burned?';
  const ledger = fileLedger('out/spend.json', { requireExisting: true });
  let chronos3d;
  if (!no3d) {
    if (process.env.CHRONOS_3D_CAPABILITY_CONFIRMED !== 'true') throw new Error('Chronos TRELLIS capability must be confirmed before generation');
    const allowedArtifactOrigins = (process.env.CHRONOS_3D_ARTIFACT_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean);
    chronos3d = createChronos3dClient({ jobLedger: ledger, capabilityConfirmed: true, allowedArtifactOrigins });
  }
  const spendCapUsd = taskSpendCap({ env: process.env, outputRoot: 'out' });
  const dailyCapUsd = Number(process.env.DEMO_DAILY_CAP_USD ?? 3);
  const client = createMetaClient({ ledger, spendCapUsd, dailyCapUsd });
  const model = process.env.META_TEXT_MODEL_PLANNER || 'muse-wonder-1.0';
  const categories = categoriesFromEnv();
  const apiCalls = [];
  const agentClient = { ...client, async respond(args) {
    const start = performance.now();
    try {
      const result = await client.respond(args);
      apiCalls.push({ step: args.label ?? 'responses', model: args.model, ms: Math.round(performance.now() - start), costUsd: result.costUsd });
      return result;
    } catch (error) {
      apiCalls.push({ step: args.label ?? 'responses', model: args.model, ms: Math.round(performance.now() - start), costUsd: error.costUsd ?? 0, error: error.message });
      throw error;
    }
  } };
  const policy = createTopicPolicy({ categories, classify: createModelClassifier(agentClient, { model, categories }) });
  const agent = createBranchAgent({ client: agentClient, policy, model });
  await runHarness({ divergence, from, subjectOverride, client, agent, image: createMetaImage({ client }), sam: createSamMask({ client }), policy, apiCalls, chronos3d, no3d });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
