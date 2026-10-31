import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { formatYear, causalEdges } from './logic.js';
import { causalArcAltitude } from './globeArc.js';
import { createGeographyRenderer, drawGeographyCanvas } from './geographyTexture.js';

function setup(el) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;

  scene.add(new THREE.HemisphereLight(0xe8eee5, 0x263b39, 1.35));
  const key = new THREE.DirectionalLight(0xe3eadf, 1.35);
  key.position.set(2, 3, 5);
  scene.add(key);

  renderer.setSize(400, 300);
  function resize() {
    if (el.clientWidth <= 0 || el.clientHeight <= 0) return;
    const width = el.clientWidth;
    const height = el.clientHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(el);
  resize();

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
  return { scene, camera, controls, renderer };
}

function validPlace(place) {
  return Number.isFinite(place?.lat) && Number.isFinite(place?.lon);
}

function makeBranchPin(branch, onSelect, onPreview = () => {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'globe-pin';
  button.dataset.branchId = branch.id;
  button.setAttribute('aria-label', `${formatYear(branch.year)} · ${branch.title}${branch.place?.name ? ` · ${branch.place.name}` : ''}`);
  button.title = `${formatYear(branch.year)} · ${branch.title}`;
  button.setAttribute('aria-pressed', 'false');
  button.style.cssText = 'position:relative;display:flex;align-items:center;gap:8px;padding:5px 10px 5px 5px;border:1px solid rgba(230,190,121,.82);border-radius:999px;background:rgba(9,17,20,.9);color:#f4eee2;font:600 12px/1.2 var(--sans,Inter,sans-serif);white-space:nowrap;cursor:pointer;box-shadow:0 0 18px rgba(230,190,121,.28);touch-action:manipulation;';
  const bead = document.createElement('span');
  bead.className = 'globe-pin-bead';
  bead.setAttribute('aria-hidden', 'true');
  bead.style.cssText = 'position:relative;display:block;flex:0 0 20px;width:20px;height:20px;border:2px solid currentColor;border-radius:50%;background:radial-gradient(circle,#fff2cf 0 18%,currentColor 24% 48%,transparent 58%);color:#78c5e6;box-shadow:0 0 12px currentColor;';
  const ripple = document.createElement('span');
  ripple.className = 'globe-pin-ripple';
  ripple.setAttribute('aria-hidden', 'true');
  bead.append(ripple);
  const label = document.createElement('span');
  label.className = 'globe-pin-label';
  label.textContent = `${formatYear(branch.year)} · ${branch.title}`;
  label.style.cssText = 'display:none;max-width:min(48vw,240px);overflow:hidden;text-overflow:ellipsis;';
  button.append(bead, label);
  let pointerOver=false, focused=false;
  const updatePreview=()=>onPreview(pointerOver || focused ? branch : null, button);
  button.addEventListener('pointerenter',()=>{pointerOver=true;updatePreview();});
  button.addEventListener('pointerleave',()=>{pointerOver=false;updatePreview();});
  button.addEventListener('focus',()=>{focused=true;updatePreview();});
  button.addEventListener('blur',()=>{focused=false;updatePreview();});
  button.addEventListener('click', event => {
    event.stopPropagation();
    onPreview(null, button);
    onSelect(branch);
  });
  button.addEventListener('pointerdown', event => event.stopPropagation());
  return { branch, element: button, label, bead };
}

export async function createGlobe(el, onBranchSelect = () => {}, onBranchPreview = () => {}) {
  // Use the published browser bundle: no CDN dependency-range transformation.
  // Its internals prefer this shared Three instance over their bundled fallback.
  window.THREE = THREE;
  await import('https://cdn.jsdelivr.net/npm/globe.gl@2.46.0/dist/globe.gl.min.js');
  const Globe = window.Globe;
  if (!document.getElementById('globe-pin-motion-style')) {
    const style = document.createElement('style');
    style.id = 'globe-pin-motion-style';
    style.textContent = '@keyframes globe-pin-ripple{0%{transform:scale(.7);opacity:.75}100%{transform:scale(2.15);opacity:0}}.globe-pin-ripple{position:absolute;inset:-2px;border:1px solid currentColor;border-radius:50%;pointer-events:none;animation:globe-pin-ripple 2.4s ease-out infinite}@media(prefers-reduced-motion:reduce){.globe-pin-ripple{animation:none;opacity:.35;transform:scale(1.2)}}';
    document.head.append(style);
  }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const globe = Globe({
    animateIn: false,
    rendererConfig: { antialias: true, alpha: true },
  })(el)
    .backgroundColor('rgba(0,0,0,0)')
    .bumpImageUrl('/assets/earth-relief.png')
    .showAtmosphere(true)
    .atmosphereColor('#7775d6')
    .atmosphereAltitude(0.035)
    .enablePointerInteraction(true)
    .arcsData([])
    .arcStartLat('startLat')
    .arcStartLng('startLng')
    .arcEndLat('endLat')
    .arcEndLng('endLng')
    .arcColor(d => d.color)
    .arcAltitude(d => causalArcAltitude(d.startLat, d.startLng, d.endLat, d.endLng))
    .arcStroke(null)
    .arcDashLength(0.14)
    .arcDashGap(0.12)
    .arcDashInitialGap(d => d.phase)
    .arcDashAnimateTime(reducedMotion.matches ? 0 : 2400)
    .htmlElementsData([])
    .htmlElement(d => d.element)
    .htmlLat(d => d.branch.place.lat)
    .htmlLng(d => d.branch.place.lon)
    .htmlAltitude(0.018);

  globe.globeMaterial().bumpScale = 0.2;
  let surfaceTexture;
  const geographyRenderer = createGeographyRenderer({
    paint(image, geography, mode) {
      const canvas = document.createElement('canvas');
      canvas.width = 4096; canvas.height = 2048;
      drawGeographyCanvas(canvas, image, geography, mode);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    },
    apply(texture) {
      const previous = surfaceTexture; surfaceTexture = texture;
      const material = globe.globeMaterial();
      // With no globeImageUrl, globe.gl starts with a black material. A map is
      // multiplied by its diffuse colour, so explicitly enable the canvas colour.
      material.color.set(0xffffff);
      material.map = texture;
      material.needsUpdate = true;
      previous?.dispose();
    },
    onError() { document.getElementById('geography-status').textContent = 'Earth surface unavailable. Geographic assumptions remain listed below.'; },
  });
  geographyRenderer.set(undefined);

  // Zoom when interacting with the globe; overlay panels keep their own scrolling.
  // OrbitControls belongs to globe.gl's renderer; the model viewer uses its own controls.
  const controls = globe.controls();
  controls.enableZoom = true;
  controls.autoRotate = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  const canvas = el.querySelector('canvas');
  if (canvas) canvas.style.touchAction = 'none';
  globe.pointOfView({ lat: 30, lng: 22, altitude: 1.4 }, 0);

  let branches = [];
  let pins = [];
  let selectedId = null;
  let focusId = null;
  let heroId = null;

  function panelRects() {
    return ['.site-header', '#invitation', '#chronicle', '#guardrail', '#geography-panel', '.map-panel .panel-head']
      .map(selector => document.querySelector(selector))
      .filter(node => node && !node.hidden && getComputedStyle(node).display !== 'none')
      .map(node => node.getBoundingClientRect());
  }

  function positionGlobe() {
    const width = el.clientWidth, height = el.clientHeight;
    let left = 12, right = width - 12, top = 116, bottom = height - 12;
    for (const rect of panelRects()) {
      if (rect.width > width * 0.7 && rect.top > height * 0.25) bottom = Math.min(bottom, rect.top - 18);
      else if (rect.left < width * 0.2 && rect.width < width * 0.45) left = Math.max(left, rect.right + 18);
      else if (rect.right > width * 0.8 && rect.width < width * 0.45) right = Math.min(right, rect.left - 18);
    }
    if (right - left < 180) { left = 12; right = width - 12; }
    const x = width >= 700 && !branches.length ? width / 2 : (left + right) / 2;
    const y = width < 700 ? (top + Math.max(top + 80, bottom)) / 2 : height / 2;
    globe.globeOffset([x - width / 2, y - height / 2]);
  }

  function avoidPanels() {
    const panels = panelRects();
    for (const pin of pins) {
      const point = globe.getScreenCoords(pin.branch.place.lat, pin.branch.place.lon, 0.018);
      const width = pin.element.offsetWidth || 40;
      const height = pin.element.offsetHeight || 34;
      // CSS2D elements are centred on their geographic anchor. Hide occluded UI
      // targets rather than painting labels over the floating sheets.
      const blocked = !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || point.x - width / 2 < 8 || point.x + width / 2 > el.clientWidth - 8
        || point.y - height / 2 < 8 || point.y + height / 2 > el.clientHeight - 8
        || panels.some(rect => point.x + width / 2 > rect.left - 8 && point.x - width / 2 < rect.right + 8
        && point.y + height / 2 > rect.top - 8 && point.y - height / 2 < rect.bottom + 8);
      pin.element.style.visibility = blocked ? 'hidden' : '';
    }
  }
  controls.addEventListener('change', avoidPanels);
  const panelsObserver = new ResizeObserver(() => { positionGlobe(); requestAnimationFrame(avoidPanels); });
  for (const selector of ['#invitation', '#chronicle', '.site-header']) {
    const panel = document.querySelector(selector);
    if (panel) panelsObserver.observe(panel);
  }

  function updatePins() {
    for (const pin of pins) {
      const selected = pin.branch.id === selectedId;
      const hero = pin.branch.id === heroId;
      pin.element.classList.toggle('selected', selected);
      pin.element.classList.toggle('hero', hero);
      pin.element.setAttribute('aria-pressed', String(selected));
      pin.element.style.borderColor = hero ? '#f0c678' : selected ? '#d7eadf' : 'rgba(127,190,180,.8)';
      pin.element.style.boxShadow = selected || hero ? '0 0 20px rgba(240,198,120,.5)' : '0 0 10px rgba(127,190,180,.28)';
      pin.bead.style.color = hero ? '#f0c678' : selected ? '#9adcf6' : '#78c5e6';
      // Keep the active/hero path named on the globe, while all pins remain compact buttons.
      pin.label.style.display = pin.branch.id === (focusId || selectedId || heroId) ? 'inline' : 'none';
    }
  }

  function setBranches(nextBranches, nextHeroId = null, explicitOrigin = null, path = []) {
    branches = Array.isArray(nextBranches) ? nextBranches : [];
    heroId = nextHeroId;
    if (nextHeroId) selectedId = nextHeroId;
    else if (!branches.some(branch => branch.id === selectedId)) selectedId = null;
    if (!branches.some(branch => branch.id === focusId)) focusId = null;
    const places = branches.filter(branch => validPlace(branch.place));
    const first = branches[0];
    const origin = validPlace(explicitOrigin?.place) ? explicitOrigin
      : validPlace(explicitOrigin) ? { place: explicitOrigin }
        : validPlace(first?.origin?.place) ? first.origin
          : validPlace(first?.origin) ? { place: first.origin } : null;
    globe.arcsData(causalEdges(branches, path, origin).map(({ from, to, ancestry }, index) => ({
      // Keep only the two documented endpoints; the tiny altitude follows the
      // globe with a gentle lift and does not imply a specific route between them.
      startLat: from.place.lat, startLng: from.place.lon,
      endLat: to.place.lat, endLng: to.place.lon,
      color: ancestry ? '#e6be79' : '#73aaa1', phase: (index % 5) * 0.13,
    })));
    const ancestors = path.filter(item => validPlace(item.place)).map((item, index) => ({ ...item, id: `ancestor:${index}:${item.runId}`, ancestorRunId: item.runId, title: `Chosen cause · ${item.title}` }));
    pins = [...ancestors, ...places].map(branch => makeBranchPin(branch, selected => select(selected, true), onBranchPreview));
    globe.htmlElementsData(pins);
    updatePins();
    positionGlobe();
    requestAnimationFrame(avoidPanels);
  }

  function focus(branch) {
    if (!validPlace(branch?.place)) return;
    focusId = branch.id;
    updatePins();
    positionGlobe();
    globe.pointOfView({ lat: branch.place.lat, lng: branch.place.lon, altitude: 1.05 }, reducedMotion.matches ? 0 : 1100);
  }

  function select(branch, fromPin = false) {
    selectedId = branch?.id || null;
    updatePins();
    if (fromPin && branch) onBranchSelect(branch);
    if (branch) focus(branch);
  }

  const observer = new ResizeObserver(() => {
    const width = el.clientWidth || 400;
    const height = el.clientHeight || 300;
    globe.width(width).height(height);
    positionGlobe();
    requestAnimationFrame(avoidPanels);
  });
  observer.observe(el);
  globe.width(el.clientWidth || 400).height(el.clientHeight || 300);

  reducedMotion.addEventListener?.('change', () => {
    globe.arcDashAnimateTime(reducedMotion.matches ? 0 : 2400);
    if (reducedMotion.matches) controls.autoRotate = false;
  });
  return {
    setBranches,
    setGeography: (geography, mode) => geographyRenderer.set(geography, mode),
    focus,
    select: branch => select(branch),
    get selectedId() { return selectedId; },
    get heroId() { return heroId; },
  };
}

export function createModelViewer(el) {
  const { scene, camera, controls, renderer } = setup(el);
  camera.position.set(2, 1.5, 3);
  controls.autoRotateSpeed = 0.8;
  controls.minDistance = 1.8;
  controls.maxDistance = 20;
  el.tabIndex = 0;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Interactive 3D model viewer. Use arrow keys to orbit, plus or minus to zoom, and Home to reset the view.');
  el.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight + - Home');
  el.style.outlineOffset = '4px';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let object, loadedUrl = '', requestId = 0;
  let frameAspect = null, objectRadius = 1;
  const homeDirection = new THREE.Vector3(2, 1.5, 3).normalize();
  const disposeObject = root => {
    root?.traverse?.(child => {
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
      for (const material of materials) material?.dispose?.();
    });
  };
  const fitDistance = () => {
    const width = el.clientWidth > 0 ? el.clientWidth : 400;
    const height = el.clientHeight > 0 ? el.clientHeight : 300;
    const aspect = Math.max(0.1, width / height);
    const vertical = THREE.MathUtils.degToRad(camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
    return Math.max(3.9, objectRadius * 1.12 / Math.sin(Math.min(vertical, horizontal) / 2));
  };
  const fitCamera = () => {
    if (!object) return;
    if (el.clientWidth <= 0 || el.clientHeight <= 0) return;
    const width = el.clientWidth;
    const height = el.clientHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const aspect = width / height;
    const offset = camera.position.clone().sub(controls.target);
    const validOffset = Number.isFinite(offset.x) && Number.isFinite(offset.y) && Number.isFinite(offset.z) && offset.lengthSq() > 1e-6;
    if (aspect === frameAspect && validOffset) return;
    frameAspect = aspect;
    const direction = validOffset ? offset.normalize() : homeDirection.clone();
    camera.position.copy(controls.target).addScaledVector(direction, fitDistance());
    camera.lookAt(controls.target);
    controls.update();
  };
  el.addEventListener('keydown', event => {
    if (event.target !== el && event.target !== renderer.domElement) return;
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'Home'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (!object) return;

    if (event.key === 'Home') {
      camera.position.copy(controls.target).addScaledVector(homeDirection, fitDistance());
      controls.update();
      return;
    }

    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const orbitStep = 0.12;
    if (event.key === 'ArrowLeft') spherical.theta -= orbitStep;
    else if (event.key === 'ArrowRight') spherical.theta += orbitStep;
    else if (event.key === 'ArrowUp') spherical.phi = Math.max(0.05, spherical.phi - orbitStep);
    else if (event.key === 'ArrowDown') spherical.phi = Math.min(Math.PI - 0.05, spherical.phi + orbitStep);
    else if (event.key === '+' || event.key === '=') spherical.radius = Math.max(controls.minDistance, spherical.radius / 1.12);
    else if (event.key === '-' || event.key === '_') spherical.radius = Math.min(controls.maxDistance, spherical.radius * 1.12);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    camera.lookAt(controls.target);
    controls.update();
  });
  const frameObserver = new ResizeObserver(fitCamera);
  frameObserver.observe(el);
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const fill = new THREE.DirectionalLight(0xf4ead6, 2.6);
  fill.position.set(-4, 2, 2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x9dc8c1, 1.35);
  rim.position.set(3, 2, -4);
  scene.add(rim);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;

  return {
    setAutoRotate(enabled) {
      controls.autoRotate = Boolean(enabled) && !reducedMotion.matches;
      return controls.autoRotate;
    },
    clear() {
      requestId++;
      if (object) {
        scene.remove(object);
        disposeObject(object);
        object = null;
      }
      loadedUrl = '';
      frameAspect = null;
    },
    refresh() {
      frameAspect = null;
      fitCamera();
      controls.update();
      renderer.render(scene, camera);
    },
    load(url, callbacks = {}) {
      if (url === loadedUrl && object) {
        frameAspect = null;
        fitCamera();
        controls.update();
        renderer.render(scene, camera);
        callbacks.onLoad?.();
        return;
      }
      const current = ++requestId;
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      loader.load(url, gltf => {
        if (current !== requestId) return;
        if (object) {
          scene.remove(object);
          disposeObject(object);
        }
        object = gltf.scene;
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const scale = 2 / Math.max(size.x, size.y, size.z, 0.001);
        objectRadius = size.length() * scale / 2;
        frameAspect = null;
        object.position.sub(center);
        object.scale.setScalar(scale);
        object.position.multiplyScalar(scale);
        scene.add(object);
        controls.target.set(0, 0, 0);
        camera.position.copy(homeDirection).multiplyScalar(fitDistance());
        camera.lookAt(0, 0, 0);
        fitCamera();
        controls.update();
        renderer.render(scene, camera);
        loadedUrl = url;
        callbacks.onLoad?.(gltf);
      }, event => {
        if (current === requestId) callbacks.onProgress?.(event);
      }, error => {
        if (current !== requestId) return;
        el.setAttribute('aria-label', '3D model could not be loaded');
        callbacks.onError?.(error);
      });
    },
  };
}
