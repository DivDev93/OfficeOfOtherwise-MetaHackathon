import test from 'node:test';
import assert from 'node:assert/strict';
import { RUBRIC, MAX_RESULT_BYTES, MAX_IMPORT_FILES, createInvite, buildInviteUrl, parseInviteUrl, invitationsToCsv,
  createParticipantResult, createObservation, parseResultJson, serializeResult, isObservedSession, summarizePilot } from '../web/pilot-logic.js';

const started = '2026-10-30T12:00:00.000Z';
const finished = '2026-10-30T12:06:20.000Z';
function participant(n = 1) {
  return createParticipantResult({ sessionId: `pilot-${n.toString(16).padStart(16, '0')}`, adultCreator: true, notesConsent: true, quoteConsent: false,
    taskStartedAt: started, taskFinishedAt: finished, answers: { sourceBoundary: 'Participant answer recorded privately.', visualReflection: 'A concrete reflection.', creatorReflection: 'A suggested change.' }, briefExported: true });
}
function observation(n = 1, points = 5, sourceMisunderstanding = 'no') {
  return createObservation(participant(n), { observed: true, realParticipant: true, taskStartedAt: started, taskFinishedAt: finished,
    scores: Object.fromEntries(RUBRIC.map(({ id }, index) => [id, { score: Number(index < points), evidence: `Test fixture observation for ${id}; never a real session.` }])),
    sourceMisunderstanding, sourceBoundaryEvidence: 'Test fixture source-boundary statement.', creatorReflection: 'Test fixture creator reflection.',
    briefExportObserved: points === 5, assistance: 'Test fixture: none observed.', context: 'Automated test fixture; not actual participants.' });
}

test('anonymous invite URLs contain only a random code and reject identity and unsafe URLs', () => {
  const invite = createInvite({ createdAt: started });
  assert.match(invite.sessionId, /^pilot-[a-f0-9]{16}$/);
  assert.notEqual(createInvite().sessionId, invite.sessionId);
  const url = buildInviteUrl(invite, 'https://example.test/old?private=hidden');
  assert.equal(url, `https://example.test/pilot.html?session=${invite.sessionId}`);
  assert.deepEqual(parseInviteUrl(url), { sessionId: invite.sessionId });
  for (const base of ['javascript:alert(1)', 'http://example.test', 'https://name:password@example.test']) assert.throws(() => buildInviteUrl(invite, base));
  for (const base of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) assert.match(buildInviteUrl(invite, base), /\/pilot.html\?session=/);
  for (const suffix of ['&email=person@example.test', '&session=pilot-0000000000000001', '#name']) assert.throws(() => parseInviteUrl(url + suffix));
  assert.throws(() => createInvite({ sessionId: 'alice@example.test' }));
  assert.throws(() => createInvite({ sessionId: 'pilot-0000000000000001', createdAt: '2026-02-30T12:00:00.000Z' }));
});

test('invitation CSV explicitly records preparation and cannot contain arbitrary formula cells', () => {
  const invite = createInvite({ sessionId: 'pilot-0000000000000001', createdAt: started });
  const csv = invitationsToCsv([invite], 'https://example.test');
  assert.match(csv, /session_code/);
  assert.match(csv, /invite created; session not verified/);
  assert.match(csv, /https:\/\/example.test\/pilot.html\?session=pilot-0000000000000001/);
  assert.throws(() => invitationsToCsv([invite, invite], 'https://example.test'));
  assert.throws(() => invitationsToCsv(Array(MAX_IMPORT_FILES + 1).fill(invite), 'https://example.test'));
  assert.throws(() => invitationsToCsv([{ ...invite, sessionId: '=HYPERLINK("bad")' }], 'https://example.test'));
});

test('adult eligibility, notes consent and quotation consent remain separate choices', () => {
  const valid = participant();
  assert.equal(valid.notesConsent, true);
  assert.equal(valid.quoteConsent, false);
  assert.equal(valid.mode, 'unmoderated');
  assert.equal(valid.answers.quote, '');
  assert.equal(valid.elapsedSeconds, 380);
  assert.throws(() => createParticipantResult({ ...valid, adultCreator: false }));
  assert.throws(() => createParticipantResult({ ...valid, notesConsent: false }));
  assert.throws(() => createParticipantResult({ ...valid, quoteConsent: 'yes' }));
  assert.throws(() => createParticipantResult({ ...valid, answers: { ...valid.answers, quote: 'Retain my words' } }));
  assert.throws(() => createParticipantResult({ ...valid, mode: 'automatic' }));
  assert.equal(createParticipantResult({ ...valid, quoteConsent: true, mode: 'moderated', answers: { ...valid.answers, quote: 'Approved words' } }).answers.quote, 'Approved words');
  assert.throws(() => createParticipantResult({ ...valid, taskFinishedAt: '2026-10-30T11:59:00.000Z' }));
  assert.throws(() => createParticipantResult({ ...valid, taskFinishedAt: '2026-11-01T12:00:00.000Z' }));
});

test('participant records round-trip as preliminary and defaults never score missing evidence', () => {
  const valid = participant();
  assert.deepEqual(parseResultJson(serializeResult(valid)), valid);
  const pending = createObservation(valid);
  assert.equal(pending.observation.observed, false);
  assert.equal(pending.observation.scores.path.score, null);
  assert.equal(pending.observation.taskStartedAt, null);
  assert.equal(isObservedSession(pending), false);
  const summary = summarizePilot([valid, participant(2), participant(3)]);
  assert.equal(summary.observedSessions, 0);
  assert.equal(summary.preliminarySessions, 3);
  assert.equal(summary.targetMet, false);
  assert.equal(summarizePilot([]).targetMet, false);
});

test('facilitator evidence requires every rubric observation, timing and source boundary answer', () => {
  const complete = observation();
  assert.equal(isObservedSession(complete), true);
  assert.deepEqual(parseResultJson(serializeResult(complete)), complete);
  const incomplete = (field, value) => ({ ...complete, observation: { ...complete.observation, [field]: value } });
  for (const [field, value] of [['observed', false], ['realParticipant', false], ['sourceMisunderstanding', 'unclear'], ['sourceBoundaryEvidence', ' '], ['creatorReflection', ''], ['assistance', ''], ['context', '']]) assert.equal(isObservedSession(incomplete(field, value)), false, field);
  assert.equal(isObservedSession(createObservation(participant(), { ...complete.observation, taskStartedAt: null, taskFinishedAt: null })), false);
  const missing = structuredClone(complete);
  missing.observation.scores.path = { score: null, evidence: '' };
  assert.equal(isObservedSession(missing), false);
  missing.observation.scores.path = { score: 0, evidence: '' };
  assert.equal(isObservedSession(missing), false);
  assert.throws(() => createObservation(participant(), { ...complete.observation, briefExportObserved: false }));
  const failed = observation(2, 0);
  assert.equal(isObservedSession(failed), true, 'Observed failures remain in the denominator');
});

test('aggregate preserves original 3–5 and rounded 80 percent target', () => {
  assert.equal(summarizePilot([observation()]).targetMet, false);
  assert.equal(summarizePilot([observation(), observation(2)]).targetMet, false);
  assert.equal(summarizePilot([observation(), observation(2), observation(3)]).targetMet, true);
  const five = [observation(), observation(2), observation(3), observation(4, 4), observation(5, 0)];
  const summary = summarizePilot(five);
  assert.equal(summary.observedSessions, 5);
  assert.equal(summary.passedSessions, 4);
  assert.equal(summary.requiredPasses, 4);
  assert.equal(summary.targetMet, true);
  assert.equal(summarizePilot(five.slice(1)).targetMet, false, '3/4 must not round down to 80 percent');
  assert.equal(summarizePilot([...five, observation(6)]).targetMet, false, 'Do not silently change the original cohort');
  assert.equal(summarizePilot([observation(), observation(2), observation(3, 5, 'yes')]).targetMet, false);
  assert.equal(summarizePilot([observation(), observation(2), observation(3), participant(4)]).targetMet, false);
});

test('duplicates never inflate observed sessions; conflicting versions require explicit reconciliation', () => {
  const record = observation();
  const summary = summarizePilot([record, structuredClone(record), observation(2)]);
  assert.equal(summary.importedRecords, 3);
  assert.equal(summary.uniqueSessions, 2);
  assert.equal(summary.duplicateSessions, 1);
  assert.equal(summary.observedSessions, 2);
  assert.equal(summary.targetMet, false);
  assert.throws(() => summarizePilot([record, participant()]));
  assert.throws(() => summarizePilot(Array(MAX_IMPORT_FILES + 1).fill(record)));
});

test('imports reject size, unknown schemas, prototype keys, invalid values and forged timing', () => {
  const valid = participant();
  for (const change of [{ schema: 'other' }, { email: 'private@example.test' }, { elapsedSeconds: 0 }, { notesConsent: false }, { adultCreator: false }, { answers: { ...valid.answers, name: 'private' } }]) assert.throws(() => parseResultJson(JSON.stringify({ ...valid, ...change })));
  assert.throws(() => parseResultJson(JSON.stringify(valid).replace('"answers":{', '"answers":{"__proto__":{},')));
  assert.equal({}.polluted, undefined);
  assert.throws(() => parseResultJson(' '.repeat(MAX_RESULT_BYTES + 1)));
  assert.throws(() => parseResultJson('😀'.repeat(MAX_RESULT_BYTES / 2)));
  assert.throws(() => createParticipantResult({ ...valid, answers: { ...valid.answers, sourceBoundary: 'x'.repeat(2001) } }));
  assert.throws(() => createParticipantResult({ ...valid, answers: { ...valid.answers, sourceBoundary: '\u0000' } }));
  const forged = observation();
  forged.observation.elapsedSeconds = -1;
  assert.throws(() => parseResultJson(JSON.stringify(forged)));
  forged.observation.elapsedSeconds = 380;
  forged.observation.scores.path.score = 4;
  assert.throws(() => parseResultJson(JSON.stringify(forged)));
  const inherited = Object.create({ hidden: true });
  Object.assign(inherited, valid);
  assert.throws(() => serializeResult(inherited));
});

test('HTML-looking answers stay inert data through export; renderer must use textContent', () => {
  const record = participant();
  record.answers.creatorReflection = '<img src=x onerror=alert(1)> <script>test</script>';
  assert.equal(parseResultJson(serializeResult(record)).answers.creatorReflection, record.answers.creatorReflection);
});
