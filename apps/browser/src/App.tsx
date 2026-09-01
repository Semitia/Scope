import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  Database,
  Eye,
  EyeOff,
  Gauge,
  Maximize,
  Menu,
  Moon,
  Palette,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Search,
  Server,
  Settings,
  Sun,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import { WaveformPlot } from './components/WaveformPlot';
import { useTelemetry } from './hooks/useTelemetry';
import { prepareTimeline } from './timeline';
import type {
  ChannelDefinition,
  LineCurve,
  LinePattern,
  ThemeMode,
} from './types';

interface StoredChannelStyle {
  color: string;
  lineCurve: LineCurve;
  linePattern: LinePattern;
  lineWidth: number;
}

const CHANNEL_STYLES_KEY = 'debugscope.channel-styles.v1';
const THEME_KEY = 'debugscope.theme.v1';
const SETTINGS_KEY = 'debugscope.settings.v1';

interface UserSettings {
  scrollWhenIdle: boolean;
}

const NUMBER_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const CURVE_OPTIONS: ReadonlyArray<{ value: LineCurve; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'stepped', label: 'Stepped' },
];

const PATTERN_OPTIONS: ReadonlyArray<{ value: LinePattern; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'dashdot', label: 'Dash-dot' },
];

interface StylePreviewProps {
  kind: 'curve' | 'pattern';
  value: LineCurve | LinePattern;
}

function StylePreview({ kind, value }: StylePreviewProps) {
  if (kind === 'pattern') {
    const dashArray = value === 'dashed'
      ? '9 5'
      : value === 'dotted'
        ? '1 4'
        : value === 'dashdot'
          ? '9 4 1 4'
          : undefined;

    return (
      <svg className="style-preview" viewBox="0 0 44 14" aria-hidden="true">
        <line
          x1="2"
          y1="7"
          x2="42"
          y2="7"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={dashArray}
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const path = value === 'smooth'
    ? 'M2 11 C9 2 16 1 23 7 S35 12 42 3'
    : value === 'stepped'
      ? 'M2 11 H13 V3 H27 V9 H42'
      : 'M2 11 L13 3 L27 9 L42 3';

  return (
    <svg className="style-preview" viewBox="0 0 44 14" aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface PreviewSelectProps<T extends string> {
  ariaLabel: string;
  color: string;
  kind: 'curve' | 'pattern';
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

function PreviewSelect<T extends string>({
  ariaLabel,
  color,
  kind,
  options,
  value,
  onChange,
}: PreviewSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div
      className={`preview-select${open ? ' open' : ''}`}
      ref={rootRef}
      style={{ '--preview-color': color } as React.CSSProperties}
    >
      <button
        className="preview-select-button"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="preview-select-value">
          <StylePreview kind={kind} value={value as LineCurve | LinePattern} />
          <span>{selected?.label}</span>
        </span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="preview-select-menu" role="listbox" aria-label={`${ariaLabel} options`}>
          {options.map((option) => (
            <button
              className="preview-select-option"
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <StylePreview kind={kind} value={option.value as LineCurve | LinePattern} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatValue(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function channelGroup(channel: ChannelDefinition): string {
  const segments = channel.key.split('.');
  return segments.length > 1 ? segments.slice(0, -1).join('.') : 'signals';
}

function initialTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

function initialChannelStyles(): Record<string, StoredChannelStyle> {
  try {
    const stored = JSON.parse(localStorage.getItem(CHANNEL_STYLES_KEY) ?? '{}') as unknown;
    return stored && typeof stored === 'object' ? stored as Record<string, StoredChannelStyle> : {};
  } catch {
    return {};
  }
}

function initialSettings(): UserSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<UserSettings>;
    return { scrollWhenIdle: stored.scrollWhenIdle === true };
  } catch {
    return { scrollWhenIdle: false };
  }
}

export default function App() {
  const telemetry = useTelemetry();
  const rawChannels = telemetry.channels;
  const activeSource = telemetry.sources.find((source) => source.id === telemetry.activeSourceId);
  const channelIdentity = rawChannels.map((channel) => channel.id).join('|');
  const knownChannelsRef = useRef<{ sourceId: number | null; ids: Set<string> }>({
    sourceId: null,
    ids: new Set(),
  });
  const previousIdleScrollRef = useRef<boolean | null>(null);

  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const [settings, setSettings] = useState<UserSettings>(initialSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [channelStyles, setChannelStyles] = useState<Record<string, StoredChannelStyle>>(
    initialChannelStyles,
  );
  const [styleEditorChannelId, setStyleEditorChannelId] = useState<string | null>(null);
  const [visibleChannels, setVisibleChannels] = useState<Set<string>>(() => new Set());
  const [selectedChannel, setSelectedChannel] = useState('');
  const [windowSeconds, setWindowSeconds] = useState(10);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [autoY, setAutoY] = useState(true);
  const [channelSearch, setChannelSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [visiblePointCount, setVisiblePointCount] = useState(0);
  const [renderRate, setRenderRate] = useState(0);

  const sourceKeys = useMemo(
    () => new Map(telemetry.sources.map((source) => [source.id, source.programKey])),
    [telemetry.sources],
  );
  const styleKeyFor = useCallback(
    (channel: ChannelDefinition) => `${sourceKeys.get(channel.sourceId) ?? channel.sourceId}:${channel.key}`,
    [sourceKeys],
  );
  const channels = useMemo(
    () => rawChannels.map((channel) => ({
      ...channel,
      ...(channelStyles[styleKeyFor(channel)] ?? {}),
    })),
    [channelStyles, rawChannels, styleKeyFor],
  );
  const styleEditorChannel = channels.find((channel) => channel.id === styleEditorChannelId);
  const paused = pausedAt !== null;
  const timeline = useMemo(
    () => prepareTimeline(telemetry.data, settings.scrollWhenIdle),
    [settings.scrollWhenIdle, telemetry.data, telemetry.version],
  );

  useEffect(() => {
    const previous = previousIdleScrollRef.current;
    previousIdleScrollRef.current = settings.scrollWhenIdle;
    if (previous === null || previous === settings.scrollWhenIdle) return;
    setPausedAt((current) => current === null ? null : timeline.latestTime);
  }, [settings.scrollWhenIdle, timeline.latestTime]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(CHANNEL_STYLES_KEY, JSON.stringify(channelStyles));
  }, [channelStyles]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [settingsOpen]);

  useEffect(() => {
    const nextIds = new Set(channels.map((channel) => channel.id));
    const previous = knownChannelsRef.current;
    const sourceChanged = previous.sourceId !== telemetry.activeSourceId;

    setVisibleChannels((current) => {
      const next = new Set([...current].filter((id) => nextIds.has(id)));
      if (sourceChanged) {
        channels.slice(0, 4).forEach((channel) => next.add(channel.id));
      } else {
        const availableAutoSlots = Math.max(0, 4 - previous.ids.size);
        channels
          .filter((channel) => !previous.ids.has(channel.id))
          .slice(0, availableAutoSlots)
          .forEach((channel) => next.add(channel.id));
      }
      return next;
    });

    setSelectedChannel((current) =>
      nextIds.has(current) ? current : (channels[0]?.id ?? ''),
    );
    setStyleEditorChannelId((current) => current && nextIds.has(current) ? current : null);
    knownChannelsRef.current = { sourceId: telemetry.activeSourceId, ids: nextIds };
  }, [channelIdentity, telemetry.activeSourceId]);

  useEffect(() => {
    setPausedAt(null);
    setChannelSearch('');
    setStyleEditorChannelId(null);
  }, [telemetry.activeSourceId]);

  const getViewTime = useCallback(
    () => settings.scrollWhenIdle ? telemetry.now() : timeline.latestTime,
    [settings.scrollWhenIdle, telemetry.now, timeline.latestTime],
  );

  const togglePause = useCallback(() => {
    setPausedAt((current) => (current === null ? getViewTime() : null));
  }, [getViewTime]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, select, textarea, button')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePause();
      }
      if (event.key.toLowerCase() === 'l' && paused) {
        event.preventDefault();
        setPausedAt(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [paused, togglePause]);

  const filteredChannels = useMemo(() => {
    const query = channelSearch.trim().toLowerCase();
    if (!query) return channels;
    return channels.filter(
      (channel) =>
        channel.label.toLowerCase().includes(query) || channel.key.toLowerCase().includes(query),
    );
  }, [channelSearch, channels]);

  const groupedChannels = useMemo(() => {
    const groups = new Map<string, ChannelDefinition[]>();
    for (const channel of filteredChannels) {
      const group = channelGroup(channel);
      const existing = groups.get(group) ?? [];
      existing.push(channel);
      groups.set(group, existing);
    }
    return [...groups.entries()];
  }, [filteredChannels]);

  const channelIndexes = useMemo(
    () => new Map(channels.map((channel, index) => [channel.id, index])),
    [channels],
  );

  const toggleChannel = (channelId: string) => {
    setVisibleChannels((current) => {
      const next = new Set(current);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  };

  const clearHistory = () => {
    telemetry.clear();
    if (paused) setPausedAt(getViewTime());
  };

  const updateChannelStyle = (
    channel: ChannelDefinition,
    patch: Partial<StoredChannelStyle>,
  ) => {
    const key = styleKeyFor(channel);
    setChannelStyles((current) => ({
      ...current,
      [key]: Object.assign({
        color: channel.color,
        lineCurve: channel.lineCurve,
        linePattern: channel.linePattern,
        lineWidth: channel.lineWidth,
      }, current[key], patch),
    }));
  };

  const resetChannelStyle = (channel: ChannelDefinition) => {
    const key = styleKeyFor(channel);
    setChannelStyles((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const connectionLabel = useMemo(() => {
    if (telemetry.mode === 'demo') return paused ? 'PAUSED' : 'DEMO LIVE';
    if (telemetry.connection === 'connecting') return 'CONNECTING';
    if (telemetry.connection === 'reconnecting') return 'RECONNECTING';
    if (telemetry.connection === 'disconnected') return 'OFFLINE';
    if (paused) return 'PAUSED';
    return activeSource?.active ? 'LIVE' : 'WAITING';
  }, [activeSource?.active, paused, telemetry.connection, telemetry.mode]);

  const connected = telemetry.connection === 'connected';
  const noProducer = connected && telemetry.sources.length === 0;
  const emptyTitle = !connected
    ? 'Connecting to DebugScope Hub'
    : noProducer
      ? 'Waiting for a producer'
      : channels.length === 0
        ? 'No channels received yet'
        : 'No visible channels';
  const emptyMessage = !connected
    ? 'The browser will reconnect automatically when the local Hub is available.'
    : noProducer
      ? 'Start an application using the C, C++, or Python SDK. Channels appear automatically.'
      : channels.length === 0
        ? 'The source is connected. Send its first sample to create a channel.'
        : 'Enable a channel from the sidebar to start plotting.';

  return (
    <div className={`app-shell${sidebarOpen ? ' sidebar-open' : ''}`}>
      <header className="app-bar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <Activity size={19} strokeWidth={2.3} />
          </span>
          <strong>DebugScope</strong>
          <span className="preview-badge">PREVIEW</span>
        </div>

        <button
          className="icon-button mobile-menu"
          type="button"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-label={sidebarOpen ? 'Close channels' : 'Open channels'}
          aria-expanded={sidebarOpen}
        >
          {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        <div className="app-context">
          <span>
            <small>{telemetry.mode === 'demo' ? 'WORKSPACE' : 'PROGRAM'}</small>
            <strong>{activeSource?.name ?? 'Live telemetry'}</strong>
          </span>
          <span className="demo-badge">{telemetry.mode === 'demo' ? 'DEMO DATA' : 'LOCAL HUB'}</span>
        </div>

        <div className="app-actions">
          <span
            className={`capture-state${paused ? ' paused' : ''}${!connected ? ' offline' : ''}`}
            role="status"
          >
            <span className="live-dot" />
            {connectionLabel}
          </span>

          <button
            className={`control-button auto-y-button${autoY ? ' active' : ''}`}
            type="button"
            onClick={() => setAutoY((enabled) => !enabled)}
            aria-label="Auto Y"
            aria-pressed={autoY}
            title="Disable to freeze the Y range; use Shift + wheel to zoom Y"
          >
            <Maximize size={14} />
            <span>Auto Y</span>
          </button>

          <label className="window-control">
            <span>Window</span>
            <select
              value={windowSeconds}
              onChange={(event) => setWindowSeconds(Number(event.target.value))}
              aria-label="Visible time window"
            >
              <option value={5}>5 s</option>
              <option value={10}>10 s</option>
              <option value={30}>30 s</option>
            </select>
          </label>

          <button
            className={`control-button pause-button${paused ? ' resume' : ''}`}
            type="button"
            onClick={togglePause}
            aria-pressed={paused}
          >
            {paused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}
            <span>{paused ? 'Resume' : 'Pause'}</span>
            <kbd>Space</kbd>
          </button>

          <button className="control-button clear-button" type="button" onClick={clearHistory}>
            <Trash2 size={15} />
            <span>Clear</span>
          </button>

          <button
            className="icon-button theme-button"
            type="button"
            onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          </button>

          <button
            className={`icon-button settings-button${settingsOpen ? ' active' : ''}`}
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Open settings"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            title="Settings"
          >
            <Settings size={15} />
          </button>
        </div>
      </header>

      <aside className="sidebar" aria-label="Sources and channels">
        <section className="sidebar-section source-section">
          <div className="section-heading">
            <span>PROGRAMS</span>
            <span className="channel-count">{telemetry.sources.length}</span>
          </div>

          <div className="source-list">
            {telemetry.sources.map((source) => (
              <div
                className={`source-card${source.id === telemetry.activeSourceId ? ' active' : ''}`}
                key={source.id}
              >
                <button
                  className="source-select"
                  type="button"
                  onClick={() => {
                    telemetry.setActiveSourceId(source.id);
                    setSidebarOpen(false);
                  }}
                >
                  <span className="source-icon"><Server size={16} /></span>
                  <span className="source-copy">
                    <strong>{source.name}</strong>
                    <small>
                      {source.sdkName ?? 'Unknown SDK'}
                      {source.processId !== undefined ? ` · PID ${source.processId}` : ''}
                    </small>
                  </span>
                  <span
                    className={`connection-dot${source.active ? '' : ' stale'}`}
                    title={source.active ? 'Running' : 'Stopped'}
                  />
                </button>
                {telemetry.mode === 'live' && (
                  <button
                    className="source-delete"
                    type="button"
                    onClick={() => telemetry.deleteSource(source.id)}
                    aria-label={`Delete ${source.name}`}
                    title="Delete this program and its history"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}

            {telemetry.sources.length === 0 && (
              <div className="source-empty">
                {connected ? <Radio size={16} /> : <WifiOff size={16} />}
                <span>
                  <strong>{connected ? 'No programs yet' : 'Hub unavailable'}</strong>
                  <small>{connected ? 'Listening on UDP 4711' : 'Retrying automatically'}</small>
                </span>
              </div>
            )}
          </div>
        </section>

        <section className="sidebar-section channels-section">
          <div className="section-heading channel-heading">
            <span>CHANNELS</span>
            <span className="channel-count">{visibleChannels.size} / {channels.length}</span>
          </div>

          <label className="search-box">
            <Search size={14} />
            <input
              type="search"
              placeholder="Filter channels"
              value={channelSearch}
              onChange={(event) => setChannelSearch(event.target.value)}
              disabled={channels.length === 0}
            />
            {channelSearch && (
              <button type="button" onClick={() => setChannelSearch('')} aria-label="Clear channel filter">
                <X size={13} />
              </button>
            )}
          </label>

          {groupedChannels.map(([group, groupChannels]) => (
            <div className="channel-group" key={group}>
              <div className="group-label">
                <ChevronDown size={14} />
                <span>{group}</span>
                <b>{groupChannels.length}</b>
              </div>

              <div className="channel-list">
                {groupChannels.map((channel) => {
                  const channelIndex = channelIndexes.get(channel.id) ?? -1;
                  const visible = visibleChannels.has(channel.id);
                  const selected = selectedChannel === channel.id;

                  return (
                    <div
                      className={`channel-row${selected ? ' selected' : ''}${visible ? '' : ' hidden'}`}
                      key={channel.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedChannel(channel.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') setSelectedChannel(channel.id);
                      }}
                    >
                      <button
                        className="visibility-button"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleChannel(channel.id);
                        }}
                        aria-label={`${visible ? 'Hide' : 'Show'} ${channel.label}`}
                        aria-pressed={visible}
                      >
                        {visible ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <span
                        className="channel-swatch"
                        style={{ '--channel-color': channel.color } as React.CSSProperties}
                      />
                      <span className="channel-copy">
                        <strong>{channel.label}</strong>
                        <small>{channel.key}</small>
                      </span>
                      <span className="channel-value">
                        <b>{formatValue(telemetry.latest[channelIndex] ?? channel.lastValue ?? 0)}</b>
                        <small>{channel.unit || channel.valueType || 'number'}</small>
                      </span>
                      <button
                        className={`style-button${styleEditorChannelId === channel.id ? ' active' : ''}`}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedChannel(channel.id);
                          setStyleEditorChannelId((current) => current === channel.id ? null : channel.id);
                        }}
                        aria-label={`Style ${channel.label}`}
                        aria-expanded={styleEditorChannelId === channel.id}
                      >
                        <Palette size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {filteredChannels.length === 0 && channelSearch && (
            <div className="no-channel-results">No matching channels</div>
          )}

          {styleEditorChannel && (
            <div className="style-editor" role="dialog" aria-label={`Style ${styleEditorChannel.label}`}>
              <div className="style-editor-header">
                <span><Palette size={13} /> Signal style</span>
                <button type="button" onClick={() => setStyleEditorChannelId(null)} aria-label="Close style editor">
                  <X size={13} />
                </button>
              </div>
              <div className="style-fields">
                <label className="color-field">
                  <span>Color</span>
                  <span className="color-control">
                    <input
                      type="color"
                      value={styleEditorChannel.color}
                      onChange={(event) => updateChannelStyle(styleEditorChannel, { color: event.target.value })}
                      aria-label={`Color for ${styleEditorChannel.label}`}
                    />
                    <code>{styleEditorChannel.color.toUpperCase()}</code>
                  </span>
                </label>
                <div className="style-field">
                  <span>Curve</span>
                  <PreviewSelect
                    value={styleEditorChannel.lineCurve}
                    onChange={(lineCurve) => updateChannelStyle(styleEditorChannel, {
                      lineCurve,
                    })}
                    ariaLabel={`Curve for ${styleEditorChannel.label}`}
                    color={styleEditorChannel.color}
                    kind="curve"
                    options={CURVE_OPTIONS}
                  />
                </div>
                <div className="style-field">
                  <span>Stroke</span>
                  <PreviewSelect
                    value={styleEditorChannel.linePattern}
                    onChange={(linePattern) => updateChannelStyle(styleEditorChannel, {
                      linePattern,
                    })}
                    ariaLabel={`Stroke for ${styleEditorChannel.label}`}
                    color={styleEditorChannel.color}
                    kind="pattern"
                    options={PATTERN_OPTIONS}
                  />
                </div>
                <label>
                  <span>Width</span>
                  <select
                    value={styleEditorChannel.lineWidth}
                    onChange={(event) => updateChannelStyle(styleEditorChannel, {
                      lineWidth: Number(event.target.value),
                    })}
                    aria-label={`Width for ${styleEditorChannel.label}`}
                  >
                    <option value={1}>1 px</option>
                    <option value={1.5}>1.5 px</option>
                    <option value={2}>2 px</option>
                    <option value={2.5}>2.5 px</option>
                    <option value={3}>3 px</option>
                  </select>
                </label>
              </div>
              <button
                className="reset-style"
                type="button"
                onClick={() => resetChannelStyle(styleEditorChannel)}
              >
                <RotateCcw size={12} /> Reset default
              </button>
            </div>
          )}
        </section>

        <div className="sidebar-footer">
          <span className="capture-ring"><Database size={15} /></span>
          <span>
            <strong>{telemetry.mode === 'demo' ? 'Local demo capture' : 'Hub capture'}</strong>
            <small>Recent history stays in memory</small>
          </span>
        </div>
      </aside>

      <button
        className="sidebar-scrim"
        type="button"
        aria-label="Close channels"
        onClick={() => setSidebarOpen(false)}
      />

      <main className="workspace">
        <section className="scope-panel" aria-label="Live signals">
          <div className="plot-legend" aria-label="Channel legend">
            {channels.filter((channel) => visibleChannels.has(channel.id)).map((channel) => {
              const channelIndex = channelIndexes.get(channel.id) ?? -1;
              const selected = channel.id === selectedChannel;
              return (
                <button
                  className={`legend-item${selected ? ' selected' : ''}`}
                  type="button"
                  key={channel.id}
                  onClick={() => setSelectedChannel(channel.id)}
                >
                  <span
                    className={`legend-line ${channel.linePattern}`}
                    style={{
                      '--channel-color': channel.color,
                      '--channel-width': `${channel.lineWidth}px`,
                    } as React.CSSProperties}
                  />
                  <span>{channel.label}</span>
                  <b>{formatValue(telemetry.latest[channelIndex] ?? channel.lastValue ?? 0)}</b>
                  {(channel.unit || channel.valueType) && <small>{channel.unit || channel.valueType}</small>}
                </button>
              );
            })}
          </div>

          <WaveformPlot
            channels={channels}
            data={timeline.data}
            dataVersion={telemetry.version}
            visibleChannels={visibleChannels}
            selectedChannel={selectedChannel}
            windowSeconds={windowSeconds}
            pausedAt={pausedAt}
            autoY={autoY}
            theme={theme}
            scrollWhenIdle={settings.scrollWhenIdle}
            getClockTime={getViewTime}
            onShowAllChannels={() => setVisibleChannels(new Set(channels.map((channel) => channel.id)))}
            onVisiblePointCount={setVisiblePointCount}
            onRenderRate={setRenderRate}
            emptyTitle={emptyTitle}
            emptyMessage={emptyMessage}
            showEmptyAction={channels.length > 0}
          />
        </section>
      </main>

      <footer className="status-bar">
        <div className="status-group">
          <span>
            <i className={`connection-dot tiny${connected ? '' : ' stale'}`} />
            {connected ? 'Hub connected' : 'Hub reconnecting'}
          </span>
          <span>
            <b>{telemetry.sampleRate}</b> {telemetry.mode === 'demo' ? 'Hz / channel' : 'samples/s'}
          </span>
          <span><b>{visiblePointCount.toLocaleString()}</b> points visible</span>
        </div>
        <div className="status-group status-right">
          <span>UDP <b>127.0.0.1:4711</b></span>
          <span>Render <b>{renderRate || '—'} fps</b></span>
          <span>Memory <b>{formatBytes(telemetry.memoryBytes)}</b></span>
          <Gauge size={13} />
        </div>
      </footer>

      {settingsOpen && (
        <>
          <button
            className="settings-scrim"
            type="button"
            onClick={() => setSettingsOpen(false)}
            aria-label="Close settings"
          />
          <aside className="settings-panel" role="dialog" aria-modal="true" aria-label="Settings">
            <div className="settings-header">
              <span>
                <Settings size={17} />
                <strong>Settings</strong>
              </span>
              <button
                className="icon-button subtle"
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings panel"
                autoFocus
              >
                <X size={16} />
              </button>
            </div>

            <section className="settings-section" aria-labelledby="timeline-settings-title">
              <div className="settings-section-heading">
                <span id="timeline-settings-title">TIMELINE</span>
                <small>Behavior</small>
              </div>
              <div className="settings-entry">
                <span className="settings-entry-copy">
                  <strong>Continue scrolling when idle</strong>
                  <small>
                    Preserve real idle time as a blank, disconnected gap when samples resume.
                  </small>
                </span>
                <button
                  className={`settings-switch${settings.scrollWhenIdle ? ' enabled' : ''}`}
                  type="button"
                  role="switch"
                  aria-checked={settings.scrollWhenIdle}
                  aria-label="Continue scrolling when idle"
                  onClick={() => setSettings((current) => ({
                    ...current,
                    scrollWhenIdle: !current.scrollWhenIdle,
                  }))}
                >
                  <span />
                </button>
              </div>
            </section>

            <div className="settings-footer">
              <span>Changes are saved automatically</span>
              <small>Default: timeline stops with the last sample</small>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
