import { PreviewSelect, CURVE_OPTIONS, PATTERN_OPTIONS } from './components/PreviewSelect';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  Gauge,
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
import { FloatingPanel, panelAnchor } from './components/FloatingPanel';
import { IndicatorPanel } from './components/IndicatorPanel';
import { DEFAULT_WRISTED, parseWristedSettings } from './wristed/config';
import { ChannelGroupActions } from './components/ChannelGroupActions';
import { ChannelGroupTree } from './components/ChannelGroupTree';
import { ValueBarPanel } from './components/ValueBarPanel';
import { createDragDiagnostics } from './dragDiagnostics';
import { useTelemetry } from './hooks/useTelemetry';
import {
  DEFAULT_STATE_COLORS,
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

const WristedInstrumentPanel = lazy(() => import('./components/WristedInstrumentPanel'));

interface StoredChannelStyle {
  opacity?: number;
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
const COLLAPSED_PANELS_KEY = 'debugscope.collapsed-panels.v1';
const MAX_PANELS = 9;
const WORKSPACE_TEMPLATE_KEY = '__debugscope_workspace_template__';
const GRID_COLUMNS = 12;
const MAX_CANVAS_COLUMNS = 1200;
const GRID_ROW_HEIGHT = 84;
const LAYOUT_GRID_STEP = 0.25;
const EDGE_SNAP_PX = 10;
const EDGE_RELEASE_PX = 20;
const snapLayoutValue = (value: number, step: number) => Math.round(value / step) * step;
const PANEL_REFLOW_DURATION_MS = 260;
const LAYOUT_PREVIEW_DEBOUNCE_MS = 120;
const MIN_PANEL_WIDTH = 3;
const MIN_PANEL_HEIGHT = 2;
const MIN_INDICATOR_PANEL_WIDTH = 2;
const MIN_INDICATOR_PANEL_HEIGHT = 1;
const MIN_WINDOW_SECONDS = 0.1;
const MAX_WINDOW_SECONDS = 3_600;
const WORKSPACE_CONFIG_SCHEMA = 'debugscope.workspace';
const WORKSPACE_CONFIG_VERSION = 1;
const MAX_WORKSPACE_FILE_BYTES = 1024 * 1024;

interface UserSettings {
  scrollWhenIdle: boolean;
  fontScale: number;
  visualStyle: 'compact' | 'cards';
  panelDepth: boolean;
  programsCollapsed: boolean;
  channelsCollapsed: boolean;
}

type ScopeLayouts = Record<string, PanelDefinition[]>;

interface LayoutInteraction {
  kind: 'move' | 'resize';
  panelId: string;
  startX: number;
  startY: number;
  origin: PanelGridLayout;
  panels: PanelDefinition[];
  expandedPanels: PanelDefinition[];
  workspaceWidth: number;
  workspaceHeight: number;
  scrollTop: number;
  scrollLeft: number;
}

interface WorkspaceConfigFile {
  schema: typeof WORKSPACE_CONFIG_SCHEMA;
  version: typeof WORKSPACE_CONFIG_VERSION;
  exportedAt: string;
  sourceName: string;
  panels: PanelDefinition[];
  channelStyles?: Record<string, StoredChannelStyle>;
}

interface WorkspaceFeedback {
  kind: 'success' | 'error';
  message: string;
}

const NUMBER_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

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
    title: 'Manual Y: Ctrl+wheel to zoom Y · drag to pan · Ctrl+Shift+wheel to zoom X · double-click to fit data',
  },
];

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

function formatValue(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
    return { scrollWhenIdle: stored.scrollWhenIdle === true, fontScale,
      visualStyle: stored.visualStyle === 'cards' ? 'cards' : 'compact',
      panelDepth: stored.panelDepth === true,
      programsCollapsed: stored.programsCollapsed === true,
      channelsCollapsed: stored.channelsCollapsed === true };
  } catch {
    return { scrollWhenIdle: false, fontScale: 1,
      visualStyle: 'compact', panelDepth: false, programsCollapsed: false, channelsCollapsed: false };
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

function initialCollapsedPanels(): Record<string, string[]> {
  try {
    const stored = JSON.parse(localStorage.getItem(COLLAPSED_PANELS_KEY) ?? '{}') as unknown;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored as Record<string, unknown>).flatMap(([key, value]) => (
      Array.isArray(value)
        ? [[key, [...new Set(value.filter((panelId): panelId is string => typeof panelId === 'string'))]]]
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
  if (type === 'value-bar' || type === 'sources') return { width: 2, height: MIN_PANEL_HEIGHT };
  return type === 'indicators'
    ? { width: MIN_INDICATOR_PANEL_WIDTH, height: MIN_INDICATOR_PANEL_HEIGHT }
    : { width: MIN_PANEL_WIDTH, height: MIN_PANEL_HEIGHT };
}

// All persisted edges share the workspace origin, including imported layouts.
// Quarter columns remain aligned when the workspace changes width.
function alignPanelEdges(layout: PanelGridLayout, minimum: { width: number; height: number }): PanelGridLayout {
  const snap = (value: number) => snapLayoutValue(value, LAYOUT_GRID_STEP);
  const x = Math.max(0, Math.min(MAX_CANVAS_COLUMNS - minimum.width, snap(layout.x)));
  const y = Math.max(0, snap(layout.y));
  const right = Math.min(MAX_CANVAS_COLUMNS, Math.max(x + minimum.width, snap(layout.x + layout.width)));
  const bottom = Math.max(y + minimum.height, snap(layout.y + layout.height));
  return { x, y, width: right - x, height: bottom - y };
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
      ? candidate[key]
      : defaultValue
  );
  const width = Math.max(minimum.width, Math.min(MAX_CANVAS_COLUMNS, number('width', fallback.width)));
  const x = Math.max(0, Math.min(MAX_CANVAS_COLUMNS - width, number('x', fallback.x)));
  return alignPanelEdges({
    x,
    y: Math.max(0, number('y', fallback.y)),
    width,
    height: Math.max(minimum.height, number('height', fallback.height)),
  }, minimum);
}

function isWorkspacePanelLayout(value: unknown, type: PanelType): value is PanelGridLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const layout = value as Record<string, unknown>;
  if (!['x', 'y', 'width', 'height'].every((key) => (
    typeof layout[key] === 'number'
    && Number.isFinite(layout[key])
  ))) return false;
  const { x, y, width, height } = layout as unknown as PanelGridLayout;
  const minimum = panelMinimumSize(type);
  return x >= 0
    && y >= 0
    && width >= minimum.width
    && width <= MAX_CANVAS_COLUMNS
    && x + width <= MAX_CANVAS_COLUMNS + 1e-7
    && height >= minimum.height
    && y <= 100_000
    && height <= 10_000;
}

function layoutsOverlap(left: PanelGridLayout, right: PanelGridLayout): boolean {
  return left.x < right.x + right.width - 1e-7
    && left.x + left.width > right.x + 1e-7
    && left.y < right.y + right.height - 1e-7
    && left.y + left.height > right.y + 1e-7;
}

function alignPanelCollection(panels: PanelDefinition[]): PanelDefinition[] {
  const placed: PanelGridLayout[] = [];
  const layouts = new Map<string, PanelGridLayout>();
  for (const panel of [...panels].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)) {
    const layout = alignPanelEdges(panel.layout, panelMinimumSize(panel.type));
    let blockers = placed.filter((other) => layoutsOverlap(layout, other));
    while (blockers.length) {
      layout.y = Math.max(...blockers.map((other) => other.y + other.height));
      blockers = placed.filter((other) => layoutsOverlap(layout, other));
    }
    placed.push(layout);
    layouts.set(panel.id, layout);
  }
  return panels.map((panel) => ({ ...panel, layout: layouts.get(panel.id)! }));
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

function withSourcesPanel(panels: PanelDefinition[]): PanelDefinition[] {
  const sources = panels.find((panel) => panel.type === 'sources');
  // Migrate the previous full-width default, while retaining customized layouts.
  const previousDefault = sources?.id === 'sources-default'
    && sources.layout.x === 0 && sources.layout.y === 0
    && sources.layout.width === GRID_COLUMNS && sources.layout.height === 4
    && panels.every((panel) => panel === sources || panel.layout.y >= 4);
  if (sources && !previousDefault) return panels;

  const result: PanelDefinition[] = [{
    id: sources?.id ?? 'sources-default', type: 'sources',
    title: sources?.title ?? 'Programs & Channels', channelKeys: [],
    layout: { x: 0, y: 0, width: 3, height: 4 },
  }];
  for (const panel of panels.filter((item) => item.type !== 'sources')) {
    const width = Math.max(panelMinimumSize(panel.type).width, Math.round(panel.layout.width * 0.75));
    const layout = {
      ...panel.layout,
      x: Math.min(GRID_COLUMNS - width, 3 + Math.round(panel.layout.x * 0.75)),
      y: panel.layout.y - (previousDefault ? 4 : 0),
      width,
    };
    while (result.some((item) => layoutsOverlap(item.layout, layout))) {
      layout.y = Math.max(...result.filter((item) => layoutsOverlap(item.layout, layout))
        .map((item) => item.layout.y + item.layout.height));
    }
    result.push({ ...panel, layout });
  }
  return result;
}

// Store expanded sizes, but derive their positions from the visible drag result.
// This keeps collapsed headers small during dragging and restores their content on expansion.
function restoreExpandedLayouts(
  visiblePanels: PanelDefinition[],
  expandedPanels: PanelDefinition[],
  collapsedIds: ReadonlySet<string>,
): PanelDefinition[] {
  const placed: { visible: PanelGridLayout; expanded: PanelGridLayout }[] = [];
  const layouts = new Map<string, PanelGridLayout>();
  const ordered = [...visiblePanels].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  for (const panel of ordered) {
    const visible = panel.layout;
    const expanded = {
      ...visible,
      height: collapsedIds.has(panel.id)
        ? expandedPanels.find((item) => item.id === panel.id)!.layout.height
        : visible.height,
    };
    for (const previous of placed) {
      if (visible.x < previous.visible.x + previous.visible.width
        && visible.x + visible.width > previous.visible.x
        && previous.visible.y + previous.visible.height <= visible.y + 0.000001) {
        expanded.y = Math.max(expanded.y, previous.expanded.y + previous.expanded.height
          + visible.y - previous.visible.y - previous.visible.height);
      }
    }

    if (Math.abs(expanded.y - Math.round(expanded.y)) < 1e-7) expanded.y = Math.round(expanded.y);
    layouts.set(panel.id, expanded);
    placed.push({ visible, expanded });
  }
  return visiblePanels.map((panel) => ({ ...panel, layout: layouts.get(panel.id)! }));
}

function compactCollapsedPanels(
  panels: PanelDefinition[],
  collapsedPanelIds: ReadonlySet<string>,
  gap: number,
): PanelDefinition[] {
  if (collapsedPanelIds.size === 0) return panels;

  const placed: PanelGridLayout[] = [];
  const layouts = new Map<string, PanelGridLayout>();
  const ordered = [...panels].sort((left, right) => (
    left.layout.y - right.layout.y || left.layout.x - right.layout.x
  ));

  for (const panel of ordered) {
    const next = {
      ...panel.layout,
      height: collapsedPanelIds.has(panel.id)
        ? Math.ceil((28 + gap) / GRID_ROW_HEIGHT / LAYOUT_GRID_STEP) * LAYOUT_GRID_STEP
        : panel.layout.height,
    };
    next.y = placed.reduce((bottom, layout) => (
      next.x < layout.x + layout.width - 1e-7 && next.x + next.width > layout.x + 1e-7
        ? Math.max(bottom, layout.y + layout.height) : bottom
    ), 0);
    layouts.set(panel.id, next);
    placed.push(next);
  }

  return panels.map((panel) => ({
    ...panel,
    layout: layouts.get(panel.id) ?? panel.layout,
  }));
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
      || panel.type === 'indicators'
      || panel.type === 'wristed'
      || panel.type === 'sources';
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
    if (panel.type === 'sources') {
      if (panels.some((item) => item.type === 'sources')) {
        if (strict) fail('A workspace can contain only one sources panel.');
        continue;
      }
      panels.push({ ...base, type: 'sources' });
      continue;
    }
    if (panel.type === 'wristed') {
      const wristed = parseWristedSettings(panel.wristed, strict);
      panels.push({ ...base, type: 'wristed', wristed, channelKeys: [...new Set(wristed.bindings.filter(Boolean))] });
      continue;
    }
    if (panel.type === 'value-bar') {
      const validRange = (panel.rangeMode === 'auto' || panel.rangeMode === 'manual')
        && typeof panel.manualMin === 'number'
        && Number.isFinite(panel.manualMin)
        && typeof panel.manualMax === 'number'
        && Number.isFinite(panel.manualMax);
      if (strict && !validRange) fail(`Value Bars panel ${panelIndex + 1} has an invalid range.`);
      if (strict && panel.channelRanges !== undefined && (!panel.channelRanges
        || typeof panel.channelRanges !== 'object' || Array.isArray(panel.channelRanges))) {
        fail(`Value Bars panel ${panelIndex + 1} has invalid per-channel ranges.`);
      }
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
    const rawYRange = panel.manualYRange as { min?: unknown; max?: unknown } | undefined;
    const validYRange = rawYRange && typeof rawYRange === 'object' && !Array.isArray(rawYRange)
      && typeof rawYRange.min === 'number' && Number.isFinite(rawYRange.min)
      && typeof rawYRange.max === 'number' && Number.isFinite(rawYRange.max) && rawYRange.min < rawYRange.max;
    if (strict && panel.manualYRange !== undefined && !validYRange) {
      fail(`Waveform panel ${panelIndex + 1} has an invalid manual Y-axis range.`);
    }
    const storedWindowSeconds = typeof panel.windowSeconds === 'number' && Number.isFinite(panel.windowSeconds)
      ? clampWindowSeconds(panel.windowSeconds)
      : 10;
    panels.push({
      ...base,
      type: 'scope',
      ...(validYRange ? { manualYRange: { min: rawYRange.min as number, max: rawYRange.max as number } } : {}),
      yScaleMode: validYScaleMode
        ? panel.yScaleMode as YScaleMode
        : panel.autoY === false ? 'manual' : 'fit',
      windowMode: panel.windowMode === 'auto' ? 'auto' : 'manual',
      windowSeconds: storedWindowSeconds,
    });
  }
  return alignPanelCollection(panels);
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

function parseWorkspaceStyles(value: unknown): Record<string, StoredChannelStyle> | undefined {
  if (value === undefined) return undefined; // Version 1 files originally omitted styles.
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Workspace channel styles must be an object.');
  }
  return Object.fromEntries(Object.entries(value).map(([key, raw]) => {
    const style = raw as StoredChannelStyle | null;
    if (!key || key.length > 1024 || !style || typeof style !== 'object' || Array.isArray(style)
      || typeof style.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(style.color)
      || !['linear', 'smooth', 'stepped'].includes(style.lineCurve)
      || !['solid', 'dashed', 'dotted', 'dashdot'].includes(style.linePattern)
      || ![1, 1.5, 2, 2.5, 3].includes(style.lineWidth)
      || (style.opacity !== undefined && (typeof style.opacity !== 'number'
        || !Number.isFinite(style.opacity) || style.opacity < 0.1 || style.opacity > 1))) {
      throw new Error(`Invalid channel style for "${key}".`);
    }
    return [key, storedStyle(style)];
  }));
}

function storedStyle(channel: StoredChannelStyle): StoredChannelStyle {
  return { color: channel.color, lineCurve: channel.lineCurve, linePattern: channel.linePattern,
    lineWidth: channel.lineWidth, opacity: channel.opacity ?? 1 };
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
    channelStyles: parseWorkspaceStyles(config.channelStyles),
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
  const base = type === 'wristed' ? 'Wristed Instrument' : type === 'scope' ? 'Scope' : type === 'value-bar' ? 'Value Bars' : 'Indicators';
  const titles = new Set(panels.map((panel) => panel.title));
  let number = 1;
  while (titles.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

function effectivePanelChannelKeys(
  panel: PanelDefinition | undefined,
  channels: ChannelDefinition[],
): string[] {
  if (panel?.type === 'wristed') return panel.wristed.bindings.filter(Boolean);
  if (!panel || panel.type === 'scope' || panel.type === 'sources' || !panel.channelGroup) return panel?.channelKeys ?? [];
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
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, string[]>>(
    initialCollapsedPanels,
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
  const [hubEditorOpen, setHubEditorOpen] = useState(false);
  const [hubAddress, setHubAddress] = useState('');
  const [hubAddressError, setHubAddressError] = useState('');
  const [visiblePointCounts, setVisiblePointCounts] = useState<Record<string, number>>({});
  const [renderRates, setRenderRates] = useState<Record<string, number>>({});
  const gridRef = useRef<HTMLDivElement>(null);
  const [workspaceViewportWidth, setWorkspaceViewportWidth] = useState(window.innerWidth);
  useLayoutEffect(() => {
    const workspace = gridRef.current?.parentElement;
    if (!workspace) return;
    const observer = new ResizeObserver(([entry]) => setWorkspaceViewportWidth(entry.contentRect.width));
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);
  const layoutPreviewRef = useRef<PanelDefinition[] | null>(null);
  const dragDiagnosticsRef = useRef<ReturnType<typeof createDragDiagnostics>>(null);
  const panelRectsBeforeReflowRef = useRef<Map<string, DOMRect> | null>(null);
  const panelReflowAnimationsRef = useRef<Map<string, Animation>>(new Map());
  const workspaceFileRef = useRef<HTMLInputElement>(null);

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
      ...(!scopeLayouts[sourceKeys.get(channel.sourceId) ?? '']?.length
        ? channelStyles[`${WORKSPACE_TEMPLATE_KEY}:${channel.key}`] ?? {} : {}),
      ...(channelStyles[styleKeyFor(channel)] ?? {}),
    })),
    [channelStyles, rawChannels, styleKeyFor, scopeLayouts, sourceKeys],
  );
  // Materialize inherited styles before a newly connected source edits its template layout.
  useEffect(() => {
    const programKey = activeSource?.programKey;
    if (!programKey || scopeLayouts[programKey]?.length) return;
    setChannelStyles(current => {
      const templatePrefix = `${WORKSPACE_TEMPLATE_KEY}:`;
      const inherited = Object.entries(current).filter(([key]) => key.startsWith(templatePrefix));
      const missing = inherited.filter(([key]) => !Object.hasOwn(current, `${programKey}:${key.slice(templatePrefix.length)}`));
      if (!missing.length) return current;
      return { ...current, ...Object.fromEntries(missing.map(([key, style]) =>
        [`${programKey}:${key.slice(templatePrefix.length)}`, style])) };
    });
  }, [activeSource?.programKey, scopeLayouts]);
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
    if (stored?.length) return withSourcesPanel(stored);
    const template = activeSource ? scopeLayouts[WORKSPACE_TEMPLATE_KEY] : undefined;
    if (template?.length) {
      return withSourcesPanel(template.map((panel) => (
        panel.type === 'scope'
        && panel.id === `scope-default:${WORKSPACE_TEMPLATE_KEY}`
        && panel.channelKeys.length === 0
          ? {
            ...panel,
            id: `scope-default:${layoutKey}`,
            channelKeys: channels.slice(0, 4).map((channel) => channel.key),
          }
          : panel
      )));
    }
    return withSourcesPanel([defaultScope]);
  }, [defaultScope, layoutKey, scopeLayouts]);
  const collapsedPanelIds = useMemo(() => new Set(
    (collapsedPanels[layoutKey] ?? []).filter((panelId) => (
      scopePanels.some((panel) => panel.id === panelId)
    )),
  ), [collapsedPanels, layoutKey, scopePanels]);
  const gridGap = settings.visualStyle === 'cards' ? 12 : 0;
  const displayedPanels = useMemo(() => layoutPreview ?? compactCollapsedPanels(
    scopePanels,
    collapsedPanelIds,
    gridGap,
  ), [collapsedPanelIds, layoutPreview, scopePanels, gridGap]);
  useLayoutEffect(() => {
    const diagnostics = dragDiagnosticsRef.current;
    if (!diagnostics || !layoutPreview) return;
    const element = gridRef.current?.querySelector<HTMLElement>('.layout-move, .layout-resize');
    if (!element) return;
    const rect = element.getBoundingClientRect();
    diagnostics.rendered({ actualRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      gridX: element.dataset.gridX, gridY: element.dataset.gridY,
      scrollX: window.scrollX, scrollY: window.scrollY });
  }, [layoutPreview]);
  const capturePanelRectsBeforeReflow = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const rects = new Map<string, DOMRect>();
    grid.querySelectorAll<HTMLElement>('.scope-panel[data-panel-id]').forEach((element) => {
      const panelId = element.dataset.panelId;
      if (panelId) rects.set(panelId, element.getBoundingClientRect());
    });
    panelRectsBeforeReflowRef.current = rects;
    panelReflowAnimationsRef.current.forEach((animation) => animation.cancel());
    panelReflowAnimationsRef.current.clear();
  }, []);

  useLayoutEffect(() => {
    const previousRects = panelRectsBeforeReflowRef.current;
    panelRectsBeforeReflowRef.current = null;
    const grid = gridRef.current;
    if (!previousRects || !grid || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    grid.querySelectorAll<HTMLElement>('.scope-panel[data-panel-id]').forEach((element) => {
      const panelId = element.dataset.panelId;
      const previous = panelId ? previousRects.get(panelId) : undefined;
      if (!panelId || !previous || layoutInteraction?.panelId === panelId) return;
      const next = element.getBoundingClientRect();
      const deltaX = previous.left - next.left;
      const deltaY = previous.top - next.top;
      const widthChanged = Math.abs(previous.width - next.width) > 0.5;
      const heightChanged = Math.abs(previous.height - next.height) > 0.5;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5 && !heightChanged && !widthChanged) return;

      const animation = element.animate([
        {
          ...(widthChanged ? { width: `${previous.width}px` } : {}),
          ...(heightChanged ? { height: `${previous.height}px` } : {}),
          transform: `translate(${deltaX}px, ${deltaY}px)`,
        },
        {
          ...(widthChanged ? { width: `${next.width}px` } : {}),
          ...(heightChanged ? { height: `${next.height}px` } : {}),
          transform: 'translate(0, 0)',
        },
      ], {
        duration: layoutInteraction ? 160 : PANEL_REFLOW_DURATION_MS,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      });
      panelReflowAnimationsRef.current.set(panelId, animation);
      animation.onfinish = () => {
        if (panelReflowAnimationsRef.current.get(panelId) === animation) {
          panelReflowAnimationsRef.current.delete(panelId);
        }
      };
    });
  }, [displayedPanels, layoutInteraction]);
  const activeScope = scopePanels.find((panel) => panel.id === activeScopeId && panel.type !== 'sources') ?? scopePanels.find((panel) => panel.type !== 'sources');
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
    localStorage.setItem(COLLAPSED_PANELS_KEY, JSON.stringify(collapsedPanels));
  }, [collapsedPanels]);

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
    const nextActiveScope = scopePanels.find((panel) => panel.id === activeScopeId && panel.type !== 'sources') ?? scopePanels.find((panel) => panel.type !== 'sources');
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
      const base = current[layoutKey]?.length ? withSourcesPanel(current[layoutKey]) : scopePanels;
      return { ...current, [layoutKey]: alignPanelCollection(updater(base)) };
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
    panelReflowAnimationsRef.current.forEach((animation) => animation.cancel());
    panelReflowAnimationsRef.current.clear();
    if (panel.type !== 'sources') setActiveScopeId(panel.id);
    setChannelPickerScopeId(null);
    layoutPreviewRef.current = null;
    setLayoutPreview(displayedPanels);
    setLayoutInteraction({
      kind,
      panelId: panel.id,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...panel.layout },
      panels: displayedPanels,
      expandedPanels: scopePanels,
      workspaceWidth: workspaceViewportWidth,
      workspaceHeight: grid.getBoundingClientRect().height,
      scrollTop: grid.parentElement?.scrollTop ?? 0,
      scrollLeft: grid.parentElement?.scrollLeft ?? 0,
    });
  }, [displayedPanels, scopePanels, workspaceViewportWidth]);

  useEffect(() => {
    if (!layoutInteraction) return;
    document.body.classList.add('layout-interacting');
    document.body.dataset.layoutInteraction = layoutInteraction.kind;
    const diagnostics = createDragDiagnostics({ kind: layoutInteraction.kind,
      panelId: layoutInteraction.panelId, origin: layoutInteraction.origin,
      startPointer: { x: layoutInteraction.startX, y: layoutInteraction.startY },
      workspaceWidth: layoutInteraction.workspaceWidth, workspaceHeight: layoutInteraction.workspaceHeight,
      panels: layoutInteraction.panels.map(({ id, layout }) => ({ id, layout })),
      devicePixelRatio: window.devicePixelRatio });
    dragDiagnosticsRef.current = diagnostics;

    const workspace = gridRef.current?.parentElement;
    let finished = false;
    let scrollFrame: number | null = null;
    let frame: number | null = null;
    let latestPointer: { clientX: number; clientY: number } | null = null;
    let previewTimer: ReturnType<typeof setTimeout> | null = null;
    let acceptedPanels = layoutInteraction.panels;
    let pendingPanels = acceptedPanels;
    let pendingTopology = '';
    let movingLayout = layoutInteraction.origin;
    const edgeLocks: { x: number | null; y: number | null } = { x: null, y: null };
    const snapPanelEdges = (layout: PanelGridLayout) => {
      const columnStep = layoutInteraction.workspaceWidth / GRID_COLUMNS;
      const resizing = layoutInteraction.kind === 'resize';
      const minimum = panelMinimumSize(layoutInteraction.panels.find((panel) => panel.id === layoutInteraction.panelId)!.type);
      const targets: { x: number[]; y: number[] } = { x: [], y: [] };
      for (const panel of acceptedPanels) {
        if (panel.id === layoutInteraction.panelId) continue;
        const other = panel.layout;
        const original = layoutInteraction.panels.find((item) => item.id === panel.id)!.layout;
        // Pushed neighbors follow the moving panel, so they cannot act as stable
        // anchors. Neither their old edges nor empty workspace boundaries attract.
        if (Math.abs(other.x - original.x) > 1e-7 || Math.abs(other.y - original.y) > 1e-7) continue;
        if (resizing) {
          // Include adjacent rows/columns so a lower panel can match the right
          // edge above it, or match the bottom edge of the panel beside it.
          const nearY = layout.y <= other.y + other.height + EDGE_RELEASE_PX / GRID_ROW_HEIGHT
            && layout.y + layout.height >= other.y - EDGE_RELEASE_PX / GRID_ROW_HEIGHT;
          const nearX = layout.x <= other.x + other.width + EDGE_RELEASE_PX / columnStep
            && layout.x + layout.width >= other.x - EDGE_RELEASE_PX / columnStep;
          if (nearY) targets.x.push(other.x - layout.x, other.x + other.width - layout.x);
          if (nearX) targets.y.push(other.y - layout.y, other.y + other.height - layout.y);
          continue;
        }
        if (layout.y < other.y + other.height && layout.y + layout.height > other.y) {
          targets.x.push(other.x - layout.width, other.x + other.width);
        }
        if (layout.x < other.x + other.width && layout.x + layout.width > other.x) {
          targets.y.push(other.y - layout.height, other.y + other.height);
        }
      }
      const result = { ...layout };
      for (const axis of ['x', 'y'] as const) {
        const scale = axis === 'x' ? columnStep : GRID_ROW_HEIGHT;
        const property = resizing ? (axis === 'x' ? 'width' : 'height') : axis;
        const min = resizing ? (axis === 'x' ? minimum.width : minimum.height) : 0;
        const max = resizing ? MAX_CANVAS_COLUMNS - layout.x : MAX_CANVAS_COLUMNS - layout.width;
        const candidates = targets[axis].filter((value) => value >= min
          && (axis !== 'x' || value <= max));
        const locked = edgeLocks[axis];
        if (locked !== null && candidates.includes(locked)
          && Math.abs(layout[property] - locked) * scale <= EDGE_RELEASE_PX) {
          result[property] = locked;
          continue;
        }
        edgeLocks[axis] = null;
        const nearest = candidates.sort((a, b) => Math.abs(a - layout[property]) - Math.abs(b - layout[property]))[0];
        if (nearest !== undefined && Math.abs(layout[property] - nearest) * scale <= EDGE_SNAP_PX) {
          edgeLocks[axis] = nearest;
          result[property] = nearest;
        }
      }
      return result;
    };
    const publishPreview = () => {
      const preview = acceptedPanels.map((panel) => panel.id === layoutInteraction.panelId
        ? { ...panel, layout: movingLayout } : panel);
      layoutPreviewRef.current = preview;
      diagnostics?.preview({ layout: { ...movingLayout }, edgeLocks: { ...edgeLocks },
        neighbors: acceptedPanels.filter((panel) => panel.id !== layoutInteraction.panelId)
          .map(({ id, layout }) => ({ id, layout })) });
      setLayoutPreview(preview);
    };
    const clearPreviewTimer = () => {
      if (previewTimer !== null) clearTimeout(previewTimer);
      previewTimer = null;
    };
    const previewAt = (event: { clientX: number; clientY: number }, snap: boolean) => {
      const calculationStart = diagnostics ? performance.now() : 0;
      const previousLocks = diagnostics ? { ...edgeLocks } : null;
      const columnStep = layoutInteraction.workspaceWidth / GRID_COLUMNS;
      const offsetX = event.clientX - layoutInteraction.startX
        + (workspace?.scrollLeft ?? 0) - layoutInteraction.scrollLeft;
      const offsetY = event.clientY - layoutInteraction.startY
        + (workspace?.scrollTop ?? 0) - layoutInteraction.scrollTop;
      const deltaColumns = offsetX / columnStep;
      const deltaRows = offsetY / GRID_ROW_HEIGHT;
      const origin = layoutInteraction.origin;
      const resizedPanel = layoutInteraction.panels.find((panel) => (
        panel.id === layoutInteraction.panelId
      ));
      const minimum = panelMinimumSize(resizedPanel?.type ?? 'scope');
      let next = layoutInteraction.kind === 'move'
        ? {
          ...origin,
          x: Math.max(0, Math.min(MAX_CANVAS_COLUMNS - origin.width, origin.x + deltaColumns)),
          y: Math.max(0, origin.y + deltaRows),
        }
        : {
          ...origin,
          width: Math.max(
            minimum.width,
            Math.min(MAX_CANVAS_COLUMNS - origin.x, origin.width + deltaColumns),
          ),
          height: Math.max(minimum.height, origin.height + deltaRows),
        };
      if (layoutInteraction.kind === 'move') {
        // Resolve magnets from the pointer before rounding: releasing the mouse
        // must not turn a safe edge placement into a collision.
        const edgeLayout = snapPanelEdges({
          ...origin,
          x: Math.max(0, Math.min(MAX_CANVAS_COLUMNS - origin.width, origin.x + offsetX / columnStep)),
          y: Math.max(0, origin.y + offsetY / GRID_ROW_HEIGHT),
        });
        next = {
          ...next,
          x: edgeLocks.x !== null ? edgeLayout.x : next.x,
          y: edgeLocks.y !== null ? edgeLayout.y : next.y,
        };
      } else {
        const edgeLayout = snapPanelEdges({
          ...origin,
          width: Math.max(minimum.width, Math.min(MAX_CANVAS_COLUMNS - origin.x, origin.width + offsetX / columnStep)),
          height: Math.max(minimum.height, origin.height + offsetY / GRID_ROW_HEIGHT),
        });
        next = { ...next,
          width: edgeLocks.x !== null ? edgeLayout.width : next.width,
          height: edgeLocks.y !== null ? edgeLayout.height : next.height };
      }
      if (snap) next = alignPanelEdges(next, layoutInteraction.kind === 'move'
        ? { width: origin.width, height: origin.height } : minimum);
      movingLayout = next;
      const candidate = placePanelWithoutOverlap(layoutInteraction.panels, layoutInteraction.panelId, next);
      diagnostics?.record('placement', { pointer: { x: event.clientX, y: event.clientY },
        offsetPx: { x: offsetX, y: offsetY }, gridSnap: snap,
        layout: { ...next }, edgeLocks: { ...edgeLocks }, previousLocks,
        calculationMs: performance.now() - calculationStart,
        displaced: candidate.filter((panel, index) => panel.id !== layoutInteraction.panelId
          && Math.abs(panel.layout.y - layoutInteraction.panels[index].layout.y) > 1e-7).map((panel) => panel.id) });
      if (snap) {
        acceptedPanels = candidate;
      } else {
        // Debounce changes in which neighbors are displaced, not pointer motion.
        // A steady drag still previews placement without waiting for the mouse to stop.
        const topology = candidate.filter((panel, index) => panel.id !== layoutInteraction.panelId
          && Math.abs(panel.layout.y - layoutInteraction.panels[index].layout.y) > 1e-7)
          .map((panel) => panel.id).join('|');
        if (topology !== pendingTopology) clearPreviewTimer();
        if (topology !== pendingTopology) diagnostics?.record('reflow-topology', { topology });
        pendingTopology = topology;
        pendingPanels = candidate;
        const neighborsChanged = candidate.some((panel, index) => panel.id !== layoutInteraction.panelId
          && Math.abs(panel.layout.y - acceptedPanels[index].layout.y) > 1e-7);
        if (!neighborsChanged) clearPreviewTimer();
        else if (previewTimer === null) {
          previewTimer = setTimeout(() => {
            previewTimer = null;
            diagnostics?.record('reflow-accepted', { topology: pendingTopology });
            capturePanelRectsBeforeReflow();
            acceptedPanels = pendingPanels;
            publishPreview();
          }, LAYOUT_PREVIEW_DEBOUNCE_MS);
        }
      }
      publishPreview();
    };

    const queuePreview = () => {
      if (finished || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (latestPointer) previewAt(latestPointer, false);
      });
    };

    const move = (event: PointerEvent) => {
      diagnostics?.pointer(event, frame !== null);
      latestPointer = { clientX: event.clientX, clientY: event.clientY };
      queuePreview();
    };
    let lastScrollTime = performance.now();
    const autoScroll = (time: number) => {
      if (finished) return;
      const elapsed = Math.min(32, time - lastScrollTime);
      lastScrollTime = time;
      if (workspace && latestPointer) {
        const rect = workspace.getBoundingClientRect();
        const edge = Math.min(64, rect.height / 4);
        const y = latestPointer.clientY;
        const insideX = latestPointer.clientX >= rect.left && latestPointer.clientX <= rect.right;
        const speed = !insideX ? 0 : y < rect.top + edge
          ? -Math.min(1, (rect.top + edge - y) / edge)
          : y > rect.bottom - edge ? Math.min(1, (y - rect.bottom + edge) / edge) : 0;
        if (speed) {
          const before = workspace.scrollTop;
          workspace.scrollTop += speed * elapsed * 0.75;
          if (workspace.scrollTop !== before) queuePreview();
        }
        const x = latestPointer.clientX;
        const horizontalEdge = Math.min(64, rect.width / 4);
        const insideY = y >= rect.top && y <= rect.bottom;
        const horizontalSpeed = !insideY ? 0 : x < rect.left + horizontalEdge
          ? -Math.min(1, (rect.left + horizontalEdge - x) / horizontalEdge)
          : x > rect.right - horizontalEdge ? Math.min(1, (x - rect.right + horizontalEdge) / horizontalEdge) : 0;
        if (horizontalSpeed) {
          const before = workspace.scrollLeft;
          workspace.scrollLeft += horizontalSpeed * elapsed * 0.75;
          if (workspace.scrollLeft !== before) queuePreview();
        }
      }
      scrollFrame = requestAnimationFrame(autoScroll);
    };
    scrollFrame = requestAnimationFrame(autoScroll);
    workspace?.addEventListener('scroll', queuePreview);

    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      clearPreviewTimer();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (commit && latestPointer) previewAt(latestPointer, true);
      capturePanelRectsBeforeReflow();
      const preview = layoutPreviewRef.current;
      if (commit && preview) updateScopePanels(() => collapsedPanelIds.size > 0
        ? restoreExpandedLayouts(preview, layoutInteraction.expandedPanels, collapsedPanelIds)
        : preview);
      layoutPreviewRef.current = null;
      setLayoutPreview(null);
      setLayoutInteraction(null);
      diagnostics?.finish(commit ? 'commit' : 'cancel');
    };
    const pointerUp = () => finish(true);
    const pointerCancel = () => finish(false);
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', pointerUp, { once: true });
    window.addEventListener('pointercancel', pointerCancel, { once: true });
    window.addEventListener('blur', pointerCancel);
    window.addEventListener('keydown', keyDown);
    return () => {
      finished = true;
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      workspace?.removeEventListener('scroll', queuePreview);
      diagnostics?.finish('effect-cleanup');
      if (dragDiagnosticsRef.current === diagnostics) dragDiagnosticsRef.current = null;
      clearPreviewTimer();
      if (frame !== null) cancelAnimationFrame(frame);
      document.body.classList.remove('layout-interacting');
      delete document.body.dataset.layoutInteraction;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerCancel);
      window.removeEventListener('blur', pointerCancel);
      window.removeEventListener('keydown', keyDown);
    };
  }, [layoutInteraction, updateScopePanels, collapsedPanelIds, capturePanelRectsBeforeReflow]);

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

  const togglePanelCollapsed = useCallback((panelId: string) => {
    capturePanelRectsBeforeReflow();
    setCollapsedPanels((current) => {
      const nextPanelIds = new Set(current[layoutKey] ?? []);
      if (nextPanelIds.has(panelId)) nextPanelIds.delete(panelId);
      else nextPanelIds.add(panelId);
      return { ...current, [layoutKey]: [...nextPanelIds] };
    });
    setChannelPickerScopeId((current) => current === panelId ? null : current);
    setColorEditorPanelId((current) => current === panelId ? null : current);
  }, [capturePanelRectsBeforeReflow, layoutKey]);

  const finishPanelTitleEdit = useCallback((panelId: string) => {
    const title = panelTitleDraft.trim().slice(0, 120);
    if (title) updatePanel(panelId, { title });
    setEditingPanelTitleId(null);
    setPanelTitleDraft('');
  }, [panelTitleDraft, updatePanel]);

  const toggleScopeChannel = useCallback((scopeId: string, channelKey: string) => {
    updateScopePanels((panels) => panels.map((panel) => {
      if (panel.id !== scopeId || panel.type === 'wristed') return panel;
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
      layout: { x: 0, y: nextRow, width: GRID_COLUMNS, height: type === 'indicators' ? 1 : 4 },
    };
    const panel: PanelDefinition = type === 'wristed'
      ? { ...base, type, layout: { ...base.layout, height: 6 }, wristed: structuredClone(DEFAULT_WRISTED) }
      : type === 'value-bar'
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
    setChannelPickerScopeId(type === 'wristed' ? null : panel.id);
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
    setCollapsedPanels((current) => ({
      ...current,
      [layoutKey]: (current[layoutKey] ?? []).filter((panelId) => panelId !== scopeId),
    }));
  };

  const visiblePointCount = scopePanels.reduce(
    (total, panel) => total + (collapsedPanelIds.has(panel.id) ? 0 : (visiblePointCounts[panel.id] ?? 0)),
    0,
  );
  const currentRenderRates = scopePanels
    .map((panel) => collapsedPanelIds.has(panel.id) ? 0 : (renderRates[panel.id] ?? 0))
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
    // Use portable channel names, without the local Hub URL or program identity.
    // Include stored offline channels as well as effective defaults for live channels.
    const sourcePrefix = `${layoutKey}:`;
    const templatePrefix = `${WORKSPACE_TEMPLATE_KEY}:`;
    const stylesWithPrefix = (prefix: string) => Object.entries(channelStyles)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, style]) => [key.slice(prefix.length), storedStyle(style)] as const);
    const exportedStyles = Object.fromEntries([
      ...(!scopeLayouts[layoutKey]?.length ? stylesWithPrefix(templatePrefix) : []),
      ...stylesWithPrefix(sourcePrefix),
      ...channels.map(channel => [channel.key, storedStyle(channel)] as const),
    ]);
    const config: WorkspaceConfigFile = {
      schema: WORKSPACE_CONFIG_SCHEMA,
      version: WORKSPACE_CONFIG_VERSION,
      exportedAt: new Date().toISOString(),
      sourceName,
      panels: scopePanels,
      channelStyles: exportedStyles,
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
      if (config.channelStyles !== undefined) {
        setChannelStyles(current => {
          const prefix = `${layoutKey}:`;
          const next = Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(prefix)));
          for (const [key, style] of Object.entries(config.channelStyles!)) next[`${prefix}${key}`] = style;
          return next;
        });
      }
      setScopeLayouts((current) => ({ ...current, [layoutKey]: config.panels }));
      setCollapsedPanels((current) => ({ ...current, [layoutKey]: [] }));
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
        opacity: channel.opacity ?? 1,
      }, current[key], patch),
    }));
  };

  const resetChannelStyle = (channel: ChannelDefinition) => {
    const key = styleKeyFor(channel);
    setChannelStyles((current) => {
      const next = { ...current };
      delete next[key];
      // A local reset must also override an imported offline template style.
      const original = rawChannels.find(item => item.id === channel.id);
      if (original && current[`${WORKSPACE_TEMPLATE_KEY}:${channel.key}`]) next[key] = storedStyle(original);
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
        : 'Enable a channel from the Programs & Channels panel to start plotting.';

  return (
    <div
      className="app-shell"
      data-visual-style={settings.visualStyle}
      data-panel-depth={settings.panelDepth}
      style={{ '--panel-gap': `${gridGap}px` } as React.CSSProperties}
    >
      <header className="app-bar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <Activity size={19} strokeWidth={2.3} aria-hidden="true" />
          </span>
          <strong>DebugScope</strong>
          <span className="preview-badge">PREVIEW</span>
        </div>

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
                  <button type="button" role="menuitem" onClick={() => addPanel('wristed')}>
                    <Activity size={15} />
                    <span><strong>Wristed instrument</strong><small>Live 3D instrument pose</small></span>
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

      <main className="workspace">
        <div
          className="scope-grid"
          ref={gridRef}
          style={{
            minHeight: layoutInteraction?.workspaceHeight,
            width: Math.max(GRID_COLUMNS, ...displayedPanels.map(({ layout }) => layout.x + layout.width))
              * workspaceViewportWidth / GRID_COLUMNS + Math.max(280, workspaceViewportWidth * 0.45),
          }}
        >
          {displayedPanels.map((panel) => {
            const panelChannelKeys = new Set(effectivePanelChannelKeys(panel, channels));
            const panelChannels = channels.filter((channel) => panelChannelKeys.has(channel.key));
            const panelVisibleChannels = new Set(
              panelChannels.map((channel) => channel.id),
            );
            const panelIsActive = panel.id === activeScope?.id;
            const panelCollapsed = collapsedPanelIds.has(panel.id);
            const pickerOpen = !panelCollapsed && panel.id === channelPickerScopeId;

            return (
              <section
                className={`scope-panel panel-${panel.type}${panel.layout.width <= 2 ? ' compact-panel' : ''}${panelIsActive ? ' active' : ''}${panelCollapsed ? ' collapsed' : ''}${
                  layoutInteraction?.panelId === panel.id ? ` layout-${layoutInteraction.kind}` : ''
                }`}
                aria-label={panel.title}
                aria-expanded={!panelCollapsed}
                key={panel.id}
                onPointerDown={() => { if (panel.type !== 'sources') setActiveScopeId(panel.id); }}
                data-panel-id={panel.id}
                data-grid-x={panel.layout.x}
                data-grid-y={panel.layout.y}
                data-grid-width={panel.layout.width}
                data-grid-height={panel.layout.height}
                style={{
                  gridColumn: '1 / -1',
                  width: panel.layout.width / GRID_COLUMNS * workspaceViewportWidth - gridGap,
                  marginLeft: panel.layout.x / GRID_COLUMNS * workspaceViewportWidth,
                  gridRow: `${Math.round(panel.layout.y * GRID_ROW_HEIGHT) + 1} / span ${Math.round(panel.layout.height * GRID_ROW_HEIGHT)}`,
                }}
              >
                <div className="plot-legend">
                  <button
                    className="scope-action panel-collapse-button"
                    type="button"
                    onClick={() => togglePanelCollapsed(panel.id)}
                    aria-label={`${panelCollapsed ? 'Expand' : 'Collapse'} ${panel.title}`}
                    aria-expanded={!panelCollapsed}
                    title={`${panelCollapsed ? 'Expand' : 'Collapse'} ${panel.title}`}
                  >
                    {panelCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  </button>
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
                          onClick={() => { if (panel.type !== 'sources') setActiveScopeId(panel.id); }}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            if (panel.type !== 'sources') setActiveScopeId(panel.id);
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
                    </span>
                  </div>

                  {!panelCollapsed && panel.type === 'scope' && <div className="scope-legend-scroll" aria-label={`${panel.title} channel legend`}>
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
                  </div>}

                  {panelCollapsed && (
                    <span className="collapsed-panel-summary">
                      {panel.type === 'sources' ? channels.length : panelVisibleChannels.size} channels
                    </span>
                  )}

                  <div className="scope-panel-actions">
                    {!panelCollapsed && panel.type === 'scope' && (
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
                    {!panelCollapsed && panel.type === 'indicators' && (
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
                    {!panelCollapsed && panel.type !== 'sources' && panel.type !== 'wristed' && <button
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
                    </button>}
                    {panel.type !== 'sources' && scopePanels.filter((item) => item.type !== 'sources').length > 1 && (
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

                {!panelCollapsed && panel.type === 'sources' && (
                  <div className="sources-panel-content">
                    <section className={`sidebar-section source-section${settings.programsCollapsed ? ' collapsed' : ''}`}>
                      <div className="section-heading">
                        <button
                          className="sidebar-section-toggle"
                          type="button"
                          onClick={() => setSettings((current) => ({
                            ...current,
                            programsCollapsed: !current.programsCollapsed,
                          }))}
                          aria-label={`${settings.programsCollapsed ? 'Expand' : 'Collapse'} programs`}
                          aria-expanded={!settings.programsCollapsed}
                          aria-controls="sidebar-programs-content"
                        >
                          <ChevronDown size={13} aria-hidden="true" />
                          <span>PROGRAMS</span>
                        </button>
                        <span className="section-heading-actions">
                          <span className="channel-count">{telemetry.sources.length}</span>
                          {telemetry.mode === 'live' && (
                            <button
                              className={`section-add-button${hubEditorOpen ? ' active' : ''}`}
                              type="button"
                              onClick={() => {
                                setSettings((current) => ({ ...current, programsCollapsed: false }));
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

                      {!settings.programsCollapsed && (
                      <div className="sidebar-section-content" id="sidebar-programs-content">
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
                      </div>
                      )}
                    </section>

                    <section className={`sidebar-section channels-section${settings.channelsCollapsed ? ' collapsed' : ''}`}>
                      <div className="section-heading channel-heading">
                        <button
                          className="sidebar-section-toggle"
                          type="button"
                          onClick={() => setSettings((current) => ({
                            ...current,
                            channelsCollapsed: !current.channelsCollapsed,
                          }))}
                          aria-label={`${settings.channelsCollapsed ? 'Expand' : 'Collapse'} channels`}
                          aria-expanded={!settings.channelsCollapsed}
                          aria-controls="sidebar-channels-content"
                        >
                          <ChevronDown size={13} aria-hidden="true" />
                          <span className="channel-heading-title">
                            CHANNELS
                            <small>{activeScope?.title ?? 'Scope'}</small>
                          </span>
                        </button>
                        <span className="channel-count">{activeScopeChannelIds.size} / {channels.length}</span>
                      </div>

                      {!settings.channelsCollapsed && (
                      <div className="sidebar-section-content" id="sidebar-channels-content">
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

                      <ChannelGroupTree channels={filteredChannels} collapsed={collapsedGroupsForSource}
                        searching={Boolean(channelSearch.trim())} onToggle={toggleChannelGroup}
                        renderActions={(path) => {
                          const members = channels.filter((channel) => channel.key.startsWith(`${path}.`)
                            || (path === 'signals' && !channel.key.includes('.')));
                          return <ChannelGroupActions path={path} channels={members} visibleIds={activeScopeChannelIds}
                            disabled={!activeScope || activeScope.type === 'wristed'}
                            onVisibility={(show) => {
                              if (!activeScope) return;
                              const keys = new Set(effectivePanelChannelKeys(activeScope, channels));
                              for (const channel of members) { if (show) keys.add(channel.key); else keys.delete(channel.key); }
                              setScopeChannelKeys(activeScope.id, [...keys]);
                            }}
                            onStyle={(patch) => setChannelStyles((current) => {
                              const next = { ...current };
                              for (const channel of members) next[styleKeyFor(channel)] = {
                                color: channel.color, lineCurve: channel.lineCurve, linePattern: channel.linePattern,
                                lineWidth: channel.lineWidth, opacity: channel.opacity ?? 1,
                                ...patch,
                              };
                              return next;
                            })}
                            onDelete={telemetry.mode === 'live' ? () => {
                              if (members.length) telemetry.deleteChannels(members[0].sourceId, members.map((channel) => channel.key));
                            } : undefined} />;
                        }}
                        renderChannel={(channel) => {
                              const channelIndex = channelIndexes.get(channel.id) ?? -1;
                              const visible = activeScopeChannelIds.has(channel.id);
                              const selected = selectedChannel === channel.id;

                              return (
                                <div
                                  className={`channel-row${selected ? ' selected' : ''}${visible ? '' : ' hidden'}`}
                                  key={channel.id}
                                  role="button"
                                  aria-label={channel.key}
                                  tabIndex={0}
                                  onClick={() => setSelectedChannel(channel.id)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') setSelectedChannel(channel.id);
                                  }}
                                >
                                  <button
                                    className="visibility-button"
                                    type="button"
                                    disabled={activeScope?.type === 'wristed'}
                                    title={activeScope?.type === 'wristed' ? 'Bind pose inputs using Configure in the instrument panel' : undefined}
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
                                  <span className="channel-copy" title={channel.key}>
                                    <strong>{channel.label}</strong>
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
                        }} />

                      {filteredChannels.length === 0 && channelSearch && (
                        <div className="no-channel-results">No matching channels</div>
                      )}

                      {styleEditorChannel && (
                        <FloatingPanel className="style-editor" label={`Style ${styleEditorChannel.label}`} width={360}
                          anchor={() => panelAnchor(panel.id, '.style-button.active')} onClose={() => setStyleEditorChannelId(null)}>
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
                          <label className="channel-opacity"><span>Opacity</span>
                            <input type="range" min="0.1" max="1" step="0.05" value={styleEditorChannel.opacity ?? 1}
                              aria-label={`Opacity for ${styleEditorChannel.label}`}
                              onChange={(event) => updateChannelStyle(styleEditorChannel, { opacity: Number(event.target.value) })} />
                            <output>{Math.round((styleEditorChannel.opacity ?? 1) * 100)}%</output>
                          </label>
                          {telemetry.mode === 'live' && <button className="reset-style" onClick={() => {
                            telemetry.deleteChannels(styleEditorChannel.sourceId, [styleEditorChannel.key]);
                            setStyleEditorChannelId(null);
                          }}><Trash2 size={12} /> Delete channel and history</button>}
                          <button
                            className="reset-style"
                            type="button"
                            onClick={() => resetChannelStyle(styleEditorChannel)}
                          >
                            <RotateCcw size={12} /> Reset default
                          </button>
                        </FloatingPanel>
                      )}
                      </div>
                      )}
                    </section>

                  </div>
                )}
                {!panelCollapsed && panel.type === 'scope' && (
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
                    manualYRange={panel.manualYRange}
                    onManualYRangeChange={manualYRange => updatePanel(panel.id, { manualYRange })}
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
                      ? 'Choose channels to display.'
                      : emptyMessage}
                    showEmptyAction={channels.length > 0}
                  />
                )}
                {!panelCollapsed && panel.type === 'wristed' && (
                  <Suspense fallback={<div className="instrument-empty">Loading 3D view…</div>}>
                    <WristedInstrumentPanel panel={panel} channels={channels} latest={telemetry.latest}
                      channelIndexes={channelIndexes} paused={paused} onChange={(patch) => updatePanel(panel.id, patch)} />
                  </Suspense>
                )}
                {!panelCollapsed && panel.type === 'value-bar' && (
                  <ValueBarPanel
                    panel={{ ...panel, channelKeys: [...panelChannelKeys] }}
                    channels={channels}
                    data={telemetry.data}
                    latest={telemetry.latest}
                    channelIndexes={channelIndexes}
                    onChange={(patch) => updatePanel(panel.id, patch as Partial<PanelDefinition>)}
                  />
                )}
                {!panelCollapsed && panel.type === 'indicators' && (
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
                    <FloatingPanel className="scope-channel-picker" label={`Channels for ${panel.title}`} width={420}
                      anchor={() => panelAnchor(panel.id, '[data-channel-picker-trigger]')}
                      onClose={() => setChannelPickerScopeId(null)}>
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

                      {panel.type !== 'scope' && panel.type !== 'sources' && panel.type !== 'wristed' && numberedChannelGroups.length > 0 && (
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
                    </FloatingPanel>
                )}
                {!panelCollapsed && <button
                  className="panel-resize-handle"
                  type="button"
                  onPointerDown={(event) => beginLayoutInteraction(event, panel, 'resize')}
                  aria-label={`Resize ${panel.title}`}
                  title="Drag to resize panel"
                />}
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
              <div className="settings-entry">
                <span className="settings-entry-copy">
                  <strong>Interface style</strong>
                  <small>Compact joins panels; Cards adds spacing and rounded surfaces.</small>
                </span>
                <select
                  className="style-select"
                  aria-label="Interface style"
                  value={settings.visualStyle}
                  onChange={(event) => setSettings((current) => ({
                    ...current, visualStyle: event.target.value as UserSettings['visualStyle'],
                  }))}
                >
                  <option value="compact">Compact</option>
                  <option value="cards">Cards</option>
                </select>
              </div>
              <div className="settings-entry">
                <span className="settings-entry-copy">
                  <strong>Panel depth</strong>
                  <small>Subtle shadows and gray headers in Compact style.</small>
                </span>
                <button type="button" role="switch" aria-label="Panel depth" aria-checked={settings.panelDepth}
                  className={`settings-switch${settings.panelDepth ? ' enabled' : ''}`}
                  onClick={() => setSettings((current) => ({ ...current, panelDepth: !current.panelDepth }))}>
                  <span />
                </button>
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
                    Includes panel layouts, channel bindings, signal colors and line styles, ranges, and state colors.
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
