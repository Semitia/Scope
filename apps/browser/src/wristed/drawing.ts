import * as T from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

// Screen-space strokes retain their drafting weight when the instrument is enlarged.
export function stroke(color: number, width: number, opacity = 1) {
  return new LineMaterial({ color, linewidth: width, worldUnits: false,
    alphaToCoverage: true, transparent: opacity < 1, opacity, depthWrite: false });
}

export function polyline(points: T.Vector3[], material: LineMaterial) {
  const geometry = new LineGeometry().setFromPoints(points);
  const line = new Line2(geometry, material);
  line.renderOrder = 2;
  return line;
}

/** Update an existing polyline without allocating new GPU buffers each frame. */
export function updatePolyline(line: Line2, points: T.Vector3[]) {
  const starts = line.geometry.getAttribute('instanceStart') as T.InterleavedBufferAttribute;
  const ends = line.geometry.getAttribute('instanceEnd') as T.InterleavedBufferAttribute;
  for (let i = 0; i < points.length - 1; i++) {
    starts.setXYZ(i, points[i].x, points[i].y, points[i].z);
    ends.setXYZ(i, points[i + 1].x, points[i + 1].y, points[i + 1].z);
  }
  starts.data.needsUpdate = true;
  line.geometry.computeBoundingBox();
  line.geometry.computeBoundingSphere();
}

export function circlePoints(radius = 1, z = 0, segments = 96) {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const a = i * Math.PI * 2 / segments;
    return new T.Vector3(radius * Math.cos(a), radius * Math.sin(a), z);
  });
}

/** PlotHalfRoundBlock: two transparent end faces, outlines and connecting rulings. */
export function halfRoundDrawing(length: number, width: number, height: number,
  outline: LineMaterial, ruling: LineMaterial, face: T.MeshBasicMaterial) {
  const group = new T.Group();
  const shape = new T.Shape();
  shape.moveTo(0, width / 2);
  shape.absarc(0, 0, width / 2, Math.PI / 2, Math.PI * 1.5, false);
  shape.lineTo(length, -width / 2);
  shape.lineTo(length, width / 2);
  shape.closePath();
  for (const z of [-height / 2, height / 2]) {
    const cap = new T.Mesh(new T.ShapeGeometry(shape, 48), face);
    cap.position.z = z;
    group.add(cap, polyline(shape.getPoints(48).map(p => new T.Vector3(p.x, p.y, z)), outline));
  }
  // Same seven stations on the semicircle and seven on the flat end as the source.
  const stations = Array.from({ length: 7 }, (_, i) => {
    const angle = Math.PI * i / 6;
    return [-width / 2 * Math.sin(angle), width / 2 * Math.cos(angle)];
  }).concat(Array.from({ length: 7 }, (_, i) => [length, width * (i / 6 - 0.5)]));
  const geometry = new LineSegmentsGeometry().setPositions(stations.flatMap(([x, y]) =>
    [x, y, -height / 2, x, y, height / 2]));
  const ribs = new LineSegments2(geometry, ruling);
  ribs.renderOrder = 1;
  group.add(ribs);
  return group;
}

/** Dispose geometry only: materials are shared by all parts of the instrument. */
export function disposeDrawingGeometry(group: T.Object3D) {
  group.traverse(object => (object as T.Mesh).geometry?.dispose());
  group.clear();
}
