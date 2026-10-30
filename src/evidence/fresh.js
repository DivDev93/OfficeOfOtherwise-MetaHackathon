import { createHash } from 'node:crypto';
import { branchDigest } from './index.js';
import { keywordCheck } from '../guardrails/topicPolicy.js';

// Bounded retrieval for fresh runs. URLs are fixed by this registry; prompt text
// is never sent to a search engine or interpolated into a URL.
const TOPICS = [
  { id: 'alexandria-library', match: ['alexandria', 'ancient library', 'library of alexandria', 'egyptian library', 'great library'], sources: [
    { id: 'alex-library', url: 'https://penelope.uchicago.edu/~grout/encyclopaedia_romana/library.html', title: 'The Library of Alexandria', publisher: 'University of Chicago, Encyclopaedia Romana' },
    { id: 'alex-aristarchus', url: 'https://mathshistory.st-andrews.ac.uk/Biographies/Aristarchus/', title: 'Aristarchus of Samos', publisher: 'MacTutor History of Mathematics, University of St Andrews' },
  ] },
  { id: 'beringia-migration', match: ['beringia', 'bering land bridge', 'land bridge between siberia', 'alaska land bridge', 'peopling of the americas', 'ice age migration'], sources: [
    { id: 'ber-landbridge', url: 'https://www.nps.gov/subjects/beringia/about.htm', title: 'About Beringia', publisher: 'National Park Service' },
    { id: 'ber-migration', url: 'https://www.nps.gov/articles/aps-17-1-2.htm', title: 'A Survey of Human Migration in Alaska’s National Parks through Time', publisher: 'National Park Service' },
  ] },
  { id: 'sahara-climate', match: ['sahara', 'green sahara', 'african humid period', 'holocene humid period', 'north african green period', 'sahara stayed green', 'green desert'], sources: [
    { id: 'sahara-humid', url: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC4659928/fullTextXML', title: 'African humid periods and a Western Sahara river system', publisher: 'Nature Communications / Europe PMC' },
    { id: 'sahara-cereals', url: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC3797788/fullTextXML', title: 'Dynamics of Green Sahara Periods and Their Role in Hominin Evolution', publisher: 'Europe PMC' },
  ] },
  { id: 'ancient-mechanisms', match: ['antikythera', 'ancient mechanism', 'ancient automata', 'archimedes screw', 'ancient gears', 'greek gears', 'ancient clockwork'], sources: [
    { id: 'antikythera-review', url: 'https://isaw.nyu.edu/research/antikythera-mechanism', title: 'The Antikythera Mechanism', publisher: 'Institute for the Study of the Ancient World, New York University' },
    { id: 'archimedes-screw', url: 'https://math.nyu.edu/Archimedes/Screw/SourcesScrew.html', title: 'Archimedes’ Screw: Sources', publisher: 'New York University' },
  ] },
];

const APPROVED_HOSTS = new Set([
  'penelope.uchicago.edu', 'mathshistory.st-andrews.ac.uk', 'www.nps.gov', 'www.ebi.ac.uk',
  'isaw.nyu.edu', 'math.nyu.edu',
]);
const MAX_SOURCE_BYTES = 1_000_000;
const MAX_EXCERPT_CHARS = 1_600;
const EXCERPT_FORMAT = 'complete-source-units-v1';

function cleanHtml(html) {
  return html.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/\s+/g, ' ').trim();
}

function macTutorParagraphs(html, source) {
  // This registry entry's biography uses paired br tags as paragraph markers,
  // alongside incidental p elements elsewhere on the page. Accept only blocks
  // bounded at BOTH ends by those explicit markers, outside p elements. A
  // single br or a source-formatting blank line never divides a source unit.
  if (source.id !== 'alex-aristarchus' || source.url !== 'https://mathshistory.st-andrews.ac.uk/Biographies/Aristarchus/') return [];
  return html.split(/<p\b[^>]*>[\s\S]*?<\/p\s*>/gi).flatMap(outside => {
    const boundaries = [...outside.matchAll(/<br\s*\/?\s*>\s*<br\s*\/?\s*>/gi)];
    return boundaries.slice(1).map((boundary, index) => cleanHtml(outside.slice(boundaries[index].index + boundaries[index][0].length, boundary.index)));
  });
}

function excerptFrom(html, prompt, source) {
  const sourceText = html.replace(/<(script|style|noscript|svg|nav|header|footer)[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const paragraphBlocks = [...sourceText.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(match => cleanHtml(match[1]));
  // A unit is an entire source paragraph, including adjacent-sentence caveats.
  // Without paragraph markup retain the entire text; line breaks (including br)
  // are not reliable semantic boundaries. Never turn a clipped fragment into a
  // quotable unit, even when that means this source is unavailable.
  const explicitBlocks = [...paragraphBlocks, ...macTutorParagraphs(sourceText, source)];
  const blocks = explicitBlocks.length ? explicitBlocks : [cleanHtml(sourceText)];
  const candidates = [...new Set(blocks)].filter(text => text.length >= 80 && text.length <= MAX_EXCERPT_CHARS && keywordCheck(text).allowed
    && !/(back to .*home page|skip to main content|home page .* sources|^sources illustrations|^return to )/i.test(text));
  const stop = new Set(['what', 'when', 'where', 'which', 'while', 'would', 'could', 'should', 'this', 'that', 'these', 'those', 'from', 'with', 'into', 'then', 'than', 'have', 'had', 'were', 'been', 'will', 'your', 'about', 'their', 'there', 'them', 'they', 'some', 'more', 'make', 'made', 'does', 'did', 'over', 'under', 'after', 'before', 'never', 'than', 'would', 'ancient']);
  const promptTokens = (prompt.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter(token => !stop.has(token));
  const titleTokens = `${source.id.replace(/-/g, ' ')} ${source.title}`.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  const tokens = [...new Set([...promptTokens, ...titleTokens.filter(token => !stop.has(token))])];
  const relevant = candidates.map((text, index) => {
    const lowered = text.toLowerCase();
    const hits = tokens.reduce((count, token) => count + (lowered.includes(token) ? 1 : 0), 0);
    return { text, index, hits };
  }).filter(item => item.hits > 0).sort((a, b) => b.hits - a.hits || a.index - b.index);
  if (!relevant.length) return '';
  let excerpt = '';
  for (const item of relevant) {
    const next = excerpt ? `${excerpt}\n\n${item.text}` : item.text;
    if (next.length > MAX_EXCERPT_CHARS) continue;
    excerpt = next;
  }
  return excerpt;
}

function matchTopic(prompt) {
  const normalized = prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return TOPICS.find(topic => topic.match.some(term => normalized.includes(term)));
}

/** Retrieve only a small, fixed set of approved public sources for supported topics. */
export async function resolveFreshEvidence(prompt, { fetchImpl = globalThis.fetch, timeoutMs = 7_000, sourceBudgetMs = 15_000, maxBytes = MAX_SOURCE_BYTES, signal } = {}) {
  const topic = matchTopic(prompt);
  if (!topic) return { status: 'unavailable', reason: 'topic_out_of_coverage', topicId: null, sources: [], errors: [] };
  const deadline = Date.now() + sourceBudgetMs;
  const results = await Promise.all(topic.sources.map(async source => {
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || !APPROVED_HOSTS.has(url.hostname)) {
      return { error: { sourceId: source.id, reason: 'source_not_approved' } };
    }
    try {
      let body;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal?.aborted) throw new Error('Run aborted');
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw new Error('source_budget_exhausted');
        const timeout = Math.max(1, Math.min(timeoutMs, remainingMs));
        const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
        try {
          const response = await fetchImpl(source.url, { method: 'GET', redirect: 'error', signal: requestSignal, headers: { accept: 'text/html,application/xhtml+xml,text/plain,application/xml,text/xml' } });
          if (!response.ok) {
            const failure = new Error(`http_${response.status}`);
            failure.retryable = response.status === 429 || response.status >= 500;
            throw failure;
          }
          const contentType = response.headers?.get?.('content-type') ?? '';
          if (contentType && !/(text\/html|application\/xhtml\+xml|text\/plain|application\/xml|text\/xml)/i.test(contentType)) throw new Error('unsupported_content_type');
          const reader = response.body?.getReader?.();
          if (reader) {
            const chunks = []; let size = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > maxBytes) { await reader.cancel(); throw new Error('source_too_large'); }
              chunks.push(value);
            }
            body = Buffer.concat(chunks).toString('utf8');
          } else {
            body = await response.text();
            if (Buffer.byteLength(body) > maxBytes) throw new Error('source_too_large');
          }
          break;
        } catch (error) {
          if (signal?.aborted) throw new Error('Run aborted');
          const retryable = error.retryable || error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof TypeError;
          if (!retryable || attempt === 1 || Date.now() >= deadline) throw error;
        }
      }
      const text = cleanHtml(body);
      if (/checking your browser|captcha|enable cookies|client challenge|access denied/i.test(text)) throw new Error('source_access_challenge');
      if (text.length < 100) throw new Error('source_text_unavailable');
      const excerpt = excerptFrom(body, prompt, source);
      if (!excerpt) throw new Error('no_relevant_policy_clear_excerpt');
      const retrievedAt = new Date().toISOString();
      return { source: { ...source, date: retrievedAt.slice(0, 10), checkedDate: retrievedAt.slice(0, 10), checkedAt: retrievedAt, retrievalTimestamp: retrievedAt, fetchStatus: 'fetched', provenance: 'bounded-live-fetch', verificationMethod: 'retrieved_excerpt', contentSha256: createHash('sha256').update(text).digest('hex'), excerptFormat: EXCERPT_FORMAT, excerpt } };
    } catch (error) {
      return { error: { sourceId: source.id, reason: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? 'fetch_failed').slice(0, 80) } };
    }
  }));
  const sources = results.flatMap(result => result.source ? [result.source] : []);
  const errors = results.flatMap(result => result.error ? [result.error] : []);
  return { status: sources.length ? 'retrieved' : 'unavailable', reason: sources.length ? null : 'all_sources_unavailable', topicId: topic.id, retrievedAt: new Date().toISOString(), sources, errors, method: { label: 'Bounded public source retrieval', scope: 'Fixed approved URLs selected from a topic registry; baselines copy complete retrieved source units, preserving their wording and qualifications. Retrieval and quotation are not independent factual verification.', scoreDisclaimer: 'Generation rankings are not factual confidence scores; model-selected baseline excerpts require human source review.' } };
}

function freshProjection(artifact) {
  const evidence = artifact?.evidence ? { ...artifact.evidence } : artifact?.evidence;
  if (evidence && typeof evidence === 'object') delete evidence.artifactSha256;
  return { runId: artifact?.runId, divergence: artifact?.divergence, branches: artifact?.branches, evidence };
}

/** Digest the saved fresh-run projection that contains its source envelope. */
export function freshEvidenceDigest(artifact) {
  return branchDigest(freshProjection(artifact));
}

function isText(value) { return typeof value === 'string' && value.trim().length > 0; }

/** Whole retrieval-authored units only. Legacy excerpts may have been clipped. */
export function freshSourceUnits(source) {
  if (source?.excerptFormat !== EXCERPT_FORMAT || !isText(source.excerpt) || source.excerpt.length > MAX_EXCERPT_CHARS) return [];
  const units = source.excerpt.split('\n\n');
  return units.every(unit => isText(unit) && unit === unit.trim() && !/[\r\n]/.test(unit)) ? units : [];
}
function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function safeRetrievedSource(source) {
  try {
    const url = new URL(source.url);
    const retrievedAt = new Date(source.retrievalTimestamp);
    return /^[a-z][a-z0-9-]{0,47}$/.test(source.id) && isText(source.title) && isText(source.publisher)
      && url.protocol === 'https:' && APPROVED_HOSTS.has(url.hostname) && !url.username && !url.password && !url.search && !url.hash
      && isDate(source.date) && isDate(source.checkedDate) && source.checkedDate === source.date
      && source.verificationMethod === 'retrieved_excerpt' && source.fetchStatus === 'fetched'
      && source.provenance === 'bounded-live-fetch' && Number.isFinite(retrievedAt.getTime()) && source.date === retrievedAt.toISOString().slice(0, 10)
      && /^[a-f0-9]{64}$/.test(source.contentSha256) && freshSourceUnits(source).length > 0;
  } catch { return false; }
}
export function isSafeGroundedBranch(branch, sourceById) {
  // An ID proves only a link, not support. Requiring the entire quoted unit
  // prevents paraphrases or substrings from dropping uncertainty, attribution,
  // negation, ranges or disagreement. This checks fidelity, not factual truth.
  if (!(sourceById instanceof Map)) return false;
  const textFields = ['title', 'changedAssumption', 'uncertainty', 'demonstrates', 'doesNotEstablish', 'discussionQuestion'];
  const place = branch?.place;
  const linkedIds = new Set(Array.isArray(branch?.baselineClaims) ? branch.baselineClaims.flatMap(claim => Array.isArray(claim?.sourceIds) ? claim.sourceIds : []) : []);
  return branch && /^[a-z][a-z0-9-]{0,47}$/.test(branch.id) && textFields.every(key => isText(branch[key]) && branch[key].length <= 2_000)
    && isText(branch.summary) && branch.summary.length <= 2_000 && isText(branch.scene) && branch.scene.length <= 1_000
    && Number.isInteger(branch.year) && place && isText(place.name) && Number.isFinite(place.lat) && place.lat >= -90 && place.lat <= 90 && Number.isFinite(place.lon) && place.lon >= -180 && place.lon <= 180
    && Array.isArray(branch.causalSteps) && branch.causalSteps.length >= 2 && branch.causalSteps.length <= 8 && branch.causalSteps.every(value => isText(value) && value.length <= 1_000)
    && Array.isArray(branch.unverifiedClaims) && branch.unverifiedClaims.length > 0 && branch.unverifiedClaims.length <= 12 && branch.unverifiedClaims.every(value => isText(value) && value.length <= 1_000)
    && Array.isArray(branch.baselineClaims) && branch.baselineClaims.length > 0 && branch.baselineClaims.length <= 12 && branch.baselineClaims.every(claim => claim && isText(claim.text) && claim.text.length <= MAX_EXCERPT_CHARS && Array.isArray(claim.sourceIds) && claim.sourceIds.length === 1 && freshSourceUnits(sourceById.get(claim.sourceIds[0])).includes(claim.text))
    && Array.isArray(branch.citations) && branch.citations.length > 0 && branch.citations.length <= 4 && new Set(branch.citations).size === branch.citations.length && branch.citations.every(id => sourceById.has(id) && linkedIds.has(id))
    && [...linkedIds].every(id => branch.citations.includes(id));
}

/** Keep only grounded branches with unambiguous IDs, matching the saved-run selector. */
export function selectSafeGroundedBranches(branches, sourceById) {
  if (!Array.isArray(branches) || branches.length > 8) return [];
  const idCounts = new Map();
  for (const branch of branches) if (typeof branch?.id === 'string') idCounts.set(branch.id, (idCounts.get(branch.id) ?? 0) + 1);
  return branches.filter(branch => idCounts.get(branch?.id) === 1 && isSafeGroundedBranch(branch, sourceById));
}

/** Validate and normalize live evidence into the same envelope shape used by replay. */
export function selectFreshEvidence(runId, branchArtifact) {
  try {
    const evidence = branchArtifact?.evidence;
    if (typeof runId !== 'string' || !branchArtifact || branchArtifact.runId !== runId || branchArtifact.status !== 'ok'
      || evidence?.status !== 'retrieved' || !Array.isArray(evidence.sources) || !evidence.sources.length
      || !Array.isArray(branchArtifact.branches) || !branchArtifact.branches.length || branchArtifact.branches.length > 8 || !isText(branchArtifact.divergence) || branchArtifact.divergence.length > 2_000
      || !evidence.method || !isText(evidence.method.label) || !isText(evidence.method.scope) || !isText(evidence.method.scoreDisclaimer)
      || !isDate(evidence.retrievedAt?.slice?.(0, 10)) || evidence.artifactSha256 !== freshEvidenceDigest(branchArtifact)) return null;
    const sources = evidence.sources;
    if (sources.some(source => !safeRetrievedSource(source)) || new Set(sources.map(source => source.id)).size !== sources.length) return null;
    const sourceById = new Map(sources.map(source => [source.id, source]));
    const safeBranches = selectSafeGroundedBranches(branchArtifact.branches, sourceById);
    if (safeBranches.length !== branchArtifact.branches.length) return null;
    for (const branch of safeBranches) {
      const linkedIds = new Set(branch.baselineClaims.flatMap(claim => claim.sourceIds));
      if (branch.citations.some(id => !sourceById.has(id) || !linkedIds.has(id))) return null;
    }
    return {
      schemaVersion: 1, status: evidence.status, topicId: evidence.topicId, authoredAt: evidence.retrievedAt.slice(0, 10), method: evidence.method, sources,
      run: { runId, divergence: branchArtifact.divergence, branches: safeBranches.map(branch => ({
        branchId: branch.id, title: branch.title, baselineSourceIds: [...new Set(branch.baselineClaims.flatMap(claim => claim.sourceIds))],
        changedAssumption: branch.changedAssumption, causalSteps: branch.causalSteps, baselineClaims: branch.baselineClaims,
        uncertainty: branch.uncertainty, citations: branch.citations, unverifiedClaims: branch.unverifiedClaims,
        demonstrates: branch.demonstrates, doesNotEstablish: branch.doesNotEstablish, discussionQuestion: branch.discussionQuestion,
        modelReviewScore: Number.isFinite(branch.score) ? branch.score : null,
      })) },
    };
  } catch { return null; }
}

export const freshEvidenceCoverage = TOPICS.map(({ id, match }) => ({ id, topics: [...match] }));
