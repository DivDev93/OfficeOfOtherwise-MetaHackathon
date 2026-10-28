import * as THREE from 'three';
import ThreeGlobe from 'three-globe';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { formatYear } from './logic.js';
function setup(el) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, .1, 2000), renderer = new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; el.append(renderer.domElement);
  const controls = new OrbitControls(camera,renderer.domElement); controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xe8eee5,0x344038,2)); const key = new THREE.DirectionalLight(0xffe3b0,2); key.position.set(3,4,5); scene.add(key);
  function resize(){ const w = el.clientWidth || 400, h = el.clientHeight || 350; renderer.setSize(w,h); camera.aspect = w/h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(el); resize();
  function animate(){ requestAnimationFrame(animate); controls.update(); renderer.render(scene,camera); } animate();
  return {scene,camera,renderer,controls};
}
export function createGlobe(el) {
  const {scene,camera,controls} = setup(el); camera.position.set(0,20,310); controls.enableZoom = false; controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches; controls.autoRotateSpeed = .35;
  const globe = new ThreeGlobe().showAtmosphere(true).atmosphereColor('#b9d0a9').atmosphereAltitude(.16).pointsData([]).pointLat(d=>d.place.lat).pointLng(d=>d.place.lon).pointAltitude(.04).pointRadius(.9).pointColor(d=>d.id === globe.userData.hero ? '#f1cc82' : '#b9d4c0').labelsData([]).labelLat(d=>d.place.lat).labelLng(d=>d.place.lon).labelText(d=>`${formatYear(d.year)} · ${d.title}`).labelSize(1.7).labelDotRadius(0).labelAltitude(.035).labelColor(()=> '#eadbb7');
  globe.globeMaterial(new THREE.MeshPhongMaterial({color:'#294b43',emissive:'#102b27',shininess:8,wireframe:true,transparent:true,opacity:.8})); scene.add(globe);
  let flight = 0;
  return {setBranches(branches,hero){ globe.userData.hero = hero; const points = branches.filter(b=>Number.isFinite(b.place?.lat)&&Number.isFinite(b.place?.lon)); globe.pointsData(points); globe.labelsData(points); },focus(b){
    if(!b.place)return;
    const lat=THREE.MathUtils.degToRad(b.place.lat),lon=THREE.MathUtils.degToRad(b.place.lon);
    const target=new THREE.Vector3(310*Math.cos(lat)*Math.sin(lon),310*Math.sin(lat),310*Math.cos(lat)*Math.cos(lon));
    const origin=camera.position.clone(), current=++flight;
    const duration=matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1000, start=performance.now();
    controls.autoRotate=false;
    function move(now){ if(current!==flight)return; const t=duration ? Math.min(1,(now-start)/duration) : 1; const ease=t*t*(3-2*t);
      const direction=origin.clone().normalize().lerp(target.clone().normalize(),ease).normalize();
      if(direction.lengthSq()<.01) direction.copy(target).normalize();
      camera.position.copy(direction.multiplyScalar(310)); camera.lookAt(0,0,0); controls.update();
      if(t<1) requestAnimationFrame(move);
    }
    requestAnimationFrame(move);
  }};
}
export function createModelViewer(el) {
  const {scene,camera,controls} = setup(el); camera.position.set(2,1.5,3); let object;
  return {load(url){ new GLTFLoader().load(url, gltf => { if(object) scene.remove(object); object = gltf.scene; const box = new THREE.Box3().setFromObject(object), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()); const scale = 2 / Math.max(size.x,size.y,size.z, .001); object.position.sub(center); object.scale.setScalar(scale); object.position.multiplyScalar(scale); scene.add(object); controls.target.set(0,0,0); controls.update(); }, undefined, () => { el.setAttribute('aria-label','3D model could not be loaded'); }); }};
}
