export type LineCurve = 'smooth' | 'linear' | 'stepped';
export type LinePattern = 'solid' | 'dashed' | 'dotted' | 'dashdot';
export type ThemeMode = 'light' | 'dark';

export interface ChannelDefinition {
  id: string;
  sourceId: number;
  key: string;
  label: string;
  color: string;
  lineCurve: LineCurve;
  linePattern: LinePattern;
  lineWidth: number;
  unit: string;
  description: string;
  valueType?: string;
  lastValue?: number;
  lastSeen?: number;
}

export interface SourceDefinition {
  id: number;
  name: string;
  programKey: string;
  processId?: number;
  sdkName?: string;
  active: boolean;
  receivedPackets: number;
  missingPackets: number;
  channelCount: number;
}

export type TelemetryData = [number[], ...Array<Array<number | null | undefined>>];

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface TelemetryController {
  mode: 'live' | 'demo';
  connection: ConnectionState;
  sources: SourceDefinition[];
  activeSourceId: number | null;
  setActiveSourceId: (sourceId: number) => void;
  channels: ChannelDefinition[];
  data: TelemetryData;
  latest: number[];
  latestTime: number;
  version: number;
  sampleRate: number;
  memoryBytes: number;
  now: () => number;
  clear: () => void;
  deleteSource: (sourceId: number) => void;
}

export const TRACE_COLORS = [
  '#1976d2',
  '#e14c92',
  '#7756c5',
  '#e85d4f',
  '#149a72',
  '#df7a16',
  '#008da8',
  '#9a7110',
  '#596bd5',
  '#c43fbd',
  '#4f8f22',
  '#c95b70',
] as const;

export function colorForChannel(sourceId: number, key: string): string {
  let hash = (0x811c9dc5 ^ sourceId) >>> 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193) >>> 0;
  }
  return TRACE_COLORS[hash % TRACE_COLORS.length];
}

export function labelForKey(key: string): string {
  const segment = key.split('.').at(-1) || key;
  return segment.replace(/[_-]+/g, ' ').replace(/^\w/, (character) => character.toUpperCase());
}

export const DEMO_CHANNELS: ChannelDefinition[] = [
  {
    id: '1:controller.target',
    sourceId: 1,
    key: 'controller.target',
    label: 'Target',
    color: TRACE_COLORS[0],
    lineCurve: 'linear',
    linePattern: 'solid',
    lineWidth: 2,
    unit: 'rpm',
    description: 'Requested motor speed',
  },
  {
    id: '1:controller.speed',
    sourceId: 1,
    key: 'controller.speed',
    label: 'Speed',
    color: TRACE_COLORS[1],
    lineCurve: 'linear',
    linePattern: 'solid',
    lineWidth: 2,
    unit: 'rpm',
    description: 'Measured motor speed',
  },
  {
    id: '1:controller.estimate',
    sourceId: 1,
    key: 'controller.estimate',
    label: 'Estimate',
    color: TRACE_COLORS[2],
    lineCurve: 'linear',
    linePattern: 'dashed',
    lineWidth: 2,
    unit: 'rpm',
    description: 'Filtered speed estimate',
  },
  {
    id: '1:controller.error',
    sourceId: 1,
    key: 'controller.error',
    label: 'Error',
    color: TRACE_COLORS[3],
    lineCurve: 'linear',
    linePattern: 'solid',
    lineWidth: 2,
    unit: 'rpm',
    description: 'Target minus measured speed',
  },
];
