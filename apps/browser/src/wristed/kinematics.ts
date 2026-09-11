import { Matrix4, Vector3 } from 'three';
import type { Psi, WristedDimensions } from './config';

export const rx = (a: number) => new Matrix4().makeRotationX(a);
export const ry = (a: number) => new Matrix4().makeRotationY(a);
export const rz = (a: number) => new Matrix4().makeRotationZ(a);
export const tz = (z: number) => new Matrix4().makeTranslation(0, 0, z);

/** Constant-curvature frame, matching calcSegR / PlotSeg (mm, radians). */
export function segmentFrame(length: number, theta: number, delta: number, fraction = 1): Matrix4 {
  const a = theta * fraction;
  // Stable at zero and for tiny bends; 1-cos(a) would lose precision.
  const sinc = Math.abs(a) < 1e-5 ? 1 - a * a / 6 : Math.sin(a) / a;
  const cosc = Math.abs(a) < 1e-5 ? a / 2 - a ** 3 / 24 : 2 * Math.sin(a / 2) ** 2 / a;
  return rz(delta).multiply(ry(a)).multiply(rz(-delta)).setPosition(
    length * fraction * cosc * Math.cos(delta),
    length * fraction * cosc * Math.sin(delta), length * fraction * sinc,
  );
}
export function wristedFrames(psi: Psi, angle: number, d: WristedDimensions) {
  const [insertion, phi, theta, delta, beta1, beta2] = psi;
  const exposed = insertion + d.insertionOffset;
  const l0 = Math.max(0, exposed - d.segment - d.link1 - d.link2);
  const l1 = Math.min(Math.max(0, exposed - d.link1 - d.link2), d.segment);
  const denominator = d.zeta * l0 + l1;
  const theta0 = denominator > 0 ? theta * d.zeta * l0 / denominator : 0;
  const theta1 = denominator > 0 ? theta * l1 / denominator : 0;
  const base = rz(phi);
  const tip0 = base.clone().multiply(segmentFrame(l0, theta0, delta));
  const tip1 = tip0.clone().multiply(segmentFrame(l1, theta1, delta));
  const link1 = tip1.clone().multiply(tz(d.link1)).multiply(rz(d.wristRotation));
  const wrist1 = link1.clone().multiply(rx(beta1));
  const wrist2 = wrist1.clone().multiply(tz(d.link2)).multiply(ry(beta2));
  const jawLeft = wrist2.clone().multiply(ry(angle / 2));
  const jawRight = wrist2.clone().multiply(ry(-angle / 2));
  return { l0, l1, theta0, theta1, delta, base, tip0, tip1, link1, wrist1, wrist2,
    jawLeft, jawRight, tipLeft: jawLeft.clone().multiply(tz(d.jawLength)),
    tipRight: jawRight.clone().multiply(tz(d.jawLength)) };
}
export const positionOf = (frame: Matrix4) => new Vector3().setFromMatrixPosition(frame);
