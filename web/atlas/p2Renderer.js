import * as THREE from 'three';

const PARCHMENT = '#eadfca';
const TRUNK = '#91acb5';
const TICK = '#6d8993';

function labelTexture(text, color = '#d7e5e8', background = 'rgba(5,16,23,0.9)') {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 100;
  const context = canvas.getContext('2d');
  context.fillStyle = background; context.beginPath(); context.roundRect(2, 2, 636, 96, 18); context.fill();
  context.strokeStyle = `${color}66`; context.lineWidth = 2; context.stroke();
  context.fillStyle = color; context.font = '600 52px Inter, system-ui, sans-serif';
  context.fillText(String(text).slice(0, 62), 20, 62, 598);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function replaceLabel(sprite, text, color, scale) {
  sprite.material.map?.dispose();
  sprite.material.map = labelTexture(text, color);
  sprite.material.color.set('#ffffff'); sprite.material.needsUpdate = true;
  sprite.userData.labelText = String(text);
  if (scale) sprite.scale.set(scale.x, scale.y, 1);
}

function setLabelPixels(sprite, width, height, priority = 0) {
  sprite.userData.pixelSize = { width, height };
  sprite.userData.labelPriority = priority;
}

function lineObject(color, opacity = 0.8) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

/** Add the P2 trunk and controls visuals to the caller's only scene. */
export function createAtlasP2Renderer(scene, { earthGeometry, earthMaterial } = {}) {
  const group = new THREE.Group(); group.name = 'Atlas P2 trunk overlay'; scene.add(group);
  const trunk = lineObject(TRUNK, 0.7); group.add(trunk);
  const branches = lineObject(PARCHMENT, 0.82); group.add(branches);
  const questionAttachments = lineObject(PARCHMENT, 0.86); questionAttachments.name = 'Inactive current-world question chip attachments'; group.add(questionAttachments);
  const ticks = lineObject(TICK, 0.64); group.add(ticks);
  const presentMaterial = earthMaterial?.clone?.() || new THREE.MeshStandardMaterial({ color: '#dce9eb', roughness: 0.94 });
  const presentEarth = new THREE.Mesh(earthGeometry || new THREE.SphereGeometry(1, 48, 32), presentMaterial);
  presentEarth.name = 'Present-day Earth 2026'; presentEarth.userData.referenceYear = 2026;
  group.add(presentEarth);
  const presentLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture('PRESENT-DAY EARTH · 2026', '#d7e5e8'), transparent: true, depthWrite: false, opacity: 0 }));
  presentLabel.scale.set(1.7, 0.27, 1); group.add(presentLabel);
  const scaleLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture('LOG DISTANCE BACK FROM PRESENT (2026)', '#b7d9e3'), transparent: true, depthWrite: false, opacity: 0 }));
  scaleLabel.scale.set(2.7, 0.32, 1); group.add(scaleLabel);
  const axisLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture('DISTANCE FROM HISTORY ↑', '#b7d9e3'), transparent: true, depthWrite: false, opacity: 0 }));
  axisLabel.scale.set(1.75, 0.28, 1); group.add(axisLabel);
  setLabelPixels(presentLabel, 190, 30, 90);
  setLabelPixels(scaleLabel, 280, 28, 35);
  setLabelPixels(axisLabel, 210, 28, 80);
  let tickSprites = [], chipSprites = [], questionSprites = [], layout = null, axisMode = 'history-distance';
  let disposed = false;

  function setBaseTexture(texture) {
    if (disposed || !texture) return;
    const previous = presentMaterial.map;
    presentMaterial.map = texture.clone();
    presentMaterial.map.needsUpdate = true;
    if (previous && previous !== texture) previous.dispose();
    presentMaterial.needsUpdate = true;
  }

  function ensureSprites(collection, count, prefix) {
    while (collection.length < count) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(''), transparent: true, depthWrite: false, opacity: 0 }));
      sprite.name = `${prefix} ${collection.length + 1}`; group.add(sprite); collection.push(sprite);
    }
    while (collection.length > count) {
      const sprite = collection.pop(); group.remove(sprite); sprite.material.map?.dispose(); sprite.material.dispose();
    }
  }

  function setLinePositions(line, values) {
    const old = line.geometry.attributes.position?.array;
    if (!old || old.length !== values.length) {
      line.geometry.dispose(); line.geometry = new THREE.BufferGeometry();
      line.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(values.length), 3));
    }
    const attribute = line.geometry.attributes.position;
    attribute.array.set(values); attribute.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  }

  function update(nextLayout, {
    opacity = 0,
    axisMode: nextMode = 'history-distance',
    branchProgress = 1,
    fromBranches = null,
  } = {}) {
    if (disposed || !nextLayout) return;
    layout = nextLayout; axisMode = nextMode;
    const alpha = Math.max(0, Math.min(1, opacity));
    group.visible = alpha > 0;
    trunk.material.opacity = 0.7 * alpha;
    branches.material.opacity = 0.82 * alpha;
    ticks.material.opacity = 0.64 * alpha;
    presentEarth.visible = alpha > 0;
    presentEarth.position.set(layout.presentEarth.x, layout.presentEarth.y, -0.15);
    presentEarth.scale.setScalar(0.36 * alpha);
    presentMaterial.opacity = alpha; presentMaterial.transparent = true;
    presentMaterial.needsUpdate = true;
    presentLabel.position.set(layout.presentEarth.x, layout.presentEarth.y + 0.58, 0);
    presentLabel.material.opacity = alpha;
    scaleLabel.position.set((layout.trunk.left + layout.trunk.right) / 2, 3.52, 0);
    scaleLabel.material.opacity = alpha;
    const axisText = `${nextMode === 'history-distance' ? 'DISTANCE FROM HISTORY ↑' : nextMode === 'branch-order' ? 'BRANCH ORDER ↑' : 'THEME ↑'}`;
    if (axisLabel.userData.labelText !== axisText) replaceLabel(axisLabel, axisText, '#b7d9e3', { x: 1.75, y: 0.28 });
    axisLabel.position.set(layout.trunk.left + 0.9, 3.95, 0);
    axisLabel.material.opacity = alpha;

    setLinePositions(trunk, [layout.trunk.left, layout.trunk.y, -0.1, layout.trunk.right, layout.trunk.y, -0.1]);
    const branchValues = [];
    const foldedQuestionIds = new Set(layout.chips.map(chip => String(chip.questionId)));
    const oldById = new Map((fromBranches || []).map(branch => [branch.questionId, branch]));
    const progress = Math.max(0, Math.min(1, branchProgress));
    for (const branch of layout.questionBranches) {
      if (!branch.active && foldedQuestionIds.has(String(branch.questionId))) continue;
      if (branch.attachmentMode === 'current-world' && branch.attachment) continue;
      const prior = oldById.get(branch.questionId);
      const startY = prior ? prior.y : 0;
      const y = startY + (branch.y - startY) * progress;
      branchValues.push(branch.x, layout.trunk.y, -0.05, branch.x, y, -0.05);
    }
    setLinePositions(branches, branchValues);

    const attachmentValues = [];
    for (const branch of layout.questionBranches) {
      if (!branch.active && foldedQuestionIds.has(String(branch.questionId))) continue;
      if (branch.attachmentMode !== 'current-world' || branch.active || !branch.attachment) continue;
      const chip = layout.chips.find(item => item.questionId === branch.questionId);
      if (!chip) continue;
      attachmentValues.push(branch.attachment.from.x, branch.attachment.from.y, branch.attachment.from.z || 0, chip.x, chip.y, 0.06);
    }
    setLinePositions(questionAttachments, attachmentValues);
    questionAttachments.material.opacity = 0.86 * alpha;

    ensureSprites(questionSprites, layout.questionBranches.length, 'Question divergence token');
    layout.questionBranches.forEach((branch, index) => {
      const sprite = questionSprites[index];
      const prefix = branch.active ? 'ACTIVE QUESTION · ' : 'QUESTION · ';
      const text = `${prefix}${branch.label || branch.questionId}`;
      if (sprite.userData.labelText !== text) replaceLabel(sprite, text, PARCHMENT, { x: 2.45, y: 0.28 });
      setLabelPixels(sprite, branch.active ? 220 : 190, 30, branch.active ? 85 : 35);
      const chip = branch.attachmentMode === 'current-world' && !branch.active ? layout.chips.find(item => item.questionId === branch.questionId) : null;
      sprite.position.set(chip?.x ?? branch.labelX ?? branch.x, chip ? chip.y + 0.36 : branch.labelY ?? (branch.y + 0.34), 0.03);
      sprite.material.opacity = !branch.active && foldedQuestionIds.has(String(branch.questionId)) ? 0 : alpha;
    });

    const tickValues = [];
    for (const tick of layout.visibleTicks) tickValues.push(tick.x, layout.trunk.y - 0.04, -0.04, tick.x, layout.trunk.y - 0.19, -0.04);
    setLinePositions(ticks, tickValues);
    ensureSprites(tickSprites, layout.visibleTicks.length, 'Time tick');
    layout.visibleTicks.forEach((tick, index) => {
      const sprite = tickSprites[index];
      if (sprite.userData.labelText !== tick.label) replaceLabel(sprite, tick.label, '#c2d5db', { x: Math.max(0.62, Math.min(1.1, tick.label.length * 0.025)), y: 0.18 });
      setLabelPixels(sprite, Math.min(74, Math.max(46, tick.label.length * 7)), 22, 25);
      sprite.position.set(tick.x, -0.5, 0);
      sprite.material.opacity = alpha;
    });

    ensureSprites(chipSprites, layout.chips.length, 'Folded question chip');
    layout.chips.forEach((chip, index) => {
      const sprite = chipSprites[index];
      if (sprite.userData.labelText !== chip.label) replaceLabel(sprite, chip.label, PARCHMENT, { x: Math.min(2.2, Math.max(0.82, chip.label.length * 0.035)), y: 0.3 });
      setLabelPixels(sprite, Math.min(210, Math.max(140, chip.label.length * 7.2)), 30, 70);
      sprite.position.set(chip.x, chip.y, 0.08);
      sprite.material.opacity = alpha;
    });
  }

  function layoutLabels(camera, viewport, reservedRects = []) {
    if (disposed || !camera || !viewport?.width || !viewport?.height) return;
    camera.updateMatrixWorld(true); group.updateMatrixWorld(true);
    const labels = [presentLabel, scaleLabel, axisLabel, ...questionSprites, ...tickSprites, ...chipSprites]
      .filter(sprite => sprite.visible && sprite.material.opacity > 0.04)
      .sort((a, b) => (b.userData.labelPriority || 0) - (a.userData.labelPriority || 0)
        || String(a.userData.labelText || '').localeCompare(String(b.userData.labelText || '')));
    const cameraQuaternion = camera.getWorldQuaternion(new THREE.Quaternion());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraQuaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraQuaternion);
    const reservedTop = Math.min(138, Math.max(88, viewport.height * 0.15));
    const originX = Number(viewport.left) || 0, originY = Number(viewport.top) || 0;
    const safe = { left: originX + 8, right: originX + viewport.width - 8, top: originY + reservedTop, bottom: originY + viewport.height - 8 };
    const accepted = reservedRects.map(rect => ({ ...rect }));
    for (const sprite of labels) {
      const base = sprite.getWorldPosition(new THREE.Vector3());
      const distance = base.distanceTo(camera.getWorldPosition(new THREE.Vector3()));
      const size = sprite.userData.pixelSize || { width: 160, height: 28 };
      const width = Math.min(size.width, Math.max(80, viewport.width - 16));
      const height = size.height;
      const worldPerPixel = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / viewport.height;
      sprite.scale.set(width * worldPerPixel, height * worldPerPixel, 1);
      const projected = base.clone().project(camera);
      const originalX = originX + (projected.x + 1) * 0.5 * viewport.width;
      const originalY = originY + (1 - projected.y) * 0.5 * viewport.height;
      const offsets = [[0, 0], [0, -(height / 2 + 6)], [0, height / 2 + 6], [width / 2 + 6, 0], [-width / 2 - 6, 0], [0, -(height + 10)], [0, height + 10]];
      let chosen = null;
      for (const [dx, dy] of offsets) {
        const x = Math.min(safe.right - width / 2, Math.max(safe.left + width / 2, originalX + dx));
        const y = Math.min(safe.bottom - height / 2, Math.max(safe.top + height / 2, originalY + dy));
        const overlaps = accepted.some(other => Math.abs(other.x - x) < (other.width + width) / 2 + 3
          && Math.abs(other.y - y) < (other.height + height) / 2 + 3);
        if (!overlaps) { chosen = { x, y, width, height }; break; }
      }
      if (!chosen || projected.z < -1 || projected.z > 1) { sprite.material.opacity = 0; continue; }
      const dx = chosen.x - originalX, dy = chosen.y - originalY;
      const world = base.addScaledVector(right, dx * worldPerPixel).addScaledVector(up, -dy * worldPerPixel);
      sprite.position.copy(group.worldToLocal(world));
      accepted.push(chosen);
    }
  }

  function dispose() {
    if (disposed) return; disposed = true; group.removeFromParent();
    group.traverse(object => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) { material?.map?.dispose?.(); material?.dispose?.(); }
    });
  }

  return {
    update, layoutLabels, dispose, group, presentEarth, setBaseTexture,
    getQuestionChipTargets: () => chipSprites.map((sprite, index) => ({ chip: layout?.chips?.[index] || null, sprite })),
  };
}
