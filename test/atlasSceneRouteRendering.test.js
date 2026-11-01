import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { interpolateAttachedAtlasEdgeRoute } from '../web/atlas/routeMorph.js';

const scene = readFileSync(new URL('../web/atlas/scene.js', import.meta.url), 'utf8');
const p2Renderer = readFileSync(new URL('../web/atlas/p2Renderer.js', import.meta.url), 'utf8');

test('Atlas renders exact routed corners and preserves them through axis changes', () => {
  assert.match(scene, /transformAtlasEdgeShape/);
  assert.match(scene, /transformAtlasEdgeShape\(atlasFrom, atlasTo, path\.routeShape\)/,
    'Atlas routes are built in their settled endpoint coordinates');
  assert.match(scene, /interpolateAttachedAtlasEdgeRoute\(orbitFrom, orbitTo, atlasCurve,[\s\S]*\{ from, to \}\)/,
    'the Orbit chord morphs to the settled route while staying attached to live endpoints');
  assert.match(scene, /routeVertexFractions\(previousBasis\)[\s\S]*routeVertexFractions\(nextBasis\)/,
    'axis morphs include the cumulative-arc fraction of every old and new corner');
  assert.match(scene, /return fractions\.map\(fraction => \{[\s\S]*return \{ x:a\.x \+ \(b\.x - a\.x\) \* progress/,
    'morphing retains matching route vertices and continuous endpoint interpolation');
  assert.match(scene, /const segments = Math\.max\(1, atlasCurve\.length - 1\)/,
    'rendered line segments follow the exact route vertex count');
});

test('Atlas route bounds and edge presentation remain complete', () => {
  assert.match(scene, /includeRouteShapeBounds\(transformAtlasEdgeShape\(path\.from, path\.to, path\.routeShape\)/,
    'camera bounds include exact current routed corners');
  assert.match(scene, /transformAtlasEdgeShape\(path\.from, path\.to, prior\.routeShape\)/,
    'camera bounds include prior route shapes while transitioning');
  assert.match(scene, /new THREE\.LineDashedMaterial/);
  assert.match(scene, /threads\.computeLineDistances\(\); questionThreads\.computeLineDistances\(\)/,
    'the dashed proposed and question edges retain distance updates');
  assert.match(scene, /worldRadiusForScreenPixels\([^;]*44\)/,
    'node selection retains its existing 44px hit target');
  assert.match(scene, /ensureGoldEdgeCapacity\(bucketIndex, goldSegmentCounts\[bucketIndex\] \+ 1\)/,
    'exact lineage corners grow their opacity bucket instead of truncating at fixed capacity');
});

test('node hit ownership uses the nearest projected anchor after existing ray and occlusion checks', () => {
  assert.match(scene, /raycaster\.ray\.intersectSphere\(new THREE\.Sphere\(center, radius\)/,
    'candidates still need to hit their 44 CSS-pixel sphere');
  assert.match(scene, /state\.surface > 0\.15 && hitDistance >= occlusionDistance/,
    'surface Earth occlusion remains in force before ownership is resolved');
  assert.match(scene, /const projected = center\.clone\(\)\.project\(camera\)[\s\S]*distanceSquared: dx \* dx \+ dy \* dy, hitDistance[\s\S]*nearestProjectedAnchorHit\(hits\)/,
    'overlapping candidates are owned by nearest screen anchor, with depth then stable ID ties');
});

test('Orbit ancestor labels reserve top chrome and move edge markers below it', () => {
  assert.match(scene, /\.site-header \.brand, \.site-header \.header-actions, \.panel-head, #chronicle, #atlas-toolbar/,
    'page header, Atlas title, and zoom controls are measured as label obstacles');
  assert.match(scene, /const lineageTop = topChromeBottoms\.length[\s\S]*Math\.max\(safeBounds\.top, \.\.\.topChromeBottoms\) \+ 8[\s\S]*const lineageBounds = \{ \.\.\.safeBounds, top: lineageTop \}/,
    'ancestor edge markers use a top boundary below active chrome');
  assert.match(scene, /yearFirst: mobileLabels,[\s\S]*bounds: safeBounds,[\s\S]*lineageBounds,[\s\S]*reservedRects/,
    'only the lineage marker path receives the chrome-aware boundary while other labels retain the normal viewport');
});

test('mobile labels treat the visible Other questions control as reserved chrome', () => {
  assert.match(scene, /querySelectorAll\?\.\('\.site-header \.brand, \.site-header \.header-actions, \.panel-head, #chronicle, #atlas-toolbar, #atlas-other-questions,[\s\S]*if \(element\.hidden\) continue/,
    'the current visibility of the phone control gates its reserved label rectangle');
  assert.match(scene, /element\.matches\?\.\('\.site-header \.brand, \.site-header \.header-actions, \.panel-head, #atlas-toolbar, #atlas-other-questions'\)/,
    'ancestor markers also begin below the visible Other questions control');
});

test('transition edge opacity is stored per rendered edge while retaining gold and dashed styles', () => {
  assert.match(scene, /vertexColors: true/,
    'the pinned Three r183 Line materials accept per-vertex RGBA edge opacity');
  assert.doesNotMatch(scene, /edgeOpacity\[kind\]\s*=\s*Math\.max/,
    'one Orbit edge no longer raises opacity for every Atlas edge in the same style group');
  assert.match(scene, /function writeEdgeBuffer\(line, positions, opacities\)[\s\S]*new THREE\.BufferAttribute\(new Float32Array\(vertexCount \* 4\), 4\)[\s\S]*colors\[vertex \* 4 \+ 3\] = Number\(opacities\[vertex\]\)/,
    'each route vertex carries its own opacity rather than inheriting its style bucket maximum');
  assert.match(scene, /edgeVertexOpacity\[kind\]\.push\(alpha, alpha\)/,
    'each segment endpoint receives the owning edge opacity');
  assert.match(scene, /goldOpacityLevels\.findIndex\(level => Math\.abs\(level - alpha\) < 1e-7\)[\s\S]*mesh\.material\.opacity = goldOpacityLevels\[bucketIndex\] \|\| 0/,
    'thick gold lineage ribbons retain per-edge opacity without a custom shader');
  assert.match(scene, /const GOLD_OPACITY_BUCKET_COUNT = 8[\s\S]*goldOpacityLevels\.reduce\(/,
    'gold segments use a bounded number of exact alpha groups instead of one global maximum');
  assert.match(scene, /threads\.computeLineDistances\(\); questionThreads\.computeLineDistances\(\)/,
    'dashed route lengths still update after variable-opacity geometry writes');
});

test('axis changes suppress routed Atlas threads but retain non-Atlas threads and overlay context', () => {
  assert.match(scene, /const suppressAtlasThreads = Boolean\(axisTransition && state\.atlas > 0\.015\)/,
    'only active Atlas-axis morphs suppress routed Atlas links');
  assert.match(scene, /const nonAtlasAlpha = \(onSurface \? state\.surface : 0\) \+ \(inOrbit \? state\.orbit : 0\)/);
  assert.match(scene, /const atlasAlpha = suppressAtlasThreads \? 0 : \(inAtlas \? state\.atlas : 0\);[\s\S]*nonAtlasAlpha \+ atlasAlpha/,
    'Atlas links follow their presentation opacity through the Orbit-to-Atlas blend');
  assert.match(scene, /const edgeState = suppressAtlasThreads \? \{ \.\.\.state, atlas:0 \} : state/,
    'only axis-mode suppression switches parent-child endpoints to the non-Atlas state');
  assert.match(scene, /arc\.set\(directMorph\[step\]\.x, directMorph\[step\]\.y, directMorph\[step\]\.z\)/,
    'the direct route morph supplies the exact rendered vertices after lift');
  assert.match(scene, /arc\.lerp\(new THREE\.Vector3\(atlasCurve\[step\]\.x, atlasCurve\[step\]\.y, atlasCurve\[step\]\.z\), edgeState\.atlas\)/,
    'surface and lift rendering retain their previous route interpolation');
  assert.match(scene, /const rootConnections = state\.atlas > 0\.015 && !suppressAtlasThreads/,
    'P2 question-root attachments stay hidden during the route morph');
  assert.match(scene, /p2Renderer\.setQuestionBranchOpacity\(suppressAtlasThreads \? 0 : 1\)/,
    'P2 branch and attachment lines are suppressed during axis-mode morphs without hiding its trunk, ticks, or chips');
  assert.match(p2Renderer, /function setQuestionBranchOpacity\(value\)[\s\S]*branches\.material\.opacity = 0\.82 \* currentOpacity \* questionBranchOpacity;[\s\S]*questionAttachments\.material\.opacity = 0\.86 \* currentOpacity \* questionBranchOpacity/);
  assert.match(scene, /axisTransition = null;\s*applyZoom\(zoom, false, timestamp\)/,
    'the exact target routes are redrawn on the completion frame');
});

test('direct Atlas path morph stays attached and reaches the exact axis-interpolated route', () => {
  const orbitFrom = { x:-2, y:0.5, z:0.1 }, orbitTo = { x:2, y:-0.25, z:0.2 };
  const oldRoute = [{ x:-1.5, y:-0.2, z:0.15 }, { x:-0.2, y:1.7, z:0.4 }, { x:1.3, y:0.4, z:0.3 }, { x:1.6, y:0.7, z:0.2 }];
  const newRoute = [{ x:-0.9, y:0.8, z:0.25 }, { x:-0.4, y:-1.1, z:0.2 }, { x:1.1, y:-0.8, z:0.1 }, { x:2.2, y:-0.6, z:0.15 }];
  const lerp = (a, b, t) => ({ x:a.x + (b.x - a.x) * t, y:a.y + (b.y - a.y) * t, z:a.z + (b.z - a.z) * t });
  for (const axis of [0, 0.25, 0.5, 0.75, 1]) {
    const target = oldRoute.map((point, index) => lerp(point, newRoute[index], axis));
    for (const zoom of [0, 0.2, 0.5, 0.8, 1]) {
      const liveFrom = lerp(orbitFrom, target[0], zoom);
      const liveTo = lerp(orbitTo, target.at(-1), zoom);
      const route = interpolateAttachedAtlasEdgeRoute(orbitFrom, orbitTo, target, zoom, { from:liveFrom, to:liveTo });
      assert.deepEqual(route[0], liveFrom, `start endpoint at axis=${axis}, zoom=${zoom}`);
      assert.deepEqual(route.at(-1), liveTo, `end endpoint at axis=${axis}, zoom=${zoom}`);
      assert.deepEqual(route[1], lerp(lerp(orbitFrom, orbitTo, 1 / 3), target[1], zoom),
        `route progresses directly at axis=${axis}, zoom=${zoom}`);
    }
  }
  const full = interpolateAttachedAtlasEdgeRoute(orbitFrom, orbitTo, newRoute, 1, { from:newRoute[0], to:newRoute.at(-1) });
  assert.deepEqual(full, newRoute, 'the final route retains every exact routed corner');
  const attachedOffset = { from:{ x:-1.25, y:0.4, z:0.2 }, to:{ x:1.4, y:-0.1, z:0.25 } };
  const offsetRoute = interpolateAttachedAtlasEdgeRoute(orbitFrom, orbitTo, newRoute, 0.5, attachedOffset);
  assert.deepEqual(offsetRoute[0], attachedOffset.from);
  assert.deepEqual(offsetRoute.at(-1), attachedOffset.to);
});

test('question-root attachments render and morph their routed paths with existing edge styling', () => {
  assert.match(scene, /\(atlasTimeline\?\.questionRootPaths \|\| \[\]\)\.filter/,
    'the direct token-to-root segment is replaced with the P2 routed path list');
  assert.match(scene, /questionId === connection\.questionId && item\.worldId === connection\.worldId/,
    'axis transitions match the previous route to the same question and root');
  assert.match(scene, /transformAtlasEdgeShape\(from, rootPoint, connection\.routeShape\)/,
    'each routed root attachment keeps all of its exact corners');
  assert.match(scene, /const rootPoint = worldPosition\(root, state, timestamp, markerRadius\)/,
    'the routed root endpoint tracks the moving marker during zoom');
  assert.match(scene, /priorConnection\.routeShape, connection\.routeShape, progress/,
    'prior and target attachments animate continuously through their routed shapes');
  assert.match(scene, /connection\.color === 'lineage' \? 'lineage'[\s\S]*hoverPathIds\.has\(connection\.worldId\) \? 'hover'/,
    'root links retain gold lineage and hover highlighting');
  assert.match(scene, /previousRootPaths = new Map\(\(axisTransition\?\.fromTimeline\?\.questionRootPaths \|\| \[\]\)/,
    'camera bounds include old and target question-root routes during axis changes');
  const rootLoop = scene.slice(scene.indexOf('for (const connection of rootConnections)'), scene.indexOf('writeEdgeBuffer(threads,', scene.indexOf('for (const connection of rootConnections)')));
  assert.match(rootLoop, /const progress = axisTransition \? axisTransitionProgress\([\s\S]*?\) : 1;\s*const prior =/,
    'one block-scoped transition progress value is available to both token and route interpolation');
  assert.match(rootLoop, /priorConnection\.routeShape, connection\.routeShape, progress/,
    'the root route morph uses that same in-scope progress value');
});

test('root-question and folded-chip stems consume routed geometry and transition metadata', () => {
  assert.match(scene, /atlasTimeline\.questionStemPaths \|\| \[\]/,
    'route warnings include stems alongside parent-child and root connectors');
  assert.match(scene, /fromStems: axisTransition\?\.fromTimeline\.questionStemPaths/,
    'the previous axis layout supplies stem paths for the same transition');
  assert.match(p2Renderer, /layout\.questionStemPaths \|\| \[\]/);
  assert.match(p2Renderer, /if \(!stem\?\.routeShape\?\.length \|\| stem\.foldedChip\) continue/,
    'visible root-question stems use their routes while folded chips keep separate stem styling');
  assert.match(p2Renderer, /retainsLineageRoot = \(layout\.questionRootPaths \|\| \[\]\)\.some[\s\S]*foldedQuestionIds\.has\(String\(branch\.questionId\)\) && !retainsLineageRoot/,
    'a retained gold root keeps its question stem when sibling possibilities fold into a chip');
  assert.match(p2Renderer, /if \(!stem\?\.foldedChip \|\| !stem\.routeShape\?\.length\) continue/,
    'folded chip stems use their own routed paths');
  assert.match(p2Renderer, /questionStemPathKey\(path\)/);
  assert.match(p2Renderer, /stems\.get\(stemKey\)[\s\S]*oldStems\.get\(stemKey\)/,
    'root and folded-chip routes for one question do not overwrite each other');
  assert.match(scene, /previousStemPaths = new Map[\s\S]*questionStemPathKey\(path\)[\s\S]*previousStemPaths\.get\(questionStemPathKey\(path\)\)/,
    'axis bounds match previous stems by kind as well as question ID');
  assert.match(p2Renderer, /function setQuestionBranchOpacity\(value\)[\s\S]*chipStems\.material\.opacity = 0\.78 \* currentOpacity \* questionBranchOpacity;[\s\S]*chipStems\.visible = questionBranchOpacity > 0/,
    'axis-route suppression hides the folded chip stems along with the other question branches');
  assert.match(p2Renderer, /interpolateRoute\(from, to, previousStem\.routeShape, stem\.routeShape, progress/,
    'stem geometry follows the existing axis transition instead of snapping');
});
