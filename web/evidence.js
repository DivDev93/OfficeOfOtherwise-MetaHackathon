function safeHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function completeUnits(source) {
  if (source?.excerptFormat !== 'complete-source-units-v1' || typeof source.excerpt !== 'string' || source.excerpt.length > 1600) return [];
  const units = source.excerpt.split('\n\n');
  return units.every(unit => unit && unit === unit.trim() && !/[\r\n]/.test(unit)) ? units : [];
}

function safeClaim(claim, sourcesById, citations, baselineSourceIds) {
  if (!claim || typeof claim.text !== 'string' || !Array.isArray(claim.sourceIds) || claim.sourceIds.length !== 1) return false;
  const id = claim.sourceIds[0];
  return citations.has(id) && baselineSourceIds.has(id) && completeUnits(sourcesById.get(id)).includes(claim.text);
}

function block(document, host, title, values, tag = 'p') {
  if (!values?.length) return;
  const section = document.createElement('section');
  section.className = 'evidence-block';
  const heading = document.createElement('h4');
  heading.textContent = title;
  section.append(heading);
  if (tag === 'ul' || tag === 'ol') {
    const list = document.createElement(tag);
    for (const value of values) {
      const item = document.createElement('li');
      item.textContent = value;
      list.append(item);
    }
    section.append(list);
  } else {
    const copy = document.createElement(tag);
    copy.textContent = values[0];
    section.append(copy);
  }
  host.append(section);
}

/** Render a validated curated envelope or a fresh artifact into the Atlas details panel. */
export function renderEvidencePanel(host, input, branchId) {
  const document = host.ownerDocument;
  host.replaceChildren();
  let envelope = input;
  if (input?.evidence && Array.isArray(input.branches)) {
    const raw = input.evidence;
    const branchRecords = input.branches.map(branch => ({
      branchId: branch.id,
      title: branch.title,
      baselineSourceIds: [...new Set((branch.baselineClaims || []).flatMap(claim => Array.isArray(claim?.sourceIds) ? claim.sourceIds : []))],
      baselineClaims: branch.baselineClaims || [],
      changedAssumption: branch.changedAssumption,
      causalSteps: branch.causalSteps,
      uncertainty: branch.uncertainty,
      citations: branch.citations,
      unverifiedClaims: branch.unverifiedClaims,
      demonstrates: branch.demonstrates,
      doesNotEstablish: branch.doesNotEstablish,
      discussionQuestion: branch.discussionQuestion,
    }));
    envelope = { status: raw.status, topicId: raw.topicId, authoredAt: raw.retrievedAt?.slice?.(0, 10), retrievedAt: raw.retrievedAt,
      method: raw.method, sources: raw.sources, run: { runId: input.runId, divergence: input.divergence, branches: branchRecords } };
  }
  const record = envelope?.run?.branches?.find(branch => branch.branchId === branchId);
  if (!record) {
    const message = document.createElement('p');
    message.className = 'evidence-empty';
    message.textContent = envelope?.status === 'unavailable'
      ? 'Fresh evidence retrieval is unavailable for this question. No source-backed claims are shown; this path remains hypothetical.'
      : 'No validated evidence brief is available for this saved path.';
    host.append(message);
    return false;
  }
  const sources = Array.isArray(envelope.sources) ? envelope.sources : [];
  const sourcesById = new Map(sources.filter(source => typeof source?.id === 'string').map(source => [source.id, source]));
  const fresh = envelope.status === 'retrieved';
  const sourceIds = Array.isArray(record.baselineSourceIds) ? record.baselineSourceIds : [];
  const citedIds = new Set(Array.isArray(record.citations) ? record.citations : []);
  const intro = document.createElement('p');
  intro.className = 'evidence-note';
  intro.textContent = fresh
    ? `Retrieved public sources${envelope.topicId ? ` for ${envelope.topicId}` : ''}. Retrieval and quotation are not independent verification; the alternate sequence is hypothetical.`
    : 'Source-linked historical context for an imagined path. The cited sources do not establish the alternate events.';
  host.append(intro);

  const baseline = document.createElement('section');
  baseline.className = 'evidence-block';
  const baselineTitle = document.createElement('h4'); baselineTitle.textContent = 'Starting evidence'; baseline.append(baselineTitle);
  const claims = Array.isArray(record.baselineClaims) ? record.baselineClaims : [];
  if (fresh && claims.length) {
    const list = document.createElement('ul');
    for (const claim of claims) {
      const item = document.createElement('li');
      if (safeClaim(claim, sourcesById, citedIds, new Set(sourceIds))) {
        const quote = document.createElement('blockquote'); quote.textContent = claim.text; item.append(quote);
        const source = sourcesById.get(claim.sourceIds[0]);
        const link = document.createElement('a');
        link.textContent = `${source.title || source.id}${source.publisher ? ` · ${source.publisher}` : ''}${source.checkedDate ? ` · checked ${source.checkedDate}` : ''}`;
        const href = safeHttps(source.url); if (href) { link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        item.append(link);
      } else {
        item.textContent = `${claim?.text || 'Unmatched baseline claim'} · unverified`;
      }
      list.append(item);
    }
    baseline.append(list);
  } else if (!fresh && sourceIds.length) {
    const list = document.createElement('ul');
    for (const id of sourceIds) {
      const source = sourcesById.get(id);
      if (!source) continue;
      const item = document.createElement('li');
      const summary = document.createElement('span'); summary.textContent = source.baselineParaphrase || 'Source recorded without a baseline summary.'; item.append(summary);
      const link = document.createElement('a');
      link.textContent = ` ${source.title || source.id}${source.publisher ? ` · ${source.publisher}` : ''}${source.checkedDate ? ` · checked ${source.checkedDate}` : ''}`;
      const href = safeHttps(source.url); if (href) { link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      item.append(link); list.append(item);
    }
    baseline.append(list);
  } else {
    const note = document.createElement('p'); note.textContent = 'No baseline source is linked to this path.'; baseline.append(note);
  }
  host.append(baseline);
  block(document, host, 'Changed assumption', [record.changedAssumption]);
  block(document, host, 'How the path unfolds', record.causalSteps, 'ol');
  block(document, host, 'Where uncertainty remains', [record.uncertainty]);
  block(document, host, 'Unverified claims', record.unverifiedClaims, 'ul');
  block(document, host, 'What the visualization shows', [record.demonstrates]);
  block(document, host, 'What it does not establish', [record.doesNotEstablish]);
  block(document, host, 'Research prompt', [record.discussionQuestion]);
  const method = envelope.method;
  if (method && [method.label, method.scope, method.scoreDisclaimer].some(value => typeof value === 'string' && value.trim())) {
    block(document, host, 'Retrieval method', [[method.label, method.scope, method.scoreDisclaimer].filter(Boolean).join(' ') ]);
  }
  if (Array.isArray(record.citations) && record.citations.some(id => !sourcesById.has(id))) {
    const note = document.createElement('p'); note.className = 'evidence-empty'; note.textContent = 'One or more citation links are missing from the validated source set.'; host.append(note);
  }
  return true;
}
