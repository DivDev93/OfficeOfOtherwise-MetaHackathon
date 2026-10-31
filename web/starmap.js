const SVG_NS = 'http://www.w3.org/2000/svg';

const STYLE = `
.otherwise-starmap{--map-bg:#100e0d;--map-panel:#1d1915;--map-line:#766044;--map-gold:var(--gold,#e5c07b);--map-paper:var(--parchment,#ece4d4);--map-muted:var(--neutral-200,#d6cabb);--map-serif:var(--serif,'Cormorant Garamond',Georgia,serif);position:relative;isolation:isolate;overflow:hidden;min-height:360px;width:100%;height:100%;color:var(--map-paper);background:radial-gradient(ellipse at 50% 38%,#29231c 0%,#171310 54%,#0d0b0a 100%);border:1px solid #766044;border-radius:14px;touch-action:auto;outline:none}
.otherwise-starmap:focus-visible{box-shadow:0 0 0 3px var(--map-gold)}
.otherwise-starmap svg{display:block;width:100%;height:100%;min-height:360px;cursor:default;user-select:none;touch-action:pan-y}
.otherwise-starmap .map-grid{fill:none;stroke:#bfa77d;stroke-opacity:.09;stroke-width:1;vector-effect:non-scaling-stroke}
.otherwise-starmap .time-axis-line{stroke:#d3bc91;stroke-width:1.5;vector-effect:non-scaling-stroke}
.otherwise-starmap .time-axis-tick{stroke:#d3bc91;stroke-width:1;vector-effect:non-scaling-stroke}
.otherwise-starmap .time-axis-label,.otherwise-starmap .time-axis-title{fill:var(--map-paper);font:12px system-ui,sans-serif;paint-order:stroke;stroke:#100e0d;stroke-width:3px;pointer-events:none}
.otherwise-starmap .time-axis-title{font-size:11px;font-weight:700;letter-spacing:.08em}
.otherwise-starmap .map-edge{fill:none;stroke:#b3a28a;stroke-opacity:.48;stroke-width:1.8;vector-effect:non-scaling-stroke}
.otherwise-starmap .map-edge.is-selected-lineage{stroke:var(--map-gold);stroke-opacity:1;stroke-width:3.5}
.otherwise-starmap .map-star{cursor:pointer;outline:none}
.otherwise-starmap .map-hit{fill:transparent;stroke:transparent;pointer-events:all}
.otherwise-starmap .map-star:focus .map-hit,.otherwise-starmap .map-star:hover .map-hit{stroke:#f3ead8;stroke-opacity:.65;stroke-width:1.5;vector-effect:non-scaling-stroke}
.otherwise-starmap .star-core{fill:#87b9a4;stroke:#c6ddce;stroke-width:1.6;vector-effect:non-scaling-stroke}
.otherwise-starmap .star-halo{fill:#87b9a4;fill-opacity:.16}
.otherwise-starmap .map-star.is-saved-unexplored .star-core{fill:#1b1915;stroke:#e5d4ae;stroke-width:2}
.otherwise-starmap .map-star.is-root-question .star-core{fill:#e5c07b;stroke:#fff0c9;stroke-width:2}
.otherwise-starmap .map-star.is-generating .star-core{fill:#d7bb8a;stroke:#fff0c9;stroke-width:1.8}
.otherwise-starmap .map-star.is-unavailable .star-core{fill:#85827b;stroke:#c2beb3;stroke-width:1.5}
.otherwise-starmap .map-star.is-other-tree .star-halo,.otherwise-starmap .map-star.is-other-tree .star-core{opacity:.42}
.otherwise-starmap .map-star.is-selected .star-halo{fill:#e5c07b;fill-opacity:.3}
.otherwise-starmap .map-star.is-selected .star-core{fill:#ffe6ab;stroke:#fff2d1;stroke-width:2.6}
.otherwise-starmap .map-star.is-generating .cloud-particles{animation:map-particle-drift 2.5s linear infinite}
.otherwise-starmap .cloud-particles{pointer-events:none}
.otherwise-starmap .cloud-particle{fill:#f3dbad;opacity:.9}
@keyframes map-particle-drift{to{transform:rotate(360deg)}}
.otherwise-starmap .star-label{fill:var(--map-paper);font:600 13px/1.2 system-ui,sans-serif;paint-order:stroke;stroke:#100e0d;stroke-width:3.6px;stroke-linejoin:round;pointer-events:none}
.otherwise-starmap .star-year{fill:var(--map-muted);font:11px system-ui,sans-serif;paint-order:stroke;stroke:#100e0d;stroke-width:3px;pointer-events:none}
.otherwise-starmap .map-label-hidden{display:none}
.otherwise-starmap .map-popup{position:absolute;z-index:3;display:grid;grid-template-columns:minmax(0,1fr);grid-template-areas:"scene" "copy" "summary";gap:8px;box-sizing:border-box;width:min(340px,calc(100% - 16px));max-height:min(280px,calc(100% - 16px));overflow:auto;overscroll-behavior:contain;touch-action:pan-y;padding:12px 13px;border:1px solid #a18a66;border-radius:12px;background:linear-gradient(145deg,rgba(29,25,21,.98),rgba(16,14,12,.98));box-shadow:0 14px 32px #000c;pointer-events:auto;backdrop-filter:blur(10px);scrollbar-width:thin;scrollbar-color:#9a805c #171310}
.otherwise-starmap .map-popup[hidden],.otherwise-starmap .map-popup img[hidden]{display:none}
.otherwise-starmap .map-popup-copy{grid-area:copy;min-width:0}
.otherwise-starmap .map-popup img{grid-area:scene;display:block;width:100%;height:auto;max-height:125px;aspect-ratio:16/9;object-fit:cover;border-radius:8px;background:#171310}
.otherwise-starmap .map-popup-title{margin:0;color:var(--map-paper);font:500 23px/1.05 var(--map-serif);overflow-wrap:anywhere}
.otherwise-starmap .map-popup-meta{margin:5px 0 0;color:var(--map-muted);font:12px/1.35 system-ui,sans-serif;overflow-wrap:anywhere}
.otherwise-starmap .map-popup-summary{grid-area:summary;margin:0;color:var(--map-paper);font:13px/1.42 system-ui,sans-serif;overflow-wrap:anywhere}
.otherwise-starmap .map-popup-summary:empty{display:none}
.otherwise-starmap .map-help{position:absolute;right:10px;bottom:8px;max-width:min(72%,420px);margin:0;color:var(--map-paper);font:12px/1.35 system-ui,sans-serif;text-align:right;text-shadow:0 1px 3px #000;pointer-events:none}
.otherwise-starmap .map-time-key{position:absolute;left:12px;top:10px;max-width:calc(100% - 170px);margin:0;padding:5px 8px;border:1px solid #766044;border-radius:7px;background:rgba(16,14,12,.94);color:var(--map-paper);font:600 11px/1.3 system-ui,sans-serif;letter-spacing:.035em;pointer-events:none}
.otherwise-starmap .map-view-controls{position:absolute;top:8px;right:8px;display:flex;gap:5px;z-index:2}
.otherwise-starmap .map-view-controls button{min-width:44px;min-height:44px;padding:6px 10px;border:1px solid #927a55;border-radius:7px;background:rgba(16,14,12,.96);color:var(--map-paper);font:600 12px/1.2 system-ui,sans-serif;cursor:pointer}
.otherwise-starmap .map-view-controls button[aria-pressed="true"]{border-color:var(--map-gold);color:var(--map-gold)}
.otherwise-starmap .map-view-controls button:hover,.otherwise-starmap .map-view-controls button:focus-visible{border-color:#fff0c9;outline:2px solid var(--map-gold);outline-offset:1px}
.otherwise-starmap .map-sr-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:520px){.otherwise-starmap{min-height:320px;border-radius:10px}.otherwise-starmap svg{min-height:320px}.otherwise-starmap .map-time-key{top:56px;left:8px;max-width:calc(100% - 16px);font-size:10px}.otherwise-starmap .map-view-controls{top:5px;right:5px}.otherwise-starmap .map-view-controls button{min-width:44px;min-height:44px;padding:5px 8px}.otherwise-starmap .map-popup{max-height:min(250px,calc(100% - 12px));padding:10px}.otherwise-starmap .map-popup-title{font-size:20px}.otherwise-starmap .map-help{font-size:11px;max-width:72%}}
@media(prefers-reduced-motion:reduce){.otherwise-starmap *{animation:none!important;scroll-behavior:auto!important}}
`;

function ensureStyle(doc) {
  if (doc.getElementById('otherwise-starmap-style')) return;
  const style = doc.createElement('style'); style.id = 'otherwise-starmap-style'; style.textContent = STYLE; doc.head.append(style);
}
function svgElement(doc, tag, attrs = {}) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
function safeTitle(node) { return String(node?.title || 'Untitled event'); }
function formatStarMapLocation(value, seen = new Set()) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) { if (seen.has(value)) return ''; const next = new Set(seen); next.add(value); return value.map(item => formatStarMapLocation(item, next)).filter(Boolean).join(', '); }
  if (!value || typeof value !== 'object' || seen.has(value)) return '';
  const next = new Set(seen); next.add(value);
  for (const key of ['name', 'label', 'title', 'place']) { const label = formatStarMapLocation(value[key], next); if (label) return label; }
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
    const text = year.trim(); const era = /^(\d+)\s*(BCE|BC|CE|AD)$/i.exec(text);
    if (era) { const magnitude = Number(era[1]); if (!Number.isSafeInteger(magnitude) || magnitude === 0) return null; return /^(BCE|BC)$/i.test(era[2]) ? -magnitude : magnitude; }
    if (!/^[+-]?\d+$/.test(text)) return null; year = Number(text);
  }
  return Number.isSafeInteger(year) && year !== 0 ? year : null;
}
export function formatStarMapYear(value) {
  const year = parseStarMapYear(value); if (year == null) return 'Undated';
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}
/** Convert signed historical year to astronomical coordinate (1 BCE=0, 1 CE=1). */
export function astronomicalYear(value) { const year = parseStarMapYear(value); return year == null ? null : year < 0 ? year + 1 : year; }

function stableNodeOrder(a, b) { return String(a.branchId ?? '').localeCompare(String(b.branchId ?? '')) || a.id.localeCompare(b.id); }
export function getStarMapNodeState(node) {
  if (node?.role === 'root-question' || node?.isRootQuestion) return 'root-question';
  const explicit = String(node?.mapState ?? node?.state ?? node?.visualState ?? '').toLowerCase().replace(/_/g, '-');
  if (['explored', 'saved-unexplored', 'generating', 'unavailable'].includes(explicit)) return explicit;
  const status = String(node?.status ?? node?.sceneStatus ?? '').toLowerCase();
  if (/pending|prepar|loading|generating|queued|processing|in.progress|running/.test(status)) return 'generating';
  if (/unavailable|missing|fail|error|not ready|absent/.test(status) || node?.ready === false) return 'unavailable';
  if (node?.explored === true) return 'explored';
  return node?.ready === true || node?.saved === true || node?.thumbnail || node?.scene ? 'explored' : 'saved-unexplored';
}

/** Flat, chronological layout. Descendant branches occupy distinct vertical lanes. */
export function layoutStarMap(nodes = [], { width = 900, height = 540, rootNodeId = null } = {}) {
  const items = Array.isArray(nodes) ? nodes.filter(n => n && n.id != null).map(n => ({ ...n, id: String(n.id) })) : [];
  const byId = new Map(items.map(node => [node.id, node]));
  const children = new Map(), roots = [];
  for (const node of items) {
    const parentId = String(node.parentId ?? ''), parent = byId.get(parentId);
    if (parent && parent.id !== node.id) { if (!children.has(parentId)) children.set(parentId, []); children.get(parentId).push(node); }
    else roots.push(node);
  }
  for (const siblings of children.values()) siblings.sort(stableNodeOrder);
  roots.sort(stableNodeOrder);
  const countMemo = new Map(), depthMemo = new Map();
  const leafCount = (node, trail = new Set()) => {
    if (countMemo.has(node.id)) return countMemo.get(node.id);
    if (trail.has(node.id)) return 1;
    const next = new Set(trail); next.add(node.id); const descendants = children.get(node.id) || [];
    const count = descendants.length ? descendants.reduce((sum, child) => sum + leafCount(child, next), 0) : 1; countMemo.set(node.id, count); return count;
  };
  const depthOf = (node, trail = new Set()) => {
    if (depthMemo.has(node.id)) return depthMemo.get(node.id);
    if (trail.has(node.id)) return 0;
    const parent = byId.get(String(node.parentId ?? '')); if (!parent || parent.id === node.id) return 0;
    const next = new Set(trail); next.add(node.id); const depth = 1 + depthOf(parent, next); depthMemo.set(node.id, depth); return depth;
  };
  const dated = items.map(node => astronomicalYear(node.year)).filter(Number.isFinite);
  const minYear = dated.length ? Math.min(...dated) : null, maxYear = dated.length ? Math.max(...dated) : null;
  const left = Math.min(82, width * .12), right = Math.max(left + 1, width - Math.min(82, width * .12));
  const axisY = height - 58, top = Math.max(74, height * .16), laneGap = Math.max(38, Math.min(64, (axisY - top - 26) / Math.max(1, items.length)));
  const xFor = year => {
    if (year == null) return right;
    if (minYear == null || maxYear === minYear) return (left + right) / 2;
    const gap = (right - left) * .055;
    return left + gap + ((year - minYear) / (maxYear - minYear)) * (right - left - gap * 2);
  };
  const result = new Map(); let laneCursor = 0;
  function place(node, startLane) {
    const count = leafCount(node), lane = startLane + (count - 1) / 2, year = astronomicalYear(node.year);
    const rootQuestion = node.role === 'root-question' || node.isRootQuestion === true || node.id === String(node.rootNodeId ?? rootNodeId ?? '');
    const generationPlaceholder = node.isExpansionPlaceholder === true || node.role === 'generation-placeholder';
    const depth = depthOf(node), laneIndex = lane;
    const questionY = Math.min(axisY - 54, Math.max(top, height * .48));
    const parent = byId.get(String(node.parentId ?? ''));
    const parentX = result.get(parent?.id)?.x ?? xFor(astronomicalYear(parent?.year));
    const unknownStep = Math.min(56, width * .18), unknownSide = width - 24 - parentX >= unknownStep ? 1 : -1;
    const unknownX = generationPlaceholder && parent ? Math.max(24, Math.min(width - 24, parentX + unknownSide * unknownStep)) : xFor(year);
    result.set(node.id, { ...node, depth, yearCoordinate: rootQuestion || generationPlaceholder ? null : year, yearLabel: rootQuestion ? 'Root question' : generationPlaceholder ? 'Time unknown' : formatStarMapYear(node.year), undated: rootQuestion || generationPlaceholder || year == null, isRootQuestion: rootQuestion, isExpansionPlaceholder: generationPlaceholder, x: rootQuestion ? 22 : generationPlaceholder ? unknownX : xFor(year), y: rootQuestion ? questionY : Math.max(top, axisY - 28 - laneIndex * laneGap), lane: laneIndex });
    let cursor = startLane;
    for (const child of children.get(node.id) || []) { place(child, cursor); cursor += leafCount(child); }
  }
  for (const root of roots) { place(root, laneCursor); laneCursor += leafCount(root); }
  // Break malformed cyclic components deterministically; every supplied item remains visible.
  for (const node of items) if (!result.has(node.id)) { const year = astronomicalYear(node.year); const rootQuestion = node.role === 'root-question' || node.isRootQuestion === true || node.id === String(node.rootNodeId ?? rootNodeId ?? ''); const generationPlaceholder = node.isExpansionPlaceholder === true || node.role === 'generation-placeholder'; result.set(node.id, { ...node, depth: 0, yearCoordinate: rootQuestion || generationPlaceholder ? null : year, yearLabel: rootQuestion ? 'Root question' : generationPlaceholder ? 'Time unknown' : formatStarMapYear(node.year), undated: rootQuestion || generationPlaceholder || year == null, isRootQuestion: rootQuestion, isExpansionPlaceholder: generationPlaceholder, x: rootQuestion ? 22 : xFor(year), y: rootQuestion ? Math.min(axisY - 54, Math.max(top, height * .48)) : Math.max(top, axisY - 28 - laneCursor++ * laneGap), lane: laneCursor }); }
  return [...result.values()];
}

/** Rotate event lanes in an orthographic 3D view, then fit the projection to the map. */
export function projectStarMap(nodes = [], { yaw = 0, pitch = 0.18, zoom = 1, panX = 0, panY = 0, width = 900, height = 540 } = {}) {
  const safeYaw = Math.max(-0.72, Math.min(0.72, yaw));
  const safePitch = Math.max(-0.68, Math.min(0.68, pitch));
  const cosYaw = Math.cos(safeYaw), sinYaw = Math.sin(safeYaw);
  const cosPitch = Math.cos(safePitch), sinPitch = Math.sin(safePitch);
  const rotated = nodes.map(node => {
    const x = node.x ?? width / 2, y = node.y ?? height / 2;
    const z = Number.isFinite(node.z) ? node.z : (Number(node.lane) || 0) * 28;
    const horizontal = cosYaw * x + sinYaw * z;
    const depth = -sinYaw * x + cosYaw * z;
    const vertical = cosPitch * y - sinPitch * depth;
    return { node, x: horizontal, y: vertical };
  });
  if (!rotated.length) return [];
  const minX = Math.min(...rotated.map(point => point.x)), maxX = Math.max(...rotated.map(point => point.x));
  const minY = Math.min(...rotated.map(point => point.y)), maxY = Math.max(...rotated.map(point => point.y));
  const marginX = Math.min(30, width * 0.08), marginY = Math.min(56, height * 0.13);
  const fit = Math.min((width - 2 * marginX) / Math.max(1, maxX - minX), (height - 2 * marginY) / Math.max(1, maxY - minY));
  const scale = fit * Math.max(0.7, Math.min(1.35, zoom));
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  return rotated.map(({ node, x, y }) => ({ ...node, screenX: width / 2 + (x - centerX) * scale + Math.max(-width * 0.12, Math.min(width * 0.12, panX)), screenY: height / 2 + (y - centerY) * scale + Math.max(-height * 0.12, Math.min(height * 0.12, panY)) }));
}

export function placeStarMapLabels(nodes, width, height, { selectedId = null, hoverId = null, focusedId = null, lineageIds = new Set(), measureText = (text, size = 13) => text.length * size * .62, reservedRects = [] } = {}) {
  const occupied = (Array.isArray(reservedRects) ? reservedRects : []).filter(rect => rect && [rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite)), placed = new Map();
  const priority = node => node.id === selectedId ? 4 : node.id === hoverId || node.id === focusedId ? 3 : node.role === 'root-question' || node.isRootQuestion ? 2 : lineageIds.has(node.id) ? 1 : 0;
  const ordered = [...nodes].sort((a, b) => priority(b) - priority(a) || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const fitText = (value, maxWidth, size, weight) => {
    const text = String(value || '');
    if (measureText(text, size, weight) <= maxWidth) return text;
    let fitted = text;
    while (fitted.length > 1 && measureText(`${fitted}…`, size, weight) > maxWidth) fitted = fitted.slice(0, -1);
    return fitted.length > 1 ? `${fitted}…` : '…';
  };
  for (const node of ordered) {
    const year = node.role === 'root-question' || node.isRootQuestion ? 'Root question' : node.isExpansionPlaceholder || node.role === 'generation-placeholder' ? 'Time unknown' : formatStarMapYear(node.year);
    const maxTextWidth = Math.max(44, Math.min(270, width * .46, width - 16));
    const text = fitText(safeTitle(node).slice(0, 80), maxTextWidth, 13, 600);
    const fittedYear = fitText(year, maxTextWidth, 11, 400);
    const contentWidth = Math.max(measureText(text, 13, 600), measureText(fittedYear, 11, 400));
    const labelWidth = contentWidth + 5;
    const labelHeight = 31, candidates = [
      { x: node.x + 16, y: node.y - 5, anchor: 'start' },
      { x: node.x - 16, y: node.y - 5, anchor: 'end' },
      { x: node.x + 16, y: node.y + 26, anchor: 'start' },
      { x: node.x - 16, y: node.y + 26, anchor: 'end' },
    ];
    for (const reserved of occupied) {
      if (reservedRects.includes(reserved)) candidates.push(
        { x: node.x + 16, y: reserved.top - labelHeight - 4, anchor: 'start' },
        { x: node.x - 16, y: reserved.top - labelHeight - 4, anchor: 'end' },
      );
    }
    const isPriority = node.id === selectedId || node.id === hoverId || node.id === focusedId || lineageIds.has(node.id) || node.role === 'root-question' || node.isRootQuestion;
    let choice = null;
    for (const candidate of candidates) {
      const x = candidate.anchor === 'start' ? candidate.x - 2 : candidate.x - contentWidth - 3;
      const rect = { left: x, right: x + labelWidth, top: candidate.y - 12, bottom: candidate.y + labelHeight };
      if (rect.left < 4 || rect.right > width - 4 || rect.top < 56 || rect.bottom > height - 34) continue;
      if (occupied.some(other => rect.left < other.right + 5 && rect.right + 5 > other.left && rect.top < other.bottom + 4 && rect.bottom + 4 > other.top)) continue;
      choice = { ...candidate, year: fittedYear, text, hidden: false, rect }; break;
    }
    if (!choice && isPriority) {
      for (const candidate of candidates) {
        const x = candidate.anchor === 'start' ? candidate.x - 2 : candidate.x - contentWidth - 3;
        const rect = { left: Math.max(4, Math.min(width - labelWidth - 4, x)), right: 0, top: Math.max(58, Math.min(height - labelHeight - 34, candidate.y - 12)), bottom: 0 };
        rect.right = rect.left + labelWidth; rect.bottom = rect.top + labelHeight;
        if (!occupied.some(other => rect.left < other.right + 3 && rect.right + 3 > other.left && rect.top < other.bottom + 3 && rect.bottom + 3 > other.top)) { choice = { ...candidate, x: candidate.anchor === 'start' ? rect.left + 2 : rect.right - 2, y: rect.top + 12, year: fittedYear, text, hidden: false, rect }; break; }
      }
    }
    if (choice) { occupied.push(choice.rect); placed.set(node.id, choice); }
    else placed.set(node.id, { hidden: true, year, text });
  }
  return placed;
}

function lineageFor(nodes, selectedId, explicitRootId) {
  const byId = new Map(nodes.map(node => [String(node.id), node]));
  const selected = byId.get(String(selectedId ?? ''));
  if (!selected) return new Set(explicitRootId && byId.has(String(explicitRootId)) ? [String(explicitRootId)] : []);
  const supplied = Array.isArray(selected.lineageIds) ? selected.lineageIds.map(String) : null;
  const lineage = new Set(supplied || []);
  if (!supplied) {
    let current = selected, guard = new Set();
    while (current && !guard.has(String(current.id))) { const id = String(current.id); guard.add(id); lineage.add(id); current = byId.get(String(current.parentId ?? '')); }
  } else lineage.add(String(selected.id));
  const rootId = selected.rootNodeId ?? selected.rootId ?? explicitRootId;
  if (rootId != null && byId.has(String(rootId))) lineage.add(String(rootId));
  return lineage;
}

/** Create a 2D chronological exploration map. Hover previews never select or call onSelect. */
export function createStarMap(container, { nodes = [], selectedId = null, rootNodeId = null, onSelect = () => {} } = {}) {
  if (!container?.ownerDocument) throw new TypeError('createStarMap needs a DOM container');
  const doc = container.ownerDocument; ensureStyle(doc);
  const measureCanvas = doc.createElement('canvas'), measureContext = measureCanvas.getContext?.('2d');
  const measureMapText = (text, size = 13, weight = 600) => {
    if (!measureContext) return String(text).length * size * .62;
    measureContext.font = `${weight} ${size}px system-ui, sans-serif`;
    return measureContext.measureText(String(text)).width;
  };
  const root = doc.createElement('div'); root.className = 'otherwise-starmap'; root.tabIndex = 0; root.setAttribute('role', 'application');
  root.setAttribute('aria-label', 'Chronological exploration map. Earlier events are left; later events are right. Orbit mode supports drag, arrow-key rotation, plus/minus zoom, and Home reset. Select a point with click or Enter.');
  root.setAttribute('aria-keyshortcuts', 'Enter Space Escape ArrowUp ArrowDown ArrowLeft ArrowRight + - Home');
  const svg = svgElement(doc, 'svg', { viewBox: '0 0 900 540', preserveAspectRatio: 'none', 'aria-label': 'Chronological branching event map', role: 'group' });
  const grid = svgElement(doc, 'g', { class: 'map-grid', 'aria-hidden': 'true' });
  const graph = svgElement(doc, 'g', { class: 'map-viewport' });
  const axis = svgElement(doc, 'g', { class: 'time-axis', 'aria-hidden': 'true' });
  const edges = svgElement(doc, 'g', { 'aria-hidden': 'true' }), stars = svgElement(doc, 'g'); graph.append(axis, edges, stars); svg.append(grid, graph);
  const popup = doc.createElement('div'); popup.className = 'map-popup'; popup.hidden = true; popup.setAttribute('aria-hidden', 'true'); popup.setAttribute('role', 'region'); popup.setAttribute('aria-label', 'Event preview'); popup.tabIndex = 0;
  const image = doc.createElement('img'); image.alt = ''; image.hidden = true;
  const copy = doc.createElement('div'); copy.className = 'map-popup-copy';
  const title = doc.createElement('h3'); title.className = 'map-popup-title';
  const meta = doc.createElement('p'); meta.className = 'map-popup-meta';
  const summary = doc.createElement('p'); summary.className = 'map-popup-summary';
  copy.append(title, meta); popup.append(image, copy, summary);
  const controls = doc.createElement('div'); controls.className = 'map-view-controls';
  const flatButton = doc.createElement('button'); flatButton.type = 'button'; flatButton.textContent = 'Flat'; flatButton.setAttribute('aria-pressed', 'true'); flatButton.setAttribute('aria-label', 'Use flat timeline layout');
  const orbitButton = doc.createElement('button'); orbitButton.type = 'button'; orbitButton.textContent = 'Orbit'; orbitButton.setAttribute('aria-pressed', 'false'); orbitButton.setAttribute('aria-label', 'Use optional orbit layout'); controls.append(flatButton, orbitButton);
  const timeKey = doc.createElement('p'); timeKey.className = 'map-time-key'; timeKey.textContent = 'TIME · OLDER  ←  EARLIER  →  LATER';
  const help = doc.createElement('p'); help.className = 'map-help'; help.textContent = 'Hover previews · Click or Enter opens · Orbit: drag, arrows, +/- · Home resets · Escape closes';
  const live = doc.createElement('div'); live.className = 'map-sr-status'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  root.append(svg, popup, timeKey, controls, help, live); container.replaceChildren(root);

  let currentNodes = Array.isArray(nodes) ? nodes : [], currentSelected = selectedId == null ? null : String(selectedId), currentRootId = rootNodeId == null ? null : String(rootNodeId);
  let hoverId = null, focusId = null, previewId = null, mode = 'flat', width = 900, height = 540, destroyed = false, dismissTimer = null, popupInside = false, popupFocus = false;
  let orbitYaw = -0.22, orbitPitch = 0.18, orbitZoom = 1, orbitPanX = 0, orbitPanY = 0, drag = null;
  const byId = () => new Map(currentNodes.map(node => [String(node.id), node]));
  const choose = node => { if (!node || node.selectable === false) return; currentSelected = String(node.id); previewId = currentSelected; render(); onSelect(node); };
  function clearDismiss() { if (dismissTimer != null) clearTimeout(dismissTimer); dismissTimer = null; }
  function closePreview() { clearDismiss(); if (popupInside || popupFocus) return; hoverId = null; if (focusId == null) previewId = null; render(); }
  function scheduleDismiss(delay = 210) { clearDismiss(); dismissTimer = setTimeout(closePreview, delay); }
  popup.addEventListener('pointerenter', () => { popupInside = true; clearDismiss(); });
  popup.addEventListener('pointerleave', () => { popupInside = false; if (!popupFocus) scheduleDismiss(); });
  popup.addEventListener('focus', () => { popupFocus = true; clearDismiss(); });
  popup.addEventListener('blur', () => { popupFocus = false; if (!popupInside) scheduleDismiss(0); });
  popup.addEventListener('wheel', event => event.stopPropagation(), { passive: true });
  popup.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') popup._touchY = event.clientY; });
  popup.addEventListener('pointermove', event => { if (event.pointerType === 'touch' && Number.isFinite(popup._touchY)) { popup.scrollTop += popup._touchY - event.clientY; popup._touchY = event.clientY; event.preventDefault(); } });
  popup.addEventListener('pointerup', () => { popup._touchY = null; });
  flatButton.addEventListener('click', () => { mode = 'flat'; drag = null; render(); }); orbitButton.addEventListener('click', () => { mode = 'orbit'; render(); });

  function popupFor(node) {
    previewId = node ? String(node.id) : null;
    if (!node) { popup.hidden = true; popup.setAttribute('aria-hidden', 'true'); return; }
    title.textContent = safeTitle(node);
    const location = formatStarMapLocation(node.location) || formatStarMapLocation(node.place);
    const state = getStarMapNodeState(node).replace(/-/g, ' ');
    meta.textContent = [node.role === 'root-question' || node.isRootQuestion ? 'Root question' : node.isExpansionPlaceholder || node.role === 'generation-placeholder' ? 'Time unknown' : formatStarMapYear(node.year), location, node.status || state].filter(Boolean).join(' · ');
    summary.textContent = String(node.summary || node.prompt || '');
    const source = sceneSource(node); image.hidden = !source; if (source) image.src = String(source); else image.removeAttribute('src');
    popup.hidden = false; popup.setAttribute('aria-hidden', 'false');
    const box = root.getBoundingClientRect(), position = positioned.find(item => item.id === String(node.id));
    if (!box.width || !box.height) return;
    const pw = Math.min(box.width - 16, popup.offsetWidth || Math.min(340, box.width - 16)), ph = Math.min(box.height - 16, popup.offsetHeight || 156);
    const px = position ? position.screenX * box.width / width : box.width / 2, py = position ? position.screenY * box.height / height : box.height / 2;
    const candidates = [{ x: px + 20, y: py - ph - 16 }, { x: px - pw - 20, y: py - ph - 16 }, { x: px + 20, y: py + 16 }, { x: px - pw - 20, y: py + 16 }];
    const clamp = (n, max) => Math.max(8, Math.min(max - 8, n));
    const safest = candidates.map(p => ({ x: clamp(p.x, box.width), y: clamp(p.y, box.height) })).sort((a, b) => {
      const distance = p => Math.hypot(Math.max(p.x - px, 0, px - p.x - pw), Math.max(p.y - py, 0, py - p.y - ph));
      return distance(a) - distance(b);
    })[0];
    popup.style.left = `${safest.x}px`; popup.style.top = `${safest.y}px`;
  }

  let positioned = [];
  function render() {
    const box = root.getBoundingClientRect(), svgBox = svg.getBoundingClientRect();
    width = Math.max(1, svgBox.width || box.width || 900); height = Math.max(1, svgBox.height || box.height || 540);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const world = layoutStarMap(currentNodes, { width, height, rootNodeId: currentRootId });
    positioned = mode === 'orbit' ? projectStarMap(world, { yaw: orbitYaw, pitch: orbitPitch, zoom: orbitZoom, panX: orbitPanX, panY: orbitPanY, width, height }) : world.map(node => ({ ...node, screenX: node.x, screenY: node.y }));
    const worldById = new Map(world.map(node => [node.id, node]));
    const lineage = lineageFor(currentNodes, currentSelected, currentRootId);
    const positions = new Map(positioned.map(node => [node.id, node]));
    const axisY = height - 58; axis.replaceChildren(); edges.replaceChildren(); stars.replaceChildren(); grid.replaceChildren();
    for (let i = 1; i < 9; i++) grid.append(svgElement(doc, 'path', { d: `M${i * width / 9} 56V${axisY}` }));
    const dated = world.map(node => node.yearCoordinate).filter(Number.isFinite), minYear = dated.length ? Math.min(...dated) : null, maxYear = dated.length ? Math.max(...dated) : null;
    const axisStart = width * .075, axisEnd = width * .925;
    axis.append(svgElement(doc, 'path', { class: 'time-axis-line', d: `M${axisStart} ${axisY}H${axisEnd}` }));
    axis.append(svgElement(doc, 'path', { class: 'time-axis-tick', d: `M${axisStart} ${axisY - 5}V${axisY + 5}M${axisEnd} ${axisY - 5}V${axisY + 5}` }));
    if (minYear != null) {
      for (let i = 0; i <= 4; i++) {
        const year = minYear + (maxYear - minYear) * i / 4, x = axisStart + (axisEnd - axisStart) * i / 4;
        axis.append(svgElement(doc, 'path', { class: 'time-axis-tick', d: `M${x} ${axisY - 4}V${axisY + 4}` }));
        if (i === 0 || i === 4 || i === 2) { const label = svgElement(doc, 'text', { class: 'time-axis-label', x, y: axisY + 22, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' }); label.textContent = formatStarMapYear(Math.round(year <= 0 ? year - 1 : year)); axis.append(label); }
      }
    }
    const axisTitle = svgElement(doc, 'text', { class: 'time-axis-title', x: width / 2, y: axisY - 12, 'text-anchor': 'middle' }); axisTitle.textContent = 'CALENDAR YEAR · OLDER TO LATER'; axis.append(axisTitle);
    for (const node of positioned) {
      const parent = positions.get(String(node.parentId ?? ''));
      if (!parent) continue;
      const highlighted = lineage.has(node.id) && lineage.has(parent.id);
      const midX = (parent.screenX + node.screenX) / 2, curve = mode === 'flat' ? `M${parent.screenX} ${parent.screenY} C${midX} ${parent.screenY},${midX} ${node.screenY},${node.screenX} ${node.screenY}` : `M${parent.screenX} ${parent.screenY} Q${midX} ${(parent.screenY + node.screenY) / 2 - 8},${node.screenX} ${node.screenY}`;
      edges.append(svgElement(doc, 'path', { class: `map-edge${highlighted ? ' is-selected-lineage' : ''}`, d: curve }));
    }
    const titleText = 'CALENDAR YEAR · OLDER TO LATER';
    const titleWidth = measureMapText(titleText, 11, 700) + titleText.length * 11 * .08 + 4;
    const titleRect = { left: width / 2 - titleWidth / 2, right: width / 2 + titleWidth / 2, top: axisY - 28, bottom: axisY - 5 };
    const placements = placeStarMapLabels(positioned.map(node => ({ ...node, x: node.screenX, y: node.screenY })), width, height, { selectedId: currentSelected, hoverId, focusedId: focusId, lineageIds: lineage, measureText: measureMapText, reservedRects: [titleRect] });
    const selectedNode = worldById.get(currentSelected);
    for (const node of positioned) {
      const state = getStarMapNodeState(node), isSelected = node.id === currentSelected, inLineage = lineage.has(node.id), inOtherTree = node.otherTree === true || (node.otherTree !== false && !!selectedNode && !inLineage);
      const cssState = state === 'saved-unexplored' ? 'is-saved-unexplored' : state === 'root-question' ? 'is-root-question' : state === 'generating' ? 'is-generating' : state === 'unavailable' ? 'is-unavailable' : 'is-explored';
      const selectable = node.selectable !== false, placement = placements.get(node.id) || { hidden: true };
      const labelClass = `star-label${placement.hidden ? ' map-label-hidden' : ''}`;
      const accessibleYear = node.isRootQuestion ? 'Root question' : node.isExpansionPlaceholder || node.role === 'generation-placeholder' ? 'Time unknown' : formatStarMapYear(node.year);
      const group = svgElement(doc, 'g', { class: `map-star ${cssState}${isSelected ? ' is-selected' : ''}${inLineage ? ' is-lineage' : ''}${inOtherTree ? ' is-other-tree' : ''}`, transform: `translate(${node.screenX} ${node.screenY})`, tabindex: selectable ? 0 : -1, role: 'button', 'aria-disabled': !selectable, 'aria-pressed': isSelected, 'aria-label': `${accessibleYear}: ${safeTitle(node)}. ${state.replace(/-/g, ' ')}${selectable ? '' : '. This story node is not available'}` });
      group.dataset.nodeId = node.id;
      group.append(svgElement(doc, 'circle', { class: 'map-hit', r: 22 }), svgElement(doc, 'circle', { class: 'star-halo', r: 11 }), svgElement(doc, 'circle', { class: 'star-core', r: state === 'root-question' ? 7.5 : 6 }));
      if (state === 'generating') {
        const particles = svgElement(doc, 'g', { class: 'cloud-particles', 'aria-hidden': 'true' });
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; particles.append(svgElement(doc, 'circle', { class: 'cloud-particle', cx: Math.cos(a) * 11, cy: Math.sin(a) * 11, r: 1.5 })); }
        group.append(particles);
      }
      const labelX = placement.x == null ? 16 : placement.x - node.screenX, labelY = placement.y == null ? -5 : placement.y - node.screenY;
      const label = svgElement(doc, 'text', { class: labelClass, x: labelX, y: labelY, 'text-anchor': placement.anchor || 'start' }); label.textContent = placement.text || safeTitle(node).slice(0, 42); group.append(label);
      const year = svgElement(doc, 'text', { class: `star-year${placement.hidden ? ' map-label-hidden' : ''}`, x: labelX, y: labelY + 16, 'text-anchor': placement.anchor || 'start' }); year.textContent = placement.year || (node.isRootQuestion ? 'Root question' : formatStarMapYear(node.year)); group.append(year);
      group.addEventListener('pointerenter', () => { clearDismiss(); hoverId = node.id; popupFor(node); });
      group.addEventListener('pointerleave', () => { if (!popupInside && !popupFocus) scheduleDismiss(); });
      group.addEventListener('focus', () => { clearDismiss(); focusId = node.id; popupFor(node); });
      group.addEventListener('blur', () => { if (focusId === node.id) focusId = null; if (!popupInside && !popupFocus) scheduleDismiss(0); });
      group.addEventListener('click', event => { event.stopPropagation(); choose(node); });
      group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(node); } });
      stars.append(group);
    }
    flatButton.setAttribute('aria-pressed', String(mode === 'flat')); orbitButton.setAttribute('aria-pressed', String(mode === 'orbit'));
    const generating = currentNodes.filter(node => getStarMapNodeState(node) === 'generating').length, unavailable = currentNodes.filter(node => getStarMapNodeState(node) === 'unavailable').length;
    live.textContent = `${currentNodes.length} events. ${generating} generating; ${unavailable} unavailable. Selected lineage highlighted in gold.`;
    const preview = byId().get(String(hoverId || focusId || previewId || ''));
    popupFor(preview || null);
  }

  root.addEventListener('pointerdown', event => {
    if (mode !== 'orbit' || event.target.closest?.('.map-view-controls,.map-popup,.map-star')) return;
    const pan = event.shiftKey || event.button === 2;
    if (event.button !== 0 && !pan) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, pan };
    root.setPointerCapture?.(event.pointerId);
    if (event.button === 2) event.preventDefault();
  });
  root.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (drag.pan) { orbitPanX += dx * width / Math.max(1, root.getBoundingClientRect().width); orbitPanY += dy * height / Math.max(1, root.getBoundingClientRect().height); }
    else { orbitYaw = Math.max(-0.72, Math.min(0.72, orbitYaw + dx * 0.008)); orbitPitch = Math.max(-0.68, Math.min(0.68, orbitPitch + dy * 0.008)); }
    drag.x = event.clientX; drag.y = event.clientY; render();
  });
  const stopDrag = () => { drag = null; };
  root.addEventListener('pointerup', stopDrag); root.addEventListener('pointercancel', stopDrag);
  root.addEventListener('contextmenu', event => { if (mode === 'orbit') event.preventDefault(); });
  root.addEventListener('wheel', event => {
    if (mode !== 'orbit' || event.target.closest?.('.map-popup')) return;
    event.preventDefault(); orbitZoom = Math.max(0.7, Math.min(1.35, orbitZoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1))); render();
  }, { passive: false });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { hoverId = null; focusId = null; previewId = null; popupInside = false; popupFocus = false; render(); return; }
    if (mode !== 'orbit' || event.target.closest?.('.map-popup')) return;
    const step = event.shiftKey ? 0.16 : 0.08;
    if (event.key === 'ArrowLeft') orbitYaw = Math.max(-0.72, orbitYaw - step);
    else if (event.key === 'ArrowRight') orbitYaw = Math.min(0.72, orbitYaw + step);
    else if (event.key === 'ArrowUp') orbitPitch = Math.max(-0.68, orbitPitch - step);
    else if (event.key === 'ArrowDown') orbitPitch = Math.min(0.68, orbitPitch + step);
    else if (event.key === '+' || event.key === '=') orbitZoom = Math.min(1.35, orbitZoom * 1.12);
    else if (event.key === '-') orbitZoom = Math.max(0.7, orbitZoom / 1.12);
    else if (event.key === 'Home') { orbitYaw = -0.22; orbitPitch = 0.18; orbitZoom = 1; orbitPanX = 0; orbitPanY = 0; }
    else return;
    event.preventDefault(); render();
  });
  const ResizeObserverClass = doc.defaultView?.ResizeObserver;
  const resizeObserver = ResizeObserverClass ? new ResizeObserverClass(() => { if (!destroyed) render(); }) : null; resizeObserver?.observe(root);
  const onWindowResize = () => { if (!destroyed) render(); }; doc.defaultView?.addEventListener('resize', onWindowResize);
  render();
  return {
    setData(next = {}) {
      if (destroyed) return;
      if (Array.isArray(next.nodes)) currentNodes = next.nodes;
      if ('selectedId' in next) currentSelected = next.selectedId == null ? null : String(next.selectedId);
      if ('rootNodeId' in next) currentRootId = next.rootNodeId == null ? null : String(next.rootNodeId);
      render();
    },
    select(id) { if (!destroyed) { currentSelected = id == null ? null : String(id); render(); } },
    destroy() { if (destroyed) return; destroyed = true; clearDismiss(); resizeObserver?.disconnect(); doc.defaultView?.removeEventListener('resize', onWindowResize); root.remove(); },
  };
}
