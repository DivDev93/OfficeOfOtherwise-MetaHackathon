// Live run of the branch agent: `npm run branch -- "What if ...?"`
// Uses Muse Wonder for every step. Typically a few cents. Writes out/branch-<ts>.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createMetaClient } from '../src/lib/metaClient.js';
import { fileLedger } from '../src/lib/spendLedger.js';
import { configuredSpendCap, configuredDailyCap } from '../src/demo/budget.js';
import { createTopicPolicy, createModelClassifier, categoriesFromEnv } from '../src/guardrails/topicPolicy.js';
import { createBranchAgent } from '../src/agents/branchAgent.js';

const divergence = process.argv.slice(2).join(' ') || 'What if the Library of Alexandria never burned?';
const model = process.env.META_TEXT_MODEL_PLANNER || 'muse-wonder-1.0';
const spendCapUsd = configuredSpendCap({});
const dailyCapUsd = configuredDailyCap({ spendCapUsd });
const client = createMetaClient({ ledger: fileLedger('out/spend.json', { requireExisting: true }), spendCapUsd, dailyCapUsd });
const policy = createTopicPolicy({ categories: categoriesFromEnv(), classify: createModelClassifier(client, { model, categories: categoriesFromEnv() }) });
const agent = createBranchAgent({ client, policy, model });

console.log(`divergence: ${divergence}\n`);
const out = await agent.run({ divergence, count: 3 });
mkdirSync('out', { recursive: true });
const file = `out/branch-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(out, null, 2));

console.log(`status: ${out.status}`);
if (out.status === 'blocked') console.log(`reframe: ${out.reframe}`);
for (const b of out.branches) console.log(`\n[${b.score}] ${b.title} (${b.place.name}, ${b.year})${b.id === out.hero?.branchId ? '  <- HERO' : ''}\n    ${b.summary}\n    review: ${b.reviewNote}`);
for (const r of out.rejected) console.log(`\nrejected: ${r.branch.title} (${r.layer}, ${r.category})`);
if (out.hero) console.log(`\nhero subject: ${out.hero.subject}\nimage prompt: ${out.hero.imagePrompt}`);
console.log('\ntrace:');
for (const t of out.trace) console.log(`  ${t.step.padEnd(16)} ${String(t.model).padEnd(16)} ${String(t.ms).padStart(6)}ms${t.costUsd != null ? `  $${t.costUsd.toFixed(5)}  ${t.outputTokens} out` : ''}${t.ok === false ? '  (unparseable, retried)' : ''}`);
console.log(`\nrun cost: $${out.costUsd.toFixed(5)} | total spent: $${client.spent().toFixed(4)} of $${client.spendCapUsd}\nsaved: ${file}`);
