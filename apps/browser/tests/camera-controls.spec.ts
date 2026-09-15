import { expect, test } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { createCameraControls } from '../src/wristed/cameraControls';

function fixture() {
  const target = new EventTarget();
  const captured = new Set<number>();
  const canvas = Object.assign(target, {
    clientHeight: 400,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
  }) as unknown as HTMLCanvasElement;
  const camera = new PerspectiveCamera(35, 1, .01, 10000);
  camera.position.set(0, 0, 100);
  const controls = createCameraControls(camera, canvas, () => {});
  controls.update();
  const pointer = (type: string, x: number, y: number, button = 0) => canvas.dispatchEvent(Object.assign(new Event(type), {
    pointerId: 1, clientX: x, clientY: y, button,
  }));
  const drag = (from: number[], to: number[], button = 0) => {
    pointer('pointerdown', from[0], from[1], button);
    for (let i = 1; i <= 20; i++) pointer('pointermove', from[0] + (to[0] - from[0]) * i / 20, from[1] + (to[1] - from[1]) * i / 20, button);
    pointer('pointerup', to[0], to[1], button);
  };
  return { camera, controls, drag };
}

test('trackball crosses poles, preserves distance, and reverses without snapping', () => {
  const { camera, controls, drag } = fixture();
  for (let i = 0; i < 3; i++) drag([200, 200], [200, 50]);
  expect(camera.position.z).toBeLessThan(0);
  expect(camera.up.y).toBeLessThan(0);
  expect(camera.position.distanceTo(controls.target)).toBeCloseTo(100, 8);
  for (let i = 0; i < 3; i++) drag([200, 50], [200, 200]);
  expect(camera.position.distanceTo(new Vector3(0, 0, 100))).toBeLessThan(1e-8);
  expect(camera.up.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-8);
  controls.dispose();
});

test('edge dragging rolls the camera and panning preserves its orientation', () => {
  const { camera, controls, drag } = fixture();
  drag([350, 200], [200, 50]);
  expect(Math.abs(camera.up.x)).toBeGreaterThan(.2);
  const orientation = camera.quaternion.clone();
  const offset = camera.position.clone().sub(controls.target);
  drag([200, 200], [240, 230], 2);
  expect(controls.target.length()).toBeGreaterThan(0);
  expect(camera.quaternion.angleTo(orientation)).toBeLessThan(1e-7);
  expect(camera.position.clone().sub(controls.target).distanceTo(offset)).toBeLessThan(1e-8);
  controls.dispose();
});
