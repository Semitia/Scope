import * as T from 'three';
import { circlePoints, disposeDrawingGeometry, halfRoundDrawing, polyline, stroke, updatePolyline } from './drawing';
import { createContinuumSurface } from './continuumSurface';
import { createCameraControls } from './cameraControls';
import { createRigidModel, type ModelStatus } from './rigidModel';
import type { InstrumentAppearance, Psi, WristedDimensions } from './config';
import { positionOf, rx, ry, segmentFrame, tz, wristedFrames } from './kinematics';

const STEPS = 128;
function setFrame(object: T.Object3D, frame: T.Matrix4) {
  object.matrixAutoUpdate = false;
  object.matrix.copy(frame);
  object.matrixWorldNeedsUpdate = true;
}

export function createWristedScene(host: HTMLDivElement, onModelStatus: (status: ModelStatus) => void = () => {}) {
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xffffff, 1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.NoToneMapping;
  renderer.domElement.setAttribute('aria-label', 'Interactive wristed instrument 3D view');
  renderer.domElement.setAttribute('role', 'img');
  host.appendChild(renderer.domElement);
  const scene = new T.Scene();
  const model = new T.Group();
  scene.add(model);
  scene.add(new T.HemisphereLight(0xffffff, 0x6b7480, 2.6));
  const keyLight = new T.DirectionalLight(0xfff3e1, 3.2);
  keyLight.position.set(80, -120, 160); scene.add(keyLight);
  const fillLight = new T.DirectionalLight(0xd8eaff, 2.4);
  fillLight.position.set(-100, 60, 50); scene.add(fillLight);
  const camera = new T.PerspectiveCamera(35, 1, 0.01, 100000);
  camera.up.set(0, 0, 1);
  // Keep native events inside the canvas. Other listeners on this same target
  // (camera controls) still receive them; browser defaults and ancestor handlers do not.
  const isolatedEvents = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel',
    'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'auxclick',
    'contextmenu', 'wheel', 'dragstart', 'selectstart', 'gesturestart', 'gesturechange', 'gestureend'];
  const isolate = (event: Event) => {
    if (event.type === 'wheel' && !(event as WheelEvent).ctrlKey) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };
  isolatedEvents.forEach(type => renderer.domElement.addEventListener(type, isolate, { passive: false }));
  const grid = new T.GridHelper(200, 20, 0x8195a9, 0x9dadbd);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -2;
  (grid.material as T.Material).transparent = true;
  (grid.material as T.Material).opacity = 0.2;
  scene.add(grid);
  const axes = new T.AxesHelper(18); scene.add(axes);
  const endFrame = new T.Group();
  endFrame.name = 'end-effector-frame';
  model.add(endFrame);
  const axisTextures: T.CanvasTexture[] = [];
  const axisDirections = [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)];
  [0xc64b45, 0x23906c, 0x387bd1].forEach((color, i) => {
    const direction = axisDirections[i];
    const arrow = new T.ArrowHelper(direction, new T.Vector3(), 8, color, 1, 0.5);
    // Keep the local frame readable through the transparent joint outlines.
    arrow.traverse(object => {
      object.renderOrder = 4;
      const material = (object as T.Mesh).material;
      if (material) for (const m of Array.isArray(material) ? material : [material]) {
        m.depthTest = false; m.depthWrite = false;
      }
    });
    endFrame.add(arrow);
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = labelCanvas.height = 96;
    const context = labelCanvas.getContext('2d')!;
    context.font = '600 64px sans-serif';
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.fillText(['X', 'Y', 'Z'][i], 48, 48);
    const texture = new T.CanvasTexture(labelCanvas);
    texture.colorSpace = T.SRGBColorSpace;
    axisTextures.push(texture);
    const label = new T.Sprite(new T.SpriteMaterial({ map: texture, depthTest: false,
      depthWrite: false, sizeAttenuation: false, transparent: true }));
    label.position.copy(direction).multiplyScalar(9.5);
    label.scale.set(0.024, 0.024, 1);
    label.renderOrder = 5;
    endFrame.add(label);
  });
  const backboneStroke = stroke(0x245b80, 1.15);
  const blueOutline = stroke(0x184e87, 1.35);
  const blueRuling = stroke(0x376a9a, 0.85, 0.72);
  const pinkOutline = stroke(0x9d316c, 1.35);
  const pinkRuling = stroke(0xb45b89, 0.85, 0.72);
  const jawStroke = stroke(0x234a69, 3);
  const faceMaterial = (color: number, opacity: number) => new T.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: T.DoubleSide,
  });
  const blueFace = faceMaterial(0x3675af, 0.09);
  const pinkFace = faceMaterial(0xb24f84, 0.09);
  const discMaterial = faceMaterial(0x4488b5, 0.12);
  const centerMaterial = new T.LineDashedMaterial({ color: 0x859ba9, dashSize: 1.4, gapSize: 1.4 });
  const discGeometry = new T.CircleGeometry(1, 96);
  const sleeveMaterial = new T.MeshStandardMaterial({ color: 0x08090a, roughness: 0.85, metalness: 0 });
  const sections = Array.from({ length: 3 }, (_, sectionIndex) => {
    const group = new T.Group(); model.add(group);
    const backbones = Array.from({ length: 8 }, () => {
      const line = polyline(Array.from({ length: STEPS + 1 }, () => new T.Vector3()), backboneStroke);
      (line.geometry.getAttribute('instanceStart') as T.InterleavedBufferAttribute).data.setUsage(T.DynamicDrawUsage);
      group.add(line); return line;
    });
    const discs = Array.from({ length: 2 }, () => {
      const disc = new T.Group();
      disc.add(polyline(circlePoints(), blueOutline));
      // PlotLink1 uses unfilled end circles; flexible sections use transparent faces.
      if (sectionIndex !== 2) disc.add(new T.Mesh(discGeometry, discMaterial));
      group.add(disc); return disc;
    });
    const center = new T.Line(new T.BufferGeometry().setAttribute('position',
      new T.BufferAttribute(new Float32Array((STEPS + 1) * 3), 3)), centerMaterial);
    center.frustumCulled = false; group.add(center);
    const sleeve = sectionIndex < 2 ? createContinuumSurface(STEPS, sleeveMaterial) : undefined;
    if (sleeve) model.add(sleeve.mesh);
    return { group, backbones, discs, center, sleeve, active: false };
  });
  const blocks = Array.from({ length: 3 }, () => {
    const group = new T.Group(); model.add(group); return group;
  });
  const jaws = [0, 1].map(() => {
    const line = polyline([new T.Vector3(), new T.Vector3(0, 0, 1)], jawStroke);
    model.add(line); return line;
  });
  let dimensionKey = '';
  let pendingFrame = 0;
  let disposed = false;
  const render = () => {
    if (!pendingFrame && !disposed) pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0; renderer.render(scene, camera);
    });
  };
  let appearance: InstrumentAppearance = 'lines';
  let modelStatus: ModelStatus = 'loading';
  const rigid = createRigidModel(status => {
    modelStatus = status;
    applyAppearance();
    onModelStatus(status);
    if (status === 'ready' && appearance === 'model') fit();
  });
  model.add(rigid.root);
  function applyAppearance() {
    const solid = appearance === 'model' && modelStatus === 'ready';
    rigid.root.visible = solid;
    blocks.forEach(block => { block.visible = !solid; });
    jaws.forEach(jaw => { jaw.visible = !solid; });
    sections.forEach(section => {
      section.group.visible = !solid && section.active;
      if (section.sleeve) section.sleeve.mesh.visible = solid && section.active;
    });
    renderer.domElement.dataset.appearance = solid ? 'model' : 'lines';
    renderer.domElement.dataset.modelStatus = modelStatus;
    render();
  }
  applyAppearance();
  const controls = createCameraControls(camera, renderer.domElement, render);
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(Math.max(1, width), Math.max(1, height));
    camera.aspect = Math.max(1, width) / Math.max(1, height);
    camera.updateProjectionMatrix(); render();
  };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  let initialized = false;
  function fit(wristOnly = false) {
    model.updateMatrixWorld(true);
    const box = new T.Box3();
    // Hidden retracted sections must not keep the camera framed around an old pose.
    for (const root of wristOnly ? (rigid.root.visible ? [...rigid.wristRoots(), endFrame] : [...blocks, ...jaws, endFrame]) : [model]) root.traverseVisible(object => {
      const geometry = (object as T.Mesh).geometry;
      if (!geometry) return;
      geometry.computeBoundingBox();
      if (geometry.boundingBox) box.union(geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    });
    const center = box.getCenter(new T.Vector3());
    const radius = Math.max(15, box.getSize(new T.Vector3()).length() / 2);
    const halfFov = Math.min(T.MathUtils.degToRad(camera.fov / 2), Math.atan(Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
    controls.target.copy(center);
    camera.up.set(0, 0, 1);
    camera.position.copy(center).add(new T.Vector3(1.2, -1.8, 0.9).normalize().multiplyScalar(radius / Math.sin(halfFov) * 1.15));
    camera.lookAt(center); controls.update(); render();
  }
  function update(psi: Psi, angle: number, d: WristedDimensions) {
    const f = wristedFrames(psi, angle, d);
    const nextKey = JSON.stringify(d);
    const dimensionsChanged = dimensionKey !== nextKey;
    if (dimensionsChanged) {
      dimensionKey = nextKey;
      [halfRoundDrawing(3, 6, 6, blueOutline, blueRuling, blueFace),
        halfRoundDrawing(d.link2 / 2 + 2, 4, 3, pinkOutline, pinkRuling, pinkFace),
        halfRoundDrawing(d.link2 / 2, 5, 4, pinkOutline, pinkRuling, pinkFace)]
        .forEach((drawing, i) => { disposeDrawingGeometry(blocks[i]); blocks[i].add(drawing); });
    }
    const descriptions = [
      { length: f.l0, theta: f.theta0, base: f.base, radius: d.radius },
      { length: f.l1, theta: f.theta1, base: f.tip0, radius: d.radius },
      { length: d.link1 - 3, theta: 0, base: f.tip1, radius: d.radius * 4 / 4.2 },
    ];
    descriptions.forEach(({ length, theta, base, radius }, sectionIndex) => {
      const section = sections[sectionIndex];
      section.active = length > 1e-7;
      if (!section.active) return;
      const frames = Array.from({ length: STEPS + 1 }, (_, i) => base.clone().multiply(segmentFrame(length, theta, f.delta, i / STEPS)));
      section.sleeve?.update(frames, radius);
      const centerPositions = section.center.geometry.getAttribute('position');
      frames.forEach((frame, i) => { const p = positionOf(frame); centerPositions.setXYZ(i, p.x, p.y, p.z); });
      centerPositions.needsUpdate = true; section.center.computeLineDistances();
      section.center.visible = sectionIndex !== 2;
      section.backbones.forEach((line, backbone) => {
        const beta = backbone * Math.PI / 4;
        const points = frames.map(frame => new T.Vector3(radius * Math.cos(beta), radius * Math.sin(beta), 0).applyMatrix4(frame));
        updatePolyline(line, points);
      });
      section.discs.forEach((disc, i) => setFrame(disc, frames[i === 0 ? 0 : STEPS].clone().scale(new T.Vector3(radius, radius, 1))));
    });
    setFrame(blocks[0], f.link1.clone().multiply(ry(Math.PI / 2)));
    setFrame(blocks[1], f.wrist1.clone().multiply(tz(d.link2)).multiply(ry(Math.PI / 2)).multiply(rx(Math.PI / 2)));
    setFrame(blocks[2], f.wrist1.clone().multiply(ry(-Math.PI / 2)));
    [f.jawLeft, f.jawRight].forEach((frame, i) => setFrame(jaws[i], frame.clone().scale(new T.Vector3(1, 1, d.jawLength))));
    setFrame(endFrame, f.wrist2);
    rigid.update(f, d);
    applyAppearance();
    if (!initialized || dimensionsChanged) { initialized = true; fit(); }
    render();
    return positionOf(f.wrist2);
  }
  return { update, fit, setAxesVisible(visible: boolean) {
    axes.visible = visible;
    endFrame.visible = visible;
    render();
  }, setAppearance(value: InstrumentAppearance) {
    appearance = value; applyAppearance();
    if (initialized) fit();
  }, focusWrist: () => fit(true), dispose() {
    disposed = true; cancelAnimationFrame(pendingFrame); observer.disconnect(); controls.dispose();
    isolatedEvents.forEach(type => renderer.domElement.removeEventListener(type, isolate));
    rigid.dispose();
    const geometries = new Set<T.BufferGeometry>();
    const materials = new Set<T.Material>();
    scene.traverse(object => {
      const mesh = object as T.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => materials.add(m));
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    axisTextures.forEach(texture => texture.dispose());
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  } };
}
