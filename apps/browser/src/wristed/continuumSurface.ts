import * as T from 'three';

/** Closed sleeve swept along the existing constant-curvature frames (world mm). */
export function createContinuumSurface(steps: number, material: T.Material) {
  const sides = 32;
  const sideVertices = (steps + 1) * sides;
  const vertexCount = sideVertices + 2 * (sides + 1);
  const geometry = new T.BufferGeometry();
  const positions = new T.BufferAttribute(new Float32Array(vertexCount * 3), 3).setUsage(T.DynamicDrawUsage);
  const normals = new T.BufferAttribute(new Float32Array(vertexCount * 3), 3).setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('position', positions);
  geometry.setAttribute('normal', normals);
  const indices: number[] = [];
  for (let i = 0; i < steps; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides;
    indices.push(a, b, a + sides, b, b + sides, a + sides);
  }
  // Separate cap vertices keep the end faces flat, with outward-facing normals.
  for (let end = 0; end < 2; end++) {
    const center = sideVertices + end * (sides + 1);
    for (let j = 0; j < sides; j++) {
      const a = center + 1 + j, b = center + 1 + (j + 1) % sides;
      indices.push(center, end === 0 ? b : a, end === 0 ? a : b);
    }
  }
  geometry.setIndex(indices);
  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'black-continuum-sleeve';
  mesh.visible = false;
  const radial = Array.from({ length: sides }, (_, j) =>
    new T.Vector3(Math.cos(j * Math.PI * 2 / sides), Math.sin(j * Math.PI * 2 / sides), 0));
  const point = new T.Vector3(), normal = new T.Vector3();
  return { mesh, update(frames: T.Matrix4[], radius: number) {
    frames.forEach((frame, i) => {
      radial.forEach((direction, j) => {
        point.copy(direction).multiplyScalar(radius).applyMatrix4(frame);
        normal.copy(direction).transformDirection(frame);
        positions.setXYZ(i * sides + j, point.x, point.y, point.z);
        normals.setXYZ(i * sides + j, normal.x, normal.y, normal.z);
      });
    });
    for (let end = 0; end < 2; end++) {
      const row = end === 0 ? 0 : steps;
      const center = sideVertices + end * (sides + 1);
      point.setFromMatrixPosition(frames[row]);
      normal.set(0, 0, end === 0 ? -1 : 1).transformDirection(frames[row]);
      positions.setXYZ(center, point.x, point.y, point.z);
      for (let j = 0; j <= sides; j++) {
        normals.setXYZ(center + j, normal.x, normal.y, normal.z);
        if (j < sides) positions.copyAt(center + 1 + j, positions, row * sides + j);
      }
    }
    positions.needsUpdate = normals.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  } };
}
