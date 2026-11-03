import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalMetaKeySetup } from '../web/localMetaKey.js';

function control() {
  const listeners = new Map();
  return {
    value: '', hidden: false, disabled: false, textContent: '', dataset: {},
    addEventListener(type, callback) { listeners.set(type, callback); },
    click() { return listeners.get('click')?.({ target: this }); },
    keydown(key) { const event = { key, prevented: false, preventDefault() { this.prevented = true; } }; listeners.get('keydown')?.(event); return event; },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(fetchImpl, refreshServiceMode = async () => {}) {
  const ui = Object.fromEntries(['details', 'input', 'useButton', 'clearButton', 'status', 'configStatus'].map(key => [key, control()]));
  ui.api = createLocalMetaKeySetup({ ...ui, fetchImpl, refreshServiceMode });
  return ui;
}
const available = extra => ({ status: 'ok', setupAvailable: true, metaKeyConfigured: false, metaKeyOverrideActive: false, localReviewAccess: false, localHistoryAccess: true, ...extra });

test('apply posts the masked value, clears it immediately, refreshes mode and never persists it', async () => {
  const requests = []; let mode = 'replay-only', stored = 0;
  const previousLocal = globalThis.localStorage, previousSession = globalThis.sessionStorage;
  globalThis.localStorage = { setItem() { stored++; }, getItem() { stored++; return null; } };
  globalThis.sessionStorage = { setItem() { stored++; }, getItem() { stored++; return null; } };
  try {
    const ui = setup(async (url, options) => { requests.push({ url, ...options }); return { ok: true }; }, async () => { mode = 'live-enabled'; });
    ui.api.setHealth(available());
    assert.equal(ui.details.hidden, false);
    assert.equal(ui.configStatus.textContent, 'No Meta API key is configured on this server.');
    ui.input.value = 'fixture-secret-not-persisted'; ui.useButton.click();
    assert.equal(ui.input.value, '', 'clear before the network request resolves');
    await tick();
    assert.deepEqual(requests, [{ url: '/api/local-meta-key', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: 'fixture-secret-not-persisted' }) }]);
    assert.equal(mode, 'live-enabled', 'refresh callback runs after apply');
    assert.equal(ui.status.textContent, 'Meta key is active for this local session.');
    assert.doesNotMatch(ui.status.textContent + ui.configStatus.textContent, /fixture-secret-not-persisted/);
    assert.equal(stored, 0);
  } finally {
    if (previousLocal === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousLocal;
    if (previousSession === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previousSession;
  }
});

test('Enter applies once, prevents prompt form submission, and ignores duplicate actions while busy', async () => {
  let finish; const requests = [];
  const ui = setup((url, options) => { requests.push({ url, options }); return new Promise(resolve => { finish = resolve; }); });
  ui.api.setHealth(available()); ui.input.value = 'keyboard-fixture-key';
  const event = ui.input.keydown('Enter');
  assert.equal(event.prevented, true);
  assert.equal(ui.input.value, '');
  ui.input.keydown('Enter'); ui.useButton.click();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/local-meta-key'); assert.equal(requests[0].options.method, 'POST');
  finish({ ok: true }); await tick();
});

test('Clear override is enabled only for this-session overrides and uses DELETE', async () => {
  const requests = []; let refreshed = 0;
  const ui = setup(async (url, options) => { requests.push({ url, ...options }); return { ok: true }; }, async () => { refreshed++; });
  ui.api.setHealth(available({ metaKeyConfigured: true, metaKeyOverrideActive: false }));
  assert.match(ui.configStatus.textContent, /startup Meta API key/i);
  assert.equal(ui.clearButton.disabled, true, 'startup env config is not a local override');
  ui.api.setHealth(available({ metaKeyConfigured: true, metaKeyOverrideActive: true }));
  assert.match(ui.configStatus.textContent, /local-session override is active/i);
  assert.equal(ui.clearButton.disabled, false);
  ui.input.value = 'discard-this'; ui.clearButton.click();
  assert.equal(ui.input.value, ''); await tick();
  assert.deepEqual(requests, [{ url: '/api/local-meta-key', method: 'DELETE' }]);
  assert.equal(refreshed, 1);
});

test('remote setup stays hidden and 409 uses a fixed wait message without echoing response text', async () => {
  const ui = setup(async () => ({ ok: false, status: 409, json: async () => ({ error: 'secret server detail' }) }));
  ui.api.setHealth({ ...available(), setupAvailable: false });
  assert.equal(ui.details.hidden, true);
  ui.api.setHealth(available()); ui.input.value = 'never-echo-this'; ui.useButton.click();
  assert.equal(ui.input.value, ''); await tick();
  assert.match(ui.status.textContent, /already in progress.*wait/i);
  assert.doesNotMatch(ui.status.textContent, /secret server detail|never-echo-this/);
});

test('page presents the masked session-only setup beside the invitation', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const invitation = html.slice(html.indexOf('<section id="invitation"'), html.indexOf('<section id="exploration-tree"'));
  assert.match(invitation, /id="meta-key-setup"[^>]*hidden/);
  assert.match(invitation, /id="meta-key-input" type="password" autocomplete="off" autocapitalize="none" spellcheck="false"/);
  assert.match(invitation, /id="meta-key-use"/); assert.match(invitation, /id="meta-key-clear"/);
  assert.match(invitation, /not saved in the browser or to disk/i);
});
