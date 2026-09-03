import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eye, Radio, Waves } from 'lucide-react';
import uPlot, { type AlignedData, type Options } from 'uplot';
import type { ChannelDefinition, TelemetryData, ThemeMode, YScaleMode } from './types';

interface HoverState {
  left: number;
  time: number;
  values: Array<number | null>;
}
interface WaveformPlotProps {
  channels: ChannelDefinition[];
  data: TelemetryData;
  dataVersion: number;
  visibleChannels: Set<string>;
  selectedChannel: string;
  windowSeconds: number;
  pausedAt: number | null;
  yScaleMode: YScaleMode;
  theme: ThemeMode;
  fontScale?: number;
  scrollWhenIdle: boolean;
  getClockTime: () => number;
  onShowAllChannels: () => void;
  onVisiblePointCount: (count: number) => void;
  onRenderRate: (rate: number) => void;
  emptyTitle?: string;
  emptyMessage?: string;
  showEmptyAction?: boolean;
}

const MIN_VIEW_SECONDS = 0.1;
const MAX_VIEW_SECONDS = 3_600;

function formatAxisValue(value: number): string {
  if (Math.abs(value) >= 1_000) return value.toFixed(0);
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function fittedYScale(mode: Exclude<YScaleMode, 'manual'>, minY: number, maxY: number) {
  if (mode === 'zero-min') {
    const upper = Math.max(0, maxY);
    const padding = Math.max(upper * 0.12, 0.01);
    return { min: 0, max: upper + padding };
  }
  if (mode === 'zero-max') {
    const lower = Math.min(0, minY);
    const padding = Math.max(Math.abs(lower) * 0.12, 0.01);
    return { min: lower - padding, max: 0 };
  }
  const rawRange = maxY - minY;
  const padding = Math.max(rawRange * 0.12, Math.abs(maxY) * 0.02, 0.01);
  return { min: minY - padding, max: maxY + padding };
}

export function WaveformPlot({
  channels,
  data,
  dataVersion,
  visibleChannels,
  selectedChannel,
  windowSeconds,
  pausedAt,
  yScaleMode,
  theme,
  fontScale = 1,
  scrollWhenIdle,
  getClockTime,
  onShowAllChannels,
  onVisiblePointCount,
  onRenderRate,
  emptyTitle = 'No visible channels',
  emptyMessage = 'Enable a channel from the sidebar to start plotting.',
  showEmptyAction = true,
}: WaveformPlotProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const dataRef = useRef(data);
  const channelsRef = useRef(channels);
  const visibleChannelsRef = useRef(visibleChannels);
  const windowSecondsRef = useRef(windowSeconds);
  const pausedAtRef = useRef(pausedAt);
  const yScaleModeRef = useRef(yScaleMode);
  const scrollWhenIdleRef = useRef(scrollWhenIdle);
  const getClockTimeRef = useRef(getClockTime);
  const onVisiblePointCountRef = useRef(onVisiblePointCount);
  const onRenderRateRef = useRef(onRenderRate);
  const latestTimeRef = useRef(0);
  const followingRef = useRef(true);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    manualY: boolean;
  } | null>(null);
  const renderCounterRef = useRef({ count: 0, since: performance.now() });
  const lastMetricsAtRef = useRef(0);
  const yScaleRef = useRef<{ min: number; max: number } | null>(null);
  const fitManualYRef = useRef(false);
  const refreshViewRef = useRef<(liveEnd: number, forceMetrics?: boolean) => void>(() => {});
  const [hover, setHover] = useState<HoverState | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);

  dataRef.current = data;
  channelsRef.current = channels;
  visibleChannelsRef.current = visibleChannels;
  windowSecondsRef.current = windowSeconds;
  pausedAtRef.current = pausedAt;
  yScaleModeRef.current = yScaleMode;
  scrollWhenIdleRef.current = scrollWhenIdle;
  getClockTimeRef.current = getClockTime;
  onVisiblePointCountRef.current = onVisiblePointCount;
  onRenderRateRef.current = onRenderRate;

  const channelSignature = channels
    .map((channel) => [
      channel.id,
      channel.label,
      channel.color,
      channel.unit,
      channel.lineCurve,
      channel.linePattern,
      channel.lineWidth,
    ].join(':'))
    .join('|') + `:${theme}:${fontScale}`;

  const setFollowing = (following: boolean) => {
    followingRef.current = following;
    setIsFollowing(following);
  };

  const updateHover = (plot: uPlot) => {
    const index = plot.cursor.idx;
    const left = plot.cursor.left;
    if (index === null || index === undefined || left === undefined || left < 0) {
      setHover(null);
      return;
    }

    const currentData = dataRef.current;
    const time = currentData[0][index];
    if (time === undefined) {
      setHover(null);
      return;
    }

    setHover({
      left,
      time,
      values: channelsRef.current.map(
        (_, channelIndex) => currentData[channelIndex + 1][index] ?? null,
      ),
    });
  };

  const refreshView = (liveEnd: number, forceMetrics = false) => {
    const plot = plotRef.current;
    if (!plot || !Number.isFinite(liveEnd)) return;

    latestTimeRef.current = liveEnd;
    if (stageRef.current) stageRef.current.dataset.liveTime = liveEnd.toFixed(3);
    const currentWindowSeconds = windowSecondsRef.current;
    let minX: number;
    let maxX: number;
    if (followingRef.current) {
      minX = liveEnd - currentWindowSeconds;
      maxX = liveEnd + currentWindowSeconds * 0.025;
      plot.setScale('x', { min: minX, max: maxX });
    } else {
      minX = plot.scales.x.min ?? liveEnd - currentWindowSeconds;
      maxX = plot.scales.x.max ?? liveEnd;
    }

    const metricsNow = performance.now();
    if (!forceMetrics && metricsNow - lastMetricsAtRef.current < 100) return;
    lastMetricsAtRef.current = metricsNow;

    const currentData = dataRef.current;
    const currentChannels = channelsRef.current;
    const currentVisibleChannels = visibleChannelsRef.current;
    const timestamps = currentData[0];
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let visibleSamples = 0;

    for (let pointIndex = 0; pointIndex < timestamps.length; pointIndex += 1) {
      const timestamp = timestamps[pointIndex];
      if (timestamp < minX || timestamp > maxX) continue;
      visibleSamples += 1;
      currentChannels.forEach((channel, channelIndex) => {
        if (!currentVisibleChannels.has(channel.id)) return;
        const value = currentData[channelIndex + 1][pointIndex];
        if (typeof value !== 'number' || !Number.isFinite(value)) return;
        minY = Math.min(minY, value);
        maxY = Math.max(maxY, value);
      });
    }

    onVisiblePointCountRef.current(visibleSamples * currentVisibleChannels.size);
    const currentYScaleMode = yScaleModeRef.current;
    const fitManualY = fitManualYRef.current;
    if ((currentYScaleMode !== 'manual' || fitManualY) && Number.isFinite(minY) && Number.isFinite(maxY)) {
      const nextScale = fittedYScale(
        currentYScaleMode === 'manual' ? 'fit' : currentYScaleMode,
        minY,
        maxY,
      );
      fitManualYRef.current = false;
      yScaleRef.current = nextScale;
      plot.setScale('y', nextScale);
      if (stageRef.current) {
        stageRef.current.dataset.yMin = String(nextScale.min);
        stageRef.current.dataset.yMax = String(nextScale.max);
      }
    }
  };
  refreshViewRef.current = refreshView;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const dark = theme === 'dark';
    // uPlot's font parser only recognizes integer pixel values. A fractional
    // value such as 29.4px is otherwise misread as 4px.
    const axisFontSize = Math.round(14 * fontScale);
    const axisFont = `${axisFontSize}px "JetBrains Mono Variable", monospace`;
    if (stageRef.current) stageRef.current.dataset.axisFontSize = String(axisFontSize);
    const axisColor = dark ? '#91a4b9' : '#4f647a';
    const gridColor = dark ? '#1b2633' : '#dce4ed';
    const tickColor = dark ? '#2a394b' : '#c8d3df';
    const dashFor = (pattern: ChannelDefinition['linePattern']): number[] => {
      if (pattern === 'dashed') return [10, 6];
      if (pattern === 'dotted') return [2, 5];
      if (pattern === 'dashdot') return [10, 5, 2, 5];
      return [];
    };
    const pathsFor = (curve: ChannelDefinition['lineCurve']) => {
      // uPlot 1.6.32's runtime reads opts.align unconditionally even though
      // its type declaration marks the options object as optional.
      if (curve === 'stepped') return uPlot.paths.stepped?.({ align: 1 });
      if (curve === 'smooth') return uPlot.paths.spline?.();
      return uPlot.paths.linear?.();
    };

    const options: Options = {
      width: Math.max(host.clientWidth, 320),
      height: Math.max(host.clientHeight, 280),
      pxAlign: false,
      legend: { show: false },
      padding: [18, 14, 4, 0],
      cursor: {
        show: true,
        x: true,
        y: false,
        points: { show: false },
        drag: { x: false, y: false, setScale: false },
        focus: { prox: 22 },
      },
      scales: {
        x: { time: false, auto: false },
        y: { auto: false },
      },
      axes: [
        {
          stroke: axisColor,
          size: Math.round(32 + 12 * fontScale),
          gap: 9,
          space: 96,
          font: axisFont,
          grid: { show: true, stroke: gridColor, width: 1 },
          ticks: { show: true, stroke: tickColor, width: 1, size: 5 },
          values: (axisPlot, ticks) => {
            const axisRange = (axisPlot.scales.x.max ?? 0) - (axisPlot.scales.x.min ?? 0);
            const precision = axisRange <= 0.2 ? 3 : axisRange <= 2 ? 2 : axisRange <= 20 ? 1 : 0;
            const nowThreshold = Math.min(0.04, Math.max(0.000_5, axisRange / 100));
            return ticks.map((value) => {
              const delta = value - latestTimeRef.current;
              if (Math.abs(delta) < nowThreshold) return 'now';
              return `${delta.toFixed(precision)}s`;
            });
          },
        },
        {
          side: 3,
          stroke: axisColor,
          size: Math.round(52 + 16 * fontScale),
          gap: 10,
          font: axisFont,
          grid: { show: true, stroke: gridColor, width: 1 },
          ticks: { show: true, stroke: tickColor, width: 1, size: 5 },
          values: (_plot, ticks) => ticks.map(formatAxisValue),
        },
      ],
      series: [
        {},
        ...channels.map((channel) => ({
          label: channel.label,
          stroke: channel.color,
          width: channel.lineWidth,
          dash: dashFor(channel.linePattern),
          cap: 'round' as CanvasLineCap,
          pxAlign: false,
          paths: pathsFor(channel.lineCurve),
          points: { show: false },
          // Timeline preparation uses undefined for ordinary missing aligned
          // values and reserves null for a deliberate producer-idle break.
          spanGaps: false,
        })),
      ],
      hooks: {
        init: [(initializedPlot) => {
          initializedPlot.ctx.lineJoin = 'round';
          initializedPlot.ctx.lineCap = 'round';
        }],
        setScale: [(scaledPlot, scaleKey) => {
          if (scaleKey !== 'y' || !stageRef.current) return;
          const min = scaledPlot.scales.y.min;
          const max = scaledPlot.scales.y.max;
          if (Number.isFinite(min) && Number.isFinite(max)) {
            stageRef.current.dataset.yMin = String(min);
            stageRef.current.dataset.yMax = String(max);
          } else {
            delete stageRef.current.dataset.yMin;
            delete stageRef.current.dataset.yMax;
          }
        }],
        setCursor: [updateHover],
        draw: [() => {
          const counter = renderCounterRef.current;
          counter.count += 1;
          const now = performance.now();
          const elapsed = now - counter.since;
          if (elapsed >= 1_000) {
            onRenderRateRef.current(Math.round((counter.count * 1_000) / elapsed));
            counter.count = 0;
            counter.since = now;
          }
        }],
      },
    };

    const plot = new uPlot(options, data as AlignedData, host);
    plotRef.current = plot;
    if (yScaleModeRef.current === 'manual' && yScaleRef.current) {
      plot.setScale('y', yScaleRef.current);
    } else if (yScaleModeRef.current === 'manual') {
      // A persisted manual mode has no in-memory scale after reload. Fit once
      // so the trace and Y labels are visible, then leave the range manual.
      fitManualYRef.current = true;
    }

    const overlay = plot.over;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (yScaleModeRef.current === 'manual' && !event.shiftKey) {
        const minY = plot.scales.y.min;
        const maxY = plot.scales.y.max;
        if (minY === undefined || maxY === undefined) return;
        const currentRange = maxY - minY;
        const nextRange = currentRange * (event.deltaY > 0 ? 1.16 : 0.86);
        const pointerValue = plot.posToVal(event.offsetY, 'y');
        const ratio = (pointerValue - minY) / currentRange;
        const nextScale = {
          min: pointerValue - nextRange * ratio,
          max: pointerValue + nextRange * (1 - ratio),
        };
        yScaleRef.current = nextScale;
        plot.setScale('y', nextScale);
        return;
      }
      const min = plot.scales.x.min;
      const max = plot.scales.x.max;
      if (min === undefined || max === undefined) return;

      const currentRange = max - min;
      const nextRange = Math.min(
        MAX_VIEW_SECONDS,
        Math.max(MIN_VIEW_SECONDS, currentRange * (event.deltaY > 0 ? 1.16 : 0.86)),
      );
      const pointerValue = plot.posToVal(event.offsetX, 'x');
      const ratio = (pointerValue - min) / currentRange;
      const nextMin = pointerValue - nextRange * ratio;
      const nextMax = nextMin + nextRange;

      plot.setScale('x', { min: nextMin, max: nextMax });
      setFollowing(false);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const min = plot.scales.x.min;
      const max = plot.scales.x.max;
      const minY = plot.scales.y.min;
      const maxY = plot.scales.y.max;
      if (min === undefined || max === undefined || minY === undefined || maxY === undefined) return;
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        minX: min,
        maxX: max,
        minY,
        maxY,
        manualY: yScaleModeRef.current === 'manual',
      };
      overlay.setPointerCapture(event.pointerId);
      overlay.classList.add('is-panning');
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (Math.abs(deltaX) >= 2) {
        const secondsPerPixel = (drag.maxX - drag.minX) / Math.max(plot.bbox.width, 1);
        const offsetX = deltaX * secondsPerPixel;
        plot.setScale('x', { min: drag.minX - offsetX, max: drag.maxX - offsetX });
        setFollowing(false);
      }
      if (drag.manualY && Math.abs(deltaY) >= 2) {
        const unitsPerPixel = (drag.maxY - drag.minY) / Math.max(plot.bbox.height, 1);
        const offsetY = deltaY * unitsPerPixel;
        const nextScale = { min: drag.minY + offsetY, max: drag.maxY + offsetY };
        yScaleRef.current = nextScale;
        plot.setScale('y', nextScale);
      }
    };

    const stopDragging = (event: PointerEvent) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      overlay.classList.remove('is-panning');
      if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
    };

    const handleDoubleClick = () => {
      setFollowing(true);
      if (yScaleModeRef.current === 'manual') fitManualYRef.current = true;
      refreshViewRef.current(getClockTimeRef.current(), true);
    };
    const handleMouseLeave = () => setHover(null);

    overlay.addEventListener('wheel', handleWheel, { passive: false });
    overlay.addEventListener('pointerdown', handlePointerDown);
    overlay.addEventListener('pointermove', handlePointerMove);
    overlay.addEventListener('pointerup', stopDragging);
    overlay.addEventListener('pointercancel', stopDragging);
    overlay.addEventListener('dblclick', handleDoubleClick);
    overlay.addEventListener('mouseleave', handleMouseLeave);

    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      if (width > 0 && height > 0) plot.setSize({ width, height });
    });
    resizeObserver.observe(host);

    return () => {
      const minY = plot.scales.y.min;
      const maxY = plot.scales.y.max;
      if (
        typeof minY === 'number'
        && Number.isFinite(minY)
        && typeof maxY === 'number'
        && Number.isFinite(maxY)
      ) {
        yScaleRef.current = { min: minY, max: maxY };
      }
      resizeObserver.disconnect();
      overlay.removeEventListener('wheel', handleWheel);
      overlay.removeEventListener('pointerdown', handlePointerDown);
      overlay.removeEventListener('pointermove', handlePointerMove);
      overlay.removeEventListener('pointerup', stopDragging);
      overlay.removeEventListener('pointercancel', stopDragging);
      overlay.removeEventListener('dblclick', handleDoubleClick);
      overlay.removeEventListener('mouseleave', handleMouseLeave);
      plot.destroy();
      plotRef.current = null;
    };
  }, [channelSignature]);

  useEffect(() => {
    let animationFrame = 0;
    let lastFrameAt = 0;
    const tick = (frameTime: number) => {
      if (
        scrollWhenIdleRef.current &&
        frameTime - lastFrameAt >= 1000 / 30 &&
        pausedAtRef.current === null &&
        followingRef.current
      ) {
        lastFrameAt = frameTime;
        refreshViewRef.current(getClockTimeRef.current());
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;

    plot.setData(data as AlignedData, false);

    let visibilityChanged = false;
    channels.forEach((channel, index) => {
      const show = visibleChannels.has(channel.id);
      if (plot.series[index + 1].show === show) return;
      visibilityChanged = true;
      plot.setSeries(index + 1, { show });
    });

    if (yScaleMode === 'manual' && visibilityChanged) {
      // uPlot clears a series' Y scale whenever its visibility is set. Keep
      // the user's manual range when channels are toggled instead of leaving
      // the scale (and therefore both trace and labels) unranged.
      const manualScale = yScaleRef.current;
      if (
        manualScale
        && Number.isFinite(manualScale.min)
        && Number.isFinite(manualScale.max)
      ) plot.setScale('y', manualScale);
      else fitManualYRef.current = true;
    }

    const liveEnd = pausedAt ?? getClockTime();
    refreshViewRef.current(liveEnd, true);
  }, [
    yScaleMode,
    channels,
    data,
    dataVersion,
    getClockTime,
    pausedAt,
    selectedChannel,
    visibleChannels,
    windowSeconds,
  ]);

  useEffect(() => {
    if (pausedAt === null) return;
    setFollowing(true);
    refreshViewRef.current(pausedAt, true);
  }, [pausedAt]);

  useEffect(() => {
    setFollowing(true);
  }, [windowSeconds]);

  const returnToLive = () => {
    setFollowing(true);
    refreshViewRef.current(getClockTimeRef.current(), true);
  };

  const selectedIndex = channels.findIndex((channel) => channel.id === selectedChannel);
  const selectedHoverValue = hover && selectedIndex >= 0 ? hover.values[selectedIndex] : null;
  const noChannels = visibleChannels.size === 0;
  const visibleUnits = new Set(
    channels
      .filter((channel) => visibleChannels.has(channel.id) && channel.unit)
      .map((channel) => channel.unit),
  );
  const axisUnit = visibleUnits.size === 1 ? [...visibleUnits][0] : '';
  const selectedUnit = selectedIndex >= 0 ? channels[selectedIndex].unit : '';

  return (
    <div className="plot-stage" ref={stageRef}>
      <div className="plot-canvas" ref={hostRef} />
      {axisUnit && <span className="axis-unit">{axisUnit}</span>}

      {!isFollowing && (
        <button className="return-live" type="button" onClick={returnToLive}>
          <Radio size={14} />
          Return to live
        </button>
      )}

      {hover && selectedHoverValue !== null && selectedHoverValue !== undefined && !noChannels && (
        <div
          className="plot-tooltip"
          style={{
            left: `clamp(82px, ${hover.left + 18}px, calc(100% - 178px))`,
          }}
        >
          <span>{hover.time.toFixed(3)} s</span>
          <strong style={{ color: channels[selectedIndex].color }}>
            {channels[selectedIndex].label}
            <b>{selectedHoverValue.toFixed(2)}{selectedUnit ? ` ${selectedUnit}` : ''}</b>
          </strong>
        </div>
      )}

      {noChannels && (
        <div className="empty-plot">
          <span className="empty-plot-icon"><Waves size={24} /></span>
          <strong>{emptyTitle}</strong>
          <p>{emptyMessage}</p>
          {showEmptyAction && (
            <button type="button" onClick={onShowAllChannels}>
              <Eye size={14} /> Show all channels
            </button>
          )}
        </div>
      )}
    </div>
  );
}
