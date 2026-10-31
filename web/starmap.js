const SVG_NS = 'http://www.w3.org/2000/svg';

const STYLE = `
.otherwise-starmap{position:relative;isolation:isolate;overflow:hidden;min-height:360px;width:100%;height:100%;color:#eaf2f5;background:radial-gradient(ellipse at 50% 42%,#122b3d 0%,#081522 54%,#050b13 100%);border:1px solid rgba(153,203,226,.18);border-radius:18px;touch-action:auto;outline:none}
.otherwise-starmap:focus-visible{box-shadow:0 0 0 3px #8bd7ff}
.otherwise-starmap svg{display:block;width:100%;height:100%;min-height:360px;cursor:grab;user-select:none;touch-action:none}
.otherwise-starmap svg:active{cursor:grabbing}
.otherwise-starmap .map-grid{fill:none;stroke:#87b4cf;stroke-opacity:.09;stroke-width:1}
.otherwise-starmap .map-edge{fill:none;stroke:#8bcdf0;stroke-opacity:.36;stroke-width:1.5;vector-effect:non-scaling-stroke}
.otherwise-starmap .map-edge.selected{stroke:#ffd78b;stroke-opacity:.8;stroke-width:2.5}
.otherwise-starmap .map-star{cursor:pointer;outline:none}
.otherwise-starmap .map-star:focus .star-core,.otherwise-starmap .map-star:hover .star-core{stroke:#fff;stroke-width:3}
.otherwise-starmap .star-halo{fill:#70caff;fill-opacity:.12}
.otherwise-starmap .star-core{fill:#b8e5ff;stroke:#81cfff;stroke-width:1.5;filter:drop-shadow(0 0 7px #68c8ff)}
.otherwise-starmap .map-star.is-selected .star-core{fill:#ffe3a4;stroke:#fff0c9;filter:drop-shadow(0 0 12px #ffd278)}
.otherwise-starmap .star-label{fill:#e5f0f5;font:600 12px/1.2 system-ui,sans-serif;paint-order:stroke;stroke:#07111c;stroke-width:3px;stroke-linejoin:round;pointer-events:none}
.otherwise-starmap .star-year{fill:#91b6c8;font:10px system-ui,sans-serif;paint-order:stroke;stroke:#07111c;stroke-width:3px;pointer-events:none}
.otherwise-starmap .map-star .star-label,.otherwise-starmap .map-star .star-year{display:none}
.otherwise-starmap .map-star.is-labelled .star-label,.otherwise-starmap .map-star.is-labelled .star-year{display:inline}
.otherwise-starmap .map-star.is-pending{cursor:help}
.otherwise-starmap .map-star.is-pending .star-label{fill:#c6dce6}
.otherwise-starmap .map-star.is-unavailable{cursor:help;opacity:.78}
.otherwise-starmap .map-star.is-unavailable .star-core{fill:#82909b;stroke:#a1afb6;filter:none}
.otherwise-starmap .map-star.is-unavailable .star-halo{fill:#8b9ca5;fill-opacity:.07}
.otherwise-starmap .cloud-particles{pointer-events:none;transform-box:fill-box;transform-origin:center}
.otherwise-starmap .cloud-particle{fill:#88d9ff;opacity:.7;filter:drop-shadow(0 0 5px #58c8ff)}
.otherwise-starmap .cloud-particle:nth-child(3n){fill:#cfb2ff;opacity:.55}
.otherwise-starmap .cloud-particle:nth-child(4n){fill:#ffe3a4;opacity:.55}
.otherwise-starmap .is-pending .cloud-particles{animation:cloud-orbit 13s linear infinite,cloud-breathe 3.8s ease-in-out infinite alternate}
.otherwise-starmap .star-materialize{opacity:1;transform-box:fill-box;transform-origin:center}
.otherwise-starmap .is-coalescing .cloud-particles{animation:cloud-coalesce .82s cubic-bezier(.18,.68,.22,1) forwards}
.otherwise-starmap .is-coalescing .star-materialize{opacity:0;animation:star-materialize .82s cubic-bezier(.16,.72,.2,1) forwards}
.otherwise-starmap .is-coalescing .star-label,.otherwise-starmap .is-coalescing .star-year{animation:label-materialize .82s ease-out forwards}
@keyframes cloud-orbit{to{transform:rotate(360deg)}}
@keyframes cloud-breathe{from{opacity:.72}to{opacity:1}}
@keyframes cloud-coalesce{0%{opacity:1;transform:scale(1) rotate(0)}100%{opacity:0;transform:scale(.08) rotate(190deg)}}
@keyframes star-materialize{0%{opacity:0;transform:scale(.08)}65%{opacity:1;transform:scale(1.35)}100%{opacity:1;transform:scale(1)}}
@keyframes label-materialize{from{opacity:.1}to{opacity:1}}
.otherwise-starmap .map-popup{position:absolute;z-index:2;display:grid;grid-template-columns:minmax(0,1fr);grid-template-areas:"scene" "copy" "summary" "context";gap:9px;box-sizing:border-box;width:min(410px,calc(100% - 16px));max-height:min(340px,calc(100% - 16px));overflow:auto;overscroll-behavior:contain;touch-action:none;padding:14px;border:1px solid rgba(173,220,242,.42);border-radius:16px;background:linear-gradient(145deg,rgba(12,30,44,.97),rgba(4,12,21,.97));box-shadow:0 18px 48px #000b,0 0 28px #51b9e622;pointer-events:auto;backdrop-filter:blur(12px)}
.otherwise-starmap .map-popup[hidden]{display:none}
.otherwise-starmap .map-popup img[hidden]{display:none}
.otherwise-starmap .map-popup-copy{grid-area:copy;align-self:center;min-width:0}
.otherwise-starmap .map-popup img{grid-area:scene;display:block;width:100%;height:auto;max-height:190px;aspect-ratio:16/9;object-fit:cover;border-radius:10px;background:#132838;box-shadow:0 5px 18px #0007}
.otherwise-starmap .map-popup-title{margin:0;color:#f2f7f8;font:700 17px/1.25 system-ui,sans-serif;overflow-wrap:anywhere}
.otherwise-starmap .map-popup-meta{margin:6px 0 0;color:#b8d2df;font:12px/1.4 system-ui,sans-serif}
.otherwise-starmap .map-popup-summary,.otherwise-starmap .map-popup-context{grid-area:summary;margin:0;color:#e0edf2;font:13px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}
.otherwise-starmap .map-popup-context{grid-area:context;padding-top:8px;border-top:1px solid rgba(173,220,242,.15);color:#adc8d6;font-size:12px}
.otherwise-starmap .map-popup-context:empty,.otherwise-starmap .map-popup-summary:empty{display:none}
.otherwise-starmap .map-help{position:absolute;right:12px;bottom:10px;margin:0;color:#9bb7c6;font:11px/1.3 system-ui,sans-serif;pointer-events:none}
.otherwise-starmap .map-time-key{position:absolute;left:12px;top:10px;max-width:calc(100% - 24px);margin:0;padding:5px 8px;border:1px solid rgba(139,205,240,.24);border-radius:8px;background:rgba(5,14,23,.78);color:#c5e6f5;font:600 10px/1.3 system-ui,sans-serif;letter-spacing:.04em;pointer-events:none;backdrop-filter:blur(5px)}
.otherwise-starmap .map-view-controls{position:absolute;top:10px;right:12px;display:flex;gap:6px;z-index:1}
.otherwise-starmap .map-view-controls button{padding:5px 8px;border:1px solid rgba(139,205,240,.32);border-radius:7px;background:rgba(5,14,23,.88);color:#c5e6f5;font:600 10px/1.2 system-ui,sans-serif;cursor:pointer}
.otherwise-starmap .map-view-controls button:hover,.otherwise-starmap .map-view-controls button:focus-visible{border-color:#8bd7ff;color:#fff;outline:none}
.otherwise-starmap .map-view-controls button:disabled{opacity:.45;cursor:not-allowed}
.otherwise-starmap .time-axis-line{fill:none;stroke:#8bcdf0;stroke-opacity:.62;stroke-width:1.5;vector-effect:non-scaling-stroke}
.otherwise-starmap .time-axis-tick{stroke:#a9dff7;stroke-opacity:.72;stroke-width:1;vector-effect:non-scaling-stroke}
.otherwise-starmap .time-axis-label{fill:#b8d8e7;font:10px system-ui,sans-serif;paint-order:stroke;stroke:#07111c;stroke-width:3px;pointer-events:none}
.otherwise-starmap .time-axis-title{fill:#d6eff9;font:600 10px system-ui,sans-serif;letter-spacing:.06em;paint-order:stroke;stroke:#07111c;stroke-width:3px;pointer-events:none}
.otherwise-starmap .map-sr-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:520px){.otherwise-starmap{min-height:320px;border-radius:12px}.otherwise-starmap svg{min-height:320px}.otherwise-starmap .star-label{font-size:11px}.otherwise-starmap .map-time-key{top:48px;left:8px;font-size:9px}.otherwise-starmap .map-view-controls{top:8px;right:8px}.otherwise-starmap .map-popup{gap:7px;padding:11px;border-radius:13px;max-height:min(300px,calc(100% - 16px))}.otherwise-starmap .map-popup img{max-height:165px}.otherwise-starmap .map-popup-title{font-size:15px}.otherwise-starmap .map-popup-summary{font-size:12px;line-height:1.4}}
@media(prefers-reduced-motion:reduce){.otherwise-starmap *{scroll-behavior:auto!important;animation:none!important;transition:none!important}.otherwise-starmap .cloud-particles{opacity:.72}.otherwise-starmap .is-coalescing .cloud-particles{opacity:0}.otherwise-starmap .is-coalescing .star-materialize{opacity:1}}
`;

function ensureStyle(doc) {
  if (doc.getElementById('otherwise-starmap-style')) return;
  const style = doc.createElement('style');
  style.id = 'otherwise-starmap-style';
  style.textContent = STYLE;
  doc.head.append(style);
}

function svgElement(doc, tag, attrs = {}) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function safeTitle(node) { return String(node?.title || 'Untitled event'); }
function formatStarMapLocation(value, seen = new Set()) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) {
    if (seen.has(value)) return '';
    const next = new Set(seen); next.add(value);
    return value.map(item => formatStarMapLocation(item, next)).filter(Boolean).join(', ');
  }
  if (!value || typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  const next = new Set(seen); next.add(value);
  for (const key of ['name', 'label', 'title', 'place']) {
    const label = formatStarMapLocation(value[key], next);
    if (label) return label;
  }
  return ['city', 'region', 'country'].map(key => formatStarMapLocation(value[key], next)).filter(Boolean).join(', ');
}
function sceneSource(node) {
  const scene = node?.scene;
  if (typeof scene === 'string') return scene;
  if (scene && typeof scene === 'object') return scene.url || scene.src || scene.imageUrl || node?.thumbnail || '';
  return node?.thumbnail || '';
}
/** Signed historical years use negative values for BCE; year zero is not valid. */
export function parseStarMapYear(value) {
  let year = value;
  if (typeof year === 'string') {
    const text = year.trim();
    const era = /^(\d+)\s*(BCE|BC|CE|AD)$/i.exec(text);
    if (era) {
      const magnitude = Number(era[1]);
      if (!Number.isSafeInteger(magnitude) || magnitude === 0) return null;
      return /^(BCE|BC)$/i.test(era[2]) ? -magnitude : magnitude;
    }
    if (!/^[+-]?\d+$/.test(text)) return null;
    year = Number(text);
  }
  return Number.isSafeInteger(year) && year !== 0 ? year : null;
}

export function formatStarMapYear(value) {
  const year = parseStarMapYear(value);
  if (year == null) return 'Undated';
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}

/** Convert signed historical year to astronomical coordinate (1 BCE=0, 1 CE=1). */
export function astronomicalYear(value) {
  const year = parseStarMapYear(value);
  return year == null ? null : year < 0 ? year + 1 : year;
}

function formatAstronomicalYear(value) {
  const coordinate = Math.round(value);
  return formatStarMapYear(coordinate <= 0 ? coordinate - 1 : coordinate);
}

const TARGET_TIME_SPAN = 48;
const SINGLE_YEAR_SCALE = 0.01;
const LANE_SPACING = 3.2;
function stableNodeOrder(a, b) {
  const branchA = String(a.branchId ?? '');
  const branchB = String(b.branchId ?? '');
  return branchA.localeCompare(branchB) || a.id.localeCompare(b.id);
}

export function getStarMapNodeState(node) {
  const status = String(node?.status || '').toLowerCase();
  if (typeof node?.ready === 'boolean') {
    if (node.ready) return 'ready';
    return /pending|prepar|loading|generating|queued|processing|in.progress|running/i.test(status) ? 'preparing' : 'unavailable';
  }
  if (/pending|prepar|loading|generating|queued|processing|in.progress|running/i.test(status)) return 'preparing';
  if (/unavailable|missing|fail|error|not ready|absent/i.test(status)) return 'unavailable';
  return 'ready';
}
function nodeState(node) { return getStarMapNodeState(node); }
function isNodeReady(node) { return nodeState(node) === 'ready'; }
function nodeStatusLabel(node) {
  const state = nodeState(node);
  if (state === 'ready') return node?.status || 'Scene ready';
  if (state === 'preparing') return node?.status || 'Preparing scene';
  return node?.status || 'Scene unavailable';
}

function addCloudParticles(doc, group, radius) {
  const particles = svgElement(doc, 'g', { class: 'cloud-particles', 'aria-hidden': 'true' });
  for (let i = 0; i < 22; i++) {
    const angle = (Math.PI * 2 * i) / 22;
    const spread = radius * (0.34 + ((i * 17) % 13) / 20);
    const x = Math.cos(angle) * spread;
    const y = Math.sin(angle) * spread * 0.72;
    const particleRadius = 1.2 + ((i * 7) % 9) / 6;
    particles.append(svgElement(doc, 'circle', { class: 'cloud-particle', cx: x, cy: y, r: particleRadius }));
  }
  group.append(particles);
}

/** Deterministic chronological layout in world-space. Branch subtrees occupy ordered lanes. */
export function layoutStarMap(nodes = []) {
  const items = Array.isArray(nodes) ? nodes.filter(n => n && n.id != null).map(n => ({ ...n, id: String(n.id) })) : [];
  const byId = new Map(items.map(node => [node.id, node]));
  const depthMemo = new Map();
  function depthOf(node, visiting = new Set()) {
    if (depthMemo.has(node.id)) return depthMemo.get(node.id);
    if (!node.parentId || !byId.has(String(node.parentId)) || visiting.has(node.id)) { depthMemo.set(node.id, 0); return 0; }
    const next = new Set(visiting); next.add(node.id);
    const depth = 1 + depthOf(byId.get(String(node.parentId)), next);
    depthMemo.set(node.id, depth);
    return depth;
  }
  const children = new Map();
  const roots = [];
  for (const node of items) {
    const parentId = String(node.parentId ?? '');
    const parent = byId.get(parentId);
    // Break cyclic/backward references in a deterministic direction so each node gets one lane.
    const validParent = parent && parent.id !== node.id && depthOf(parent) < depthOf(node);
    if (validParent) {
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(node);
    } else roots.push(node);
  }
  for (const siblings of children.values()) siblings.sort(stableNodeOrder);
  roots.sort(stableNodeOrder);

  const countMemo = new Map();
  function leafCount(node, visiting = new Set()) {
    if (countMemo.has(node.id)) return countMemo.get(node.id);
    if (visiting.has(node.id)) return 1;
    const descendants = children.get(node.id) || [];
    const next = new Set(visiting); next.add(node.id);
    const count = descendants.length ? descendants.reduce((sum, child) => sum + leafCount(child, next), 0) : 1;
    countMemo.set(node.id, count);
    return count;
  }
  const dated = items.map(node => ({ node, year: astronomicalYear(node.year) })).filter(item => item.year != null);
  const minYear = dated.length ? Math.min(...dated.map(item => item.year)) : null;
  const maxYear = dated.length ? Math.max(...dated.map(item => item.year)) : null;
  const timeScale = minYear == null ? SINGLE_YEAR_SCALE : (maxYear > minYear ? TARGET_TIME_SPAN / (maxYear - minYear) : SINGLE_YEAR_SCALE);
  const maxX = maxYear == null ? 0 : maxYear * timeScale;
  const undatedOffset = minYear == null ? 6 : Math.max(5, (maxYear - minYear) * timeScale * 0.08);
  const datedX = year => year == null ? null : year * timeScale;
  const result = new Map();
  function place(node, startLane, parentZ) {
    const count = leafCount(node);
    const lane = startLane + (count - 1) / 2;
    const nodeYear = astronomicalYear(node.year);
    const nodeX = datedX(nodeYear);
    const nodeZ = parentZ;
    result.set(node.id, {
      ...node, depth: depthOf(node), yearCoordinate: nodeYear, timeScale,
      yearLabel: formatStarMapYear(node.year), undated: nodeYear == null,
      // Undated nodes use a dedicated rail beyond the dated extent, never a fake year-zero point.
      x: nodeX == null ? maxX + undatedOffset : nodeX,
      y: lane * LANE_SPACING, z: nodeZ,
    });
    const descendants = children.get(node.id) || [];
    let cursor = startLane;
    descendants.forEach((child, index) => {
      const childCount = leafCount(child);
      const childZ = nodeZ + (descendants.length > 1 ? (index - (descendants.length - 1) / 2) * LANE_SPACING : 0);
      place(child, cursor, childZ);
      cursor += childCount;
    });
  }
  let cursor = 0;
  roots.forEach(node => { const count = leafCount(node); place(node, cursor, 0); cursor += count; });
  return [...result.values()];
}

/** Perspective-project world coordinates for an orbit camera looking at the origin. */
export function projectStarMap(nodes = [], { yaw = 0, pitch = 0.22, distance = 44, width = 900, height = 540, focalLength = 820 } = {}) {
  const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
  const cx = width / 2, cy = height / 2;
  return nodes.map(node => {
    const x = node.x ?? 0, y = node.y ?? 0, z = node.z ?? 0;
    const rotatedX = cosYaw * x + sinYaw * z;
    const yawZ = -sinYaw * x + cosYaw * z;
    const rotatedY = cosPitch * y - sinPitch * yawZ;
    const cameraZ = sinPitch * y + cosPitch * yawZ;
    const viewDepth = Math.max(1, distance - cameraZ);
    const perspective = focalLength / viewDepth;
    return { ...node, screenX: cx + rotatedX * perspective, screenY: cy - rotatedY * perspective, cameraZ, perspective };
  });
}

/**
 * Create an independent, responsive branching-event star map.
 * Contract: createStarMap(container, { nodes, selectedId, onSelect }) returns
 * setData({nodes, selectedId}), select(id), and destroy(). Nodes are flattened
 * records {id,runId,branchId,title,year,status,thumbnail,scene,summary,causalLink,location,place,parentId,ready}.
 * `ready` is true when the event's own scene is ready; consequence status is
 * separate in `consequencesStatus`. Preparing scenes animate, unavailable
 * scenes remain still, and only a ready scene can be selected.
 */
export function createStarMap(container, { nodes = [], selectedId = null, onSelect = () => {} } = {}) {
  if (!container?.ownerDocument) throw new TypeError('createStarMap needs a DOM container');
  const doc = container.ownerDocument;
  ensureStyle(doc);
  const root = doc.createElement('div');
  root.className = 'otherwise-starmap';
  root.tabIndex = 0;
  root.setAttribute('role', 'application');
  root.setAttribute('aria-label', 'Interactive 3D branching event star map. Left-drag to orbit; right-drag or Shift-drag to pan. Use the wheel or plus and minus to zoom.');
  root.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight + - Home');
  const svg = svgElement(doc, 'svg', { viewBox: '0 0 900 540', preserveAspectRatio: 'xMidYMid meet', 'aria-label': 'Branching event map', role: 'group' });
  const defs = svgElement(doc, 'defs');
  const starfield = svgElement(doc, 'g', { 'aria-hidden': 'true', opacity: '.72' });
  let seed = 20261030;
  for (let i = 0; i < 150; i++) {
    seed = (seed * 48271) % 2147483647;
    const x = seed % 900;
    seed = (seed * 48271) % 2147483647;
    const y = seed % 540;
    const radius = i % 17 === 0 ? 1.35 : 0.55 + (i % 4) * 0.16;
    starfield.append(svgElement(doc, 'circle', { cx: x, cy: y, r: radius, fill: i % 9 === 0 ? '#b4e4ff' : '#8caebe', opacity: 0.22 + (i % 6) * 0.1 }));
  }
  const grid = svgElement(doc, 'g', { class: 'map-grid' });
  for (let i = 0; i <= 9; i++) grid.append(svgElement(doc, 'path', { d: `M${i * 100} 0V540` }));
  for (let i = 0; i <= 5; i++) grid.append(svgElement(doc, 'path', { d: `M0 ${i * 100}H900` }));
  const graph = svgElement(doc, 'g', { class: 'map-viewport' });
  const timeAxis = svgElement(doc, 'g', { class: 'time-axis', 'aria-hidden': 'true' });
  const edges = svgElement(doc, 'g', { 'aria-hidden': 'true' });
  const stars = svgElement(doc, 'g');
  graph.append(timeAxis, edges, stars); svg.append(defs, starfield, grid, graph);
  const popup = doc.createElement('div'); popup.className = 'map-popup'; popup.hidden = true; popup.setAttribute('aria-hidden', 'true'); popup.setAttribute('role', 'region'); popup.setAttribute('aria-label', 'Event details'); popup.tabIndex = 0;
  const image = doc.createElement('img'); image.alt = ''; image.hidden = true;
  const popupCopy = doc.createElement('div'); popupCopy.className = 'map-popup-copy';
  const popupTitle = doc.createElement('p'); popupTitle.className = 'map-popup-title';
  const popupMeta = doc.createElement('p'); popupMeta.className = 'map-popup-meta';
  const popupSummary = doc.createElement('p'); popupSummary.className = 'map-popup-summary';
  const popupContext = doc.createElement('p'); popupContext.className = 'map-popup-context';
  popupCopy.append(popupTitle, popupMeta); popup.append(popupCopy, image, popupSummary, popupContext);
  const help = doc.createElement('p'); help.className = 'map-help'; help.textContent = 'Left-drag to orbit · Right-drag or Shift-drag to pan · Scroll to zoom · Enter to select · Home to reset';
  const timeKey = doc.createElement('p'); timeKey.className = 'map-time-key'; timeKey.textContent = 'TIME AXIS · OLDER → LATER · BCE → CE · UNDATED EVENTS OFF AXIS';
  const viewControls = doc.createElement('div'); viewControls.className = 'map-view-controls';
  const focusButton = doc.createElement('button'); focusButton.type = 'button'; focusButton.textContent = 'Focus selected era'; focusButton.setAttribute('aria-label', 'Focus the selected event era');
  const overviewButton = doc.createElement('button'); overviewButton.type = 'button'; overviewButton.textContent = 'Overview'; overviewButton.setAttribute('aria-label', 'Reset the star map to the full timeline overview');
  viewControls.append(focusButton, overviewButton);
  const liveStatus = doc.createElement('div'); liveStatus.className = 'map-sr-status'; liveStatus.setAttribute('role', 'status'); liveStatus.setAttribute('aria-live', 'polite'); liveStatus.setAttribute('aria-atomic', 'true');
  root.append(svg, popup, timeKey, viewControls, help, liveStatus); container.replaceChildren(root);

  let currentNodes = nodes, currentSelected = selectedId == null ? null : String(selectedId);
  let positioned = [], records = new Map(), yaw = -0.14, pitch = 0.22, zoom = 1, panX = 0, panY = 0, pointer = null, hoverId = null, focusedNodeId = null;
  let viewMode = 'overview', focusAnchorYear = null, userInteracted = false, autoFocusConsumed = false;
  const coalescingIds = new Set();
  const coalescingTimers = new Map();
  let destroyed = false;
  let activePopupNode = null;
  let popupHovered = false, popupFocused = false, popupDismissTimer = null;
  let popupTouchScroll = null;

  function focusSelectedEra() {
    const selected = currentNodes.find(node => String(node.id) === String(currentSelected));
    const year = astronomicalYear(selected?.year);
    if (year == null) return;
    userInteracted = true; autoFocusConsumed = true;
    viewMode = 'focus'; focusAnchorYear = year; zoom = 1; panX = 0; panY = 0;
    render();
  }
  function showOverview() {
    userInteracted = true; autoFocusConsumed = true;
    viewMode = 'overview'; focusAnchorYear = null; zoom = 1; panX = 0; panY = 0; yaw = -0.14; pitch = 0.22;
    render();
  }
  function selectNode(node, notify = true) {
    if (!node || !isNodeReady(node)) return;
    userInteracted = true; autoFocusConsumed = true;
    currentSelected = String(node.id);
    if (viewMode === 'focus') focusAnchorYear = astronomicalYear(node.year);
    render();
    stars.querySelector(`[data-node-id="${CSS.escape(String(node.id))}"]`)?.focus();
    if (notify) onSelect(node);
  }
  focusButton.addEventListener('click', focusSelectedEra);
  overviewButton.addEventListener('click', showOverview);

  function autoFocusSelectedIfWide() {
    if (autoFocusConsumed || userInteracted || !currentSelected || !Array.isArray(currentNodes)) return false;
    const selected = currentNodes.find(node => String(node.id) === currentSelected);
    const selectedYear = astronomicalYear(selected?.year);
    if (selectedYear == null) return false;
    const dates = layoutStarMap(currentNodes).map(node => node.yearCoordinate).filter(Number.isFinite);
    if (dates.length < 2 || Math.max(...dates) - Math.min(...dates) <= 2000) return false;
    viewMode = 'focus'; focusAnchorYear = selectedYear; autoFocusConsumed = true;
    return true;
  }

  function showPopup(node) {
    activePopupNode = node || null;
    if (!node) { popup.hidden = true; return; }
    popupTitle.textContent = safeTitle(node);
    const year = formatStarMapYear(node.year);
    const status = nodeStatusLabel(node);
    const location = formatStarMapLocation(node.location) || formatStarMapLocation(node.place);
    popupMeta.textContent = [year, location, status, node.consequencesStatus ? `Consequences: ${node.consequencesStatus}` : ''].filter(Boolean).join(' · ');
    popupSummary.textContent = String(node.summary || '');
    const context = [node.causalLink ? `Speculative cause: ${node.causalLink}` : '', node.consequencesStatus ? `Consequences: ${node.consequencesStatus}` : ''].filter(Boolean).join(' · ');
    popupContext.textContent = context;
    const source = sceneSource(node);
    image.hidden = !source;
    if (source) image.src = String(source); else image.removeAttribute('src');
    popup.hidden = false;
    const bounds = root.getBoundingClientRect();
    const matrix = graph.getScreenCTM?.();
    if (!(bounds.width > 0 && bounds.height > 0)) return;
    let starX = bounds.width / 2, starY = bounds.height / 2;
    if (matrix && Number.isFinite(matrix.a) && Math.abs(matrix.a) > 0.0001 && svg.createSVGPoint && Number.isFinite(node.screenX) && Number.isFinite(node.screenY)) {
      const point = svg.createSVGPoint(); point.x = node.screenX; point.y = node.screenY;
      const screen = point.matrixTransform(matrix);
      starX = screen.x - bounds.left; starY = screen.y - bounds.top;
    }
    const popupWidth = Math.min(bounds.width - 16, popup.offsetWidth || Math.min(410, bounds.width - 16));
    const popupHeight = Math.min(bounds.height - 16, popup.offsetHeight || 210);
    const gap = 18;
    const clampX = x => Math.max(8, Math.min(bounds.width - popupWidth - 8, x));
    const clampY = y => Math.max(8, Math.min(bounds.height - popupHeight - 8, y));
    const candidates = [
      { x: starX + gap, y: starY - popupHeight - gap },
      { x: starX - popupWidth - gap, y: starY - popupHeight - gap },
      { x: starX + gap, y: starY + gap },
      { x: starX - popupWidth - gap, y: starY + gap },
    ].map(({ x, y }) => ({ x: clampX(x), y: clampY(y) }));
    const controls = [...root.querySelectorAll('.map-view-controls, .map-time-key, .map-help')].map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left - bounds.left, right: rect.right - bounds.left, top: rect.top - bounds.top, bottom: rect.bottom - bounds.top };
    });
    const otherStars = positioned.filter(item => item.id !== node.id).map(item => {
      if (matrix && svg.createSVGPoint && Number.isFinite(item.screenX) && Number.isFinite(item.screenY)) {
        const point = svg.createSVGPoint(); point.x = item.screenX; point.y = item.screenY;
        const screen = point.matrixTransform(matrix);
        return { x: screen.x - bounds.left, y: screen.y - bounds.top };
      }
      return { x: bounds.width / 2, y: bounds.height / 2 };
    });
    const score = candidate => {
      const overlap = controls.reduce((sum, rect) => {
        const width = Math.max(0, Math.min(candidate.x + popupWidth, rect.right) - Math.max(candidate.x, rect.left));
        const height = Math.max(0, Math.min(candidate.y + popupHeight, rect.bottom) - Math.max(candidate.y, rect.top));
        return sum + width * height;
      }, 0);
      const starOverlap = otherStars.reduce((sum, point) => point.x >= candidate.x - 12 && point.x <= candidate.x + popupWidth + 12 && point.y >= candidate.y - 12 && point.y <= candidate.y + popupHeight + 12 ? sum + 1 : sum, 0);
      const nearestX = Math.max(candidate.x, Math.min(starX, candidate.x + popupWidth));
      const nearestY = Math.max(candidate.y, Math.min(starY, candidate.y + popupHeight));
      return overlap * 1000 + starOverlap * 500 - Math.hypot(nearestX - starX, nearestY - starY);
    };
    const safest = candidates.sort((a, b) => score(b) - score(a))[0];
    popup.style.left = `${safest.x}px`;
    popup.style.top = `${safest.y}px`;
  }
  function clearPopupDismiss() {
    if (popupDismissTimer != null) clearTimeout(popupDismissTimer);
    popupDismissTimer = null;
  }
  function dismissHoverPreview(nodeId) {
    clearPopupDismiss();
    if (popupHovered || popupFocused) return;
    if (nodeId != null && hoverId === String(nodeId)) hoverId = null;
    for (const star of stars.querySelectorAll('.map-star')) {
      if (star.dataset.nodeId !== currentSelected && star.dataset.nodeId !== focusedNodeId && star.dataset.nodeId !== hoverId && doc.activeElement !== star) star.classList.remove('is-labelled');
    }
    const fallbackId = hoverId || focusedNodeId || currentSelected;
    showPopup(fallbackId ? records.get(fallbackId) : null);
  }
  function schedulePopupDismiss(nodeId, delay = 240) {
    clearPopupDismiss();
    popupDismissTimer = setTimeout(() => dismissHoverPreview(nodeId), delay);
  }
  popup.addEventListener('pointerenter', () => { popupHovered = true; clearPopupDismiss(); });
  popup.addEventListener('pointerleave', () => { popupHovered = false; if (!popupFocused) schedulePopupDismiss(hoverId); });
  popup.addEventListener('focus', () => { popupFocused = true; clearPopupDismiss(); });
  popup.addEventListener('blur', () => { popupFocused = false; if (!popupHovered) schedulePopupDismiss(hoverId, 0); });
  // Manual touch scrolling also works when a surrounding canvas sets touch-action:none.
  popup.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    popupTouchScroll = { id: event.pointerId, y: event.clientY, scrollTop: popup.scrollTop || 0 };
    popup.setPointerCapture?.(event.pointerId);
  });
  popup.addEventListener('pointermove', event => {
    if (!popupTouchScroll || popupTouchScroll.id !== event.pointerId) return;
    popup.scrollTop = popupTouchScroll.scrollTop + popupTouchScroll.y - event.clientY;
    event.preventDefault();
  });
  const stopPopupTouchScroll = event => { if (!popupTouchScroll || event?.pointerId == null || popupTouchScroll.id === event.pointerId) popupTouchScroll = null; };
  popup.addEventListener('pointerup', stopPopupTouchScroll);
  popup.addEventListener('pointercancel', stopPopupTouchScroll);
  function render() {
    const world = layoutStarMap(Array.isArray(currentNodes) ? currentNodes : []);
    const worldById = new Map(world.map(node => [node.id, node]));
    if (currentSelected && !worldById.has(currentSelected)) currentSelected = null;
    const selectedWorld = worldById.get(currentSelected);
    const focusHalfYears = Math.max(100, Math.min(250, (Math.max(...world.map(node => node.yearCoordinate).filter(Number.isFinite)) - Math.min(...world.map(node => node.yearCoordinate).filter(Number.isFinite))) / 64));
    const viewWorld = viewMode === 'focus' && focusAnchorYear != null
      ? world.filter(node => node.yearCoordinate != null && Math.abs(node.yearCoordinate - focusAnchorYear) <= focusHalfYears)
      : world;
    const min = axis => viewWorld.length ? Math.min(...viewWorld.map(node => node[axis] ?? 0)) : 0;
    const max = axis => viewWorld.length ? Math.max(...viewWorld.map(node => node[axis] ?? 0)) : 0;
    const minX = viewWorld.length ? Math.min(...viewWorld.map(node => node.x)) : 0;
    const maxX = viewWorld.length ? Math.max(...viewWorld.map(node => node.x)) : 0;
    const visibleYears = viewWorld.map(node => node.yearCoordinate).filter(Number.isFinite);
    const minYear = Math.min(...visibleYears);
    const maxYear = Math.max(...visibleYears);
    const hasDated = Number.isFinite(minYear) && Number.isFinite(maxYear);
    const scale = world.find(node => node.timeScale)?.timeScale || SINGLE_YEAR_SCALE;
    const focusWindowStart = formatAstronomicalYear(Math.floor((focusAnchorYear ?? 0) - focusHalfYears));
    const focusWindowEnd = formatAstronomicalYear(Math.ceil((focusAnchorYear ?? 0) + focusHalfYears));
    const minY = min('y'), maxY = max('y'), minZ = min('z'), maxZ = max('z');
    const extentY = maxY - minY, extentZ = maxZ - minZ;
    const focusHalfWorld = focusHalfYears * scale;
    const focusAxisMultiplier = viewMode === 'focus' && focusAnchorYear != null
      ? Math.max(1, ((extentY + 3.2) * 1.5) / Math.max(focusHalfWorld * 2, 0.01))
      : 1;
    const focusCenterX = (focusAnchorYear ?? 0) * scale;
    const displayX = x => viewMode === 'focus' ? focusCenterX + (x - focusCenterX) * focusAxisMultiplier : x;
    timeKey.textContent = viewMode === 'focus' && focusAnchorYear != null
      ? `CALENDAR YEAR · FOCUS ${focusWindowStart}–${focusWindowEnd} · LOCAL SCALE ×${Math.round(focusAxisMultiplier)} · OTHER EVENTS HIDDEN`
      : hasDated ? 'CALENDAR YEAR · OLDER → LATER · BCE → CE · UNDATED EVENTS OFF AXIS' : 'NO DATED EVENTS · UNDATED EVENTS SHOWN OFF AXIS';
    focusButton.disabled = !selectedWorld || selectedWorld.yearCoordinate == null;
    focusButton.setAttribute('aria-pressed', String(viewMode === 'focus'));
    overviewButton.setAttribute('aria-pressed', String(viewMode === 'overview'));
    const axisY = minY - 3.2;
    const center = {
      x: viewMode === 'focus' ? focusCenterX : (minX + maxX) / 2,
      y: (axisY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    };
    const extentX = viewMode === 'focus' ? focusHalfWorld * 2 * focusAxisMultiplier : maxX - minX;
    const baseDistance = Math.max(extentX * 1.25, (extentY + 3.2) * 1.9, extentZ * 2.4, 24);
    const camera = { yaw, pitch, distance: baseDistance / zoom };
    positioned = projectStarMap(viewWorld.map(node => ({ ...node, x: displayX(node.x) - center.x, y: node.y - center.y, z: node.z - center.z })), {
      ...camera,
    }).map(node => ({ ...node, screenX: node.screenX + panX, screenY: node.screenY + panY }));
    const byId = new Map(positioned.map(n => [n.id, n]));
    records = byId;
    timeAxis.replaceChildren(); edges.replaceChildren(); stars.replaceChildren();
    svg.setAttribute('viewBox', '0 0 900 540');
    const projectPoint = (x, y, z) => projectStarMap([{ x, y, z }], camera)[0];
    if (hasDated) {
      let axisStart = minYear * scale, axisEnd = maxYear * scale;
      if (axisStart === axisEnd) { axisStart -= 2; axisEnd += 2; }
      const start = projectPoint(displayX(axisStart) - center.x, axisY - center.y, 0);
      const end = projectPoint(displayX(axisEnd) - center.x, axisY - center.y, 0);
      const axisDx = end.screenX - start.screenX, axisDy = end.screenY - start.screenY;
      const axisLength = Math.max(0.0001, Math.hypot(axisDx, axisDy));
      let normalX = -axisDy / axisLength, normalY = axisDx / axisLength;
      if (normalY < 0 || (Math.abs(normalY) < 0.0001 && normalX < 0)) { normalX *= -1; normalY *= -1; }
      const axisStartX = start.screenX + panX, axisStartY = start.screenY + panY;
      const axisEndX = end.screenX + panX, axisEndY = end.screenY + panY;
      const unitX = axisDx / axisLength, unitY = axisDy / axisLength;
      const arrowBaseX = axisEndX - unitX * 8, arrowBaseY = axisEndY - unitY * 8;
      const axisPath = svgElement(doc, 'path', { class: 'time-axis-line', d: `M${axisStartX} ${axisStartY}L${axisEndX} ${axisEndY}M${arrowBaseX - normalX * 4} ${arrowBaseY - normalY * 4}L${axisEndX} ${axisEndY}L${arrowBaseX + normalX * 4} ${arrowBaseY + normalY * 4}` });
      timeAxis.append(axisPath);
      const span = maxYear - minYear;
      const rawStep = span > 0 ? span / 5 : 1;
      const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1)));
      const normalized = rawStep / magnitude;
      const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
      const firstTick = Math.ceil(minYear / step) * step;
      for (let tick = firstTick, guard = 0; tick <= maxYear && guard < 7; tick += step, guard++) {
        const at = projectPoint(displayX(tick * scale) - center.x, axisY - center.y, 0);
        const sx = at.screenX + panX, sy = at.screenY + panY;
        timeAxis.append(svgElement(doc, 'path', { class: 'time-axis-tick', d: `M${sx - normalX * 4} ${sy - normalY * 4}L${sx + normalX * 4} ${sy + normalY * 4}` }));
        if (tick > minYear + step * 0.2 && tick < maxYear - step * 0.2) {
          const historicalYear = tick <= 0 ? tick - 1 : tick;
          const label = svgElement(doc, 'text', { class: 'time-axis-label', x: sx + normalX * 8, y: sy + normalY * 15, 'text-anchor': normalX < -0.2 ? 'end' : 'start' });
          label.textContent = formatStarMapYear(historicalYear);
          timeAxis.append(label);
        }
      }
      if (minYear === maxYear) {
        const yearLabelPoint = projectPoint(displayX(minYear * scale) - center.x, axisY - center.y, 0);
        const label = svgElement(doc, 'text', { class: 'time-axis-label', x: yearLabelPoint.screenX + panX + normalX * 8, y: yearLabelPoint.screenY + panY + normalY * 15, 'text-anchor': normalX < -0.2 ? 'end' : 'start' });
        label.textContent = formatStarMapYear(minYear <= 0 ? minYear - 1 : minYear);
        timeAxis.append(label);
      } else {
        const startLabel = svgElement(doc, 'text', { class: 'time-axis-label', x: start.screenX + panX + normalX * 8, y: start.screenY + panY + normalY * 15, 'text-anchor': normalX < -0.2 ? 'end' : 'start' });
        const endLabel = svgElement(doc, 'text', { class: 'time-axis-label', x: end.screenX + panX + normalX * 8, y: end.screenY + panY + normalY * 15, 'text-anchor': normalX < -0.2 ? 'end' : 'start' });
        startLabel.textContent = formatStarMapYear(minYear <= 0 ? minYear - 1 : minYear);
        endLabel.textContent = formatStarMapYear(maxYear <= 0 ? maxYear - 1 : maxYear);
        timeAxis.append(startLabel, endLabel);
      }
      const direction = svgElement(doc, 'text', { class: 'time-axis-title', x: (start.screenX + end.screenX) / 2 + panX + normalX * 20, y: (start.screenY + end.screenY) / 2 + panY + normalY * 20, 'text-anchor': 'middle' });
      direction.textContent = 'CALENDAR YEAR';
      timeAxis.append(direction);
    }
    const selectedPathIds = new Set();
    let pathNode = byId.get(currentSelected);
    while (pathNode && !selectedPathIds.has(pathNode.id)) {
      selectedPathIds.add(pathNode.id);
      pathNode = byId.get(String(pathNode.parentId ?? ''));
    }
    const depthOrder = [...positioned].sort((a, b) => a.cameraZ - b.cameraZ || a.id.localeCompare(b.id));
    for (const node of depthOrder) {
      const parent = byId.get(String(node.parentId ?? ''));
      if (parent) {
        const selected = selectedPathIds.has(node.id) && selectedPathIds.has(parent.id);
        const steps = 16, points = [];
        const deltaX = node.x - parent.x;
        const controlA = { x: parent.x + deltaX / 3, y: parent.y, z: parent.z };
        const controlB = { x: parent.x + deltaX * 2 / 3, y: node.y, z: node.z };
        for (let i = 0; i <= steps; i++) {
          const t = i / steps, u = 1 - t;
          const x = u ** 3 * parent.x + 3 * u ** 2 * t * controlA.x + 3 * u * t ** 2 * controlB.x + t ** 3 * node.x;
          const y = u ** 3 * parent.y + 3 * u ** 2 * t * controlA.y + 3 * u * t ** 2 * controlB.y + t ** 3 * node.y;
          const z = u ** 3 * parent.z + 3 * u ** 2 * t * controlA.z + 3 * u * t ** 2 * controlB.z + t ** 3 * node.z;
          const point = projectPoint(x, y, z);
          points.push(`${i ? 'L' : 'M'}${point.screenX + panX} ${point.screenY + panY}`);
        }
        const path = svgElement(doc, 'path', { class: `map-edge${selected ? ' selected' : ''}`, d: points.join(' ') });
        edges.append(path);
      }
    }
    for (const node of depthOrder) {
      const state = nodeState(node);
      const ready = state === 'ready';
      const coalescing = ready && coalescingIds.has(node.id);
      const nodeRadius = Math.max(4.5, Math.min(10, 7 * Math.sqrt(node.perspective / (820 / (baseDistance / zoom)))));
      const stateClass = `${ready ? 'is-ready' : state === 'preparing' ? 'is-pending is-preparing' : 'is-unavailable'}${coalescing ? ' is-coalescing' : ''}`;
      const availability = nodeStatusLabel(node);
      const accessibleStatus = ready ? 'Scene ready for selection.' : state === 'preparing' ? 'Scene is preparing. Not ready for selection.' : 'Scene unavailable. Not ready for selection.';
      const consequences = node.consequencesStatus ? ` Consequences: ${node.consequencesStatus}.` : '';
      const labelled = node.id === currentSelected || node.id === hoverId;
      const yearLabel = formatStarMapYear(node.year);
      const group = svgElement(doc, 'g', { class: `map-star ${stateClass}${node.id === currentSelected ? ' is-selected' : ''}${labelled ? ' is-labelled' : ''}${node.undated ? ' is-undated' : ''}`, transform: `translate(${node.screenX} ${node.screenY})`, tabindex: 0, role: 'button', 'aria-disabled': !ready, 'aria-pressed': node.id === currentSelected, 'aria-label': `${yearLabel}: ${safeTitle(node)}. ${availability}.${consequences} ${accessibleStatus}` });
      group.dataset.nodeId = node.id;
      if (state === 'preparing' || coalescing) addCloudParticles(doc, group, nodeRadius * (coalescing ? 3.8 : 3.2));
      group.append(svgElement(doc, 'circle', { class: `star-halo${coalescing ? ' star-materialize' : ''}`, r: nodeRadius * 2.8 }), svgElement(doc, 'circle', { class: `star-core${coalescing ? ' star-materialize' : ''}`, r: nodeRadius }));
      const label = svgElement(doc, 'text', { class: 'star-label', x: nodeRadius + 8, y: -2 }); label.textContent = safeTitle(node).slice(0, 40); group.append(label);
      { const year = svgElement(doc, 'text', { class: 'star-year', x: nodeRadius + 8, y: 13 }); year.textContent = yearLabel; group.append(year); }
      group.addEventListener('pointerenter', () => { clearPopupDismiss(); hoverId = node.id; group.classList.add('is-labelled'); showPopup(node); });
      group.addEventListener('pointerleave', () => {
        if (popupHovered || popupFocused) return;
        schedulePopupDismiss(node.id);
      });
      group.addEventListener('focus', () => { clearPopupDismiss(); focusedNodeId = node.id; group.classList.add('is-labelled'); showPopup(node); });
      group.addEventListener('blur', () => {
        if (focusedNodeId === node.id) focusedNodeId = null;
        if (!popupHovered && !popupFocused) schedulePopupDismiss(node.id, 0);
      });
      group.addEventListener('click', event => {
        event.stopPropagation();
        selectNode(node);
      });
      group.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectNode(node);
        }
      });
      stars.append(group);
    }
    const popupNode = positioned.find(node => node.id === (hoverId || focusedNodeId || currentSelected));
    showPopup(popupNode || null);
  }
  function updateLiveStatus() {
    const preparing = currentNodes.filter(node => nodeState(node) === 'preparing').length;
    const unavailable = currentNodes.filter(node => nodeState(node) === 'unavailable').length;
    liveStatus.textContent = preparing || unavailable
      ? `${preparing} scene${preparing === 1 ? '' : 's'} preparing; ${unavailable} scene${unavailable === 1 ? '' : 's'} unavailable. Only events with a ready scene can be selected.`
      : 'All event scenes are ready for selection. Consequences may continue preparing in the background.';
  }
  function panBy(dx, dy) { panX += dx; panY += dy; render(); }
  function zoomAt(factor) { zoom = Math.max(0.35, Math.min(viewMode === 'focus' ? 36 : 12, zoom * factor)); render(); }
  root.addEventListener('pointerdown', event => {
    if (event.target.closest?.('.map-view-controls, .map-popup')) return;
    const panGesture = event.button === 2 || event.shiftKey;
    if (event.button !== 0 && !panGesture) return;
    if (event.target.closest?.('.map-star') && !panGesture) return;
    userInteracted = true; autoFocusConsumed = true;
    if (event.button === 2) event.preventDefault();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, mode: panGesture ? 'pan' : 'orbit' };
    root.setPointerCapture?.(event.pointerId);
  });
  root.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (pointer.mode === 'pan') {
      const bounds = svg.getBoundingClientRect();
      panBy(dx * (900 / Math.max(bounds.width, 1)), dy * (540 / Math.max(bounds.height, 1)));
    }
    else { yaw += dx * 0.008; pitch = Math.max(-1.2, Math.min(1.2, pitch + dy * 0.008)); render(); }
    pointer.x = event.clientX; pointer.y = event.clientY;
  });
  const stopPan = () => { pointer = null; };
  root.addEventListener('pointerup', stopPan); root.addEventListener('pointercancel', stopPan);
  root.addEventListener('contextmenu', event => event.preventDefault());
  root.addEventListener('wheel', event => {
    if (event.target.closest?.('.map-popup')) return;
    userInteracted = true; autoFocusConsumed = true; event.preventDefault(); zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  root.addEventListener('keydown', event => {
    if (event.target.closest?.('.map-popup')) return;
    const focusedNodeId = event.target.closest?.('.map-star')?.dataset.nodeId;
    const step = event.shiftKey ? 80 : 36;
    if (event.key === 'ArrowLeft' && event.shiftKey) panBy(step, 0);
    else if (event.key === 'ArrowRight' && event.shiftKey) panBy(-step, 0);
    else if (event.key === 'ArrowUp' && event.shiftKey) panBy(0, step);
    else if (event.key === 'ArrowDown' && event.shiftKey) panBy(0, -step);
    else if (event.key === 'ArrowLeft') { yaw -= 0.12; render(); }
    else if (event.key === 'ArrowRight') { yaw += 0.12; render(); }
    else if (event.key === 'ArrowUp') { pitch = Math.max(-1.2, pitch - 0.1); render(); }
    else if (event.key === 'ArrowDown') { pitch = Math.min(1.2, pitch + 0.1); render(); }
    else if (event.key === '+' || event.key === '=') zoomAt(1.15);
    else if (event.key === '-') zoomAt(1 / 1.15);
    else if (event.key === 'Home') { showOverview(); }
    else return;
    userInteracted = true; autoFocusConsumed = true;
    event.preventDefault();
    if (focusedNodeId) stars.querySelector(`[data-node-id="${CSS.escape(focusedNodeId)}"]`)?.focus();
  });
  const ResizeObserverClass = doc.defaultView?.ResizeObserver;
  const resizeObserver = ResizeObserverClass ? new ResizeObserverClass(() => {
    if (activePopupNode && root.getBoundingClientRect().width > 0) showPopup(activePopupNode);
  }) : null;
  resizeObserver?.observe(root);
  const onWindowResize = () => { if (activePopupNode) showPopup(activePopupNode); };
  doc.defaultView?.addEventListener('resize', onWindowResize);
  autoFocusSelectedIfWide();
  render();
  updateLiveStatus();

  return {
    setData(next = {}) {
      if (destroyed) return;
      if (Array.isArray(next.nodes)) {
        const previous = new Map(currentNodes.map(node => [String(node.id), node]));
        currentNodes = next.nodes;
        for (const node of currentNodes) {
          const old = previous.get(String(node.id));
          if (old && !isNodeReady(old) && isNodeReady(node)) {
            const id = String(node.id); coalescingIds.add(id);
            clearTimeout(coalescingTimers.get(id));
            const reduceMotion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            coalescingTimers.set(id, setTimeout(() => { coalescingIds.delete(id); coalescingTimers.delete(id); if (!destroyed) render(); }, reduceMotion ? 0 : 900));
          }
        }
      }
      if ('selectedId' in next) {
        const previousSelected = currentSelected;
        currentSelected = next.selectedId == null ? null : String(next.selectedId);
        if (viewMode === 'focus' && currentSelected !== previousSelected) {
          const selected = currentNodes.find(node => String(node.id) === currentSelected);
          const selectedYear = astronomicalYear(selected?.year);
          if (selectedYear == null) { viewMode = 'overview'; focusAnchorYear = null; zoom = Math.min(zoom, 12); }
          else { focusAnchorYear = selectedYear; panX = 0; panY = 0; }
        }
      }
      autoFocusSelectedIfWide();
      render(); updateLiveStatus();
    },
    select(id) { if (!destroyed) { userInteracted = true; autoFocusConsumed = true; const candidate = currentNodes.find(node => String(node.id) === String(id)); if (candidate) { currentSelected = String(id); if (viewMode === 'focus') focusAnchorYear = astronomicalYear(candidate.year); } else currentSelected = null; render(); } },
    destroy() { if (destroyed) return; destroyed = true; clearPopupDismiss(); resizeObserver?.disconnect(); doc.defaultView?.removeEventListener('resize', onWindowResize); for (const timer of coalescingTimers.values()) clearTimeout(timer); coalescingTimers.clear(); root.remove(); },
  };
}
