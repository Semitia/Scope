import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import instrumentUrl from './models/instrument.glb?url';
import type { WristedDimensions } from './config';
import type { wristedFrames } from './kinematics';

export type ModelStatus = 'loading' | 'ready' | 'error';
const PART_NAMES = ['housing', 'shaft', 'mount', 'wrist', 'jawLeft', 'jawRight'] as const;
type PartName = typeof PART_NAMES[number];
type Frames = ReturnType<typeof wristedFrames>;

export function disposeModel(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  root.traverse(object => {
    const mesh = object as T.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => materials.add(m));
  });
  geometries.forEach(g => g.dispose());
  materials.forEach(m => m.dispose());
}

/** Each Blender part is exported in native Z-up millimetres with its pivot at zero. */
export function createRigidModel(changed: (status: ModelStatus) => void) {
  const root = new T.Group();
  root.name = 'rigid-instrument';
  let parts: Record<PartName, T.Object3D> | undefined;
  let disposed = false;
  let latest: { frames: Frames; dimensions: WristedDimensions } | undefined;
  function update(f: Frames, d: WristedDimensions) {
    latest = { frames: f, dimensions: d };
    if (!parts) return;
    const place = (name: PartName, frame: T.Matrix4, scale: T.Vector3) => {
      const part = parts![name];
      part.matrixAutoUpdate = false;
      part.matrix.copy(frame).scale(scale);
      part.matrixWorldNeedsUpdate = true;
    };
    const radial = d.radius / 4.2;
    place('housing', new T.Matrix4(), new T.Vector3(radial, radial, radial));
    // Shaft and fixed clevis follow the same rolled frame as the first wrist pivot.
    const shaftFrame = f.link1.clone().multiply(new T.Matrix4().makeTranslation(0, 0, -d.link1));
    place('shaft', shaftFrame, new T.Vector3(radial, radial, (d.link1 - 3) / 39.4));
    place('mount', f.link1, new T.Vector3(radial, radial, Math.min(radial, d.link1 / 6)));
    place('wrist', f.wrist1, new T.Vector3(radial, radial, d.link2 / 8.89));
    place('jawLeft', f.jawLeft, new T.Vector3(radial, radial, d.jawLength / 9));
    place('jawRight', f.jawRight, new T.Vector3(radial, radial, d.jawLength / 9));
  }
  new GLTFLoader().load(instrumentUrl, gltf => {
    if (disposed) { disposeModel(gltf.scene); return; }
    const found = PART_NAMES.map(name => gltf.scene.getObjectByName(name));
    if (found.some(part => !part)) {
      disposeModel(gltf.scene); changed('error'); return;
    }
    parts = Object.fromEntries(PART_NAMES.map((name, i) => [name, found[i]!])) as Record<PartName, T.Object3D>;
    root.add(gltf.scene);
    if (latest) update(latest.frames, latest.dimensions);
    changed('ready');
  }, undefined, () => { if (!disposed) changed('error'); });
  return { root, update,
    wristRoots: () => parts ? [parts.mount, parts.wrist, parts.jawLeft, parts.jawRight] : [],
    dispose() { disposed = true; disposeModel(root); root.clear(); },
  };
}
