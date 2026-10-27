export function retryPrompt(reframe = '') {
  const quoted = String(reframe).match(/[“"](What if[^”"]+)[”"]/i);
  return quoted?.[1] ?? '';
}
export function formatYear(year) { return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`; }
export function provenance(trace = []) {
  const groups = [
    ['Policy', 'Muse Wonder', s => /policy/.test(s.step)],
    ['Branches', 'Muse Wonder', s => /propose/.test(s.step)],
    ['Review', 'Muse Wonder', s => /review/.test(s.step)],
    ['Image', 'Muse Image', s => s.step === 'image'],
    ['Cutout', 'SAM 3.1', s => /segment|cutout/.test(s.step)],
    ['3D', 'Tattva TRELLIS (existing infrastructure)', s => /3d|chronos/i.test(s.step)],
  ];
  return groups.map(([label, model, matches]) => {
    const items = trace.filter(s => !s.summary && matches(s));
    return { label, model, ms: items.reduce((n,s) => n + (Number(s.ms) || 0), 0), costUsd: items.reduce((n,s) => n + (Number(s.costUsd) || 0), 0), available: items.length > 0 };
  });
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
  return 'Story complete';
}

export function cachedRetryRun(runs, suggestion) {
  if (typeof suggestion !== 'string' || !suggestion) return null;
  return runs.find(run => run.divergence === suggestion && !['blocked', 'simulated'].includes(run.status)) ?? null;
}
export function replayLabel(run) {
  const title = run.divergence || run.title || run.id;
  if (run.status === 'simulated') return `${title} · Simulated guardrail`;
  if (run.status === 'provisional') return `${title} · 2D preview`;
  return title;
}
