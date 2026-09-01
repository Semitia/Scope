import { expect, test } from '@playwright/test';
import { prepareTimeline } from '../src/timeline';
import type { TelemetryData } from '../src/types';

const stoppedAndResumedData: TelemetryData = [
  [0, 0.1, 0.2, 2.2, 2.3],
  [10, 11, null, 14, 15],
  [20, 21, 22, 24, 25],
];

test('real-time mode preserves idle time and inserts an explicit line break', () => {
  const timeline = prepareTimeline(stoppedAndResumedData, true);

  expect(timeline.gapCount).toBe(1);
  expect(timeline.latestTime).toBeCloseTo(2.3);
  expect(timeline.data[0]).toEqual([0, 0.1, 0.2, 1.2, 2.2, 2.3]);
  expect(timeline.data[1]).toEqual([10, 11, undefined, null, 14, 15]);
  expect(timeline.data[2]).toEqual([20, 21, 22, null, 24, 25]);
});

test('sample-time mode removes idle time and keeps resumed data connected', () => {
  const timeline = prepareTimeline(stoppedAndResumedData, false);

  expect(timeline.gapCount).toBe(1);
  expect(timeline.latestTime).toBeCloseTo(0.4);
  expect(timeline.data[0]).toHaveLength(5);
  [0, 0.1, 0.2, 0.3, 0.4].forEach((time, index) => {
    expect(timeline.data[0][index]).toBeCloseTo(time);
  });
  expect(timeline.data[1]).toEqual([10, 11, undefined, 14, 15]);
  expect(timeline.data[2]).toEqual([20, 21, 22, 24, 25]);
});
