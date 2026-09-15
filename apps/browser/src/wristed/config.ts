export type Psi = [number, number, number, number, number, number];
export interface WristedDimensions {
  segment: number;
  link1: number;
  link2: number;
  zeta: number;
  insertionOffset: number;
  wristRotation: number;
  radius: number;
  jawLength: number;
}
export type InstrumentAppearance = 'lines' | 'model';
export interface WristedSettings {
  appearance: InstrumentAppearance;
  showAxes: boolean;
  dimensions: WristedDimensions;
  psi: Psi;
  angle: number;
  bindings: [string, string, string, string, string, string, string];
  angleUnit: 'rad' | 'deg';
}
export const DEFAULT_WRISTED: WristedSettings = {
  appearance: 'lines',
  showAxes: true,
  dimensions: { segment: 100, link1: 42.4, link2: 8.89, zeta: 0.15,
    insertionOffset: 8, wristRotation: 1.3, radius: 4.2, jawLength: 9 },
  psi: [160, 0, 0.7, 0.3, 0.25, -0.2], angle: Math.PI / 6,
  bindings: ['', '', '', '', '', '', ''], angleUnit: 'rad',
};
export const POSE_LABELS = ['l', 'phi', 'theta1', 'delta1', 'beta1', 'beta2', 'alpha'] as const;
export const DIMENSION_FIELDS: [keyof WristedDimensions, string, number, number][] = [
  ['segment', 'Segment · mm', 0.01, 2000], ['link1', 'Link 1 · mm', 3.01, 1000],
  ['link2', 'Link 2 · mm', 0.01, 1000], ['radius', 'Backbone radius · mm', 0.1, 100],
  ['jawLength', 'Jaw length · mm', 0.1, 500], ['zeta', 'Coupling ζ', 0, 10],
  ['insertionOffset', 'Insertion offset d · mm', 0, 1000], ['wristRotation', 'Wrist rotation γ · rad', -Math.PI * 2, Math.PI * 2],
];
export function parseWristedSettings(raw: unknown, strict = false): WristedSettings {
  const fallback = () => structuredClone(DEFAULT_WRISTED);
  if (!raw || typeof raw !== 'object') {
    if (strict) throw new Error('Wristed instrument settings are missing.');
    return fallback();
  }
  const v = raw as WristedSettings;
  const valid = v.dimensions && DIMENSION_FIELDS.every(([key, , min, max]) =>
    Number.isFinite(v.dimensions[key]) && v.dimensions[key] >= min && v.dimensions[key] <= max)
    && Array.isArray(v.psi) && v.psi.length === 6 && v.psi.every(Number.isFinite)
    && Math.abs(v.psi[0]) <= 10000 && v.psi.slice(1).every(x => Math.abs(x) <= 36000)
    && Number.isFinite(v.angle) && Math.abs(v.angle) <= 36000
    && Array.isArray(v.bindings) && v.bindings.length === 7
    && v.bindings.every(x => typeof x === 'string' && x.length <= 1024)
    && (v.angleUnit === 'rad' || v.angleUnit === 'deg')
    && (v.appearance === undefined || v.appearance === 'lines' || v.appearance === 'model')
    && (v.showAxes === undefined || typeof v.showAxes === 'boolean');
  if (!valid) {
    if (strict) throw new Error('Wristed instrument dimensions, pose, or bindings are invalid.');
    return fallback();
  }
  return { ...structuredClone(v), appearance: v.appearance ?? 'lines', showAxes: v.showAxes ?? true };
}
