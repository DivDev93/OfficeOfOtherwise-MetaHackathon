export function retryPrompt(reframe = '') {
  const quoted = String(reframe).match(/[“"](What if[^”"]+)[”"]/i);
  return quoted?.[1] ?? '';
}
export function formatYear(year) { return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`; }
export function provenance(trace = []) {
  const groups = [
    ['Policy', 'Muse Spark 1.3', s => /policy/.test(s.step)],
    ['Branches', 'Muse Wonder', s => /propose/.test(s.step)],
    ['Review', 'Muse Wonder', s => /review/.test(s.step)],
    ['Image', 'Muse Image', s => s.step === 'image'],
    ['Cutout', 'SAM 3.1', s => /segment|cutout/.test(s.step)],
    ['3D', 'Meta SAM 3D Objects', s => /3d|chronos/i.test(s.step)],
  ];
  return groups.map(([label, model, matches]) => {
    const items = trace.filter(s => !s.summary && matches(s));
    const sum = key => items.length && items.every(s => typeof s[key] === 'number' && Number.isFinite(s[key])) ? items.reduce((n, s) => n + s[key], 0) : null;
    if (label === '3D' && items.some(s => s.source === 'gen3d-offline')) {
      const providers = new Set(items.map(s => s.provider ?? 'trellis'));
      if (providers.size === 1 && providers.has('sam3dobjects')) model = 'Meta SAM 3D Objects (via Tattva Cloud Run)';
      else if (providers.size === 1 && providers.has('trellis')) model = 'Tattva TRELLIS (existing infrastructure, pre-generated)';
      else if (providers.size === 1 && providers.has('triposplat')) model = 'TripoSplat';
    }
    if (label === '3D' && items.some(s => s.provider === 'sam3dobjects' || /Meta SAM 3D Objects/i.test(s.model ?? ''))) model = 'Meta SAM 3D Objects (via Tattva Cloud Run)';
    if (label === '3D' && items.some(s => s.step === 'chronos')) model = 'Tattva TRELLIS (existing infrastructure)';
    if (label === 'Policy') {
      const models = [...new Set(items.map(s => s.model).filter(m => typeof m === 'string' && m))];
      model = models.length ? models.map(policyModelLabel).join(' + ') : 'Muse Spark 1.3';
    }
    return { label, model, ms: sum('ms'), costUsd: sum('costUsd'), available: items.length > 0 };
  });
}

// Saved calls determine which cards exist, even before their replay beat arrives.
export function modelCardSteps(trace = [], savedTrace = trace) {
  const roles = ['Policy checks', 'Branches / review', 'Branches / review', 'Scene', 'Cutout', '3D'];
  const groupCalls = records => {
    const cards = new Map();
    replayTraceGroups(records).forEach((calls, index) => {
      for (const call of calls) {
        const model = modelCardLabel(index === 5 ? provenance([call])[5].model : call.model || provenance([call])[index].model);
        if (!cards.has(model)) cards.set(model, { roles: new Set(), calls: [] });
        const card = cards.get(model);
        card.roles.add(roles[index]);
        card.calls.push(call);
      }
    });
    return cards;
  };
  const current = groupCalls(trace);
  return [...groupCalls(savedTrace)].map(([model, recorded]) => {
    const calls = current.get(model)?.calls || [];
    const sum = key => calls.length && calls.every(call => Number.isFinite(call[key]))
      ? calls.reduce((total, call) => total + call[key], 0) : null;
    return { model, role: [...recorded.roles].join(' + '), ms: sum('ms'), costUsd: sum('costUsd'),
      available: calls.length > 0, pending: calls.length < recorded.calls.length };
  });
}

function modelCardLabel(model) {
  const labels = {
    'muse-wonder-1.0': 'Muse Wonder 1.0', 'Muse Wonder': 'Muse Wonder 1.0',
    'muse-spark-1.3': 'Muse Spark 1.3', 'Muse Spark': 'Muse Spark 1.3',
    'muse-image-1.0': 'Muse Image 1.0', 'Muse Image': 'Muse Image 1.0',
    'sam-3.1': 'SAM 3.1',
  };
  return labels[model] || model;
}

export function replayTraceGroups(trace = []) {
  const steps = trace.filter(step => !step.summary);
  return [
    steps.filter(step => /policy/i.test(step.step || '')),
    steps.filter(step => /propose/i.test(step.step || '')),
    steps.filter(step => /review/i.test(step.step || '')),
    steps.filter(step => step.step === 'image'),
    steps.filter(step => /segment|cutout/i.test(step.step || '')),
    steps.filter(step => /3d|chronos/i.test(step.step || '')),
  ];
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
}

export function modelLoadProgress(event = {}) {
  if (!Number.isFinite(event.loaded) || event.loaded < 0) return { value: null, label: 'Preparing 3D model…' };
  const loaded = event.loaded;
  if (Number.isFinite(event.total) && event.total > 0) {
    const value = Math.max(0, Math.min(100, Math.round((loaded / event.total) * 100)));
    return { value, label: `${value}% · ${formatBytes(loaded)} / ${formatBytes(event.total)}` };
  }
  return { value: null, label: `${formatBytes(loaded)} downloaded` };
}
function policyModelLabel(model) {
  if (model === 'muse-spark-1.3') return 'Muse Spark 1.3';
  if (model === 'muse-wonder-1.0') return 'Muse Wonder 1.0';
  return model;
}
export function parseSseBlock(block) {
  let event = 'message'; const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  return { event, data: JSON.parse(data.join('\n')) };
}

export function availableView(requested, { image = false, cutout = false, model = false } = {}) {
  if (requested === 'model' && model) return 'model';
  if (requested === 'cutout' && cutout) return 'cutout';
  return image ? 'scene' : model ? 'model' : 'scene';
}
export function completionStatus(branch = {}) {
  if (branch.status === 'blocked') return 'This question needs a reframe';
  if (branch.status === 'empty') return 'No suitable branches found';
  if (branch.renderStatus === '2d-only') return '2D scene only · no SAM cutout available';
  return 'Story complete';
}

// The propose SSE payload contains candidates that have passed branch policy,
// but review has not ranked them yet. Keep that distinction visible in the UI.
export function branchProgress(state = { branches: [], heroId: null, phase: 'idle' }, event, data = {}) {
  if (!['propose', 'review', 'complete'].includes(event)) return state;
  if (event === 'propose' && data.pending === true) {
    const suppliedCount = data.candidateCount;
    const candidateCount = Number.isInteger(suppliedCount) && suppliedCount > 0 ? suppliedCount : 0;
    return { branches: [], heroId: null, phase: 'policy-checking', candidateCount };
  }
  const result = event === 'complete' ? (data.branch || data) : data;
  if (result.status === 'blocked' || result.allowed === false) return { branches: [], heroId: null, phase: 'blocked' };
  if (!Array.isArray(result.branches)) return state;
  if (event === 'propose' && data.pending === false && result.branches.length === 0) return { branches: [], heroId: null, phase: 'empty' };
  if (event === 'complete' && result.status === 'empty') return { branches: [], heroId: null, phase: 'empty' };
  const hero = result.hero?.branchId || result.hero?.id || null;
  return {
    branches: result.branches,
    // A reviewer selection is only authoritative after review has completed.
    heroId: event === 'propose' ? null : hero,
    phase: event === 'propose' ? 'provisional' : event === 'review' ? 'reviewed' : 'final',
  };
}

export function branchPhaseLabel(phase) {
  if (phase === 'policy-checking') return 'CHECKING TOPIC POLICY';
  if (phase === 'provisional') return 'POLICY-CLEARED · REVIEW IN PROGRESS';
  if (phase === 'reviewed') return 'HERO SELECTED · ASSETS GENERATING';
  if (phase === 'final') return 'HERO BRANCH';
  if (phase === 'blocked') return 'OUTSIDE EXPLORATION SCOPE';
  if (phase === 'empty') return 'NO SUITABLE PATHS';
  return 'AWAITING A STORY';
}

export function cachedRetryRun(runs, suggestion) {
  if (typeof suggestion !== 'string' || !suggestion) return null;
  return runs.find(run => run.divergence === suggestion && !['blocked', 'simulated'].includes(run.status)) ?? null;
}
export function suggestionAction(mode, runs, prompt) {
  if (mode !== 'replay-only') return { action: 'fill-input', run: null };
  const run = cachedRetryRun(runs, prompt);
  return run ? { action: 'open-saved-run', run } : { action: 'no-saved-match', run: null };
}
export function sourceVerificationLabel(method) {
  return ({ full_text: 'Full text reviewed', abstract: 'Abstract reviewed', search_excerpt: 'Search excerpt only' })[method]
    || 'Access method not recorded';
}
export function lessonMarkdown({ run, branch, evidenceBranch, comparisonBranch = null, sources = [], method = null, score = null } = {}) {
  if (!run || !branch || !evidenceBranch) return '';
  const byId = new Map(sources.map(source => [source.id, source]));
  const baseline = (evidenceBranch.baselineSourceIds || []).map(id => byId.get(id)).filter(Boolean);
  const lines = [
    `# Scenario brief: ${evidenceBranch.title || branch.title}`,
    '',
    `**Question:** ${run.divergence || 'Not recorded'}`,
    '',
    'Historical starting points are source-linked. The changed assumption and alternate timeline are imagined.',
    '',
    '## Historical starting points',
    ...(baseline.length ? baseline.flatMap(source => [
      `- ${source.baselineParaphrase || 'No baseline summary recorded.'}`,
      `  Source: ${source.title || source.id}${source.publisher ? ` · ${source.publisher}` : ''}${source.checkedDate ? ` · checked ${source.checkedDate}` : ''} · ${sourceVerificationLabel(source.verificationMethod)}${source.url ? ` · ${source.url}` : ''}`,
    ]) : ['- No baseline sources are linked to this branch.']),
    '',
    '## Changed assumption',
    evidenceBranch.changedAssumption || 'No changed assumption recorded.',
    '',
    '## Imagined sequence',
    ...(evidenceBranch.causalSteps || []).map((step, index) => `${index + 1}. ${step}`),
    ...(evidenceBranch.causalSteps?.length ? [] : ['No causal steps recorded.']),
    '',
    '## Uncertainty',
    evidenceBranch.uncertainty || 'No uncertainty note recorded.',
    '',
    '## Unverified claims',
    ...(evidenceBranch.unverifiedClaims?.length ? evidenceBranch.unverifiedClaims.map(claim => `- ${claim}`) : ['- No explicit unverified-claims list was recorded.']),
    '',
    '## What the visualization shows',
    evidenceBranch.demonstrates || 'The selected imagined path.',
    '',
    '## What it does not establish',
    evidenceBranch.doesNotEstablish || 'That the imagined events occurred.',
    '',
    '## Research prompt',
    evidenceBranch.discussionQuestion || 'Which assumption most changes the outcome, and what evidence could help test it?',
    '',
    ...(comparisonBranch ? [
      `## Compare with: ${comparisonBranch.title || 'another path'}`,
      'Both outcomes are imagined paths from the same starting question.',
      '### Historical starting points linked to this path',
      ...((comparisonBranch.baselineSourceIds || []).map(id => byId.get(id)).filter(Boolean).length
        ? (comparisonBranch.baselineSourceIds || []).map(id => byId.get(id)).filter(Boolean).flatMap(source => [`- ${source.baselineParaphrase || 'No baseline summary recorded.'}`, `  Source: ${source.title || source.id}${source.publisher ? ` · ${source.publisher}` : ''}${source.checkedDate ? ` · checked ${source.checkedDate}` : ''} · ${sourceVerificationLabel(source.verificationMethod)}${source.url ? ` · ${source.url}` : ''}`])
        : ['- No baseline sources are linked to this path.']),
      `Changed assumption: ${comparisonBranch.changedAssumption || 'Not recorded.'}`,
      ...(comparisonBranch.causalSteps || []).map((step, index) => `${index + 1}. ${step}`),
      `Uncertainty: ${comparisonBranch.uncertainty || 'Not recorded.'}`,
      ...(comparisonBranch.unverifiedClaims?.length ? ['Unverified claims:', ...comparisonBranch.unverifiedClaims.map(claim => `- ${claim}`)] : []),
      '',
    ] : []),
    ...(Number.isFinite(score) ? ['## Model review signal', `Score: ${score}/10. This ranks the generated branches; it is not a probability that this path would happen.`, ''] : []),
    ...(method?.label ? ['## Source and scenario method', `${method.label}${method.scope ? ` · ${method.scope}` : ''}${method.role ? ` · ${method.role}` : ''}${method.reviewedAgainst ? ` · reviewed against ${method.reviewedAgainst}` : ''}`, ...(method.scoreDisclaimer ? [method.scoreDisclaimer] : []), ''] : []),
    '## Scenario development prompts',
    '- What additional source would sharpen the historical starting point?',
    '- Which causal step depends most on an assumption?',
    '- What alternate divergence could produce a different path?',
    '',
  ];
  return lines.join('\n');
}
export function replayLabel(run) {
  const shortTitles = {
    alexandria: 'Alexandria · Library survives',
    beringia: 'Beringia · land bridge stays',
    'green-sahara': 'Green Sahara · stays green',
    guardrail: 'Simulated guardrail',
    mechanisms: 'Mechanisms · Antikythera scales',
  };
  const title = shortTitles[run.id] || run.divergence || run.title || run.id;
  if (run.status === 'simulated') return title.includes('Simulated guardrail') ? title : `${title} · Simulated guardrail`;
  if (run.status === 'provisional') return `${title} · 2D preview`;
  return title;
}

export function liveAccessMode(health) {
  if (!health || health.status !== 'ok' || typeof health.replayOnly !== 'boolean') return 'unknown';
  return health.replayOnly ? 'replay-only' : 'live-enabled';
}
