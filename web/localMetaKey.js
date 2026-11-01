export function createLocalMetaKeySetup({ details, input, useButton, clearButton, status, configStatus, fetchImpl = fetch, refreshServiceMode }) {
  let busy = false;
  function setBusy(value) {
    busy = value;
    useButton.disabled = value;
    clearButton.disabled = value || clearButton.dataset.available !== 'true';
    input.disabled = value;
  }
  function setHealth(health) {
    const available = health?.status === 'ok' && health.setupAvailable === true;
    details.hidden = !available;
    const configured = available && health.metaKeyConfigured === true;
    const overrideActive = configured && health.metaKeyOverrideActive === true;
    clearButton.dataset.available = String(overrideActive);
    clearButton.disabled = busy || clearButton.dataset.available !== 'true';
    if (configStatus) configStatus.textContent = !available ? '' : overrideActive
      ? 'A local-session override is active. Restarting the server discards it.'
      : configured ? 'A startup Meta API key is configured on this server.'
        : 'No Meta API key is configured on this server.';
  }
  async function request(method) {
    if (busy) return;
    const apiKey = method === 'POST' ? input.value : '';
    input.value = '';
    if (method === 'POST' && !apiKey.trim()) {
      status.textContent = 'Enter a Meta API key to apply it for this local session.';
      return;
    }
    setBusy(true);
    status.textContent = method === 'POST' ? 'Applying local Meta key…' : 'Restoring the server’s startup configuration…';
    try {
      const response = await fetchImpl('/api/local-meta-key', {
        method,
        ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey }) } : {}),
      });
      if (response.status === 409) {
        status.textContent = 'A Meta key change is already in progress. Wait for it to finish, then try again.';
        return;
      }
      if (!response.ok) throw new Error('Local key setup request failed');
      const refreshed = await refreshServiceMode();
      if (refreshed === null) throw new Error('Local service mode refresh failed');
      status.textContent = method === 'POST' ? 'Meta key is active for this local session.' : 'Startup configuration restored for this local session.';
    } catch {
      status.textContent = method === 'POST' ? 'Could not apply the Meta key. Check the local server and try again.' : 'Could not restore startup configuration. Check the local server and try again.';
    } finally { setBusy(false); }
  }
  useButton.addEventListener('click', () => { void request('POST'); });
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void request('POST');
  });
  clearButton.addEventListener('click', () => { void request('DELETE'); });
  setHealth(null);
  return { setHealth };
}
