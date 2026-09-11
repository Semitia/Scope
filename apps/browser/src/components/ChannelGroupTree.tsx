import { useId, useMemo, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ChannelDefinition } from '../types';

interface Group {
  name: string;
  path: string;
  count: number;
  channels: ChannelDefinition[];
  children: Map<string, Group>;
}

export function ChannelGroupTree({ channels, collapsed, searching, onToggle, renderChannel }: {
  channels: ChannelDefinition[];
  collapsed: ReadonlySet<string>;
  searching: boolean;
  onToggle: (path: string) => void;
  renderChannel: (channel: ChannelDefinition) => ReactNode;
}) {
  const id = useId();
  const roots = useMemo(() => {
    const roots = new Map<string, Group>();
    for (const channel of channels) {
      const parts = channel.key.split('.').slice(0, -1);
      if (!parts.length) parts.push('signals');
      let children = roots;
      let path = '';
      for (const [index, name] of parts.entries()) {
        path = path ? `${path}.${name}` : name;
        let group = children.get(name);
        if (!group) {
          group = { name, path, count: 0, channels: [], children: new Map() };
          children.set(name, group);
        }
        group.count++;
        if (index === parts.length - 1) group.channels.push(channel);
        children = group.children;
      }
    }
    return roots;
  }, [channels]);
  const renderGroup = (group: Group): ReactNode => {
    const closed = !searching && collapsed.has(group.path);
    const contentId = `${id}-${encodeURIComponent(group.path)}`;
    return <div className={`channel-group${closed ? ' collapsed' : ''}`} key={group.path}>
      <button className="group-label" type="button" onClick={() => onToggle(group.path)}
        aria-label={`${group.path} channel group`} aria-expanded={!closed} aria-controls={contentId} title={group.path}>
        <ChevronDown size={14} aria-hidden="true" /><span>{group.name}</span><b>{group.count}</b>
      </button>
      {!closed && <div id={contentId}>
        <div className="channel-list">{group.channels.map(renderChannel)}</div>
        <div className="channel-subgroups">{[...group.children.values()].map(renderGroup)}</div>
      </div>}
    </div>;
  };
  return <>{[...roots.values()].map(renderGroup)}</>;
}
