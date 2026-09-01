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
  Plus,
  Radio,
  RotateCcw,
  Search,
  Server,
  Settings,
  SlidersHorizontal,
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
const SCOPE_LAYOUTS_KEY = 'debugscope.scope-layouts.v1';
const THEME_KEY = 'debugscope.theme.v1';
const SETTINGS_KEY = 'debugscope.settings.v1';
const MAX_SCOPE_PANELS = 8;

interface UserSettings {
  scrollWhenIdle: boolean;
}

interface ScopePanelDefinition {
  id: string;
  type: 'scope';
  title: string;
  channelKeys: string[];
}

type ScopeLayouts = Record<string, ScopePanelDefinition[]>;

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

function initialScopeLayouts(): ScopeLayouts {
  try {
    const stored = JSON.parse(localStorage.getItem(SCOPE_LAYOUTS_KEY) ?? '{}') as unknown;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};

    return Object.fromEntries(
      Object.entries(stored as Record<string, unknown>)
        .map(([programKey, value]) => {
          if (!Array.isArray(value)) return [programKey, []] as const;
          const panels = value
            .filter((panel): panel is Record<string, unknown> => (
              Boolean(panel) && typeof panel === 'object' && !Array.isArray(panel)
            ))
            .filter((panel) => (
              panel.type === 'scope'
              && typeof panel.id === 'string'
              && typeof panel.title === 'string'
              && Array.isArray(panel.channelKeys)
            ))
            .slice(0, MAX_SCOPE_PANELS)
            .map((panel) => ({
              id: panel.id as string,
              type: 'scope' as const,
              title: panel.title as string,
              channelKeys: [...new Set(
                (panel.channelKeys as unknown[]).filter((key): key is string => typeof key === 'string'),
              )],
            }));
          return [programKey, panels] as const;
        })
        .filter(([, panels]) => panels.length > 0),
    );
  } catch {
    return {};
  }
}

function createScopeId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `scope-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function nextScopeTitle(panels: ScopePanelDefinition[]): string {
  const titles = new Set(panels.map((panel) => panel.title));
  let number = 1;
  while (titles.has(`Scope ${number}`)) number += 1;
  return `Scope ${number}`;
}

export default function App() {
  const telemetry = useTelemetry();
  const rawChannels = telemetry.channels;
  const activeSource = telemetry.sources.find((source) => source.id === telemetry.activeSourceId);
  const channelIdentity = rawChannels.map((channel) => channel.id).join('|');
  const previousIdleScrollRef = useRef<boolean | null>(null);

  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const [settings, setSettings] = useState<UserSettings>(initialSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [channelStyles, setChannelStyles] = useState<Record<string, StoredChannelStyle>>(
    initialChannelStyles,
  );
  const [scopeLayouts, setScopeLayouts] = useState<ScopeLayouts>(initialScopeLayouts);
  const [activeScopeId, setActiveScopeId] = useState<string | null>(null);
  const [channelPickerScopeId, setChannelPickerScopeId] = useState<string | null>(null);
  const [styleEditorChannelId, setStyleEditorChannelId] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [windowSeconds, setWindowSeconds] = useState(10);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [autoY, setAutoY] = useState(true);
  const [channelSearch, setChannelSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [visiblePointCounts, setVisiblePointCounts] = useState<Record<string, number>>({});
  const [renderRates, setRenderRates] = useState<Record<string, number>>({});

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
  const layoutKey = activeSource?.programKey ?? null;
  const defaultScope = useMemo<ScopePanelDefinition>(() => ({
    id: `scope-default:${layoutKey ?? 'waiting'}`,
    type: 'scope',
    title: 'Scope 1',
    channelKeys: channels.slice(0, 4).map((channel) => channel.key),
  }), [channelIdentity, layoutKey]);
  const scopePanels = useMemo(() => {
    const stored = layoutKey ? scopeLayouts[layoutKey] : undefined;
    return stored?.length ? stored : [defaultScope];
  }, [defaultScope, layoutKey, scopeLayouts]);
  const activeScope = scopePanels.find((panel) => panel.id === activeScopeId) ?? scopePanels[0];
  const activeScopeChannelIds = useMemo(() => {
    const keys = new Set(activeScope?.channelKeys ?? []);
    return new Set(channels.filter((channel) => keys.has(channel.key)).map((channel) => channel.id));
  }, [activeScope, channels]);
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
    localStorage.setItem(SCOPE_LAYOUTS_KEY, JSON.stringify(scopeLayouts));
  }, [scopeLayouts]);

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
    setSelectedChannel((current) =>
      nextIds.has(current) ? current : (channels[0]?.id ?? ''),
    );
    setStyleEditorChannelId((current) => current && nextIds.has(current) ? current : null);
  }, [channelIdentity, telemetry.activeSourceId]);

  useEffect(() => {
    const nextActiveScope = scopePanels.find((panel) => panel.id === activeScopeId) ?? scopePanels[0];
    if (nextActiveScope && nextActiveScope.id !== activeScopeId) {
      setActiveScopeId(nextActiveScope.id);
    }
    if (
      channelPickerScopeId
      && !scopePanels.some((panel) => panel.id === channelPickerScopeId)
    ) {
      setChannelPickerScopeId(null);
    }
  }, [activeScopeId, channelPickerScopeId, scopePanels]);

  useEffect(() => {
    const selected = channels.find((channel) => channel.id === selectedChannel);
    if (selected && activeScopeChannelIds.has(selected.id)) return;
    const firstVisible = channels.find((channel) => activeScopeChannelIds.has(channel.id));
    setSelectedChannel(firstVisible?.id ?? channels[0]?.id ?? '');
  }, [activeScopeChannelIds, channels, selectedChannel]);

  useEffect(() => {
    setPausedAt(null);
    setChannelSearch('');
    setStyleEditorChannelId(null);
    setActiveScopeId(null);
    setChannelPickerScopeId(null);
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

  const updateScopePanels = useCallback((
    updater: (panels: ScopePanelDefinition[]) => ScopePanelDefinition[],
  ) => {
    if (!layoutKey) return;
    setScopeLayouts((current) => {
      const base = current[layoutKey]?.length ? current[layoutKey] : [defaultScope];
      return { ...current, [layoutKey]: updater(base) };
    });
  }, [defaultScope, layoutKey]);

  const setScopeChannelKeys = useCallback((scopeId: string, channelKeys: string[]) => {
    updateScopePanels((panels) => panels.map((panel) => panel.id === scopeId
      ? { ...panel, channelKeys: [...new Set(channelKeys)] }
      : panel));
  }, [updateScopePanels]);

  const toggleScopeChannel = useCallback((scopeId: string, channelKey: string) => {
    updateScopePanels((panels) => panels.map((panel) => {
      if (panel.id !== scopeId) return panel;
      const channelKeys = new Set(panel.channelKeys);
      if (channelKeys.has(channelKey)) channelKeys.delete(channelKey);
      else channelKeys.add(channelKey);
      return { ...panel, channelKeys: [...channelKeys] };
    }));
  }, [updateScopePanels]);

  const addScope = () => {
    if (!layoutKey || scopePanels.length >= MAX_SCOPE_PANELS) return;
    const panel: ScopePanelDefinition = {
      id: createScopeId(),
      type: 'scope',
      title: nextScopeTitle(scopePanels),
      channelKeys: [],
    };
    updateScopePanels((panels) => [...panels, panel]);
    setActiveScopeId(panel.id);
    setChannelPickerScopeId(panel.id);
  };

  const deleteScope = (scopeId: string) => {
    if (scopePanels.length <= 1) return;
    const remaining = scopePanels.filter((panel) => panel.id !== scopeId);
    updateScopePanels(() => remaining);
    setVisiblePointCounts((current) => {
      const next = { ...current };
      delete next[scopeId];
      return next;
    });
    setRenderRates((current) => {
      const next = { ...current };
      delete next[scopeId];
      return next;
    });
    if (activeScopeId === scopeId) setActiveScopeId(remaining[0]?.id ?? null);
    if (channelPickerScopeId === scopeId) setChannelPickerScopeId(null);
  };

  const visiblePointCount = scopePanels.reduce(
    (total, panel) => total + (visiblePointCounts[panel.id] ?? 0),
    0,
  );
  const currentRenderRates = scopePanels
    .map((panel) => renderRates[panel.id] ?? 0)
    .filter((rate) => rate > 0);
  const renderRate = currentRenderRates.length > 0
    ? Math.round(currentRenderRates.reduce((total, rate) => total + rate, 0) / currentRenderRates.length)
    : 0;

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
            className="control-button add-scope-button"
            type="button"
            onClick={addScope}
            disabled={!layoutKey || scopePanels.length >= MAX_SCOPE_PANELS}
            aria-label="Add scope"
            title={scopePanels.length >= MAX_SCOPE_PANELS
              ? `Up to ${MAX_SCOPE_PANELS} scopes are supported`
              : 'Add an independent waveform panel'}
          >
            <Plus size={14} />
            <span>Add scope</span>
          </button>

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
            <span className="channel-heading-title">
              CHANNELS
              <small>{activeScope?.title ?? 'Scope'}</small>
            </span>
            <span className="channel-count">{activeScopeChannelIds.size} / {channels.length}</span>
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
                  const visible = activeScopeChannelIds.has(channel.id);
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
                          if (activeScope) toggleScopeChannel(activeScope.id, channel.key);
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
        <div
          className={`scope-grid${scopePanels.length === 1 ? ' single' : ''}`}
          style={scopePanels.length > 1
            ? { gridTemplateRows: `repeat(${scopePanels.length}, minmax(300px, 1fr))` }
            : undefined}
        >
          {scopePanels.map((panel, panelIndex) => {
            const panelChannelKeys = new Set(panel.channelKeys);
            const panelVisibleChannels = new Set(
              channels
                .filter((channel) => panelChannelKeys.has(channel.key))
                .map((channel) => channel.id),
            );
            const panelIsActive = panel.id === activeScope?.id;
            const pickerOpen = panel.id === channelPickerScopeId;

            return (
              <section
                className={`scope-panel${panelIsActive ? ' active' : ''}`}
                aria-label={panel.title}
                key={panel.id}
                onPointerDown={() => setActiveScopeId(panel.id)}
              >
                <div className="plot-legend">
                  <button
                    className="scope-identity"
                    type="button"
                    onClick={() => setActiveScopeId(panel.id)}
                    aria-label={`Activate ${panel.title}`}
                    aria-pressed={panelIsActive}
                  >
                    <span>{String(panelIndex + 1).padStart(2, '0')}</span>
                    <strong>{panel.title}</strong>
                  </button>

                  <div className="scope-legend-scroll" aria-label={`${panel.title} channel legend`}>
                    {channels.filter((channel) => panelVisibleChannels.has(channel.id)).map((channel) => {
                      const channelIndex = channelIndexes.get(channel.id) ?? -1;
                      const selected = panelIsActive && channel.id === selectedChannel;
                      return (
                        <button
                          className={`legend-item${selected ? ' selected' : ''}`}
                          type="button"
                          key={channel.id}
                          onClick={() => {
                            setActiveScopeId(panel.id);
                            setSelectedChannel(channel.id);
                          }}
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
                    {panelVisibleChannels.size === 0 && (
                      <span className="legend-empty">No channels selected</span>
                    )}
                  </div>

                  <div className="scope-panel-actions">
                    <button
                      className={`scope-action${pickerOpen ? ' active' : ''}`}
                      type="button"
                      onClick={() => setChannelPickerScopeId((current) => current === panel.id ? null : panel.id)}
                      aria-label={`Choose channels for ${panel.title}`}
                      aria-haspopup="dialog"
                      aria-expanded={pickerOpen}
                      title="Choose channels"
                    >
                      <SlidersHorizontal size={14} />
                      <span>{panelVisibleChannels.size}</span>
                    </button>
                    {scopePanels.length > 1 && (
                      <button
                        className="scope-action danger"
                        type="button"
                        onClick={() => deleteScope(panel.id)}
                        aria-label={`Delete ${panel.title}`}
                        title={`Delete ${panel.title}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <WaveformPlot
                  channels={channels}
                  data={timeline.data}
                  dataVersion={telemetry.version}
                  visibleChannels={panelVisibleChannels}
                  selectedChannel={panelIsActive ? selectedChannel : ''}
                  windowSeconds={windowSeconds}
                  pausedAt={pausedAt}
                  autoY={autoY}
                  theme={theme}
                  scrollWhenIdle={settings.scrollWhenIdle}
                  getClockTime={getViewTime}
                  onShowAllChannels={() => setScopeChannelKeys(
                    panel.id,
                    channels.map((channel) => channel.key),
                  )}
                  onVisiblePointCount={(count) => setVisiblePointCounts((current) => (
                    current[panel.id] === count ? current : { ...current, [panel.id]: count }
                  ))}
                  onRenderRate={(rate) => setRenderRates((current) => (
                    current[panel.id] === rate ? current : { ...current, [panel.id]: rate }
                  ))}
                  emptyTitle={channels.length > 0 ? `No channels in ${panel.title}` : emptyTitle}
                  emptyMessage={channels.length > 0
                    ? 'Choose the signals this scope should display. Each scope keeps an independent Y range.'
                    : emptyMessage}
                  showEmptyAction={channels.length > 0}
                />

                {pickerOpen && (
                  <>
                    <button
                      className="scope-picker-scrim"
                      type="button"
                      onClick={() => setChannelPickerScopeId(null)}
                      aria-label={`Close channel picker for ${panel.title}`}
                    />
                    <div className="scope-channel-picker" role="dialog" aria-label={`Channels for ${panel.title}`}>
                      <div className="scope-picker-header">
                        <span>
                          <strong>{panel.title}</strong>
                          <small>{panelVisibleChannels.size} of {channels.length} channels</small>
                        </span>
                        <button
                          type="button"
                          onClick={() => setChannelPickerScopeId(null)}
                          aria-label={`Close channels for ${panel.title}`}
                        >
                          <X size={14} />
                        </button>
                      </div>

                      <div className="scope-picker-bulk">
                        <button
                          type="button"
                          onClick={() => setScopeChannelKeys(
                            panel.id,
                            channels.map((channel) => channel.key),
                          )}
                          disabled={channels.length === 0}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => setScopeChannelKeys(panel.id, [])}
                          disabled={panelVisibleChannels.size === 0}
                        >
                          Clear
                        </button>
                      </div>

                      <div className="scope-picker-list">
                        {channels.map((channel) => {
                          const checked = panelChannelKeys.has(channel.key);
                          return (
                            <button
                              className="scope-picker-channel"
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              key={channel.id}
                              onClick={() => toggleScopeChannel(panel.id, channel.key)}
                            >
                              <span className={`picker-check${checked ? ' checked' : ''}`}>
                                {checked ? <Eye size={12} /> : <EyeOff size={12} />}
                              </span>
                              <span
                                className="picker-swatch"
                                style={{ '--channel-color': channel.color } as React.CSSProperties}
                              />
                              <span className="picker-channel-copy">
                                <strong>{channel.label}</strong>
                                <small>{channel.key}</small>
                              </span>
                            </button>
                          );
                        })}
                        {channels.length === 0 && (
                          <span className="scope-picker-empty">Channels will appear after the first sample.</span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>
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
