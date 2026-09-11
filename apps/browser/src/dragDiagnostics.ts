// Opt in with ?dragDebug=1 or localStorage['debugscope.drag-debug'] = '1'.
// Buffer samples instead of logging every frame: console traffic can cause stutter.
interface DragTrace {
  startedAt: string;
  metadata: Record<string, unknown>;
  samples: Record<string, unknown>[];
  droppedSamples: number;
}

declare global {
  interface Window {
    debugscopeDragTraces?: DragTrace[];
  }
}

export function createDragDiagnostics(metadata: Record<string, unknown>) {
  let enabled = new URLSearchParams(location.search).get('dragDebug') === '1';
  try { enabled ||= localStorage.getItem('debugscope.drag-debug') === '1'; } catch { /* Storage may be disabled. */ }
  if (!enabled) return null;

  const start = performance.now();
  const trace: DragTrace = { startedAt: new Date().toISOString(), metadata, samples: [], droppedSamples: 0 };
  const traces = window.debugscopeDragTraces ??= [];
  traces.push(trace);
  if (traces.length > 5) traces.shift();
  let finished = false;
  let pointerCount = 0;
  let previewCount = 0;
  let lastPointerAt: number | null = null;
  let pendingRenderAt: number | null = null;
  let maxInputDelayMs = 0;
  let maxRenderDelayMs = 0;
  let maxFrameGapMs = 0;
  let frameAt = start;
  let heartbeat: number;
  const record = (event: string, details: Record<string, unknown> = {}) => {
    if (finished) return;
    if (trace.samples.length === 2000) {
      trace.samples.splice(0, 500);
      trace.droppedSamples += 500;
    }
    trace.samples.push({ event, ms: performance.now() - start, ...details });
  };
  const tick = (now: number) => {
    const gapMs = now - frameAt;
    maxFrameGapMs = Math.max(maxFrameGapMs, gapMs);
    if (gapMs > 34) record('frame-gap', { gapMs, visibility: document.visibilityState });
    frameAt = now;
    heartbeat = requestAnimationFrame(tick);
  };
  heartbeat = requestAnimationFrame(tick);
  let observer: PerformanceObserver | undefined;
  const recordLongTasks = (entries: PerformanceEntry[]) => entries.forEach((entry) => {
    if (entry.startTime + entry.duration >= start) {
      record('long-task', { startMs: entry.startTime - start, durationMs: entry.duration });
    }
  });
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    observer = new PerformanceObserver((list) => recordLongTasks(list.getEntries()));
    observer.observe({ type: 'longtask' });
  }
  console.info('[drag-debug] recording; release to see summary. Export: copy(JSON.stringify(window.debugscopeDragTraces))');
  record('start', metadata);
  return {
    record,
    pointer(event: PointerEvent, queued: boolean) {
      pointerCount++;
      lastPointerAt = performance.now();
      const inputDelayMs = Math.max(0, lastPointerAt - event.timeStamp);
      maxInputDelayMs = Math.max(maxInputDelayMs, inputDelayMs);
      record('pointer', { x: event.clientX, y: event.clientY, inputDelayMs, queued });
    },
    preview(details: Record<string, unknown>) {
      previewCount++;
      const now = performance.now();
      // Retain the first outstanding update if React batches multiple previews.
      pendingRenderAt ??= now;
      record('preview', { ...details, pointerAgeMs: lastPointerAt === null ? null : now - lastPointerAt });
    },
    rendered(details: Record<string, unknown>) {
      if (pendingRenderAt === null) return;
      const renderDelayMs = performance.now() - pendingRenderAt;
      maxRenderDelayMs = Math.max(maxRenderDelayMs, renderDelayMs);
      record('render', { ...details, renderDelayMs });
      pendingRenderAt = null;
    },
    finish(reason: string) {
      if (finished) return;
      cancelAnimationFrame(heartbeat);
      if (observer) {
        recordLongTasks(observer.takeRecords());
        observer.disconnect();
      }
      const summary = { reason, durationMs: performance.now() - start, pointerCount, previewCount,
        maxInputDelayMs, maxRenderDelayMs, maxFrameGapMs, droppedSamples: trace.droppedSamples };
      record('finish', summary);
      finished = true;
      console.info('[drag-debug] summary', summary);
    },
  };
}
