import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChannelGroupTree } from '../../src/components/ChannelGroupTree';
import '../../src/styles.css';
import type { ChannelDefinition } from '../../src/types';

const channels: ChannelDefinition[] = ['error.angle', 'error.position_vec.0', 'error.position_vec.raw.x', 'error.rotation_vec.0']
  .map(key => ({ id: key, key, label: key, sourceId: 1, color: '#08a', lineCurve: 'linear', linePattern: 'solid',
    lineWidth: 1, unit: '', description: '' }));
function Harness() {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [query, setQuery] = useState('');
  return <div style={{ width: 400 }}>
    <input aria-label="Search" value={query} onChange={event => setQuery(event.target.value)} />
    <ChannelGroupTree channels={channels.filter(channel => channel.key.includes(query))} collapsed={collapsed}
      searching={Boolean(query)} onToggle={path => setCollapsed(current => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path); else next.add(path);
        return next;
      })} renderChannel={channel => <div key={channel.id} data-channel={channel.key}>{channel.label}</div>} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
