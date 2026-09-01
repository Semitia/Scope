import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  colorForChannel,
  labelForKey,
  TRACE_COLORS,
  type ChannelDefinition,
  type ConnectionState,
  type SourceDefinition,
  type TelemetryController,
  type TelemetryData,
} from '../types';

interface HubChannelMessage {
  sourceId: number;
  key: string;
  valueType: string;
  lastValue: number;
  lastSeen: number;
  samples?: Array<[number, number]>;
}

interface HubSourceMessage {
  id: number;
  name: string;
  programKey: string;
  processId?: number;
  sdkName?: string;
  active: boolean;
  receivedPackets: number;
  missingPackets: number;
  channels: HubChannelMessage[];
}

interface HubStats {
  sampleRate: number;
  memoryBytes: number;
  nowSeconds: number;
}

interface ChannelBuffer {
  definition: ChannelDefinition;
  samples: Array<[number, number]>;
}

interface ClientStore {
  sources: SourceDefinition[];
  channels: Map<string, ChannelBuffer>;
}

const MAX_ALIGNED_TIMESTAMPS = 12_000;
const CLIENT_HISTORY_SECONDS = 60;

function channelId(sourceId: number, key: string): string {
  return `${sourceId}:${key}`;
}

function definitionFromMessage(channel: HubChannelMessage, color: string): ChannelDefinition {
  return {
    id: channelId(channel.sourceId, channel.key),
    sourceId: channel.sourceId,
    key: channel.key,
    label: labelForKey(channel.key),
    color,
    lineCurve: 'linear',
    linePattern: 'solid',
    lineWidth: 2,
    unit: '',
    description: channel.valueType,
    valueType: channel.valueType,
    lastValue: channel.lastValue,
    lastSeen: channel.lastSeen,
  };
}

function sourcesFromCatalog(sources: HubSourceMessage[]): SourceDefinition[] {
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    programKey: source.programKey,
    processId: source.processId,
    sdkName: source.sdkName,
    active: source.active,
    receivedPackets: source.receivedPackets,
    missingPackets: source.missingPackets,
    channelCount: source.channels.length,
  }));
}

function upsertChannel(store: ClientStore, channel: HubChannelMessage): ChannelBuffer {
  const id = channelId(channel.sourceId, channel.key);
  const existing = store.channels.get(id);
  if (existing) {
    existing.definition = {
      ...existing.definition,
      key: channel.key,
      label: labelForKey(channel.key),
      description: channel.valueType,
      valueType: channel.valueType,
      lastValue: channel.lastValue,
      lastSeen: channel.lastSeen,
    };
    return existing;
  }

  const usedColorCount = [...store.channels.values()].filter(
    (candidate) => candidate.definition.sourceId === channel.sourceId,
  ).length;
  const color = TRACE_COLORS[usedColorCount % TRACE_COLORS.length]
    ?? colorForChannel(channel.sourceId, channel.key);
  const created = { definition: definitionFromMessage(channel, color), samples: [] };
  store.channels.set(id, created);
  return created;
}

export function useHubTelemetry(enabled: boolean): TelemetryController {
  const storeRef = useRef<ClientStore>({ sources: [], channels: new Map() });
  const socketRef = useRef<WebSocket | null>(null);
  const clockAnchorRef = useRef({ hubSeconds: 0, localMilliseconds: performance.now() });
  const latestSampleTimeRef = useRef(0);
  const [connection, setConnection] = useState<ConnectionState>(enabled ? 'connecting' : 'disconnected');
  const [sources, setSources] = useState<SourceDefinition[]>([]);
  const [activeSourceId, setActiveSourceIdState] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [stats, setStats] = useState<HubStats>({ sampleRate: 0, memoryBytes: 0, nowSeconds: 0 });

  const publish = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) {
      setConnection('disconnected');
      return;
    }

    let stopped = false;
    let reconnectTimer: number | undefined;
    let reconnectDelay = 350;

    const applyCatalog = (catalog: HubSourceMessage[]) => {
      const nextSources = sourcesFromCatalog(catalog);
      storeRef.current.sources = nextSources;
      setSources(nextSources);

      for (const source of catalog) {
        for (const channel of source.channels) {
          upsertChannel(storeRef.current, channel);
        }
      }

      const validSourceIds = new Set(nextSources.map((source) => source.id));
      for (const [id, channel] of storeRef.current.channels) {
        if (!validSourceIds.has(channel.definition.sourceId)) storeRef.current.channels.delete(id);
      }
      setActiveSourceIdState((current) =>
        current !== null && validSourceIds.has(current) ? current : (nextSources[0]?.id ?? null),
      );
    };

    const applyStats = (nextStats: Partial<HubStats> | undefined) => {
      if (!nextStats) return;
      if (typeof nextStats.nowSeconds === 'number' && Number.isFinite(nextStats.nowSeconds)) {
        clockAnchorRef.current = {
          hubSeconds: nextStats.nowSeconds,
          localMilliseconds: performance.now(),
        };
      }
      setStats((current) => ({
        sampleRate: nextStats.sampleRate ?? current.sampleRate,
        memoryBytes: nextStats.memoryBytes ?? current.memoryBytes,
        nowSeconds: nextStats.nowSeconds ?? current.nowSeconds,
      }));
    };

    const connect = () => {
      if (stopped) return;
      setConnection(socketRef.current ? 'reconnecting' : 'connecting');
      const webSocketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const webSocketHost = import.meta.env.DEV
        ? `${window.location.hostname}:4713`
        : window.location.host;
      const socket = new WebSocket(`${webSocketProtocol}//${webSocketHost}/api/ws`);
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        if (stopped) return;
        reconnectDelay = 350;
        setConnection('connected');
      });

      socket.addEventListener('message', (event) => {
        if (stopped || typeof event.data !== 'string') return;
        let message: {
          type?: string;
          sources?: HubSourceMessage[];
          channels?: HubChannelMessage[];
          batches?: Array<HubChannelMessage & { samples: Array<[number, number]> }>;
          stats?: Partial<HubStats>;
        };
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (message.type === 'snapshot') {
          storeRef.current.channels.clear();
          applyCatalog(message.sources ?? []);
          for (const channel of message.channels ?? []) {
            const storedChannel = upsertChannel(storeRef.current, channel);
            storedChannel.samples = channel.samples ?? [];
          }
          applyStats(message.stats);
          publish();
          return;
        }

        if (message.type === 'catalog') {
          applyCatalog(message.sources ?? []);
          applyStats(message.stats);
          publish();
          return;
        }

        if (message.type === 'samples') {
          for (const batch of message.batches ?? []) {
            const id = channelId(batch.sourceId, batch.key);
            let channel = storeRef.current.channels.get(id);
            if (!channel) {
              channel = upsertChannel(storeRef.current, {
                  ...batch,
                  lastValue: batch.samples.at(-1)?.[1] ?? 0,
                  lastSeen: batch.samples.at(-1)?.[0] ?? 0,
                });
            }
            channel.samples.push(...batch.samples);
            const latestSample = batch.samples.at(-1);
            if (latestSample) {
              channel.definition.lastSeen = latestSample[0];
              channel.definition.lastValue = latestSample[1];
              const cutoff = latestSample[0] - CLIENT_HISTORY_SECONDS;
              let removeCount = 0;
              while (removeCount < channel.samples.length && channel.samples[removeCount][0] < cutoff) {
                removeCount += 1;
              }
              if (removeCount > 0) channel.samples.splice(0, removeCount);
            }
          }
          applyStats(message.stats);
          publish();
          return;
        }

        if (message.type === 'cleared') {
          for (const channel of storeRef.current.channels.values()) channel.samples = [];
          publish();
        }
      });

      socket.addEventListener('close', () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (stopped) return;
        setConnection('reconnecting');
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.7, 5_000);
      });

      socket.addEventListener('error', () => socket.close());
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
  }, [enabled, publish]);

  const activeChannels = useMemo(() => {
    if (activeSourceId === null) return [];
    return [...storeRef.current.channels.values()]
      .filter((channel) => channel.definition.sourceId === activeSourceId)
      .sort((left, right) => left.definition.key.localeCompare(right.definition.key));
  }, [activeSourceId, version]);

  const aligned = useMemo(() => {
    const allTimestamps = new Set<number>();
    for (const channel of activeChannels) {
      for (const [timestamp] of channel.samples) allTimestamps.add(timestamp);
    }
    let timestamps = [...allTimestamps].sort((left, right) => left - right);
    if (timestamps.length > MAX_ALIGNED_TIMESTAMPS) timestamps = timestamps.slice(-MAX_ALIGNED_TIMESTAMPS);

    const timestampIndexes = new Map(timestamps.map((timestamp, index) => [timestamp, index]));
    const series: Array<Array<number | null>> = activeChannels.map(() =>
      Array.from({ length: timestamps.length }, () => null),
    );
    activeChannels.forEach((channel, channelIndex) => {
      for (const [timestamp, value] of channel.samples) {
        const timestampIndex = timestampIndexes.get(timestamp);
        if (timestampIndex !== undefined) series[channelIndex][timestampIndex] = value;
      }
    });

    const data = [timestamps, ...series] as TelemetryData;
    const latest = activeChannels.map((channel) => channel.definition.lastValue ?? 0);
    const latestTime = timestamps.at(-1) ?? 0;
    latestSampleTimeRef.current = latestTime;
    return { data, latest, latestTime };
  }, [activeChannels]);

  const clear = useCallback(() => {
    for (const channel of storeRef.current.channels.values()) channel.samples = [];
    socketRef.current?.send(JSON.stringify({ type: 'clear' }));
    publish();
  }, [publish]);

  const setActiveSourceId = useCallback((sourceId: number) => setActiveSourceIdState(sourceId), []);

  const now = useCallback(() => {
    const anchor = clockAnchorRef.current;
    if (anchor.hubSeconds <= 0) return latestSampleTimeRef.current;
    return anchor.hubSeconds + (performance.now() - anchor.localMilliseconds) / 1_000;
  }, []);

  const deleteSource = useCallback((sourceId: number) => {
    socketRef.current?.send(JSON.stringify({ type: 'deleteSource', sourceId }));
  }, []);

  return {
    mode: 'live',
    connection,
    sources,
    activeSourceId,
    setActiveSourceId,
    channels: activeChannels.map((channel) => channel.definition),
    data: aligned.data,
    latest: aligned.latest,
    latestTime: aligned.latestTime,
    version,
    sampleRate: stats.sampleRate,
    memoryBytes: stats.memoryBytes,
    now,
    clear,
    deleteSource,
  };
}
