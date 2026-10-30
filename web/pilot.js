import { RUBRIC, MAX_IMPORT_FILES, MAX_RESULT_BYTES, createInvite, buildInviteUrl, parseInviteUrl, invitationsToCsv, createParticipantResult, parseResultJson, serializeResult, createObservation, isObservedSession, summarizePilot } from './pilot-logic.js';

const $ = id => document.getElementById(id);
const invites = [], records = new Map();
let activeCode = null, startedAt = null, finishedAt = null, timerId = null, checkpointAnnounced = false;
const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = false; }
function action(text, handler) { const button = node('button', text); button.type = 'button'; button.addEventListener('click', () => { try { handler(); } catch (error) { notice(error.message, true); } }); return button; }
function download(filename, content, type = 'application/json') { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = node('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function copy(value) {
  try { await navigator.clipboard.writeText(value); notice('Copied. Share it yourself using your usual private channel.'); }
  catch { const field = node('textarea'); field.value = value; field.readOnly = true; field.setAttribute('aria-label', 'Text to copy'); $('notice').replaceChildren(node('p', 'Copy the selected text and share it yourself.'), field); $('notice').classList.remove('error'); $('notice').hidden = false; field.focus(); field.select(); }
}
function invitationText(invite) { return `Would you try a six-minute creative task in Office of Otherwise? We are looking for adult writers, worldbuilders and concept artists. Allow about ten minutes including consent and a short reflection. Critical feedback is welcome; you may skip questions or stop. Anonymous notes require your consent, and quotation permission is separate and optional. No recording is needed.\n\n${buildInviteUrl(invite, location.href)}\n\nPlease return the downloaded anonymous result JSON file to me through our agreed private channel. The page does not submit anything automatically. We can arrange a time if I will observe; a solo trial is preliminary feedback.`; }
function renderInvites() {
  $('invite-list').replaceChildren(...invites.map(invite => {
    const card = node('article', undefined, 'invite-card');
    const link = node('a', buildInviteUrl(invite, location.href), 'invite-url'); link.href = buildInviteUrl(invite, location.href);
    const buttons = node('div', undefined, 'card-actions'); buttons.append(action('Copy link', () => copy(link.href)), action('Copy invitation text', () => copy(invitationText(invite))));
    card.append(node('h3', invite.sessionId), link, node('p', 'Invitation created · session not yet observed', 'hint'), buttons); return card;
  }));
  $('download-invites').hidden = invites.length === 0;
}
function localTime(value) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19); }
function isoTime(value) { if (!value) throw new Error('Enter the actual task start and finish.'); const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error('Use a valid task time.'); return date.toISOString(); }
function scoreTotal(record) { return RUBRIC.reduce((sum, { id }) => sum + (record.observation?.scores[id].score ?? 0), 0); }
function describeTime(record) { return `${Math.round(record.elapsedSeconds)} seconds self-reported${record.observation?.elapsedSeconds !== null && record.observation ? ` · ${Math.round(record.observation.elapsedSeconds)} seconds observed` : ''}`; }
function renderRecords() {
  const values = [...records.values()], summary = summarizePilot(values);
  $('returned-list').replaceChildren(...values.map(record => {
    const card = node('article', undefined, 'record-card');
    card.append(node('h3', record.sessionId), node('p', `${isObservedSession(record) ? 'Completed observation' : 'Preliminary · not counted as a completed observation'} · ${describeTime(record)}`));
    const details = node('details'), content = node('dl'); details.append(node('summary', 'Read returned reflections'));
    for (const [label, value] of [['Taking part', record.mode === 'moderated' ? 'With a facilitator (participant report; observation still requires confirmation)' : 'On their own · preliminary'], ['Story / path', record.answers.story], ['Source understanding', record.answers.sourceBoundary], ['Visual help or friction', record.answers.visualReflection], ['Creative reflection', record.answers.creatorReflection], ['Help / friction', record.answers.assistance], ['Quotation permission', record.quoteConsent ? 'Permitted separately' : 'Not permitted']]) content.append(node('dt', label), node('dd', value || 'Skipped'));
    if (record.quoteConsent && record.answers.quote) content.append(node('dt', 'Approved quotation'), node('dd', record.answers.quote));
    details.append(content);
    const controls = node('div', undefined, 'card-actions'); controls.append(action('Add / edit observation', () => editObservation(record)), action('Download record', () => download(`${record.sessionId}.json`, serializeResult(record))), action('Remove from this page', () => { records.delete(record.sessionId); renderRecords(); notice('Record removed from this page. Downloaded files are unchanged.'); }));
    card.append(details, controls); return card;
  }));
  const metric = node('p', `${summary.observedSessions} observed · ${summary.passedSessions} scoring 4/5 or higher`, 'metric');
  $('aggregate').replaceChildren(metric, node('p', summary.status), node('p', `${summary.preliminarySessions} preliminary records · ${summary.sourceMisunderstandings} observed source misconceptions · ${summary.sourceBoundaryUnclear} unclear source boundaries. ${summary.observedSessions ? `${summary.requiredPasses}/${summary.observedSessions} passes required (80%, rounded up).` : 'The planned sample is 3–5 observed creators.'}`, 'aggregate-note'));
  $('observed-list').replaceChildren(...values.filter(record => record.observation).map(record => node('p', `${record.sessionId}: ${scoreTotal(record)}/5 · ${isObservedSession(record) ? 'complete observed record' : 'missing observation evidence'} · source misconception: ${record.observation.sourceMisunderstanding}`, 'aggregate-note')));
  $('download-observed').disabled = !values.length;
}
function editObservation(record) {
  const o = record.observation;
  $('observation-form').reset();
  $('observed-code').value = record.sessionId;
  // Consent is confirmed again by the observer rather than inferred from a file.
  $('observed-start').value = o?.taskStartedAt ? localTime(o.taskStartedAt) : '';
  $('observed-end').value = o?.taskFinishedAt ? localTime(o.taskFinishedAt) : '';
  $('observed-boundary').value = o?.sourceMisunderstanding ?? '';
  $('observed-boundary-evidence').value = o?.sourceBoundaryEvidence ?? '';
  $('observed-friction').value = o?.assistance ?? '';
  $('observed-reflection').value = o?.creatorReflection ?? '';
  $('observed-export').value = o?.briefExportObserved === true ? 'yes' : o?.briefExportObserved === false ? 'no' : '';
  let context = {};
  try { context = JSON.parse(o?.context ?? '{}'); } catch { context = { interpretation: o?.context ?? '' }; }
  $('observed-practice').value = context.practice ?? '';
  $('observed-story').value = context.story ?? '';
  $('observed-device').value = context.device ?? '';
  $('observed-checkpoint').value = context.checkpoint ?? '';
  $('observed-brief').value = context.brief ?? '';
  $('observed-interpretation').value = context.interpretation ?? '';
  $('observed-quote').value = context.quote ?? '';
  $('observed-quote').disabled = true;
  for (const { id } of RUBRIC) { $(`score-${id}`).value = o?.scores[id].score ?? ''; $(`evidence-${id}`).value = o?.scores[id].evidence ?? ''; }
  $('observation-panel').open = true; $('observed-code').focus(); $('observation-panel').scrollIntoView({ block: 'start', behavior: 'auto' });
}
function renderRubric() {
  for (const { id, label } of RUBRIC) {
    const fieldset = node('fieldset', undefined, 'rubric-item'); fieldset.append(node('legend', label));
    const scoreLabel = node('label', 'Score'); scoreLabel.htmlFor = `score-${id}`;
    const select = node('select'); select.id = `score-${id}`; select.required = true;
    for (const [value, text] of [['', 'Choose…'], ['0', '0 · not demonstrated'], ['1', '1 · demonstrated']]) { const option = node('option', text); option.value = value; select.append(option); }
    scoreLabel.append(select);
    const evidenceLabel = node('label', 'Observed action or statement, with time / artifact reference'); evidenceLabel.htmlFor = `evidence-${id}`;
    const evidence = node('textarea'); evidence.id = `evidence-${id}`; evidence.required = true; evidence.maxLength = 2000; evidence.rows = 2; evidenceLabel.append(evidence);
    fieldset.append(scoreLabel, evidenceLabel); $('rubric-fields').append(fieldset);
  }
}
$('invite-form').addEventListener('submit', event => {
  event.preventDefault();
  try { const count = Number($('invite-count').value); if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error('Choose 1–5 invitations.'); if (invites.length + count > MAX_IMPORT_FILES) throw new Error('Download this invitation list before creating more. Reload to start a separate batch.'); const batch = Array.from({ length: count }, () => createInvite()); batch.forEach(invite => buildInviteUrl(invite, location.href)); invites.push(...batch); renderInvites(); notice(`${count} invitation${count === 1 ? '' : 's'} ready. Creating links does not count as collected feedback.`); }
  catch (error) { notice(error.message, true); }
});
$('download-invites').addEventListener('click', () => download('creator-invitations.csv', invitationsToCsv(invites, location.href), 'text/csv;charset=utf-8'));
$('import-results').addEventListener('change', async event => {
  try {
    const files = [...event.target.files]; if (files.length > MAX_IMPORT_FILES) throw new Error(`Import at most ${MAX_IMPORT_FILES} files at a time.`);
    const incoming = [];
    for (const file of files) {
      if (file.size > MAX_RESULT_BYTES * MAX_IMPORT_FILES + 20000) throw new Error('This result file is too large.');
      const text = await file.text(); let data; try { data = JSON.parse(text); } catch { throw new Error('Choose a valid downloaded result JSON file.'); }
      if (data?.schema === 'office-of-otherwise.pilot-batch.v1' && Array.isArray(data.records)) {
        if (data.records.length > MAX_IMPORT_FILES) throw new Error('This file contains too many session records.');
        incoming.push(...data.records.map(item => parseResultJson(JSON.stringify(item))));
      } else incoming.push(parseResultJson(text));
    }
    // An imported flag cannot prove direct observation. Preserve its details for manual review.
    for (const record of incoming) if (record.observation) record.observation.observed = false;
    const combined = new Map(records);
    for (const record of incoming) { const previous = combined.get(record.sessionId); if (previous && serializeResult(previous) !== serializeResult(record)) throw new Error('A different record with this session code is already here. Download and review it before removing it to import another version.'); combined.set(record.sessionId, record); }
    summarizePilot([...combined.values()]); records.clear(); combined.forEach((record, code) => records.set(code, record)); renderRecords(); $('import-status').textContent = `${incoming.length} returned record${incoming.length === 1 ? '' : 's'} imported. Self-reports remain preliminary. Saved observations require your explicit review and confirmation before counting here.`;
  } catch (error) { notice(error.message, true); $('import-status').textContent = 'No files from this import were added.'; }
  finally { event.target.value = ''; }
});
$('observed-quotes').addEventListener('change', event => { $('observed-quote').disabled = !event.target.checked; if (!event.target.checked) $('observed-quote').value = ''; });
$('observation-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const original = records.get($('observed-code').value.trim()); if (!original) throw new Error('Import the participant’s returned result file first, then use its session code.');
    if (!$('observed-adult').checked || !$('observed-notes').checked || !$('observed-direct').checked) throw new Error('Confirm eligibility, note consent and direct observation.');
    if ($('observed-quotes').checked && !original.quoteConsent) throw new Error('The returned file does not grant quotation permission. Keep quotation permission unchecked unless the participant supplies an updated consented file.');
    const context = JSON.stringify({ practice: $('observed-practice').value, story: $('observed-story').value, device: $('observed-device').value, checkpoint: $('observed-checkpoint').value, brief: $('observed-brief').value || 'not retained', interpretation: $('observed-interpretation').value, quote: $('observed-quotes').checked ? $('observed-quote').value : '' });
    if (context.length > 2000) throw new Error('Keep combined session context, checkpoint, interpretation and quotation under 2,000 characters. Retain longer notes separately in private files.');
    const scores = Object.fromEntries(RUBRIC.map(({ id }) => [id, { score: Number($(`score-${id}`).value), evidence: $(`evidence-${id}`).value.trim() }]));
    const observed = createObservation(original, { observed: true, realParticipant: true, taskStartedAt: isoTime($('observed-start').value), taskFinishedAt: isoTime($('observed-end').value), scores, sourceMisunderstanding: $('observed-boundary').value, sourceBoundaryEvidence: $('observed-boundary-evidence').value.trim(), creatorReflection: $('observed-reflection').value.trim(), briefExportObserved: $('observed-export').value === 'yes', assistance: $('observed-friction').value.trim(), context });
    serializeResult(observed); records.set(observed.sessionId, observed); renderRecords(); notice('Observation saved in this page. Download it to retain the record.');
  } catch (error) { notice(error.message, true); }
});
$('download-observed').addEventListener('click', () => { const values = [...records.values()]; download('creator-pilot-observations.json', JSON.stringify({ schema: 'office-of-otherwise.pilot-batch.v1', exportedAt: new Date().toISOString(), records: values, assessment: summarizePilot(values) }, null, 2) + '\n'); notice('Downloaded. Store session records privately and publish only consented anonymous summaries.'); });

function updateTimer() {
  if (!startedAt) return;
  const seconds = Math.max(0, Math.floor(((finishedAt ? Date.parse(finishedAt) : Date.now()) - Date.parse(startedAt)) / 1000));
  if (seconds >= 360 && !checkpointAnnounced && !finishedAt) { checkpointAnnounced = true; notice('Six-minute target reached. You can finish now or continue and report the extra time.'); }
  $('timer').textContent = `${finishedAt ? 'Finished' : 'Elapsed'} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}${seconds >= 360 ? ' · six-minute target reached' : ''} · started ${new Date(startedAt).toLocaleTimeString()}${finishedAt ? ` · finished ${new Date(finishedAt).toLocaleTimeString()}` : ''}`;
}
$('start-task').addEventListener('click', () => {
  if (!$('participant-form').reportValidity() || startedAt) return;
  startedAt = new Date().toISOString(); $('start-task').disabled = true; $('finish-task').disabled = false; updateTimer(); timerId = setInterval(updateTimer, 1000); notice('Task started. Open the replay, then return here when you finish.');
});
$('finish-task').addEventListener('click', () => {
  if (!startedAt || finishedAt) return;
  finishedAt = new Date().toISOString(); clearInterval(timerId); updateTimer(); $('finish-task').disabled = true; $('reflection').disabled = false; $('participant-quote').disabled = !$('participant-quotes').checked; $('participant-story').focus(); notice('Task finished. Share as much or as little reflection as you like, then download your result.');
});
$('participant-quotes').addEventListener('change', event => { $('participant-quote').disabled = !event.target.checked || !finishedAt; if (!event.target.checked) $('participant-quote').value = ''; });
$('participant-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    if (!startedAt || !finishedAt) throw new Error('Start and finish the task before downloading a result.');
    const creatorReflection = `Brief: ${$('participant-export').selectedOptions[0].textContent}\nReflection: ${$('participant-brief').value || 'skipped'}`;
    const result = createParticipantResult({ sessionId: activeCode, mode: $('participant-mode').value, adultCreator: $('participant-adult').checked, notesConsent: $('participant-notes').checked, quoteConsent: $('participant-quotes').checked, taskStartedAt: startedAt, taskFinishedAt: finishedAt, answers: { sourceBoundary: $('participant-source').value, visualReflection: $('participant-visual').value, creatorReflection, story: $('participant-story').value, assistance: $('participant-help').value, quote: $('participant-quotes').checked ? $('participant-quote').value : '' }, briefExported: ['yes', 'saved-only'].includes($('participant-export').value) });
    download(`${activeCode}-result.json`, serializeResult(result)); $('result-status').textContent = 'Result downloaded. Return this file yourself; the inviter has not received it yet.'; notice('Your result file is ready. Return it through your agreed private channel.');
  } catch (error) { notice(error.message, true); }
});

renderRubric(); renderRecords();
// Enforce the file format limits at the editing controls too.
document.querySelectorAll('textarea[maxlength]').forEach(field => { field.maxLength = Math.min(field.maxLength, 2000); });
if (location.search || location.hash) {
  $('organizer').hidden = true;
  try { ({ sessionId: activeCode } = parseInviteUrl(location.href)); $('participant').hidden = false; $('session-code').textContent = activeCode; $('page-title').replaceChildren(node('span', 'Step into a possible world.')); $('page-lede').textContent = 'A six-minute creative task, followed by your honest reflection.'; document.title = 'Your creator session — Office of Otherwise'; }
  catch { notice('This invitation link is incomplete or invalid. Ask the person who invited you for a new link. You can still open the replay above.', true); }
}
