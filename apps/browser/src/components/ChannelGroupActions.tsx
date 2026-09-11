import { useRef, useState } from 'react';
import { Eye, EyeOff, Palette, Trash2, X } from 'lucide-react';
import type { ChannelDefinition, LinePattern } from '../types';
import { PreviewSelect, PATTERN_OPTIONS } from './PreviewSelect';
import { FloatingPanel } from './FloatingPanel';

type StylePatch = Partial<Pick<ChannelDefinition, 'linePattern' | 'lineWidth' | 'opacity'>>;
export function ChannelGroupActions({ path, channels, visibleIds, disabled, onVisibility, onStyle, onDelete }: {
  path: string; channels: ChannelDefinition[]; visibleIds: ReadonlySet<string>; disabled: boolean;
  onVisibility: (show: boolean) => void; onStyle: (patch: StylePatch) => void; onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const allVisible = channels.every((channel) => visibleIds.has(channel.id));
  const someVisible = channels.some((channel) => visibleIds.has(channel.id));
  const shared = (key: keyof StylePatch) => {
    const values = channels.map((channel) => channel[key] ?? (key === 'opacity' ? 1 : undefined));
    return values.every((value) => value === values[0]) ? values[0] : '';
  };
  return <div className="channel-group-actions">
    <button type="button" disabled={disabled} aria-label={`${allVisible ? 'Hide' : 'Show'} group ${path}`}
      aria-pressed={someVisible && !allVisible ? 'mixed' : allVisible} title="Show / hide all descendants in the selected panel"
      onClick={() => onVisibility(!allVisible)}>{someVisible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
    <button type="button" ref={anchor} aria-label={`Style group ${path}`} aria-expanded={open}
      onClick={() => setOpen(!open)}><Palette size={15} /></button>
    {open && <FloatingPanel className="style-editor group-style-editor" label={`Style group ${path}`} width={360}
      anchor={() => anchor.current} onClose={() => setOpen(false)}>
      <div className="style-editor-header"><span>{path}</span><button aria-label="Close group style editor" onClick={() => setOpen(false)}><X size={14} /></button></div>
      <p className="group-style-note">Apply to {channels.length} channels · keep individual colors</p>
      <div className="style-fields">
        <div className="style-field"><span>Stroke</span>
          <PreviewSelect ariaLabel={`Stroke for group ${path}`} kind="pattern" color="var(--text-secondary)"
            options={PATTERN_OPTIONS} value={(shared('linePattern') || null) as LinePattern | null}
            onChange={(linePattern) => onStyle({ linePattern })} />
        </div>
        <label><span>Width</span><select aria-label={`Width for group ${path}`} value={shared('lineWidth')}
          onChange={(event) => onStyle({ lineWidth: Number(event.target.value) })}>
          <option value="" disabled>Mixed</option>{[1, 1.5, 2, 2.5, 3].map((width) => <option key={width} value={width}>{width} px</option>)}
        </select></label>
        <label><span>Opacity</span><select aria-label={`Opacity for group ${path}`} value={shared('opacity')}
          onChange={(event) => onStyle({ opacity: Number(event.target.value) })}>
          <option value="" disabled>Mixed</option>{[1, .75, .5, .25, .1].map((opacity) => <option key={opacity} value={opacity}>{opacity * 100}%</option>)}
        </select></label>
      </div>
      {onDelete && <><p className="group-style-note">Remove channels and history from the Hub. Incoming channels will reappear.</p>
        <button className="reset-style" onClick={() => { onDelete(); setOpen(false); }}><Trash2 size={13} /> Delete group channels</button></>}
    </FloatingPanel>}
  </div>;
}
