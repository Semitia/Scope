import type { DecodedPacket, ValueType } from './protocol.js';

export type SamplePoint = [number, number];

export interface ChannelSnapshot {
  sourceId: number;
  key: string;
  valueType: ValueType;
  lastValue: number;
  lastSeen: number;
  samples: SamplePoint[];
}

export interface SourceCatalogEntry {
  id: number;
  name: string;
  programKey: string;
  processId?: number;
  sdkName?: string;
  firstSeen: number;
  lastSeen: number;
  receivedPackets: number;
  missingPackets: number;
  active: boolean;
  channels: Array<Omit<ChannelSnapshot, 'samples'>>;
}

export interface StoreSnapshot {
  sources: SourceCatalogEntry[];
  channels: ChannelSnapshot[];
}

export interface IngestResult {
  catalogChanged: boolean;
  batches: Array<{
    sourceId: number;
    key: string;
    valueType: ValueType;
    samples: SamplePoint[];
  }>;
}

interface ChannelState {
  sourceId: number;
  key: string;
  valueType: ValueType;
  lastValue: number;
  lastSeen: number;
  samples: SamplePoint[];
}

interface SourceState {
  id: number;
  name: string;
  programKey: string;
  processId?: number;
  sdkName?: string;
  firstSeen: number;
  lastSeen: number;
  receivedPackets: number;
  missingPackets: number;
  channels: Map<string, ChannelState>;
}

interface TransportState {
  source: SourceState;
  lastSequence?: number;
  timeOffsetSeconds: number;
  lastSeen: number;
}

const ACTIVE_TIMEOUT_SECONDS = 3;
const DEFAULT_MAX_TOTAL_POINTS = (128 * 1024 * 1024) / 16;
const MAX_SOURCES = 64;
const MAX_CHANNELS_PER_SOURCE = 256;

export class TelemetryStore {
  readonly sources = new Map<number, SourceState>();
  malformedPackets = 0;
  private totalPoints = 0;
  private readonly transports = new Map<number, TransportState>();
  private readonly sourcesByProgram = new Map<string, SourceState>();

  constructor(
    private readonly historySeconds = 60,
    private readonly maxPointsPerChannel = 60_000,
    private readonly maxTotalPoints = DEFAULT_MAX_TOTAL_POINTS,
  ) {}

  ingest(packet: DecodedPacket, receivedAtSeconds: number): IngestResult {
    let catalogChanged = false;
    let transport = this.transports.get(packet.sourceId);
    if (!transport) {
      const helloProgramKey = packet.messageType === 'HELLO' ? this.programKey(packet.sourceName) : '';
      let source = helloProgramKey ? this.sourcesByProgram.get(helloProgramKey) : undefined;
      if (!source) {
        if (this.sources.size >= MAX_SOURCES) return { catalogChanged: false, batches: [] };
        source = this.createSource(packet.sourceId, receivedAtSeconds);
        catalogChanged = true;
      }
      transport = {
        source,
        timeOffsetSeconds: receivedAtSeconds - Number(packet.timestampNs) / 1e9,
        lastSeen: receivedAtSeconds,
      };
      this.transports.set(packet.sourceId, transport);
    }

    if (packet.messageType === 'HELLO') {
      const programKey = this.programKey(packet.sourceName);
      const existingSource = this.sourcesByProgram.get(programKey);
      if (existingSource && existingSource !== transport.source) {
        this.removeSourceState(transport.source);
        transport.source = existingSource;
        transport.lastSequence = undefined;
        transport.timeOffsetSeconds = receivedAtSeconds - Number(packet.timestampNs) / 1e9;
        catalogChanged = true;
      }
    }

    const source = transport.source;
    this.updateSequence(transport, source, packet.sequence);
    transport.lastSeen = receivedAtSeconds;
    source.receivedPackets += 1;
    source.lastSeen = receivedAtSeconds;

    if (packet.messageType === 'HELLO') {
      const programKey = this.programKey(packet.sourceName);
      if (
        source.name !== packet.sourceName ||
        source.programKey !== programKey ||
        source.processId !== packet.processId ||
        source.sdkName !== packet.sdkName
      ) {
        if (source.programKey && this.sourcesByProgram.get(source.programKey) === source) {
          this.sourcesByProgram.delete(source.programKey);
        }
        source.name = packet.sourceName || source.name;
        source.programKey = programKey;
        source.processId = packet.processId;
        source.sdkName = packet.sdkName;
        this.sourcesByProgram.set(programKey, source);
        catalogChanged = true;
      }
      return { catalogChanged, batches: [] };
    }

    const sampleTime = transport.timeOffsetSeconds + Number(packet.timestampNs) / 1e9;
    const batches: IngestResult['batches'] = [];
    for (const item of packet.items) {
      const numericValue = typeof item.value === 'boolean' ? (item.value ? 1 : 0) : item.value;
      let channel = source.channels.get(item.key);
      if (!channel) {
        if (source.channels.size >= MAX_CHANNELS_PER_SOURCE) continue;
        channel = {
          sourceId: source.id,
          key: item.key,
          valueType: item.valueType,
          lastValue: numericValue,
          lastSeen: sampleTime,
          samples: [],
        };
        source.channels.set(item.key, channel);
        catalogChanged = true;
      } else if (channel.valueType !== item.valueType) {
        channel.valueType = item.valueType;
        catalogChanged = true;
      }

      channel.lastValue = numericValue;
      channel.lastSeen = sampleTime;
      channel.samples.push([sampleTime, numericValue]);
      this.totalPoints += 1;
      this.trimChannel(channel, sampleTime);
      batches.push({
        sourceId: source.id,
        key: channel.key,
        valueType: channel.valueType,
        samples: [[sampleTime, numericValue]],
      });
    }

    this.enforceGlobalPointCap();

    return { catalogChanged, batches };
  }

  clear(): void {
    for (const source of this.sources.values()) {
      for (const channel of source.channels.values()) channel.samples = [];
    }
    this.totalPoints = 0;
  }

  deleteSource(sourceId: number): boolean {
    const source = this.sources.get(sourceId);
    if (!source) return false;
    this.removeSourceState(source);
    for (const [transportId, transport] of this.transports) {
      if (transport.source === source) this.transports.delete(transportId);
    }
    return true;
  }

  catalog(nowSeconds: number): SourceCatalogEntry[] {
    return [...this.sources.values()]
      .sort((left, right) => right.lastSeen - left.lastSeen)
      .map((source) => ({
        id: source.id,
        name: source.name,
        programKey: source.programKey || source.name,
        processId: source.processId,
        sdkName: source.sdkName,
        firstSeen: source.firstSeen,
        lastSeen: source.lastSeen,
        receivedPackets: source.receivedPackets,
        missingPackets: source.missingPackets,
        active: nowSeconds - source.lastSeen <= ACTIVE_TIMEOUT_SECONDS,
        channels: [...source.channels.values()]
          .sort((left, right) => left.key.localeCompare(right.key))
          .map((channel) => ({
            sourceId: channel.sourceId,
            key: channel.key,
            valueType: channel.valueType,
            lastValue: channel.lastValue,
            lastSeen: channel.lastSeen,
          })),
      }));
  }

  snapshot(nowSeconds: number): StoreSnapshot {
    const channels: ChannelSnapshot[] = [];
    for (const source of this.sources.values()) {
      for (const channel of source.channels.values()) {
        channels.push({
          sourceId: channel.sourceId,
          key: channel.key,
          valueType: channel.valueType,
          lastValue: channel.lastValue,
          lastSeen: channel.lastSeen,
          samples: channel.samples.map(([timestamp, value]) => [timestamp, value]),
        });
      }
    }
    return { sources: this.catalog(nowSeconds), channels };
  }

  memoryBytes(): number {
    return this.totalPoints * 16;
  }

  private updateSequence(transport: TransportState, source: SourceState, sequence: number): void {
    if (transport.lastSequence === undefined) {
      transport.lastSequence = sequence;
      return;
    }
    const expected = (transport.lastSequence + 1) >>> 0;
    const distance = (sequence - expected) >>> 0;
    if (distance < 0x80000000) {
      source.missingPackets += distance;
      transport.lastSequence = sequence;
    }
  }

  private createSource(sourceId: number, receivedAtSeconds: number): SourceState {
    const source: SourceState = {
      id: sourceId,
      name: `Source 0x${sourceId.toString(16).padStart(8, '0')}`,
      programKey: '',
      firstSeen: receivedAtSeconds,
      lastSeen: receivedAtSeconds,
      receivedPackets: 0,
      missingPackets: 0,
      channels: new Map(),
    };
    this.sources.set(sourceId, source);
    return source;
  }

  private programKey(sourceName: string): string {
    return sourceName.trim() || 'app';
  }

  private removeSourceState(source: SourceState): void {
    if (this.sources.get(source.id) === source) this.sources.delete(source.id);
    if (source.programKey && this.sourcesByProgram.get(source.programKey) === source) {
      this.sourcesByProgram.delete(source.programKey);
    }
    for (const channel of source.channels.values()) this.totalPoints -= channel.samples.length;
  }

  private trimChannel(channel: ChannelState, latestTime: number): void {
    const cutoff = latestTime - this.historySeconds;
    let removeCount = 0;
    while (removeCount < channel.samples.length && channel.samples[removeCount][0] < cutoff) {
      removeCount += 1;
    }
    const overflow = channel.samples.length - removeCount - this.maxPointsPerChannel;
    if (overflow > 0) removeCount += overflow;
    if (removeCount > 0) {
      channel.samples.splice(0, removeCount);
      this.totalPoints -= removeCount;
    }
  }

  private enforceGlobalPointCap(): void {
    let overflow = this.totalPoints - this.maxTotalPoints;
    while (overflow > 0) {
      let oldestChannel: ChannelState | undefined;
      for (const source of this.sources.values()) {
        for (const channel of source.channels.values()) {
          if (
            channel.samples.length > 0 &&
            (!oldestChannel || channel.samples[0][0] < oldestChannel.samples[0][0])
          ) {
            oldestChannel = channel;
          }
        }
      }
      if (!oldestChannel) break;
      const removeCount = Math.min(overflow, oldestChannel.samples.length);
      oldestChannel.samples.splice(0, removeCount);
      this.totalPoints -= removeCount;
      overflow -= removeCount;
    }
  }
}
