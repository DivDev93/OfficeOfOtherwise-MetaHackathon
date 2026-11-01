export const MAX_CLUSTER_FAN_MEMBERS = 19;
export const LARGE_CLUSTER_PAGE_SIZE = 8;

export function needsPagedClusterPicker(cluster) {
  return (cluster?.kind === 'orbit-overflow' || cluster?.kind === 'surface-overflow')
    && cluster?.selectable !== false
    && Array.isArray(cluster.memberIds)
    && cluster.memberIds.length > MAX_CLUSTER_FAN_MEMBERS;
}

export function visibleKeyboardNeighborEntries(entries, origin, visibleIds) {
  if (!origin?.id) return [];
  const visible = visibleIds instanceof Set ? visibleIds : new Set((Array.isArray(visibleIds) ? visibleIds : []).map(String));
  return (Array.isArray(entries) ? entries : []).filter(entry => entry?.id != null
    && String(entry.id) !== String(origin.id)
    && visible.has(String(entry.id))
    && (entry.parentId === origin.id || origin.parentId === entry.id
      || (origin.parentId != null && entry.parentId === origin.parentId)));
}

const memberTitle = world => {
  const title = String(world?.title || 'Untitled possibility').trim();
  const year = Number(world?.year);
  const yearLabel = Number.isSafeInteger(year) && year !== 0
    ? year < 0 ? `${Math.abs(year)} BCE` : String(year)
    : 'Undated';
  return `${yearLabel} · ${title}`;
};

const clusterLevelTitle = cluster => cluster?.kind === 'surface-overflow' || cluster?.level === 'surface'
  ? 'Surface'
  : cluster?.kind === 'orbit-overflow' || cluster?.level === 'orbit' ? 'Orbit' : 'Saved';

/** Accessible, paged fallback for Orbit overflow clouds that exceed the screen fan. */
export function createLargeClusterPicker({
  container,
  document = container?.ownerDocument || globalThis.document,
  focusFallback = container,
  pageSize = LARGE_CLUSTER_PAGE_SIZE,
  onSelect = () => {},
} = {}) {
  if (!container?.append || !document?.createElement || !document?.body?.append) {
    throw new TypeError('A DOM container and document body are required');
  }
  const safePageSize = Math.max(1, Math.trunc(Number(pageSize) || LARGE_CLUSTER_PAGE_SIZE));
  const triggerLayer = document.createElement('div');
  triggerLayer.className = 'atlas-large-cluster-trigger-layer';
  triggerLayer.setAttribute('aria-label', 'Large saved possibility clusters');
  container.append(triggerLayer);
  const tooltip = document.createElement('div');
  tooltip.className = 'atlas-large-cluster-tooltip';
  tooltip.id = 'atlas-large-cluster-tooltip';
  tooltip.hidden = true;
  tooltip.setAttribute('role', 'tooltip');
  triggerLayer.append(tooltip);

  const backdrop = document.createElement('div');
  backdrop.className = 'atlas-large-cluster-backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  const dialog = document.createElement('section');
  dialog.className = 'atlas-large-cluster-picker';
  dialog.id = 'atlas-large-cluster-dialog';
  dialog.hidden = true;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'atlas-large-cluster-title');

  const header = document.createElement('header');
  header.className = 'atlas-large-cluster-header';
  const title = document.createElement('h2');
  title.id = 'atlas-large-cluster-title';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'atlas-large-cluster-close';
  closeButton.setAttribute('aria-label', 'Close saved possibilities');
  closeButton.textContent = '×';
  header.append(title, closeButton);

  const list = document.createElement('div');
  list.className = 'atlas-large-cluster-list';
  list.setAttribute('role', 'list');
  const footer = document.createElement('footer');
  footer.className = 'atlas-large-cluster-footer';
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.setAttribute('aria-label', 'Previous page');
  previous.textContent = '‹';
  const pageStatus = document.createElement('span');
  pageStatus.setAttribute('aria-live', 'polite');
  const next = document.createElement('button');
  next.type = 'button';
  next.setAttribute('aria-label', 'Next page');
  next.textContent = '›';
  footer.append(previous, pageStatus, next);
  dialog.append(header, list, footer);
  document.body.append(backdrop, dialog);

  const triggers = new Map();
  const clusters = new Map();
  let activeId = null;
  let activeTrigger = null;
  let activeWorlds = new Map();
  let page = 0;
  let memberButtons = [];
  let tooltipId = null;

  const isOpen = () => !dialog.hidden;
  const isModal = () => dialog.getAttribute('aria-modal') === 'true';
  const activeCluster = () => clusters.get(activeId) || null;
  const focusables = () => [closeButton, ...memberButtons, ...(previous.disabled ? [] : [previous]), ...(next.disabled ? [] : [next])];

  function render() {
    const cluster = activeCluster();
    const ids = cluster?.memberIds || [];
    const start = page * safePageSize;
    const visibleIds = ids.slice(start, start + safePageSize);
    const pages = Math.max(1, Math.ceil(ids.length / safePageSize));
    title.textContent = `${clusterLevelTitle(cluster)} · ${ids.length} saved possibilities`;
    pageStatus.textContent = `${start + 1}–${Math.min(ids.length, start + visibleIds.length)} of ${ids.length} · page ${page + 1} of ${pages}`;
    previous.disabled = page <= 0;
    next.disabled = page + 1 >= pages;
    list.replaceChildren();
    memberButtons = visibleIds.map(id => {
      const world = activeWorlds.get(String(id));
      const item = document.createElement('div');
      item.setAttribute('role', 'listitem');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'atlas-large-cluster-member';
      button.dataset.worldId = String(id);
      const label = memberTitle(world);
      button.setAttribute('aria-label', label);
      button.textContent = label;
      button.addEventListener('click', event => {
        if (!world || world.selectable === false) return;
        const source = event.detail === 0 ? 'keyboard' : 'pointer';
        close({ restoreFocus: true, returnToFallback: source === 'pointer', forceFocus: true });
        onSelect(world, { source, clientX: event.clientX, clientY: event.clientY, cluster });
      });
      // Hover and focus only expose the saved title; selection is always explicit.
      item.append(button);
      list.append(item);
      return button;
    });
  }

  function open(clusterId, { focus = false } = {}) {
    const cluster = clusters.get(String(clusterId));
    const trigger = triggers.get(String(clusterId));
    if (!cluster || !trigger) return false;
    const changed = activeId !== String(clusterId);
    activeId = String(clusterId);
    activeTrigger = trigger;
    if (changed) page = 0;
    render();
    dialog.setAttribute('aria-modal', String(Boolean(focus)));
    backdrop.hidden = !focus;
    dialog.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    if (focus) memberButtons[0]?.focus();
    return true;
  }

  function showTooltip(id) {
    const cluster = clusters.get(String(id));
    const trigger = triggers.get(String(id));
    if (!cluster || !trigger || trigger.hidden) return;
    tooltipId = String(id);
    tooltip.textContent = `${clusterLevelTitle(cluster)} · ${cluster.memberIds.length} saved possibilities · Select to browse`;
    const width = Math.max(1, Number(container.clientWidth) || 1);
    const height = Math.max(1, Number(container.clientHeight) || 1);
    const triggerLeft = Number.parseFloat(trigger.style.left) || 0;
    const triggerTop = Number.parseFloat(trigger.style.top) || 0;
    const triggerSize = 58;
    const tooltipWidth = Math.min(240, Math.max(1, width - 16));
    const maxLeft = Math.max(8, width - tooltipWidth - 8);
    const left = Math.max(8, Math.min(maxLeft, triggerLeft + triggerSize / 2 - tooltipWidth / 2));
    const belowTop = triggerTop + triggerSize + 6;
    const preferredTop = belowTop + 42 <= height - 8 ? belowTop : triggerTop - 48;
    const top = Math.max(8, Math.min(Math.max(8, height - 42), preferredTop));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.hidden = false;
  }

  function preview(clusterId) {
    if (clusterId == null) {
      if (tooltipId && document.activeElement !== triggers.get(tooltipId)) hideTooltip(tooltipId);
      return false;
    }
    showTooltip(clusterId);
    return tooltipId === String(clusterId) && !tooltip.hidden;
  }

  function hideTooltip(id) {
    if (id != null && tooltipId !== String(id)) return;
    tooltipId = null;
    tooltip.hidden = true;
  }

  function close({ restoreFocus = false, returnToFallback = false, forceFocus = false } = {}) {
    if (!isOpen()) return false;
    const shouldRestore = restoreFocus && (forceFocus || dialog.contains?.(document.activeElement));
    const returnTarget = !returnToFallback && activeTrigger && !activeTrigger.hidden ? activeTrigger : focusFallback;
    if (activeTrigger) activeTrigger.setAttribute('aria-expanded', 'false');
    dialog.hidden = true;
    backdrop.hidden = true;
    activeId = null;
    page = 0;
    memberButtons = [];
    if (shouldRestore) {
      returnTarget?.focus?.();
    }
    activeTrigger = null;
    return true;
  }

  function setClusters(items = [], worlds = []) {
    const nextClusters = new Map((Array.isArray(items) ? items : [])
      .filter(needsPagedClusterPicker).map(cluster => [String(cluster.id), cluster]));
    const nextWorlds = new Map((Array.isArray(worlds) ? worlds : []).filter(world => world?.id != null).map(world => [String(world.id), world]));
    for (const [id, trigger] of triggers) if (!nextClusters.has(id)) {
      if (activeId === id) close({ restoreFocus: true });
      if (tooltipId === id) hideTooltip(id);
      if (document.activeElement === trigger) focusFallback?.focus?.();
      trigger.remove?.(); triggers.delete(id);
    }
    clusters.clear(); for (const [id, cluster] of nextClusters) clusters.set(id, cluster);
    activeWorlds = nextWorlds;
    for (const [id, cluster] of clusters) {
      let trigger = triggers.get(id);
      if (!trigger) {
        trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'atlas-large-cluster-trigger';
        trigger.dataset.clusterId = id;
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-controls', dialog.id);
        trigger.setAttribute('aria-describedby', tooltip.id);
        trigger.setAttribute('aria-expanded', 'false');
        trigger.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') showTooltip(id); });
        trigger.addEventListener('pointerleave', () => { if (document.activeElement !== trigger) hideTooltip(id); });
        trigger.addEventListener('focus', () => { showTooltip(id); });
        trigger.addEventListener('blur', () => { hideTooltip(id); });
        trigger.addEventListener('click', () => open(id, { focus: true }));
        triggerLayer.append(trigger);
        triggers.set(id, trigger);
      }
      trigger.textContent = cluster.label || `${cluster.count || cluster.memberIds.length} possibilities`;
      const parentTitle = activeWorlds.get(String(cluster.parentId))?.title;
      trigger.setAttribute('aria-label', `Browse ${clusterLevelTitle(cluster)} cluster with ${cluster.memberIds.length} saved possibilities${parentTitle ? ` under ${parentTitle}` : ''}`);
    }
    if (activeId && clusters.has(activeId)) {
      const focusedMemberId = memberButtons.find(button => button === document.activeElement)?.dataset.worldId || null;
      const pageLimit = Math.max(0, Math.ceil(clusters.get(activeId).memberIds.length / safePageSize) - 1);
      page = Math.min(page, pageLimit);
      render();
      const disabledPagerFocused = (document.activeElement === previous || document.activeElement === next) && document.activeElement.disabled;
      if (isOpen() && (focusedMemberId || disabledPagerFocused)) {
        const target = memberButtons.find(button => button.dataset.worldId === focusedMemberId) || memberButtons[0];
        target?.focus();
      }
    }
  }

  function setPosition(clusterId, { x, y, visible = true } = {}) {
    const trigger = triggers.get(String(clusterId));
    if (!trigger) return;
    const size = 58;
    const ok = visible && Number.isFinite(Number(x)) && Number.isFinite(Number(y));
    trigger.hidden = !ok;
    if (ok) {
      const bounds = container.getBoundingClientRect?.();
      const width = Math.max(0, Number(bounds?.width) || Number(container.clientWidth) || 0);
      const height = Math.max(0, Number(bounds?.height) || Number(container.clientHeight) || 0);
      const viewport = document.defaultView || globalThis;
      const viewportWidth = Number(viewport.innerWidth);
      const viewportHeight = Number(viewport.innerHeight);
      const left = Number(bounds?.left) || 0;
      const top = Number(bounds?.top) || 0;
      // The trigger layer clips to the scene container, which may itself extend
      // beyond a phone viewport. Clamp to the part both surfaces can display.
      const clampCenter = (value, extent, origin, viewportExtent) => {
        const half = size / 2;
        let min = half, max = extent - half;
        if (Number.isFinite(viewportExtent)) {
          min = Math.max(min, half - origin);
          max = Math.min(max, viewportExtent - half - origin);
        }
        if (max < min) return Math.max(0, Math.min(extent, value));
        return Math.max(min, Math.min(max, value));
      };
      const centerX = clampCenter(Number(x), width, left, viewportWidth);
      const centerY = clampCenter(Number(y), height, top, viewportHeight);
      trigger.style.left = `${centerX - size / 2}px`;
      trigger.style.top = `${centerY - size / 2}px`;
      const tooltipWidth = Math.min(240, Math.max(120, width - 16));
      if (tooltipId === String(clusterId)) {
        tooltip.style.left = `${Math.max(8, Math.min(width - tooltipWidth - 8, centerX - tooltipWidth / 2))}px`;
        tooltip.style.top = `${Math.max(8, Math.min(height - 42, centerY + size / 2 + 6))}px`;
      }
    } else {
      if (tooltipId === String(clusterId)) hideTooltip(clusterId);
      if (activeId === String(clusterId)) close({ restoreFocus: true, returnToFallback: true, forceFocus: true });
      else if (document.activeElement === trigger) focusFallback?.focus?.();
    }
  }

  function hitTestCandidate(x, y) {
    const pointX = Number(x), pointY = Number(y);
    if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) return null;
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const size = 58;
    for (const [id, trigger] of triggers) {
      if (trigger.hidden) continue;
      const left = Number.parseFloat(trigger.style.left);
      const top = Number.parseFloat(trigger.style.top);
      if (!Number.isFinite(left) || !Number.isFinite(top) || pointX < left || pointX > left + size || pointY < top || pointY > top + size) continue;
      const dx = pointX - (left + size / 2), dy = pointY - (top + size / 2);
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        best = { cluster: clusters.get(id) || null, distanceSquared: distance, centerX: left + size / 2, centerY: top + size / 2 };
        bestDistance = distance;
      }
    }
    return best;
  }

  function hitTest(x, y) {
    return hitTestCandidate(x, y)?.cluster || null;
  }

  function onDocumentPointerDown(event) {
    if (!isOpen()) return;
    const target = event.target;
    if (dialog.contains?.(target) || [...triggers.values()].some(trigger => trigger === target || trigger.contains?.(target))) return;
    close({ restoreFocus: true, returnToFallback: true });
  }
  function onDocumentKeyDown(event) {
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault?.(); event.stopPropagation?.();
      close({ restoreFocus: true });
      return;
    }
    if (event.key === 'PageDown' && !next.disabled) { event.preventDefault?.(); page++; render(); memberButtons[0]?.focus(); return; }
    if (event.key === 'PageUp' && !previous.disabled) { event.preventDefault?.(); page--; render(); memberButtons[0]?.focus(); return; }
    if (event.key !== 'Tab' || !isModal()) return;
    const controls = focusables();
    if (!controls.length) return;
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault?.(); last.focus?.(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault?.(); first.focus?.(); }
  }
  function onBackdropClick() { close({ restoreFocus: true, returnToFallback: true }); }
  function onCloseClick() { close({ restoreFocus: true }); }
  function onPreviousClick(event) { if (!previous.disabled) { page--; render(); if (event.detail === 0) memberButtons[0]?.focus(); } }
  function onNextClick(event) { if (!next.disabled) { page++; render(); if (event.detail === 0) memberButtons[0]?.focus(); } }
  closeButton.addEventListener('click', onCloseClick);
  previous.addEventListener('click', onPreviousClick);
  next.addEventListener('click', onNextClick);
  backdrop.addEventListener('click', onBackdropClick);
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onDocumentKeyDown, true);

  return {
    setClusters,
    setPosition,
    open,
    close,
    preview,
    hitTest,
    hitTestCandidate,
    isOpen,
    getTrigger: id => triggers.get(String(id)) || null,
    destroy() {
      close({ restoreFocus: false });
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      backdrop.remove?.(); dialog.remove?.(); triggerLayer.remove?.();
      triggers.clear(); clusters.clear(); activeWorlds.clear();
    },
    elements: { triggerLayer, backdrop, dialog, list, previous, next, closeButton, pageStatus },
  };
}
