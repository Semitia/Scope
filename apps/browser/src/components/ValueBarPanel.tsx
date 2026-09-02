import { Activity, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ChannelDefinition, TelemetryData } from '../types';
import type { ValueBarChannelRange, ValueBarPanelDefinition } from '../panelTypes';

interface ValueBarPanelProps {
  panel: ValueBarPanelDefinition;
  channels: ChannelDefinition[];
  data: TelemetryData;
  latest: number[];
  channelIndexes: Map<string, number>;
  onChange: (patch: Partial<ValueBarPanelDefinition>) => void;
}

interface NumericRange {
  min: number;
  max: number;
}

interface MaintainedRange extends NumericRange {
  lastTimestamp: number;
}

interface RangeEdit {
  channelKey: string;
  edge: 'min' | 'max';
}

const INSTRUMENT_NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

function formatInstrumentValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude >= 10_000 || magnitude > 0 && magnitude < 0.001) return value.toExponential(3);
  return INSTRUMENT_NUMBER_FORMAT.format(value);
}

function paddedRange(min: number, max: number): NumericRange {
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.1, 1);
    return { min: min - padding, max: max + padding };
  }
  const padding = (max - min) * 0.05;
  return { min: min - padding, max: max + padding };
}

export function ValueBarPanel({
  panel,
  channels,
  data,
  latest,
  channelIndexes,
  onChange,
}: ValueBarPanelProps) {
  const maintainedRanges = useRef(new Map<string, MaintainedRange>());
  const [editingRange, setEditingRange] = useState<RangeEdit | null>(null);
  const selected = channels.filter((channel) => panel.channelKeys.includes(channel.key));
  const manualRangeValid = Number.isFinite(panel.manualMin)
    && Number.isFinite(panel.manualMax)
    && panel.manualMin < panel.manualMax;
  const channelRanges = panel.channelRanges ?? {};

  const setChannelRange = (channelKey: string, range?: ValueBarChannelRange) => {
    const next = { ...channelRanges };
    if (range) next[channelKey] = range;
    else delete next[channelKey];
    onChange({ channelRanges: next });
  };

  return (
    <div className="value-bar-stage">
      <div className="value-bar-list">
        {selected.map((channel) => {
          const index = channelIndexes.get(channel.id) ?? -1;
          const value = latest[index] ?? channel.lastValue ?? 0;
          const timestamps = data[0];
          const values = data[index + 1] ?? [];
          const latestTimestamp = timestamps.at(-1) ?? 0;
          const channelRange = channelRanges[channel.key];
          const rangeMode = channelRange?.mode ?? panel.rangeMode;
          const channelManualRangeValid = channelRange?.mode === 'manual'
            ? Number.isFinite(channelRange.min)
              && Number.isFinite(channelRange.max)
              && channelRange.min < channelRange.max
            : manualRangeValid;
          let maintained = maintainedRanges.current.get(channel.id);
          if (!maintained || latestTimestamp < maintained.lastTimestamp) {
            maintained = { min: value, max: value, lastTimestamp: Number.NEGATIVE_INFINITY };
          }
          let start = 0;
          if (Number.isFinite(maintained.lastTimestamp)) {
            let low = 0;
            let high = timestamps.length;
            while (low < high) {
              const middle = Math.floor((low + high) / 2);
              if ((timestamps[middle] ?? Number.NEGATIVE_INFINITY) <= maintained.lastTimestamp) low = middle + 1;
              else high = middle;
            }
            start = low;
          }
          for (let sampleIndex = start; sampleIndex < values.length; sampleIndex += 1) {
            const sample = values[sampleIndex];
            if (typeof sample !== 'number' || !Number.isFinite(sample)) continue;
            maintained.min = Math.min(maintained.min, sample);
            maintained.max = Math.max(maintained.max, sample);
          }
          maintained.lastTimestamp = latestTimestamp;
          maintainedRanges.current.set(channel.id, maintained);
          const range = rangeMode === 'manual' && channelManualRangeValid
            ? {
              min: channelRange?.mode === 'manual' ? channelRange.min : panel.manualMin,
              max: channelRange?.mode === 'manual' ? channelRange.max : panel.manualMax,
            }
            : paddedRange(maintained.min, maintained.max);
          const rawPosition = (value - range.min) / (range.max - range.min);
          const position = Math.max(0, Math.min(1, rawPosition));
          const outOfRange = rawPosition < 0 || rawPosition > 1;
          const zeroPosition = range.min < 0 && range.max > 0
            ? (0 - range.min) / (range.max - range.min)
            : null;

          return (
            <article className="value-bar-item" key={channel.id}>
              <div className="value-bar-heading">
                <span>
                  <strong>{channel.label}</strong>
                  <small>{channel.key}</small>
                </span>
                <span className="value-bar-reading">
                  <b>{formatInstrumentValue(value)}</b>
                  <small>{channel.unit || channel.valueType || 'number'}</small>
                  {outOfRange && <em>OUT</em>}
                </span>
              </div>
              <div
                className={`value-bar-track${outOfRange ? ' out-of-range' : ''}`}
                style={{ '--bar-color': channel.color } as React.CSSProperties}
              >
                <span className="value-bar-fill" style={{ width: `${position * 100}%` }} />
                {zeroPosition !== null && (
                  <i className="value-bar-zero" style={{ left: `${zeroPosition * 100}%` }} />
                )}
                <span className="value-bar-marker" style={{ left: `${position * 100}%` }} />
              </div>
              <div className="value-bar-scale">
                {editingRange?.channelKey === channel.key && editingRange.edge === 'min' ? (
                  <input
                    type="number"
                    value={channelRange?.mode === 'manual' ? channelRange.min : range.min}
                    autoFocus
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setChannelRange(channel.key, {
                      mode: 'manual',
                      min: Number(event.target.value),
                      max: channelRange?.mode === 'manual' ? channelRange.max : range.max,
                    })}
                    onBlur={() => setEditingRange(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
                    }}
                    aria-label={`Minimum for ${channel.label}`}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setChannelRange(channel.key, { mode: 'manual', min: range.min, max: range.max });
                      setEditingRange({ channelKey: channel.key, edge: 'min' });
                    }}
                    aria-label={`Edit minimum for ${channel.label}`}
                    title="Click to set a manual minimum"
                  >
                    {formatInstrumentValue(range.min)}
                  </button>
                )}
                <button
                  type="button"
                  className={`range-mode-icon ${rangeMode}`}
                  onClick={() => {
                    const currentTimestamp = data[0].at(-1) ?? 0;
                    maintainedRanges.current.set(channel.id, {
                      min: value,
                      max: value,
                      lastTimestamp: currentTimestamp,
                    });
                    setChannelRange(channel.key, { mode: 'auto', min: range.min, max: range.max });
                    setEditingRange(null);
                  }}
                  aria-label={rangeMode === 'manual'
                    ? `Use history range for ${channel.label}`
                    : `Reset learned range for ${channel.label}`}
                  title={rangeMode === 'manual'
                    ? 'Manual range · click to restore automatic history'
                    : 'Automatic history range · click to relearn'}
                >
                  {rangeMode === 'manual' ? <RotateCcw size={10} /> : <Activity size={10} />}
                </button>
                {editingRange?.channelKey === channel.key && editingRange.edge === 'max' ? (
                  <input
                    type="number"
                    value={channelRange?.mode === 'manual' ? channelRange.max : range.max}
                    autoFocus
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setChannelRange(channel.key, {
                      mode: 'manual',
                      min: channelRange?.mode === 'manual' ? channelRange.min : range.min,
                      max: Number(event.target.value),
                    })}
                    onBlur={() => setEditingRange(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
                    }}
                    aria-label={`Maximum for ${channel.label}`}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setChannelRange(channel.key, { mode: 'manual', min: range.min, max: range.max });
                      setEditingRange({ channelKey: channel.key, edge: 'max' });
                    }}
                    aria-label={`Edit maximum for ${channel.label}`}
                    title="Click to set a manual maximum"
                  >
                    {formatInstrumentValue(range.max)}
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {selected.length === 0 && (
          <div className="instrument-empty">
            <strong>No value channels selected</strong>
            <span>Choose one channel or a related channel set.</span>
          </div>
        )}
      </div>
    </div>
  );
}
