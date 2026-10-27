import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordCheck, parseVerdict, createTopicPolicy, createModelClassifier, categoriesFromEnv, classifierInstructions } from '../src/guardrails/topicPolicy.js';
import { SpendCapError } from '../src/lib/metaClient.js';

const ALLOWED = [
  'What if the Library of Alexandria never burned?',
  'What if the Bering land bridge never flooded?',
  'What if the Tunguska event had hit a city?',
  'What if Antikythera-style mechanisms had scaled into industry?',
  'What if the Sahara had stayed green?',
  'What if Warsaw had been a port on a warmer Baltic?', // "war" inside other words
  'What if software had been invented in 1700?',
  'What if nuclear power had been abandoned in the 1950s?', // civil nuclear is fine
];
const BLOCKED = [
  ['What if the Nazis had won World War II?', 'war'],
  ['What if Napoleon had won at Waterloo and the battle went the other way?', 'war'],
  ['What if the Cuban missile crisis had gone differently?', 'war'],
  ['What if an atomic bomb had been used in 1950?', 'war'],
  ['What if the 1960 election had gone the other way?', 'politics'],
  ['What if communism had never spread?', 'politics'],
  ['What if the president had been assassinated and a coup followed?', 'politics'],
];

test('keyword layer allows science / tech / culture / geography prompts', () => {
  for (const p of ALLOWED) assert.equal(keywordCheck(p).allowed, true, p);
});

test('keyword layer blocks war and political prompts with a reframe', () => {
  for (const [p, category] of BLOCKED) {
    const r = keywordCheck(p);
    assert.equal(r.allowed, false, p);
    assert.equal(r.category, category, p);
    assert.match(r.reframe, /science, technology, culture and geography/);
  }
});

test('model layer is not called when the keyword layer already blocks', async () => {
  let calls = 0;
  const policy = createTopicPolicy({ classify: async () => { calls++; return { verdict: 'allow', category: null, reason: '' }; } });
  const r = await policy.checkPrompt('What if the Nazis won?');
  assert.equal(r.allowed, false);
  assert.equal(r.layer, 'keyword');
  assert.equal(calls, 0);
});

test('model layer can block what the keywords miss', async () => {
  const policy = createTopicPolicy({ classify: async () => ({ verdict: 'block', category: 'war', reason: 'implies armed conflict' }) });
  const r = await policy.checkPrompt('What if the empire had kept expanding?');
  assert.equal(r.allowed, false);
  assert.equal(r.layer, 'model');
  assert.equal(r.category, 'war');
});

test('model layer allows clean prompts', async () => {
  const policy = createTopicPolicy({ classify: async () => ({ verdict: 'allow', category: null, reason: '' }) });
  assert.equal((await policy.checkPrompt('What if the Sahara had stayed green?')).allowed, true);
});

test('fails CLOSED when the classifier returns garbage', async () => {
  const policy = createTopicPolicy({ classify: async () => null });
  const r = await policy.checkPrompt('What if the Sahara had stayed green?');
  assert.equal(r.allowed, false);
  assert.equal(r.category, 'unverifiable');
});

test('SpendCapError from the classifier propagates (never silently allows)', async () => {
  const policy = createTopicPolicy({ classify: async () => { throw new SpendCapError(99, 2, 100); } });
  await assert.rejects(policy.checkPrompt('What if the Sahara had stayed green?'), SpendCapError);
});

test('keyword-only mode works without a classifier', async () => {
  const policy = createTopicPolicy();
  assert.equal((await policy.checkPrompt('What if the Sahara had stayed green?')).allowed, true);
  assert.equal((await policy.checkPrompt('What if the army never left?')).allowed, false);
});

test('checkBranches keeps clean branches and reports why others were rejected', async () => {
  const policy = createTopicPolicy({ classify: async t => (/crown/i.test(t) ? { verdict: 'block', category: 'politics', reason: 'succession struggle' } : { verdict: 'allow', category: null, reason: '' }) });
  const branches = [
    { title: 'Green Sahara trade routes', summary: 'Rivers persist and caravans become barge fleets.' },
    { title: 'Siege of the library', summary: 'Armies converge on the city.' },
    { title: 'Fight for the crown', summary: 'Rival houses contest the throne.' },
  ];
  const { kept, rejected } = await policy.checkBranches(branches);
  assert.deepEqual(kept.map(b => b.title), ['Green Sahara trade routes']);
  assert.deepEqual(rejected.map(r => [r.branch.title, r.layer]), [['Siege of the library', 'keyword'], ['Fight for the crown', 'model']]);
});

test('parseVerdict tolerates prose around the JSON and rejects junk', () => {
  assert.deepEqual(parseVerdict('Sure! {"verdict":"block","category":"war","reason":"army"} done'), { verdict: 'block', category: 'war', reason: 'army' });
  assert.equal(parseVerdict('no json here'), null);
  assert.equal(parseVerdict('{"verdict":"maybe"}'), null);
});

test('createModelClassifier sends the text as data to the planner model through the client', async () => {
  const seen = [];
  const client = { respond: async args => { seen.push(args); return { text: '{"verdict":"allow","category":null,"reason":"ok"}' }; } };
  const v = await createModelClassifier(client, { model: 'muse-wonder-1.0' })('What if the Sahara stayed green?');
  assert.equal(v.verdict, 'allow');
  assert.equal(seen[0].model, 'muse-wonder-1.0');
  assert.match(seen[0].input, /^<text>.*<\/text>$/s);
  assert.equal(seen[0].label, 'topic-policy');
});

test('categories are configurable per deployment', async () => {
  assert.deepEqual(categoriesFromEnv({}), ['war', 'politics']);
  assert.deepEqual(categoriesFromEnv({ TOPIC_POLICY_BLOCK: 'war' }), ['war']);
  assert.deepEqual(categoriesFromEnv({ TOPIC_POLICY_BLOCK: 'none' }), []);
  assert.throws(() => categoriesFromEnv({ TOPIC_POLICY_BLOCK: 'war,gore' }), /unknown categories: gore/);

  const warOnly = createTopicPolicy({ categories: ['war'] });
  assert.equal((await warOnly.checkPrompt('What if the 1960 election went the other way?')).allowed, true);
  assert.equal((await warOnly.checkPrompt('What if the battle went the other way?')).allowed, false);

  let calls = 0;
  const off = createTopicPolicy({ categories: [], classify: async () => { calls++; return null; } });
  const r = await off.checkPrompt('What if the Nazis won World War II?');
  assert.equal(r.allowed, true);
  assert.equal(r.layer, 'off');
  assert.equal(calls, 0);
});

test('classifier instructions only name the configured categories', () => {
  assert.match(classifierInstructions(['war']), /military conflict/);
  assert.doesNotMatch(classifierInstructions(['war']), /elections/);
});
