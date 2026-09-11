import { Matrix4, PerspectiveCamera, Quaternion, Spherical, Vector2, Vector3 } from 'three';

/** Canvas-local orbit/pan/zoom: pointer capture keeps drags off document handlers. */
export function createCameraControls(camera: PerspectiveCamera, canvas: HTMLCanvasElement, changed: () => void) {
  const target = new Vector3();
  const upToY = new Quaternion().setFromUnitVectors(camera.up, new Vector3(0, 1, 0));
  const yToUp = upToY.clone().invert();
  const pointers = new Map<number, Vector2>();
  let mode: 'orbit' | 'pan' | 'zoom' = 'orbit';
  const update = () => { camera.lookAt(target); camera.updateMatrixWorld(); changed(); };
  const pan = (dx: number, dy: number) => {
    const scale = 2 * camera.position.distanceTo(target) * Math.tan(camera.fov * Math.PI / 360) / Math.max(canvas.clientHeight, 1);
    const matrix: Matrix4 = camera.matrixWorld;
    const delta = new Vector3().setFromMatrixColumn(matrix, 0).multiplyScalar(-dx * scale)
      .addScaledVector(new Vector3().setFromMatrixColumn(matrix, 1), dy * scale);
    target.add(delta); camera.position.add(delta);
  };
  const zoom = (amount: number) => {
    const offset = camera.position.clone().sub(target);
    offset.setLength(Math.min(50000, Math.max(2, offset.length() * Math.exp(Math.max(-2, Math.min(2, amount))))));
    camera.position.copy(target).add(offset);
  };
  const down = (event: PointerEvent) => {
    if (event.button < 0 || event.button > 2) return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, new Vector2(event.clientX, event.clientY));
    mode = event.button === 2 || event.shiftKey || event.ctrlKey || event.metaKey ? 'pan' : event.button === 1 ? 'zoom' : 'orbit';
  };
  const move = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = new Vector2(event.clientX, event.clientY);
    const delta = next.clone().sub(previous);
    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
    if (other) {
      const before = previous.distanceTo(other), after = next.distanceTo(other);
      if (before > 0 && after > 0) zoom(Math.log(before / after));
      pan(delta.x / 2, delta.y / 2);
    } else if (mode === 'pan') pan(delta.x, delta.y);
    else if (mode === 'zoom') zoom(delta.y * 0.01);
    else {
      const offset = camera.position.clone().sub(target).applyQuaternion(upToY);
      const spherical = new Spherical().setFromVector3(offset);
      spherical.theta -= delta.x * 2 * Math.PI / Math.max(canvas.clientHeight, 1);
      spherical.phi -= delta.y * 2 * Math.PI / Math.max(canvas.clientHeight, 1);
      spherical.makeSafe();
      camera.position.copy(target).add(offset.setFromSpherical(spherical).applyQuaternion(yToUp));
    }
    pointers.set(event.pointerId, next); update();
  };
  const end = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    zoom(event.deltaY * unit * 0.001); update();
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('wheel', wheel, { passive: false });
  return { target, update, dispose() {
    for (const id of pointers.keys()) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    pointers.clear();
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', end);
    canvas.removeEventListener('pointercancel', end);
    canvas.removeEventListener('lostpointercapture', end);
    canvas.removeEventListener('wheel', wheel);
  } };
}
