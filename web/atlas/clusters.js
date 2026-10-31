export const DEFAULT_SURFACE_LABEL_LIMIT = 3;
export const DEFAULT_ORBIT_UNFOLDED_LIMIT = 2;

const idOf = world => world?.id == null || String(world.id).trim() === '' ? null : String(world.id);
const clampLimit = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(7, Math.trunc(Number(value)))) : fallback;
const scoreOf = world => {
  for (const value of [world?.provenance?.reviewScore, world?.reviewScore, world?.score]) {
    if (Number.isFinite(value)) return value;
  }
  return Number.isFinite(world?.boldness) ? world.boldness * 10 : 0;
};
const isPending = world => world?.isExpansionPlaceholder === true || world?.role === 'generation-placeholder'
  || (world?.mapState === 'generating' && world?.selectable === false);
const isExplored = world => world?.explored === true || world?.hasChildren === true
  || world?.mapState === 'explored' || world?.status === 'explored';

function ranked(worlds) {
  return worlds.sort((a, b) => scoreOf(b) - scoreOf(a)
    || (Number(a.year) || 0) - (Number(b.year) || 0)
    || idOf(a).localeCompare(idOf(b)));
}

function centroid(members, parent) {
  const valid = members.filter(world => Number.isFinite(world.lat) && Number.isFinite(world.lon));
  if (!valid.length) return {
    lat: Number.isFinite(parent?.lat) ? parent.lat : 0,
    lon: Number.isFinite(parent?.lon) ? parent.lon : 0,
  };
  let x = 0, y = 0, z = 0;
  for (const world of valid) {
    const latitude = world.lat * Math.PI / 180, longitude = world.lon * Math.PI / 180;
    x += Math.cos(latitude) * Math.cos(longitude);
    y += Math.cos(latitude) * Math.sin(longitude);
    z += Math.sin(latitude);
  }
  const length = Math.hypot(x, y, z);
  if (length < 1e-9) return { lat: Number.isFinite(parent?.lat) ? parent.lat : 0, lon: Number.isFinite(parent?.lon) ? parent.lon : 0 };
  return { lat: Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI, lon: Math.atan2(y, x) * 180 / Math.PI };
}

function cluster(kind, parent, members, label, selectable = true) {
  const parentId = idOf(parent);
  return {
    id: `cluster:${kind}:${parentId}`,
    kind,
    parentId,
    anchorId: parentId,
    questionId: parent?.questionId == null ? null : String(parent.questionId),
    memberIds: members.map(idOf),
    count: members.length,
    label,
    centroid: centroid(members, parent),
    coordinateSpace: 'geographic',
    selectable,
    color: 'cyan',
  };
}

/** Pure surface-pin and Orbit-cloud plan. Cluster members retain their canonical IDs. */
export function planWorldClusters(worlds = [], currentWorldId, {
  surfaceLabelLevel = DEFAULT_SURFACE_LABEL_LIMIT,
  orbitLevel = DEFAULT_ORBIT_UNFOLDED_LIMIT,
  hoveredClusterId = null,
} = {}) {
  const records = (Array.isArray(worlds) ? worlds : []).filter(world => idOf(world));
  const byId = new Map(records.map(world => [idOf(world), world]));
  const parent = byId.get(String(currentWorldId ?? '')) ?? null;
  const children = parent ? records.filter(world => String(world.parentId ?? '') === String(currentWorldId)) : [];
  const savedChildren = ranked(children.filter(world => !isPending(world)));
  const surfaceLimit = clampLimit(surfaceLabelLevel, DEFAULT_SURFACE_LABEL_LIMIT);
  const orbitLimit = clampLimit(orbitLevel, DEFAULT_ORBIT_UNFOLDED_LIMIT);

  const surfaceOverflow = savedChildren.slice(surfaceLimit);
  const surfaceCluster = surfaceOverflow.length
    ? cluster('surface-overflow', parent, surfaceOverflow, `+${surfaceOverflow.length}`) : null;
  const surfaceExpanded = surfaceCluster?.id === hoveredClusterId;
  const surfaceVisible = new Set(savedChildren.slice(0, surfaceLimit).map(idOf));
  if (surfaceExpanded) for (const id of surfaceCluster.memberIds) surfaceVisible.add(id);
  const surfaceClusters = surfaceCluster && !surfaceExpanded ? [surfaceCluster] : [];

  const childrenByParent = new Map();
  for (const world of records) {
    if (world.parentId == null) continue;
    const key = String(world.parentId);
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(world);
  }
  const orbitVisible = new Set();
  const orbitClusters = [];
  const orbitClustered = [];
  let fannedOrbitClusterId = null;
  for (const [parentId, childRecords] of childrenByParent) {
    const orbitParent = byId.get(parentId) ?? { id: parentId, questionId: childRecords[0]?.questionId };
    const groupedPending = ranked(childRecords.filter(isPending));
    const saved = ranked(childRecords.filter(world => !isPending(world)));
    const explored = saved.filter(isExplored);
    const unentered = saved.filter(world => !isExplored(world));
    for (const world of explored) orbitVisible.add(idOf(world));
    for (const world of unentered.slice(0, orbitLimit)) orbitVisible.add(idOf(world));

    const overflow = unentered.slice(orbitLimit);
    if (overflow.length) {
      const cloud = cluster('orbit-overflow', orbitParent, overflow, `${overflow.length} possibilities`);
      if (cloud.id === hoveredClusterId) {
        fannedOrbitClusterId = cloud.id;
        for (const id of cloud.memberIds) orbitVisible.add(id);
      } else {
        orbitClusters.push(cloud); orbitClustered.push(...cloud.memberIds);
      }
    }
    if (groupedPending.length) {
      const cloud = cluster('generation-pending', orbitParent, groupedPending, `${groupedPending.length} pending`, false);
      if (cloud.id === hoveredClusterId) {
        fannedOrbitClusterId = cloud.id;
        for (const id of cloud.memberIds) orbitVisible.add(id);
      } else {
        orbitClusters.push(cloud); orbitClustered.push(...cloud.memberIds);
      }
    }
  }

  return {
    parentId: idOf(parent),
    questionId: parent?.questionId == null ? null : String(parent.questionId),
    surface: {
      visibleIds: [...surfaceVisible],
      clusteredIds: surfaceExpanded ? [] : surfaceCluster?.memberIds ?? [],
      clusters: surfaceClusters,
      fannedClusterId: surfaceExpanded ? surfaceCluster.id : null,
    },
    orbit: {
      visibleIds: [...orbitVisible],
      clusteredIds: orbitClustered,
      clusters: orbitClusters,
      fannedClusterId: fannedOrbitClusterId,
    },
  };
}
