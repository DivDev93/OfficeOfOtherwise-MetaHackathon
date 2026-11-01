import * as THREE from 'three';
import { defaultWorldImageUrl } from './imageRefs.js';
import { createWorldTextureFactory } from './worldTextures.js';
import { projectGeographyLocation } from '../terrainRaster.js';
import { clusterOpacityAtPresentation, orbitClusteredIdsForPresentation, planWorldClusters } from './clusters.js';
import { containsFanRegion, createFanHitRegion, fanMemberOffsets } from './screenLayout.js';
import { createLargeClusterPicker, needsPagedClusterPicker, visibleKeyboardNeighborEntries } from './largeClusterPicker.js';
import { createAtlasP2Renderer } from './p2Renderer.js';
import { interpolateAttachedAtlasEdgeRoute } from './routeMorph.js';
import { dragModeForZoom, panDeltaForDrag, zoomFromPinch, zoomFromWheel } from './interaction.js';
import { createOrbitChildLabelLeader, createWorldLabelCandidates, edgeMarker, layoutOrbitChildLabels, placeOrbitFallbackDock, placeOrbitFallbackPanel, placeScreenLabels, projectedSphereDiameterPixels, resolveOrbitFallbackMount, shortQuestionTitle, visibleViewportObstacleRects, viewportObstacleRectsFromCenters, worldLabelText } from './labels.js';
import {
  GHOST_TRAIL_DEFAULT, arrivalParentWorldId, cutTravelOpacity, interpolateTravelPoint, preservesTravelSource, smoothTravelProgress, travelZoomAt,
  lineageTravelPath, sampleLineagePath, travelDuration,
} from './p3Travel.js';
import {
  ATLAS_REAL_SPHERE_LIMIT, AXIS_ANIMATION_MS, AXIS_MODES, PRESENT_DAY_REFERENCE,
  axisTransitionProgress, buildAtlasTimeline, interpolateAtlasPoint, questionStemPathKey, sampleAtlasEdgePath, transformAtlasEdgeShape,
} from './p2Atlas.js';
import {
  ATLAS_LEVEL_MAX, ORBIT_UNFOLDED_LEVEL, SURFACE_LABEL_LEVEL,
  ATLAS_PIN_GEOMETRY_RADIUS, surfacePinAnchorRadius,
  pinScaleAtPresentation, pinAnchorRadiusAtPresentation,
  altitudeForZoom, atlasPresentationState, atlasZoomState, clampAtlasLevel, createWorldRegistry,
  layoutAtlasWorlds, layoutOrbitNeighborhood, measuredFps, surfaceFacingOrientation,
  worldRadiusForScreenPixels, nearestProjectedAnchorHit, projectedWorldTarget, targetOccludedByEarth, pointerRayDistanceAtTargetDepth, nearestDirectionalNeighbor, selectSurfaceWorldLabelIds, slerpUnitVector,
  cappedTextureSize, allowEarthBodySelection, fitCenteredCameraDistance,
  appendContinuousFrame, stableWorldId, localQuaternionForWorldFacing, isSurfaceNormalVisible,
} from '../atlasLayout.js';

const GOLD = new THREE.Color('#d5a85c');
const CYAN = new THREE.Color('#55c9e9');
const PARCHMENT = new THREE.Color('#eadfca');
const MUTED = new THREE.Color('#65818a');
const LIT_TINT = new THREE.Color('#ffffff');
const MAX_SPHERE_INSTANCES = ATLAS_REAL_SPHERE_LIMIT;
const INITIAL_GOLD_EDGE_SEGMENTS = 256;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const DIM_UNENTERED = new THREE.Color('#4d6870');
const LIT_EARTH = new THREE.Color('#e6e0ce');

export function revealFocusedOrbitChildInLane(lane, button) {
  if (!lane?.getBoundingClientRect || !button?.getBoundingClientRect) return false;
  const laneRect = lane.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  if (!(laneRect.bottom > laneRect.top) || !(buttonRect.bottom > buttonRect.top)) return false;
  const clientTop = Number(lane.clientTop);
  const clientHeight = Number(lane.clientHeight);
  const scrollportTop = laneRect.top + (Number.isFinite(clientTop) ? clientTop : 0);
  const scrollportBottom = Number.isFinite(clientHeight) && clientHeight > 0
    ? scrollportTop + clientHeight : laneRect.bottom;
  let scrollDelta = 0;
  if (buttonRect.top < scrollportTop) scrollDelta = buttonRect.top - scrollportTop;
  else if (buttonRect.bottom > scrollportBottom) scrollDelta = buttonRect.bottom - scrollportBottom;
  if (!scrollDelta) return false;
  lane.scrollTop += scrollDelta;
  return true;
}

export function restoreFocusedOrbitChildInLane(lane, button, activeElement) {
  if (activeElement !== button) button.focus({ preventScroll:true });
  return revealFocusedOrbitChildInLane(lane, button);
}

function routeVertexFractions(points) {
  if (!Array.isArray(points) || points.length < 2) return [0, 1];
  const cumulative = [0];
  for (let index = 1; index < points.length; index++) cumulative.push(cumulative[index - 1]
    + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
  const total = cumulative.at(-1) || 1;
  return cumulative.map(distance => distance / total);
}

function sampleRouteAtFraction(points, fractions, fraction) {
  const target = Math.max(0, Math.min(1, fraction));
  let segment = 1;
  while (segment < fractions.length - 1 && fractions[segment] < target - 1e-10) segment++;
  const span = fractions[segment] - fractions[segment - 1] || 1;
  const t = Math.max(0, Math.min(1, (target - fractions[segment - 1]) / span));
  const a = points[segment - 1], b = points[segment];
  return { x:a.x + (b.x - a.x) * t, y:a.y + (b.y - a.y) * t, z:a.z + (b.z - a.z) * t };
}

function interpolateAtlasRouteShapes(from, to, fromShape, toShape, progress, fromFractionEndpoints, toFractionEndpoints) {
  const previous = transformAtlasEdgeShape(from, to, fromShape);
  const next = transformAtlasEdgeShape(from, to, toShape);
  if (previous.length < 2 || next.length < 2) return next.length >= 2 ? next : previous;
  const previousBasis = transformAtlasEdgeShape(fromFractionEndpoints?.from || from, fromFractionEndpoints?.to || to, fromShape);
  const nextBasis = transformAtlasEdgeShape(toFractionEndpoints?.from || from, toFractionEndpoints?.to || to, toShape);
  const previousFractions = routeVertexFractions(previous), nextFractions = routeVertexFractions(next);
  const fractions = [...new Set([...routeVertexFractions(previousBasis), ...routeVertexFractions(nextBasis)])]
    .sort((a, b) => a - b);
  return fractions.map(fraction => {
    const a = sampleRouteAtFraction(previous, previousFractions, fraction);
    const b = sampleRouteAtFraction(next, nextFractions, fraction);
    return { x:a.x + (b.x - a.x) * progress, y:a.y + (b.y - a.y) * progress, z:a.z + (b.z - a.z) * progress };
  });
}

function includeRouteShapeBounds(points, xs, ys) {
  for (const point of points) { if (Number.isFinite(point.x)) xs.push(point.x); if (Number.isFinite(point.y)) ys.push(point.y); }
}

/** Map a point in an orthographic globe disk to the local equirectangular Earth texture. */
export function orthographicEarthTextureUv(x, y) {
  const screenX = Number(x), screenY = Number(y);
  if (![screenX, screenY].every(Number.isFinite)) return null;
  const radiusSquared = screenX * screenX + screenY * screenY;
  if (radiusSquared > 1) return null;
  const forward = Math.sqrt(Math.max(0, 1 - radiusSquared));
  const latitude = Math.asin(Math.max(-1, Math.min(1, screenY)));
  // The Atlas globe's +Z camera view is centered on longitude -90 degrees.
  const longitude = -Math.PI / 2 + Math.atan2(screenX, forward);
  return {
    u: ((longitude + Math.PI) / (2 * Math.PI) + 1) % 1,
    v: 0.5 - latitude / Math.PI,
  };
}

export function isGenerationPlaceholderWorld(world = {}) {
  return world?.isExpansionPlaceholder === true || world?.role === 'generation-placeholder'
    || (world?.mapState === 'generating' && world?.selectable === false);
}

function createOrthographicEarthPointTexture(image, edge = 128) {
  const width = Number(image?.naturalWidth || image?.width), height = Number(image?.naturalHeight || image?.height);
  if (!image || !(width > 0 && height > 0)) return null;
  try {
    const source = document.createElement('canvas'); source.width = width; source.height = height;
    const sourceContext = source.getContext('2d', { willReadFrequently: true });
    sourceContext.drawImage(image, 0, 0, width, height);
    const pixels = sourceContext.getImageData(0, 0, width, height).data;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = edge;
    const context = canvas.getContext('2d');
    const projected = context.createImageData(edge, edge);
    const radius = edge / 2 - 1;
    for (let y = 0; y < edge; y++) for (let x = 0; x < edge; x++) {
      const nx = ((x + 0.5) / edge) * 2 - 1, ny = 1 - ((y + 0.5) / edge) * 2;
      const uv = orthographicEarthTextureUv(nx, ny);
      if (!uv) continue;
      const sourceX = Math.min(width - 1, Math.floor(uv.u * width));
      const sourceY = Math.min(height - 1, Math.floor(uv.v * height));
      const from = (sourceY * width + sourceX) * 4, to = (y * edge + x) * 4;
      const radial = Math.hypot(nx, ny);
      const coverage = Math.max(0, Math.min(1, (1 - radial) * radius + 0.5));
      const rim = radial > 0.92 ? 0.74 : 1;
      projected.data[to] = pixels[from] * rim * 0.82;
      projected.data[to + 1] = pixels[from + 1] * rim * 0.82;
      projected.data[to + 2] = pixels[from + 2] * rim * 0.82;
      projected.data[to + 3] = pixels[from + 3] * coverage;
    }
    context.putImageData(projected, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  } catch {
    return null;
  }
}

function worldColor(entry, currentId) {
  const world = entry.world || {};
  const kind = `${world.kind || ''} ${world.type || ''} ${world.tokenType || ''} ${world.theme || ''}`.toLowerCase();
  if (entry.id === currentId || entry.lineage) return GOLD;
  if (/question|chronos|time.?token/.test(kind)) return PARCHMENT;
  if (entry.explored) return LIT_EARTH;
  if (!entry.explored) return CYAN.clone().lerp(DIM_UNENTERED, 0.58);
  return entry.child || entry.sibling || world.proposed !== false ? CYAN : MUTED;
}

function geographyPoint(entry, radius = 1, globe = entry.globe) {
  return new THREE.Vector3(globe.x, globe.y, globe.z).multiplyScalar(radius);
}

function cappedTextureImage(image, maxEdge = 2048) {
  const size = cappedTextureSize(image?.naturalWidth || image?.width, image?.naturalHeight || image?.height, maxEdge);
  if (size.width === image.width && size.height === image.height) return image;
  const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
  canvas.getContext('2d').drawImage(image, 0, 0, size.width, size.height);
  return canvas;
}

function createCanvasDiscTexture(url, onReady) {
  const texture = new THREE.Texture();
  texture.colorSpace = THREE.SRGBColorSpace;
  if (typeof url !== 'string' || !url) return texture;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    if (!image.width || !image.height) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    context.save();
    context.beginPath(); context.arc(128, 128, 126, 0, Math.PI * 2); context.clip();
    const scale = Math.max(256 / image.width, 256 / image.height);
    const width = image.width * scale, height = image.height * scale;
    context.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height);
    context.restore();
    texture.image = canvas; texture.needsUpdate = true; onReady?.();
  };
  image.onerror = () => {};
  image.src = url;
  return texture;
}

function imageForWorld(world, selected = false, resolver = defaultWorldImageUrl) {
  return resolver?.(world, { selected }) || null;
}

function createWorldLabel(world) {
  const element = document.createElement('span');
  element.className = 'atlas-screen-label atlas-world-label';
  element.textContent = worldLabelText(world);
  element.setAttribute('role', 'note');
  element.setAttribute('aria-label', worldLabelText(world));
  element.title = worldLabelText(world);
  Object.assign(element.style, {
    position: 'absolute', display: 'none', transform: 'translate(-50%, -50%)',
    pointerEvents: 'none', whiteSpace: 'nowrap', maxWidth: 'min(320px, 70vw, 100%)', boxSizing: 'border-box',
    overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '12.5px', fontWeight: '500', lineHeight: '16px', letterSpacing: '0.01em',
    color: '#ece4d4', textShadow: '0 1px 4px #07121a, 0 0 8px #07121a',
  });
  return element;
}

function createDashedOutlineTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  context.strokeStyle = '#8bdcf0'; context.lineWidth = 8; context.lineCap = 'round';
  for (let index = 0; index < 16; index++) {
    const start = index * Math.PI * 2 / 16 + 0.035;
    context.beginPath(); context.arc(64, 64, 52, start, start + 0.19); context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * One renderer, one scene and one camera move continuously from Earth surface to atlas.
 * The API is deliberately independent of app.js and model/network clients.
 */
export function createAtlasScene(container, {
  onPreview = () => {},
  onEnter = () => {},
  onQuestionPreview = () => {},
  onQuestionEnter = () => {},
  onMetrics = () => {},
  onZoomChange = () => {},
  onLevelChange = () => {},
  resolveWorldImageUrl = defaultWorldImageUrl,
  basemapUrl = '/assets/earth-blue-marble.jpg',
  surfaceLabelLevel = SURFACE_LABEL_LEVEL,
  orbitLevel = ORBIT_UNFOLDED_LEVEL,
  reducedMotion = null,
} = {}) {
  if (!container?.append) throw new TypeError('createAtlasScene requires a DOM container');
  const motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
  let motionReduced = reducedMotion == null ? Boolean(motionQuery?.matches) : Boolean(reducedMotion);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#07121a');
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 120);
  scene.add(camera);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
  renderer.domElement.tabIndex = 0;
  renderer.domElement.dataset.focusedWorldId = '';
  renderer.domElement.dataset.previewWorldId = '';
  container.dataset.focusedWorldId = '';
  container.dataset.previewWorldId = '';
  renderer.domElement.setAttribute('role', 'application');
  renderer.domElement.setAttribute('aria-label', 'Interactive branching atlas. Use plus and minus to zoom and Enter to open a focused world.');
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.append(renderer.domElement);
  const labelOverlay = document.createElement('div');
  labelOverlay.className = 'atlas-screen-label-overlay';
  labelOverlay.setAttribute('role', 'group');
  labelOverlay.setAttribute('aria-label', 'Atlas labels');
  Object.assign(labelOverlay.style, {
    position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none',
    zIndex: '2', fontFamily: 'Inter, system-ui, sans-serif',
  });
  container.append(labelOverlay);
  const orbitLeaderSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  orbitLeaderSvg.setAttribute('aria-hidden', 'true');
  orbitLeaderSvg.setAttribute('focusable', 'false');
  Object.assign(orbitLeaderSvg.style, { position:'absolute', inset:'0', width:'100%', height:'100%', overflow:'visible', pointerEvents:'none' });
  labelOverlay.append(orbitLeaderSvg);
  const orbitLeaderElements = new Map();
  const auxiliaryLabels = new Map();
  const orbitLabelLanes = new Map();
  const orbitLaneContents = new Map();
  const orbitChildLabelButtons = new Map();
  let orbitFallbackSection = null;
  let orbitFallbackContent = null;
  let orbitFallbackPlacementWarned = false;
  let orbitFallbackTreeHintOriginal = null;

  scene.add(new THREE.HemisphereLight(0xc5e7ed, 0x102027, 1.55));
  const key = new THREE.DirectionalLight(0xfff1d2, 2.1);
  key.position.set(-3, 5, 7); scene.add(key); scene.add(key.target);
  const fill = new THREE.DirectionalLight(0x75c8e5, 0.72);
  fill.position.set(5, -2, -4); scene.add(fill);

  const atlasGroup = new THREE.Group();
  scene.add(atlasGroup);
  const earthGeometry = new THREE.SphereGeometry(1, 64, 48);
  const miniEarthTexture = new THREE.Texture();
  miniEarthTexture.colorSpace = THREE.SRGBColorSpace;
  const currentEarthTexture = new THREE.Texture();
  currentEarthTexture.colorSpace = THREE.SRGBColorSpace;
  const miniTextureByWorldId = new Map();
  const texturePinMeshes = new Map();
  let atlasPointTexture = null;
  let lodPointMaterial = null;
  const worldTextureFactory = createWorldTextureFactory({
    onReady: result => {
      if (disposed) return;
      updateLayout();
      if (stableWorldId(currentEntry()?.world) === result.worldId) {
        drawCurrentMarker();
      }
      applyZoom(zoom, false);
    },
    onEvict: result => {
      const texture = miniTextureByWorldId.get(result.worldId);
      if (texture) { texture.dispose(); miniTextureByWorldId.delete(result.worldId); }
    },
  });
  const unenteredOutlineTexture = createDashedOutlineTexture();
  let basemapImage = null;
  let currentTextureUsesGeography = false;
  let geographyPreviewWorldId = null, geographyPreviewState, geographyPreviewMode = 'scenario', hasGeographyPreview = false;
  const earthTexture = new THREE.TextureLoader().load(basemapUrl, image => {
    basemapImage = cappedTextureImage(image.image, 2048);
    earthTexture.image = basemapImage; earthTexture.needsUpdate = true;
    miniEarthTexture.image = cappedTextureImage(basemapImage, 512); miniEarthTexture.needsUpdate = true;
    atlasPointTexture?.dispose();
    atlasPointTexture = createOrthographicEarthPointTexture(basemapImage);
    if (lodPointMaterial) {
      lodPointMaterial.map = atlasPointTexture;
      lodPointMaterial.needsUpdate = true;
    }
    p2Renderer.setBaseTexture(earthTexture);
    updateLayout(); drawCurrentMarker(); applyZoom(zoom, false);
  });
  earthTexture.colorSpace = THREE.SRGBColorSpace;
  const earthMaterial = new THREE.MeshStandardMaterial({ map: currentEarthTexture, roughness: 0.94, metalness: 0.02 });
  const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
  earthMesh.userData.worldId = null;
  atlasGroup.add(earthMesh);
  const currentRing = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.018, 10, 64),
    new THREE.MeshBasicMaterial({ color: '#d5a85c', transparent: true, opacity: 0, depthWrite: false }),
  );
  currentRing.name = 'Current world gold ring'; currentRing.visible = false; atlasGroup.add(currentRing);
  const p2Renderer = createAtlasP2Renderer(scene, { earthGeometry, earthMaterial });
  const orbitQuestionParent = new THREE.Mesh(earthGeometry, new THREE.MeshStandardMaterial({ map: miniEarthTexture, color: '#ffffff', roughness: 0.9, metalness: 0.02, transparent: true, depthWrite: false }));
  orbitQuestionParent.name = 'Root question parent anchored to present-day Earth';
  orbitQuestionParent.userData.atlasQuestionParent = true;
  orbitQuestionParent.visible = false; atlasGroup.add(orbitQuestionParent);
  const orbitQuestionHalo = new THREE.Mesh(
    new THREE.TorusGeometry(1.12, 0.045, 10, 48),
    new THREE.MeshBasicMaterial({ color: '#eadfca', transparent: true, opacity: 0.9, depthWrite: false }),
  );
  orbitQuestionHalo.name = 'Root question parent parchment halo'; orbitQuestionHalo.visible = false; atlasGroup.add(orbitQuestionHalo);
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.025, 48, 32), new THREE.MeshBasicMaterial({ color: '#69cde2', transparent: true, opacity: 0.085, side: THREE.BackSide, depthWrite: false }));
  atlasGroup.add(atmosphere);

  const pinGeometry = new THREE.SphereGeometry(ATLAS_PIN_GEOMETRY_RADIUS, 12, 10);
  const surfacePinGeometry = new THREE.RingGeometry(0.009, 0.018, 24);
  const surfacePinMaterial = new THREE.MeshBasicMaterial({
    color: '#ffffff', vertexColors: false, side: THREE.DoubleSide, transparent: true, opacity: 1,
    depthTest: true, depthWrite: false,
  });
  const surfacePinInstances = new THREE.InstancedMesh(surfacePinGeometry, surfacePinMaterial, MAX_SPHERE_INSTANCES);
  surfacePinInstances.count = 0; surfacePinInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  surfacePinInstances.name = 'Flat geographic surface pins'; surfacePinInstances.frustumCulled = false; atlasGroup.add(surfacePinInstances);
  const pinMaterial = new THREE.MeshStandardMaterial({ map: miniEarthTexture, color: '#ffffff', roughness: 0.9, metalness: 0.02 });
  const instancedPins = new THREE.InstancedMesh(pinGeometry, pinMaterial, MAX_SPHERE_INSTANCES);
  instancedPins.count = 0; instancedPins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  instancedPins.frustumCulled = false; atlasGroup.add(instancedPins);
  texturePinMeshes.set(miniEarthTexture, instancedPins);
  function pinMeshForTexture(texture) {
    let mesh = texturePinMeshes.get(texture);
    if (mesh) return mesh;
    const material = new THREE.MeshStandardMaterial({ map: texture, color: '#ffffff', roughness: 0.9, metalness: 0.02, transparent: true });
    mesh = new THREE.InstancedMesh(pinGeometry, material, MAX_SPHERE_INSTANCES);
    mesh.count = 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
    mesh.name = 'Per-world geography Earth instances'; atlasGroup.add(mesh); texturePinMeshes.set(texture, mesh);
    return mesh;
  }
  const ghostPins = new THREE.InstancedMesh(pinGeometry, new THREE.MeshBasicMaterial({ color: '#d5a85c', wireframe: true, transparent: true, opacity: 0.9, depthWrite: false }), MAX_SPHERE_INSTANCES);
  ghostPins.name = 'Optional hollow gold ancestor pins'; ghostPins.count = 0; ghostPins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ghostPins.frustumCulled = false; ghostPins.visible = false; atlasGroup.add(ghostPins);
  const pointGeometry = new THREE.BufferGeometry();
  const pointPositions = new Float32Array(0), pointColors = new Float32Array(0);
  pointGeometry.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));
  pointGeometry.setAttribute('color', new THREE.BufferAttribute(pointColors, 3));
  lodPointMaterial = new THREE.PointsMaterial({ size: 4.2, sizeAttenuation: false, map: atlasPointTexture, alphaTest: 0.08, vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false });
  const lodPoints = new THREE.Points(pointGeometry, lodPointMaterial);
  lodPoints.frustumCulled = false; atlasGroup.add(lodPoints);

  const threadGeometry = new THREE.BufferGeometry();
  const threadMaterial = new THREE.LineDashedMaterial({ color: '#57c9e7', dashSize: 0.075, gapSize: 0.055, transparent: true, opacity: 0.8, vertexColors: true });
  const threads = new THREE.LineSegments(threadGeometry, threadMaterial);
  threads.frustumCulled = false; atlasGroup.add(threads);
  const hoverThreads = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#a4e8f5', transparent: true, opacity: 0.95, depthWrite: false, vertexColors: true }));
  hoverThreads.name = 'Hovered exploration path'; hoverThreads.frustumCulled = false; atlasGroup.add(hoverThreads);
  const lineageThreads = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#d5a85c', transparent: true, opacity: 0.9, depthWrite: false, vertexColors: true }));
  lineageThreads.name = 'Gold current lineage edges'; lineageThreads.frustumCulled = false; atlasGroup.add(lineageThreads);
  const goldEdgeGeometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false);
  const GOLD_OPACITY_BUCKET_COUNT = 8;
  const goldEdgeCapacities = [];
  function makeGoldEdgeMesh(capacity) {
    const geometry = goldEdgeGeometry.clone();
    const material = new THREE.MeshBasicMaterial({ color: '#d5a85c', transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'Thick continuous gold lineage ribbons'; mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
    atlasGroup.add(mesh);
    return mesh;
  }
  const goldEdgeMeshes = [];
  function ensureGoldEdgeCapacity(bucketIndex, required) {
    while (goldEdgeMeshes.length <= bucketIndex && goldEdgeMeshes.length < GOLD_OPACITY_BUCKET_COUNT) {
      goldEdgeCapacities.push(INITIAL_GOLD_EDGE_SEGMENTS);
      goldEdgeMeshes.push(makeGoldEdgeMesh(INITIAL_GOLD_EDGE_SEGMENTS));
    }
    if (!goldEdgeMeshes[bucketIndex]) return;
    if (required <= goldEdgeCapacities[bucketIndex]) return;
    const previous = goldEdgeMeshes[bucketIndex];
    goldEdgeCapacities[bucketIndex] = 2 ** Math.ceil(Math.log2(required));
    goldEdgeMeshes[bucketIndex] = makeGoldEdgeMesh(goldEdgeCapacities[bucketIndex]);
    const next = goldEdgeMeshes[bucketIndex];
    atlasGroup.remove(previous); previous.geometry.dispose(); previous.material.dispose(); previous.dispose?.();
    return next;
  }
  function renderedGoldEdgeSegmentCount() {
    return goldEdgeMeshes.reduce((sum, mesh) => sum + mesh.count, 0);
  }
  const questionThreads = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#eadfca', dashSize: 0.09, gapSize: 0.055, transparent: true, opacity: 0.84, depthWrite: false, vertexColors: true }));
  questionThreads.name = 'Parchment authored question edges'; questionThreads.frustumCulled = false; atlasGroup.add(questionThreads);

  const registry = createWorldRegistry();
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.055;
  const pointer = new THREE.Vector2();
  const dummy = new THREE.Object3D();
  const surfaceYawAxis = new THREE.Vector3(0, 1, 0), surfacePitchAxis = new THREE.Vector3(1, 0, 0);
  const surfaceYawQuaternion = new THREE.Quaternion(), surfacePitchQuaternion = new THREE.Quaternion();
  const earthFacingYawQuaternion = new THREE.Quaternion(), earthFacingPitchQuaternion = new THREE.Quaternion();
  const earthDesiredWorldQuaternion = new THREE.Quaternion();
  const goldCylinderUp = new THREE.Vector3(0, 1, 0);
  const goldSegmentStart = new THREE.Vector3(), goldSegmentEnd = new THREE.Vector3(), goldSegmentDirection = new THREE.Vector3();
  const goldSegmentWorldMidpoint = new THREE.Vector3(), goldCameraWorldPosition = new THREE.Vector3();
  const instanceIds = [], lodIds = [];
  const lodIdSet = new Set();
  const stageFps = new Map();
  const domListeners = [];
  let worlds = [], questions = [], entries = [], currentId = null, arrivalFromId = null, zoom = 0, rotation = 0;
  let surfaceFacingAngle = 0, surfaceFacingPitch = 0;
  let orbitNeighborhoodIds = new Set();
  let liveCameraDistance = altitudeForZoom(zoom);
  let clusterPlan = { surface: { visibleIds: [], clusters: [] }, orbit: { visibleIds: [], clusters: [] } };
  const clusterSprites = new Map();
  let axisMode = 'history-distance', atlasTimeline = null, axisTransition = null;
  let travelMode = motionReduced ? 'cut' : 'threads', travelState = null, ghostTrail = GHOST_TRAIL_DEFAULT;
  let travelOpacity = 1, axisFadeOpacity = 1, reducedMotionOpacity = 1;
  let surfaceLabelsLevel = clampAtlasLevel(surfaceLabelLevel), orbitUnfoldLevel = clampAtlasLevel(orbitLevel, ORBIT_UNFOLDED_LEVEL);
  let hoveredId = null, hoveredQuestionId = null, hoveredReference = false, hoveredClusterId = null, disposed = false, lastMetricAt = 0, lastLevel = '', raf = 0;
  let largeClusterPicker = null;
  const visibleKeyboardWorldIds = new Set();
  const expandedQuestionIds = new Set();
  let fanOffsets = new Map(), fanRegion = null;
  let orbitQuestionParentPosition = null, orbitQuestionParentQuestion = null;
  let stageFrameLevel = '', stageFrameWindow = [];
  let drag = null, pinchGesture = null;
  const activePointers = new Map();
  const panOffset = new THREE.Vector2();

  camera.position.set(0, 0, altitudeForZoom(zoom));
  camera.lookAt(0, 0, 0);

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    domListeners.push(() => target.removeEventListener(type, handler, options));
  }
  function updateCanvasOpacity() {
    renderer.domElement.style.opacity = String(travelOpacity * axisFadeOpacity * reducedMotionOpacity);
  }
  if (motionQuery?.addEventListener) {
    const onMotionPreference = event => {
      motionReduced = Boolean(event.matches);
      travelMode = motionReduced ? 'cut' : 'threads';
      if (motionReduced && travelState) {
        travelState = { ...travelState, pathIds: [travelState.fromId, travelState.toId], startedAt: performance.now(), duration: travelDuration('cut', true), cut: true, cutSwitched: false };
      }
      applyZoom(zoom, false);
    };
    motionQuery.addEventListener('change', onMotionPreference);
    domListeners.push(() => motionQuery.removeEventListener('change', onMotionPreference));
  }
  function stageForZoom(value) {
    return value < 0.22 ? 'surface' : value < 0.57 ? 'lift' : value < 0.84 ? 'orbit' : 'atlas';
  }
  function currentEntry() { return entries.find(entry => entry.id === currentId) || null; }
  const projectedGlobeByTexture = new WeakMap();
  function projectedGlobe(entry) {
    const current = currentEntry();
    const texture = current ? worldScenarioTexture(current.world) : null;
    if (texture?.status !== 'ready' || texture.geography?.version !== 2 || !texture.terrain) return entry.globe;
    const lat = Number(entry.world?.lat ?? entry.world?.geography?.lat ?? entry.world?.geog?.lat);
    const lon = Number(entry.world?.lon ?? entry.world?.geography?.lon ?? entry.world?.geog?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return entry.globe;
    let byId = projectedGlobeByTexture.get(texture);
    if (!byId) { byId = new Map(); projectedGlobeByTexture.set(texture, byId); }
    if (byId.has(entry.id)) return byId.get(entry.id);
    const location = projectGeographyLocation({ lat, lon }, texture.geography, texture.terrain);
    const phi = (90 - location.lat) * Math.PI / 180, theta = (location.lon + 180) * Math.PI / 180;
    const globe = { x: -Math.sin(phi) * Math.cos(theta), y: Math.cos(phi), z: Math.sin(phi) * Math.sin(theta) };
    byId.set(entry.id, globe);
    return globe;
  }
  function surfacePoint(entry, radius = 1) { return geographyPoint(entry, radius, projectedGlobe(entry)); }
  function surfaceEarthRadius(state) { return state.earthScale * (1 - 0.12 * state.atlas); }
  function renderedPinScale(state) { return pinScaleAtPresentation(state.lift, state.atlas); }
  function renderedPinAnchorRadius(state) { return pinAnchorRadiusAtPresentation(surfaceEarthRadius(state), state.lift, state.atlas); }
  function atlasPosition(entry, timestamp = performance.now()) {
    const target = atlasTimeline?.positions.get(entry.id) || entry.atlas;
    if (!axisTransition) return new THREE.Vector3(target.x, target.y, target.z || 0);
    const start = axisTransition.from.get(entry.id) || target;
    const end = axisTransition.to.positions.get(entry.id) || target;
    const progress = axisTransitionProgress(timestamp - axisTransition.startedAt, AXIS_ANIMATION_MS);
    const point = interpolateAtlasPoint(start, end, progress);
    return new THREE.Vector3(point.x, point.y, point.z);
  }
  function graphSnapshot() { return { worlds, questions }; }
  function ancestorIds(id) {
    const byId = new Map(worlds.map(world => [stableWorldId(world), world]));
    const result = [], seen = new Set();
    let cursor = String(id ?? '');
    while (cursor && byId.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      const parent = byId.get(cursor)?.parentId;
      if (parent == null || !byId.has(String(parent))) break;
      cursor = String(parent); result.push(cursor);
    }
    return result;
  }
  function refreshAtlasTimeline() {
    atlasTimeline = buildAtlasTimeline(graphSnapshot(), currentId, axisMode, { expandedQuestionIds: [...expandedQuestionIds], frameAspect: camera.aspect });
    container.dataset.atlasRouteWarnings = String([...(atlasTimeline.parentChildPaths || []), ...(atlasTimeline.questionRootPaths || []), ...(atlasTimeline.questionStemPaths || [])]
      .filter(path => path.unresolvedCrossings.length || path.unresolvedNodes.length).length);
    const byId = new Map(atlasTimeline.worlds.map(item => [item.id, item]));
    const realSphereIds = new Set(atlasTimeline.realSphereIds);
    const foldedIds = new Set(atlasTimeline.foldedIds);
    for (const entry of entries) {
      const atlasEntry = byId.get(entry.id);
      entry.atlasInfo = atlasEntry || null;
      entry.atlasLabelVisible = Boolean(atlasEntry?.labelVisible);
      entry.atlasRealSphere = realSphereIds.has(entry.id);
      entry.folded = foldedIds.has(entry.id);
    }
    p2Renderer.update(atlasTimeline, { opacity: atlasZoomState(zoom).atlas, axisMode });
  }
  function withScreenOffset(point, offset) {
    if (!offset || (!offset.x && !offset.y)) return point;
    const worldPoint = point.clone().applyMatrix4(atlasGroup.matrixWorld);
    const cameraPoint = worldPoint.clone().applyMatrix4(camera.matrixWorldInverse);
    const depth = Math.max(0.01, -cameraPoint.z);
    const pixelsToWorld = 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      / Math.max(1, renderer.domElement.clientHeight);
    const worldDelta = new THREE.Vector3(Number(offset.x) * pixelsToWorld, -Number(offset.y) * pixelsToWorld, 0)
      .applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const inverse = new THREE.Matrix4().copy(atlasGroup.matrixWorld).invert();
    worldDelta.applyMatrix3(new THREE.Matrix3().setFromMatrix4(inverse));
    return point.add(worldDelta);
  }
  function arrivalSurfacePoint() {
    const earthCenter = earthMesh.getWorldPosition(new THREE.Vector3());
    const cameraQuaternion = camera.getWorldQuaternion(new THREE.Quaternion());
    const offset = new THREE.Vector3(-0.4, 0.15, 1.3).applyQuaternion(cameraQuaternion);
    const worldPoint = earthCenter.add(offset);
    const inverse = new THREE.Matrix4().copy(atlasGroup.matrixWorld).invert();
    return worldPoint.applyMatrix4(inverse);
  }
  function geographicWorldPosition(entry, state, timestamp = performance.now(), radius = surfaceEarthRadius(state)) {
    const surface = surfacePoint(entry, radius).add(earthMesh.position);
    const orbitPosition = entry.orbit || entry.atlas;
    const orbit = new THREE.Vector3(orbitPosition.x, orbitPosition.y, orbitPosition.z);
    const point = surface.lerp(orbit, state.lift).lerp(atlasPosition(entry, timestamp), state.atlas);
    return withScreenOffset(point, fanOffsets.get(entry.id));
  }
  function worldPosition(entry, state, timestamp = performance.now(), radius = renderedPinAnchorRadius(state)) {
    if (entry.id !== arrivalFromId) return geographicWorldPosition(entry, state, timestamp, radius);
    const orbitPosition = entry.orbit || entry.atlas;
    const orbit = new THREE.Vector3(orbitPosition.x, orbitPosition.y, orbitPosition.z);
    const point = arrivalSurfacePoint().lerp(orbit, state.lift).lerp(atlasPosition(entry, timestamp), state.atlas);
    return withScreenOffset(point, fanOffsets.get(entry.id));
  }
  function hitWorldPosition(entry, state, timestamp = performance.now()) {
    const radius = lodIdSet.has(entry.id) ? surfaceEarthRadius(state) + 0.003 : renderedPinAnchorRadius(state);
    return worldPosition(entry, state, timestamp, radius);
  }

  function travelSample(timestamp) {
    if (!travelState) return null;
    const progress = clamp((timestamp - travelState.startedAt) / Math.max(1, travelState.duration), 0, 1);
    const eased = smoothTravelProgress(progress);
    return { progress, eased, segment: sampleLineagePath(travelState.pathIds, eased) };
  }

  function travelEarthPosition(timestamp, state) {
    const segment = travelSample(timestamp)?.segment;
    const from = entries.find(entry => entry.id === segment?.fromId);
    const to = entries.find(entry => entry.id === segment?.toId);
    if (!from || !to) return null;
    const orbitPoint = interpolateTravelPoint(from.orbit || from.atlas, to.orbit || to.atlas, segment.progress);
    const atlasPoint = interpolateTravelPoint(atlasPosition(from, timestamp), atlasPosition(to, timestamp), segment.progress);
    const orbit = new THREE.Vector3(orbitPoint.x, orbitPoint.y, orbitPoint.z);
    const atlas = new THREE.Vector3(atlasPoint.x, atlasPoint.y, atlasPoint.z);
    return new THREE.Vector3(0, 0, 0).lerp(orbit, state.lift).lerp(atlas, state.atlas);
  }

  function travelFacingAngles(timestamp) {
    const sample = travelSample(timestamp)?.segment;
    const from = entries.find(entry => entry.id === sample?.fromId);
    const to = entries.find(entry => entry.id === sample?.toId);
    if (!from || !to) return { yaw: surfaceFacingAngle, pitch: surfaceFacingPitch };
    const a = surfaceFacingOrientation(projectedGlobe(from)), b = surfaceFacingOrientation(projectedGlobe(to));
    const delta = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
    return { yaw: a.yaw + delta * sample.progress, pitch: a.pitch + (b.pitch - a.pitch) * sample.progress };
  }

  function applySurfaceOrientation(blend, timestamp = performance.now()) {
    const facing = travelState && !travelState.cut
      ? travelFacingAngles(timestamp)
      : { yaw: surfaceFacingAngle, pitch: surfaceFacingPitch };
    const amount = clamp(Number(blend ?? 1), 0, 1);
    const yaw = (facing.yaw + rotation) * amount;
    const pitch = facing.pitch * amount;
    surfaceYawQuaternion.setFromAxisAngle(surfaceYawAxis, yaw);
    surfacePitchQuaternion.setFromAxisAngle(surfacePitchAxis, pitch);
    atlasGroup.quaternion.copy(surfacePitchQuaternion).multiply(surfaceYawQuaternion);
    earthFacingYawQuaternion.setFromAxisAngle(surfaceYawAxis, facing.yaw + rotation);
    earthFacingPitchQuaternion.setFromAxisAngle(surfacePitchAxis, facing.pitch);
    earthDesiredWorldQuaternion.copy(earthFacingPitchQuaternion).multiply(earthFacingYawQuaternion);
    const earthLocalFacing = localQuaternionForWorldFacing(atlasGroup.quaternion, earthDesiredWorldQuaternion);
    earthMesh.quaternion.set(earthLocalFacing.x, earthLocalFacing.y, earthLocalFacing.z, earthLocalFacing.w);
  }

  function atlasFrameBounds() {
    const folded = new Set(atlasTimeline?.foldedIds || []);
    const foldedQuestionIds = new Set((atlasTimeline?.chips || []).map(chip => String(chip.questionId)));
    const xs = [...(atlasTimeline?.positions?.values?.() || [])].filter(point => !folded.has(point.id)).map(point => point.x);
    const ys = [...(atlasTimeline?.positions?.values?.() || [])].filter(point => !folded.has(point.id)).map(point => point.y);
    for (const branch of atlasTimeline?.questionBranches || []) {
      if (foldedQuestionIds.has(String(branch.questionId))) continue;
      xs.push(branch.x, branch.labelX); ys.push(branch.y, branch.labelY);
    }
    for (const chip of atlasTimeline?.chips || []) { xs.push(chip.x); ys.push(chip.y); }
    const routeBounds = atlasTimeline?.routeBounds;
    if (routeBounds) { xs.push(routeBounds.left, routeBounds.right); ys.push(routeBounds.bottom, routeBounds.top); }
    const paths = atlasTimeline?.parentChildPaths || [];
    const previousPaths = new Map((axisTransition?.fromTimeline?.parentChildPaths || [])
      .map(path => [`${path.parentId}\u0000${path.childId}`, path]));
    for (const path of paths) {
      const key = `${path.parentId}\u0000${path.childId}`;
      const prior = previousPaths.get(key);
      if (path.routeShape?.length > 1) includeRouteShapeBounds(transformAtlasEdgeShape(path.from, path.to, path.routeShape), xs, ys);
      if (prior?.routeShape?.length > 1) {
        includeRouteShapeBounds(transformAtlasEdgeShape(prior.from, prior.to, prior.routeShape), xs, ys);
        if (path.routeShape?.length > 1) {
          includeRouteShapeBounds(transformAtlasEdgeShape(path.from, path.to, prior.routeShape), xs, ys);
          includeRouteShapeBounds(transformAtlasEdgeShape(prior.from, prior.to, path.routeShape), xs, ys);
        }
      }
    }
    const rootPaths = atlasTimeline?.questionRootPaths || [];
    const previousRootPaths = new Map((axisTransition?.fromTimeline?.questionRootPaths || [])
      .map(path => [`${path.questionId}\u0000${path.worldId}`, path]));
    for (const path of rootPaths) {
      const prior = previousRootPaths.get(`${path.questionId}\u0000${path.worldId}`);
      if (path.routeShape?.length > 1) includeRouteShapeBounds(transformAtlasEdgeShape(path.from, path.to, path.routeShape), xs, ys);
      if (prior?.routeShape?.length > 1) {
        includeRouteShapeBounds(transformAtlasEdgeShape(prior.from, prior.to, prior.routeShape), xs, ys);
        if (path.routeShape?.length > 1) {
          includeRouteShapeBounds(transformAtlasEdgeShape(path.from, path.to, prior.routeShape), xs, ys);
          includeRouteShapeBounds(transformAtlasEdgeShape(prior.from, prior.to, path.routeShape), xs, ys);
        }
      }
    }
    const stemPaths = atlasTimeline?.questionStemPaths || [];
    const previousStemPaths = new Map((axisTransition?.fromTimeline?.questionStemPaths || [])
      .map(path => [questionStemPathKey(path), path]));
    for (const path of stemPaths) {
      const prior = previousStemPaths.get(questionStemPathKey(path));
      if (path.routeShape?.length > 1) includeRouteShapeBounds(transformAtlasEdgeShape(path.from, path.to, path.routeShape), xs, ys);
      if (prior?.routeShape?.length > 1) {
        includeRouteShapeBounds(transformAtlasEdgeShape(prior.from, prior.to, prior.routeShape), xs, ys);
        if (path.routeShape?.length > 1) {
          includeRouteShapeBounds(transformAtlasEdgeShape(path.from, path.to, prior.routeShape), xs, ys);
          includeRouteShapeBounds(transformAtlasEdgeShape(prior.from, prior.to, path.routeShape), xs, ys);
        }
      }
    }
    xs.push(atlasTimeline?.trunk?.left ?? -4.6, atlasTimeline?.trunk?.right ?? 3.8, atlasTimeline?.futureExtension?.toX ?? 0);
    ys.push(atlasTimeline?.trunk?.y ?? 0, -0.8);
    const validX = xs.filter(Number.isFinite), validY = ys.filter(Number.isFinite);
    const bottom = Math.min(...validY) - 0.55;
    const contentTop = Math.max(...validY) + 0.75;
    const toolbarReservation = Math.max(0.55, (contentTop - bottom) * 0.2);
    return {
      left: Math.min(...validX) - 0.65,
      right: Math.max(...validX) + 0.85,
      bottom,
      top: contentTop + toolbarReservation,
    };
  }

  function fittedAtlasDistance() {
    const frame = atlasFrameBounds();
    // The camera already looks at the bounds centre; fitting absolute
    // coordinates would add the centre offset twice and shrink the tree.
    return fitCenteredCameraDistance(frame, camera.aspect, camera.fov, 1.08);
  }

  function worldScenarioTexture(world) {
    const worldId = stableWorldId(world);
    const isPreviewWorld = hasGeographyPreview && worldId === geographyPreviewWorldId && worldId === currentId;
    if (isPreviewWorld && geographyPreviewMode === 'present') return null;
    const raw = isPreviewWorld
      ? geographyPreviewState : (world?.geography ?? world?.geog);
    if (raw == null) return null;
    return worldTextureFactory.create({ ...world, geography: raw }, { baseImage: basemapImage, baseIdentity: basemapUrl });
  }

  function miniTextureForWorld(world) {
    const result = worldScenarioTexture(world);
    if (result?.status !== 'ready') return miniEarthTexture;
    const id = stableWorldId(world);
    let texture = miniTextureByWorldId.get(id);
    if (!texture || texture.image !== result.miniCanvas) {
      texture?.dispose();
      texture = new THREE.CanvasTexture(result.miniCanvas); texture.colorSpace = THREE.SRGBColorSpace;
      miniTextureByWorldId.set(id, texture);
    }
    return texture;
  }

  function drawCurrentMarker() {
    const current = currentEntry();
    if (!basemapImage || !current) return;
    const geographyTexture = worldScenarioTexture(current.world);
    currentTextureUsesGeography = geographyTexture?.status === 'ready';
    const source = currentTextureUsesGeography
      ? geographyTexture.currentCanvas : basemapImage;
    const canvas = document.createElement('canvas');
    canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext('2d'); context.drawImage(source, 0, 0);
    const rawLat = Number(current.world.lat ?? current.world.geography?.lat ?? current.world.geog?.lat);
    const rawLon = Number(current.world.lon ?? current.world.geography?.lon ?? current.world.geog?.lon);
    if (Number.isFinite(rawLat) && Number.isFinite(rawLon)) {
      const location = currentTextureUsesGeography && geographyTexture.geography?.version === 2 && geographyTexture.terrain
        ? projectGeographyLocation({ lat: rawLat, lon: rawLon }, geographyTexture.geography, geographyTexture.terrain)
        : { lat: rawLat, lon: rawLon };
      const x = ((location.lon + 180) / 360) * canvas.width;
      const y = ((90 - location.lat) / 180) * canvas.height;
      const radius = Math.max(2, canvas.width * 0.0008);
      context.beginPath(); context.arc(x, y, radius * 2, 0, Math.PI * 2); context.fillStyle = '#d5a85c'; context.globalAlpha = 0.9; context.fill();
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fillStyle = '#f5dfae'; context.globalAlpha = 1; context.fill();
    }
    currentEarthTexture.image = canvas; currentEarthTexture.needsUpdate = true;
  }

  function disposeWorldRecord(record) {
    if (!record) return;
    record.label?.remove?.();
    if (record.disc) {
      atlasGroup.remove(record.disc);
      record.disc.material.map?.dispose(); record.disc.material.dispose();
    }
    if (record.unenteredOutline) { atlasGroup.remove(record.unenteredOutline); record.unenteredOutline.material.dispose(); }
  }

  function updateLayout({ animateQuestionRefocus = false, timestamp = performance.now() } = {}) {
    const fromTimeline = atlasTimeline;
    const priorQuestionId = fromTimeline?.activeQuestionId || null;
    const from = animateQuestionRefocus && priorQuestionId
      ? new Map(entries.map(entry => {
        const point = atlasPosition(entry, timestamp);
        return [entry.id, { x: point.x, y: point.y, z: point.z }];
      })) : null;
    entries = layoutAtlasWorlds(worlds, currentId);
    const orbitPositions = layoutOrbitNeighborhood(entries, currentId);
    for (const entry of entries) entry.orbit = orbitPositions.get(entry.id) || entry.atlas;
    const parentIds = new Set(worlds.filter(world => world.parentId != null).map(world => String(world.parentId)));
    for (const entry of entries) entry.explored = entry.world.explored === true || entry.world.hasChildren === true || parentIds.has(entry.id) || entry.world.mapState === 'explored' || entry.world.status === 'explored';
    const current = currentEntry();
    const questionId = current?.parentId == null ? String(current?.world?.questionId ?? '') : '';
    orbitQuestionParentQuestion = questionId ? questions.find(question => String(question.id) === questionId)
      || { id: questionId, question: questionId } : null;
    orbitQuestionParentPosition = questionId ? orbitPositions.get(`question:${questionId}`) || null : null;
    orbitQuestionParent.userData.questionId = questionId || '';
    orbitQuestionParent.userData.question = orbitQuestionParentQuestion;
    orbitQuestionParent.visible = Boolean(orbitQuestionParentPosition && orbitQuestionParentQuestion);
    orbitQuestionHalo.visible = orbitQuestionParent.visible;
    const currentFacing = current ? surfaceFacingOrientation(projectedGlobe(current)) : { yaw: 0, pitch: 0 };
    surfaceFacingAngle = currentFacing.yaw;
    surfaceFacingPitch = currentFacing.pitch;
    earthMesh.userData.worldId = current?.id ?? null;
    const record = current && registry.get(current.id);
    if (record) record.object = earthMesh;
    const surfaceLabels = selectSurfaceWorldLabelIds(worlds, currentId, surfaceLabelsLevel, arrivalFromId, ghostTrail ? ancestorIds(currentId) : []);
    clusterPlan = planWorldClusters(worlds, currentId, { surfaceLabelLevel: surfaceLabelsLevel, orbitLevel: orbitUnfoldLevel, hoveredClusterId });
    const rootSiblings = current?.parentId == null && current?.world?.questionId != null
      ? entries.filter(entry => entry.parentId == null && entry.id !== currentId
        && String(entry.world?.questionId ?? '') === String(current.world.questionId)
        && orbitPositions.has(entry.id)).map(entry => entry.id)
      : [];
    const neighborhoodIds = new Set([
      currentId,
      ...(current?.parentId != null ? [current.parentId] : []),
      ...(current?.parentId == null ? rootSiblings : entries.filter(entry => entry.id !== currentId && entry.parentId === current?.parentId).map(entry => entry.id)),
      ...entries.filter(entry => entry.parentId === currentId).map(entry => entry.id),
    ].filter(Boolean));
    orbitNeighborhoodIds = neighborhoodIds;
    const plannedOrbit = new Set(clusterPlan.orbit.visibleIds);
    const visibleOrbit = new Set([...plannedOrbit].filter(id => neighborhoodIds.has(id)));
    if (currentId) visibleOrbit.add(currentId);
    if (current?.parentId != null) visibleOrbit.add(String(current.parentId));
    for (const id of rootSiblings) visibleOrbit.add(id);
    const visibleSurface = new Set(clusterPlan.surface.visibleIds);
    for (const entry of entries) {
      const worldRecord = registry.get(entry.id);
      if (worldRecord) {
        worldRecord.object = entry.id === currentId ? earthMesh : null;
        const labelText = worldLabelText(entry.world);
        if (!worldRecord.label) {
          worldRecord.label = createWorldLabel(entry.world);
          labelOverlay.append(worldRecord.label);
        } else if (worldRecord.label.textContent !== labelText) {
          worldRecord.label.textContent = labelText;
        }
        const sceneSource = imageForWorld(entry.world, entry.id === currentId, resolveWorldImageUrl);
        if (entry.id !== currentId && sceneSource) {
          const discKey = sceneSource;
          if (!worldRecord.disc || worldRecord.discSource !== discKey) {
            if (worldRecord.disc) {
              atlasGroup.remove(worldRecord.disc);
              worldRecord.disc.material.map?.dispose(); worldRecord.disc.material.dispose();
            }
            const texture = createCanvasDiscTexture(sceneSource);
            const material = new THREE.SpriteMaterial({ map: texture, color: '#ffffff', transparent: true, depthWrite: false, opacity: 0 });
            const sprite = new THREE.Sprite(material);
            sprite.scale.set(0.44, 0.44, 1);
            atlasGroup.add(sprite);
            worldRecord.disc = sprite;
            worldRecord.discSource = discKey;
          }
        } else if (worldRecord.disc) {
          atlasGroup.remove(worldRecord.disc);
          worldRecord.disc.material.map?.dispose(); worldRecord.disc.material.dispose();
          worldRecord.disc = null;
        }
      }
      entry.surfaceLabel = surfaceLabels.has(entry.id) || Boolean(clusterPlan.surface.fannedClusterId && visibleSurface.has(entry.id));
      entry.surfaceVisible = entry.current || visibleSurface.has(entry.id) || entry.id === arrivalFromId;
      entry.orbitVisible = visibleOrbit.has(entry.id) || entry.current;
      if (entry.id !== currentId && entry.world.selectable !== false) {
        if (!worldRecord.unenteredOutline) {
          const material = new THREE.SpriteMaterial({ map: unenteredOutlineTexture, color: '#87d9ed', transparent: true, depthWrite: false, opacity: 0 });
          worldRecord.unenteredOutline = new THREE.Sprite(material); worldRecord.unenteredOutline.name = 'Dim Atlas possibility dashed outline';
          atlasGroup.add(worldRecord.unenteredOutline);
        }
      } else if (worldRecord.unenteredOutline) {
        atlasGroup.remove(worldRecord.unenteredOutline); worldRecord.unenteredOutline.material.dispose(); worldRecord.unenteredOutline = null;
      }
    }

    const desiredClusters = [
      ...clusterPlan.surface.clusters.map(cluster => ({ ...cluster, level: 'surface' })),
      ...clusterPlan.orbit.clusters.map(cluster => ({ ...cluster, level: 'orbit' })),
    ];
    const desiredKeys = new Set(desiredClusters.map(cluster => `${cluster.level}:${cluster.id}`));
    for (const [key, sprite] of clusterSprites) if (!desiredKeys.has(key)) {
      atlasGroup.remove(sprite); sprite.material.map?.dispose(); sprite.material.dispose(); clusterSprites.delete(key);
    }
    for (const cluster of desiredClusters) {
      const key = `${cluster.level}:${cluster.id}`;
      let sprite = clusterSprites.get(key);
      if (!sprite) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const context = canvas.getContext('2d');
        context.fillStyle = cluster.selectable ? 'rgba(10, 29, 37, .94)' : 'rgba(48, 38, 25, .94)';
        context.beginPath(); context.arc(128, 128, 112, 0, Math.PI * 2); context.fill();
        context.strokeStyle = cluster.selectable ? '#55c9e9' : '#eadfca'; context.lineWidth = 8; context.stroke();
        context.fillStyle = cluster.selectable ? '#9ce9fa' : '#f0dfbd'; context.font = '600 30px Inter, system-ui, sans-serif';
        context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(cluster.label, 128, 128, 205);
        const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, opacity: 0 });
        sprite = new THREE.Sprite(material); sprite.name = `Atlas cluster ${cluster.kind}`;
        sprite.userData.cluster = cluster; atlasGroup.add(sprite); clusterSprites.set(key, sprite);
      } else sprite.userData.cluster = cluster;
    }
    largeClusterPicker?.setClusters(desiredClusters, worlds);

    const childEntries = entries.filter(entry => entry.child && entry.id !== currentId);
    const linePositions = new Float32Array(childEntries.length * 6);
    const layoutState = atlasPresentationState(zoom, motionReduced).state;
    const layoutMarkerRadius = pinAnchorRadiusAtPresentation(surfaceEarthRadius(layoutState), layoutState.lift, layoutState.atlas);
    childEntries.forEach((entry, index) => {
      const from = surfacePoint(entry, layoutMarkerRadius).add(earthMesh.position);
      const to = new THREE.Vector3(entry.orbit.x, entry.orbit.y, entry.orbit.z);
      from.lerp(to, layoutState.lift);
      const selected = current ? new THREE.Vector3(current.orbit.x, current.orbit.y, current.orbit.z) : new THREE.Vector3(0, 0, 0);
      selected.lerp(surfacePoint(current || entry, surfaceEarthRadius(layoutState)).add(earthMesh.position), 1 - layoutState.lift);
      selected.toArray(linePositions, index * 6);
      to.toArray(linePositions, index * 6 + 3);
    });
    threadGeometry.dispose();
    const nextThreadGeometry = new THREE.BufferGeometry();
    nextThreadGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    nextThreadGeometry.computeBoundingSphere();
    threads.geometry = nextThreadGeometry; threads.computeLineDistances();
    refreshAtlasTimeline();
    if (animateQuestionRefocus && !motionReduced && priorQuestionId
      && atlasTimeline?.activeQuestionId && atlasTimeline.activeQuestionId !== priorQuestionId) {
      axisTransition = { from: from || new Map(), to: atlasTimeline, fromTimeline, startedAt: timestamp };
    }
  }

  function writePositionBuffer(line, positions) {
    let attribute = line.geometry.attributes.position;
    if (!attribute || attribute.array.length !== positions.length) {
      line.geometry.dispose(); line.geometry = new THREE.BufferGeometry();
      line.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
      attribute = line.geometry.attributes.position;
    }
    attribute.array.set(positions); attribute.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  }

  function writeEdgeBuffer(line, positions, opacities) {
    writePositionBuffer(line, positions);
    const vertexCount = positions.length / 3;
    let colorAttribute = line.geometry.attributes.color;
    if (!colorAttribute || colorAttribute.itemSize !== 4 || colorAttribute.count !== vertexCount) {
      colorAttribute = new THREE.BufferAttribute(new Float32Array(vertexCount * 4), 4);
      line.geometry.setAttribute('color', colorAttribute);
    }
    const colors = colorAttribute.array;
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      colors[vertex * 4] = 1; colors[vertex * 4 + 1] = 1; colors[vertex * 4 + 2] = 1;
      colors[vertex * 4 + 3] = Number(opacities[vertex]) || 0;
    }
    colorAttribute.needsUpdate = true;
  }


  function applyZoom(value, announce = true, timestamp = performance.now()) {
    zoom = clamp(Number(value) || 0, 0, 1);
    const zoomStage = stageForZoom(zoom);
    container.dataset.atlasLevel = zoomStage;
    renderer.domElement.dataset.atlasLevel = zoomStage;
    if (announce) onZoomChange(zoom);
    const presentation = atlasPresentationState(zoom, motionReduced);
    const state = presentation.state;
    const suppressAtlasThreads = Boolean(axisTransition && state.atlas > 0.015);
    document.documentElement.style.setProperty('--atlas-lift', String(state.lift));
    document.documentElement.style.setProperty('--atlas-rail-width', `${320 - 266 * state.lift}px`);
    reducedMotionOpacity = presentation.opacity;
    updateCanvasOpacity();
    const current = currentEntry();
    const currentAtlas = current ? atlasPosition(current, timestamp) : new THREE.Vector3(-1.9, 0, 0);
    const currentOrbit = current ? new THREE.Vector3(current.orbit.x, current.orbit.y, current.orbit.z) : currentAtlas;
    let earthPosition = new THREE.Vector3(0, 0, 0).lerp(currentOrbit, state.lift).lerp(currentAtlas, state.atlas);
    if (travelState && !travelState.cut) {
      earthPosition = travelEarthPosition(timestamp, state) || earthPosition;
    }
    earthMesh.position.copy(earthPosition);
    earthMesh.scale.setScalar(state.earthScale * (1 - 0.12 * state.atlas));
    currentRing.position.copy(earthMesh.position);
    currentRing.scale.setScalar(earthMesh.scale.x * 1.45);
    currentRing.material.opacity = 0.9 * Math.max(state.orbit, state.atlas);
    currentRing.visible = currentRing.material.opacity > 0.01;
    atmosphere.position.copy(earthMesh.position);
    atmosphere.scale.setScalar(state.earthScale * (1 - 0.12 * state.atlas) * 1.025);
    const questionOrbit = orbitQuestionParentPosition
      ? new THREE.Vector3(orbitQuestionParentPosition.x, orbitQuestionParentPosition.y, orbitQuestionParentPosition.z || 0)
      : null;
    if (questionOrbit) {
      orbitQuestionParent.position.set(0, 0, 0).lerp(questionOrbit, state.lift);
      orbitQuestionParent.scale.setScalar(0.34);
      orbitQuestionParent.visible = state.orbit > 0.04;
      orbitQuestionParent.material.opacity = state.orbit;
      orbitQuestionHalo.position.copy(orbitQuestionParent.position);
      orbitQuestionHalo.scale.setScalar(0.34);
      orbitQuestionHalo.material.opacity = 0.9 * state.orbit;
      orbitQuestionHalo.visible = orbitQuestionParent.visible;
    }
    applySurfaceOrientation(1 - state.lift, timestamp);
    atlasGroup.updateMatrixWorld(true);
    const frame = atlasFrameBounds();
    const atlasCenter = new THREE.Vector3((frame.left + frame.right) / 2, (frame.bottom + frame.top) / 2, 0);
    const cameraFocus = travelState && !travelState.cut ? earthMesh.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3().lerp(atlasCenter, state.atlas);
    cameraFocus.x += panOffset.x; cameraFocus.y += panOffset.y;
    liveCameraDistance = state.cameraDistance + (fittedAtlasDistance() - state.cameraDistance) * state.atlas;
    container.dataset.atlasCameraDistance = String(liveCameraDistance);
    // Desktop canvas insets already follow the panels. On narrow screens the
    // bottom sheet overlaps the full-width canvas, so frame the remaining area.
    const canvasBounds = renderer.domElement.getBoundingClientRect();
    const sheet = document.getElementById('chronicle');
    const sheetBounds = sheet?.getBoundingClientRect();
    const bottomOverlap = state.lift > 0 && canvasBounds.width <= 700 && sheetBounds && sheetBounds.width > canvasBounds.width * 0.7
      ? Math.max(0, canvasBounds.bottom - Math.max(canvasBounds.top, sheetBounds.top)) : 0;
    const toolbarBounds = document.getElementById('atlas-toolbar')?.getBoundingClientRect();
    const otherQuestions = document.getElementById('atlas-other-questions');
    const otherBounds = otherQuestions && !otherQuestions.hidden ? otherQuestions.getBoundingClientRect() : null;
    const topOverlap = state.lift > 0 && canvasBounds.width <= 700
      ? Math.max(0, (otherBounds?.bottom || toolbarBounds?.bottom || canvasBounds.top) - canvasBounds.top + 8) : 0;
    if (canvasBounds.width > 0 && canvasBounds.height > 0 && bottomOverlap + topOverlap < canvasBounds.height * 0.8 && bottomOverlap + topOverlap > 0) {
      const availableHeight = canvasBounds.height - bottomOverlap - topOverlap;
      liveCameraDistance *= canvasBounds.height / availableHeight;
      camera.setViewOffset(canvasBounds.width, canvasBounds.height, 0, (topOverlap - bottomOverlap) / 2, canvasBounds.width, canvasBounds.height);
    } else camera.clearViewOffset();
    // Deep trees and phone safe-area fitting can exceed the Surface far plane.
    const requiredFar = Math.max(120, liveCameraDistance * 3 + 20);
    if (Math.abs(camera.far - requiredFar) > 1) { camera.far = requiredFar; camera.updateProjectionMatrix(); }
    camera.position.set(cameraFocus.x, cameraFocus.y, cameraFocus.z + liveCameraDistance);
    camera.lookAt(cameraFocus);
    key.position.copy(camera.position);
    key.target.position.copy(cameraFocus);

    const folded = new Set(atlasTimeline?.foldedIds || []);
    const realSphereIds = new Set(atlasTimeline?.realSphereIds || []);
    const travellingIds = new Set(travelState?.pathIds || []);
    const atlasSettled = state.atlas >= 0.98;
    const clusteredIds = new Set(orbitClusteredIdsForPresentation(clusterPlan, { atlas: state.atlas, zoom, orbitNeighborhoodIds }));
    const visibleEntries = entries.filter(entry => {
      if (travellingIds.has(entry.id) || (atlasSettled && folded.has(entry.id)) || clusteredIds.has(entry.id)) return false;
      if (state.surface > 0.15 && zoom < 0.57) return entry.surfaceVisible;
      if (state.orbit > 0.15 && zoom < 0.84) return entry.orbitVisible;
      return true;
    });
    visibleKeyboardWorldIds.clear();
    for (const entry of visibleEntries) visibleKeyboardWorldIds.add(entry.id);
    const sphereLimit = Math.max(0, MAX_SPHERE_INSTANCES - 1); // Reserve one of 24 world spheres for the single current Earth mesh.
    const instanceEntries = visibleEntries.filter(entry => entry.id !== currentId
      && !isGenerationPlaceholderWorld(entry.world)
      && (state.atlas < 0.45 || realSphereIds.has(entry.id)))
      .slice(0, sphereLimit);
    instanceIds.length = 0;
    const instanceColor = new THREE.Color();
    const pinGroups = new Map();
    const markerScale = pinScaleAtPresentation(state.lift, state.atlas);
    const markerRadius = pinAnchorRadiusAtPresentation(surfaceEarthRadius(state), state.lift, state.atlas);
    const liftMorphProgress = clamp(state.lift / 0.03, 0, 1);
    const flatSurfacePinMode = liftMorphProgress < 1;
    const flatEntries = flatSurfacePinMode ? instanceEntries.filter(entry => entry.id !== arrivalFromId) : [];
    const sphereEntries = flatSurfacePinMode ? (state.lift > 0 ? instanceEntries : []) : instanceEntries;
    for (const mesh of texturePinMeshes.values()) mesh.count = 0;
    surfacePinInstances.count = flatEntries.length;
    surfacePinInstances.material.opacity = reducedMotionOpacity * (1 - liftMorphProgress);
    flatEntries.forEach((entry, index) => {
      const surfaceRadius = surfaceEarthRadius(state) + 0.00025;
      dummy.position.copy(worldPosition(entry, state, timestamp, surfaceRadius));
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfacePoint(entry).normalize());
      dummy.scale.setScalar(1);
      dummy.updateMatrix(); surfacePinInstances.setMatrixAt(index, dummy.matrix);
      surfacePinInstances.setColorAt(index, instanceColor.copy(worldColor(entry, currentId)));
      instanceIds.push(entry.id);
    });
    surfacePinInstances.instanceMatrix.needsUpdate = true;
    if (surfacePinInstances.instanceColor) surfacePinInstances.instanceColor.needsUpdate = true;
    for (const entry of sphereEntries) {
      const texture = miniTextureForWorld(entry.world);
      if (!pinGroups.has(texture)) pinGroups.set(texture, []);
      pinGroups.get(texture).push(entry);
    }
    for (const [texture, groupEntries] of pinGroups) {
      const mesh = pinMeshForTexture(texture);
      mesh.count = groupEntries.length;
      groupEntries.forEach((entry, index) => {
        instanceIds.push(entry.id);
        const scale = markerScale;
        const point = worldPosition(entry, state, timestamp, markerRadius);
        dummy.position.copy(point);
        const facing = surfaceFacingOrientation(projectedGlobe(entry));
        surfaceYawQuaternion.setFromAxisAngle(surfaceYawAxis, facing.yaw);
        surfacePitchQuaternion.setFromAxisAngle(surfacePitchAxis, facing.pitch);
        dummy.quaternion.copy(surfacePitchQuaternion).multiply(surfaceYawQuaternion);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
        mesh.setColorAt(index, instanceColor.copy(worldColor(entry, currentId)).lerp(LIT_TINT, state.atlas * (entry.explored ? 0.58 : 0.06)));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.material.transparent = true;
      mesh.material.opacity = reducedMotionOpacity * (flatSurfacePinMode ? (groupEntries.every(entry => entry.id === arrivalFromId) ? 1 : liftMorphProgress) : 1);
    }
    for (const [texture, mesh] of [...texturePinMeshes]) if (!flatSurfacePinMode && texture !== miniEarthTexture && !pinGroups.has(texture)) {
      atlasGroup.remove(mesh); mesh.material.dispose(); texturePinMeshes.delete(texture);
    }

    const ancestors = ghostTrail ? ancestorIds(currentId).map(id => entries.find(entry => entry.id === id)).filter(Boolean).slice(0, MAX_SPHERE_INSTANCES) : [];
    ghostPins.visible = ghostTrail && ancestors.length > 0;
    ghostPins.count = ancestors.length;
    ancestors.forEach((entry, index) => {
      const ghostScale = pinScaleAtPresentation(state.lift, state.atlas);
      const ghostRadius = surfacePinAnchorRadius(surfaceEarthRadius(state), ghostScale);
      dummy.position.copy(geographicWorldPosition(entry, state, timestamp, ghostRadius));
      dummy.scale.setScalar(ghostScale);
      dummy.updateMatrix(); ghostPins.setMatrixAt(index, dummy.matrix);
    });
    ghostPins.instanceMatrix.needsUpdate = true;

    const lodEntries = visibleEntries.filter(entry => entry.id !== currentId && !isGenerationPlaceholderWorld(entry.world) && !instanceIds.includes(entry.id)
      && (entry.id !== arrivalFromId || state.lift > 0));
    lodIds.length = 0;
    lodIdSet.clear();
    const pointPositions = new Float32Array(lodEntries.length * 3);
    const pointColors = new Float32Array(lodEntries.length * 3);
    lodEntries.forEach((entry, index) => {
      lodIds[index] = entry.id;
      lodIdSet.add(entry.id);
      worldPosition(entry, state, timestamp, surfaceEarthRadius(state) + 0.003).toArray(pointPositions, index * 3);
      worldColor(entry, currentId).toArray(pointColors, index * 3);
    });
    const pointPositionAttribute = lodPoints.geometry.attributes.position;
    if (!pointPositionAttribute || pointPositionAttribute.array.length !== pointPositions.length) {
      lodPoints.geometry.dispose(); lodPoints.geometry = new THREE.BufferGeometry();
      lodPoints.geometry.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));
      lodPoints.geometry.setAttribute('color', new THREE.BufferAttribute(pointColors, 3));
    } else {
      pointPositionAttribute.array.set(pointPositions); pointPositionAttribute.needsUpdate = true;
      const colorAttribute = lodPoints.geometry.attributes.color;
      colorAttribute.array.set(pointColors); colorAttribute.needsUpdate = true;
    }

    atlasGroup.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    for (const entry of entries) {
      const disc = registry.get(entry.id)?.disc;
      if (disc) {
        disc.position.copy(worldPosition(entry, state, timestamp, markerRadius));
        disc.material.opacity = entry.orbitVisible ? Math.max(state.lift * (1 - state.atlas) * 0.85, state.atlas * (entry.atlasRealSphere ? 0.9 : 0)) : 0;
        disc.scale.setScalar(0.44 * Math.max(state.lift * (1 - state.atlas), state.atlas * (entry.atlasRealSphere ? 1 : 0)));
      }
      const outline = registry.get(entry.id)?.unenteredOutline;
      if (outline) {
        outline.position.copy(worldPosition(entry, state, timestamp, surfaceEarthRadius(state) + 0.003));
        const atlasPossibility = state.atlas > 0.02 && entry.id !== currentId && !entry.folded && !clusteredIds.has(entry.id) ? state.atlas : 0;
        const visibleOutline = Math.max(
          !entry.explored && entry.surfaceVisible ? state.surface : 0,
          !entry.explored && entry.orbitVisible ? state.orbit : 0,
          atlasPossibility,
        );
        outline.material.opacity = visibleOutline * 0.92;
        const distance = outline.position.distanceTo(camera.position);
        // Keep distant Atlas nodes visually distinct without changing their 44px hit targets.
        const diameter = 30 - 16 * state.atlas;
        const size = 2 * worldRadiusForScreenPixels(distance, camera.fov, Math.max(1, renderer.domElement.clientHeight), diameter);
        outline.scale.set(size, size, 1);
      }
    }
    for (const sprite of clusterSprites.values()) {
      const cluster = sprite.userData.cluster;
      const memberEntries = cluster.memberIds.map(id => entries.find(entry => entry.id === id)).filter(Boolean);
      const anchor = entries.find(entry => entry.id === cluster.anchorId);
      const lat = Number(cluster.centroid?.lat ?? anchor?.world.lat ?? 0);
      const lon = Number(cluster.centroid?.lon ?? anchor?.world.lon ?? 0);
      const phi = (90 - lat) * Math.PI / 180, theta = (lon + 180) * Math.PI / 180;
      const surfacePoint = new THREE.Vector3(-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)).multiplyScalar(1.17);
      const atlasPoint = memberEntries.length
        ? memberEntries.reduce((point, entry) => point.add(atlasPosition(entry, timestamp)), new THREE.Vector3()).multiplyScalar(1 / memberEntries.length)
        : anchor ? atlasPosition(anchor, timestamp) : new THREE.Vector3();
      const orbitPoint = memberEntries.length
        ? memberEntries.reduce((point, entry) => point.add(new THREE.Vector3(entry.orbit.x, entry.orbit.y, entry.orbit.z)), new THREE.Vector3()).multiplyScalar(1 / memberEntries.length)
        : anchor ? new THREE.Vector3(anchor.orbit.x, anchor.orbit.y, anchor.orbit.z) : atlasPoint;
      sprite.position.copy(surfacePoint.lerp(orbitPoint, state.lift).lerp(atlasPoint, state.atlas));
      const visibleAlpha = clusterOpacityAtPresentation(cluster, cluster.level, state, currentId);
      sprite.material.opacity = visibleAlpha;
      const worldCenter = sprite.getWorldPosition(new THREE.Vector3());
      const viewDepth = -worldCenter.applyMatrix4(camera.matrixWorldInverse).z;
      const diameter = cluster.level === 'surface' ? 48 : 58;
      const size = 2 * worldRadiusForScreenPixels(viewDepth, camera.fov, Math.max(1, renderer.domElement.clientHeight), diameter);
      sprite.scale.set(size, size, 1);
    }
    const labelBounds = renderer.domElement.getBoundingClientRect();
    const mobileLabels = labelBounds.width <= 480;
    const labelDocument = container.ownerDocument || document;
    const reservedRects = [];
    const topChromeBottoms = [];
    for (const element of labelDocument.querySelectorAll?.('.site-header .brand, .site-header .header-actions, .panel-head, #chronicle, .atlas-world-details, #atlas-toolbar, #atlas-other-questions, #atlas-world-card, #atlas-compact-controls, #atlas-reopen-controls, .geography-panel') || []) {
      if (element.hidden) continue;
      const styles = labelDocument.defaultView?.getComputedStyle?.(element);
      if (styles?.display === 'none' || styles?.visibility === 'hidden' || Number(styles?.opacity) <= 0.05) continue;
      const rect = element.getBoundingClientRect();
      const left = Math.max(labelBounds.left, rect.left), right = Math.min(labelBounds.right, rect.right);
      const top = Math.max(labelBounds.top, rect.top), bottom = Math.min(labelBounds.bottom, rect.bottom);
      if (right > left && bottom > top) {
        reservedRects.push({ x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top });
        if (element.matches?.('.site-header .brand, .site-header .header-actions, .panel-head, #atlas-toolbar, #atlas-other-questions')) topChromeBottoms.push(bottom);
      }
    }
    const safeBounds = {
      left: labelBounds.left + (mobileLabels ? 10 : 4),
      right: labelBounds.right - (mobileLabels ? 10 : 4),
      top: labelBounds.top + (mobileLabels ? 8 : 4),
      bottom: labelBounds.bottom - (bottomOverlap || 0) - (mobileLabels ? 10 : 4),
    };
    const lineageTop = topChromeBottoms.length
      ? Math.min(safeBounds.bottom - 24, Math.max(safeBounds.top, ...topChromeBottoms) + 8)
      : safeBounds.top;
    const lineageBounds = { ...safeBounds, top: lineageTop };
    const mobileUndatedShelfY = Math.min(safeBounds.bottom - 12, Math.max(safeBounds.top + 22,
      (topChromeBottoms.length ? Math.max(...topChromeBottoms) : safeBounds.top) + 20));
    const projectPoint = point => {
      const projected = point.clone().project(camera);
      return {
        x: labelBounds.left + (projected.x + 1) * 0.5 * labelBounds.width,
        y: labelBounds.top + (1 - projected.y) * 0.5 * labelBounds.height,
        visible: projected.z >= -1 && projected.z <= 1 && projected.x >= -1.2 && projected.x <= 1.2 && projected.y >= -1.2 && projected.y <= 1.2,
      };
    };
    const containerBounds = container.getBoundingClientRect();
    for (const sprite of clusterSprites.values()) {
      const cluster = sprite.userData.cluster;
      if (!needsPagedClusterPicker(cluster)) continue;
      const worldPoint = sprite.getWorldPosition(new THREE.Vector3());
      const point = projectPoint(worldPoint);
      largeClusterPicker?.setPosition(cluster.id, {
        x: point.x - containerBounds.left,
        y: point.y - containerBounds.top,
        visible: sprite.material.opacity > 0.04 && point.visible && targetVisiblePastEarth(worldPoint, state),
      });
    }
    const labelEarthCenter = earthMesh.getWorldPosition(new THREE.Vector3());
    const towardCameraForLabels = camera.getWorldPosition(new THREE.Vector3()).sub(labelEarthCenter);
    const horizonThreshold = surfaceEarthRadius(state) / Math.max(surfaceEarthRadius(state), towardCameraForLabels.length()) + 0.005;
    towardCameraForLabels.normalize();
    const worldCandidates = createWorldLabelCandidates(entries, {
      currentId, focusedId: hoveredId,
      project: entry => {
        if (state.surface > 0.7 && state.lift < 0.3) {
          const normal = surfacePoint(entry).transformDirection(atlasGroup.matrixWorld);
          if (!isSurfaceNormalVisible(normal, towardCameraForLabels, horizonThreshold)) return { visible: false };
        }
        const point = projectPoint(worldPosition(entry, state, timestamp, markerRadius).applyMatrix4(atlasGroup.matrixWorld));
        if (entry.lineage && entry.id !== currentId) point.visible = true;
        return point;
      },
      measure: text => ({ width: Math.min(mobileLabels ? 220 : 320, labelBounds.width * (mobileLabels ? 0.64 : 0.7), safeBounds.right - safeBounds.left, Math.max(52, text.length * 7.5 + 8)), height: 18 }),
      yearFirst: mobileLabels,
      edgeMarkerIncluded: mobileLabels,
      bounds: safeBounds,
      lineageBounds,
      reservedRects,
      include: entry => state.orbit > 0.3 && state.atlas < 0.6 && entry.orbitVisible && String(entry.parentId) === String(currentId),
    });
    const undatedWorldIds = new Set(entries.filter(entry => {
      const year = Number(entry.world?.year);
      return !Number.isSafeInteger(year) || year === 0;
    }).map(entry => entry.id));
    const undatedLineageWorldId = entries.filter(entry => undatedWorldIds.has(entry.id) && entry.lineage && entry.id !== currentId)
      .sort((a, b) => b.depth - a.depth || a.id.localeCompare(b.id))[0]?.id;
    const undatedLineageEntry = entries.find(entry => entry.id === undatedLineageWorldId);
    const undatedLineageTarget = undatedLineageEntry
      ? projectPoint(worldPosition(undatedLineageEntry, state, timestamp, markerRadius).applyMatrix4(atlasGroup.matrixWorld))
      : null;
    const candidates = worldCandidates.map(candidate => {
      if (state.atlas <= 0.5) return candidate;
      if (candidate.id === currentId) return { ...candidate, priority:Math.max(candidate.priority || 0, 124) };
      if (mobileLabels && candidate.id === undatedLineageWorldId) {
        const width = Math.min(220, safeBounds.right - safeBounds.left, candidate.width || 0);
        return { ...candidate, text:candidate.fullText || candidate.text,
          directionTarget:undatedLineageTarget,
          x:safeBounds.right - width / 2 - 2, y:mobileUndatedShelfY, width, priority:122 };
      }
      if (undatedWorldIds.has(candidate.id)) return { ...candidate, priority:Math.max(candidate.priority || 0, 116) };
      return candidate;
    });
    if (mobileLabels && state.atlas > 0.5 && undatedLineageWorldId
      && !candidates.some(candidate => candidate.id === undatedLineageWorldId)) {
      const entry = undatedLineageEntry;
      if (entry) {
        const fullText = worldLabelText(entry.world, { yearFirst:true });
        const width = Math.min(220, safeBounds.right - safeBounds.left, Math.max(52, fullText.length * 7.5 + 8));
        candidates.push({ id:undatedLineageWorldId, text:fullText, fullText,
          directionTarget:undatedLineageTarget,
          x:safeBounds.right - width / 2 - 2, y:mobileUndatedShelfY,
          width, height:18, priority:122, kind:'world' });
      }
    }
    const visibleWorldIds = new Set([...instanceIds, ...lodIds, ...(currentId ? [currentId] : [])]);
    const nodeRects = [];
    const worldNodeRects = new Map();
    for (const id of visibleWorldIds) {
      const entry = entries.find(item => item.id === id);
      if (!entry) continue;
      if (id === currentId) {
        const center = earthMesh.getWorldPosition(new THREE.Vector3());
        const point = projectPoint(center);
        const radius = currentRing.visible ? Math.max(earthMesh.scale.x, currentRing.scale.x * 1.055) : earthMesh.scale.x;
        const diameter = Math.max(44, projectedSphereDiameterPixels(
          center.distanceTo(camera.getWorldPosition(new THREE.Vector3())), camera.fov, labelBounds.height, radius,
        ));
        if (point.visible) nodeRects.push({ x: point.x, y: point.y, width: diameter, height: diameter });
        const pin = projectPoint(worldPosition(entry, state, timestamp, markerRadius).applyMatrix4(atlasGroup.matrixWorld));
        if (pin.visible) nodeRects.push({ x: pin.x, y: pin.y, width: 44, height: 44 });
        continue;
      }
      const record = registry.get(id);
      const worldPoint = worldPosition(entry, state, timestamp, markerRadius).applyMatrix4(atlasGroup.matrixWorld);
      const point = projectPoint(record?.disc?.getWorldPosition(new THREE.Vector3()) || worldPoint);
      const renderedRadius = Math.max(
        record?.disc?.scale?.x ? record.disc.scale.x / 2 : 0,
        instanceIds.includes(id) ? ATLAS_PIN_GEOMETRY_RADIUS * markerScale : 0,
      );
      const diameter = Math.max(44, projectedSphereDiameterPixels(
        worldPoint.distanceTo(camera.getWorldPosition(new THREE.Vector3())), camera.fov, labelBounds.height, renderedRadius,
      ));
      if (point.visible) {
        const rect = { x:point.x, y:point.y, width:diameter, height:diameter };
        nodeRects.push(rect);
        worldNodeRects.set(id, rect);
      }
    }
    for (const sprite of clusterSprites.values()) {
      if (sprite.material.opacity <= 0.04) continue;
      const point = projectPoint(sprite.getWorldPosition(new THREE.Vector3()));
      const diameter = sprite.userData.cluster?.level === 'orbit' ? 58 : 48;
      if (point.visible) nodeRects.push({ x: point.x, y: point.y, width: diameter, height: diameter });
    }
    if (p2Renderer.presentEarth.visible) {
      const point = projectPoint(p2Renderer.presentEarth.getWorldPosition(new THREE.Vector3()));
      const center = p2Renderer.presentEarth.getWorldPosition(new THREE.Vector3());
      const diameter = Math.max(44, projectedSphereDiameterPixels(center.distanceTo(camera.getWorldPosition(new THREE.Vector3())), camera.fov, labelBounds.height, p2Renderer.presentEarth.scale.x));
      if (point.visible) nodeRects.push({ x: point.x, y: point.y, width: diameter, height: diameter });
    }
    if (orbitQuestionParent.visible) {
      const point = projectPoint(orbitQuestionParent.getWorldPosition(new THREE.Vector3()));
      const center = orbitQuestionParent.getWorldPosition(new THREE.Vector3());
      const diameter = Math.max(44, projectedSphereDiameterPixels(center.distanceTo(camera.getWorldPosition(new THREE.Vector3())), camera.fov, labelBounds.height, orbitQuestionParent.scale.x));
      if (point.visible) nodeRects.push({ x: point.x, y: point.y, width: diameter, height: diameter });
    }
    if (state.atlas > 0.04) {
      for (const { chip, sprite } of p2Renderer.getQuestionChipTargets()) {
        if (!chip || !sprite.visible) continue;
        const point = projectPoint(sprite.getWorldPosition(new THREE.Vector3()));
        const fullText = questions.find(question => String(question.id) === String(chip.questionId))?.question || chip.label;
        const text = shortQuestionTitle(fullText);
        if (point.visible) candidates.push({ id: `chip:${chip.questionId}`, text, fullText, ...point, width: Math.min(mobileLabels ? 220 : 240, safeBounds.right - safeBounds.left, Math.max(100, text.length * 7.5 + 8)), height: 20, priority: 80, kind: 'chip' });
      }
      for (const tick of atlasTimeline?.visibleTicks || []) {
        if (tick.year === 2026) continue;
        const point = projectPoint(p2Renderer.group.localToWorld(new THREE.Vector3(tick.x, -0.5, 0)));
        if (point.visible) candidates.push({ id: `tick:${tick.year}`, text: tick.label, ...point, width: Math.max(46, String(tick.label).length * 7.5 + 8), height: 18, priority: 30, kind: 'tick' });
      }
      const verticalTitle = axisMode === 'history-distance' ? 'HISTORY DEPTH' : axisMode === 'branch-order' ? 'BRANCH ORDER' : 'THEME';
      const axisGutter = mobileLabels ? 18 : Math.min(138, Math.max(88, labelBounds.height * 0.15));
      candidates.push({ id: 'axis:vertical', text: verticalTitle, x: safeBounds.left + 78, y: safeBounds.top + axisGutter + 10, width: 116, height: 18, priority: 110, kind: 'axis' });
      const timeAxisPoint = projectPoint(p2Renderer.group.localToWorld(new THREE.Vector3(atlasTimeline?.trunk?.right || 0, (atlasTimeline?.trunk?.y || 0) - 0.5, 0)));
      candidates.push({ id: 'axis:time', text: 'YEAR', x: timeAxisPoint.x, y: timeAxisPoint.y, width: 46, height: 18, priority: 110, kind: 'axis' });
      if (atlasTimeline?.undatedLane) {
        const undatedPoint = mobileLabels ? {
          x:safeBounds.left + 46,
          y:mobileUndatedShelfY,
          visible:true,
        } : projectPoint(p2Renderer.group.localToWorld(new THREE.Vector3(
          atlasTimeline.undatedLane.x, (atlasTimeline.trunk?.y || 0) + 0.34, 0.05,
        )));
        if (undatedPoint.visible) candidates.push({ id:'axis:undated',
          text:mobileLabels ? 'UNDATED' : atlasTimeline.undatedLane.label,
          fullText:atlasTimeline.undatedLane.label, ...undatedPoint,
          width:Math.min(mobileLabels ? 88 : 220, safeBounds.right - safeBounds.left), height:18, priority:126, kind:'axis' });
      }
    }
    if (state.orbit > 0.04 && orbitQuestionParent.visible
      && String(orbitQuestionParent.userData.questionId) === String(hoveredQuestionId)) {
      const point = projectPoint(orbitQuestionParent.getWorldPosition(new THREE.Vector3()));
      const question = orbitQuestionParentQuestion;
      const text = question?.question || question?.title || question?.prompt || 'Saved question';
      if (point.visible) candidates.push({ id: `question:${question?.id}`, text, ...point, width: Math.min(mobileLabels ? 220 : 240, safeBounds.right - safeBounds.left, Math.max(80, String(text).length * 6.4)), height: 20, priority: 95, kind: 'world' });
    }
    if (p2Renderer.presentEarth.visible) {
      const point = projectPoint(p2Renderer.presentEarth.getWorldPosition(new THREE.Vector3()));
      if (point.visible) candidates.push({ id: 'present-earth', text: 'Present-day Earth · 2026', ...point, width: Math.min(200, safeBounds.right - safeBounds.left), height: 18, priority: 95, kind: 'world' });
    }
    const orbitChildEntries = state.orbit > 0.3 && state.atlas < 0.6
      ? entries.filter(entry => entry.orbitVisible && String(entry.parentId) === String(currentId))
      : [];
    const orbitChildIds = new Set(orbitChildEntries.map(entry => entry.id));
    const orbitLabelCandidates = orbitChildEntries.map(entry => {
      const fullText = worldLabelText(entry.world, { yearFirst:mobileLabels });
      const node = worldNodeRects.get(entry.id);
      return { id:entry.id, world:entry.world, text:fullText, fullText, priority:85, kind:'world',
        ...(node ? { x:node.x, y:node.y, visible:true } : { visible:false }),
        width:Math.min(mobileLabels ? 220 : 260, safeBounds.right - safeBounds.left, Math.max(124, fullText.length * 7.1)),
        height:44 };
    });
    const generalCandidates = candidates.filter(candidate => !orbitChildIds.has(candidate.id));
    const placements = placeScreenLabels(generalCandidates, safeBounds, nodeRects, reservedRects);
    const orbitLaneLayout = layoutOrbitChildLabels(orbitLabelCandidates, safeBounds, nodeRects,
      [...reservedRects, ...placements.filter(placement => Number.isFinite(placement.x) && Number.isFinite(placement.y))], {
      rowHeight:44, rowGap:4, columnGap:12, controlGap:6, minLaneWidth:96, maxLaneWidth:320,
      maxLaneHeight:mobileLabels ? 220 : 240,
    });
    if (mobileLabels && undatedLineageTarget) {
      for (const placement of placements) {
        if (placement.id !== undatedLineageWorldId) continue;
        const arrow = edgeMarker(undatedLineageTarget, {
          left:placement.x, right:placement.x, top:placement.y, bottom:placement.y,
        }, placement.fullText || placement.text);
        if (arrow) placement.text = arrow;
        break;
      }
    }
    const activeLabelIds = new Set();
    const candidateLabelIds = new Set(candidates.map(candidate => candidate.id));
    for (const placement of placements) {
      const worldRecord = placement.kind === 'world' ? registry.get(placement.id) : null;
      let element = worldRecord?.label || auxiliaryLabels.get(placement.id);
      if (!element) {
        element = createWorldLabel({ title: placement.text });
        element.className = `atlas-screen-label atlas-${placement.kind || 'auxiliary'}-label`;
        auxiliaryLabels.set(placement.id, element);
        labelOverlay.append(element);
      }
      element.textContent = placement.text;
      element.setAttribute('aria-label', placement.fullText || placement.text);
      element.title = placement.fullText || placement.text;
      element.style.left = `${placement.x - labelBounds.left}px`;
      element.style.top = `${placement.y - labelBounds.top}px`;
      element.style.width = `${placement.width}px`;
      element.style.textAlign = 'center';
      element.style.display = 'block';
      element.style.color = '#ece4d4';
      element.style.fontSize = placement.kind === 'axis' ? '12px' : '12.5px';
      activeLabelIds.add(placement.id);
    }
    for (const entry of entries) {
      const element = registry.get(entry.id)?.label;
      if (element) element.style.display = activeLabelIds.has(entry.id) ? 'block' : 'none';
    }
    for (const [id, element] of auxiliaryLabels) {
      if (!candidateLabelIds.has(id)) { element.remove(); auxiliaryLabels.delete(id); }
      else if (!activeLabelIds.has(id)) element.style.display = 'none';
    }
    const activeOrbitLaneIds = new Set();
    const activeOrbitChildIds = new Set();
    const focusedOrbitChildId = [...orbitChildLabelButtons].find(([, button]) => button === document.activeElement)?.[0] || null;
    const orbitLaneScrollTops = new Map([...orbitLabelLanes].map(([id, lane]) => [id, lane.scrollTop]));
    const blockedOrbitLayout = orbitLaneLayout.blocked && orbitLaneLayout.labels.length > 0;
    let orbitFallbackMountMode = 'none';
    const explorationTree = labelDocument.querySelector?.('#exploration-tree');
    const treeStyles = explorationTree ? labelDocument.defaultView?.getComputedStyle?.(explorationTree) : null;
    const treeRect = explorationTree?.getBoundingClientRect?.();
    const treeVisible = Boolean(explorationTree && treeRect?.width > 0 && treeRect?.height > 0
      && treeStyles?.display !== 'none' && treeStyles?.visibility !== 'hidden' && Number(treeStyles?.opacity ?? 1) > 0.05);
    const invitation = labelDocument.querySelector?.('#invitation');
    const invitationStyles = invitation ? labelDocument.defaultView?.getComputedStyle?.(invitation) : null;
    const invitationRect = invitation?.getBoundingClientRect?.();
    const invitationVisible = Boolean(invitation && invitationRect?.width > 0 && invitationRect?.height > 0
      && invitationStyles?.display !== 'none' && invitationStyles?.visibility !== 'hidden' && Number(invitationStyles?.opacity ?? 1) > 0.05);
    if (blockedOrbitLayout) {
      const fallbackBounds = {
        left:0, top:0,
        right:labelDocument.documentElement?.clientWidth || labelDocument.defaultView?.innerWidth || 0,
        bottom:labelDocument.documentElement?.clientHeight || labelDocument.defaultView?.innerHeight || 0,
      };
      const fallbackControls = visibleViewportObstacleRects(labelDocument,
        '.site-header .brand, .site-header .header-actions, .panel-head, #atlas-toolbar, #atlas-other-questions, #atlas-world-card, #atlas-compact-controls, #atlas-reopen-controls, .geography-panel, .hero-panel, .exploration-rail, #invitation, #exploration-tree');
      const fallbackLabels = viewportObstacleRectsFromCenters([
        ...orbitLaneLayout.local,
        ...placements.filter(placement => Number.isFinite(placement.x) && Number.isFinite(placement.y)),
      ]);
      const fallbackNodes = viewportObstacleRectsFromCenters(nodeRects);
      const safeObstacles = [...fallbackControls, ...fallbackLabels, ...fallbackNodes];
      // Try a control-free on-screen panel even while the Story tree is open.
      // This keeps direct child labels visible in focused Atlas instead of
      // requiring a separate tree-reopen action.
      // On a dense globe, a dock may cover a world sphere, since its child
      // button remains actionable there. It must still clear every control
      // and every already visible label.
      const fallbackRect = placeOrbitFallbackPanel(fallbackBounds, safeObstacles)
        || placeOrbitFallbackDock(fallbackBounds, safeObstacles, { maxWidth:mobileLabels ? 220 : 320 })
        || placeOrbitFallbackPanel(fallbackBounds, [...fallbackControls, ...fallbackLabels])
        || placeOrbitFallbackDock(fallbackBounds, [...fallbackControls, ...fallbackLabels], { maxWidth:mobileLabels ? 220 : 320 });
      const fallbackMount = resolveOrbitFallbackMount({
        treeVisible, hasTree:Boolean(explorationTree), invitationVisible,
        hasEmbeddedHost:Boolean(container.parentElement), portalRect:fallbackRect,
      });
      orbitFallbackMountMode = fallbackMount.mode;
      const fallbackHost = fallbackMount.mode === 'tree' || fallbackMount.mode === 'tree-reopen' ? explorationTree
        : fallbackMount.mode === 'portal' ? labelDocument.body
          : fallbackMount.mode === 'invitation' ? invitation
            : fallbackMount.mode === 'embedded-flow' ? container.parentElement : null;
      if (!orbitFallbackSection) {
        orbitFallbackSection = labelDocument.createElement('section');
        orbitFallbackSection.className = 'atlas-orbit-label-fallback';
        orbitFallbackSection.setAttribute('role', 'region');
        orbitFallbackSection.setAttribute('aria-label', 'Orbit child labels');
        const heading = labelDocument.createElement('h3');
        Object.assign(heading.style, { margin:'0 0 4px', fontSize:'13px', lineHeight:'18px' });
        orbitFallbackSection.append(heading);
      }
      orbitFallbackContent = orbitFallbackSection.querySelector('.atlas-orbit-label-fallback-content');
      if (!orbitFallbackContent) {
        orbitFallbackContent = labelDocument.createElement('div');
        orbitFallbackContent.className = 'atlas-orbit-label-fallback-content';
        Object.assign(orbitFallbackContent.style, { display:'grid', gap:'4px' });
        orbitFallbackSection.append(orbitFallbackContent);
      }
      const heading = orbitFallbackSection.querySelector('h3');
      const fallbackWorldTitle = current?.world?.title || 'Current world';
      if (heading) heading.textContent = `${fallbackWorldTitle} · direct children`;
      orbitFallbackSection.setAttribute('aria-label', `${fallbackWorldTitle} direct children in Orbit`);
      if (heading) heading.style.display = fallbackRect?.compact ? 'none' : 'block';
      Object.assign(orbitFallbackSection.style, {
        display:'block', boxSizing:'border-box', maxHeight:fallbackMount.mode === 'portal' ? `${fallbackRect?.height || 0}px` : '38dvh',
        overflowY:'auto', overscrollBehavior:'contain', padding:'8px', margin:fallbackMount.mode === 'tree' ? '8px 0' : '0',
        border:'1px solid rgba(179, 207, 213, 0.75)', borderRadius:'8px',
        background:'rgba(4, 13, 20, 0.97)', color:'#f3ead9', zIndex:'1000',
      });
      if (fallbackMount.mode === 'portal') {
        Object.assign(orbitFallbackSection.style, {
          position:'fixed', left:`${fallbackRect.left}px`, top:`${fallbackRect.top}px`,
          right:'auto', bottom:'auto', width:`${fallbackRect.width}px`, height:`${fallbackRect.height}px`,
        });
      } else if (fallbackMount.mode === 'tree' || fallbackMount.mode === 'invitation' || fallbackMount.mode === 'embedded-flow') {
        Object.assign(orbitFallbackSection.style, { position:'relative', width:'100%', height:'auto', left:'auto', top:'auto', right:'auto', bottom:'auto' });
      }
      if (fallbackHost) {
        if (orbitFallbackSection.parentElement !== fallbackHost) fallbackHost.append(orbitFallbackSection);
        orbitFallbackPlacementWarned = false;
        if (fallbackMount.hint) {
          const treeButton = labelDocument.querySelector?.('#atlas-show-tree');
          if (treeButton && !orbitFallbackTreeHintOriginal) {
            orbitFallbackTreeHintOriginal = {
              text:treeButton.textContent,
              title:treeButton.getAttribute('title'),
              ariaLabel:treeButton.getAttribute('aria-label'),
            };
          }
          if (treeButton) {
            treeButton.textContent = 'Story tree · Orbit labels';
            treeButton.title = 'Open the story tree to reach the Orbit child labels';
            treeButton.setAttribute('aria-label', 'Open story tree to reach Orbit child labels');
          }
        } else if (orbitFallbackTreeHintOriginal) {
          const treeButton = labelDocument.querySelector?.('#atlas-show-tree');
          if (treeButton) {
            treeButton.textContent = orbitFallbackTreeHintOriginal.text;
            if (orbitFallbackTreeHintOriginal.title == null) treeButton.removeAttribute('title');
            else treeButton.setAttribute('title', orbitFallbackTreeHintOriginal.title);
            if (orbitFallbackTreeHintOriginal.ariaLabel == null) treeButton.removeAttribute('aria-label');
            else treeButton.setAttribute('aria-label', orbitFallbackTreeHintOriginal.ariaLabel);
          }
          orbitFallbackTreeHintOriginal = null;
        }
      } else {
        orbitFallbackSection.remove();
        orbitFallbackContent = null;
        if (!orbitFallbackPlacementWarned) {
          console.warn('Atlas Orbit child labels need a control-free viewport slot at least 116px wide by 82px tall (a 62px dock for a 44px label plus 10px safety margins); no safe fallback placement is available.');
          orbitFallbackPlacementWarned = true;
        }
      }
    } else {
      orbitFallbackSection?.remove();
      orbitFallbackSection = null;
      orbitFallbackContent = null;
      if (orbitFallbackTreeHintOriginal) {
        const treeButton = labelDocument.querySelector?.('#atlas-show-tree');
        if (treeButton) {
          treeButton.textContent = orbitFallbackTreeHintOriginal.text;
          if (orbitFallbackTreeHintOriginal.title == null) treeButton.removeAttribute('title');
          else treeButton.setAttribute('title', orbitFallbackTreeHintOriginal.title);
          if (orbitFallbackTreeHintOriginal.ariaLabel == null) treeButton.removeAttribute('aria-label');
          else treeButton.setAttribute('aria-label', orbitFallbackTreeHintOriginal.ariaLabel);
        }
        orbitFallbackTreeHintOriginal = null;
      }
    }
    const orbitLaneCurrentTitle = current?.world?.title || 'current world';
    for (const lane of orbitLaneLayout.lanes) {
      if (lane.blocked || lane.x == null || lane.y == null || lane.width <= 0 || lane.height <= 0) continue;
      let element = orbitLabelLanes.get(lane.id);
      if (!element) {
        element = document.createElement('div');
        element.className = 'atlas-orbit-child-label-lane';
        element.setAttribute('role', 'region');
        element.tabIndex = 0;
        Object.assign(element.style, {
          position:'absolute', boxSizing:'border-box', display:'block',
          overflowX:'hidden', overscrollBehavior:'contain',
          pointerEvents:'auto', touchAction:'pan-y', zIndex:'4', padding:'0', gap:'4px',
          border:'1px solid rgba(179, 207, 213, 0.36)', borderRadius:'8px',
          background:'rgba(4, 13, 20, 0.90)', boxShadow:'0 2px 12px rgba(0, 0, 0, 0.35)',
          scrollbarColor:'rgba(177, 204, 210, 0.62) rgba(9, 20, 27, 0.55)',
        });
        const content = document.createElement('div');
        content.className = 'atlas-orbit-child-label-content';
        Object.assign(content.style, { position:'relative', width:'100%' });
        element.append(content);
        labelOverlay.append(element);
        orbitLabelLanes.set(lane.id, element);
        orbitLaneContents.set(lane.id, content);
      }
      const content = orbitLaneContents.get(lane.id);
      element.style.display = 'block';
      element.style.left = `${lane.x - labelBounds.left}px`;
      element.style.top = `${lane.y - labelBounds.top}px`;
      element.style.width = `${lane.width}px`;
      element.style.height = `${lane.height}px`;
      element.style.clipPath = 'none';
      element.style.overflowY = lane.scrollable ? 'auto' : 'hidden';
      content.style.height = `${lane.contentHeight}px`;
      element.scrollTop = orbitLaneScrollTops.get(lane.id) || 0;
      element.setAttribute('aria-label', `${orbitLaneCurrentTitle} direct children. ${lane.labelIds.length} labels in this lane${lane.scrollable ? ', scroll to see all labels' : ''}.`);
      element.dataset.contentHeight = String(lane.contentHeight);
      element.dataset.labelCount = String(lane.labelIds.length);
      element.dataset.scrollable = String(Boolean(lane.scrollable));
      activeOrbitLaneIds.add(lane.id);
    }
    for (const placement of [...orbitLaneLayout.local, ...orbitLaneLayout.labels]) {
      const lane = orbitLabelLanes.get(placement.laneId);
      const content = placement.local ? labelOverlay
        : placement.blocked ? orbitFallbackContent : orbitLaneContents.get(placement.laneId);
      const world = placement.world;
      if ((!placement.blocked && !placement.local && !lane) || !content || !world) continue;
      let button = orbitChildLabelButtons.get(placement.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'atlas-orbit-child-label';
        button.addEventListener('focus', () => {
          const target = worlds.find(item => stableWorldId(item) === button.dataset.worldId);
          if (target) setFocusedWorld(target, projectedAnchor(button.dataset.worldId, 'keyboard'));
        });
        button.addEventListener('blur', () => {
          if (hoveredId === button.dataset.worldId) setFocusedWorld(null, null);
        });
        button.addEventListener('pointerenter', event => {
          const target = worlds.find(item => stableWorldId(item) === button.dataset.worldId);
          if (target) setFocusedWorld(target, projectedAnchor(button.dataset.worldId, 'pointer', event.clientX, event.clientY));
        });
        button.addEventListener('pointerleave', () => {
          if (hoveredId === button.dataset.worldId && document.activeElement !== button) setFocusedWorld(null, null);
        });
        button.addEventListener('keydown', event => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            const next = neighborForKey(event.key);
            if (!next) return;
            setFocusedWorld(next.world, projectedAnchor(next.id, 'keyboard'));
            (orbitChildLabelButtons.get(next.id) || renderer.domElement).focus({ preventScroll:true });
          } else if (event.key === 'Escape') {
            event.preventDefault();
            if (zoom < 1) setZoom(Math.min(1, zoom + 0.1));
            else if (hoveredId) setFocusedWorld(null, null);
            renderer.domElement.focus({ preventScroll:true });
          }
        });
        button.addEventListener('click', event => {
          const target = worlds.find(item => stableWorldId(item) === button.dataset.worldId);
          if (target) explicitEnter(target, projectedAnchor(button.dataset.worldId, 'orbit-label', event.clientX, event.clientY));
        });
        orbitChildLabelButtons.set(placement.id, button);
      }
      button.dataset.worldId = placement.id;
      button.textContent = placement.text;
      button.title = placement.fullText;
      button.setAttribute('aria-label', `Open ${placement.fullText}`);
      button.setAttribute('aria-disabled', String(world.selectable === false));
      button.style.position = placement.blocked ? 'relative' : 'absolute';
      button.style.left = placement.blocked ? 'auto' : placement.local
        ? `${placement.x - labelBounds.left - placement.width / 2}px` : '0';
      button.style.top = placement.blocked ? 'auto' : placement.local
        ? `${placement.y - labelBounds.top - placement.height / 2}px` : `${placement.top}px`;
      button.style.width = placement.local ? `${placement.width}px` : '100%';
      button.style.height = `${placement.height}px`;
      button.style.minHeight = '44px';
      button.style.clipPath = 'none';
      Object.assign(button.style, {
        display:'block', boxSizing:'border-box', padding:'2px 7px', overflow:'hidden',
        border:'1px solid rgba(143, 180, 189, 0.28)', borderRadius:'5px',
        background:'rgba(16, 31, 40, 0.96)', color:'#f3ead9', textAlign:'left',
        fontFamily:'Inter, system-ui, sans-serif', fontSize:'11.5px', fontWeight:'550',
        lineHeight:'14px', whiteSpace:'normal', overflowWrap:'anywhere',
        display:'-webkit-box', WebkitBoxOrient:'vertical', WebkitLineClamp:'2',
        cursor:world.selectable === false ? 'default' : 'pointer', pointerEvents:'auto',
      });
      if (button.parentElement !== content) content.append(button);
      activeOrbitChildIds.add(placement.id);
    }
    for (const [id, button] of orbitChildLabelButtons) {
      if (activeOrbitChildIds.has(id)) continue;
      button.remove();
      orbitChildLabelButtons.delete(id);
    }
    for (const [id, element] of orbitLabelLanes) {
      if (activeOrbitLaneIds.has(id)) continue;
      element.remove();
      orbitLabelLanes.delete(id);
      orbitLaneContents.delete(id);
    }
    const visibleChildLabelRects = new Map();
    for (const [id, button] of orbitChildLabelButtons) {
      const lane = button.parentElement?.parentElement;
      if (!activeOrbitChildIds.has(id)) continue;
      const buttonRect = button.getBoundingClientRect();
      if (button.parentElement === labelOverlay) {
        if (buttonRect.width > 0 && buttonRect.height > 0) visibleChildLabelRects.set(id, {
          left:buttonRect.left, top:buttonRect.top, right:buttonRect.right, bottom:buttonRect.bottom,
        });
        continue;
      }
      if (!lane?.classList?.contains('atlas-orbit-child-label-lane')) continue;
      const laneRect = lane.getBoundingClientRect();
      const clipped = { left:Math.max(buttonRect.left, laneRect.left), top:Math.max(buttonRect.top, laneRect.top),
        right:Math.min(buttonRect.right, laneRect.right), bottom:Math.min(buttonRect.bottom, laneRect.bottom) };
      if (clipped.right > clipped.left && clipped.bottom > clipped.top) visibleChildLabelRects.set(id, clipped);
    }
    const activeLeaderIds = new Set();
    const acceptedLeaderLines = [];
    const overlayRect = labelOverlay.getBoundingClientRect();
    const leaderControlObstacles = [
      ...viewportObstacleRectsFromCenters(reservedRects),
      ...visibleViewportObstacleRects(labelDocument,
        '.site-header .brand, .site-header .header-actions, .panel-head, #atlas-toolbar, #atlas-other-questions, #atlas-world-card, #atlas-compact-controls, #atlas-reopen-controls, .geography-panel, .hero-panel, .exploration-rail, #invitation, #exploration-tree'),
      ...viewportObstacleRectsFromCenters(placements),
      ...[...visibleChildLabelRects].map(([id, rect]) => ({ id, ...rect })),
    ];
    for (const [id, labelRect] of visibleChildLabelRects) {
      const targetRect = worldNodeRects.get(id);
      if (!targetRect) continue;
      const obstacles = [
        ...viewportObstacleRectsFromCenters(nodeRects.filter(rect => rect !== targetRect)),
        ...leaderControlObstacles.filter(rect => rect.id !== id),
        ...acceptedLeaderLines,
      ];
      const line = createOrbitChildLabelLeader(labelRect, {
        left:targetRect.x - targetRect.width / 2, top:targetRect.y - targetRect.height / 2,
        right:targetRect.x + targetRect.width / 2, bottom:targetRect.y + targetRect.height / 2,
      }, obstacles);
      if (!line) continue;
      let element = orbitLeaderElements.get(id);
      if (!element) {
        element = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        element.setAttribute('aria-hidden', 'true');
        element.setAttribute('stroke', '#a8c6cb');
        element.setAttribute('stroke-opacity', '0.58');
        element.setAttribute('stroke-width', '1.25');
        element.setAttribute('stroke-dasharray', '3 4');
        element.setAttribute('stroke-linecap', 'round');
        element.setAttribute('vector-effect', 'non-scaling-stroke');
        orbitLeaderSvg.append(element);
        orbitLeaderElements.set(id, element);
      }
      element.setAttribute('x1', String(line.x1 - overlayRect.left));
      element.setAttribute('y1', String(line.y1 - overlayRect.top));
      element.setAttribute('x2', String(line.x2 - overlayRect.left));
      element.setAttribute('y2', String(line.y2 - overlayRect.top));
      activeLeaderIds.add(id);
      acceptedLeaderLines.push(line);
    }
    for (const [id, element] of orbitLeaderElements) {
      if (activeLeaderIds.has(id)) continue;
      element.remove();
      orbitLeaderElements.delete(id);
    }
    if (focusedOrbitChildId) {
      const focusedButton = orbitChildLabelButtons.get(focusedOrbitChildId);
      if (focusedButton && activeOrbitChildIds.has(focusedOrbitChildId)) {
        if (orbitFallbackMountMode === 'tree-reopen') {
          labelDocument.querySelector?.('#atlas-show-tree')?.focus?.({ preventScroll:true });
        } else {
          const focusedLane = focusedButton.parentElement?.parentElement;
          if (focusedLane?.classList?.contains('atlas-orbit-child-label-lane')) {
            restoreFocusedOrbitChildInLane(focusedLane, focusedButton, document.activeElement);
          } else if (document.activeElement !== focusedButton) focusedButton.focus({ preventScroll:true });
        }
      } else renderer.domElement.focus({ preventScroll:true });
    }
    const edgePositions = { lineage: [], proposed: [], question: [], hover: [] };
    const edgeVertexOpacity = { lineage: [], proposed: [], question: [], hover: [] };
    const edgeSegmentOpacity = { lineage: [], proposed: [], question: [], hover: [] };
    const allClusteredIds = new Set(orbitClusteredIdsForPresentation(clusterPlan, { atlas: state.atlas, zoom, orbitNeighborhoodIds }));
    const visibleAtlasIds = new Set(entries.filter(entry => !folded.has(entry.id) && !allClusteredIds.has(entry.id)).map(entry => entry.id));
    const lineageIds = new Set(atlasTimeline?.lineageIds || []);
    const hoverPathIds = new Set(hoveredId ? [String(hoveredId), ...ancestorIds(hoveredId)] : []);
    const entryById = new Map(entries.map(entry => [entry.id, entry]));
    const questionById = new Map(questions.map(question => [String(question.id), question]));
    const currentParentId = current?.parentId ?? null;
    for (const child of entries) {
      if (child.parentId == null) continue;
      const parent = entryById.get(String(child.parentId));
      if (!parent) continue;
      const onSurface = (parent.id === currentId && child.surfaceVisible) || (child.id === currentId && parent.id === arrivalFromId);
      const inOrbit = (parent.id === currentId && child.orbitVisible) || child.id === currentId || (currentParentId != null && parent.id === String(currentParentId) && child.orbitVisible);
      const inAtlas = visibleAtlasIds.has(parent.id) && visibleAtlasIds.has(child.id);
      const nonAtlasAlpha = (onSurface ? state.surface : 0) + (inOrbit ? state.orbit : 0);
      const atlasAlpha = suppressAtlasThreads ? 0 : (inAtlas ? state.atlas : 0);
      const alpha = Math.min(1,
        nonAtlasAlpha + atlasAlpha);
      if (alpha <= 0.015) continue;
      const childQuestion = questionById.get(String(child.world.questionId ?? ''));
      const isQuestionAttachment = String(childQuestion?.attachmentMode || childQuestion?.mode || '') === 'current-world'
        && String(childQuestion.parentWorldId ?? '') === parent.id;
      const kind = lineageIds.has(parent.id) && lineageIds.has(child.id) ? 'lineage'
        : state.atlas > 0.05 && hoverPathIds.has(parent.id) && hoverPathIds.has(child.id) ? 'hover'
        : (isQuestionAttachment || child.world.proposed === false || child.world.questionId !== parent.world.questionId || /question|chronos|time.?token/i.test(`${child.world.kind || ''} ${child.world.type || ''} ${child.world.tokenType || ''}`)) ? 'question'
          : 'proposed';
      const edgeState = suppressAtlasThreads ? { ...state, atlas:0 } : state;
      const fromRadius = parent.id === currentId ? surfaceEarthRadius(edgeState) : markerRadius;
      const from = worldPosition(parent, edgeState, timestamp, fromRadius);
      const to = worldPosition(child, edgeState, timestamp, markerRadius);
      const surfaceFrom = surfacePoint(parent, fromRadius).normalize();
      const surfaceTo = surfacePoint(child, markerRadius).normalize();
      const arrivalEdge = child.id === currentId && parent.id === arrivalFromId;
      const arcPoints = [];
      const path = atlasTimeline?.parentChildPaths?.find(item => item.parentId === parent.id && item.childId === child.id);
      const previousPath = axisTransition?.fromTimeline?.parentChildPaths?.find(item => item.parentId === parent.id && item.childId === child.id);
      const progress = axisTransition ? axisTransitionProgress(timestamp - axisTransition.startedAt, AXIS_ANIMATION_MS) : 1;
      const directMorphActive = edgeState.lift >= 0.999;
      let routeFrom = from, routeTo = to, orbitFrom = null, orbitTo = null;
      if (directMorphActive) {
        const atlasEdgeState = { ...state, lift:1, atlas:1 };
        const atlasMarkerRadius = pinAnchorRadiusAtPresentation(surfaceEarthRadius(atlasEdgeState), 1, 1);
        const atlasFromRadius = parent.id === currentId ? surfaceEarthRadius(atlasEdgeState) : atlasMarkerRadius;
        routeFrom = worldPosition(parent, atlasEdgeState, timestamp, atlasFromRadius);
        routeTo = worldPosition(child, atlasEdgeState, timestamp, atlasMarkerRadius);
        const orbitEdgeState = { ...state, lift:1, atlas:0 };
        const orbitMarkerRadius = pinAnchorRadiusAtPresentation(surfaceEarthRadius(orbitEdgeState), 1, 0);
        const orbitFromRadius = parent.id === currentId ? surfaceEarthRadius(orbitEdgeState) : orbitMarkerRadius;
        orbitFrom = worldPosition(parent, orbitEdgeState, timestamp, orbitFromRadius);
        orbitTo = worldPosition(child, orbitEdgeState, timestamp, orbitMarkerRadius);
      }
      let atlasCurve = path?.routeShape?.length > 1
        ? transformAtlasEdgeShape(routeFrom, routeTo, path.routeShape)
        : sampleAtlasEdgePath(routeFrom, routeTo, 16);
      if (previousPath?.routeShape?.length > 1 && path?.routeShape?.length > 1 && progress < 1) {
        atlasCurve = interpolateAtlasRouteShapes(routeFrom, routeTo, previousPath.routeShape, path.routeShape, progress,
          { from:previousPath.from, to:previousPath.to }, { from:path.from, to:path.to });
      }
      const segments = Math.max(1, atlasCurve.length - 1);
      const directMorph = directMorphActive
        ? interpolateAttachedAtlasEdgeRoute(orbitFrom, orbitTo, atlasCurve, inAtlas && !suppressAtlasThreads ? state.atlas : 0,
          { from, to, easeInterior:true })
        : null;
      for (let step = 0; step <= segments; step++) {
        const t = step / segments;
        const direction = slerpUnitVector(surfaceFrom, surfaceTo, t);
        const surfaceRadius = fromRadius + (markerRadius - fromRadius) * t;
        const arc = arrivalEdge ? from.clone().lerp(to, t)
          : new THREE.Vector3(direction.x, direction.y, direction.z).multiplyScalar(surfaceRadius).add(earthMesh.position);
        const straight = from.clone().lerp(to, t);
        arc.lerp(straight, state.lift);
        if (directMorph) {
          arc.set(directMorph[step].x, directMorph[step].y, directMorph[step].z);
        } else {
          arc.lerp(new THREE.Vector3(atlasCurve[step].x, atlasCurve[step].y, atlasCurve[step].z), edgeState.atlas);
        }
        arcPoints.push(arc);
      }
      const values = edgePositions[kind];
      for (let step = 0; step < segments; step++) {
        const a = arcPoints[step], b = arcPoints[step + 1];
        values.push(a.x, a.y, a.z, b.x, b.y, b.z);
        edgeVertexOpacity[kind].push(alpha, alpha);
        edgeSegmentOpacity[kind].push(alpha);
      }
    }
    const rootConnections = state.atlas > 0.015 && !suppressAtlasThreads
      ? (atlasTimeline?.questionRootPaths || []).filter(connection => !folded.has(connection.worldId) || connection.color === 'lineage')
      : [];
    if (state.orbit > 0.015 && orbitQuestionParentPosition && orbitQuestionParentQuestion) {
      const currentQuestionId = String(current?.world?.questionId ?? '');
      const parentOrbit = new THREE.Vector3(orbitQuestionParentPosition.x, orbitQuestionParentPosition.y, orbitQuestionParentPosition.z || 0);
      const parentPoint = new THREE.Vector3().lerp(parentOrbit, state.lift);
      for (const root of entries) {
        if (root.parentId != null || String(root.world?.questionId ?? '') !== currentQuestionId || root.folded) continue;
        const rootOrbit = root.orbit || root.atlas;
        const rootPoint = new THREE.Vector3(rootOrbit.x, rootOrbit.y, rootOrbit.z || 0).multiplyScalar(state.lift);
        if (!suppressAtlasThreads) rootPoint.lerp(atlasPosition(root, timestamp), state.atlas);
        edgePositions.question.push(parentPoint.x, parentPoint.y, parentPoint.z, rootPoint.x, rootPoint.y, rootPoint.z);
        edgeVertexOpacity.question.push(state.orbit, state.orbit);
        edgeSegmentOpacity.question.push(state.orbit);
      }
    }
    for (const connection of rootConnections) {
      const root = entryById.get(connection.worldId);
      const branch = atlasTimeline?.questionBranches?.find(item => item.questionId === connection.questionId);
      if (!root || !branch) continue;
      let tokenX = branch.x, tokenY = branch.y;
      const progress = axisTransition ? axisTransitionProgress(timestamp - axisTransition.startedAt, AXIS_ANIMATION_MS) : 1;
      const prior = axisTransition?.fromTimeline?.questionBranches?.find(item => item.questionId === connection.questionId);
      if (prior) {
        tokenX = prior.x + (branch.x - prior.x) * progress;
        tokenY = prior.y + (branch.y - prior.y) * progress;
      }
      const from = new THREE.Vector3(tokenX, tokenY, connection.from?.z ?? 0.06);
      // Keep the question link attached to the root as it moves between Orbit and Atlas.
      const rootPoint = worldPosition(root, state, timestamp, markerRadius);
      const priorConnection = axisTransition?.fromTimeline?.questionRootPaths?.find(item =>
        item.questionId === connection.questionId && item.worldId === connection.worldId);
      let route = transformAtlasEdgeShape(from, rootPoint, connection.routeShape);
      if (priorConnection?.routeShape?.length > 1 && connection.routeShape?.length > 1 && progress < 1) {
        route = interpolateAtlasRouteShapes(from, rootPoint, priorConnection.routeShape, connection.routeShape, progress,
          { from:priorConnection.from, to:priorConnection.to }, { from:connection.from, to:connection.to });
      }
      const kind = connection.color === 'lineage' ? 'lineage'
        : hoverPathIds.has(connection.worldId) ? 'hover'
          : connection.color === 'question' ? 'question' : 'proposed';
      const values = edgePositions[kind];
      const alpha = state.atlas;
      for (let index = 0; index < route.length - 1; index++) {
        const a = route[index], b = route[index + 1];
        values.push(a.x, a.y, a.z, b.x, b.y, b.z);
        edgeVertexOpacity[kind].push(alpha, alpha);
        edgeSegmentOpacity[kind].push(alpha);
      }
    }
    writeEdgeBuffer(threads, new Float32Array(edgePositions.proposed), edgeVertexOpacity.proposed);
    writeEdgeBuffer(hoverThreads, new Float32Array(edgePositions.hover), edgeVertexOpacity.hover);
    writeEdgeBuffer(lineageThreads, new Float32Array(edgePositions.lineage), edgeVertexOpacity.lineage);
    writeEdgeBuffer(questionThreads, new Float32Array(edgePositions.question), edgeVertexOpacity.question);
    camera.updateMatrixWorld(true);
    camera.getWorldPosition(goldCameraWorldPosition);
    const goldSegmentCounts = Array(GOLD_OPACITY_BUCKET_COUNT).fill(0);
    const goldOpacityLevels = [];
    const goldPositions = edgePositions.lineage;
    for (let offset = 0, segmentIndex = 0; offset + 5 < goldPositions.length; offset += 6, segmentIndex++) {
      const alpha = edgeSegmentOpacity.lineage[segmentIndex] || 0;
      if (alpha <= 0.015) continue;
      let bucketIndex = goldOpacityLevels.findIndex(level => Math.abs(level - alpha) < 1e-7);
      if (bucketIndex < 0) {
        bucketIndex = goldOpacityLevels.length;
        if (bucketIndex >= GOLD_OPACITY_BUCKET_COUNT) {
          bucketIndex = goldOpacityLevels.reduce((nearest, level, index) => Math.abs(level - alpha) < Math.abs(goldOpacityLevels[nearest] - alpha) ? index : nearest, 0);
        } else goldOpacityLevels.push(alpha);
      }
      ensureGoldEdgeCapacity(bucketIndex, goldSegmentCounts[bucketIndex] + 1);
      goldSegmentStart.fromArray(goldPositions, offset);
      goldSegmentEnd.fromArray(goldPositions, offset + 3);
      goldSegmentDirection.subVectors(goldSegmentEnd, goldSegmentStart);
      const length = goldSegmentDirection.length();
      if (length < 1e-5) continue;
      goldSegmentWorldMidpoint.copy(goldSegmentStart).add(goldSegmentEnd).multiplyScalar(0.5).applyMatrix4(atlasGroup.matrixWorld);
      const distance = goldSegmentWorldMidpoint.distanceTo(goldCameraWorldPosition);
      const radius = worldRadiusForScreenPixels(distance, camera.fov, Math.max(1, renderer.domElement.clientHeight), 2.5);
      dummy.position.copy(goldSegmentStart).add(goldSegmentEnd).multiplyScalar(0.5);
      dummy.quaternion.setFromUnitVectors(goldCylinderUp, goldSegmentDirection.multiplyScalar(1 / length));
      dummy.scale.set(radius, length, radius);
      dummy.updateMatrix(); goldEdgeMeshes[bucketIndex].setMatrixAt(goldSegmentCounts[bucketIndex]++, dummy.matrix);
    }
    for (let bucketIndex = 0; bucketIndex < goldEdgeMeshes.length; bucketIndex++) {
      const mesh = goldEdgeMeshes[bucketIndex];
      mesh.count = goldSegmentCounts[bucketIndex];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.material.opacity = goldOpacityLevels[bucketIndex] || 0;
    }
    lineageThreads.visible = false;
    threads.computeLineDistances(); questionThreads.computeLineDistances();
    threads.material.opacity = 0.82 - 0.5 * state.atlas;
    hoverThreads.material.opacity = 0.95;
    lineageThreads.material.opacity = 0.9;
    questionThreads.material.opacity = 0.84 - 0.5 * state.atlas;
    lodPoints.material.opacity = 0.92;
    lodPointMaterial.size = 4.2 + 8.8 * state.atlas;
    instancedPins.material.transparent = true;
    instancedPins.material.opacity = 1;
    p2Renderer.update(atlasTimeline, {
      opacity: state.atlas,
      axisMode,
      branchProgress: axisTransition ? axisTransitionProgress(timestamp - axisTransition.startedAt, AXIS_ANIMATION_MS) : 1,
      fromBranches: axisTransition?.fromTimeline.questionBranches,
      fromStems: axisTransition?.fromTimeline.questionStemPaths,
    });
    p2Renderer.setQuestionBranchOpacity(suppressAtlasThreads ? 0 : 1);
    p2Renderer.group.traverse(object => {
      if (object.isSprite && object.userData?.labelText != null) object.material.opacity = 0;
    });
    const level = stageForZoom(zoom);
    if (announce && level !== lastLevel) { lastLevel = level; onLevelChange({ level, zoom, altitude: liveCameraDistance }); }
  }

  function setWorlds(snapshot = {}) {
    axisTransition = null;
    let requestedCurrentId = null, hasRequestedCurrentId = false;
    if (Array.isArray(snapshot)) worlds = snapshot;
    else {
      worlds = Array.isArray(snapshot?.worlds) ? snapshot.worlds : Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
      questions = Array.isArray(snapshot?.questions) ? snapshot.questions : [];
      if (Object.prototype.hasOwnProperty.call(snapshot || {}, 'currentId')) {
        hasRequestedCurrentId = true;
        requestedCurrentId = snapshot.currentId == null ? null : String(snapshot.currentId);
      }
    }
    const preserveSource = hasRequestedCurrentId && preservesTravelSource(travelState, requestedCurrentId);
    if (hasRequestedCurrentId && !preserveSource) currentId = requestedCurrentId;
    worlds = worlds.filter(world => stableWorldId(world));
    for (const record of registry.prune(worlds)) disposeWorldRecord(record);
    registry.reconcile(worlds);
    if (currentId && !worlds.some(world => stableWorldId(world) === currentId)) currentId = null;
    arrivalFromId = arrivalParentWorldId(worlds.find(world => stableWorldId(world) === currentId), worlds);
    updateLayout({ animateQuestionRefocus: true }); drawCurrentMarker(); applyZoom(zoom, false);
  }

  function setGeography(_geography, mode, renderState) {
    geographyPreviewWorldId = currentId;
    geographyPreviewState = renderState;
    geographyPreviewMode = mode === 'present' ? 'present' : 'scenario';
    hasGeographyPreview = true;
    updateLayout(); drawCurrentMarker(); applyZoom(zoom, false);
  }

  function enterWorld(id, options = {}) {
    const worldId = String(id);
    const world = worlds.find(item => stableWorldId(item) === worldId);
    if (!world || world.selectable === false) return false;
    if (travelState?.toId === worldId) {
      if (!travelState.zoomOverridden && options.zoom != null) travelState.toZoom = clamp(Number(options.zoom) || 0, 0, 1);
      return true;
    }
    axisTransition = null;
    const pathIds = currentId ? (travelMode === 'threads' && !motionReduced
      ? lineageTravelPath(worlds, currentId, worldId)
      : [currentId, worldId]) : [];
    if (currentId && currentId !== worldId && pathIds.length > 1) {
      const targetZoom = clamp(Number(options.zoom ?? 0), 0, 1);
      const startedAt = performance.now();
      travelState = { pathIds, fromId: currentId, toId: worldId, fromZoom: zoom, toZoom: targetZoom, startedAt, duration: travelDuration(travelMode, motionReduced), zoomOverridden: false, cut: travelMode === 'cut' || motionReduced, cutSwitched: false };
      applyZoom(zoom, false, startedAt);
      return true;
    }
    travelState = null;
    arrivalFromId = arrivalParentWorldId(world, worlds);
    currentId = worldId;
    updateLayout({ animateQuestionRefocus: true }); drawCurrentMarker();
    applyZoom(options.zoom ?? Math.max(zoom, 0.68));
    return true;
  }

  function setZoom(value) {
    if (travelState) travelState.zoomOverridden = true;
    applyZoom(value);
  }
  function getZoom() { return zoom; }
  function setTravelMode(mode) {
    if (mode !== 'threads' && mode !== 'cut') return false;
    travelMode = motionReduced ? 'cut' : mode;
    if (travelState && travelMode === 'cut') {
      travelState = { ...travelState, pathIds: [travelState.fromId, travelState.toId], startedAt: performance.now(), duration: travelDuration('cut', motionReduced), cut: true, cutSwitched: false };
    }
    return true;
  }
  function getTravelMode() { return travelMode; }
  function setGhostTrail(value) { ghostTrail = Boolean(value); applyZoom(zoom); }
  function getGhostTrail() { return ghostTrail; }
  function explicitEnter(world, anchor) {
    if (!world || world.selectable === false) return false;
    onEnter(world, anchor);
    return true;
  }
  largeClusterPicker = createLargeClusterPicker({
    container,
    document: container.ownerDocument || document,
    focusFallback: renderer.domElement,
    onSelect: (world, { source, clientX, clientY }) => {
      explicitEnter(world, projectedAnchor(stableWorldId(world), source, clientX, clientY));
    },
  });
  function setAxisMode(mode) {
    if (!AXIS_MODES.includes(mode)) return false;
    if (mode === axisMode && !axisTransition) return true;
    if (motionReduced) {
      axisTransition = null; axisMode = mode; axisFadeOpacity = 1; updateCanvasOpacity();
      refreshAtlasTimeline(); applyZoom(zoom, false);
      return true;
    }
    const startedAt = performance.now();
    const from = new Map(entries.map(entry => {
      const point = atlasPosition(entry, startedAt);
      return [entry.id, { x: point.x, y: point.y, z: point.z }];
    }));
    const fromTimeline = atlasTimeline;
    axisTransition = null;
    axisMode = mode;
    refreshAtlasTimeline();
    axisTransition = { from, to: atlasTimeline, fromTimeline, startedAt };
    applyZoom(zoom, false, startedAt);
    return true;
  }
  function getAxisMode() { return axisMode; }
  function worldSphereCounts() {
    const instancedWorldSpheres = [...texturePinMeshes.values()].reduce((sum, mesh) => sum + mesh.count, 0);
    const currentWorldSpheres = currentId && earthMesh.visible ? 1 : 0;
    return { instancedWorldSpheres, currentWorldSpheres, realWorldSpheres: instancedWorldSpheres + currentWorldSpheres };
  }
  function textureEdge(texture) {
    return Math.max(Number(texture?.image?.width) || 0, Number(texture?.image?.height) || 0);
  }
  function getDebugStats() {
    let sceneCount = 0, cameraCount = 0, meshCount = 0, pointCloudCount = 0, lineCount = 0, presentEarthReferenceCount = 0;
    scene.traverse(object => {
      if (object.isScene) sceneCount++;
      if (object.isCamera) cameraCount++;
      if (object.isMesh || object.isInstancedMesh) meshCount++;
      if (object.isPoints) pointCloudCount++;
      if (object.isLine || object.isLineSegments) lineCount++;
      if (object.name === 'Present-day Earth 2026') presentEarthReferenceCount++;
    });
    const sphereCounts = worldSphereCounts();
    const maxMiniTextureEdge = Math.max(textureEdge(miniEarthTexture), ...[...miniTextureByWorldId.values()].map(textureEdge));
    const maxSceneDiscTextureEdge = Math.max(0, ...entries.map(entry => textureEdge(registry.get(entry.id)?.disc?.material?.map)));
    const textureMetadata = { maxCurrentTextureEdge: textureEdge(currentEarthTexture), maxMiniTextureEdge, maxSceneDiscTextureEdge };
    Object.assign(renderer.domElement.dataset, Object.fromEntries(Object.entries(textureMetadata).map(([key, value]) => [key, String(value)])));
    Object.assign(container.dataset, Object.fromEntries(Object.entries(textureMetadata).map(([key, value]) => [key, String(value)])));
    return {
      sceneCount, cameraCount, rendererCount: renderer.isWebGLRenderer ? 1 : 0,
      meshCount, pointCloudCount, lineCount, worldCount: entries.length,
      ...sphereCounts, ...textureMetadata, presentEarthReferenceCount,
      goldEdgeSegments: renderedGoldEdgeSegmentCount(),
      lineageWorldIds: [...(atlasTimeline?.lineageIds || [])],
    };
  }
  function getWorldImageUrl(id, { selected = false } = {}) {
    const world = worlds.find(item => stableWorldId(item) === String(id));
    return world ? imageForWorld(world, Boolean(selected && String(id) === currentId), resolveWorldImageUrl) : null;
  }
  function setSurfaceLabelLevel(value) { surfaceLabelsLevel = clampAtlasLevel(value); updateLayout(); applyZoom(zoom); }
  function setOrbitLevel(value) { orbitUnfoldLevel = clampAtlasLevel(value, ORBIT_UNFOLDED_LEVEL); updateLayout(); applyZoom(zoom); }

  function eventPoint(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return bounds;
  }

  function projectedAnchor(id, source = 'keyboard', pointerX = null, pointerY = null) {
    const entry = entries.find(item => item.id === String(id));
    if (!entry) return { source, worldId: String(id), clientX: pointerX, clientY: pointerY, projectedX: null, projectedY: null };
    const state = atlasPresentationState(zoom, motionReduced).state;
    const local = hitWorldPosition(entry, state);
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const ndc = local.applyMatrix4(atlasGroup.matrixWorld).project(camera);
    const bounds = renderer.domElement.getBoundingClientRect();
    const projectedX = bounds.left + ((ndc.x + 1) * 0.5) * bounds.width;
    const projectedY = bounds.top + ((1 - ndc.y) * 0.5) * bounds.height;
    return {
      source, worldId: String(id),
      clientX: pointerX == null ? projectedX : pointerX,
      clientY: pointerY == null ? projectedY : pointerY,
      projectedX, projectedY,
    };
  }

  function setFocusedWorld(world, anchor) {
    const id = world ? stableWorldId(world) : null;
    const changed = id !== hoveredId;
    hoveredId = id;
    renderer.domElement.dataset.focusedWorldId = id || '';
    renderer.domElement.dataset.previewWorldId = id || '';
    container.dataset.focusedWorldId = id || '';
    container.dataset.previewWorldId = id || '';
    onPreview(world || null, anchor || null);
    if (changed) applyZoom(zoom, false);
  }

  function neighborForKey(key) {
    const originId = hoveredId || currentId;
    const origin = entries.find(entry => entry.id === originId);
    if (!origin) return null;
    const neighborEntries = visibleKeyboardNeighborEntries(entries, origin, visibleKeyboardWorldIds);
    if (!neighborEntries.length) return null;
    const originAnchor = projectedAnchor(origin.id);
    const points = neighborEntries.map(entry => {
      const anchor = projectedAnchor(entry.id);
      return { id: entry.id, x: anchor.projectedX ?? originAnchor.projectedX ?? 0, y: anchor.projectedY ?? originAnchor.projectedY ?? 0, entry };
    });
    return nearestDirectionalNeighbor({ id: origin.id, x: originAnchor.projectedX ?? 0, y: originAnchor.projectedY ?? 0 }, points, key)?.entry || null;
  }

  function projectedPointDepth(point) {
    const projected = point.clone().project(camera);
    pointer.set(projected.x, projected.y);
    raycaster.setFromCamera(pointer, camera);
    return {
      distance: point.distanceTo(raycaster.ray.origin),
      earthDistance: raycaster.intersectObject(earthMesh, false)[0]?.distance ?? Number.POSITIVE_INFINITY,
    };
  }

  function targetVisiblePastEarth(point, state = atlasPresentationState(zoom, motionReduced).state) {
    if (state.surface <= 0.15) return true;
    const depth = projectedPointDepth(point);
    return !targetOccludedByEarth(depth.distance, depth.earthDistance, state.surface);
  }

  function hitWorldTarget(event) {
    const bounds = eventPoint(event);
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const state = atlasPresentationState(zoom, motionReduced).state;
    const currentEarthHit = raycaster.intersectObject(earthMesh, false)[0];
    const occlusionDistance = currentEarthHit?.distance ?? Number.POSITIVE_INFINITY;
    const candidates = new Set([...instanceIds, ...lodIds]);
    if (currentId && !allowEarthBodySelection(zoom)) candidates.add(currentId);
    const byId = new Map(worlds.map(world => [stableWorldId(world), world]));
    const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
    const hits = [];
    for (const id of candidates) {
      const entry = entries.find(item => item.id === id);
      if (!entry) continue;
      const center = hitWorldPosition(entry, state).applyMatrix4(atlasGroup.matrixWorld);
      const cameraSpace = center.clone().applyMatrix4(camera.matrixWorldInverse);
      const viewDepth = -cameraSpace.z;
      if (viewDepth <= 0 || !targetVisiblePastEarth(center, state)) continue;
      const radius = worldRadiusForScreenPixels(viewDepth, camera.fov, Math.max(1, bounds.height), 44);
      const point = raycaster.ray.intersectSphere(new THREE.Sphere(center, radius), new THREE.Vector3());
      if (!point) continue;
      const hitDistance = point.distanceTo(cameraPosition);
      if (state.surface > 0.15 && hitDistance >= occlusionDistance) continue;
      const projected = center.clone().project(camera);
      const anchorX = bounds.left + (projected.x + 1) * 0.5 * bounds.width;
      const anchorY = bounds.top + (1 - projected.y) * 0.5 * bounds.height;
      const dx = event.clientX - anchorX, dy = event.clientY - anchorY;
      hits.push({ id, distanceSquared: dx * dx + dy * dy, hitDistance, world: byId.get(id) || null });
    }
    const best = nearestProjectedAnchorHit(hits);
    const bestWorld = projectedWorldTarget(best);
    if (bestWorld) return { ...bestWorld, id: `0:world:${stableWorldId(bestWorld.world)}`, kind: 'world', priority: 0 };
    if (allowEarthBodySelection(zoom) && currentEarthHit && currentId) {
      const projected = earthMesh.getWorldPosition(new THREE.Vector3()).project(camera);
      const anchorX = bounds.left + (projected.x + 1) * 0.5 * bounds.width;
      const anchorY = bounds.top + (1 - projected.y) * 0.5 * bounds.height;
      const dx = event.clientX - anchorX, dy = event.clientY - anchorY;
      return { world: byId.get(currentId) || null, distanceSquared: dx * dx + dy * dy, hitDistance: currentEarthHit.distance,
        id: `0:world:${currentId}`, kind: 'world', priority: 0 };
    }
    return null;
  }
  function hitWorld(event) {
    return hitWorldTarget(event)?.world || null;
  }

  function virtualPresentEarth() {
    return { ...PRESENT_DAY_REFERENCE };
  }
  function hitPresentEarth(event) {
    if (!p2Renderer.presentEarth.visible || atlasPresentationState(zoom, motionReduced).state.atlas <= 0.15) return null;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const center = p2Renderer.presentEarth.getWorldPosition(new THREE.Vector3());
    const cameraSpace = center.clone().applyMatrix4(camera.matrixWorldInverse);
    const viewDepth = -cameraSpace.z;
    if (viewDepth <= 0 || !targetVisiblePastEarth(center)) return null;
    eventPoint(event);
    const bounds = renderer.domElement.getBoundingClientRect();
    const radius = Math.max(0.36, worldRadiusForScreenPixels(viewDepth, camera.fov, Math.max(1, bounds.height), 44));
    const point = raycaster.ray.intersectSphere(new THREE.Sphere(center, radius), new THREE.Vector3());
    if (!point) return null;
    const projected = center.clone().project(camera);
    const x = bounds.left + (projected.x + 1) * 0.5 * bounds.width;
    const y = bounds.top + (1 - projected.y) * 0.5 * bounds.height;
    const dx = event.clientX - x, dy = event.clientY - y;
    return { id: '2:present-earth', kind: 'present', priority: 2, world: virtualPresentEarth(),
      distanceSquared: dx * dx + dy * dy, hitDistance: point.distanceTo(raycaster.ray.origin) };
  }
  function hitQuestionChip(event) {
    if (atlasPresentationState(zoom, motionReduced).state.atlas <= 0.15) return null;
    const bounds = eventPoint(event);
    const pointerRayOrigin = raycaster.ray.origin.clone();
    const pointerRayDirection = raycaster.ray.direction.clone();
    const pointerEarthDistance = raycaster.intersectObject(earthMesh, false)[0]?.distance ?? Number.POSITIVE_INFINITY;
    const cameraForward = camera.getWorldDirection(new THREE.Vector3());
    const state = atlasPresentationState(zoom, motionReduced).state;
    let best = null, bestDistance = 22;
    for (const { chip, sprite } of p2Renderer.getQuestionChipTargets()) {
      if (!chip || !sprite.visible) continue;
      const point = sprite.getWorldPosition(new THREE.Vector3());
      if (!targetVisiblePastEarth(point)) continue;
      const pointerTargetDistance = pointerRayDistanceAtTargetDepth(point, pointerRayOrigin, pointerRayDirection, cameraForward);
      if (pointerTargetDistance == null || targetOccludedByEarth(pointerTargetDistance, pointerEarthDistance, state.surface)) continue;
      const screen = sprite.getWorldPosition(new THREE.Vector3()).project(camera);
      const x = bounds.left + (screen.x + 1) * 0.5 * bounds.width;
      const y = bounds.top + (1 - screen.y) * 0.5 * bounds.height;
      const distance = Math.hypot(event.clientX - x, event.clientY - y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        const depth = projectedPointDepth(point);
        best = { id: `1:question:${chip.questionId}`, kind: 'question', priority: 1, chip, x, y,
          distanceSquared: distance * distance, hitDistance: depth.distance };
      }
    }
    return best;
  }
  function questionForChip(chip) {
    return questions.find(question => String(question.id) === String(chip.questionId))
      || { id: String(chip.questionId), question: chip.label, divergenceYear: chip.divergenceYear };
  }
  function questionAnchor(question, source, clientX = null, clientY = null, projectedX = null, projectedY = null) {
    return { source, questionId: String(question.id), clientX: clientX ?? projectedX, clientY: clientY ?? projectedY, projectedX, projectedY };
  }
  function expandQuestionChip(chip, anchor) {
    if (!chip?.questionId) return false;
    const questionId = String(chip.questionId);
    expandedQuestionIds.add(questionId);
    const question = questionForChip(chip);
    onQuestionEnter(question, anchor || questionAnchor(question, 'keyboard'));
    hoveredQuestionId = questionId;
    hoveredReference = false;
    hoveredId = null;
    renderer.domElement.dataset.focusedQuestionId = questionId;
    container.dataset.focusedQuestionId = questionId;
    updateLayout(); applyZoom(zoom, false);
    return true;
  }

  function hitPagedClusterCandidate(event) {
    const containerBounds = container.getBoundingClientRect();
    const hit = largeClusterPicker?.hitTestCandidate(event.clientX - containerBounds.left, event.clientY - containerBounds.top) || null;
    if (!hit?.cluster) return null;
    const sprite = [...clusterSprites.values()].find(item => item.userData.cluster?.id === hit.cluster.id);
    if (!sprite || sprite.material.opacity <= 0.04) return null;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const point = sprite.getWorldPosition(new THREE.Vector3());
    if (!targetVisiblePastEarth(point)) return null;
    const depth = projectedPointDepth(point);
    return { ...hit, id: `3:cluster:${hit.cluster.id}`, kind: 'cluster', priority: 3, hitDistance: depth.distance };
  }

  function hitClusterTarget(event, { excludePaged = false } = {}) {
    const bounds = eventPoint(event);
    const active = [...clusterSprites.values()].filter(sprite => sprite.visible && sprite.material.opacity > 0.05);
    const earthDistance = raycaster.intersectObject(earthMesh, false)[0]?.distance ?? Number.POSITIVE_INFINITY;
    const state = atlasPresentationState(zoom, motionReduced).state;
    const boundsHits = raycaster.intersectObjects(active, false);
    const hits = [];
    for (const intersection of boundsHits) {
      const cluster = intersection.object.userData.cluster;
      if (!cluster || (excludePaged && needsPagedClusterPicker(cluster))) continue;
      if (state.surface > 0.15 && intersection.distance >= earthDistance - 1e-4) continue;
      const center = intersection.object.getWorldPosition(new THREE.Vector3()).project(camera);
      const screenX = bounds.left + (center.x + 1) * 0.5 * bounds.width;
      const screenY = bounds.top + (1 - center.y) * 0.5 * bounds.height;
      const dx = event.clientX - screenX, dy = event.clientY - screenY;
      hits.push({ id: `3:cluster:${cluster.id}`, cluster, kind: 'cluster', priority: 3,
        distanceSquared: dx * dx + dy * dy, hitDistance: intersection.distance });
    }
    return nearestProjectedAnchorHit(hits);
  }

  function hitCluster(event) {
    return hitClusterTarget(event)?.cluster || null;
  }

  function nearestPagedPointerTarget(event, pagedClusterHit, { activation = false } = {}) {
    const candidates = [
      pagedClusterHit,
      hitWorldTarget(event),
      hitQuestionChip(event),
      hitPresentEarth(event),
      hitClusterTarget(event, { excludePaged: true }),
    ].filter(Boolean);
    return nearestProjectedAnchorHit(candidates, { excludeUnselectableClusters: activation });
  }

  function fanCenterForCluster(cluster) {
    const sprite = [...clusterSprites.values()].find(item => item.userData.cluster?.id === cluster?.id);
    if (!sprite) return null;
    const bounds = renderer.domElement.getBoundingClientRect();
    const ndc = sprite.getWorldPosition(new THREE.Vector3()).project(camera);
    return { x: bounds.left + (ndc.x + 1) * 0.5 * bounds.width, y: bounds.top + (1 - ndc.y) * 0.5 * bounds.height };
  }
  function openClusterFan(cluster) {
    if (needsPagedClusterPicker(cluster)) {
      largeClusterPicker?.open(cluster.id, { focus: true });
      return;
    }
    hoveredClusterId = cluster.id;
    const offsets = cluster.selectable ? fanMemberOffsets(cluster.memberIds, { spacing: 48, maxRadius: 120 }) : [];
    fanOffsets = new Map(offsets.map(offset => [offset.id, offset]));
    const center = fanCenterForCluster(cluster);
    fanRegion = center && offsets.length ? createFanHitRegion(center, offsets, { hitRadius: 22, padding: 8 }) : null;
    updateLayout(); applyZoom(zoom, false);
  }
  function closeClusterFan() {
    if (!hoveredClusterId && !fanOffsets.size) return;
    hoveredClusterId = null; fanOffsets = new Map(); fanRegion = null;
    updateLayout(); applyZoom(zoom, false);
  }

  listen(renderer.domElement, 'pointerdown', event => {
    if (event.pointerType !== 'touch' && event.button !== 0) return;
    renderer.domElement.setPointerCapture?.(event.pointerId);
    if (event.pointerType === 'touch') {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activePointers.size === 2) {
        const [first, second] = [...activePointers.values()];
        pinchGesture = { distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)), zoom };
        drag = null;
        event.preventDefault?.();
        return;
      }
    }
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, rotation };
  });
  listen(renderer.domElement, 'pointermove', event => {
    if (event.pointerType === 'touch' && activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchGesture && activePointers.size >= 2) {
        const [first, second] = [...activePointers.values()];
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
        // Pinching apart moves toward the surface; pinching together moves out toward the atlas.
        setZoom(zoomFromPinch(pinchGesture.zoom * 100, pinchGesture.distance, distance) / 100);
        event.preventDefault?.();
        return;
      }
    }
    if (drag && drag.pointerId === event.pointerId) {
      const dx = event.clientX - drag.lastX, dy = event.clientY - drag.lastY;
      drag.lastX = event.clientX; drag.lastY = event.clientY;
      if (dragModeForZoom(zoom * 100) === 'rotate') {
        rotation += dx * 0.006;
        applySurfaceOrientation(1 - atlasPresentationState(zoom, motionReduced).state.lift);
      } else {
        const delta = panDeltaForDrag(dx, dy, {
          cameraDistance: liveCameraDistance, fovDegrees: camera.fov,
          viewportHeight: renderer.domElement.getBoundingClientRect().height,
        });
        panOffset.x += delta.x; panOffset.y += delta.y;
      }
      applyZoom(zoom, false);
      if (event.pointerType === 'touch') event.preventDefault?.();
      return;
    }
    const pagedClusterHit = hitPagedClusterCandidate(event);
    let reference = null, chipHit = null, cluster = null, world = null;
    if (pagedClusterHit) {
      const target = nearestPagedPointerTarget(event, pagedClusterHit);
      if (target?.kind === 'present') reference = target;
      else if (target?.kind === 'question') chipHit = target;
      else if (target?.kind === 'cluster') cluster = target.cluster;
      else if (target?.kind === 'world') world = target.world;
    } else {
      reference = hitPresentEarth(event);
      chipHit = reference ? null : hitQuestionChip(event);
      cluster = reference || chipHit ? null : hitCluster(event);
      world = reference || chipHit || cluster ? null : hitWorld(event);
    }
    const id = world ? stableWorldId(world) : null;
    if (cluster?.id) {
      if (needsPagedClusterPicker(cluster)) largeClusterPicker?.preview(cluster.id);
      else largeClusterPicker?.preview(null);
      if (!needsPagedClusterPicker(cluster) && cluster.id !== hoveredClusterId) {
        openClusterFan(cluster);
      }
    } else {
      largeClusterPicker?.preview(null);
      if (hoveredClusterId && !containsFanRegion({ x: event.clientX, y: event.clientY }, fanRegion)) closeClusterFan();
    }
    if (chipHit) {
      const question = questionForChip(chipHit.chip), questionId = String(question.id);
      const questionChanged = hoveredQuestionId !== questionId || hoveredId != null || hoveredReference;
      if (hoveredId || hoveredReference) setFocusedWorld(null, null);
      onQuestionPreview(question, questionAnchor(question, 'pointer', event.clientX, event.clientY, chipHit.x, chipHit.y));
      hoveredQuestionId = questionId; hoveredReference = false; hoveredId = null;
      renderer.domElement.dataset.focusedQuestionId = questionId; container.dataset.focusedQuestionId = questionId;
      if (questionChanged) applyZoom(zoom, false);
    } else {
      const hadQuestion = Boolean(hoveredQuestionId);
      if (hoveredQuestionId) onQuestionPreview(null, null);
      hoveredQuestionId = null; renderer.domElement.dataset.focusedQuestionId = ''; container.dataset.focusedQuestionId = '';
      if (hadQuestion) applyZoom(zoom, false);
    }
    if (reference) {
      if (hoveredId) setFocusedWorld(null, null);
      hoveredReference = true; hoveredId = 'present-day-earth';
      renderer.domElement.dataset.focusedWorldId = 'present-day-earth'; renderer.domElement.dataset.previewWorldId = 'present-day-earth';
      container.dataset.focusedWorldId = 'present-day-earth'; container.dataset.previewWorldId = 'present-day-earth';
      onPreview(virtualPresentEarth(), { source: 'pointer', worldId: 'present-day-earth', clientX: event.clientX, clientY: event.clientY });
      applyZoom(zoom, false);
    } else if (id !== hoveredId || hoveredReference) {
      hoveredReference = false;
      setFocusedWorld(world, world ? projectedAnchor(id, 'pointer', event.clientX, event.clientY) : null);
    } else if (world) {
      setFocusedWorld(world, projectedAnchor(id, 'pointer', event.clientX, event.clientY));
    }
  });
  listen(renderer.domElement, 'pointerup', event => {
    if (event.pointerType === 'touch') activePointers.delete(event.pointerId);
    if (pinchGesture) { pinchGesture = null; drag = null; return; }
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    drag = null;
    if (moved < 5) {
      const pagedClusterHit = hitPagedClusterCandidate(event);
      if (pagedClusterHit) {
        const target = nearestPagedPointerTarget(event, pagedClusterHit, { activation: true });
        if (target?.kind === 'cluster') {
          if (needsPagedClusterPicker(target.cluster)) largeClusterPicker?.open(target.cluster.id, { focus: true });
          else {
            openClusterFan(target.cluster);
            setZoom(target.cluster.level === 'surface' ? Math.max(zoom, 0.3) : Math.max(zoom, 0.68));
          }
          return;
        }
        if (target?.kind === 'world' && target.world) {
          explicitEnter(target.world, projectedAnchor(stableWorldId(target.world), 'pointer', event.clientX, event.clientY));
          return;
        }
        if (target?.kind === 'question') {
          expandQuestionChip(target.chip, questionAnchor(questionForChip(target.chip), 'pointer', event.clientX, event.clientY, target.x, target.y));
          return;
        }
        if (target?.kind === 'present' && target.world) {
          onEnter(target.world, { source: 'pointer', worldId: 'present-day-earth', clientX: event.clientX, clientY: event.clientY });
          return;
        }
      }
      const chipHit = hitQuestionChip(event);
      if (chipHit) {
        expandQuestionChip(chipHit.chip, questionAnchor(questionForChip(chipHit.chip), 'pointer', event.clientX, event.clientY, chipHit.x, chipHit.y));
        return;
      }
      if (hitPresentEarth(event)) {
        onEnter(virtualPresentEarth(), { source: 'pointer', worldId: 'present-day-earth', clientX: event.clientX, clientY: event.clientY });
        return;
      }
      const cluster = hitCluster(event);
      if (cluster?.selectable) {
        if (needsPagedClusterPicker(cluster)) {
          largeClusterPicker?.open(cluster.id, { focus: true });
          return;
        }
        if (cluster.id !== hoveredClusterId) openClusterFan(cluster);
        setZoom(cluster.level === 'surface' ? Math.max(zoom, 0.3) : Math.max(zoom, 0.68));
        return;
      }
      const world = hitWorld(event);
      if (world) explicitEnter(world, projectedAnchor(stableWorldId(world), 'pointer', event.clientX, event.clientY));
    }
  });
  listen(renderer.domElement, 'pointercancel', event => {
    if (event.pointerType === 'touch') activePointers.delete(event.pointerId);
    pinchGesture = null; drag = null;
  });
  listen(renderer.domElement, 'pointerleave', () => {
    closeClusterFan();
    largeClusterPicker?.preview(null);
    if (hoveredId) setFocusedWorld(null, null);
    if (hoveredQuestionId) onQuestionPreview(null, null);
    hoveredQuestionId = null; hoveredReference = false;
    renderer.domElement.dataset.focusedQuestionId = ''; container.dataset.focusedQuestionId = '';
    applyZoom(zoom, false);
  });
  listen(renderer.domElement, 'wheel', event => {
    event.preventDefault();
    setZoom(zoomFromWheel(zoom * 100, event.deltaY, { deltaMode: event.deltaMode, viewportHeight: renderer.domElement.clientHeight }) / 100);
  }, { passive: false });
  listen(renderer.domElement, 'keydown', event => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoom - 0.035); }
    else if (event.key === '-' || event.key === '_') { event.preventDefault(); setZoom(zoom + 0.035); }
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const next = neighborForKey(event.key);
      if (next) {
        if (hoveredQuestionId) onQuestionPreview(null, null);
        hoveredQuestionId = null; renderer.domElement.dataset.focusedQuestionId = ''; container.dataset.focusedQuestionId = '';
        const world = next.world;
        setFocusedWorld(world, projectedAnchor(next.id, 'keyboard'));
      } else if (event.key === 'ArrowRight' && atlasPresentationState(zoom, motionReduced).state.atlas > 0.5 && p2Renderer.presentEarth.visible) {
        if (hoveredQuestionId) onQuestionPreview(null, null);
        hoveredQuestionId = null; renderer.domElement.dataset.focusedQuestionId = ''; container.dataset.focusedQuestionId = '';
        const reference = virtualPresentEarth();
        hoveredReference = true; hoveredId = reference.id; hoveredQuestionId = null;
        renderer.domElement.dataset.focusedWorldId = reference.id; renderer.domElement.dataset.previewWorldId = reference.id;
        container.dataset.focusedWorldId = reference.id; container.dataset.previewWorldId = reference.id;
        onPreview(reference, { source: 'keyboard', worldId: reference.id });
        applyZoom(zoom, false);
      }
    } else if (event.key === 'Enter' && hoveredQuestionId) {
      const chip = atlasTimeline?.chips?.find(item => String(item.questionId) === hoveredQuestionId);
      if (chip) expandQuestionChip(chip, questionAnchor(questionForChip(chip), 'keyboard'));
    } else if (event.key === 'Enter' && hoveredReference) {
      onEnter(virtualPresentEarth(), { source: 'keyboard', worldId: 'present-day-earth' });
    } else if (event.key === 'Enter' && hoveredId) {
      const world = worlds.find(item => stableWorldId(item) === hoveredId);
      if (world) explicitEnter(world, projectedAnchor(hoveredId, 'keyboard'));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (zoom < 1) setZoom(Math.min(1, zoom + 0.1));
      else if (hoveredId) setFocusedWorld(null, null);
      else if (hoveredQuestionId) { onQuestionPreview(null, null); hoveredQuestionId = null; applyZoom(zoom, false); }
    }
  });

  let resizeLayoutTimer = null;
  const resize = () => {
    if (disposed || !container.clientWidth || !container.clientHeight) return;
    const width = container.clientWidth, height = container.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    updateLayout();
    applyZoom(zoom, false);
    if (atlasTimeline) {
      clearTimeout(resizeLayoutTimer);
      resizeLayoutTimer = setTimeout(() => {
        if (!disposed) { refreshAtlasTimeline(); applyZoom(zoom, false); }
      }, 180);
    }
  };
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  observer?.observe(container); resize();

  function animate(timestamp) {
    if (disposed) return;
    raf = requestAnimationFrame(animate);
    const sphereCount = worldSphereCounts().realWorldSpheres;
    renderer.domElement.dataset.realWorldSpheres = String(sphereCount);
    container.dataset.realWorldSpheres = String(sphereCount);
    renderer.domElement.dataset.currentWorldId = currentId || '';
    renderer.domElement.dataset.travelState = String(Boolean(travelState));
    renderer.domElement.dataset.goldEdgeSegments = String(renderedGoldEdgeSegmentCount());
    renderer.domElement.dataset.lineageWorldIds = JSON.stringify(atlasTimeline?.lineageIds || []);
    container.dataset.currentWorldId = currentId || '';
    container.dataset.travelState = String(Boolean(travelState));
    container.dataset.goldEdgeSegments = String(renderedGoldEdgeSegmentCount());
    container.dataset.lineageWorldIds = JSON.stringify(atlasTimeline?.lineageIds || []);
    if (travelState) {
      const stateNow = travelSample(timestamp);
      if (travelState.cut) {
        travelOpacity = cutTravelOpacity(stateNow.progress);
        updateCanvasOpacity();
        if (!travelState.cutSwitched && stateNow.progress >= 0.5) {
          const arriving = worlds.find(world => stableWorldId(world) === travelState.toId);
          arrivalFromId = arrivalParentWorldId(arriving, worlds);
          currentId = travelState.toId; travelState.cutSwitched = true;
          updateLayout({ animateQuestionRefocus: true, timestamp }); drawCurrentMarker();
        }
        if (!travelState.zoomOverridden) applyZoom(travelZoomAt(travelState.fromZoom, travelState.toZoom, stateNow.progress, 0.68, 'cut'), false, timestamp);
        else applyZoom(zoom, false, timestamp);
      } else {
        travelOpacity = 1;
        updateCanvasOpacity();
        if (!travelState.zoomOverridden) applyZoom(travelZoomAt(travelState.fromZoom, travelState.toZoom, stateNow.progress), false, timestamp);
        else applyZoom(zoom, false, timestamp);
      }
    }
    if (travelState && timestamp - travelState.startedAt >= travelState.duration) {
      const arriving = worlds.find(world => stableWorldId(world) === travelState.toId);
      arrivalFromId = arrivalParentWorldId(arriving, worlds);
      const finalZoom = travelState.zoomOverridden ? zoom : travelState.toZoom;
      currentId = travelState.toId;
      travelState = null;
      travelOpacity = 1; updateCanvasOpacity();
      updateLayout({ animateQuestionRefocus: true, timestamp }); drawCurrentMarker();
      applyZoom(finalZoom, false, timestamp);
    }
    if (axisTransition) {
      applyZoom(zoom, false, timestamp);
      if (timestamp - axisTransition.startedAt >= AXIS_ANIMATION_MS) {
        axisTransition = null;
        applyZoom(zoom, false, timestamp);
      }
    } else if (!travelState) applySurfaceOrientation(1 - atlasPresentationState(zoom, motionReduced).state.lift, timestamp);
    renderer.render(scene, camera);
    const level = stageForZoom(zoom);
    const frameWindow = appendContinuousFrame(stageFrameWindow, stageFrameLevel, level, timestamp);
    stageFrameLevel = frameWindow.level; stageFrameWindow = frameWindow.frames;
    if (timestamp - lastMetricAt >= 1200) {
      lastMetricAt = timestamp;
      const fps = measuredFps(stageFrameWindow);
      const samples = stageFps.get(level) || [];
      samples.push(fps); if (samples.length > 20) samples.shift(); stageFps.set(level, samples);
      onMetrics({ fps, level, samples: [...samples], zoom, altitude: liveCameraDistance, axisMode, focusedWorldId: hoveredId, previewWorldId: hoveredId, ...getDebugStats(), source: 'requestAnimationFrame timestamps' });
    }
  }
  raf = requestAnimationFrame(animate);

  return {
    setWorlds,
    setGeography,
    enterWorld,
    setZoom,
    getZoom,
    getLevel: () => stageForZoom(zoom),
    getDebugStats,
    getWorldObject: id => registry.get(id)?.object ?? null,
    getOrbitQuestionTargets: () => orbitQuestionParent.visible && orbitQuestionParentQuestion
      ? [{ questionId: String(orbitQuestionParentQuestion.id), question: orbitQuestionParentQuestion, object: orbitQuestionParent }]
      : [],
    getCurrentWorldId: () => currentId,
    getFocusedWorldId: () => hoveredId,
    getWorldImageUrl,
    setAxisMode,
    getAxisMode,
    setTravelMode,
    getTravelMode,
    setGhostTrail,
    getGhostTrail,
    setSurfaceLabelLevel,
    setOrbitLevel,
    getLevelOptions: () => ({ min: 0, max: ATLAS_LEVEL_MAX, surfaceDefault: clampAtlasLevel(surfaceLabelLevel), orbitDefault: clampAtlasLevel(orbitLevel, ORBIT_UNFOLDED_LEVEL) }),
    destroy() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(raf); clearTimeout(resizeLayoutTimer); observer?.disconnect();
      for (const remove of domListeners) remove();
      largeClusterPicker?.destroy();
      worldTextureFactory.dispose();
      registry.clear();
      scene.traverse(object => {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) { material?.map?.dispose?.(); material?.dispose?.(); }
      });
      auxiliaryLabels.clear(); orbitLabelLanes.clear(); orbitLaneContents.clear(); orbitChildLabelButtons.clear(); orbitLeaderElements.clear(); orbitFallbackSection?.remove();
      if (orbitFallbackTreeHintOriginal) {
        const treeButton = labelDocument.querySelector?.('#atlas-show-tree');
        if (treeButton) {
          treeButton.textContent = orbitFallbackTreeHintOriginal.text;
          if (orbitFallbackTreeHintOriginal.title == null) treeButton.removeAttribute('title');
          else treeButton.setAttribute('title', orbitFallbackTreeHintOriginal.title);
          if (orbitFallbackTreeHintOriginal.ariaLabel == null) treeButton.removeAttribute('aria-label');
          else treeButton.setAttribute('aria-label', orbitFallbackTreeHintOriginal.ariaLabel);
        }
      }
      labelOverlay.remove();
      goldEdgeGeometry.dispose();
      unenteredOutlineTexture.dispose(); currentEarthTexture.dispose(); miniEarthTexture.dispose(); earthTexture.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
