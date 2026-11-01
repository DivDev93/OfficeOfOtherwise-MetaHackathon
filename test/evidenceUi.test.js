import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEvidencePanel } from '../web/evidence.js';

class Element {
  constructor(tagName, ownerDocument) { this.tagName = tagName; this.ownerDocument = ownerDocument; this.children = []; this.attributes = {}; this.textContent = ''; }
  get textContent() { return this._textContent + this.children.map(child => child.textContent ?? '').join(''); }
  set textContent(value) { this._textContent = String(value); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  queryAll(tagName) { return [...(this.tagName === tagName ? [this] : []), ...this.children.flatMap(child => child.queryAll?.(tagName) ?? [])]; }
}
const document = { createElement(tagName) { return new Element(tagName, document); } };
const unit = 'The source describes scholarly copying and teaching at the Library, while its later institutional continuity remains uncertain.';
const source = { id: 'alex-library', title: 'Library history', publisher: 'Public university', url: 'https://example.org/library', checkedDate: '2026-10-29', excerptFormat: 'complete-source-units-v1', excerpt: unit };
const branch = { branchId: 'b1', title: 'A continuing library', baselineSourceIds: ['alex-library'], baselineClaims: [{ text: unit, sourceIds: ['alex-library'] }], changedAssumption: 'Assume copying continues.', causalSteps: ['More copies survive.', 'More scholars can read them.'], uncertainty: 'Continuity remains unknown.', citations: ['alex-library'], unverifiedClaims: ['The institution survives.'], demonstrates: 'Possible transmission.', doesNotEstablish: 'The alternate outcome.', discussionQuestion: 'What records could help?', };

test('fresh evidence panel shows complete quoted units, uncertainty and safe source links as text', () => {
  const host = new Element('main', document);
  const rendered = renderEvidencePanel(host, { status: 'retrieved', topicId: 'alexandria-library', method: { label: 'Bounded retrieval', scope: 'Fixed public sources.', scoreDisclaimer: 'Scores are not confidence.' }, sources: [source], run: { runId: 'run', branches: [branch] } }, 'b1');
  assert.equal(rendered, true);
  assert.equal(host.queryAll('blockquote')[0].textContent, unit);
  assert.equal(host.queryAll('a')[0].href, 'https://example.org/library');
  assert.match(host.children.map(item => item.textContent).join(' '), /Continuity remains unknown/);

  const changed = new Element('main', document);
  const unsupported = { ...branch, baselineClaims: [{ text: 'The source proves the institution survived.', sourceIds: ['alex-library'] }] };
  renderEvidencePanel(changed, { status: 'retrieved', sources: [source], run: { runId: 'run', branches: [unsupported] } }, 'b1');
  assert.equal(changed.queryAll('blockquote').length, 0);
  assert.equal(changed.queryAll('a').length, 0);
  assert.match(changed.children.map(item => item.textContent).join(' '), /unverified/);
});

test('curated evidence panel links only HTTPS sources and identifies linked baseline notes', () => {
  const host = new Element('main', document);
  const curatedSource = { ...source, baselineParaphrase: 'The source documents a scholarly institution.', url: 'http://unsafe.example.org/library' };
  renderEvidencePanel(host, { schemaVersion: 1, method: { label: 'Curated review', scope: 'Source summaries preserve limits.', scoreDisclaimer: 'Scores are not probabilities.' }, sources: [curatedSource], run: { runId: 'alexandria', branches: [{ branchId: 'b1', baselineSourceIds: ['alex-library'], uncertainty: 'The record is incomplete.' }] } }, 'b1');
  assert.equal(host.queryAll('a').length, 1);
  assert.equal(host.queryAll('a')[0].href, undefined);
  assert.match(host.children.map(item => item.textContent).join(' '), /documents a scholarly institution/);
});

test('unavailable retrieval is explained without showing source-backed claims', () => {
  const host = new Element('main', document);
  assert.equal(renderEvidencePanel(host, { status: 'unavailable' }, 'b1'), false);
  assert.match(host.children.map(item => item.textContent).join(' '), /No source-backed claims are shown; this path remains hypothetical/);
  assert.equal(host.queryAll('a').length, 0);
  assert.equal(host.queryAll('blockquote').length, 0);
});
