import { useEffect, useRef, useState } from 'react';
import { Focus, RotateCcw, Settings2, X } from 'lucide-react';
import type { ChannelDefinition } from '../types';
import type { WristedPanelDefinition } from '../panelTypes';
import { DIMENSION_FIELDS, POSE_LABELS, type Psi, type WristedSettings } from '../wristed/config';
import { wristedBindingGroups } from '../wristed/bindings';
import { FloatingPanel, panelAnchor } from './FloatingPanel';
import type { ModelStatus } from '../wristed/rigidModel';
import { createWristedScene } from '../wristed/scene';

const POSE_SYMBOLS = ['l', 'φ', 'θ₁', 'δ₁', 'β₁', 'β₂', 'α'];

interface Props {
  panel: WristedPanelDefinition;
  channels: ChannelDefinition[];
  latest: number[];
  channelIndexes: Map<string, number>;
  paused: boolean;
  onChange: (patch: Partial<WristedPanelDefinition>) => void;
}

export default function WristedInstrumentPanel({ panel, channels, latest, channelIndexes, paused, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createWristedScene> | null>(null);
  const [error, setError] = useState('');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('loading');
  const [editing, setEditing] = useState(false);
  const [tip, setTip] = useState([0, 0, 0]);
  const settings = panel.wristed;
  const bindingGroups = wristedBindingGroups(channels.map(channel => channel.key));
  const selectedGroup = bindingGroups.find(group => group.bindings.every((key, i) => settings.bindings[i] === key));
  const frozenValues = useRef<number[]>([]);
  const bound = settings.bindings.filter(Boolean).length;
  const unavailable: string[] = [];
  const incoming = [...settings.psi, settings.angle].map((manual, i) => {
    const key = settings.bindings[i];
    if (!key) return manual;
    const channel = channels.find(c => c.key === key);
    const index = channel ? channelIndexes.get(channel.id) : undefined;
    const value = index === undefined ? undefined : latest[index];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      unavailable.push(POSE_LABELS[i]); return NaN;
    }
    return value;
  });
  if (!paused || frozenValues.current.length === 0) frozenValues.current = incoming;
  // Manual controls remain usable while capture is paused.
  const values = incoming.map((v, i) => paused && settings.bindings[i] ? frozenValues.current[i] : v);
  const scale = settings.angleUnit === 'deg' ? Math.PI / 180 : 1;
  const converted = values.map((v, i) => i === 0 ? v : v * scale);
  const valid = converted.every(Number.isFinite) && Math.abs(converted[0]) <= 10000
    && converted.slice(1).every(v => Math.abs(v) <= Math.PI * 200);
  const poseKey = JSON.stringify(converted);
  const dimensionsKey = JSON.stringify(settings.dimensions);
  useEffect(() => {
    if (!host.current) return;
    try { scene.current = createWristedScene(host.current, setModelStatus); }
    catch { setError('3D rendering is unavailable. Enable WebGL 2 / hardware acceleration and reopen this panel.'); }
    return () => { scene.current?.dispose(); scene.current = null; };
  }, []);
  useEffect(() => {
    if (!valid || !scene.current) return;
    const point = scene.current.update(converted.slice(0, 6) as Psi, converted[6], settings.dimensions);
    setTip(point.toArray());
    // Pose and dimensions are compared by value to avoid updating meshes on unrelated telemetry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poseKey, dimensionsKey, valid]);
  useEffect(() => { scene.current?.setAppearance(settings.appearance ?? 'lines'); }, [settings.appearance]);
  useEffect(() => { scene.current?.setAxesVisible(settings.showAxes ?? true); }, [settings.showAxes]);
  const update = (patch: Partial<WristedSettings>) => {
    const wristed = { ...settings, ...patch };
    onChange({ wristed, channelKeys: [...new Set(wristed.bindings.filter(Boolean))] });
  };
  return <div className="wristed-stage">
    <div className="wristed-viewport" ref={host} />
    <div className="wristed-topbar">
      <span className={`wristed-status${!valid ? ' waiting' : ''}`} role="status">
        {error ? '3D UNAVAILABLE' : !valid ? 'WAITING / INVALID INPUT' : paused && bound ? 'PAUSED' : bound ? `LIVE · ${bound}/7 BOUND` : 'MANUAL PREVIEW'}
      </span>
      <div>
        <button type="button" aria-label="Show coordinate axes" aria-pressed={settings.showAxes ?? true}
          title="Show or hide world and end-effector coordinate axes"
          onClick={() => update({ showAxes: !(settings.showAxes ?? true) })}>坐标系</button>
        <button type="button" className="wristed-appearance" aria-label="Use instrument model" aria-pressed={settings.appearance === 'model'}
          title="Switch between line drawing and rigid model" onClick={() => update({ appearance: settings.appearance === 'model' ? 'lines' : 'model' })}>
          {settings.appearance === 'model' ? '模型' : '线条'}
        </button>
        <button type="button" onClick={() => scene.current?.focusWrist()} title="Inspect wrist and jaws" aria-label="Focus wrist detail"><Focus size={13} /> Wrist</button>
        <button type="button" onClick={() => scene.current?.fit()} title="Fit instrument in view" aria-label="Fit instrument in view"><RotateCcw size={13} /> Fit</button>
        <button type="button" data-instrument-settings-trigger onClick={() => setEditing(v => !v)} aria-expanded={editing} aria-label={`Configure ${panel.title}`}><Settings2 size={13} /> Configure</button>
      </div>
    </div>
    {error && <div className="wristed-error" role="alert">{error}</div>}
    {settings.appearance === 'model' && modelStatus !== 'ready' && !error && <div className="wristed-model-notice" role="note">
      {modelStatus === 'loading' ? '模型加载中…' : '模型加载失败，暂时显示线条。重新打开面板可重试。'}
    </div>}
    {!valid && !error && <div className="wristed-warning">{unavailable.length ? `Waiting for ${unavailable.join(', ')}. Last valid pose retained.` : 'Input outside supported range. Last valid pose retained.'}</div>}
    <div className="wristed-footer"><span>Drag to freely rotate · Drag near edges to roll · Ctrl+Scroll to zoom · Shift-drag / right-drag to pan</span><code>WRIST XYZ {tip.map(v => v.toFixed(2)).join(' / ')} mm</code>{(settings.showAxes ?? true) && <span><i className="axis-x">X</i> <i className="axis-y">Y</i> <i className="axis-z">Z</i></span>}</div>
    {editing && <FloatingPanel className="wristed-settings" label={`Instrument settings for ${panel.title}`} width={440}
      anchor={() => panelAnchor(panel.id, '[data-instrument-settings-trigger]')} onClose={() => setEditing(false)}>
      <div className="wristed-settings-heading"><strong>Pose & channel bindings</strong><button type="button" aria-label="Close instrument settings" onClick={() => setEditing(false)}><X size={14} /></button></div>
      <label className="wristed-units">Angular inputs<select aria-label="Instrument angular units" value={settings.angleUnit} onChange={event => {
        const angleUnit = event.target.value as 'rad' | 'deg';
        const factor = angleUnit === 'deg' ? 180 / Math.PI : Math.PI / 180;
        update({ angleUnit, psi: settings.psi.map((v, i) => i === 0 ? v : v * factor) as Psi, angle: settings.angle * factor });
      }}><option value="rad">Radians</option><option value="deg">Degrees</option></select></label>
      <label className="wristed-group-binding">Bind channel group
        <select aria-label="Instrument channel group" value={selectedGroup?.id ?? ''} onChange={event => {
          const group = bindingGroups.find(candidate => candidate.id === event.target.value);
          if (group) update({ bindings: [...group.bindings] });
        }}>
          <option value="" disabled>{bindingGroups.length ? 'Select a group…' : 'No complete groups available'}</option>
          {bindingGroups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}
        </select>
      </label>
      <p>Bind all 7 inputs together: l, φ, θ₁, δ₁, β₁, β₂, α. Named groups or vectors [0…6] are supported. l uses mm; the other inputs use the selected angular unit.</p>
      {bound > 0 && <button type="button" onClick={() => update({ bindings: ['', '', '', '', '', '', ''] })}>Use manual values</button>}
      {POSE_LABELS.map((label, i) => <div className="wristed-pose-row" key={label}>
        <label><span title={label}>{POSE_SYMBOLS[i]}</span><input aria-label={`${label} manual value`} type="number" step={i === 0 ? 1 : 0.05}
          disabled={Boolean(settings.bindings[i])} value={i === 6 ? settings.angle : settings.psi[i]}
          onChange={event => {
            const value = event.target.valueAsNumber;
            if (!Number.isFinite(value) || Math.abs(value) > (i === 0 ? 10000 : 36000)) return;
            if (i === 6) update({ angle: value });
            else update({ psi: settings.psi.map((v, j) => i === j ? value : v) as Psi });
          }} /></label>
        <select aria-label={`${label} channel`} value={settings.bindings[i]} onChange={event => {
          const bindings = [...settings.bindings] as WristedSettings['bindings']; bindings[i] = event.target.value; update({ bindings });
        }}><option value="">Manual</option>
          {settings.bindings[i] && !channels.some(c => c.key === settings.bindings[i]) && <option value={settings.bindings[i]}>{settings.bindings[i]} (offline)</option>}
          {channels.map(c => <option key={c.id} value={c.key}>{c.key}</option>)}
        </select>
      </div>)}
      <details><summary>Instrument dimensions</summary><div className="wristed-dimensions">
        {DIMENSION_FIELDS.map(([key, label, min, max]) => <label key={key}>{label}<input type="number" aria-label={label} min={min} max={max} step="any" value={settings.dimensions[key]} onChange={event => {
          const value = event.target.valueAsNumber;
          if (Number.isFinite(value) && value >= min && value <= max) update({ dimensions: { ...settings.dimensions, [key]: value } });
        }} /></label>)}
      </div></details>
    </FloatingPanel>}
  </div>;
}
