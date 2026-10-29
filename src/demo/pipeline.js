import { join } from 'node:path';
import { createMetaClient } from '../lib/metaClient.js';
import { fileLedger } from '../lib/spendLedger.js';
import { createTopicPolicy, createModelClassifier, categoriesFromEnv } from '../guardrails/topicPolicy.js';
import { createBranchAgent } from '../agents/branchAgent.js';
import { createMetaImage } from '../providers/metaImage.js';
import { createSamMask } from '../providers/samMask.js';
import { createChronos3dClient } from '../providers/chronos3d.js';
import { runHarness } from '../../harness/run.js';
import { taskSpendCap } from './budget.js';

// The ignored budget checkpoint is initialized once for this task, before live calls.
export function createDemoRunner({ env = process.env, dailyCapUsd = 3, outputRoot = 'out', budgetCheckpointPath = join(outputRoot, 'demo-task-budget.json') } = {}) {
  const runner = async ({ divergence, from, subjectOverride, onStep, signal, timestamp }) => {
    if (signal?.aborted) throw new Error('Run aborted');
    const enable3d = env.DEMO_3D_ENABLED === 'true';
    if (enable3d && (env.CHRONOS_3D_CAPABILITY_CONFIRMED !== 'true' || !(env.CHRONOS_API_BASE || env.CHRONOS_3D_ENDPOINT) || !env.CHRONOS_API_TOKEN)) throw new Error('Confirmed Chronos TRELLIS configuration is required');
    const ledger = fileLedger(join(outputRoot, 'spend.json'), { requireExisting: true });
    const spendCapUsd = taskSpendCap({ env, outputRoot, checkpointPath: budgetCheckpointPath });
    const client = createMetaClient({ env, ledger, spendCapUsd, dailyCapUsd });
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
    const result = await runHarness({ divergence, from, subjectOverride, client, agent, image: createMetaImage({ client, env }), sam: createSamMask({ client, env }), policy, apiCalls, onStep, chronos3d, no3d: !enable3d, signal, timestamp, outputRoot });
    return { runId: String(result.directory.split(/[\\/]/).at(-1)), directory: result.directory, branch: result.branch, trace: result.trace, costUsd: result.costUsd };
  };
  runner.enforcesDailyCap = true;
  return runner;
}
