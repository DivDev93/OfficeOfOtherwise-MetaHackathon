import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scene = readFileSync(new URL('../web/atlas/scene.js', import.meta.url), 'utf8');
const p2Renderer = readFileSync(new URL('../web/atlas/p2Renderer.js', import.meta.url), 'utf8');

test('Atlas renders exact routed corners and preserves them through axis changes', () => {
  assert.match(scene, /transformAtlasEdgeShape/);
  assert.match(scene, /transformAtlasEdgeShape\(from, to, path\.routeShape\)/,
    'static Atlas edges use every normalized route vertex instead of a fixed sample count');
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
  assert.match(scene, /ensureGoldEdgeCapacity\(Math\.ceil\(goldPositions\.length \/ 6\)\)/,
    'exact lineage corners do not get truncated by the old fixed segment capacity');
});

test('axis changes suppress routed Atlas threads but retain non-Atlas threads and overlay context', () => {
  assert.match(scene, /const suppressAtlasThreads = Boolean\(axisTransition && state\.atlas > 0\.015\)/,
    'only active Atlas-axis morphs suppress routed Atlas links');
  assert.match(scene, /const nonAtlasAlpha = \(onSurface \? state\.surface : 0\) \+ \(inOrbit \? state\.orbit : 0\)/);
  assert.match(scene, /const atlasAlpha = suppressAtlasThreads \? 0 : \(inAtlas \? state\.atlas : 0\);[\s\S]*nonAtlasAlpha \+ atlasAlpha/,
    'Atlas links follow their presentation opacity through the Orbit-to-Atlas blend');
  assert.match(scene, /const edgeState = suppressAtlasThreads \? \{ \.\.\.state, atlas:0 \} : state/,
    'only axis-mode suppression switches parent-child endpoints to the non-Atlas state');
  assert.match(scene, /atlasCurve\[step\]\.z\), edgeState\.atlas\)/);
  assert.match(scene, /const rootConnections = state\.atlas > 0\.015 && !suppressAtlasThreads/,
    'P2 question-root attachments stay hidden during the route morph');
  assert.match(scene, /p2Renderer\.setQuestionBranchOpacity\(suppressAtlasThreads \? 0 : 1\)/,
    'P2 branch and attachment lines are suppressed during axis-mode morphs without hiding its trunk, ticks, or chips');
  assert.match(p2Renderer, /function setQuestionBranchOpacity\(value\)[\s\S]*branches\.material\.opacity = 0\.82 \* currentOpacity \* questionBranchOpacity;[\s\S]*questionAttachments\.material\.opacity = 0\.86 \* currentOpacity \* questionBranchOpacity/);
  assert.match(scene, /axisTransition = null;\s*applyZoom\(zoom, false, timestamp\)/,
    'the exact target routes are redrawn on the completion frame');
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
});
