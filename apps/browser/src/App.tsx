import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  Database,
  Download,
  Eye,
  EyeOff,
  Gauge,
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
  GripVertical,
  Sun,
  Trash2,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { WaveformPlot } from './components/WaveformPlot';
import { IndicatorPanel } from './components/IndicatorPanel';
import { ValueBarPanel } from './components/ValueBarPanel';
import { useTelemetry } from './hooks/useTelemetry';
import {
  DEFAULT_STATE_COLORS,
  panelTypeLabel,
  type PanelDefinition,
  type PanelGridLayout,
  type PanelType,
  type ScopePanelDefinition,
  type StateColorDefinition,
  type ValueBarChannelRange,
} from './panelTypes';
import { estimateSampling, prepareTimeline } from './timeline';
import type {
  ChannelDefinition,
  LineCurve,
  LinePattern,
  ThemeMode,
  YScaleMode,
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
const COLLAPSED_CHANNEL_GROUPS_KEY = 'debugscope.collapsed-channel-groups.v1';
const MAX_PANELS = 8;
const WORKSPACE_TEMPLATE_KEY = '__debugscope_workspace_template__';
const GRID_COLUMNS = 12;
const GRID_GAP = 12;
const GRID_ROW_HEIGHT = 72;
const MIN_PANEL_WIDTH = 3;
const MIN_PANEL_HEIGHT = 2;
const MIN_INDICATOR_PANEL_WIDTH = 2;
const MIN_INDICATOR_PANEL_HEIGHT = 1;
const MIN_WINDOW_SECONDS = 0.1;
const MAX_WINDOW_SECONDS = 3_600;
const DEFAULT_SIDEBAR_WIDTH = 252;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 480;
const WORKSPACE_CONFIG_SCHEMA = 'debugscope.workspace';
const WORKSPACE_CONFIG_VERSION = 1;
const MAX_WORKSPACE_FILE_BYTES = 1024 * 1024;

interface UserSettings {
  scrollWhenIdle: boolean;
  fontScale: number;
  sidebarWidth: number;
}

type ScopeLayouts = Record<string, PanelDefinition[]>;

interface LayoutInteraction {
  kind: 'move' | 'resize';
  panelId: string;
  startX: number;
  startY: number;
  origin: PanelGridLayout;
  panels: PanelDefinition[];
  workspaceWidth: number;
}

interface SidebarResizeInteraction {
  pointerId: number;
  startX: number;
  startWidth: number;
}

interface WorkspaceConfigFile {
  schema: typeof WORKSPACE_CONFIG_SCHEMA;
  version: typeof WORKSPACE_CONFIG_VERSION;
  exportedAt: string;
  sourceName: string;
  panels: PanelDefinition[];
}

interface WorkspaceFeedback {
  kind: 'success' | 'error';
  message: string;
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

const Y_SCALE_OPTIONS: ReadonlyArray<{
  value: YScaleMode;
  label: string;
  title: string;
}> = [
  {
    value: 'fit',
    label: 'Fit Data',
    title: 'Automatically fit both Y-axis bounds to data in the current time window',
  },
  {
    value: 'zero-min',
    label: '0 to Max',
    title: 'Keep the lower bound at 0 and automatically follow the data maximum',
  },
  {
    value: 'zero-max',
    label: 'Min to 0',
    title: 'Keep the upper bound at 0 and automatically follow the data minimum',
  },
  {
    value: 'manual',
    label: 'Manual',
    title: 'Manual Y: wheel to zoom Y · drag to pan · Shift+wheel to zoom X · double-click to fit data',
  },
];

interface StylePreviewProps {
  kind: 'curve' | 'pattern';
  value: LineCurve | LinePattern;
}

interface TimeWindowControlProps {
  panel: ScopePanelDefinition;
  automaticSeconds: number;
  frequencyHz: number;
  onChange: (patch: Partial<ScopePanelDefinition>) => void;
}

function clampWindowSeconds(value: number): number {
  return Math.min(MAX_WINDOW_SECONDS, Math.max(MIN_WINDOW_SECONDS, value));
}

function formatWindowSeconds(value: number): string {
  if (value >= 10) return String(Math.round(value));
  if (value >= 1) return Number(value.toFixed(1)).toString();
  return Number(value.toFixed(2)).toString();
}

function TimeWindowControl({
  panel,
  automaticSeconds,
  frequencyHz,
  onChange,
}: TimeWindowControlProps) {
  const resolvedSeconds = panel.windowMode === 'auto' ? automaticSeconds : panel.windowSeconds;
  const [draft, setDraft] = useState(() => formatWindowSeconds(resolvedSeconds));
  const editingRef = useRef(false);
  const cancelCommitRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(formatWindowSeconds(resolvedSeconds));
  }, [resolvedSeconds]);

  const commit = () => {
    editingRef.current = false;
    const parsed = Number(draft);
    const seconds = Number.isFinite(parsed)
      ? clampWindowSeconds(parsed)
      : resolvedSeconds;
    setDraft(formatWindowSeconds(seconds));
    onChange({ windowMode: 'manual', windowSeconds: seconds });
  };

  return (
    <div
      className={`scope-window-control${panel.windowMode === 'auto' ? ' automatic' : ''}`}
      title={panel.windowMode === 'auto'
        ? `Automatic window · estimated ${frequencyHz.toFixed(frequencyHz >= 10 ? 0 : 1)} Hz`
        : 'Manual visible time window'}
    >
      <button
        type="button"
        className={panel.windowMode === 'auto' ? 'active' : ''}
        onClick={() => onChange(panel.windowMode === 'auto'
          ? { windowMode: 'manual', windowSeconds: automaticSeconds }
          : { windowMode: 'auto' })}
        aria-label={`Automatic time window for ${panel.title}`}
        aria-pressed={panel.windowMode === 'auto'}
      >
        A
      </button>
      <input
        type="number"
        min={MIN_WINDOW_SECONDS}
        max={MAX_WINDOW_SECONDS}
        step="any"
        value={draft}
        onFocus={(event) => {
          editingRef.current = true;
          cancelCommitRef.current = false;
          event.currentTarget.select();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (cancelCommitRef.current) {
            cancelCommitRef.current = false;
            editingRef.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            cancelCommitRef.current = true;
            setDraft(formatWindowSeconds(resolvedSeconds));
            event.currentTarget.blur();
          }
        }}
        aria-label={`Visible time window for ${panel.title}`}
      />
      <span>s</span>
    </div>
  );
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
    const fontScale = typeof stored.fontScale === 'number' && Number.isFinite(stored.fontScale)
      ? Math.min(1.4, Math.max(0.8, stored.fontScale))
      : 1;
    const sidebarWidth = typeof stored.sidebarWidth === 'number' && Number.isFinite(stored.sidebarWidth)
      ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored.sidebarWidth))
      : DEFAULT_SIDEBAR_WIDTH;
    return { scrollWhenIdle: stored.scrollWhenIdle === true, fontScale, sidebarWidth };
  } catch {
    return { scrollWhenIdle: false, fontScale: 1, sidebarWidth: DEFAULT_SIDEBAR_WIDTH };
  }
}

function initialCollapsedChannelGroups(): Record<string, string[]> {
  try {
    const stored = JSON.parse(localStorage.getItem(COLLAPSED_CHANNEL_GROUPS_KEY) ?? '{}') as unknown;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored as Record<string, unknown>).flatMap(([key, value]) => (
      Array.isArray(value)
        ? [[key, [...new Set(value.filter((group): group is string => typeof group === 'string'))]]]
        : []
    )));
  } catch {
    return {};
  }
}

function defaultPanelLayout(index: number, single = false): PanelGridLayout {
  const height = single ? 8 : 4;
  return { x: 0, y: index * height, width: GRID_COLUMNS, height };
}

function panelMinimumSize(type: PanelType): { width: number; height: number } {
  return type === 'indicators'
    ? { width: MIN_INDICATOR_PANEL_WIDTH, height: MIN_INDICATOR_PANEL_HEIGHT }
    : { width: MIN_PANEL_WIDTH, height: MIN_PANEL_HEIGHT };
}

function normalizePanelLayout(
  value: unknown,
  fallback: PanelGridLayout,
  type: PanelType = 'scope',
): PanelGridLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const candidate = value as Record<string, unknown>;
  const minimum = panelMinimumSize(type);
  const number = (key: string, defaultValue: number) => (
    typeof candidate[key] === 'number' && Number.isFinite(candidate[key])
      ? Math.round(candidate[key])
      : defaultValue
  );
  const width = Math.max(minimum.width, Math.min(GRID_COLUMNS, number('width', fallback.width)));
  const x = Math.max(0, Math.min(GRID_COLUMNS - width, number('x', fallback.x)));
  return {
    x,
    y: Math.max(0, number('y', fallback.y)),
    width,
    height: Math.max(minimum.height, number('height', fallback.height)),
  };
}

function isWorkspacePanelLayout(value: unknown, type: PanelType): value is PanelGridLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const layout = value as Record<string, unknown>;
  if (!['x', 'y', 'width', 'height'].every((key) => (
    typeof layout[key] === 'number'
    && Number.isFinite(layout[key])
    && Number.isInteger(layout[key])
  ))) return false;
  const { x, y, width, height } = layout as unknown as PanelGridLayout;
  const minimum = panelMinimumSize(type);
  return x >= 0
    && y >= 0
    && width >= minimum.width
    && width <= GRID_COLUMNS
    && x + width <= GRID_COLUMNS
    && height >= minimum.height
    && y <= 100_000
    && height <= 10_000;
}

function layoutsOverlap(left: PanelGridLayout, right: PanelGridLayout): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function placePanelWithoutOverlap(
  panels: PanelDefinition[],
  panelId: string,
  layout: PanelGridLayout,
): PanelDefinition[] {
  const moving = panels.find((panel) => panel.id === panelId);
  if (!moving) return panels;
  const layouts = new Map<string, PanelGridLayout>([[panelId, layout]]);
  const placed: PanelGridLayout[] = [layout];
  const remaining = panels
    .filter((panel) => panel.id !== panelId)
    .sort((left, right) => left.layout.y - right.layout.y || left.layout.x - right.layout.x);

  for (const panel of remaining) {
    let next = { ...panel.layout };
    let blockers = placed.filter((candidate) => layoutsOverlap(next, candidate));
    while (blockers.length > 0) {
      next.y = Math.max(...blockers.map((candidate) => candidate.y + candidate.height));
      blockers = placed.filter((candidate) => layoutsOverlap(next, candidate));
    }
    layouts.set(panel.id, next);
    placed.push(next);
  }

  return panels.map((panel) => ({ ...panel, layout: layouts.get(panel.id) ?? panel.layout }));
}

function parsePanelDefinitions(value: unknown, strict = false): PanelDefinition[] {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (!Array.isArray(value)) {
    if (strict) fail('The panels field must be an array.');
    return [];
  }
  if (strict && (value.length === 0 || value.length > MAX_PANELS)) {
    fail(`A workspace must contain between 1 and ${MAX_PANELS} panels.`);
  }

  const panels: PanelDefinition[] = [];
  const ids = new Set<string>();
  for (const [panelIndex, rawPanel] of value.slice(0, MAX_PANELS).entries()) {
    if (!rawPanel || typeof rawPanel !== 'object' || Array.isArray(rawPanel)) {
      if (strict) fail(`Panel ${panelIndex + 1} must be an object.`);
      continue;
    }
    const panel = rawPanel as Record<string, unknown>;
    const validType = panel.type === 'scope'
      || panel.type === 'value-bar'
      || panel.type === 'indicators';
    const validIdentity = typeof panel.id === 'string'
      && panel.id.length > 0
      && typeof panel.title === 'string'
      && panel.title.length > 0;
    const validChannelKeys = Array.isArray(panel.channelKeys)
      && panel.channelKeys.every((key) => typeof key === 'string' && key.length > 0);
    if (!validType || !validIdentity || !validChannelKeys) {
      if (strict) fail(`Panel ${panelIndex + 1} has an invalid type, identity, or channel binding.`);
      continue;
    }
    if (strict && (
      (panel.id as string).length > 200
      || (panel.title as string).length > 120
      || (panel.channelKeys as string[]).length > 1024
      || !isWorkspacePanelLayout(panel.layout, panel.type as PanelType)
    )) {
      fail(`Panel ${panelIndex + 1} has invalid limits or grid coordinates.`);
    }
    if (ids.has(panel.id as string)) {
      if (strict) fail(`Panel ${panelIndex + 1} reuses an existing panel ID.`);
      continue;
    }
    ids.add(panel.id as string);

    const base = {
      id: panel.id as string,
      title: panel.title as string,
      channelKeys: [...new Set(panel.channelKeys as string[])],
      layout: normalizePanelLayout(
        panel.layout,
        defaultPanelLayout(panelIndex, value.length === 1),
        panel.type as PanelType,
      ),
    };
    if (panel.type === 'value-bar') {
      const validRange = (panel.rangeMode === 'auto' || panel.rangeMode === 'manual')
        && typeof panel.manualMin === 'number'
        && Number.isFinite(panel.manualMin)
        && typeof panel.manualMax === 'number'
        && Number.isFinite(panel.manualMax);
      if (strict && !validRange) fail(`Value Bars panel ${panelIndex + 1} has an invalid range.`);
      const rawChannelRanges = panel.channelRanges && typeof panel.channelRanges === 'object'
        && !Array.isArray(panel.channelRanges)
        ? Object.entries(panel.channelRanges as Record<string, unknown>)
        : [];
      const channelRanges = Object.fromEntries(rawChannelRanges.flatMap(([channelKey, rawRange]) => {
        if (!channelKey || !rawRange || typeof rawRange !== 'object' || Array.isArray(rawRange)) return [];
        const range = rawRange as Record<string, unknown>;
        if (
          (range.mode !== 'auto' && range.mode !== 'manual')
          || typeof range.min !== 'number'
          || !Number.isFinite(range.min)
          || typeof range.max !== 'number'
          || !Number.isFinite(range.max)
        ) return [];
        return [[channelKey, { mode: range.mode, min: range.min, max: range.max } satisfies ValueBarChannelRange]];
      }));
      if (strict && rawChannelRanges.length !== Object.keys(channelRanges).length) {
        fail(`Value Bars panel ${panelIndex + 1} has invalid per-channel ranges.`);
      }
      if (strict && panel.channelGroup !== undefined && (
        typeof panel.channelGroup !== 'string' || panel.channelGroup.length === 0
      )) {
        fail(`Value Bars panel ${panelIndex + 1} has an invalid channel group.`);
      }
      panels.push({
        ...base,
        type: 'value-bar',
        rangeMode: panel.rangeMode === 'manual' ? 'manual' : 'auto',
        manualMin: typeof panel.manualMin === 'number' && Number.isFinite(panel.manualMin)
          ? panel.manualMin : 0,
        manualMax: typeof panel.manualMax === 'number' && Number.isFinite(panel.manualMax)
          ? panel.manualMax : 1,
        channelGroup: typeof panel.channelGroup === 'string' ? panel.channelGroup : undefined,
        channelRanges,
      });
      continue;
    }
    if (panel.type === 'indicators') {
      const rawStateColors = Array.isArray(panel.stateColors) ? panel.stateColors : [];
      const stateColors = rawStateColors.flatMap((state): StateColorDefinition[] => {
        if (!state || typeof state !== 'object' || Array.isArray(state)) return [];
        const candidate = state as Record<string, unknown>;
        if (
          typeof candidate.value !== 'number'
          || !Number.isFinite(candidate.value)
          || typeof candidate.label !== 'string'
          || typeof candidate.color !== 'string'
          || !/^#[0-9a-f]{6}$/i.test(candidate.color)
        ) return [];
        return [{ value: candidate.value, label: candidate.label, color: candidate.color }];
      });
      const distinctStateValues = new Set(stateColors.map((state) => state.value));
      if (strict && (
        stateColors.length === 0
        || stateColors.length > 64
        || stateColors.length !== rawStateColors.length
        || distinctStateValues.size !== stateColors.length
      )) {
        fail(`Indicators panel ${panelIndex + 1} has an invalid state color map.`);
      }
      if (strict && panel.channelGroup !== undefined && (
        typeof panel.channelGroup !== 'string' || panel.channelGroup.length === 0
      )) {
        fail(`Indicators panel ${panelIndex + 1} has an invalid channel group.`);
      }
      panels.push({
        ...base,
        type: 'indicators',
        channelGroup: typeof panel.channelGroup === 'string' ? panel.channelGroup : undefined,
        stateColors: stateColors.length > 0
          ? stateColors
          : DEFAULT_STATE_COLORS.map((state) => ({ ...state })),
      });
      continue;
    }
    if (strict && panel.autoY !== undefined && typeof panel.autoY !== 'boolean') {
      fail(`Waveform panel ${panelIndex + 1} has an invalid Auto Y setting.`);
    }
    const validYScaleMode = panel.yScaleMode === 'fit'
      || panel.yScaleMode === 'zero-min'
      || panel.yScaleMode === 'zero-max'
      || panel.yScaleMode === 'manual';
    if (strict && panel.yScaleMode !== undefined && !validYScaleMode) {
      fail(`Waveform panel ${panelIndex + 1} has an invalid Y-axis mode.`);
    }
    if (strict && panel.windowMode !== undefined && panel.windowMode !== 'auto' && panel.windowMode !== 'manual') {
      fail(`Waveform panel ${panelIndex + 1} has an invalid time window mode.`);
    }
    if (strict && panel.windowSeconds !== undefined && (
      typeof panel.windowSeconds !== 'number'
      || !Number.isFinite(panel.windowSeconds)
      || panel.windowSeconds < MIN_WINDOW_SECONDS
      || panel.windowSeconds > MAX_WINDOW_SECONDS
    )) {
      fail(`Waveform panel ${panelIndex + 1} has an invalid time window.`);
    }
    const storedWindowSeconds = typeof panel.windowSeconds === 'number' && Number.isFinite(panel.windowSeconds)
      ? clampWindowSeconds(panel.windowSeconds)
      : 10;
    panels.push({
      ...base,
      type: 'scope',
      yScaleMode: validYScaleMode
        ? panel.yScaleMode as YScaleMode
        : panel.autoY === false ? 'manual' : 'fit',
      windowMode: panel.windowMode === 'auto' ? 'auto' : 'manual',
      windowSeconds: storedWindowSeconds,
    });
  }
  return panels;
}

function initialScopeLayouts(): ScopeLayouts {
  try {
    const stored = JSON.parse(localStorage.getItem(SCOPE_LAYOUTS_KEY) ?? '{}') as unknown;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored as Record<string, unknown>)
        .map(([programKey, value]) => [programKey, parsePanelDefinitions(value)] as const)
        .filter(([, panels]) => panels.length > 0),
    );
  } catch {
    return {};
  }
}

function parseWorkspaceConfig(value: unknown): WorkspaceConfigFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The workspace file must contain a JSON object.');
  }
  const config = value as Record<string, unknown>;
  if (config.schema !== WORKSPACE_CONFIG_SCHEMA) {
    throw new Error('This is not a DebugScope workspace file.');
  }
  if (config.version !== WORKSPACE_CONFIG_VERSION) {
    throw new Error(`Workspace version ${String(config.version)} is not supported.`);
  }
  return {
    schema: WORKSPACE_CONFIG_SCHEMA,
    version: WORKSPACE_CONFIG_VERSION,
    exportedAt: typeof config.exportedAt === 'string' ? config.exportedAt : '',
    sourceName: typeof config.sourceName === 'string' ? config.sourceName : '',
    panels: parsePanelDefinitions(config.panels, true),
  };
}

function workspaceFilename(sourceName: string): string {
  const slug = sourceName.trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workspace';
  return `debugscope-${slug}.workspace.json`;
}

function createScopeId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `scope-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function nextPanelTitle(panels: PanelDefinition[], type: PanelType): string {
  const base = type === 'scope' ? 'Scope' : type === 'value-bar' ? 'Value Bars' : 'Indicators';
  const titles = new Set(panels.map((panel) => panel.title));
  let number = 1;
  while (titles.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

function effectivePanelChannelKeys(
  panel: PanelDefinition | undefined,
  channels: ChannelDefinition[],
): string[] {
  if (!panel || panel.type === 'scope' || !panel.channelGroup) return panel?.channelKeys ?? [];
  const prefix = `${panel.channelGroup}.`;
  return channels
    .filter((channel) => {
      if (!channel.key.startsWith(prefix)) return false;
      return /^\d+$/.test(channel.key.slice(prefix.length));
    })
    .map((channel) => channel.key);
}

export default function App() {
  const telemetry = useTelemetry();
  const rawChannels = telemetry.channels;
  const activeSource = telemetry.sources.find((source) => source.id === telemetry.activeSourceId);
  const channelIdentity = rawChannels.map((channel) => channel.id).join('|');
  const previousIdleScrollRef = useRef<boolean | null>(null);

  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const [settings, setSettings] = useState<UserSettings>(initialSettings);
  const [collapsedChannelGroups, setCollapsedChannelGroups] = useState<Record<string, string[]>>(
    initialCollapsedChannelGroups,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceFeedback, setWorkspaceFeedback] = useState<WorkspaceFeedback | null>(null);
  const [channelStyles, setChannelStyles] = useState<Record<string, StoredChannelStyle>>(
    initialChannelStyles,
  );
  const [scopeLayouts, setScopeLayouts] = useState<ScopeLayouts>(initialScopeLayouts);
  const [layoutInteraction, setLayoutInteraction] = useState<LayoutInteraction | null>(null);
  const [layoutPreview, setLayoutPreview] = useState<PanelDefinition[] | null>(null);
  const [activeScopeId, setActiveScopeId] = useState<string | null>(null);
  const [editingPanelTitleId, setEditingPanelTitleId] = useState<string | null>(null);
  const [panelTitleDraft, setPanelTitleDraft] = useState('');
  const [channelPickerScopeId, setChannelPickerScopeId] = useState<string | null>(null);
  const [colorEditorPanelId, setColorEditorPanelId] = useState<string | null>(null);
  const [addPanelMenuOpen, setAddPanelMenuOpen] = useState(false);
  const [styleEditorChannelId, setStyleEditorChannelId] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [channelSearch, setChannelSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hubEditorOpen, setHubEditorOpen] = useState(false);
  const [hubAddress, setHubAddress] = useState('');
  const [hubAddressError, setHubAddressError] = useState('');
  const [visiblePointCounts, setVisiblePointCounts] = useState<Record<string, number>>({});
  const [renderRates, setRenderRates] = useState<Record<string, number>>({});
  const gridRef = useRef<HTMLDivElement>(null);
  const layoutPreviewRef = useRef<PanelDefinition[] | null>(null);
  const workspaceFileRef = useRef<HTMLInputElement>(null);
  const sidebarResizeRef = useRef<SidebarResizeInteraction | null>(null);

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
  const layoutKey = activeSource?.programKey ?? WORKSPACE_TEMPLATE_KEY;
  const defaultScope = useMemo<PanelDefinition>(() => ({
    id: `scope-default:${layoutKey ?? 'waiting'}`,
    type: 'scope',
    title: 'Scope 1',
    channelKeys: channels.slice(0, 4).map((channel) => channel.key),
    layout: defaultPanelLayout(0, true),
    yScaleMode: 'fit',
    windowMode: 'auto',
    windowSeconds: 10,
  }), [channelIdentity, layoutKey]);
  const scopePanels = useMemo(() => {
    const stored = scopeLayouts[layoutKey];
    if (stored?.length) return stored;
    const template = activeSource ? scopeLayouts[WORKSPACE_TEMPLATE_KEY] : undefined;
    if (template?.length) {
      return template.map((panel) => (
        panel.type === 'scope'
        && panel.id === `scope-default:${WORKSPACE_TEMPLATE_KEY}`
        && panel.channelKeys.length === 0
          ? {
            ...panel,
            id: `scope-default:${layoutKey}`,
            channelKeys: channels.slice(0, 4).map((channel) => channel.key),
          }
          : panel
      ));
    }
    return [defaultScope];
  }, [defaultScope, layoutKey, scopeLayouts]);
  const displayedPanels = layoutPreview ?? scopePanels;
  const activeScope = scopePanels.find((panel) => panel.id === activeScopeId) ?? scopePanels[0];
  const activeScopeChannelIds = useMemo(() => {
    const keys = new Set(effectivePanelChannelKeys(activeScope, channels));
    return new Set(channels.filter((channel) => keys.has(channel.key)).map((channel) => channel.id));
  }, [activeScope, channels]);
  const numberedChannelGroups = useMemo(() => {
    const groups = new Map<string, ChannelDefinition[]>();
    for (const channel of channels) {
      const match = /^(.*)\.(\d+)$/.exec(channel.key);
      if (!match?.[1]) continue;
      const group = groups.get(match[1]) ?? [];
      group.push(channel);
      groups.set(match[1], group);
    }
    return [...groups.entries()]
      .filter(([, groupChannels]) => groupChannels.length > 1)
      .map(([name, groupChannels]) => [name, groupChannels.sort((left, right) => {
        const leftIndex = Number(left.key.split('.').at(-1));
        const rightIndex = Number(right.key.split('.').at(-1));
        return leftIndex - rightIndex;
      })] as const);
  }, [channels]);
  const styleEditorChannel = channels.find((channel) => channel.id === styleEditorChannelId);
  const paused = pausedAt !== null;
  const timeline = useMemo(
    () => prepareTimeline(telemetry.data, settings.scrollWhenIdle),
    [settings.scrollWhenIdle, telemetry.data, telemetry.version],
  );
  const sampling = useMemo(
    () => estimateSampling(telemetry.data[0]),
    [telemetry.data, telemetry.version],
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
    document.documentElement.style.setProperty('--font-scale', String(settings.fontScale));
  }, [settings.fontScale]);

  useEffect(() => {
    localStorage.setItem(CHANNEL_STYLES_KEY, JSON.stringify(channelStyles));
  }, [channelStyles]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_CHANNEL_GROUPS_KEY, JSON.stringify(collapsedChannelGroups));
  }, [collapsedChannelGroups]);

  useEffect(() => {
    localStorage.setItem(SCOPE_LAYOUTS_KEY, JSON.stringify(scopeLayouts));
  }, [scopeLayouts]);

  useEffect(() => {
    const anyOverlayOpen = settingsOpen
      || addPanelMenuOpen
      || hubEditorOpen
      || Boolean(styleEditorChannelId)
      || Boolean(channelPickerScopeId)
      || Boolean(colorEditorPanelId);
    if (!anyOverlayOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (settingsOpen && !target.closest('.settings-panel, .settings-button, .settings-scrim')) {
        setSettingsOpen(false);
      }
      if (addPanelMenuOpen && !target.closest('.add-panel-control, .add-panel-scrim')) {
        setAddPanelMenuOpen(false);
      }
      if (hubEditorOpen && !target.closest('.hub-editor, [data-hub-editor-trigger]')) {
        setHubEditorOpen(false);
      }
      if (styleEditorChannelId && !target.closest('.style-editor, .style-button')) {
        setStyleEditorChannelId(null);
      }
      if (channelPickerScopeId && !target.closest(
        '.scope-channel-picker, .scope-picker-scrim, [data-channel-picker-trigger]',
      )) {
        setChannelPickerScopeId(null);
      }
      if (colorEditorPanelId && !target.closest(
        '.state-color-editor, [data-color-editor-trigger]',
      )) {
        setColorEditorPanelId(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSettingsOpen(false);
      setAddPanelMenuOpen(false);
      setHubEditorOpen(false);
      setStyleEditorChannelId(null);
      setChannelPickerScopeId(null);
      setColorEditorPanelId(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [
    addPanelMenuOpen,
    channelPickerScopeId,
    colorEditorPanelId,
    hubEditorOpen,
    settingsOpen,
    styleEditorChannelId,
  ]);

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
    if (colorEditorPanelId && !scopePanels.some((panel) => panel.id === colorEditorPanelId)) {
      setColorEditorPanelId(null);
    }
  }, [activeScopeId, channelPickerScopeId, colorEditorPanelId, scopePanels]);

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
    setColorEditorPanelId(null);
    setEditingPanelTitleId(null);
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

  const collapsedGroupsForSource = useMemo(
    () => new Set(collapsedChannelGroups[layoutKey] ?? []),
    [collapsedChannelGroups, layoutKey],
  );

  const toggleChannelGroup = useCallback((group: string) => {
    setCollapsedChannelGroups((current) => {
      const nextGroups = new Set(current[layoutKey] ?? []);
      if (nextGroups.has(group)) nextGroups.delete(group);
      else nextGroups.add(group);
      return { ...current, [layoutKey]: [...nextGroups] };
    });
  }, [layoutKey]);

  const channelIndexes = useMemo(
    () => new Map(channels.map((channel, index) => [channel.id, index])),
    [channels],
  );

  const updateScopePanels = useCallback((
    updater: (panels: PanelDefinition[]) => PanelDefinition[],
  ) => {
    setScopeLayouts((current) => {
      const base = current[layoutKey]?.length ? current[layoutKey] : scopePanels;
      return { ...current, [layoutKey]: updater(base) };
    });
  }, [layoutKey, scopePanels]);

  const beginLayoutInteraction = useCallback((
    event: React.PointerEvent<HTMLElement>,
    panel: PanelDefinition,
    kind: LayoutInteraction['kind'],
  ) => {
    if (window.innerWidth <= 920 || event.button !== 0) return;
    const grid = gridRef.current;
    if (!grid) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveScopeId(panel.id);
    setChannelPickerScopeId(null);
    layoutPreviewRef.current = scopePanels;
    setLayoutPreview(scopePanels);
    setLayoutInteraction({
      kind,
      panelId: panel.id,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...panel.layout },
      panels: scopePanels,
      workspaceWidth: grid.getBoundingClientRect().width,
    });
  }, [scopePanels]);

  useEffect(() => {
    if (!layoutInteraction) return;
    document.body.classList.add('layout-interacting');
    document.body.dataset.layoutInteraction = layoutInteraction.kind;

    const move = (event: PointerEvent) => {
      const columnWidth = (
        layoutInteraction.workspaceWidth - GRID_GAP * (GRID_COLUMNS - 1)
      ) / GRID_COLUMNS;
      const columnStep = Math.max(1, columnWidth + GRID_GAP);
      const rowStep = GRID_ROW_HEIGHT + GRID_GAP;
      const deltaColumns = Math.round((event.clientX - layoutInteraction.startX) / columnStep);
      const deltaRows = Math.round((event.clientY - layoutInteraction.startY) / rowStep);
      const origin = layoutInteraction.origin;
      const resizedPanel = layoutInteraction.panels.find((panel) => (
        panel.id === layoutInteraction.panelId
      ));
      const minimum = panelMinimumSize(resizedPanel?.type ?? 'scope');
      const next = layoutInteraction.kind === 'move'
        ? {
          ...origin,
          x: Math.max(0, Math.min(GRID_COLUMNS - origin.width, origin.x + deltaColumns)),
          y: Math.max(0, origin.y + deltaRows),
        }
        : {
          ...origin,
          width: Math.max(
            minimum.width,
            Math.min(GRID_COLUMNS - origin.x, origin.width + deltaColumns),
          ),
          height: Math.max(minimum.height, origin.height + deltaRows),
        };
      const preview = placePanelWithoutOverlap(
        layoutInteraction.panels,
        layoutInteraction.panelId,
        next,
      );
      layoutPreviewRef.current = preview;
      setLayoutPreview(preview);
    };

    const finish = (commit: boolean) => {
      const preview = layoutPreviewRef.current;
      if (commit && preview) updateScopePanels(() => preview);
      layoutPreviewRef.current = null;
      setLayoutPreview(null);
      setLayoutInteraction(null);
    };
    const pointerUp = () => finish(true);
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', pointerUp, { once: true });
    window.addEventListener('pointercancel', pointerUp, { once: true });
    window.addEventListener('keydown', keyDown);
    return () => {
      document.body.classList.remove('layout-interacting');
      delete document.body.dataset.layoutInteraction;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerUp);
      window.removeEventListener('keydown', keyDown);
    };
  }, [layoutInteraction, updateScopePanels]);

  const setScopeChannelKeys = useCallback((scopeId: string, channelKeys: string[]) => {
    updateScopePanels((panels) => panels.map((panel) => panel.id === scopeId
      ? {
        ...panel,
        channelKeys: [...new Set(channelKeys)],
        ...(panel.type !== 'scope' ? { channelGroup: undefined } : {}),
      }
      : panel));
  }, [updateScopePanels]);

  const bindPanelGroup = useCallback((panelId: string, channelGroup: string) => {
    updateScopePanels((panels) => panels.map((panel) => (
      panel.id === panelId && panel.type !== 'scope'
        ? { ...panel, channelGroup }
        : panel
    )));
  }, [updateScopePanels]);

  const updatePanel = useCallback((panelId: string, patch: Partial<PanelDefinition>) => {
    updateScopePanels((panels) => panels.map((panel) => (
      panel.id === panelId ? { ...panel, ...patch } as PanelDefinition : panel
    )));
  }, [updateScopePanels]);

  const finishPanelTitleEdit = useCallback((panelId: string) => {
    const title = panelTitleDraft.trim().slice(0, 120);
    if (title) updatePanel(panelId, { title });
    setEditingPanelTitleId(null);
    setPanelTitleDraft('');
  }, [panelTitleDraft, updatePanel]);

  const toggleScopeChannel = useCallback((scopeId: string, channelKey: string) => {
    updateScopePanels((panels) => panels.map((panel) => {
      if (panel.id !== scopeId) return panel;
      const channelKeys = new Set(effectivePanelChannelKeys(panel, channels));
      if (channelKeys.has(channelKey)) channelKeys.delete(channelKey);
      else channelKeys.add(channelKey);
      return {
        ...panel,
        channelKeys: [...channelKeys],
        ...(panel.type !== 'scope' ? { channelGroup: undefined } : {}),
      };
    }));
  }, [channels, updateScopePanels]);

  const addPanel = (type: PanelType) => {
    if (scopePanels.length >= MAX_PANELS) return;
    const nextRow = scopePanels.reduce(
      (bottom, panel) => Math.max(bottom, panel.layout.y + panel.layout.height),
      0,
    );
    const base = {
      id: createScopeId(),
      title: nextPanelTitle(scopePanels, type),
      channelKeys: [],
      layout: { x: 0, y: nextRow, width: GRID_COLUMNS, height: type === 'indicators' ? 2 : 4 },
    };
    const panel: PanelDefinition = type === 'value-bar'
      ? {
        ...base,
        type,
        rangeMode: 'auto',
        manualMin: 0,
        manualMax: 1,
        channelRanges: {},
      }
      : type === 'indicators'
        ? { ...base, type, stateColors: DEFAULT_STATE_COLORS.map((state) => ({ ...state })) }
        : { ...base, type, yScaleMode: 'fit', windowMode: 'auto', windowSeconds: 10 };
    updateScopePanels((panels) => [...panels, panel]);
    setActiveScopeId(panel.id);
    setChannelPickerScopeId(panel.id);
    setAddPanelMenuOpen(false);
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
    if (colorEditorPanelId === scopeId) setColorEditorPanelId(null);
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

  const exportWorkspace = () => {
    const sourceName = activeSource?.name ?? 'Offline template';
    const config: WorkspaceConfigFile = {
      schema: WORKSPACE_CONFIG_SCHEMA,
      version: WORKSPACE_CONFIG_VERSION,
      exportedAt: new Date().toISOString(),
      sourceName,
      panels: scopePanels,
    };
    const url = URL.createObjectURL(new Blob(
      [JSON.stringify(config, null, 2)],
      { type: 'application/json' },
    ));
    const link = document.createElement('a');
    link.href = url;
    link.download = workspaceFilename(sourceName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setWorkspaceFeedback({
      kind: 'success',
      message: `Exported ${scopePanels.length} panel${scopePanels.length === 1 ? '' : 's'}.`,
    });
  };

  const importWorkspace = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_WORKSPACE_FILE_BYTES) {
      setWorkspaceFeedback({ kind: 'error', message: 'Workspace files must be smaller than 1 MB.' });
      return;
    }
    try {
      const config = parseWorkspaceConfig(JSON.parse(await file.text()) as unknown);
      setScopeLayouts((current) => ({ ...current, [layoutKey]: config.panels }));
      setActiveScopeId(config.panels[0]?.id ?? null);
      setChannelPickerScopeId(null);
      setLayoutPreview(null);
      setWorkspaceFeedback({
        kind: 'success',
        message: `Imported ${config.panels.length} panel${config.panels.length === 1 ? '' : 's'} from ${file.name}.`,
      });
    } catch (error) {
      setWorkspaceFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not import this workspace file.',
      });
    }
  };

  const addHub = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!telemetry.addHub(hubAddress)) {
      setHubAddressError('Enter a new Hub address, for example 192.168.1.20:4713');
      return;
    }
    setHubAddress('');
    setHubAddressError('');
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

  const setSidebarWidth = (width: number) => {
    const nextWidth = Math.round(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)));
    setSettings((current) => current.sidebarWidth === nextWidth
      ? current
      : { ...current, sidebarWidth: nextWidth });
  };

  const startSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    sidebarResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: settings.sidebarWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.documentElement.classList.add('sidebar-resizing');
  };

  const moveSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const resize = sidebarResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setSidebarWidth(resize.startWidth + event.clientX - resize.startX);
  };

  const stopSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const resize = sidebarResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    sidebarResizeRef.current = null;
    document.documentElement.classList.remove('sidebar-resizing');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeSidebarWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let nextWidth = settings.sidebarWidth;
    if (event.key === 'ArrowLeft') nextWidth -= 12;
    else if (event.key === 'ArrowRight') nextWidth += 12;
    else if (event.key === 'Home') nextWidth = MIN_SIDEBAR_WIDTH;
    else if (event.key === 'End') nextWidth = MAX_SIDEBAR_WIDTH;
    else return;
    event.preventDefault();
    setSidebarWidth(nextWidth);
  };

  return (
    <div
      className={`app-shell${sidebarOpen ? ' sidebar-open' : ''}`}
      style={{ '--sidebar-width': `${settings.sidebarWidth}px` } as React.CSSProperties}
    >
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

          <div className="add-panel-control">
            <button
              className={`control-button add-scope-button${addPanelMenuOpen ? ' active' : ''}`}
              type="button"
              onClick={() => setAddPanelMenuOpen((open) => !open)}
              disabled={scopePanels.length >= MAX_PANELS}
              aria-label="Add panel"
              aria-haspopup="menu"
              aria-expanded={addPanelMenuOpen}
              title={scopePanels.length >= MAX_PANELS
                ? `Up to ${MAX_PANELS} panels are supported`
                : 'Add a telemetry panel'}
            >
              <Plus size={14} />
              <span>Add panel</span>
              <ChevronDown size={12} />
            </button>
            {addPanelMenuOpen && (
              <>
                <button
                  className="add-panel-scrim"
                  type="button"
                  onClick={() => setAddPanelMenuOpen(false)}
                  aria-label="Close panel menu"
                />
                <div className="add-panel-menu" role="menu" aria-label="Panel type">
                  <button type="button" role="menuitem" onClick={() => addPanel('scope')}>
                    <Activity size={15} />
                    <span><strong>Waveform</strong><small>Signals over time</small></span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => addPanel('value-bar')}>
                    <Gauge size={15} />
                    <span><strong>Value bars</strong><small>Values within a range</small></span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => addPanel('indicators')}>
                    <Radio size={15} />
                    <span><strong>Indicators</strong><small>Boolean and enum states</small></span>
                  </button>
                </div>
              </>
            )}
          </div>

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
            <span className="section-heading-actions">
              <span className="channel-count">{telemetry.sources.length}</span>
              {telemetry.mode === 'live' && (
                <button
                  className={`section-add-button${hubEditorOpen ? ' active' : ''}`}
                  type="button"
                  onClick={() => {
                    setHubEditorOpen((open) => !open);
                    setHubAddressError('');
                  }}
                  aria-label="Add Hub address"
                  aria-expanded={hubEditorOpen}
                  title="Connect to another DebugScope Hub"
                  data-hub-editor-trigger
                >
                  <Plus size={13} />
                </button>
              )}
            </span>
          </div>

          {hubEditorOpen && telemetry.mode === 'live' && (
            <div className="hub-editor">
              <form className="hub-address-form" onSubmit={addHub}>
                <label htmlFor="hub-address">Hub address</label>
                <div>
                  <input
                    id="hub-address"
                    type="text"
                    value={hubAddress}
                    onChange={(event) => {
                      setHubAddress(event.target.value);
                      setHubAddressError('');
                    }}
                    placeholder="192.168.1.20:4713"
                    aria-invalid={Boolean(hubAddressError)}
                    autoFocus
                  />
                  <button type="submit" disabled={!hubAddress.trim()}>Add</button>
                </div>
                {hubAddressError && <small role="alert">{hubAddressError}</small>}
              </form>
              <div className="hub-list" aria-label="Configured Hub addresses">
                {telemetry.hubs.map((hub) => (
                  <div className="hub-row" key={hub.id}>
                    <i className={`connection-dot tiny${hub.connection === 'connected' ? '' : ' stale'}`} />
                    <span title={hub.address}>{hub.address.replace(/^wss?:\/\//, '')}</span>
                    {hub.removable && (
                      <button
                        type="button"
                        onClick={() => telemetry.removeHub(hub.id)}
                        aria-label={`Remove Hub ${hub.address}`}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

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
                      {telemetry.hubs.length > 1 && source.hubAddress
                        ? ` · ${source.hubAddress.replace(/^wss?:\/\//, '').replace(/\/api\/ws$/, '')}`
                        : ''}
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

          {groupedChannels.map(([group, groupChannels], groupIndex) => {
            const collapsed = !channelSearch.trim() && collapsedGroupsForSource.has(group);
            const groupContentId = `channel-group-${groupIndex}`;
            return (
            <div className={`channel-group${collapsed ? ' collapsed' : ''}`} key={group}>
              <button
                className="group-label"
                type="button"
                onClick={() => toggleChannelGroup(group)}
                aria-label={`${group} channel group`}
                aria-expanded={!collapsed}
                aria-controls={groupContentId}
              >
                <ChevronDown size={14} aria-hidden="true" />
                <span>{group}</span>
                <b>{groupChannels.length}</b>
              </button>

              {!collapsed && <div className="channel-list" id={groupContentId}>
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
              </div>}
            </div>
            );
          })}

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

        <div
          className="sidebar-resize-handle"
          role="separator"
          tabIndex={0}
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={settings.sidebarWidth}
          title="Drag to resize sidebar · double-click to reset"
          onPointerDown={startSidebarResize}
          onPointerMove={moveSidebarResize}
          onPointerUp={stopSidebarResize}
          onPointerCancel={stopSidebarResize}
          onLostPointerCapture={stopSidebarResize}
          onKeyDown={resizeSidebarWithKeyboard}
          onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
        />
      </aside>

      <button
        className="sidebar-scrim"
        type="button"
        aria-label="Close channels"
        onClick={() => setSidebarOpen(false)}
      />

      <main className="workspace">
        <div
          className="scope-grid"
          ref={gridRef}
        >
          {displayedPanels.map((panel, panelIndex) => {
            const panelChannelKeys = new Set(effectivePanelChannelKeys(panel, channels));
            const panelChannels = channels.filter((channel) => panelChannelKeys.has(channel.key));
            const panelVisibleChannels = new Set(
              panelChannels.map((channel) => channel.id),
            );
            const panelIsActive = panel.id === activeScope?.id;
            const pickerOpen = panel.id === channelPickerScopeId;

            return (
              <section
                className={`scope-panel panel-${panel.type}${panel.layout.width <= 2 ? ' compact-panel' : ''}${panelIsActive ? ' active' : ''}${
                  layoutInteraction?.panelId === panel.id ? ` layout-${layoutInteraction.kind}` : ''
                }`}
                aria-label={panel.title}
                key={panel.id}
                onPointerDown={() => setActiveScopeId(panel.id)}
                data-grid-x={panel.layout.x}
                data-grid-y={panel.layout.y}
                data-grid-width={panel.layout.width}
                data-grid-height={panel.layout.height}
                style={{
                  gridColumn: `${panel.layout.x + 1} / span ${panel.layout.width}`,
                  gridRow: `${panel.layout.y + 1} / span ${panel.layout.height}`,
                }}
              >
                <div className="plot-legend">
                  <button
                    className="panel-drag-handle"
                    type="button"
                    onPointerDown={(event) => beginLayoutInteraction(event, panel, 'move')}
                    aria-label={`Move ${panel.title}`}
                    title="Drag to move panel"
                  >
                    <GripVertical size={14} />
                  </button>
                  <div className="scope-identity">
                    <span>{String(panelIndex + 1).padStart(2, '0')}</span>
                    <span className="scope-identity-copy">
                      {editingPanelTitleId === panel.id ? (
                        <input
                          className="panel-title-input"
                          type="text"
                          value={panelTitleDraft}
                          maxLength={120}
                          autoFocus
                          aria-label={`Rename ${panel.title}`}
                          onFocus={(event) => event.currentTarget.select()}
                          onPointerDown={(event) => event.stopPropagation()}
                          onChange={(event) => setPanelTitleDraft(event.target.value)}
                          onBlur={() => finishPanelTitleEdit(panel.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              setEditingPanelTitleId(null);
                              setPanelTitleDraft('');
                            }
                          }}
                        />
                      ) : (
                        <button
                          className="panel-title-button"
                          type="button"
                          onClick={() => setActiveScopeId(panel.id)}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            setActiveScopeId(panel.id);
                            setPanelTitleDraft(panel.title);
                            setEditingPanelTitleId(panel.id);
                          }}
                          aria-label={`Activate ${panel.title}`}
                          aria-pressed={panelIsActive}
                          title="Double-click to rename"
                        >
                          {panel.title}
                        </button>
                      )}
                      <small>{panelTypeLabel(panel.type)}</small>
                    </span>
                  </div>

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
                    {panel.type === 'scope' && (
                      <>
                        <label
                          className={`scope-y-control mode-${panel.yScaleMode}`}
                          title={Y_SCALE_OPTIONS.find((option) => option.value === panel.yScaleMode)?.title}
                        >
                          <span aria-hidden="true">Y</span>
                          <select
                            value={panel.yScaleMode}
                            onChange={(event) => updatePanel(panel.id, {
                              yScaleMode: event.target.value as YScaleMode,
                            })}
                            aria-label={`Y axis mode for ${panel.title}`}
                          >
                            {Y_SCALE_OPTIONS.map((option) => (
                              <option value={option.value} key={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <TimeWindowControl
                          panel={panel}
                          automaticSeconds={sampling.suggestedWindowSeconds}
                          frequencyHz={sampling.frequencyHz}
                          onChange={(patch) => updatePanel(panel.id, patch)}
                        />
                      </>
                    )}
                    {panel.type === 'indicators' && (
                      <button
                        className={`scope-action${colorEditorPanelId === panel.id ? ' active' : ''}`}
                        type="button"
                        onClick={() => setColorEditorPanelId((current) => current === panel.id ? null : panel.id)}
                        aria-label={`Configure colors for ${panel.title}`}
                        aria-haspopup="dialog"
                        aria-expanded={colorEditorPanelId === panel.id}
                        title="State colors"
                        data-color-editor-trigger
                      >
                        <Palette size={13} />
                      </button>
                    )}
                    <button
                      className={`scope-action${pickerOpen ? ' active' : ''}`}
                      type="button"
                      onClick={() => setChannelPickerScopeId((current) => current === panel.id ? null : panel.id)}
                      aria-label={`Choose channels for ${panel.title}`}
                      aria-haspopup="dialog"
                      aria-expanded={pickerOpen}
                      title="Choose channels"
                      data-channel-picker-trigger
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

                {panel.type === 'scope' && (
                  <WaveformPlot
                    channels={channels}
                    data={timeline.data}
                    dataVersion={telemetry.version}
                    visibleChannels={panelVisibleChannels}
                    selectedChannel={panelIsActive ? selectedChannel : ''}
                    windowSeconds={panel.windowMode === 'auto'
                      ? sampling.suggestedWindowSeconds
                      : panel.windowSeconds}
                    pausedAt={pausedAt}
                    yScaleMode={panel.yScaleMode}
                    theme={theme}
                    fontScale={settings.fontScale}
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
                )}
                {panel.type === 'value-bar' && (
                  <ValueBarPanel
                    panel={{ ...panel, channelKeys: [...panelChannelKeys] }}
                    channels={channels}
                    data={telemetry.data}
                    latest={telemetry.latest}
                    channelIndexes={channelIndexes}
                    onChange={(patch) => updatePanel(panel.id, patch as Partial<PanelDefinition>)}
                  />
                )}
                {panel.type === 'indicators' && (
                  <IndicatorPanel
                    panel={{ ...panel, channelKeys: [...panelChannelKeys] }}
                    channels={channels}
                    latest={telemetry.latest}
                    channelIndexes={channelIndexes}
                    editingColors={colorEditorPanelId === panel.id}
                    onEditingColorsChange={(editing) => setColorEditorPanelId(editing ? panel.id : null)}
                    onChange={(patch) => updatePanel(panel.id, patch as Partial<PanelDefinition>)}
                  />
                )}

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

                      {panel.type !== 'scope' && numberedChannelGroups.length > 0 && (
                        <div className="scope-picker-groups">
                          <span>NUMBERED GROUPS</span>
                          <div>
                            {numberedChannelGroups.map(([groupName, groupChannels]) => (
                              <button
                                type="button"
                                key={groupName}
                                className={panel.channelGroup === groupName ? 'active' : ''}
                                onClick={() => bindPanelGroup(panel.id, groupName)}
                              >
                                <Radio size={11} />
                                {groupName}
                                <b>{groupChannels.length}</b>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

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
                <button
                  className="panel-resize-handle"
                  type="button"
                  onPointerDown={(event) => beginLayoutInteraction(event, panel, 'resize')}
                  aria-label={`Resize ${panel.title}`}
                  title="Drag to resize panel"
                />
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
          <span>
            Hub <b>{(activeSource?.hubAddress ?? telemetry.hubs[0]?.address ?? '—')
              .replace(/^wss?:\/\//, '').replace(/\/api\/ws$/, '')}</b>
          </span>
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

            <section className="settings-section" aria-labelledby="appearance-settings-title">
              <div className="settings-section-heading">
                <span id="appearance-settings-title">APPEARANCE</span>
                <small>{Math.round(settings.fontScale * 100)}%</small>
              </div>
              <div className="settings-entry font-size-setting">
                <span className="settings-entry-copy">
                  <strong>Font size</strong>
                  <small>Adjust labels, values, controls, and plot axes across the workspace.</small>
                </span>
                <label className="font-size-slider">
                  <input
                    type="range"
                    min="80"
                    max="140"
                    step="5"
                    value={Math.round(settings.fontScale * 100)}
                    onChange={(event) => setSettings((current) => ({
                      ...current,
                      fontScale: Number(event.target.value) / 100,
                    }))}
                    aria-label="Font size"
                  />
                  <span>{Math.round(settings.fontScale * 100)}%</span>
                </label>
              </div>
            </section>

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

            <section className="settings-section workspace-settings" aria-labelledby="workspace-settings-title">
              <div className="settings-section-heading">
                <span id="workspace-settings-title">WORKSPACE</span>
                <small>{activeSource?.name ?? 'Offline template'}</small>
              </div>
              <div className="settings-entry workspace-settings-entry">
                <span className="settings-entry-copy">
                  <strong>Portable panel configuration</strong>
                  <small>
                    Includes panel types, grid positions, channel bindings, ranges, and state colors.
                  </small>
                </span>
                <div className="workspace-settings-actions">
                  <button type="button" onClick={exportWorkspace}>
                    <Download size={14} />
                    <span>Export workspace</span>
                  </button>
                  <button type="button" onClick={() => workspaceFileRef.current?.click()}>
                    <Upload size={14} />
                    <span>Import workspace</span>
                  </button>
                  <input
                    ref={workspaceFileRef}
                    type="file"
                    accept=".json,application/json"
                    aria-label="Import workspace configuration"
                    onChange={importWorkspace}
                    hidden
                  />
                </div>
                {workspaceFeedback && (
                  <small
                    className={`workspace-feedback ${workspaceFeedback.kind}`}
                    role={workspaceFeedback.kind === 'error' ? 'alert' : 'status'}
                  >
                    {workspaceFeedback.message}
                  </small>
                )}
              </div>
            </section>

            <div className="settings-footer">
              <span>Changes are saved automatically in this browser</span>
              <small>Export a workspace to reuse it in another browser or machine</small>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
