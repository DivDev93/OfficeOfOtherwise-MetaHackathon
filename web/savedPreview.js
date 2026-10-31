/** One read-only saved-event preview shared by the tree and globe. */
export function createSavedPreviewPopover(host, { document: doc = globalThis.document, viewport = () => ({ width: 1024, height: 768 }) } = {}) {
  if (!host?.append) throw new Error('A preview host is required');
  const document = host.ownerDocument || doc;
  const popup = document.createElement('aside');
  popup.id = 'saved-event-preview';
  popup.className = 'saved-event-preview';
  popup.hidden = true;
  popup.setAttribute('role', 'tooltip');
  popup.setAttribute('aria-live', 'polite');
  popup.setAttribute('aria-label', 'Saved event preview');
  host.append(popup);
  let owner = null, activePreview = null;
  const link = (anchor, enabled) => {
    if (!anchor?.getAttribute || !anchor?.setAttribute) return;
    const ids = (anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== popup.id);
    if (enabled) ids.push(popup.id);
    if (ids.length) anchor.setAttribute('aria-describedby', ids.join(' '));
    else anchor.removeAttribute?.('aria-describedby');
  };

  function clear(anchor) {
    if (anchor && owner !== anchor) return false;
    link(owner, false);
    owner = null; activePreview = null; popup.hidden = true; popup.replaceChildren();
    return true;
  }
  function show(data, anchor) {
    if (!data || !anchor) return clear();
    if (owner && owner !== anchor) link(owner, false);
    owner = anchor;
    link(owner, true);
    activePreview = { ...data };
    popup.replaceChildren();
    const title = document.createElement('strong'); title.textContent = data.title || 'Saved possibility';
    const meta = document.createElement('small'); meta.textContent = [data.yearLabel, data.location, data.sceneStatus].filter(Boolean).join(' · ');
    const summary = document.createElement('p'); summary.textContent = data.summary || 'No saved summary is available.';
    const scene = document.createElement('small');
    scene.className = 'saved-preview-scene';
    scene.textContent = data.sceneReference ? 'A saved scene is available.' : (data.sceneStatus || 'No saved scene is confirmed.');
    popup.append(title, meta, summary, scene);
    popup.hidden = false;

    const rect = anchor.getBoundingClientRect?.() || { left: 8, top: 8, right: 8, bottom: 8, width: 0, height: 0 };
    const size = viewport() || {};
    const width = Math.max(220, Math.min(340, Number(size.width) || 1024));
    const height = popup.offsetHeight || 150;
    const margin = 8;
    let left = rect.left + (rect.width || 0) / 2 - width / 2;
    let top = rect.bottom + 8;
    if (top + height > (Number(size.height) || 768) - margin) top = rect.top - height - 8;
    left = Math.max(margin, Math.min(left, (Number(size.width) || 1024) - width - margin));
    top = Math.max(margin, Math.min(top, (Number(size.height) || 768) - height - margin));
    popup.style.left = `${left}px`; popup.style.top = `${top}px`; popup.style.width = `${width}px`;
    return true;
  }
  return { show, clear, get activePreview() { return activePreview; }, get element() { return popup; } };
}
