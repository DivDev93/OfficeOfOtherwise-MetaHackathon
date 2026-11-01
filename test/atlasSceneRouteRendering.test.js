import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { interpolateAttachedAtlasEdgeRoute } from '../web/atlas/routeMorph.js';

const scene = readFileSync(new URL('../web/atlas/scene.js', import.meta.url), 'utf8');
const p2Renderer = readFileSync(new URL('../web/atlas/p2Renderer.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');

test('reduced-motion axis changes swap immediately without blanking the canvas', () => {
  const axisModeSwitch = scene.match(/function setAxisMode\(mode\) \{([\s\S]*?)\n  \}\n  function getAxisMode/)?.[1];
  assert.ok(axisModeSwitch, 'the scene exposes its axis-mode switch');
  const reducedMotionBranch = axisModeSwitch.match(/if \(motionReduced\) \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(reducedMotionBranch, 'reduced motion has a dedicated axis-mode path');
  assert.match(reducedMotionBranch, /axisTransition = null; axisMode = mode; axisFadeOpacity = 1; updateCanvasOpacity\(\)/,
    'the reduced-motion path commits the new layout while keeping the canvas visible');
  assert.match(reducedMotionBranch, /refreshAtlasTimeline\(\); applyZoom\(zoom, false\)/,
    'the new axis layout is applied synchronously');
  assert.doesNotMatch(reducedMotionBranch, /requestAnimationFrame|axisFadeOpacity = 0/,
    'the reduced-motion path schedules no fade frames and never blanks the canvas');
  assert.match(axisModeSwitch, /axisTransition = \{ from, to: atlasTimeline, fromTimeline, startedAt \};[\s\S]*applyZoom\(zoom, false, startedAt\)/,
    'normal-motion axis changes retain their animated transition');
});

test('Atlas renders exact routed corners and preserves them through axis changes', () => {
  assert.match(scene, /transformAtlasEdgeShape/);
  assert.match(scene, /const directMorphActive = edgeState\.lift >= 0\.999;[\s\S]*if \(directMorphActive\) \{[\s\S]*routeFrom = worldPosition\(parent, atlasEdgeState,[\s\S]*orbitFrom = worldPosition\(parent, orbitEdgeState,/,
    'extra Atlas and Orbit endpoints are only computed in the settled direct-morph branch');
  assert.match(scene, /transformAtlasEdgeShape\(routeFrom, routeTo, path\.routeShape\)/,
    'Atlas routes are built in their settled endpoint coordinates');
  assert.match(scene, /interpolateAttachedAtlasEdgeRoute\(orbitFrom, orbitTo, atlasCurve,[\s\S]*\{ from, to, easeInterior:true \}\)/,
    'the Orbit chord morphs its routed interior while staying attached to live endpoints');
  assert.match(scene, /routeVertexFractions\(previousBasis\)[\s\S]*routeVertexFractions\(nextBasis\)/,
    'axis morphs include the cumulative-arc fraction of every old and new corner');
  assert.match(scene, /return fractions\.map\(fraction => \{[\s\S]*return \{ x:a\.x \+ \(b\.x - a\.x\) \* progress/,
    'morphing retains matching route vertices and continuous endpoint interpolation');
  assert.match(scene, /const segments = Math\.max\(1, atlasCurve\.length - 1\)/,
    'rendered line segments follow the exact route vertex count');
});

test('Atlas P2 labels the finite non-temporal lane only when undated records exist', () => {
  assert.match(p2Renderer, /const undatedLabel = new THREE\.Sprite/);
  assert.match(p2Renderer, /const undatedText = layout\.undatedLane\?\.label \|\| 'UNDATED · NO TIME POSITION'/);
  assert.match(p2Renderer, /undatedLabel\.position\.set\(layout\.undatedLane\?\.x \?\? layout\.trunk\.left/);
  assert.match(p2Renderer, /undatedLabel\.material\.opacity = layout\.undatedLane \? alpha : 0/);
  assert.match(p2Renderer, /\[presentLabel, scaleLabel, axisLabel, undatedLabel, \.\.\.questionSprites/,
    'the lane label is screen-space placed with the other Atlas labels');
  assert.match(scene, /if \(atlasTimeline\?\.undatedLane\) \{[\s\S]*id:'axis:undated',[\s\S]*text:mobileLabels \? 'UNDATED' : atlasTimeline\.undatedLane\.label/,
    'the visible lane caption is emitted through the scene screen-label overlay');
  assert.match(scene, /mobileUndatedShelfY = Math\.min\(safeBounds\.bottom - 12,[\s\S]*topChromeBottoms\.length \? Math\.max\(\.\.\.topChromeBottoms\)[\s\S]*x:safeBounds\.left \+ 46/,
    'the compact mobile caption occupies a safe shelf below top controls');
  assert.match(scene, /candidate\.id === currentId\) return \{ \.\.\.candidate, priority:Math\.max\(candidate\.priority \|\| 0, 124\) \};[\s\S]*candidate\.id === undatedLineageWorldId[\s\S]*x:safeBounds\.right - width \/ 2 - 2, y:mobileUndatedShelfY, width, priority:122/,
    'the undated ancestor gets the other safe shelf slot while selected-world labels keep priority');
  assert.match(scene, /!candidates\.some\(candidate => candidate\.id === undatedLineageWorldId\)[\s\S]*const entry = undatedLineageEntry[\s\S]*candidates\.push\(\{ id:undatedLineageWorldId/,
    'the nearest undated ancestor gets a label candidate even when its projected candidate was omitted');
  assert.match(scene, /edgeMarker\(undatedLineageTarget, \{[\s\S]*left:placement\.x, right:placement\.x, top:placement\.y, bottom:placement\.y,[\s\S]*placement\.text = arrow/,
    'the mobile ancestor arrow is recalculated from the final shelf slot toward its projected node');
  assert.match(scene, /object\.isSprite && object\.userData\?\.labelText != null\) object\.material\.opacity = 0/,
    'the overlay candidate remains necessary because legacy P2 text sprites are intentionally hidden');
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

test('Orbit and Atlas cluster hit planes use world-space camera depth for their CSS-pixel size', () => {
  assert.match(scene, /const worldCenter = sprite\.getWorldPosition\(new THREE\.Vector3\(\)\);\s*const viewDepth = -worldCenter\.applyMatrix4\(camera\.matrixWorldInverse\)\.z;[\s\S]*const diameter = cluster\.level === 'surface' \? 48 : 58;[\s\S]*worldRadiusForScreenPixels\(viewDepth/,
    'rotated cluster sprites retain their intended 48px Surface or 58px Orbit/Atlas raycast plane, including off-axis targets');
  assert.doesNotMatch(scene, /const distance = sprite\.position\.distanceTo\(camera\.position\);[\s\S]{0,180}cluster\.level === 'surface'/,
    'cluster sizing does not use local coordinates or radial distance in place of projected camera depth');
});

test('Orbit ancestor labels reserve top chrome and move edge markers below it', () => {
  assert.match(scene, /\.site-header \.brand, \.site-header \.header-actions, \.panel-head, #chronicle, \.atlas-world-details, #atlas-toolbar/,
    'page header, Atlas title, and zoom controls are measured as label obstacles');
  assert.match(scene, /const lineageTop = topChromeBottoms\.length[\s\S]*Math\.max\(safeBounds\.top, \.\.\.topChromeBottoms\) \+ 8[\s\S]*const lineageBounds = \{ \.\.\.safeBounds, top: lineageTop \}/,
    'ancestor edge markers use a top boundary below active chrome');
  assert.match(scene, /yearFirst: mobileLabels,[\s\S]*bounds: safeBounds,[\s\S]*lineageBounds,[\s\S]*reservedRects/,
    'only the lineage marker path receives the chrome-aware boundary while other labels retain the normal viewport');
});

test('mobile labels treat the visible Other questions control as reserved chrome', () => {
  assert.match(scene, /querySelectorAll\?\.\('\.site-header \.brand, \.site-header \.header-actions, \.panel-head, #chronicle, \.atlas-world-details, #atlas-toolbar, #atlas-other-questions,[\s\S]*if \(element\.hidden\) continue/,
    'the current visibility of the phone control gates its reserved label rectangle');
  assert.match(scene, /element\.matches\?\.\('\.site-header \.brand, \.site-header \.header-actions, \.panel-head, #atlas-toolbar, #atlas-other-questions'\)/,
    'ancestor markers also begin below the visible Other questions control');
});

test('fading story-sheet bounds join the screen-label collision obstacles', () => {
  assert.match(scene, /querySelectorAll\?\.\('[^']*\.atlas-world-details[^']*'\)[\s\S]*?styles\?\.display === 'none' \|\| styles\?\.visibility === 'hidden' \|\| Number\(styles\?\.opacity\) <= 0\.05[\s\S]*?reservedRects\.push\(/,
    'only the currently visible sheet rectangle blocks labels, with its computed fade opacity gating the obstacle');
});

test('Orbit direct-child labels use accessible scroll lanes only in the Orbit neighborhood', () => {
  assert.match(scene, /const orbitChildEntries = state\.orbit > 0\.3 && state\.atlas < 0\.6[\s\S]*entries\.filter\(entry => entry\.orbitVisible && String\(entry\.parentId\) === String\(currentId\)\)/,
    'only currently visible direct children of the selected world enter the lane layout');
  assert.match(scene, /layoutOrbitChildLabels\(orbitLabelCandidates, safeBounds, nodeRects,[\s\S]*placements\.filter\(placement => Number\.isFinite\(placement\.x\)/,
    'visible children first use collision-free positions around their projected nodes; only remaining labels enter lanes');
  assert.match(scene, /setAttribute\('role', 'region'\)[\s\S]*touchAction:'pan-y'[\s\S]*element\.style\.overflowY = lane\.scrollable \? 'auto' : 'hidden'/,
    'grouped label lanes scroll without routing wheel or touch input to globe zoom');
  assert.match(scene, /rowHeight:44,[\s\S]*button\.style\.minHeight = '44px'/,
    'visible child buttons retain a 44px touch target');
  assert.match(scene, /visibleViewportObstacleRects\(labelDocument,[\s\S]*\.exploration-rail, #invitation, #exploration-tree/,
    'the floating fallback reserves the visible invitation and exploration rail as well as Atlas controls');
  assert.match(scene, /fallbackLabels = viewportObstacleRectsFromCenters\([\s\S]*orbitLaneLayout\.local[\s\S]*placements\.filter/,
    'the fallback dock clears locally placed child labels and other visible labels');
  assert.match(scene, /const safeObstacles = \[\.\.\.fallbackControls, \.\.\.fallbackLabels, \.\.\.fallbackNodes\][\s\S]*placeOrbitFallbackPanel\(fallbackBounds, safeObstacles\)[\s\S]*placeOrbitFallbackDock\(fallbackBounds, \[\.\.\.fallbackControls, \.\.\.fallbackLabels\]/,
    'the fallback tries a full safe panel, a 44px compact dock, then globe-space placement while keeping controls and labels clear');
  assert.match(scene, /resolveOrbitFallbackMount\([\s\S]*fallbackHost = fallbackMount\.mode === 'tree' \|\| fallbackMount\.mode === 'tree-reopen' \? explorationTree[\s\S]*fallbackHost\.append\(orbitFallbackSection\)/,
    'the visible portal wins when a safe dock fits, with the tree retained only as the final no-space fallback');
  assert.match(scene, /heading\.style\.display = fallbackRect\?\.compact \? 'none' : 'block'/,
    'the compact dock uses its full height for at least one 44px child button');
  assert.match(scene, /fallbackWorldTitle = current\?\.world\?\.title \|\| 'Current world'[\s\S]*setAttribute\('aria-label', `\$\{fallbackWorldTitle\} direct children in Orbit`\)/,
    'the dock region accessible name identifies the selected world');
  assert.match(scene, /116px wide by 82px tall \(a 62px dock for a 44px label plus 10px safety margins\)/,
    'the no-space warning describes the compact dock geometry and safety gap');
  assert.match(scene, /const content = placement\.local \? labelOverlay[\s\S]*button\.style\.minHeight = '44px'[\s\S]*button\.style\.clipPath = 'none'/,
    'near-node and fallback labels remain visible buttons with full-size touch targets');
  assert.doesNotMatch(scene, /orbitFallback[\s\S]*?classList\.(?:add|remove)\('atlas-panels-open'\)|orbitFallback[\s\S]*?#atlas-compact-tree[\s\S]*?aria-expanded/,
    "the fallback preserves the user's compact-panel state and its aria-expanded value");
  assert.match(scene, /treeButton\.textContent = 'Story tree · Orbit labels'[\s\S]*Open story tree to reach Orbit child labels/,
    'the focused-mode reveal path has a visible and accessible status on the existing Story tree control');
  assert.match(scene, /fallbackMount\.mode === 'embedded-flow' \? container\.parentElement/,
    'a standalone embedded scene mounts the fallback inside its visible host when no viewport slot exists');
  assert.match(style, /\.atlas-focused \.exploration-rail[\s\S]*?display:none!important/);
  assert.match(style, /body\.invitation-open:has\(#atlas-scene\[data-atlas-level="orbit"\]\) \.exploration-rail>#exploration-tree[\s\S]*?visibility:hidden/,
    'the portal path remains available in both CSS states that hide the story tree');
  assert.match(scene, /const focusedOrbitChildId = \[[\s\S]*if \(focusedOrbitChildId\) \{[\s\S]*renderer\.domElement\.focus\(\{ preventScroll:true \}\)/,
    'removing a child label or its lane returns keyboard focus to the scene');
  assert.match(scene, /button\.setAttribute\('aria-label', `Open \$\{placement\.fullText\}`\)/,
    'each lane button exposes the full child identity to assistive technology');
  assert.match(scene, /button\.addEventListener\('click',[\s\S]*explicitEnter\(target, projectedAnchor\(button\.dataset\.worldId, 'orbit-label'/,
    'full child names are available to assistive technology and labels open by click or keyboard activation');
  assert.match(scene, /button\.addEventListener\('keydown',[\s\S]*neighborForKey\(event\.key\)[\s\S]*event\.key === 'Escape'/,
    'focused child labels retain directional keyboard navigation and Escape');
  assert.match(scene, /pointerleave',[\s\S]*document\.activeElement !== button/,
    'pointer exit does not cancel the preview while its child label remains keyboard-focused');
  assert.match(scene, /const generalCandidates = candidates\.filter\(candidate => !orbitChildIds\.has\(candidate\.id\)\)/,
    'direct children do not get duplicate opportunistic labels while their dedicated lane is active');
  assert.match(scene, /const resize = \(\) => \{[\s\S]*camera\.aspect = width \/ height; camera\.updateProjectionMatrix\(\);\s*updateLayout\(\);\s*applyZoom\(zoom, false\);[\s\S]*new ResizeObserver\(resize\)[\s\S]*observer\?\.observe\(container\)/,
    'every observed container resize recomputes graph layout and projected child-label placement');
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
