// Branch agent: turns one "what if" into a small set of plausible, on-policy
// timeline branches and picks a hero scene to render. Multi-step, Muse Wonder:
//
//   1. policy   check the divergence prompt              (keyword + Wonder)
//   2. propose  N+2 candidate branches as structured JSON (Wonder)
//   3. policy   drop any branch that drifted into war/politics      } run in
//   4. review   score plausibility & causal consistency, rank, pick the hero,
//               write the image prompt and the subject to cut out   } parallel
//
// Every step is recorded in `trace` (model, tokens, cost, ms) so the UI can show
// which Meta model did what (provenance badges) and so judges can see the agent work.

import { extractJson } from '../lib/json.js';

const PROPOSE_INSTRUCTIONS = `You design alternate-history timelines for an exploration app.
Given a point of divergence, propose distinct, plausible branches that follow from it.
Stay strictly within science, technology, culture, geography, nature, medicine, art and exploration.
Never involve war, armies, weapons used against people, politics, elections, politicians or ideologies.
Each branch is anchored to one real place on Earth and one year, so it can be shown on a globe.
Reply with ONLY a JSON array, no prose. Each item:
{"id":"b1","title":"<6 words max>","year":<integer, negative for BCE>,"place":{"name":"<city or region>","lat":<number>,"lon":<number>},
 "summary":"<2 sentences: what changed and why it follows from the divergence>",
 "scene":"<1 sentence describing one striking, concrete visual moment in that world>"}`;

const REVIEW_INSTRUCTIONS = `You review alternate-history branches for plausibility and causal consistency with their divergence.
Score each branch 0-10 (10 = follows tightly and believably from the divergence, internally consistent, visually compelling).
Pick the single best branch as the hero to render as an image and then a 3D object.
For the hero, write an image prompt for a photorealistic scene with ONE clear central subject (an object, building, vehicle
or machine that can be cut out and turned into a 3D model). Name that subject using a common, concrete visible object noun
that a segmentation model can recognize (for example, "book" rather than "anatomical atlas on a lectern").
Reply with ONLY a JSON object, no prose:
{"scores":[{"id":"b1","score":<0-10>,"note":"<under 15 words>"}],
 "hero":{"id":"<branch id>","imagePrompt":"<one paragraph>","subject":"<few words, e.g. 'brass steam orrery'>"}}`;

function now() { return Number(process.hrtime.bigint() / 1000000n); }

function validBranch(b) {
  return b && typeof b.id === 'string' && typeof b.title === 'string' && Number.isFinite(b.year)
    && b.place && typeof b.place.name === 'string' && Number.isFinite(b.place.lat) && Number.isFinite(b.place.lon)
    && b.place.lat >= -90 && b.place.lat <= 90 && b.place.lon >= -180 && b.place.lon <= 180
    && typeof b.summary === 'string';
}

/**
 * @param {object} deps
 * @param {object} deps.client   shared metered Meta client
 * @param {object} deps.policy   from createTopicPolicy()
 * @param {string} [deps.model]  planner model (Muse Wonder)
 */
export function createBranchAgent({ client, policy, model = 'muse-wonder-1.0' }) {
  async function step(trace, name, args) {
    const t0 = now();
    // one retry when the model's JSON doesn't parse
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await client.respond({ model, label: `branch-agent:${name}`, ...args });
      const json = extractJson(r.text);
      trace.push({ step: name, model, attempt, ms: now() - t0, costUsd: r.costUsd, outputTokens: r.usage?.output_tokens, ok: json !== undefined });
      if (json !== undefined) return json;
    }
    throw new Error(`branch agent: ${name} step returned no parseable JSON after 2 attempts`);
  }

  /**
   * @param {{ divergence: string, count?: number }} input
   * @returns {Promise<{ status:'ok'|'blocked'|'empty', divergence, branches, rejected, hero, reframe?, trace, costUsd }>}
   */
  async function run({ divergence, count = 3 }) {
    const trace = [];
    const startSpent = client.spent();
    const done = extra => ({ divergence, branches: [], rejected: [], hero: null, ...extra, trace, costUsd: client.spent() - startSpent });

    // 1. policy on the prompt
    const t0 = now();
    const gate = await policy.checkPrompt(divergence);
    trace.push({ step: 'policy:prompt', model: gate.layer === 'model' ? model : 'keyword', ms: now() - t0, allowed: gate.allowed });
    if (!gate.allowed) return done({ status: 'blocked', reframe: gate.reframe, reason: gate.reason ?? gate.matched, category: gate.category });

    // 2. propose (over-generate so policy + review have room to drop some)
    const proposed = await step(trace, 'propose', {
      instructions: PROPOSE_INSTRUCTIONS,
      input: `Point of divergence: ${divergence}\nPropose ${count + 2} branches.`,
      maxOutputTokens: 6000,
    });
    const candidates = (Array.isArray(proposed) ? proposed : proposed?.branches ?? []).filter(validBranch);

    // 3 + 4 in parallel: the per-branch policy check and the review are independent,
    // so run them together and drop rejected branches from the ranking afterwards.
    // (Saves the policy step's wall time, ~8s on the 2026-10-27 live run.)
    if (!candidates.length) return done({ status: 'empty', rejected: [] });
    const t1 = now();
    const policyRun = policy.checkBranches(candidates).then(r => {
      trace.push({ step: 'policy:branches', model, ms: now() - t1, kept: r.kept.length, rejected: r.rejected.length });
      return r;
    });
    const reviewRun = step(trace, 'review', {
      instructions: REVIEW_INSTRUCTIONS,
      input: `Point of divergence: ${divergence}\nBranches:\n${JSON.stringify(candidates, null, 1)}`,
      maxOutputTokens: 5000,
    });
    // Both calls are already in flight; settle them before reporting cost or errors.
    const [policyResult, reviewResult] = await Promise.allSettled([policyRun, reviewRun]);
    // A failed Promise.all inside policy can leave other classifier calls in flight.
    await client.waitForIdle?.();
    if (policyResult.status === 'rejected') throw policyResult.reason;
    const { kept, rejected } = policyResult.value;
    if (!kept.length) return done({ status: 'empty', rejected });
    if (reviewResult.status === 'rejected') throw reviewResult.reason;
    const review = reviewResult.value;
    const scoreOf = new Map((review?.scores ?? []).map(s => [s.id, s]));
    const ranked = kept
      .map(b => ({ ...b, score: Number(scoreOf.get(b.id)?.score ?? 0), reviewNote: scoreOf.get(b.id)?.note ?? '' }))
      .sort((a, b) => b.score - a.score)
      .slice(0, count);
    const heroId = ranked.some(b => b.id === review?.hero?.id) ? review.hero.id : ranked[0].id;
    const heroBranch = ranked.find(b => b.id === heroId);
    const hero = {
      branchId: heroId,
      imagePrompt: review?.hero?.id === heroId && review.hero.imagePrompt ? review.hero.imagePrompt : heroBranch.scene ?? heroBranch.summary,
      subject: review?.hero?.id === heroId ? review.hero.subject ?? null : null,
    };

    return done({ status: 'ok', branches: ranked, rejected, hero });
  }

  return { run };
}
