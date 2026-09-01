import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_CHANNELS, type TelemetryData } from '../types';

const SAMPLE_RATE = 30;
const SAMPLE_INTERVAL_MS = 1000 / SAMPLE_RATE;
const HISTORY_SECONDS = 60;
const INITIAL_SECONDS = 12;

interface DemoModel {
  speed: number;
  estimate: number;
}

interface DemoSession {
  baseTime: number;
  data: TelemetryData;
  latest: number[];
  model: DemoModel;
}

function sampleModel(model: DemoModel, time: number): number[] {
  const target =
    1_260 +
    205 * Math.sin(time * 0.51) +
    58 * Math.sin(time * 1.27 + 0.7) +
    18 * Math.sin(time * 3.9);

  const disturbance = 3.2 * Math.sin(time * 5.7) + 1.8 * Math.sin(time * 11.1);
  model.speed += (target - model.speed) * 0.025 + disturbance;
  model.estimate += (model.speed - model.estimate) * 0.17;

  return [target, model.speed, model.estimate, target - model.speed];
}

function createSession(): DemoSession {
  const data = Array.from({ length: DEMO_CHANNELS.length + 1 }, () => []) as unknown as TelemetryData;
  const model: DemoModel = { speed: 1_120, estimate: 1_120 };
  let latest = Array.from({ length: DEMO_CHANNELS.length }, () => 0);

  for (let step = -INITIAL_SECONDS * SAMPLE_RATE; step <= 0; step += 1) {
    const time = step / SAMPLE_RATE;
    latest = sampleModel(model, time);
    data[0].push(time);
    latest.forEach((value, index) => data[index + 1].push(value));
  }

  return {
    baseTime: performance.now() / 1000,
    data,
    latest,
    model,
  };
}

export interface DemoTelemetry {
  data: TelemetryData;
  latest: number[];
  latestTime: number;
  version: number;
  sampleRate: number;
  memoryBytes: number;
  now: () => number;
  clear: () => void;
}

export function useDemoTelemetry(enabled = true): DemoTelemetry {
  const sessionRef = useRef<DemoSession | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = createSession();
  }

  const [version, setVersion] = useState(0);
  const [latest, setLatest] = useState(() => [...sessionRef.current!.latest]);

  useEffect(() => {
    if (!enabled) return;
    let lastPublishedAt = 0;

    const timer = window.setInterval(() => {
      const session = sessionRef.current!;
      const time = performance.now() / 1000 - session.baseTime;
      const values = sampleModel(session.model, time);

      session.data[0].push(time);
      values.forEach((value, index) => session.data[index + 1].push(value));
      session.latest = values;

      const cutoff = time - HISTORY_SECONDS;
      let removeCount = 0;
      while (removeCount < session.data[0].length && session.data[0][removeCount] < cutoff) {
        removeCount += 1;
      }
      if (removeCount > 0) {
        session.data.forEach((series) => series.splice(0, removeCount));
      }

      const now = performance.now();
      if (now - lastPublishedAt >= 50) {
        lastPublishedAt = now;
        setLatest([...values]);
        setVersion((value) => value + 1);
      }
    }, SAMPLE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [enabled]);

  const clear = useCallback(() => {
    const session = sessionRef.current!;
    session.data = Array.from({ length: DEMO_CHANNELS.length + 1 }, () => []) as unknown as TelemetryData;
    session.model = { speed: 1_120, estimate: 1_120 };
    session.latest = Array.from({ length: DEMO_CHANNELS.length }, () => 0);
    session.baseTime = performance.now() / 1000;
    setLatest([...session.latest]);
    setVersion((value) => value + 1);
  }, []);

  const now = useCallback(
    () => performance.now() / 1_000 - sessionRef.current!.baseTime,
    [],
  );

  const session = sessionRef.current;
  const pointCount = session.data[0].length;

  return {
    data: session.data,
    latest,
    latestTime: pointCount > 0 ? session.data[0][pointCount - 1] : 0,
    version,
    sampleRate: SAMPLE_RATE,
    memoryBytes: pointCount * (DEMO_CHANNELS.length + 1) * Float64Array.BYTES_PER_ELEMENT,
    now,
    clear,
  };
}
