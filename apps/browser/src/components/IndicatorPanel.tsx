import { Plus, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
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
      {editingColors && createPortal((
        <div
          className="state-color-editor"
          role="dialog"
          aria-label={`State colors for ${panel.title}`}
        >
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
        </div>
      ), document.body)}

      <div className="indicator-grid">
        {selected.map((channel) => {
          const index = channelIndexes.get(channel.id) ?? -1;
          const value = latest[index] ?? channel.lastValue ?? 0;
          const mapped = stateColors.find((state) => state.value === value);
          const color = mapped?.color ?? UNKNOWN_COLOR;
          const label = mapped?.label || `State ${displayStateValue(value)}`;
          return (
            <article
              className="indicator-item"
              key={channel.id}
              style={{ '--indicator-color': color } as React.CSSProperties}
            >
              <span className="indicator-light" aria-hidden="true" />
              <span className="indicator-copy">
                <strong>{channel.label}</strong>
                <small>{channel.key}</small>
              </span>
              <span className="indicator-state" title={label}>
                {displayStateValue(value)}
              </span>
            </article>
          );
        })}
        {selected.length === 0 && (
          <div className="instrument-empty">
            <strong>No state channels selected</strong>
            <span>Choose a channel, or bind a numbered channel group such as limit.</span>
          </div>
        )}
      </div>
    </div>
  );
}
