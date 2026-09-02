import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  colorForChannel, labelForKey, TRACE_COLORS,
  type ChannelDefinition, type ConnectionState, type HubDefinition,
  type SourceDefinition, type TelemetryController, type TelemetryData,
} from './types';

interface HubChannelMessage {
  sourceId: number; key: string; valueType: string; lastValue: number; lastSeen: number;
  samples?: Array<[number, number]>;
}

interface HubSourceMessage {
  id: number; name: string; programKey: string; processId?: number; sdkName?: string;
  active: boolean; receivedPackets: number; missingPackets: number; channels: HubChannelMessage[];
}

interface HubStats { sampleRate: number; memoryBytes: number; nowSeconds: number }
interface ChannelBuffer { definition: ChannelDefinition; samples: Array<[number, number]> }
interface HubRuntime {
  definition: HubDefinition;
  socket: WebSocket | null;
  sources: Set<number>;
  stats: HubStats;
  clockAnchor: { hubSeconds: number; localMilliseconds: number };
}
interface ClientStore {
  sources: SourceDefinition[];
  channels: Map<string, ChannelBuffer>;
  hubs: Map<string, HubRuntime>;
  localSourceIds: Map<string, number>;
  nextSourceId: number;
}

const HUBS_KEY = 'debugscope.hubs.v1';
const MAX_ALIGNED_TIMESTAMPS = 12_000;
const CLIENT_HISTORY_SECONDS = 60;

export interface HubTelemetryOptions {
  enabled: boolean;
  defaultAddress: string;
  persistManualHubs?: boolean;
}

export function normalizeHubAddress(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) {
    candidate = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${candidate}`;
  }
  try {
    const url = new URL(candidate);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:' || !url.hostname) return null;
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname === '/' || url.pathname === '' ? '/api/ws' : url.pathname;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function initialManualHubAddresses(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(HUBS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(stored)) return [];
    return [...new Set(stored.flatMap((value) => {
      if (typeof value !== 'string') return [];
      const normalized = normalizeHubAddress(value);
      return normalized ? [normalized] : [];
    }))];
  } catch {
    return [];
  }
}

function channelId(sourceId: number, key: string): string { return `${sourceId}:${key}`; }

function localSourceId(store: ClientStore, hubId: string, remoteId: number): number {
  const key = `${hubId}\u0000${remoteId}`;
  const existing = store.localSourceIds.get(key);
  if (existing !== undefined) return existing;
  const created = store.nextSourceId++;
  store.localSourceIds.set(key, created);
  return created;
}

function upsertChannel(store: ClientStore, channel: HubChannelMessage, sourceId: number): ChannelBuffer {
  const id = channelId(sourceId, channel.key);
  const existing = store.channels.get(id);
  if (existing) {
    existing.definition = {
      ...existing.definition,
      description: channel.valueType,
      valueType: channel.valueType,
      lastValue: channel.lastValue,
      lastSeen: channel.lastSeen,
    };
    return existing;
  }
  const usedColorCount = [...store.channels.values()].filter(
    (candidate) => candidate.definition.sourceId === sourceId,
  ).length;
  const color = TRACE_COLORS[usedColorCount % TRACE_COLORS.length]
    ?? colorForChannel(sourceId, channel.key);
  const created: ChannelBuffer = {
    definition: {
      id, sourceId, key: channel.key, label: labelForKey(channel.key), color,
      lineCurve: 'linear', linePattern: 'solid', lineWidth: 2, unit: '',
      description: channel.valueType, valueType: channel.valueType,
      lastValue: channel.lastValue, lastSeen: channel.lastSeen,
    },
    samples: [],
  };
  store.channels.set(id, created);
  return created;
}

export function useHubTelemetry({
  enabled,
  defaultAddress,
  persistManualHubs = true,
}: HubTelemetryOptions): TelemetryController {
  const [manualAddresses, setManualAddresses] = useState<string[]>(
    persistManualHubs ? initialManualHubAddresses : [],
  );
  const addresses = useMemo(
    () => [defaultAddress, ...manualAddresses.filter((address) => address !== defaultAddress)],
    [defaultAddress, manualAddresses],
  );
  const storeRef = useRef<ClientStore>({
    sources: [], channels: new Map(), hubs: new Map(), localSourceIds: new Map(), nextSourceId: 1,
  });
  const latestSampleTimeRef = useRef(0);
  const [connection, setConnection] = useState<ConnectionState>(enabled ? 'connecting' : 'disconnected');
  const [sources, setSources] = useState<SourceDefinition[]>([]);
  const [activeSourceId, setActiveSourceIdState] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [hubVersion, setHubVersion] = useState(0);
  const publish = useCallback(() => setVersion((current) => current + 1), []);
  const publishHubs = useCallback(() => setHubVersion((current) => current + 1), []);

  useEffect(() => {
    if (persistManualHubs) localStorage.setItem(HUBS_KEY, JSON.stringify(manualAddresses));
  }, [manualAddresses, persistManualHubs]);

  useEffect(() => {
    if (!enabled) { setConnection('disconnected'); return; }
    let stopped = false;
    const reconnectTimers = new Map<string, number>();
    const reconnectDelays = new Map<string, number>();
    const store = storeRef.current;

    const updateAggregateConnection = () => {
      const states = [...store.hubs.values()].map((hub) => hub.definition.connection);
      if (states.includes('connected')) setConnection('connected');
      else if (states.includes('reconnecting')) setConnection('reconnecting');
      else if (states.includes('connecting')) setConnection('connecting');
      else setConnection('disconnected');
      publishHubs();
    };
    const publishSources = () => {
      setSources([...store.sources]);
      const validIds = new Set(store.sources.map((source) => source.id));
      setActiveSourceIdState((current) => (
        current !== null && validIds.has(current) ? current : (store.sources[0]?.id ?? null)
      ));
    };
    const applyStats = (hub: HubRuntime, next: Partial<HubStats> | undefined) => {
      if (!next) return;
      hub.stats = {
        sampleRate: next.sampleRate ?? hub.stats.sampleRate,
        memoryBytes: next.memoryBytes ?? hub.stats.memoryBytes,
        nowSeconds: next.nowSeconds ?? hub.stats.nowSeconds,
      };
      if (typeof next.nowSeconds === 'number' && Number.isFinite(next.nowSeconds)) {
        hub.clockAnchor = { hubSeconds: next.nowSeconds, localMilliseconds: performance.now() };
      }
    };
    const applyCatalog = (hub: HubRuntime, catalog: HubSourceMessage[]) => {
      const previousIds = hub.sources;
      const nextIds = new Set<number>();
      const otherSources = store.sources.filter((source) => source.hubId !== hub.definition.id);
      const hubSources = catalog.map((source) => {
        const id = localSourceId(store, hub.definition.id, source.id);
        nextIds.add(id);
        for (const channel of source.channels) upsertChannel(store, channel, id);
        return {
          id, remoteId: source.id, hubId: hub.definition.id, hubAddress: hub.definition.address,
          name: source.name, programKey: `${hub.definition.id}:${source.programKey}`,
          processId: source.processId, sdkName: source.sdkName, active: source.active,
          receivedPackets: source.receivedPackets, missingPackets: source.missingPackets,
          channelCount: source.channels.length,
        } satisfies SourceDefinition;
      });
      for (const id of previousIds) {
        if (nextIds.has(id)) continue;
        for (const [channelKey, channel] of store.channels) {
          if (channel.definition.sourceId === id) store.channels.delete(channelKey);
        }
      }
      hub.sources = nextIds;
      store.sources = [...otherSources, ...hubSources];
      publishSources();
    };

    const connect = (hub: HubRuntime) => {
      if (stopped || !store.hubs.has(hub.definition.id)) return;
      hub.definition.connection = hub.socket ? 'reconnecting' : 'connecting';
      updateAggregateConnection();
      const socket = new WebSocket(hub.definition.address);
      hub.socket = socket;
      socket.addEventListener('open', () => {
        if (stopped) return;
        reconnectDelays.set(hub.definition.id, 350);
        hub.definition.connection = 'connected';
        updateAggregateConnection();
      });
      socket.addEventListener('message', (event) => {
        if (stopped || typeof event.data !== 'string') return;
        let message: {
          type?: string; sources?: HubSourceMessage[]; channels?: HubChannelMessage[];
          batches?: Array<HubChannelMessage & { samples: Array<[number, number]> }>;
          stats?: Partial<HubStats>;
        };
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'snapshot') {
          for (const sourceId of hub.sources) {
            for (const [id, channel] of store.channels) {
              if (channel.definition.sourceId === sourceId) store.channels.delete(id);
            }
          }
          applyCatalog(hub, message.sources ?? []);
          for (const channel of message.channels ?? []) {
            const sourceId = localSourceId(store, hub.definition.id, channel.sourceId);
            const stored = upsertChannel(store, channel, sourceId);
            stored.samples = channel.samples ?? [];
          }
          applyStats(hub, message.stats); publish(); return;
        }
        if (message.type === 'catalog') {
          applyCatalog(hub, message.sources ?? []); applyStats(hub, message.stats); publish(); return;
        }
        if (message.type === 'samples') {
          for (const batch of message.batches ?? []) {
            const sourceId = localSourceId(store, hub.definition.id, batch.sourceId);
            let channel = store.channels.get(channelId(sourceId, batch.key));
            if (!channel) {
              channel = upsertChannel(store, {
                ...batch,
                lastValue: batch.samples.at(-1)?.[1] ?? 0,
                lastSeen: batch.samples.at(-1)?.[0] ?? 0,
              }, sourceId);
            }
            channel.samples.push(...batch.samples);
            const latest = batch.samples.at(-1);
            if (latest) {
              channel.definition.lastSeen = latest[0]; channel.definition.lastValue = latest[1];
              const cutoff = latest[0] - CLIENT_HISTORY_SECONDS;
              let removeCount = 0;
              while (removeCount < channel.samples.length && channel.samples[removeCount][0] < cutoff) removeCount++;
              if (removeCount > 0) channel.samples.splice(0, removeCount);
            }
          }
          applyStats(hub, message.stats); publish(); return;
        }
        if (message.type === 'cleared') {
          for (const sourceId of hub.sources) for (const channel of store.channels.values()) {
            if (channel.definition.sourceId === sourceId) channel.samples = [];
          }
          publish();
        }
      });
      socket.addEventListener('close', () => {
        if (hub.socket === socket) hub.socket = null;
        if (stopped || !store.hubs.has(hub.definition.id)) return;
        hub.definition.connection = 'reconnecting'; updateAggregateConnection();
        const delay = reconnectDelays.get(hub.definition.id) ?? 350;
        reconnectTimers.set(hub.definition.id, window.setTimeout(() => connect(hub), delay));
        reconnectDelays.set(hub.definition.id, Math.min(delay * 1.7, 5_000));
      });
      socket.addEventListener('error', () => socket.close());
    };

    store.hubs.clear();
    for (const address of addresses) {
      const hub: HubRuntime = {
        definition: { id: address, address, connection: 'connecting', removable: address !== defaultAddress },
        socket: null, sources: new Set(), stats: { sampleRate: 0, memoryBytes: 0, nowSeconds: 0 },
        clockAnchor: { hubSeconds: 0, localMilliseconds: performance.now() },
      };
      store.hubs.set(address, hub); connect(hub);
    }
    return () => {
      stopped = true;
      for (const timer of reconnectTimers.values()) window.clearTimeout(timer);
      for (const hub of store.hubs.values()) hub.socket?.close();
    };
  }, [addresses, defaultAddress, enabled, publish, publishHubs]);

  const activeChannels = useMemo(() => {
    if (activeSourceId === null) return [];
    return [...storeRef.current.channels.values()]
      .filter((channel) => channel.definition.sourceId === activeSourceId)
      .sort((left, right) => left.definition.key.localeCompare(right.definition.key));
  }, [activeSourceId, version]);
  const aligned = useMemo(() => {
    const timestampSet = new Set<number>();
    for (const channel of activeChannels) for (const [timestamp] of channel.samples) timestampSet.add(timestamp);
    let timestamps = [...timestampSet].sort((left, right) => left - right);
    if (timestamps.length > MAX_ALIGNED_TIMESTAMPS) timestamps = timestamps.slice(-MAX_ALIGNED_TIMESTAMPS);
    const indexes = new Map(timestamps.map((timestamp, index) => [timestamp, index]));
    const series: Array<Array<number | null>> = activeChannels.map(() => Array(timestamps.length).fill(null));
    activeChannels.forEach((channel, channelIndex) => {
      for (const [timestamp, value] of channel.samples) {
        const index = indexes.get(timestamp); if (index !== undefined) series[channelIndex][index] = value;
      }
    });
    const latestTime = timestamps.at(-1) ?? 0;
    latestSampleTimeRef.current = latestTime;
    return {
      data: [timestamps, ...series] as TelemetryData,
      latest: activeChannels.map((channel) => channel.definition.lastValue ?? 0), latestTime,
    };
  }, [activeChannels]);

  const totals = [...storeRef.current.hubs.values()].reduce((sum, hub) => ({
    sampleRate: sum.sampleRate + hub.stats.sampleRate,
    memoryBytes: sum.memoryBytes + hub.stats.memoryBytes,
  }), { sampleRate: 0, memoryBytes: 0 });
  const clear = useCallback(() => {
    if (activeSourceId === null) return;
    for (const channel of storeRef.current.channels.values()) {
      if (channel.definition.sourceId === activeSourceId) channel.samples = [];
    }
    const source = storeRef.current.sources.find((candidate) => candidate.id === activeSourceId);
    if (source?.hubId) storeRef.current.hubs.get(source.hubId)?.socket?.send(JSON.stringify({ type: 'clear' }));
    publish();
  }, [activeSourceId, publish]);
  const now = useCallback(() => {
    if (activeSourceId === null) return latestSampleTimeRef.current;
    const source = storeRef.current.sources.find((candidate) => candidate.id === activeSourceId);
    const hub = source?.hubId ? storeRef.current.hubs.get(source.hubId) : undefined;
    if (!hub || hub.clockAnchor.hubSeconds <= 0) return latestSampleTimeRef.current;
    return hub.clockAnchor.hubSeconds + (performance.now() - hub.clockAnchor.localMilliseconds) / 1_000;
  }, [activeSourceId]);
  const deleteSource = useCallback((sourceId: number) => {
    const source = storeRef.current.sources.find((candidate) => candidate.id === sourceId);
    if (!source?.hubId || source.remoteId === undefined) return;
    storeRef.current.hubs.get(source.hubId)?.socket?.send(JSON.stringify({
      type: 'deleteSource', sourceId: source.remoteId,
    }));
  }, []);
  const addHub = useCallback((address: string) => {
    const normalized = normalizeHubAddress(address);
    if (!normalized || normalized === defaultAddress || manualAddresses.includes(normalized)) return false;
    setManualAddresses((current) => [...current, normalized]); return true;
  }, [defaultAddress, manualAddresses]);
  const removeHub = useCallback((hubId: string) => {
    if (hubId === defaultAddress) return;
    setManualAddresses((current) => current.filter((address) => address !== hubId));
    const store = storeRef.current;
    const removed = new Set(store.sources.filter((source) => source.hubId === hubId).map((source) => source.id));
    store.sources = store.sources.filter((source) => source.hubId !== hubId);
    for (const [id, channel] of store.channels) if (removed.has(channel.definition.sourceId)) store.channels.delete(id);
    setSources([...store.sources]); publish();
  }, [defaultAddress, publish]);
  const hubs = useMemo(
    () => [...storeRef.current.hubs.values()].map((hub) => ({ ...hub.definition })), [hubVersion],
  );

  return {
    mode: 'live', connection, sources, activeSourceId, setActiveSourceId: setActiveSourceIdState,
    channels: activeChannels.map((channel) => channel.definition), data: aligned.data,
    latest: aligned.latest, latestTime: aligned.latestTime, version,
    sampleRate: totals.sampleRate, memoryBytes: totals.memoryBytes, now, clear, deleteSource,
    hubs, addHub, removeHub,
  };
}
