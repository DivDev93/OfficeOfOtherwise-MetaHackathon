import test from 'node:test';
import assert from 'node:assert/strict';
import {
  altitudeForZoom, atlasZoomState, layoutAtlasWorlds, layoutOrbitNeighborhood,
} from '../web/atlasLayout.js';
import {
  buildAtlasTimeline, transformAtlasEdgeShape,
} from '../web/atlas/p2Atlas.js';
import { interpolateAttachedAtlasEdgeRoute } from '../web/atlas/routeMorph.js';

const lerp = (a, b, t) => ({
  x:a.x + (b.x - a.x) * t,
  y:a.y + (b.y - a.y) * t,
  z:(a.z || 0) + ((b.z || 0) - (a.z || 0)) * t,
});

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function properSegmentIntersection(a, b, c, d) {
  const epsilon = 1e-9;
  const abC = orientation(a, b, c), abD = orientation(a, b, d);
  const cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  return ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon));
}

function projectPerspective(point, zoom, { width = 1280, height = 800, fovDegrees = 38 } = {}) {
  const cameraDistance = altitudeForZoom(zoom);
  const depth = Math.max(0.01, cameraDistance - (point.z || 0));
  const focal = height / (2 * Math.tan(fovDegrees * Math.PI / 360));
  return { x:width / 2 + point.x * focal / depth, y:height / 2 - point.y * focal / depth };
}

function countProjectedCrossings(paths, zoom) {
  const projected = paths.map(path => ({
    ...path,
    points:path.points.map(point => projectPerspective(point, zoom)),
  }));
  const crossings = [];
  for (let first = 0; first < projected.length; first++) {
    for (let second = first + 1; second < projected.length; second++) {
      const a = projected[first], b = projected[second];
      if ([a.parentId, a.childId].some(id => [b.parentId, b.childId].includes(id))) continue;
      let hit = false;
      for (let i = 0; i < a.points.length - 1 && !hit; i++) {
        for (let j = 0; j < b.points.length - 1; j++) {
          if (properSegmentIntersection(a.points[i], a.points[i + 1], b.points[j], b.points[j + 1])) {
            hit = true;
            break;
          }
        }
      }
      if (hit) crossings.push(`${a.parentId}->${a.childId}|${b.parentId}->${b.childId}`);
    }
  }
  return crossings;
}

// This deterministic simplified model projects route centerlines through 101 zoom
// samples using zoom-derived camera distance and a fixed 38-degree perspective. It does
// not model production camera fit/focus, mobile view offsets, viewport frameAspect, or
// clustered overflow visibility; it also omits pin radii, counts only proper crossings
// between edges without a shared endpoint, and can miss crossings between samples.
// Its counts are regression measurements for this model, not production-projected
// pixels or a pixel-perfect overlap / continuous-time proof.
function makeRepresentativeGraph() {
  const worlds = [
    { id:'ancestor', parentId:null, questionId:'q', year:800, reviewScore:0.9 },
    { id:'sibling-west', parentId:'ancestor', questionId:'q', year:1050, reviewScore:0.4 },
    { id:'current', parentId:'ancestor', questionId:'q', year:1100, reviewScore:0.95 },
    { id:'sibling-east', parentId:'ancestor', questionId:'q', year:1150, reviewScore:0.7 },
    ...Array.from({ length:7 }, (_, index) => ({
      id:`child-${index + 1}`, parentId:'current', questionId:'q',
      year:1250 + index * 115, reviewScore:((index * 37) % 89) / 100,
    })),
  ];
  return { worlds, questions:[{ id:'q', divergenceYear:800 }] };
}

function transitionRoutes(graph, currentId, progress) {
  const entries = layoutAtlasWorlds(graph.worlds, currentId);
  const orbit = layoutOrbitNeighborhood(entries, currentId);
  const timeline = buildAtlasTimeline(graph, currentId, 'history-distance', { expandedQuestionIds:['q'] });
  const atlasById = new Map(timeline.worlds.map(entry => [String(entry.id), entry]));
  const activeEdges = timeline.parentChildPaths.filter(path =>
    (path.parentId === 'ancestor' && ['sibling-west', 'current', 'sibling-east'].includes(path.childId))
    || (path.parentId === 'current' && path.childId.startsWith('child-')));

  return activeEdges.map(path => {
    const parentOrbit = orbit.get(path.parentId) || entries.find(entry => entry.id === path.parentId)?.atlas;
    const childOrbit = orbit.get(path.childId) || entries.find(entry => entry.id === path.childId)?.atlas;
    const parentAtlas = atlasById.get(path.parentId);
    const childAtlas = atlasById.get(path.childId);
    const sourceFrom = { ...parentOrbit };
    const sourceTo = { ...childOrbit };
    const currentFrom = lerp(sourceFrom, parentAtlas, progress);
    const currentTo = lerp(sourceTo, childAtlas, progress);
    const target = transformAtlasEdgeShape(parentAtlas, childAtlas, path.routeShape);
    const helperRoute = interpolateAttachedAtlasEdgeRoute(sourceFrom, sourceTo, target, progress,
      { from:currentFrom, to:currentTo, easeInterior:true });
    return { parentId:path.parentId, childId:path.childId, points:helperRoute };
  });
}

test('measures simplified-model active-tree route intersections through Orbit-to-Atlas zoom', () => {
  const graph = makeRepresentativeGraph();
  const currentId = 'current';
  const entries = layoutAtlasWorlds(graph.worlds, currentId);
  const timeline = buildAtlasTimeline(graph, currentId, 'history-distance', { expandedQuestionIds:['q'] });
  assert.ok(entries.length === graph.worlds.length);
  assert.ok(timeline.parentChildPaths.length >= 10, 'fixture exercises actual routed parent-child paths');

  const frames = [];
  for (let index = 0; index <= 100; index++) {
    const zoom = 0.84 + index / 100 * 0.16;
    const progress = atlasZoomState(zoom).atlas;
    const paths = transitionRoutes(graph, currentId, progress);
    frames.push({ progress, zoom, crossings:countProjectedCrossings(paths, zoom) });
  }

  const crossingFrames = frames.filter(frame => frame.crossings.length);
  const maxCrossings = Math.max(0, ...frames.map(frame => frame.crossings.length));
  const peakFrame = frames.find(frame => frame.crossings.length === maxCrossings) || null;
  const crossingPairObservations = frames.reduce((total, frame) => total + frame.crossings.length, 0);
  const measurements = `measured ${crossingFrames.length}/101 crossing frames, ${crossingPairObservations} pair-frame observations, peak ${maxCrossings} at zoom=${peakFrame?.zoom}`;
  assert.ok(crossingFrames.length <= 26, `${measurements}; limit is 26 frames`);
  assert.ok(crossingPairObservations <= 200, `${measurements}; limit is 200 pair-frame observations`);
  assert.ok(maxCrossings <= 14, `${measurements}; limit is 14 simultaneous edge pairs`);
});
