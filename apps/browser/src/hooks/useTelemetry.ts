import { useMemo } from 'react';
import { DEMO_CHANNELS, type SourceDefinition, type TelemetryController } from '../types';
import { useDemoTelemetry } from './useDemoTelemetry';
import { useHubTelemetry } from './useHubTelemetry';

const DEMO_SOURCE: SourceDefinition = {
  id: 1,
  name: 'control-loop',
  programKey: 'control-loop',
  processId: 4711,
  sdkName: 'demo/0.1',
  active: true,
  receivedPackets: 0,
  missingPackets: 0,
  channelCount: DEMO_CHANNELS.length,
};

const keepDemoSource = () => {};
const keepDemoDelete = () => {};

export function useTelemetry(): TelemetryController {
  const demoMode = useMemo(() => new URLSearchParams(window.location.search).get('demo') === '1', []);
  const demo = useDemoTelemetry(demoMode);
  const hub = useHubTelemetry(!demoMode);

  if (!demoMode) return hub;

  return {
    mode: 'demo',
    connection: 'connected',
    sources: [DEMO_SOURCE],
    activeSourceId: DEMO_SOURCE.id,
    setActiveSourceId: keepDemoSource,
    channels: DEMO_CHANNELS,
    data: demo.data,
    latest: demo.latest,
    latestTime: demo.latestTime,
    version: demo.version,
    sampleRate: demo.sampleRate,
    memoryBytes: demo.memoryBytes,
    now: demo.now,
    clear: demo.clear,
    deleteSource: keepDemoDelete,
  };
}
