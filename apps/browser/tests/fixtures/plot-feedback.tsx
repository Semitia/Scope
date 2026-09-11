import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WaveformPlot, useHubTelemetry, type ChannelDefinition, type TelemetryData } from '@debugscope/ui-core';
import 'uplot/dist/uPlot.min.css';
import '@debugscope/ui-core/plot.css';

const channel: ChannelDefinition = { id: '1:position', sourceId: 1, key: 'position', label: 'Position',
  color: '#07569c', lineCurve: 'linear', linePattern: 'solid', lineWidth: 1, unit: 'mm', description: '' };
const data: TelemetryData = [Array.from({ length: 500 }, (_, i) => i), Array.from({ length: 500 }, (_, i) => i / 2)];
let clock = 100;

function FeedbackHarness() {
  const [reports, setReports] = useState(0);
  const [revision, setRevision] = useState(0);
  const [visible, setVisible] = useState(true);
  const renders = useRef(0);
  const telemetry = useHubTelemetry({ enabled: false, defaultAddress: 'ws://127.0.0.1:4713/api/ws', persistManualHubs: false });
  const firstChannels = useRef(telemetry.channels);
  if (++renders.current > 80) throw new Error('Plot feedback failed to settle');
  return <>
    <output id="reports">{reports}</output>
    <output id="catalog-stable">{String(firstChannels.current === telemetry.channels)}</output>
    <button onClick={() => setRevision(v => v + 1)}>Unrelated parent update {revision}</button>
    <button onClick={() => setVisible(v => !v)}>Toggle channel</button>
    <div style={{ width: 800, height: 350, position: 'relative', display: 'grid' }}>
      <WaveformPlot channels={[{ ...channel }]} data={data} dataVersion={0}
        visibleChannels={new Set(visible ? [channel.id] : [])} selectedChannel={channel.id}
        windowSeconds={1000} pausedAt={null} yScaleMode="fit" theme="light" scrollWhenIdle={false}
        getClockTime={() => ++clock} onShowAllChannels={() => {}}
        onVisiblePointCount={() => setReports(v => v + 1)} onRenderRate={() => {}} />
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<FeedbackHarness />);
