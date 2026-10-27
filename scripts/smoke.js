// One cheap live check of the real Meta API: `npm run smoke`
//  1. a tiny Muse Wonder call, to confirm the Responses format, usage fields and cost
//  2. the model layer of the topic policy on two prompts
// Spends a few tenths of a cent. Everything is metered through the shared client and ledger.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createMetaClient } from '../src/lib/metaClient.js';
import { fileLedger } from '../src/lib/spendLedger.js';
import { createTopicPolicy, createModelClassifier, categoriesFromEnv } from '../src/guardrails/topicPolicy.js';

const model = process.env.META_TEXT_MODEL_PLANNER || 'muse-wonder-1.0';
const client = createMetaClient({ ledger: fileLedger() });

console.log(`model: ${model}`);
const r = await client.respond({ model, input: 'Reply with exactly: ok', maxOutputTokens: 400, label: 'smoke' });
mkdirSync('out', { recursive: true });
writeFileSync('out/smoke-wonder.json', JSON.stringify(r.response, null, 2));
console.log('text:', JSON.stringify(r.text));
console.log('response keys:', Object.keys(r.response).join(', '));
console.log('output item types:', (r.response.output ?? []).map(o => o.type).join(', '));
console.log('usage:', JSON.stringify(r.usage));
console.log(`cost: $${r.costUsd.toFixed(6)} (priced at the Muse Spark rate, so Wonder's real price may differ)`);

let last;
const policy = createTopicPolicy({ categories: categoriesFromEnv(), classify: createModelClassifier(client, { model, categories: categoriesFromEnv(), onResponse: (resp, text) => { last = { resp, text }; } }) });
for (const prompt of [
  'What if the Library of Alexandria never burned?',   // expect allow
  'What if the empire had never stopped expanding east?', // subtle: expect block
]) {
  last = null;
  const v = await policy.checkPrompt(prompt);
  console.log(`\n"${prompt}"\n  -> ${v.allowed ? 'ALLOW' : 'BLOCK'} (${v.layer}${v.category ? `, ${v.category}` : ''}${v.reason ? `: ${v.reason}` : ''})`);
  if (last) {
    const u = last.resp.usage ?? {};
    console.log(`     status=${last.resp.status}${last.resp.incomplete_details ? ` incomplete=${JSON.stringify(last.resp.incomplete_details)}` : ''} output_tokens=${u.output_tokens} (reasoning ${u.output_tokens_details?.reasoning_tokens})`);
    console.log(`     raw text: ${JSON.stringify(last.text).slice(0, 200)}`);
  }
}
console.log(`\ntotal spent so far: $${client.spent().toFixed(6)} of $${client.spendCapUsd} cap`);
