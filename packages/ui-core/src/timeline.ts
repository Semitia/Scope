import type { TelemetryData } from './types';

const MIN_IDLE_GAP_SECONDS = 0.2;
const IDLE_GAP_INTERVAL_FACTOR = 5;
const MAX_INTERVAL_SAMPLES = 512;

export interface PreparedTimeline {
  data: TelemetryData;
  latestTime: number;
  gapCount: number;
}
function estimateNominalInterval(timestamps: number[]): number {
  const intervals: number[] = [];
  const firstIndex = Math.max(1, timestamps.length - MAX_INTERVAL_SAMPLES);

  for (let index = firstIndex; index < timestamps.length; index += 1) {
    const interval = timestamps[index] - timestamps[index - 1];
    if (Number.isFinite(interval) && interval > 0.000_001) intervals.push(interval);
  }

  if (intervals.length === 0) return 1 / 30;
  intervals.sort((left, right) => left - right);
  return intervals[Math.floor((intervals.length - 1) / 2)];
}

export function prepareTimeline(
  rawData: TelemetryData,
  preserveIdleGaps: boolean,
): PreparedTimeline {
  const rawTimestamps = rawData[0];
  const outputTimestamps: number[] = [];
  const outputSeries = rawData.slice(1).map(() => [] as Array<number | null | undefined>);

  if (rawTimestamps.length === 0) {
    return {
      data: [outputTimestamps, ...outputSeries],
      latestTime: 0,
      gapCount: 0,
    };
  }

  const nominalInterval = estimateNominalInterval(rawTimestamps);
  const idleGapThreshold = Math.max(
    MIN_IDLE_GAP_SECONDS,
    nominalInterval * IDLE_GAP_INTERVAL_FACTOR,
  );
  let displayTime = rawTimestamps[0];
  let gapCount = 0;

  for (let pointIndex = 0; pointIndex < rawTimestamps.length; pointIndex += 1) {
    const rawTime = rawTimestamps[pointIndex];

    if (pointIndex > 0) {
      const previousRawTime = rawTimestamps[pointIndex - 1];
      const interval = rawTime - previousRawTime;
      const isIdleGap = Number.isFinite(interval) && interval > idleGapThreshold;

      if (isIdleGap) {
        gapCount += 1;
        if (preserveIdleGaps) {
          outputTimestamps.push(previousRawTime + interval / 2);
          outputSeries.forEach((series) => series.push(null));
        }
      }

      displayTime += isIdleGap && !preserveIdleGaps ? nominalInterval : interval;
    }

    outputTimestamps.push(preserveIdleGaps ? rawTime : displayTime);
    outputSeries.forEach((series, seriesIndex) => {
      const value = rawData[seriesIndex + 1][pointIndex];
      // Undefined keeps normally asynchronous channels connected in uPlot;
      // null is reserved for the explicit idle-gap marker above.
      series.push(value === null ? undefined : value);
    });
  }

  return {
    data: [outputTimestamps, ...outputSeries],
    latestTime: outputTimestamps.at(-1) ?? 0,
    gapCount,
  };
}
