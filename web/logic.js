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
