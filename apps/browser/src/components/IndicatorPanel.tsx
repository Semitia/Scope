import { Plus, Trash2, X } from 'lucide-react';
import { FloatingPanel, panelAnchor } from './FloatingPanel';
import type { ChannelDefinition } from '../types';
import {
  DEFAULT_STATE_COLORS,
  type IndicatorPanelDefinition,
  type StateColorDefinition,
} from '../panelTypes';

interface IndicatorPanelProps {
  panel: IndicatorPanelDefinition;
  channels: ChannelDefinition[];
  latest: number[];
  channelIndexes: Map<string, number>;
  editingColors: boolean;
  onEditingColorsChange: (editing: boolean) => void;
  onChange: (patch: Partial<IndicatorPanelDefinition>) => void;
}

const UNKNOWN_COLOR = '#7756c5';

function displayStateValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
}

export function IndicatorPanel({
  panel,
  channels,
  latest,
  channelIndexes,
  editingColors,
  onEditingColorsChange,
  onChange,
}: IndicatorPanelProps) {
  const selected = channels.filter((channel) => panel.channelKeys.includes(channel.key));
  // Keep each namespace once, while retaining custom labels and full keys in tooltips.
  const groups = new Map<string, ChannelDefinition[]>();
  for (const channel of selected) {
    const separator = channel.key.lastIndexOf('.');
    const group = separator > 0 ? channel.key.slice(0, separator) : '';
    groups.set(group, [...(groups.get(group) ?? []), channel]);
  }
  const stateColors = panel.stateColors.length > 0 ? panel.stateColors : DEFAULT_STATE_COLORS;

  const updateState = (index: number, patch: Partial<StateColorDefinition>) => {
    onChange({
      stateColors: stateColors.map((state, stateIndex) => (
        stateIndex === index ? { ...state, ...patch } : state
      )),
    });
  };

  const addState = () => {
    const used = new Set(stateColors.map((state) => state.value));
    let value = 0;
    while (used.has(value)) value += 1;
    onChange({ stateColors: [...stateColors, { value, label: `State ${value}`, color: UNKNOWN_COLOR }] });
  };

  return (
    <div className="indicator-stage">
      {editingColors && (
        <FloatingPanel className="state-color-editor" label={`State colors for ${panel.title}`} width={470}
          anchor={() => panelAnchor(panel.id, '[data-color-editor-trigger]')} onClose={() => onEditingColorsChange(false)}>
          <div className="state-color-header">
            <span>VALUE</span><span>LABEL</span><span>COLOR</span><span />
          </div>
          {stateColors.map((state, index) => (
            <div className="state-color-row" key={index}>
              <input
                type="number"
                value={state.value}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) updateState(index, { value });
                }}
                aria-label={`State value ${index + 1}`}
              />
              <input
                type="text"
                value={state.label}
                onChange={(event) => updateState(index, { label: event.target.value })}
                aria-label={`State label ${index + 1}`}
              />
              <label className="state-color-control">
                <input
                  type="color"
                  value={state.color}
                  onChange={(event) => updateState(index, { color: event.target.value })}
                  aria-label={`State color ${state.value}`}
                />
                <code>{state.color.toUpperCase()}</code>
              </label>
              <button
                type="button"
                onClick={() => onChange({ stateColors: stateColors.filter((_, itemIndex) => itemIndex !== index) })}
                aria-label={`Remove state ${state.value}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <div className="state-color-actions">
            <button type="button" onClick={addState}><Plus size={12} /> Add state</button>
            <button type="button" onClick={() => onChange({ stateColors: DEFAULT_STATE_COLORS.map((state) => ({ ...state })) })}>
              Reset defaults
            </button>
            <button type="button" onClick={() => onEditingColorsChange(false)} aria-label={`Close colors for ${panel.title}`}>
              <X size={12} /> Done
            </button>
          </div>
        </FloatingPanel>
      )}

      <div className="indicator-grid">
        {[...groups].map(([group, groupChannels]) => (
          <div className="indicator-group" key={group}>
            {group && <span className="indicator-group-name" title={group}>{group}</span>}
            <div className="indicator-group-items">
        {groupChannels.map((channel) => {
          const index = channelIndexes.get(channel.id) ?? -1;
          const value = latest[index] ?? channel.lastValue ?? 0;
          const mapped = stateColors.find((state) => state.value === value);
          const color = mapped?.color ?? UNKNOWN_COLOR;
          const label = mapped?.label || `State ${displayStateValue(value)}`;
          return (
            <article
              className="indicator-item"
              key={channel.id}
              title={`${channel.key} · ${label}: ${displayStateValue(value)}`}
              aria-label={`${channel.key}: ${displayStateValue(value)} (${label})`}
              style={{ '--indicator-color': color } as React.CSSProperties}
            >
              <span className="indicator-copy">
                <strong>{group && channel.label === channel.key ? channel.key.slice(group.length + 1) : channel.label}</strong>
              </span>
              <span className={`indicator-state${value !== 0 ? ' is-lit' : ''}`} title={label}>
                {displayStateValue(value)}
              </span>
            </article>
          );
        })}
            </div>
          </div>
        ))}
        {selected.length === 0 && (
          <div className="instrument-empty">
            <strong>No state channels selected</strong>
            <span>Choose channels to display.</span>
          </div>
        )}
      </div>
    </div>
  );
}
