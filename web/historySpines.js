import { composeGeography } from './historyModel.js';

const validYear = value => Number.isSafeInteger(value) && value !== 0;
const validEvent = event => event && typeof event === 'object' && typeof event.id === 'string' && validYear(event.year);
const ordered = events => [...(events || [])].filter(validEvent)
  .sort((a, b) => a.year - b.year || String(a.id).localeCompare(String(b.id)));
const idPart = value => encodeURIComponent(String(value ?? ''));
const eventNodeId = (questionId, eventId) => `event:${idPart(questionId)}:${idPart(eventId)}`;
const trunkNodeId = questionId => `trunk:${idPart(questionId)}`;
const makeForkNodeId = (questionId, historyId, eventId, year) => `fork:${idPart(questionId)}:${idPart(historyId)}:${idPart(eventId)}:${year}`;
const byId = (a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''));

function commonPrefixLength(left, right) {
  let index = 0;
  while (index < left.length && index < right.length && left[index].id === right[index].id) index++;
  return index;
}

function historyForkYear(history, histories) {
  if (validYear(history?.origin?.forkYear)) return history.origin.forkYear;
  const fork = histories.flatMap(candidate => candidate.events || []).find(event => event.id === history?.forkEventId);
  if (validYear(fork?.year)) return fork.year;
  return validYear(history?.origin?.replacedEvent?.year) ? history.origin.replacedEvent.year : null;
}

function questionDivergenceYear(question, histories) {
  if (validYear(question?.divergenceYear)) return question.divergenceYear;
  const forkYears = histories.map(history => historyForkYear(history, histories)).filter(validYear);
  const divergenceYears = [];
  for (let index = 1; index < histories.length; index++) {
    const history = histories[index];
    const parent = histories.find(item => item.id === history.forkedFromHistoryId) || histories[0];
    const events = ordered(history.events), parentEvents = ordered(parent.events);
    const shared = commonPrefixLength(parentEvents, events);
    const divergentYears = [events[shared]?.year, parentEvents[shared]?.year].filter(validYear);
    divergenceYears.push(...divergentYears);
  }
  if (forkYears.length || divergenceYears.length) return Math.min(...forkYears, ...divergenceYears);
  const earliestDivergence = histories.map(history => ordered(history.events)[0]?.year).filter(validYear);
  return earliestDivergence.length ? Math.min(...earliestDivergence) : null;
}

function currentWindowSuggestions(history, window, suppliedSuggestions = null) {
  if (!window || !validYear(window.fromYear) || !validYear(window.toYear) || window.fromYear > window.toYear) return [];
  const items = Array.isArray(suppliedSuggestions) ? suppliedSuggestions : (history.suggestions || []);
  return items.filter(item => validYear(item?.year)
    && item.year >= window.fromYear && item.year <= window.toYear
    && (Array.isArray(suppliedSuggestions) || item.window?.fromYear === window.fromYear && item.window?.toYear === window.toYear)
    && (item.historyId == null || String(item.historyId) === String(history.id)))
    .sort((a, b) => a.year - b.year || byId(a, b))
    .map(item => ({ ...item, historyId: history.id, questionId: history.questionId }));
}

function historySnapshot(history, asOfYear) {
  const events = ordered(history.events).filter(event => event.year <= asOfYear);
  return {
    id: `history-earth:${idPart(history.id)}`,
    historyId: String(history.id),
    title: history.title || history.name || `History ${history.id}`,
    asOfYear,
    events,
    latestEvent: events.at(-1) ?? null,
    geography: composeGeography(events, asOfYear),
  };
}

/**
 * Lay out histories as chronological spines. Shared event IDs get one canonical node;
 * forks reference that node directly rather than creating a routed parent/child graph.
 * Coordinates use signed years on x and a small deterministic lane rise on y.
 */
export function buildHistorySpineLayout({ questions = [], activeQuestionId, activeHistoryId, asOfYear, window = null, suggestions = null } = {}) {
  if (!Array.isArray(questions)) throw new Error('History spine layout requires a questions array');
  if (asOfYear != null && !validYear(asOfYear)) throw new Error('Atlas date must be a nonzero integer year');
  const activeQuestion = questions.find(question => String(question?.id) === String(activeQuestionId)) || null;
  const activeHistory = activeQuestion?.histories?.find(history => String(history.id) === String(activeHistoryId)) || activeQuestion?.histories?.[0] || null;
  const visibleQuestions = activeQuestion ? [activeQuestion] : [];
  const nodes = [], segments = [], spines = [], trunkNodes = [], nodeById = new Map();
  let activeTrunkNodeIds = [];

  for (const question of visibleQuestions) {
    const qid = String(question.id);
    const histories = Array.isArray(question.histories) ? question.histories : [];
    const divergenceYear = questionDivergenceYear(question, histories);
    const historiesInOrder = [...histories];
    const primary = historiesInOrder[0] || null;
    const primaryEvents = primary ? ordered(primary.events) : [];
    const trunkEventCutoff = divergenceYear;
    const trunkEvents = validYear(trunkEventCutoff) ? primaryEvents.filter(event => event.year < trunkEventCutoff) : [];
    const anchorYear = validYear(divergenceYear) ? divergenceYear : (primaryEvents[0]?.year ?? asOfYear ?? 1);

    const addEventNode = (history, event, lane, shared = false, riseIndex = 0) => {
      const id = eventNodeId(qid, event.id);
      if (nodeById.has(id)) return nodeById.get(id);
      const historyEvents = ordered(history.events);
      const node = {
        id, questionId: qid, historyId: String(shared ? activeHistory.id : history.id), eventId: event.id,
        // Time is projected along the horizontal axis. Keep each history on a
        // bounded lane; event count must not turn into thousands of units of
        // vertical camera framing on long histories.
        year: event.year, x: event.year, y: lane, kind: 'event',
        title: event.title ?? '', shared, role: history.id === activeHistory.id ? 'active' : 'sibling',
        event: { ...event },
        geography: composeGeography(historyEvents, event.year),
        ...(event.sceneRef !== undefined ? { sceneRef: event.sceneRef } : {}),
        ...(event.cutoutRef !== undefined ? { cutoutRef: event.cutoutRef } : {}),
        ...(event.modelRef !== undefined ? { modelRef: event.modelRef } : {}),
        ...(event.heroRef !== undefined ? { heroRef: event.heroRef } : {}),
      };
      nodeById.set(id, node); nodes.push(node); return node;
    };

    for (const [index, event] of trunkEvents.entries()) {
      const node = addEventNode(primary, event, 0, true);
      trunkNodes.push(node.id);
      if (index) segments.push({ id: `segment:${idPart(qid)}:trunk:${index}`, questionId: qid,
        historyId: String(primary.id), fromNodeId: trunkNodes[index - 1], toNodeId: node.id, kind: 'trunk' });
    }
    const anchorId = trunkNodeId(qid);
    const anchor = { id: anchorId, questionId: qid, kind: 'question-divergence', year: anchorYear,
      x: anchorYear, y: 0, ...(validYear(divergenceYear) ? { explicitYear: question.divergenceYear } : {}) };
    nodes.push(anchor); nodeById.set(anchorId, anchor);
    if (trunkNodes.length) segments.push({ id: `segment:${idPart(qid)}:trunk:divergence`, questionId: qid,
      historyId: String(primary.id), fromNodeId: trunkNodes.at(-1), toNodeId: anchorId, kind: 'trunk' });
    activeTrunkNodeIds = [...trunkNodes, anchorId];
    for (const [historyIndex, history] of historiesInOrder.entries()) {
      const events = ordered(history.events);
      const parent = historiesInOrder.find(item => item.id === history.forkedFromHistoryId)
        || (historyIndex ? primary : null);
      const parentEvents = parent ? ordered(parent.events) : [];
      const sharedLength = parent ? commonPrefixLength(parentEvents, events) : 0;
      const forkEventId = typeof history.forkEventId === 'string' ? history.forkEventId : '';
      const forkYear = historyIndex ? historyForkYear(history, historiesInOrder) : null;
      const sharedIds = new Set(events.slice(0, sharedLength)
        .filter(event => !validYear(forkYear) || event.year < forkYear).map(event => event.id));
      const forkSource = forkEventId ? historiesInOrder.flatMap(candidate => candidate.events || [])
        .find(event => event.id === forkEventId) : null;
      const sharedEnd = [...events].reverse().find(event => sharedIds.has(event.id)) || null;
      const needsYearAnchor = validYear(forkYear) && (!forkSource || forkSource.year !== forkYear);
      let forkNodeId = needsYearAnchor ? makeForkNodeId(qid, history.id, forkEventId, forkYear)
        : forkSource ? eventNodeId(qid, forkSource.id)
          : sharedEnd ? eventNodeId(qid, sharedEnd.id) : anchorId;
      if (needsYearAnchor && !nodeById.has(forkNodeId)) {
        const forkAnchor = { id: forkNodeId, questionId: qid, historyId: String(history.id), eventId: forkEventId,
          year: forkYear, x: forkYear, y: historyIndex + 1, kind: 'history-fork', title: '', synthetic: true };
        nodeById.set(forkNodeId, forkAnchor); nodes.push(forkAnchor);
      } else if (forkSource && !nodeById.has(forkNodeId)) {
        const forkOwner = historiesInOrder.find(candidate => candidate.events?.some(event => event.id === forkSource.id)) || parent || history;
        addEventNode(forkOwner, forkSource, historyIndex, true);
      }
      const lane = historyIndex === 0 ? 1 : historyIndex + 1;
      const uniqueEvents = events.filter(event => !sharedIds.has(event.id));
      // The first history's pre-divergence record is already part of the real-history trunk.
      const tailEvents = historyIndex === 0 && validYear(divergenceYear)
        ? uniqueEvents.filter(event => event.year >= divergenceYear) : uniqueEvents;
      const spineNodeIds = [];
      for (const [eventIndex, event] of tailEvents.entries()) spineNodeIds.push(addEventNode(history, event, lane, false, eventIndex).id);

      const branchStart = forkSource ? forkNodeId : (historyIndex === 0 ? anchorId : forkNodeId);
      if (needsYearAnchor) {
        const priorNodeId = sharedEnd ? eventNodeId(qid, sharedEnd.id) : null;
        const prior = priorNodeId ? nodeById.get(priorNodeId) : null;
        const forkAnchor = nodeById.get(forkNodeId);
        if (prior && prior.year < forkYear) segments.push({ id: `segment:${idPart(qid)}:${idPart(history.id)}:fork-anchor`,
          questionId: qid, historyId: String(history.id), fromNodeId: priorNodeId, toNodeId: forkNodeId, kind: 'fork-anchor' });
        else if (!sharedEnd && validYear(anchorYear) && anchorYear < forkYear) segments.push({ id: `segment:${idPart(qid)}:${idPart(history.id)}:fork-anchor`,
          questionId: qid, historyId: String(history.id), fromNodeId: anchorId, toNodeId: forkNodeId, kind: 'fork-anchor' });
        if (!Number.isFinite(forkAnchor?.x) || !Number.isFinite(forkAnchor?.y)) throw new Error(`History fork ${history.id} has invalid coordinates`);
      }
      let previousNodeId = branchStart;
      let ordinal = 0;
      for (const nodeId of spineNodeIds) {
        const from = nodeById.get(previousNodeId), to = nodeById.get(nodeId);
        segments.push({ id: `segment:${idPart(qid)}:${idPart(history.id)}:${ordinal++}`,
          questionId: qid, historyId: String(history.id), fromNodeId: previousNodeId, toNodeId: nodeId,
          kind: previousNodeId === branchStart ? 'spine-start' : 'spine' });
        // Same-year events are valid; only reject impossible chronological wiring.
        if (from && to && to.year < from.year) throw new Error(`History spine ${history.id} is not chronological`);
        previousNodeId = nodeId;
      }
      const selected = String(history.id) === String(activeHistory?.id);
      spines.push({ questionId: qid, historyId: String(history.id), role: selected ? 'active' : 'sibling',
        lane, forkEventId: forkEventId || null, forkYear: validYear(forkYear) ? forkYear : null, forkNodeId: branchStart,
        sharedEventIds: [...sharedIds], nodeIds: spineNodeIds, segments: segments.filter(segment => segment.historyId === String(history.id)),
        suggestions: selected ? currentWindowSuggestions({ ...history, questionId: qid }, window, suggestions) : [] });
    }
  }

  const chips = questions.filter(question => String(question?.id) !== String(activeQuestion?.id)).map(question => {
    const histories = Array.isArray(question.histories) ? question.histories : [];
    const title = question.question || question.title || String(question.id);
    const label = title;
    return { id: `question-chip:${idPart(question.id)}`, questionId: String(question.id), title, origin:question.origin ?? null,
      place:question.divergencePlace ?? question.place ?? null,
      label: `${label} · ${histories.length} ${histories.length === 1 ? 'history' : 'histories'}`,
      historyCount: histories.length, year: questionDivergenceYear(question, histories),
      x: questionDivergenceYear(question, histories), y: 0 };
  });

  return { asOfYear: asOfYear ?? null, window: window ? { ...window } : null,
    siblingEarths: visibleQuestions.length && asOfYear != null
      ? visibleQuestions[0].histories.filter(history => String(history.id) !== String(activeHistory?.id)).map(history => historySnapshot(history, asOfYear))
      : [],
    trunk: visibleQuestions.length ? (() => {
      // Keep the trunk as a single semantic axis with question-specific divergence anchors.
      const question = visibleQuestions[0];
      return { id: `real-history-trunk:${idPart(question.id)}`, questionId: String(question.id),
        nodeIds: [...activeTrunkNodeIds],
        divergenceYear: questionDivergenceYear(question, question.histories || []),
        divergenceNodeId: trunkNodeId(question.id) };
    })() : { id: 'real-history-trunk', questionId: null, nodeIds: [], divergenceYear: null, divergenceNodeId: null },
    spines, nodes, segments, chips };
}

/** Map signed years and deterministic lane indices to a bounded Atlas plane. */
export function projectHistorySpineGeometry(layout, { width = 7.2, laneSpacing = 0.78 } = {}) {
  const nodes = Array.isArray(layout?.nodes) ? layout.nodes : [];
  const years = nodes.map(node => Number(node.year)).filter(Number.isFinite);
  const minimum = years.length ? Math.min(...years) : 0;
  const maximum = years.length ? Math.max(...years) : minimum;
  const span = Math.max(1, maximum - minimum);
  const positions = nodes.map(node => ({
    id: node.id,
    x: ((Number(node.year) - minimum) / span - 0.5) * width,
    y: Number(node.y || 0) * laneSpacing,
    z: node.kind === 'history-fork' ? 0.08 : 0,
  }));
  const positionById = new Map(positions.map(point => [point.id, point]));
  const segments = [];
  if (layout?.trunk?.divergenceNodeId && positionById.has(layout.trunk.divergenceNodeId)) {
    segments.push({ id:String(layout.trunk.id || 'real-history-trunk'), kind:'real-history-trunk', historyId:null,
      from:{ x:-Math.abs(width) / 2, y:0, z:0 }, to:{ x:Math.abs(width) / 2, y:0, z:0 } });
  }
  segments.push(...(Array.isArray(layout?.segments) ? layout.segments : []).flatMap(segment => {
    const from = positionById.get(segment.fromNodeId), to = positionById.get(segment.toNodeId);
    return from && to ? [{ id: segment.id, kind: segment.kind, historyId: segment.historyId, from: { ...from }, to: { ...to } }] : [];
  }));
  const halfWidth = Math.max(0.5, Math.abs(Number(width) || 7.2) / 2);
  const chips = (Array.isArray(layout?.chips) ? layout.chips : []).map(chip => {
    const rawX = chip.x != null && Number.isFinite(Number(chip.x))
      ? ((Number(chip.x) - minimum) / span - 0.5) * width : halfWidth;
    return { ...chip, edge:rawX < -halfWidth ? 'past' : rawX > halfWidth ? 'future' : 'within',
      x:Math.max(-halfWidth, Math.min(halfWidth, rawX)), y:0 };
  });
  return { positions, segments, chips };
}

/** Materialize independent scene records from a spine projection; never add parent/child tree links. */
export function buildHistorySceneRecords(projection) {
  const layout = projection?.spineLayout || { nodes:[], siblingEarths:[] };
  const questionId = String(projection?.questionId ?? '');
  const latestEventId = String(projection?.latestEvent?.id || '');
  const pinsById = new Map((projection?.pins || []).map(item => [String(item.id), item]));
  const eventsById = new Map();
  for (const node of layout.nodes || []) {
    if (node.kind !== 'event' || !node.event?.id) continue;
    const id = String(node.event.id);
    const role = node.shared ? 'trunk' : node.role;
    eventsById.set(id, {
      ...node.event,
      ...(pinsById.get(id) || {}),
      id, questionId, historyId:String(pinsById.get(id)?.historyId ?? node.historyId), parentId:null,
      lat:Number(node.event.lat ?? node.event.place?.lat), lon:Number(node.event.lon ?? node.event.place?.lon),
      year:node.year, historySpineNodeId:node.id, historySpineRole:role,
      visualKind:pinsById.has(id) ? 'history-event' : (role === 'sibling' ? 'history-spine-sibling' : 'history-spine-event'),
      highlighted:pinsById.has(id) ? pinsById.get(id).highlighted === true
        : String(node.event.id) === latestEventId && String(node.historyId) === String(projection.historyId),
      historySurfacePin:pinsById.has(id), selectable:role !== 'sibling',
    });
  }
  const suggestions = (projection?.suggestions || []).map(item => ({
    ...item, id:String(item.id), questionId, parentId:null, historySurfacePin:true,
    lat:Number(item.lat ?? item.place?.lat), lon:Number(item.lon ?? item.place?.lon), selectable:true,
  }));
  const siblingEarths = (projection?.siblingEarths || layout.siblingEarths || []).map(snapshot => {
    const latest = snapshot.latestEvent || {};
    return { ...latest, id:snapshot.id, title:snapshot.title, questionId, historyId:snapshot.historyId,
      parentId:null, year:projection.asOfYear, asOfYear:projection.asOfYear,
      lat:Number(latest.lat ?? latest.place?.lat), lon:Number(latest.lon ?? latest.place?.lon),
      geography:snapshot.geography, visualKind:'history-sibling', historySurfacePin:false,
      selectable:true, selectableHistoryId:snapshot.historyId };
  });
  return { eventWorlds:[...eventsById.values()], suggestionWorlds:suggestions, siblingEarths };
}
