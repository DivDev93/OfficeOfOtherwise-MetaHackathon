// Local-only pilot files are anonymous preparation and observations, never recruitment proof.
export const INVITE_SCHEMA = 'office-of-otherwise.pilot-invite.v1';
export const RESULT_SCHEMA = 'office-of-otherwise.pilot-result.v1';
export const MAX_RESULT_BYTES = 32768;
export const MAX_IMPORT_FILES = 20;
export const RUBRIC = Object.freeze([
  { id: 'path', label: 'Selected a branch and identified its changed assumption' },
  { id: 'source', label: 'Named a linked source and a baseline fact it supports' },
  { id: 'chain', label: 'Explained two imagined steps without claiming sourced history' },
  { id: 'visual', label: 'Named a concrete visual benefit or failure' },
  { id: 'brief', label: 'Exported a brief and located its source note and uncertainty' },
].map(Object.freeze));

const ID = /^pilot-[0-9a-f]{16}$/;
const ANSWERS = ['sourceBoundary', 'visualReflection', 'creatorReflection', 'story', 'assistance', 'quote'];
const RESULT_KEYS = ['schema', 'sessionId', 'mode', 'adultCreator', 'notesConsent', 'quoteConsent', 'taskStartedAt', 'taskFinishedAt', 'elapsedSeconds', 'answers', 'briefExported', 'observation'];
const OBSERVATION_KEYS = ['observed', 'realParticipant', 'taskStartedAt', 'taskFinishedAt', 'elapsedSeconds', 'scores', 'sourceMisunderstanding', 'sourceBoundaryEvidence', 'creatorReflection', 'briefExportObserved', 'assistance', 'context'];

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label} must be a plain object`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || ownKeys.some(key => !keys.includes(key))) throw new Error(`${label} has unexpected or missing fields`);
  for (const key of ownKeys) if (!Object.getOwnPropertyDescriptor(value, key)?.enumerable || !('value' in Object.getOwnPropertyDescriptor(value, key))) throw new Error(`${label} fields must be data`);
}
function sessionId(value) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('Use a generated anonymous session code');
  return value;
}
function bool(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false`);
  return value;
}
function text(value, label, max = 2000) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new Error(`${label} must be plain text of at most ${max} characters`);
  return value;
}
function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${label} must be an ISO UTC timestamp`);
  return value;
}
function duration(start, finish) {
  const seconds = (Date.parse(timestamp(finish, 'Task finish')) - Date.parse(timestamp(start, 'Task start'))) / 1000;
  if (seconds < 0 || seconds > 86400) throw new Error('Task time must be between zero and 24 hours');
  return seconds;
}
function nullableTimes(start, finish) {
  if (start === null && finish === null) return null;
  return duration(start, finish);
}
function safeOrigin(baseUrl) {
  const url = new URL(baseUrl);
  if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Invites require HTTPS or a local replay origin');
  return url.origin;
}

export function createInvite({ sessionId: code, createdAt = new Date().toISOString() } = {}) {
  if (code === undefined) {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    code = `pilot-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  return { schema: INVITE_SCHEMA, sessionId: sessionId(code), createdAt: timestamp(createdAt, 'Creation time') };
}

function validateInvite(invite) {
  object(invite, ['schema', 'sessionId', 'createdAt'], 'Invite');
  if (invite.schema !== INVITE_SCHEMA) throw new Error('Unsupported invite schema');
  return createInvite(invite);
}

export function buildInviteUrl(invite, baseUrl) {
  const valid = validateInvite(invite);
  return `${safeOrigin(baseUrl)}/pilot.html?session=${valid.sessionId}`;
}

export function parseInviteUrl(value) {
  const url = new URL(value);
  safeOrigin(url.href);
  if (url.pathname !== '/pilot.html' || url.hash || [...url.searchParams.keys()].length !== 1 || !url.searchParams.has('session')) throw new Error('Invalid pilot invite URL');
  return { sessionId: sessionId(url.searchParams.get('session')) };
}

export function invitationsToCsv(invites, baseUrl) {
  if (!Array.isArray(invites) || invites.length > MAX_IMPORT_FILES) throw new Error(`Use at most ${MAX_IMPORT_FILES} invitations per list`);
  const codes = new Set();
  const rows = invites.map(invite => {
    const valid = validateInvite(invite);
    if (codes.has(valid.sessionId)) throw new Error('Duplicate invitation code');
    codes.add(valid.sessionId);
    return [valid.sessionId, valid.createdAt, buildInviteUrl(valid, baseUrl), 'invite created; session not verified'];
  });
  return [['session_code', 'created_at', 'invite_url', 'status'], ...rows].map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
}

export function createParticipantResult(input) {
  // Only explicitly consented adult records may contain saved answers.
  if (input.adultCreator !== true || input.notesConsent !== true) throw new Error('Adult creator eligibility and consent to notes are required to save a record');
  const suppliedAnswers = input.answers ?? {};
  object(suppliedAnswers, Reflect.ownKeys(suppliedAnswers), 'Answers');
  const answers = { story: '', assistance: '', quote: '', ...suppliedAnswers };
  object(answers, ANSWERS, 'Answers');
  const mode = input.mode ?? 'unmoderated';
  if (!['unmoderated', 'moderated'].includes(mode)) throw new Error('Task mode must be unmoderated or moderated');
  if (input.quoteConsent !== true && typeof answers.quote === 'string' && answers.quote.trim()) throw new Error('A retained quotation requires separate quotation consent');
  const result = {
    schema: RESULT_SCHEMA,
    sessionId: sessionId(input.sessionId),
    mode,
    adultCreator: true,
    notesConsent: true,
    quoteConsent: bool(input.quoteConsent, 'Quote consent'),
    taskStartedAt: timestamp(input.taskStartedAt, 'Task start'),
    taskFinishedAt: timestamp(input.taskFinishedAt, 'Task finish'),
    elapsedSeconds: duration(input.taskStartedAt, input.taskFinishedAt),
    answers: Object.fromEntries(ANSWERS.map(key => [key, text(answers[key], key)])),
    briefExported: bool(input.briefExported, 'Self-reported brief export'),
    observation: null,
  };
  return result;
}

function validateObservation(value) {
  object(value, OBSERVATION_KEYS, 'Observation');
  const elapsedSeconds = nullableTimes(value.taskStartedAt, value.taskFinishedAt);
  if (value.elapsedSeconds !== elapsedSeconds) throw new Error('Observation elapsed time does not match timestamps');
  object(value.scores, RUBRIC.map(item => item.id), 'Rubric');
  const scores = Object.fromEntries(RUBRIC.map(({ id }) => {
    const entry = value.scores[id];
    object(entry, ['score', 'evidence'], `Rubric ${id}`);
    if (![null, 0, 1].includes(entry.score)) throw new Error('Rubric scores must be 0, 1, or missing');
    return [id, { score: entry.score, evidence: text(entry.evidence, `${id} observation`) }];
  }));
  if (!['yes', 'no', 'unclear'].includes(value.sourceMisunderstanding)) throw new Error('Source misunderstanding must be yes, no, or unclear');
  if (![null, true, false].includes(value.briefExportObserved)) throw new Error('Observed brief export must be true, false, or missing');
  if (scores.brief.score === 1 && value.briefExportObserved !== true) throw new Error('A brief point requires an observed brief export');
  return {
    observed: bool(value.observed, 'Observed session'),
    realParticipant: bool(value.realParticipant, 'Real participant'),
    taskStartedAt: value.taskStartedAt, taskFinishedAt: value.taskFinishedAt, elapsedSeconds, scores,
    sourceMisunderstanding: value.sourceMisunderstanding,
    sourceBoundaryEvidence: text(value.sourceBoundaryEvidence, 'Source boundary observation'),
    creatorReflection: text(value.creatorReflection, 'Creator reflection'),
    briefExportObserved: value.briefExportObserved,
    assistance: text(value.assistance, 'Assistance'), context: text(value.context, 'Context'),
  };
}

function validateResult(value) {
  object(value, RESULT_KEYS, 'Result');
  if (value.schema !== RESULT_SCHEMA) throw new Error('Unsupported pilot result schema');
  object(value.answers, ANSWERS, 'Answers');
  const valid = createParticipantResult(value);
  if (valid.elapsedSeconds !== value.elapsedSeconds) throw new Error('Elapsed time does not match timestamps');
  if (value.observation !== null) valid.observation = validateObservation(value.observation);
  return valid;
}

export function createObservation(result, input = {}) {
  const valid = validateResult(result);
  const scores = input.scores ?? Object.fromEntries(RUBRIC.map(({ id }) => [id, { score: null, evidence: '' }]));
  const taskStartedAt = input.taskStartedAt ?? null;
  const taskFinishedAt = input.taskFinishedAt ?? null;
  valid.observation = validateObservation({
    observed: input.observed ?? false, realParticipant: input.realParticipant ?? false,
    taskStartedAt, taskFinishedAt, elapsedSeconds: nullableTimes(taskStartedAt, taskFinishedAt), scores,
    sourceMisunderstanding: input.sourceMisunderstanding ?? 'unclear', sourceBoundaryEvidence: input.sourceBoundaryEvidence ?? '',
    creatorReflection: input.creatorReflection ?? '', briefExportObserved: input.briefExportObserved ?? null,
    assistance: input.assistance ?? '', context: input.context ?? '',
  });
  return valid;
}

export function parseResultJson(source) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > MAX_RESULT_BYTES) throw new Error(`Pilot JSON must be at most ${MAX_RESULT_BYTES} bytes`);
  return validateResult(JSON.parse(source));
}

export function serializeResult(result) {
  const source = JSON.stringify(validateResult(result), null, 2) + '\n';
  if (new TextEncoder().encode(source).length > MAX_RESULT_BYTES) throw new Error('Pilot record exceeds the export size limit');
  return source;
}

export function isObservedSession(result) {
  const valid = validateResult(result);
  const o = valid.observation;
  return Boolean(o?.observed && o.realParticipant && o.elapsedSeconds !== null
    && o.sourceMisunderstanding !== 'unclear' && o.sourceBoundaryEvidence.trim() && o.creatorReflection.trim()
    && o.assistance.trim() && o.context.trim() && o.briefExportObserved !== null
    && RUBRIC.every(({ id }) => o.scores[id].score !== null && o.scores[id].evidence.trim()));
}

export function summarizePilot(results) {
  if (!Array.isArray(results) || results.length > MAX_IMPORT_FILES) throw new Error(`Import at most ${MAX_IMPORT_FILES} records at once`);
  const unique = new Map();
  let duplicateSessions = 0;
  for (const result of results) {
    const valid = validateResult(result);
    if (unique.has(valid.sessionId)) {
      if (JSON.stringify(unique.get(valid.sessionId)) !== JSON.stringify(valid)) throw new Error('Conflicting records for one session code; retain one reviewed version');
      duplicateSessions++;
    } else unique.set(valid.sessionId, valid);
  }
  const observed = [...unique.values()].filter(isObservedSession);
  const passedSessions = observed.filter(record => RUBRIC.reduce((sum, { id }) => sum + record.observation.scores[id].score, 0) >= 4).length;
  const sourceMisunderstandings = [...unique.values()].filter(record => record.observation?.observed && record.observation.realParticipant && record.observation.sourceMisunderstanding === 'yes').length;
  const sourceBoundaryUnclear = [...unique.values()].filter(record => record.observation?.observed && record.observation.realParticipant && (record.observation.sourceMisunderstanding === 'unclear' || !record.observation.sourceBoundaryEvidence.trim())).length;
  const observedSessions = observed.length;
  const preliminarySessions = unique.size - observedSessions;
  const sampleReady = observedSessions >= 3 && observedSessions <= 5;
  const requiredPasses = Math.ceil(observedSessions * 0.8);
  const targetMet = sampleReady && preliminarySessions === 0 && sourceMisunderstandings === 0 && sourceBoundaryUnclear === 0 && passedSessions >= requiredPasses;
  return { importedRecords: results.length, uniqueSessions: unique.size, duplicateSessions, preliminarySessions, observedSessions, passedSessions, requiredPasses,
    sampleReady, sourceMisunderstandings, sourceBoundaryUnclear, targetMet,
    status: targetMet ? 'Recorded observations meet the small-pilot target; facilitator judgments require review.' : 'Pilot remains preliminary or has not met the original target.' };
}
