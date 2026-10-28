import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { formatYear } from './logic.js';

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

  function resize() {
    const width = el.clientWidth || 400;
    const height = el.clientHeight || 300;
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

// SphereGeometry's UV map puts longitude zero on +X; its texture longitude runs toward -Z.
function surfacePoint(place, radius = 100) {
  const lat = THREE.MathUtils.degToRad(place.lat);
  const lon = THREE.MathUtils.degToRad(place.lon);
  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * Math.cos(lat) * Math.sin(lon),
  );
}

function disposeGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child.children?.length) disposeGroup(child);
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material?.map?.dispose();
      material?.dispose();
    }
  }
}

function makeBranchLabel(branch, hero) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const text = `${formatYear(branch.year)} · ${branch.title}`;
  context.font = '600 22px "DM Sans", Arial, sans-serif';
  const width = Math.ceil(context.measureText(text).width + 34);
  canvas.width = Math.min(width, 760);
  canvas.height = 54;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 22px "DM Sans", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(9, 20, 21, 0.91)';
  ctx.strokeStyle = hero ? 'rgba(230, 190, 121, 0.92)' : 'rgba(117, 170, 159, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(1, 1, canvas.width - 2, canvas.height - 2, 14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = hero ? '#f0cf91' : '#e0e8df';
  const shown = canvas.width < width ? `${text.slice(0, Math.max(12, Math.floor(text.length * canvas.width / width) - 2))}…` : text;
  ctx.fillText(shown, 17, canvas.height / 2, canvas.width - 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set((canvas.width / canvas.height) * 13.5, 13.5, 1);
  sprite.userData.fullLabel = text;
  return sprite;
}

function makeArc(from, to, color) {
  const start = from.clone().normalize();
  const end = to.clone().normalize();
  const angle = start.angleTo(end);
  if (angle < 0.012) return null;
  const axis = new THREE.Vector3().crossVectors(start, end);
  if (axis.lengthSq() < 1e-6) {
    const fallback = Math.abs(start.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    axis.crossVectors(start, fallback);
  }
  axis.normalize();
  class ElevatedArc extends THREE.Curve {
    getPoint(t, target = new THREE.Vector3()) {
      const direction = start.clone().applyAxisAngle(axis, angle * t);
      const lift = Math.sin(Math.PI * t) * (8 + Math.min(angle * 7, 22));
      return target.copy(direction.multiplyScalar(101.5 + lift));
    }
  }
  const curve = new ElevatedArc();
  const group = new THREE.Group();
  const glow = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 48, 2.1, 8, false),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  const line = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 48, 0.9, 8, false),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, depthWrite: false }),
  );
  group.add(glow, line);
  return group;
}

export function createGlobe(el, onBranchSelect = () => {}) {
  const { scene, camera, controls, renderer } = setup(el);
  const earth = new THREE.Group();
  scene.add(earth);

  const earthMaterial = new THREE.MeshPhongMaterial({
    color: 0xd4dcda,
    emissive: 0x0b2727,
    emissiveIntensity: 0.24,
    specular: 0x243c3a,
    shininess: 4,
  });
  const texture = new THREE.TextureLoader().load('/assets/earth-blue-marble.jpg', () => {
    renderer.render(scene, camera);
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  earthMaterial.map = texture;
  earthMaterial.needsUpdate = true;
  earth.add(new THREE.Mesh(new THREE.SphereGeometry(100, 96, 64), earthMaterial));

  const atmosphereMaterial = new THREE.MeshBasicMaterial({
    color: 0x80c4bd,
    transparent: true,
    opacity: 0.15,
    side: THREE.BackSide,
    depthWrite: false,
  });
  earth.add(new THREE.Mesh(new THREE.SphereGeometry(103.5, 64, 48), atmosphereMaterial));

  const arcs = new THREE.Group();
  const markers = new THREE.Group();
  scene.add(arcs, markers);
  camera.position.set(0, 0, 350);
  controls.enableZoom = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 560px)');
  let selectedId = null;
  let focusId = null;
  let heroId = null;
  let flight = 0;
  const clickable = [];

  function updateLabelVisibility() {
    for (const marker of markers.children) {
      const label = marker.userData.label;
      const visibleId = mobile.matches ? selectedId || heroId : focusId || heroId;
      if (label) label.visible = marker.userData.branch.id === visibleId;
    }
  }

  function updatePinSelection() {
    for (const marker of markers.children) {
      const isHero = marker.userData.branch.id === heroId;
      const isSelected = marker.userData.branch.id === selectedId;
      const color = isHero ? 0xf0c678 : isSelected ? 0xc4e6dd : 0x8cc9bd;
      const bead = marker.userData.bead;
      const halo = marker.userData.halo;
      bead.material.color.setHex(color);
      bead.material.emissive.setHex(color);
      bead.material.emissiveIntensity = isHero ? 0.65 : isSelected ? 0.52 : 0.28;
      halo.material.color.setHex(color);
      halo.material.opacity = isHero ? 0.8 : isSelected ? 0.72 : 0.46;
      halo.scale.setScalar(isSelected ? 1.2 : 1);
    }
  }

  function setBranches(branches, nextHeroId = null, explicitOrigin = null) {
    for (const marker of markers.children) {
      const label = marker.userData.label;
      if (!label) continue;
      scene.remove(label);
      label.material.map?.dispose();
      label.material.dispose();
    }
    disposeGroup(arcs);
    disposeGroup(markers);
    clickable.length = 0;
    heroId = nextHeroId;
    if (nextHeroId) selectedId = nextHeroId;
    else if (!branches.some(branch => branch.id === selectedId)) selectedId = null;
    if (!branches.some(branch => branch.id === focusId)) focusId = null;
    const places = branches.filter(branch => validPlace(branch.place));
    const firstOrigin = places[0]?.place;
    const origin = validPlace(explicitOrigin?.place) ? explicitOrigin.place
      : validPlace(explicitOrigin) ? explicitOrigin
        : validPlace(branches[0]?.origin?.place) ? branches[0].origin.place
          : validPlace(branches[0]?.origin) ? branches[0].origin
            : firstOrigin;
    const originPoint = origin ? surfacePoint(origin) : null;

    for (const [index, branch] of places.entries()) {
      const isHero = branch.id === heroId;
      const point = surfacePoint(branch.place);
      if (originPoint) {
        const arc = makeArc(originPoint, point, isHero ? 0xe6be79 : 0x73aaa1);
        if (arc) arcs.add(arc);
      }

      const normal = point.clone().normalize();
      const pin = new THREE.Group();
      pin.position.copy(point.clone().multiplyScalar(1.015));
      pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      pin.userData.branch = branch;
      const color = isHero ? 0xf0c678 : 0x8cc9bd;
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(isHero ? 2.8 : 2.4, 20, 16),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: isHero ? 0.65 : 0.28, roughness: 0.38 }),
      );
      pin.add(bead);
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(3.8, 4.5, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isHero ? 0.8 : 0.46, side: THREE.DoubleSide, depthWrite: false }),
      );
      pin.add(halo);
      pin.userData.bead = bead;
      pin.userData.halo = halo;
      const hit = new THREE.Mesh(
        new THREE.SphereGeometry(7, 12, 10),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      hit.position.z = 8;
      hit.userData.branch = branch;
      pin.add(hit);
      clickable.push(hit);

      const label = makeBranchLabel(branch, isHero);
      const tangent = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
      if (tangent.lengthSq() < 0.01) tangent.set(1, 0, 0);
      const side = index % 2 === 0 ? 1 : -1;
      label.position.copy(point.clone().add(normal.multiplyScalar(10)).add(tangent.multiplyScalar(side * (14 + index * 3))));
      label.userData.branchId = branch.id;
      scene.add(label);
      pin.userData.label = label;
      markers.add(pin);
    }
    updateLabelVisibility();
    updatePinSelection();
  }

  function focus(branch) {
    if (!validPlace(branch?.place)) return;
    focusId = branch.id;
    updateLabelVisibility();
    const target = surfacePoint(branch.place).normalize();
    const start = camera.position.clone().normalize();
    const angle = start.angleTo(target);
    const axis = new THREE.Vector3().crossVectors(start, target);
    if (axis.lengthSq() < 0.001) axis.set(0, 1, 0);
    axis.normalize();
    const distance = el.clientHeight < 300 ? 300 : 350;
    const current = ++flight;
    controls.autoRotate = false;
    if (reducedMotion.matches || angle < 0.001) {
      camera.position.copy(target.multiplyScalar(distance));
      camera.lookAt(0, 0, 0);
      controls.update();
      return;
    }
    const started = performance.now();
    const duration = 780;
    const origin = start.clone();
    function move(now) {
      if (current !== flight) return;
      const progress = Math.min(1, (now - started) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      const direction = origin.clone().applyAxisAngle(axis, angle * eased).normalize();
      camera.position.copy(direction.multiplyScalar(distance));
      camera.lookAt(0, 0, 0);
      controls.update();
      if (progress < 1) requestAnimationFrame(move);
    }
    requestAnimationFrame(move);
  }

  function select(branch, fromPin = false) {
    selectedId = branch?.id || null;
    updateLabelVisibility();
    updatePinSelection();
    if (fromPin) onBranchSelect(branch);
    focus(branch);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerStart = null;
  let lastPointerUpAt = 0;
  function selectPinAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    pointer.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const pinHit = raycaster.intersectObjects(clickable, false)[0];
    const earthHit = raycaster.intersectObject(earth.children[0], false)[0];
    let branch = pinHit && (!earthHit || pinHit.distance < earthHit.distance)
      ? pinHit.object.userData.branch
      : null;

    // A small projected hit area makes touch selection reliable when a finger lands
    // beside a bead. Keep the same Earth occlusion test so hidden, far-side pins do
    // not become clickable through the planet.
    if (!branch) {
      camera.updateMatrixWorld();
      const projected = new THREE.Vector3();
      let closest = Infinity;
      const maxDistance = mobile.matches ? 30 : 22;
      for (const hit of clickable) {
        hit.getWorldPosition(projected);
        const distanceFromCamera = camera.position.distanceTo(projected);
        projected.project(camera);
        if (projected.z < -1 || projected.z > 1) continue;
        const screenX = (projected.x + 1) * rect.width / 2;
        const screenY = (1 - projected.y) * rect.height / 2;
        const screenDistance = Math.hypot(screenX - x, screenY - y);
        if (screenDistance >= closest || screenDistance > maxDistance) continue;
        raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
        const candidateEarthHit = raycaster.intersectObject(earth.children[0], false)[0];
        const occluded = candidateEarthHit && candidateEarthHit.distance < distanceFromCamera - 7;
        if (occluded) continue;
        closest = screenDistance;
        branch = hit.userData.branch;
      }
    }
    if (branch) select(branch, true);
  }
  renderer.domElement.addEventListener('pointerdown', event => { pointerStart = { x: event.clientX, y: event.clientY }; });
  renderer.domElement.addEventListener('pointerup', event => {
    const start = pointerStart;
    pointerStart = null;
    lastPointerUpAt = performance.now();
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) return;
    selectPinAt(event);
  });
  renderer.domElement.addEventListener('click', event => {
    if (performance.now() - lastPointerUpAt < 500) return;
    selectPinAt(event);
  });
  mobile.addEventListener?.('change', updateLabelVisibility);
  reducedMotion.addEventListener?.('change', () => { if (reducedMotion.matches) controls.autoRotate = false; });
  return {
    setBranches,
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
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let object, loadedUrl = '', requestId = 0;
  let narrowFrame = null;
  const fitCamera = () => {
    if (!object) return;
    const narrow = el.clientWidth / Math.max(el.clientHeight, 1) < 0.86;
    if (narrow === narrowFrame) return;
    narrowFrame = narrow;
    const direction = camera.position.clone().normalize();
    camera.position.copy(direction.multiplyScalar(narrow ? 4.6 : 3.9));
    controls.update();
  };
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
    load(url, callbacks = {}) {
      if (url === loadedUrl) { callbacks.onLoad?.(); return; }
      const current = ++requestId;
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      loader.load(url, gltf => {
        if (current !== requestId) return;
        if (object) scene.remove(object);
        object = gltf.scene;
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const scale = 2 / Math.max(size.x, size.y, size.z, 0.001);
        object.position.sub(center);
        object.scale.setScalar(scale);
        object.position.multiplyScalar(scale);
        scene.add(object);
        controls.target.set(0, 0, 0);
        fitCamera();
        controls.update();
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
