import React from 'react';
import { createRoot } from 'react-dom/client';
import { ValueBarPanel } from '../../src/components/ValueBarPanel';
import '../../src/styles.css';
import type { ChannelDefinition } from '../../src/types';

const values = [56.27, -1.944, 0.01033, -0.588, -0.01372, -0.0001347];
const channels: ChannelDefinition[] = values.map((_, index) => ({
  id: String(index), key: String(index), label: String(index), sourceId: 1,
  color: '#08a', lineCurve: 'linear', linePattern: 'solid', lineWidth: 1,
  unit: '', description: '', valueType: 'FLOAT32',
}));
createRoot(document.getElementById('root')!).render(
  <div id="panel" style={{ width: 440, height: 600, containerType: 'inline-size' }}>
    <ValueBarPanel panel={{ id: 'values', type: 'value-bar', title: 'Values',
      layout: { x: 0, y: 0, width: 2, height: 4 }, channelKeys: channels.map(c => c.key),
      rangeMode: 'manual', manualMin: -100, manualMax: 100 }}
      channels={channels} data={[[0], ...values.map(v => [v])]} latest={values}
      channelIndexes={new Map(channels.map((c, i) => [c.id, i]))} onChange={() => {}} />
  </div>,
);
