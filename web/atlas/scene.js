import * as THREE from 'three';
import { defaultWorldImageUrl } from './imageRefs.js';
import { createWorldTextureFactory } from './worldTextures.js';
import { planWorldClusters } from './clusters.js';
import { containsFanRegion, createFanHitRegion, fanMemberOffsets } from './screenLayout.js';
import { createAtlasP2Renderer } from './p2Renderer.js';
import {
  GHOST_TRAIL_DEFAULT, arrivalParentWorldId, cutTravelOpacity, interpolateTravelPoint, preservesTravelSource, smoothTravelProgress, travelZoomAt,
  lineageTravelPath, sampleLineagePath, travelDuration,
} from './p3Travel.js';
import {
  ATLAS_REAL_SPHERE_LIMIT, AXIS_ANIMATION_MS, AXIS_MODES, PRESENT_DAY_REFERENCE,
  axisTransitionProgress, buildAtlasTimeline, interpolateAtlasPoint, planQuestionRootConnections,
} from './p2Atlas.js';
import {
  ATLAS_LEVEL_MAX, ORBIT_UNFOLDED_LEVEL, SURFACE_LABEL_LEVEL,
  ATLAS_PIN_GEOMETRY_RADIUS, surfacePinAnchorRadius,
  pinScaleAtPresentation, pinAnchorRadiusAtPresentation,
  altitudeForZoom, atlasPresentationState, atlasZoomState, clampAtlasLevel, createWorldRegistry,
  layoutAtlasWorlds, layoutOrbitNeighborhood, measuredFps, surfaceFacingRotation,
  worldRadiusForScreenPixels, nearestDirectionalNeighbor, selectSurfaceWorldLabelIds, slerpUnitVector,
  cappedTextureSize, allowEarthBodySelection, fitCameraDistance,
  appendContinuousFrame, stableWorldId, clampScreenRectCenter, isSurfaceNormalVisible,
} from '../atlasLayout.js';

const GOLD = new THREE.Color('#d5a85c');
const CYAN = new THREE.Color('#55c9e9');
const PARCHMENT = new THREE.Color('#eadfca');
const MUTED = new THREE.Color('#65818a');
const LIT_TINT = new THREE.Color('#ffffff');
const MAX_SPHERE_INSTANCES = ATLAS_REAL_SPHERE_LIMIT;
const MAX_GOLD_EDGE_SEGMENTS = 256;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const DIM_UNENTERED = new THREE.Color('#4d6870');
const LIT_EARTH = new THREE.Color('#e6e0ce');

function worldColor(entry, currentId) {
  const world = entry.world || {};
  const kind = `${world.kind || ''} ${world.type || ''} ${world.tokenType || ''} ${world.theme || ''}`.toLowerCase();
  if (entry.id === currentId || entry.lineage) return GOLD;
  if (/question|chronos|time.?token/.test(kind)) return PARCHMENT;
  if (entry.explored) return LIT_EARTH;
  if (!entry.explored) return CYAN.clone().lerp(DIM_UNENTERED, 0.58);
  return entry.child || entry.sibling || world.proposed !== false ? CYAN : MUTED;
}

function geographyPoint(entry, radius = 1) {
  return new THREE.Vector3(entry.globe.x, entry.globe.y, entry.globe.z).multiplyScalar(radius);
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

function createWorldLabel(world, isCurrent = false, isArrivedFrom = false) {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(4, 14, 19, 0.88)';
  context.beginPath(); context.roundRect(2, 2, 636, 124, 20); context.fill();
  context.strokeStyle = isCurrent ? 'rgba(213, 168, 92, 0.88)' : 'rgba(155, 208, 221, 0.44)'; context.lineWidth = 3; context.stroke();
  context.fillStyle = '#f2ead9'; context.font = '600 40px "Cormorant Garamond", Georgia, serif';
  const title = String(world.title || 'Untitled possibility').slice(0, 38);
  context.fillText(title, 20, 57, 598);
  context.fillStyle = isCurrent ? '#efce8b' : '#9cc7d5'; context.font = '22px Inter, system-ui, sans-serif';
  const year = world.year == null ? 'Undated possibility' : String(world.year);
  context.fillText(isCurrent ? `YOU ARE HERE · ${year}` : isArrivedFrom ? `ARRIVED FROM · ${year}` : year, 20, 99, 598);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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

  scene.add(new THREE.HemisphereLight(0xc5e7ed, 0x102027, 1.55));
  const key = new THREE.DirectionalLight(0xfff1d2, 2.1);
  key.position.set(-3, 5, 7); scene.add(key);
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
  const worldTextureFactory = createWorldTextureFactory({
    onEvict: result => {
      const texture = miniTextureByWorldId.get(result.worldId);
      if (texture) { texture.dispose(); miniTextureByWorldId.delete(result.worldId); }
    },
  });
  const unenteredOutlineTexture = createDashedOutlineTexture();
  let basemapImage = null;
  let currentTextureUsesGeography = false;
  const earthTexture = new THREE.TextureLoader().load(basemapUrl, image => {
    basemapImage = cappedTextureImage(image.image, 2048);
    earthTexture.image = basemapImage; earthTexture.needsUpdate = true;
    miniEarthTexture.image = cappedTextureImage(basemapImage, 512); miniEarthTexture.needsUpdate = true;
    p2Renderer.setBaseTexture(earthTexture);
    updateLayout(); drawCurrentMarker(); applyZoom(zoom, false);
  });
  earthTexture.colorSpace = THREE.SRGBColorSpace;
  const earthMaterial = new THREE.MeshStandardMaterial({ map: currentEarthTexture, roughness: 0.94, metalness: 0.02 });
  const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
  earthMesh.userData.worldId = null;
  atlasGroup.add(earthMesh);
  const currentRing = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.055, 10, 64),
    new THREE.MeshBasicMaterial({ color: '#d5a85c', transparent: true, opacity: 0, depthWrite: false }),
  );
  currentRing.name = 'Current world gold ring'; currentRing.visible = false; atlasGroup.add(currentRing);
  const p2Renderer = createAtlasP2Renderer(scene, { earthGeometry, earthMaterial });
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
  const pointMaterial = new THREE.PointsMaterial({ size: 4.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false });
  const lodPoints = new THREE.Points(pointGeometry, pointMaterial);
  lodPoints.frustumCulled = false; atlasGroup.add(lodPoints);

  const threadGeometry = new THREE.BufferGeometry();
  const threadMaterial = new THREE.LineDashedMaterial({ color: '#57c9e7', dashSize: 0.075, gapSize: 0.055, transparent: true, opacity: 0.8 });
  const threads = new THREE.LineSegments(threadGeometry, threadMaterial);
  threads.frustumCulled = false; atlasGroup.add(threads);
  const lineageThreads = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#d5a85c', transparent: true, opacity: 0.9, depthWrite: false }));
  lineageThreads.name = 'Gold current lineage edges'; lineageThreads.frustumCulled = false; atlasGroup.add(lineageThreads);
  const goldEdgeMeshes = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1, 1, 6, 1, false),
    new THREE.MeshBasicMaterial({ color: '#d5a85c', transparent: true, opacity: 0.9, depthWrite: false }),
    MAX_GOLD_EDGE_SEGMENTS,
  );
  goldEdgeMeshes.name = 'Thick continuous gold lineage ribbons'; goldEdgeMeshes.count = 0;
  goldEdgeMeshes.instanceMatrix.setUsage(THREE.DynamicDrawUsage); goldEdgeMeshes.frustumCulled = false; atlasGroup.add(goldEdgeMeshes);
  const questionThreads = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#eadfca', dashSize: 0.09, gapSize: 0.055, transparent: true, opacity: 0.84, depthWrite: false }));
  questionThreads.name = 'Parchment authored question edges'; questionThreads.frustumCulled = false; atlasGroup.add(questionThreads);

  const registry = createWorldRegistry();
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.055;
  const pointer = new THREE.Vector2();
  const dummy = new THREE.Object3D();
  const goldCylinderUp = new THREE.Vector3(0, 1, 0);
  const goldSegmentStart = new THREE.Vector3(), goldSegmentEnd = new THREE.Vector3(), goldSegmentDirection = new THREE.Vector3();
  const goldSegmentWorldMidpoint = new THREE.Vector3(), goldCameraWorldPosition = new THREE.Vector3();
  const instanceIds = [], lodIds = [];
  const lodIdSet = new Set();
  const stageFps = new Map();
  const domListeners = [];
  let worlds = [], questions = [], entries = [], currentId = null, arrivalFromId = null, zoom = 0, rotation = 0;
  let surfaceFacingAngle = 0;
  let orbitNeighborhoodIds = new Set();
  let liveCameraDistance = altitudeForZoom(zoom);
  let clusterPlan = { surface: { visibleIds: [], clusters: [] }, orbit: { visibleIds: [], clusters: [] } };
  const clusterSprites = new Map();
  let axisMode = 'history-distance', atlasTimeline = null, axisTransition = null;
  let travelMode = motionReduced ? 'cut' : 'threads', travelState = null, ghostTrail = GHOST_TRAIL_DEFAULT;
  let travelOpacity = 1, axisFadeOpacity = 1, reducedMotionOpacity = 1;
  let surfaceLabelsLevel = clampAtlasLevel(surfaceLabelLevel), orbitUnfoldLevel = clampAtlasLevel(orbitLevel, ORBIT_UNFOLDED_LEVEL);
  let hoveredId = null, hoveredQuestionId = null, hoveredReference = false, hoveredClusterId = null, disposed = false, lastMetricAt = 0, lastLevel = '', raf = 0;
  const expandedQuestionIds = new Set();
  let fanOffsets = new Map(), fanRegion = null;
  let stageFrameLevel = '', stageFrameWindow = [];
  let drag = null;

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
    atlasTimeline = buildAtlasTimeline(graphSnapshot(), currentId, axisMode, { expandedQuestionIds: [...expandedQuestionIds] });
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
    const surface = geographyPoint(entry, radius).add(earthMesh.position);
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

  function travelFacingAngle(timestamp) {
    const sample = travelSample(timestamp)?.segment;
    const from = entries.find(entry => entry.id === sample?.fromId);
    const to = entries.find(entry => entry.id === sample?.toId);
    if (!from || !to) return surfaceFacingAngle;
    const a = surfaceFacingRotation(from.globe), b = surfaceFacingRotation(to.globe);
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + delta * sample.progress;
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
    return fitCameraDistance(atlasFrameBounds(), camera.aspect, camera.fov, 1.08);
  }

  function worldScenarioTexture(world) {
    const raw = world?.geography ?? world?.geog;
    if (raw == null || (raw.version === 1 && Array.isArray(raw.changes) && raw.changes.length === 0)) return null;
    return worldTextureFactory.create(world, { baseImage: basemapImage, baseIdentity: basemapUrl });
  }

  function miniTextureForWorld(world) {
    const result = worldScenarioTexture(world);
    if (result?.status !== 'ready' || result.geography?.version !== 1 || !result.geography.changes.length) return miniEarthTexture;
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
    currentTextureUsesGeography = geographyTexture?.status === 'ready' && geographyTexture.geography?.version === 1 && geographyTexture.geography.changes.length > 0;
    const source = currentTextureUsesGeography
      ? geographyTexture.currentCanvas : basemapImage;
    const canvas = document.createElement('canvas');
    canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext('2d'); context.drawImage(source, 0, 0);
    if (Number.isFinite(Number(current.world.lat)) && Number.isFinite(Number(current.world.lon))) {
      const x = ((Number(current.world.lon) + 180) / 360) * canvas.width;
      const y = ((90 - Number(current.world.lat)) / 180) * canvas.height;
      const radius = Math.max(2, canvas.width * 0.0008);
      context.beginPath(); context.arc(x, y, radius * 2, 0, Math.PI * 2); context.fillStyle = '#d5a85c'; context.globalAlpha = 0.9; context.fill();
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fillStyle = '#f5dfae'; context.globalAlpha = 1; context.fill();
    }
    currentEarthTexture.image = canvas; currentEarthTexture.needsUpdate = true;
  }

  function disposeWorldRecord(record) {
    if (!record) return;
    if (record.label) {
      atlasGroup.remove(record.label);
      record.label.material.map?.dispose(); record.label.material.dispose();
    }
    if (record.disc) {
      atlasGroup.remove(record.disc);
      record.disc.material.map?.dispose(); record.disc.material.dispose();
    }
    if (record.unenteredOutline) { atlasGroup.remove(record.unenteredOutline); record.unenteredOutline.material.dispose(); }
  }

  function updateLayout() {
    entries = layoutAtlasWorlds(worlds, currentId);
    const orbitPositions = layoutOrbitNeighborhood(entries, currentId);
    for (const entry of entries) entry.orbit = orbitPositions.get(entry.id) || entry.atlas;
    const parentIds = new Set(worlds.filter(world => world.parentId != null).map(world => String(world.parentId)));
    for (const entry of entries) entry.explored = entry.world.explored === true || entry.world.hasChildren === true || parentIds.has(entry.id) || entry.world.mapState === 'explored' || entry.world.status === 'explored';
    const current = currentEntry();
    surfaceFacingAngle = surfaceFacingRotation(current?.globe);
    earthMesh.userData.worldId = current?.id ?? null;
    const record = current && registry.get(current.id);
    if (record) record.object = earthMesh;
    const surfaceLabels = selectSurfaceWorldLabelIds(worlds, currentId, surfaceLabelsLevel, arrivalFromId, ghostTrail ? ancestorIds(currentId) : []);
    clusterPlan = planWorldClusters(worlds, currentId, { surfaceLabelLevel: surfaceLabelsLevel, orbitLevel: orbitUnfoldLevel, hoveredClusterId });
    const neighborhoodIds = new Set([
      currentId,
      ...(current?.parentId != null ? [current.parentId] : []),
      ...entries.filter(entry => entry.id !== currentId && entry.parentId === current?.parentId).map(entry => entry.id),
      ...entries.filter(entry => entry.parentId === currentId).map(entry => entry.id),
    ].filter(Boolean));
    orbitNeighborhoodIds = neighborhoodIds;
    const plannedOrbit = new Set(clusterPlan.orbit.visibleIds);
    const visibleOrbit = new Set([...plannedOrbit].filter(id => neighborhoodIds.has(id)));
    if (currentId) visibleOrbit.add(currentId);
    if (current?.parentId != null) visibleOrbit.add(String(current.parentId));
    const visibleSurface = new Set(clusterPlan.surface.visibleIds);
    for (const entry of entries) {
      const worldRecord = registry.get(entry.id);
      if (worldRecord) {
        worldRecord.object = entry.id === currentId ? earthMesh : null;
        const isCurrent = entry.id === currentId, isArrival = entry.id === arrivalFromId;
        const labelKey = `${entry.id}|${entry.world.title || ''}|${entry.world.year ?? ''}|${isCurrent ? 'current' : isArrival ? 'arrival' : 'world'}`;
        if (!worldRecord.label) {
          const texture = createWorldLabel(entry.world, isCurrent, isArrival);
          // Horizon visibility is handled at the geographic anchor; the billboard must
          // stay readable rather than intersecting the curved surface while panning.
          const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
          worldRecord.label = new THREE.Sprite(material);
          worldRecord.label.scale.set(0.3, 0.05, 1);
          worldRecord.label.userData.labelKey = labelKey;
          atlasGroup.add(worldRecord.label);
        } else if (worldRecord.label.material.map && worldRecord.label.userData.labelKey !== labelKey) {
          worldRecord.label.material.map.dispose();
          worldRecord.label.material.map = createWorldLabel(entry.world, isCurrent, isArrival);
          worldRecord.label.material.needsUpdate = true;
          worldRecord.label.userData.labelKey = labelKey;
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
      if (!entry.explored && entry.world.selectable !== false) {
        if (!worldRecord.unenteredOutline) {
          const material = new THREE.SpriteMaterial({ map: unenteredOutlineTexture, color: '#87d9ed', transparent: true, depthWrite: false, opacity: 0 });
          worldRecord.unenteredOutline = new THREE.Sprite(material); worldRecord.unenteredOutline.name = 'Dim unentered world dashed outline';
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

    const childEntries = entries.filter(entry => entry.child && entry.id !== currentId);
    const linePositions = new Float32Array(childEntries.length * 6);
    const layoutState = atlasPresentationState(zoom, motionReduced).state;
    const layoutMarkerRadius = pinAnchorRadiusAtPresentation(surfaceEarthRadius(layoutState), layoutState.lift, layoutState.atlas);
    childEntries.forEach((entry, index) => {
      const from = geographyPoint(entry, layoutMarkerRadius).add(earthMesh.position);
      const to = new THREE.Vector3(entry.orbit.x, entry.orbit.y, entry.orbit.z);
      from.lerp(to, layoutState.lift);
      const selected = current ? new THREE.Vector3(current.orbit.x, current.orbit.y, current.orbit.z) : new THREE.Vector3(0, 0, 0);
      selected.lerp(geographyPoint(current || entry, surfaceEarthRadius(layoutState)).add(earthMesh.position), 1 - layoutState.lift);
      selected.toArray(linePositions, index * 6);
      to.toArray(linePositions, index * 6 + 3);
    });
    threadGeometry.dispose();
    const nextThreadGeometry = new THREE.BufferGeometry();
    nextThreadGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    nextThreadGeometry.computeBoundingSphere();
    threads.geometry = nextThreadGeometry; threads.computeLineDistances();
    refreshAtlasTimeline();
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


  function applyZoom(value, announce = true, timestamp = performance.now()) {
    zoom = clamp(Number(value) || 0, 0, 1);
    const presentation = atlasPresentationState(zoom, motionReduced);
    const state = presentation.state;
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
    atlasGroup.rotation.y = (((travelState && !travelState.cut) ? travelFacingAngle(timestamp) : surfaceFacingAngle) + rotation) * (1 - state.lift);
    atlasGroup.updateMatrixWorld(true);
    const frame = atlasFrameBounds();
    const atlasCenter = new THREE.Vector3((frame.left + frame.right) / 2, (frame.bottom + frame.top) / 2, 0);
    const cameraFocus = travelState && !travelState.cut ? earthMesh.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3().lerp(atlasCenter, state.atlas);
    liveCameraDistance = state.cameraDistance + (fittedAtlasDistance() - state.cameraDistance) * state.atlas;
    camera.position.set(cameraFocus.x, cameraFocus.y, cameraFocus.z + liveCameraDistance);
    camera.lookAt(cameraFocus);

    const folded = new Set(atlasTimeline?.foldedIds || []);
    const realSphereIds = new Set(atlasTimeline?.realSphereIds || []);
    const travellingIds = new Set(travelState?.pathIds || []);
    const atlasSettled = state.atlas >= 0.98;
    const clusteredIds = new Set((clusterPlan.orbit.clusteredIds || []).filter(id => zoom >= 0.84 || orbitNeighborhoodIds.has(id)));
    const visibleEntries = entries.filter(entry => {
      if (travellingIds.has(entry.id) || (atlasSettled && folded.has(entry.id)) || clusteredIds.has(entry.id)) return false;
      if (state.surface > 0.15 && zoom < 0.57) return entry.surfaceVisible;
      if (state.orbit > 0.15 && zoom < 0.84) return entry.orbitVisible;
      return true;
    });
    const sphereLimit = Math.max(0, MAX_SPHERE_INSTANCES - 1); // Reserve one of 24 world spheres for the single current Earth mesh.
    const instanceEntries = visibleEntries.filter(entry => entry.id !== currentId && (state.atlas < 0.45 || realSphereIds.has(entry.id)))
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
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(entry.globe.x, entry.globe.y, entry.globe.z).normalize());
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

    const lodEntries = visibleEntries.filter(entry => entry.id !== currentId && !instanceIds.includes(entry.id)
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
    const earthCenterWorld = earthMesh.getWorldPosition(new THREE.Vector3());
    const towardCamera = camera.getWorldPosition(new THREE.Vector3()).sub(earthCenterWorld);
    const surfaceHorizonThreshold = surfaceEarthRadius(state) / Math.max(surfaceEarthRadius(state), towardCamera.length()) + 0.005;
    towardCamera.normalize();
    const labelCandidates = [];
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
        const visibleOutline = Math.max(entry.surfaceVisible ? state.surface : 0, entry.orbitVisible ? Math.max(state.orbit, state.atlas) : 0);
        outline.material.opacity = visibleOutline * 0.92;
        const distance = outline.position.distanceTo(camera.position);
        const size = 2 * worldRadiusForScreenPixels(distance, camera.fov, Math.max(1, renderer.domElement.clientHeight), 30);
        outline.scale.set(size, size, 1);
      }
      const label = registry.get(entry.id)?.label;
      if (!label) continue;
      const surfacePosition = entry.id === arrivalFromId ? arrivalSurfacePoint()
        : geographyPoint(entry, surfaceEarthRadius(state)).add(earthMesh.position);
      const atlasPoint = atlasPosition(entry, timestamp);
      atlasPoint.x += 0.22; atlasPoint.y += 0.23;
      const orbitPoint = new THREE.Vector3(entry.orbit.x + 0.22, entry.orbit.y + 0.23, entry.orbit.z);
      const fanOffset = fanOffsets.get(entry.id);
      const labelOffset = { x: fanOffset?.x || 0, y: (fanOffset?.y || 0) - 22 };
      label.position.copy(withScreenOffset(surfacePosition.lerp(orbitPoint, state.lift).lerp(atlasPoint, state.atlas), labelOffset));
      const surfaceNormal = new THREE.Vector3(entry.globe.x, entry.globe.y, entry.globe.z).transformDirection(atlasGroup.matrixWorld);
      const surfaceHorizonVisible = entry.id === arrivalFromId || isSurfaceNormalVisible(surfaceNormal, towardCamera, surfaceHorizonThreshold);
      const surfaceOpacity = entry.surfaceLabel && surfaceHorizonVisible ? state.surface : 0;
      const orbitOpacity = entry.orbitVisible ? state.lift * (1 - state.atlas) * 0.9 : 0;
      const atlasOpacity = entry.atlasLabelVisible && !entry.folded ? state.atlas * 0.9 : 0;
      const opacity = Math.max(surfaceOpacity, orbitOpacity, atlasOpacity);
      label.material.opacity = opacity;
      if (opacity > 0.04) labelCandidates.push({ entry, label, opacity });
    }
    const labelBounds = renderer.domElement.getBoundingClientRect();
    const acceptedLabels = [];
    const labelPriority = entry => entry.id === currentId ? 100 : entry.id === arrivalFromId ? 90 : entry.lineage ? 70 : entry.child ? 60 : entry.sibling ? 50 : 0;
    labelCandidates.sort((a, b) => labelPriority(b.entry) - labelPriority(a.entry) || a.entry.id.localeCompare(b.entry.id));
    for (const { entry, label, opacity } of labelCandidates) {
      const basePosition = label.position.clone();
      const worldPosition = label.getWorldPosition(new THREE.Vector3());
      const distance = worldPosition.distanceTo(camera.getWorldPosition(new THREE.Vector3()));
      const width = 220, height = 36;
      label.scale.set(
        2 * worldRadiusForScreenPixels(distance, camera.fov, Math.max(1, labelBounds.height), width),
        2 * worldRadiusForScreenPixels(distance, camera.fov, Math.max(1, labelBounds.height), height),
        1,
      );
      const alternatives = entry.id === arrivalFromId
        ? [{ x: 0, y: 0 }, { x: 0, y: -44 }, { x: 52, y: 0 }, { x: -52, y: 0 }, { x: 0, y: 48 }]
        : [{ x: 0, y: 0 }];
      let placement = null;
      for (const offset of alternatives) {
        label.position.copy(withScreenOffset(basePosition.clone(), offset));
        const screen = label.getWorldPosition(new THREE.Vector3()).project(camera);
        const rawX = labelBounds.left + ((screen.x + 1) * 0.5) * labelBounds.width;
        const rawY = labelBounds.top + ((1 - screen.y) * 0.5) * labelBounds.height;
        const clamped = clampScreenRectCenter({ x: rawX, y: rawY }, labelBounds, width, height, 4);
        const shift = { x: clamped.x - rawX, y: clamped.y - rawY };
        if (shift.x || shift.y) label.position.copy(withScreenOffset(basePosition.clone(), { x: offset.x + shift.x, y: offset.y + shift.y }));
        const placedScreen = label.getWorldPosition(new THREE.Vector3()).project(camera);
        const x = labelBounds.left + ((placedScreen.x + 1) * 0.5) * labelBounds.width;
        const y = labelBounds.top + ((1 - placedScreen.y) * 0.5) * labelBounds.height;
        const candidate = { x, y, width, height };
        const inView = placedScreen.z >= -1 && placedScreen.z <= 1
          && x - width / 2 >= labelBounds.left + 3 && x + width / 2 <= labelBounds.right - 3
          && y - height / 2 >= labelBounds.top + 3 && y + height / 2 <= labelBounds.bottom - 3;
        const overlaps = acceptedLabels.some(other => Math.abs(other.x - x) < (other.width + width) / 2 && Math.abs(other.y - y) < (other.height + height) / 2);
        if (inView && !overlaps) { placement = candidate; break; }
      }
      label.material.opacity = placement ? opacity : 0;
      if (placement) acceptedLabels.push(placement);
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
      const visibleAlpha = cluster.level === 'surface'
        ? state.surface
        : Math.max(cluster.parentId === currentId ? state.orbit : 0, state.atlas * (cluster.kind === 'generation-pending' ? 0.85 : 1));
      sprite.material.opacity = visibleAlpha;
      const distance = sprite.position.distanceTo(camera.position);
      const diameter = cluster.level === 'surface' ? 48 : 58;
      const size = 2 * worldRadiusForScreenPixels(distance, camera.fov, Math.max(1, renderer.domElement.clientHeight), diameter);
      sprite.scale.set(size, size, 1);
    }
    const edgePositions = { lineage: [], proposed: [], question: [] };
    const edgeOpacity = { lineage: 0, proposed: 0, question: 0 };
    const allClusteredIds = new Set(clusterPlan.orbit.clusteredIds || []);
    const visibleAtlasIds = new Set(entries.filter(entry => !folded.has(entry.id) && !allClusteredIds.has(entry.id)).map(entry => entry.id));
    const lineageIds = new Set(atlasTimeline?.lineageIds || []);
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
      const alpha = Math.min(1,
        (onSurface ? state.surface : 0)
        + (inOrbit ? state.orbit : 0)
        + (inAtlas ? state.atlas : 0));
      if (alpha <= 0.015) continue;
      const childQuestion = questionById.get(String(child.world.questionId ?? ''));
      const isQuestionAttachment = String(childQuestion?.attachmentMode || childQuestion?.mode || '') === 'current-world'
        && String(childQuestion.parentWorldId ?? '') === parent.id;
      const kind = lineageIds.has(parent.id) && lineageIds.has(child.id) ? 'lineage'
        : (isQuestionAttachment || child.world.proposed === false || child.world.questionId !== parent.world.questionId || /question|chronos|time.?token/i.test(`${child.world.kind || ''} ${child.world.type || ''} ${child.world.tokenType || ''}`)) ? 'question'
          : 'proposed';
      edgeOpacity[kind] = Math.max(edgeOpacity[kind], alpha);
      const fromRadius = parent.id === currentId ? surfaceEarthRadius(state) : markerRadius;
      const from = worldPosition(parent, state, timestamp, fromRadius);
      const to = worldPosition(child, state, timestamp, markerRadius);
      const surfaceFrom = geographyPoint(parent, fromRadius).normalize();
      const surfaceTo = geographyPoint(child, markerRadius).normalize();
      const arcPoints = [];
      const segments = 10;
      for (let step = 0; step <= segments; step++) {
        const t = step / segments;
        const direction = slerpUnitVector(surfaceFrom, surfaceTo, t);
        const surfaceRadius = fromRadius + (markerRadius - fromRadius) * t;
        const arc = new THREE.Vector3(direction.x, direction.y, direction.z).multiplyScalar(surfaceRadius).add(earthMesh.position);
        const straight = from.clone().lerp(to, t);
        arc.lerp(straight, state.lift);
        arcPoints.push(arc);
      }
      const values = edgePositions[kind];
      for (let step = 0; step < segments; step++) {
        const a = arcPoints[step], b = arcPoints[step + 1];
        values.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const rootConnections = state.atlas > 0.015
      ? planQuestionRootConnections(worlds, atlasTimeline?.questionBranches || [], lineageIds)
        .filter(connection => !folded.has(connection.worldId) || connection.color === 'lineage')
      : [];
    for (const connection of rootConnections) {
      const root = entryById.get(connection.worldId);
      const branch = atlasTimeline?.questionBranches?.find(item => item.questionId === connection.questionId);
      if (!root || !branch) continue;
      let tokenX = branch.x, tokenY = branch.y;
      const prior = axisTransition?.fromTimeline?.questionBranches?.find(item => item.questionId === connection.questionId);
      if (prior) {
        const progress = axisTransitionProgress(timestamp - axisTransition.startedAt, AXIS_ANIMATION_MS);
        tokenX = prior.x + (branch.x - prior.x) * progress;
        tokenY = prior.y + (branch.y - prior.y) * progress;
      }
      const values = edgePositions[connection.color];
      const rootPoint = atlasPosition(root, timestamp);
      values.push(tokenX, tokenY, 0.06, rootPoint.x, rootPoint.y, rootPoint.z);
      edgeOpacity[connection.color] = Math.max(edgeOpacity[connection.color], state.atlas);
    }
    writePositionBuffer(threads, new Float32Array(edgePositions.proposed));
    writePositionBuffer(lineageThreads, new Float32Array(edgePositions.lineage));
    writePositionBuffer(questionThreads, new Float32Array(edgePositions.question));
    camera.updateMatrixWorld(true);
    camera.getWorldPosition(goldCameraWorldPosition);
    let goldSegmentCount = 0;
    const goldPositions = edgePositions.lineage;
    if (edgeOpacity.lineage > 0.015) {
      for (let offset = 0; offset + 5 < goldPositions.length && goldSegmentCount < MAX_GOLD_EDGE_SEGMENTS; offset += 6) {
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
        dummy.updateMatrix(); goldEdgeMeshes.setMatrixAt(goldSegmentCount++, dummy.matrix);
      }
    }
    goldEdgeMeshes.count = goldSegmentCount;
    goldEdgeMeshes.instanceMatrix.needsUpdate = true;
    goldEdgeMeshes.material.opacity = edgeOpacity.lineage;
    lineageThreads.visible = false;
    threads.computeLineDistances(); questionThreads.computeLineDistances();
    threads.material.opacity = 0.82 * edgeOpacity.proposed;
    lineageThreads.material.opacity = 0.9 * edgeOpacity.lineage;
    questionThreads.material.opacity = 0.84 * edgeOpacity.question;
    lodPoints.material.opacity = 0.92;
    instancedPins.material.transparent = true;
    instancedPins.material.opacity = 1;
    p2Renderer.update(atlasTimeline, {
      opacity: state.atlas,
      axisMode,
      branchProgress: axisTransition ? axisTransitionProgress(timestamp - axisTransition.startedAt, AXIS_ANIMATION_MS) : 1,
      fromBranches: axisTransition?.fromTimeline.questionBranches,
    });
    const labelViewport = renderer.domElement.getBoundingClientRect();
    p2Renderer.layoutLabels(camera, labelViewport, acceptedLabels);
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
    updateLayout(); drawCurrentMarker();
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
  function setAxisMode(mode) {
    if (!AXIS_MODES.includes(mode)) return false;
    if (mode === axisMode && !axisTransition) return true;
    if (motionReduced) {
      axisTransition = null; axisMode = mode; axisFadeOpacity = 0; updateCanvasOpacity();
      refreshAtlasTimeline(); applyZoom(zoom, false);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (disposed) return;
        axisFadeOpacity = 1; updateCanvasOpacity();
      }));
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
      goldEdgeSegments: goldEdgeMeshes.count,
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
    hoveredId = id;
    renderer.domElement.dataset.focusedWorldId = id || '';
    renderer.domElement.dataset.previewWorldId = id || '';
    container.dataset.focusedWorldId = id || '';
    container.dataset.previewWorldId = id || '';
    onPreview(world || null, anchor || null);
  }

  function neighborForKey(key) {
    const originId = hoveredId || currentId;
    const origin = entries.find(entry => entry.id === originId);
    if (!origin) return null;
    const neighborEntries = entries.filter(entry => entry.id !== origin.id && (
      entry.parentId === origin.id || origin.parentId === entry.id ||
      (origin.parentId != null && entry.parentId === origin.parentId)
    ));
    if (!neighborEntries.length) return null;
    const originAnchor = projectedAnchor(origin.id);
    const points = neighborEntries.map(entry => {
      const anchor = projectedAnchor(entry.id);
      return { id: entry.id, x: anchor.projectedX ?? originAnchor.projectedX ?? 0, y: anchor.projectedY ?? originAnchor.projectedY ?? 0, entry };
    });
    return nearestDirectionalNeighbor({ id: origin.id, x: originAnchor.projectedX ?? 0, y: originAnchor.projectedY ?? 0 }, points, key)?.entry || null;
  }

  function hitWorld(event) {
    const bounds = eventPoint(event);
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const state = atlasPresentationState(zoom, motionReduced).state;
    const currentEarthHit = raycaster.intersectObject(earthMesh, false)[0];
    const occlusionDistance = currentEarthHit?.distance ?? Number.POSITIVE_INFINITY;
    const candidates = new Set([...instanceIds, ...lodIds]);
    if (currentId && !allowEarthBodySelection(zoom)) candidates.add(currentId);
    const byId = new Map(worlds.map(world => [stableWorldId(world), world]));
    const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
    let best = null, bestDistance = Number.POSITIVE_INFINITY;
    for (const id of candidates) {
      const entry = entries.find(item => item.id === id);
      if (!entry) continue;
      const center = hitWorldPosition(entry, state).applyMatrix4(atlasGroup.matrixWorld);
      const cameraSpace = center.clone().applyMatrix4(camera.matrixWorldInverse);
      const viewDepth = -cameraSpace.z;
      if (viewDepth <= 0) continue;
      const radius = worldRadiusForScreenPixels(viewDepth, camera.fov, Math.max(1, bounds.height), 44);
      const point = raycaster.ray.intersectSphere(new THREE.Sphere(center, radius), new THREE.Vector3());
      if (!point) continue;
      const hitDistance = point.distanceTo(cameraPosition);
      if (state.surface > 0.15 && hitDistance >= occlusionDistance) continue;
      if (hitDistance < bestDistance) { best = byId.get(id) || null; bestDistance = hitDistance; }
    }
    if (best) return best;
    if (allowEarthBodySelection(zoom) && currentEarthHit && currentId) return byId.get(currentId) || null;
    return null;
  }

  function virtualPresentEarth() {
    return { ...PRESENT_DAY_REFERENCE };
  }
  function hitPresentEarth(event) {
    if (!p2Renderer.presentEarth.visible || atlasPresentationState(zoom, motionReduced).state.atlas <= 0.15) return false;
    eventPoint(event); scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const center = p2Renderer.presentEarth.getWorldPosition(new THREE.Vector3());
    const cameraSpace = center.clone().applyMatrix4(camera.matrixWorldInverse);
    const viewDepth = -cameraSpace.z;
    if (viewDepth <= 0) return false;
    const bounds = renderer.domElement.getBoundingClientRect();
    const radius = Math.max(0.36, worldRadiusForScreenPixels(viewDepth, camera.fov, Math.max(1, bounds.height), 44));
    return Boolean(raycaster.ray.intersectSphere(new THREE.Sphere(center, radius), new THREE.Vector3()));
  }
  function hitQuestionChip(event) {
    if (atlasPresentationState(zoom, motionReduced).state.atlas <= 0.15) return null;
    const bounds = renderer.domElement.getBoundingClientRect();
    let best = null, bestDistance = 22;
    for (const { chip, sprite } of p2Renderer.getQuestionChipTargets()) {
      if (!chip || !sprite.visible || sprite.material.opacity <= 0.05) continue;
      const screen = sprite.getWorldPosition(new THREE.Vector3()).project(camera);
      const x = bounds.left + (screen.x + 1) * 0.5 * bounds.width;
      const y = bounds.top + (1 - screen.y) * 0.5 * bounds.height;
      const distance = Math.hypot(event.clientX - x, event.clientY - y);
      if (distance <= bestDistance) { bestDistance = distance; best = { chip, x, y }; }
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

  function hitCluster(event) {
    const bounds = eventPoint(event);
    pointer.set(bounds.x, bounds.y);
    raycaster.setFromCamera(pointer, camera);
    const active = [...clusterSprites.values()].filter(sprite => sprite.visible && sprite.material.opacity > 0.05);
    const hit = raycaster.intersectObjects(active, false)[0]?.object;
    return hit?.userData.cluster || null;
  }

  function fanCenterForCluster(cluster) {
    const sprite = [...clusterSprites.values()].find(item => item.userData.cluster?.id === cluster?.id);
    if (!sprite) return null;
    const bounds = renderer.domElement.getBoundingClientRect();
    const ndc = sprite.getWorldPosition(new THREE.Vector3()).project(camera);
    return { x: bounds.left + (ndc.x + 1) * 0.5 * bounds.width, y: bounds.top + (1 - ndc.y) * 0.5 * bounds.height };
  }
  function openClusterFan(cluster) {
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
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, rotation };
    renderer.domElement.setPointerCapture?.(event.pointerId);
  });
  listen(renderer.domElement, 'pointermove', event => {
    if (drag) {
      rotation = drag.rotation + (event.clientX - drag.x) * 0.006;
      atlasGroup.rotation.y = (surfaceFacingAngle + rotation) * (1 - atlasPresentationState(zoom, motionReduced).state.lift);
      applyZoom(zoom, false);
      return;
    }
    const reference = hitPresentEarth(event);
    const chipHit = reference ? null : hitQuestionChip(event);
    const world = reference || chipHit ? null : hitWorld(event);
    const cluster = world || reference || chipHit ? null : hitCluster(event), id = world ? stableWorldId(world) : null;
    if (cluster?.id) {
      if (cluster.id !== hoveredClusterId) {
        openClusterFan(cluster);
      }
    } else if (hoveredClusterId && !containsFanRegion({ x: event.clientX, y: event.clientY }, fanRegion)) {
      closeClusterFan();
    }
    if (chipHit) {
      const question = questionForChip(chipHit.chip), questionId = String(question.id);
      if (hoveredId || hoveredReference) setFocusedWorld(null, null);
      onQuestionPreview(question, questionAnchor(question, 'pointer', event.clientX, event.clientY, chipHit.x, chipHit.y));
      hoveredQuestionId = questionId; hoveredReference = false; hoveredId = null;
      renderer.domElement.dataset.focusedQuestionId = questionId; container.dataset.focusedQuestionId = questionId;
    } else {
      if (hoveredQuestionId) onQuestionPreview(null, null);
      hoveredQuestionId = null; renderer.domElement.dataset.focusedQuestionId = ''; container.dataset.focusedQuestionId = '';
    }
    if (reference) {
      if (hoveredId) setFocusedWorld(null, null);
      hoveredReference = true; hoveredId = 'present-day-earth';
      renderer.domElement.dataset.focusedWorldId = 'present-day-earth'; renderer.domElement.dataset.previewWorldId = 'present-day-earth';
      container.dataset.focusedWorldId = 'present-day-earth'; container.dataset.previewWorldId = 'present-day-earth';
      onPreview(virtualPresentEarth(), { source: 'pointer', worldId: 'present-day-earth', clientX: event.clientX, clientY: event.clientY });
    } else if (id !== hoveredId || hoveredReference) {
      hoveredReference = false;
      applyZoom(zoom, false);
      setFocusedWorld(world, world ? projectedAnchor(id, 'pointer', event.clientX, event.clientY) : null);
    } else if (world) {
      setFocusedWorld(world, projectedAnchor(id, 'pointer', event.clientX, event.clientY));
    }
  });
  listen(renderer.domElement, 'pointerup', event => {
    if (!drag) return;
    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    drag = null;
    if (moved < 5) {
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
        if (cluster.id !== hoveredClusterId) openClusterFan(cluster);
        setZoom(cluster.level === 'surface' ? Math.max(zoom, 0.3) : Math.max(zoom, 0.68));
        return;
      }
      const world = hitWorld(event);
      if (world) explicitEnter(world, projectedAnchor(stableWorldId(world), 'pointer', event.clientX, event.clientY));
    }
  });
  listen(renderer.domElement, 'pointercancel', () => { drag = null; });
  listen(renderer.domElement, 'pointerleave', () => {
    closeClusterFan();
    if (hoveredId) setFocusedWorld(null, null);
    if (hoveredQuestionId) onQuestionPreview(null, null);
    hoveredQuestionId = null; hoveredReference = false;
    renderer.domElement.dataset.focusedQuestionId = ''; container.dataset.focusedQuestionId = '';
  });
  listen(renderer.domElement, 'wheel', event => {
    event.preventDefault();
    setZoom(zoom + Math.sign(event.deltaY) * 0.035);
  }, { passive: false });
  listen(renderer.domElement, 'keydown', event => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoom + 0.035); }
    else if (event.key === '-' || event.key === '_') { event.preventDefault(); setZoom(zoom - 0.035); }
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
      if (zoom > 0) setZoom(Math.max(0, zoom - 0.1));
      else if (hoveredId) setFocusedWorld(null, null);
      else if (hoveredQuestionId) { onQuestionPreview(null, null); hoveredQuestionId = null; }
    }
  });

  const resize = () => {
    if (disposed || !container.clientWidth || !container.clientHeight) return;
    const width = container.clientWidth, height = container.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    applyZoom(zoom, false);
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
    renderer.domElement.dataset.goldEdgeSegments = String(goldEdgeMeshes.count);
    renderer.domElement.dataset.lineageWorldIds = JSON.stringify(atlasTimeline?.lineageIds || []);
    container.dataset.currentWorldId = currentId || '';
    container.dataset.travelState = String(Boolean(travelState));
    container.dataset.goldEdgeSegments = String(goldEdgeMeshes.count);
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
          updateLayout(); drawCurrentMarker();
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
      updateLayout(); drawCurrentMarker();
      applyZoom(finalZoom, false, timestamp);
    }
    if (axisTransition) {
      applyZoom(zoom, false, timestamp);
      if (timestamp - axisTransition.startedAt >= AXIS_ANIMATION_MS) axisTransition = null;
    } else if (!travelState) atlasGroup.rotation.y = (surfaceFacingAngle + rotation) * (1 - atlasPresentationState(zoom, motionReduced).state.lift);
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
    enterWorld,
    setZoom,
    getZoom,
    getLevel: () => stageForZoom(zoom),
    getDebugStats,
    getWorldObject: id => registry.get(id)?.object ?? null,
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
      disposed = true; cancelAnimationFrame(raf); observer?.disconnect();
      for (const remove of domListeners) remove();
      worldTextureFactory.dispose();
      registry.clear();
      scene.traverse(object => {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) { material?.map?.dispose?.(); material?.dispose?.(); }
      });
      unenteredOutlineTexture.dispose(); currentEarthTexture.dispose(); miniEarthTexture.dispose(); earthTexture.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
