import { POSE_LABELS, type WristedSettings } from './config';

export interface WristedBindingGroup {
  id: string;
  label: string;
  bindings: WristedSettings['bindings'];
}

/** Match complete groups only, keeping every input in the same namespace. */
export function wristedBindingGroups(channelKeys: string[]): WristedBindingGroup[] {
  const keys = new Set(channelKeys);
  const prefixes = new Set(channelKeys.map(key => key.slice(0, key.lastIndexOf('.') + 1)));
  const groups: WristedBindingGroup[] = [];
  for (const prefix of [...prefixes].sort()) {
    const name = prefix.slice(0, -1) || 'Root';
    const named = POSE_LABELS.map(field => prefix + field) as WristedSettings['bindings'];
    if (named.every(key => keys.has(key))) groups.push({ id: `named:${prefix}`, label: `${name} · named`, bindings: named });
    const numbered = POSE_LABELS.map((_, i) => `${prefix}${i}`) as WristedSettings['bindings'];
    const numberCount = channelKeys.filter(key => key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length))).length;
    if (numberCount === 7 && numbered.every(key => keys.has(key))) {
      groups.push({ id: `vector:${prefix}`, label: `${name} · vector [0…6]`, bindings: numbered });
    }
    // Existing six-component psi producers can still bind their separate jaw input.
    if (prefix.endsWith('psi.')) {
      const parent = prefix.slice(0, -4);
      const jaw = [parent + 'alpha', parent + 'angle'].find(key => keys.has(key));
      const psi = numbered.slice(0, 6);
      if (numberCount === 6 && jaw && psi.every(key => keys.has(key))) {
        groups.push({ id: `psi:${prefix}`, label: `${name} + ${jaw}`, bindings: [...psi, jaw] as WristedSettings['bindings'] });
      }
    }
  }
  return groups;
}
