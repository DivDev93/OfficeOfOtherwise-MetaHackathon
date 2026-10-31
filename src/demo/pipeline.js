import { join } from 'node:path';
import { PNG } from 'pngjs';
import { createMetaClient, markUndispatchedBudgetError } from '../lib/metaClient.js';
import { fileLedger } from '../lib/spendLedger.js';
import { createTopicPolicy, createModelClassifier, categoriesFromEnv } from '../guardrails/topicPolicy.js';
import { createBranchAgent } from '../agents/branchAgent.js';
import { createMetaImage } from '../providers/metaImage.js';
import { createSamMask } from '../providers/samMask.js';
import { createChronos3dClient } from '../providers/chronos3d.js';
import { runHarness } from '../../harness/run.js';
import { configuredSpendCap, configuredDailyCap, resolveLedgerPath } from './budget.js';

export function createDemoEventSceneRunner({ env = process.env, dailyCapUsd, outputRoot = 'out' } = {}) {
  const runner = async ({ prompt }) => {
    const spendCapUsd = configuredSpendCap({ env, outputRoot });
    const resolvedDailyCap = dailyCapUsd ?? configuredDailyCap({ env, spendCapUsd });
    const ledger = fileLedger(resolveLedgerPath({ env, outputRoot }), { requireExisting: true });
    const client = createMetaClient({ env, ledger, spendCapUsd, dailyCapUsd: resolvedDailyCap });
    const initialDispatchCount = client.dispatchCount();
    try { return await createMetaImage({ client, env }).generate({ prompt }); }
    catch (error) { throw markUndispatchedBudgetError(error, client, initialDispatchCount); }
  };
  runner.enforcesDailyCap = true;
  return runner;
}

export function createDemoEventCutoutRunner({ env = process.env, dailyCapUsd, outputRoot = 'out' } = {}) {
  const runner = async ({ image, prompt }) => {
    const spendCapUsd = configuredSpendCap({ env, outputRoot });
    const resolvedDailyCap = dailyCapUsd ?? configuredDailyCap({ env, spendCapUsd });
    const ledger = fileLedger(resolveLedgerPath({ env, outputRoot }), { requireExisting: true });
    const client = createMetaClient({ env, ledger, spendCapUsd, dailyCapUsd: resolvedDailyCap });
    const initialDispatchCount = client.dispatchCount();
    try {
      const segmented = await createSamMask({ client, env }).segment({ image, mime: 'image/png', prompt });
      const mask = segmented?.selectedMask;
      if (!mask) return { status: 'empty' };
      const source = PNG.sync.read(image);
      if (mask.width !== source.width || mask.height !== source.height || mask.raster?.length !== source.width * source.height) throw new Error('SAM mask dimensions do not match the event image');
      for (let i = 0; i < mask.raster.length; i++) {
        const offset = i * 4;
        if (!mask.raster[i]) source.data[offset + 3] = 0;
      }
      return { buffer: PNG.sync.write(source), mime: 'image/png' };
    } catch (error) { throw markUndispatchedBudgetError(error, client, initialDispatchCount); }
  };
  runner.enforcesDailyCap = true;
  return runner;
}

export function createDemoRunner({ env = process.env, dailyCapUsd, outputRoot = 'out' } = {}) {
  const runner = async ({ divergence, continuation, runId, from, subjectOverride, onStep, signal }) => {
    if (signal?.aborted) throw new Error('Run aborted');
    const enable3d = env.DEMO_3D_ENABLED === 'true';
    if (enable3d && (env.CHRONOS_3D_CAPABILITY_CONFIRMED !== 'true' || !(env.CHRONOS_API_BASE || env.CHRONOS_3D_ENDPOINT) || !env.CHRONOS_API_TOKEN)) throw new Error('Confirmed Chronos TRELLIS configuration is required');
    const spendCapUsd = configuredSpendCap({ env, outputRoot });
    const resolvedDailyCap = dailyCapUsd ?? configuredDailyCap({ env, spendCapUsd });
    const ledger = fileLedger(resolveLedgerPath({ env, outputRoot }), { requireExisting: true });
    const client = createMetaClient({ env, ledger, spendCapUsd, dailyCapUsd: resolvedDailyCap });
    const initialDispatchCount = client.dispatchCount();
    let chronos3d;
    if (enable3d) {
      const origins = (env.CHRONOS_3D_ARTIFACT_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean);
      chronos3d = createChronos3dClient({ baseUrl: env.CHRONOS_API_BASE || env.CHRONOS_3D_ENDPOINT, token: env.CHRONOS_API_TOKEN, providerId: env.CHRONOS_3D_PROVIDER || 'trellis', jobLedger: ledger, capabilityConfirmed: true, maxJobs: Number(env.CHRONOS_3D_MAX_JOBS ?? 6), allowedArtifactOrigins: origins });
    }
    const model = env.META_TEXT_MODEL_PLANNER || 'muse-wonder-1.0';
    const promptPolicyModel = env.META_TEXT_MODEL_POLICY_PROMPT || 'muse-spark-1.3';
    const branchPolicyModel = env.META_TEXT_MODEL_POLICY_BRANCHES || 'muse-spark-1.3';
    const categories = categoriesFromEnv(env);
    const apiCalls = [];
    const agentClient = { ...client, async respond(args) {
      const start = performance.now();
      try {
        const result = await client.respond({ ...args, ...(args.label === 'branch-agent:review' ? { reasoning: { effort: 'low' } } : {}) });
        apiCalls.push({ step: args.label ?? 'responses', model: args.model, ms: Math.round(performance.now() - start), costUsd: result.costUsd });
        return result;
      } catch (error) {
        apiCalls.push({ step: args.label ?? 'responses', model: args.model, ms: Math.round(performance.now() - start), costUsd: 0, error: error.message });
        throw error;
      }
    } };
    const policy = createTopicPolicy({ categories,
      classifyPrompt: createModelClassifier(agentClient, { model: promptPolicyModel, categories }),
      classifyBranches: createModelClassifier(agentClient, { model: branchPolicyModel, categories }),
    });
    const agent = createBranchAgent({ client: agentClient, policy, model });
    let result;
    try {
      result = await runHarness({ divergence, continuation, ...(runId ? { timestamp: runId } : {}), from, subjectOverride, client, agent, image: createMetaImage({ client, env }), sam: createSamMask({ client, env }), policy, apiCalls, onStep, chronos3d, no3d: !enable3d, signal, outputRoot });
    } catch (error) { throw markUndispatchedBudgetError(error, client, initialDispatchCount); }
    return { runId: String(result.directory.split(/[\\/]/).at(-1)), directory: result.directory, branch: result.branch, trace: result.trace, costUsd: result.costUsd };
  };
  runner.enforcesDailyCap = true;
  return runner;
}
