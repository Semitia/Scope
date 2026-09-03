import type { YScaleMode } from './types';

export type PanelType = 'scope' | 'value-bar' | 'indicators';

export interface StateColorDefinition {
  value: number;
  label: string;
  color: string;
}

export interface PanelGridLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BasePanelDefinition {
  id: string;
  type: PanelType;
  title: string;
  channelKeys: string[];
  layout: PanelGridLayout;
}

export interface ScopePanelDefinition extends BasePanelDefinition {
  type: 'scope';
  yScaleMode: YScaleMode;
  windowMode: 'auto' | 'manual';
  windowSeconds: number;
}

export interface ValueBarChannelRange {
  mode: 'auto' | 'manual';
  min: number;
  max: number;
}

export interface ValueBarPanelDefinition extends BasePanelDefinition {
  type: 'value-bar';
  rangeMode: 'auto' | 'manual';
  manualMin: number;
  manualMax: number;
  channelGroup?: string;
  channelRanges: Record<string, ValueBarChannelRange>;
}

export interface IndicatorPanelDefinition extends BasePanelDefinition {
  type: 'indicators';
  stateColors: StateColorDefinition[];
  channelGroup?: string;
}

export type PanelDefinition =
  | ScopePanelDefinition
  | ValueBarPanelDefinition
  | IndicatorPanelDefinition;

export const DEFAULT_STATE_COLORS: StateColorDefinition[] = [
  { value: -1, label: 'Fault', color: '#e14f61' },
  { value: 0, label: 'Off', color: '#718096' },
  { value: 1, label: 'On', color: '#19a974' },
  { value: 2, label: 'Warning', color: '#e69a24' },
];

export function panelTypeLabel(type: PanelType): string {
  if (type === 'value-bar') return 'Value bars';
  if (type === 'indicators') return 'Indicators';
  return 'Waveform';
}
