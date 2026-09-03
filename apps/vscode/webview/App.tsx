import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Pause, Play, RotateCcw, Waves } from 'lucide-react';
import {
  prepareTimeline,
  useHubTelemetry,
  WaveformPlot,
  type ThemeMode,
} from '@debugscope/ui-core';
import { vscode } from './vscode';

const HISTORY_WINDOWS = [5, 10, 30] as const;

function currentTheme(): ThemeMode {
  return document.body.classList.contains('vscode-light') ? 'light' : 'dark';
}

export default function App() {
  const previewHubUrl = new URLSearchParams(window.location.search).get('hub');
  const hubUrl = previewHubUrl
    ?? document.body.dataset.hubUrl
    ?? 'ws://127.0.0.1:4712/api/ws';
  const telemetry = useHubTelemetry({
    enabled: true,
    defaultAddress: hubUrl,
    persistManualHubs: false,
  });
  const [theme, setTheme] = useState<ThemeMode>(currentTheme);
  const [visibleChannelIds, setVisibleChannelIds] = useState<Set<string>>(new Set());
  const [selectionSourceId, setSelectionSourceId] = useState<number | null>(null);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [windowSeconds, setWindowSeconds] = useState<number>(10);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [hubError, setHubError] = useState('');

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.body, { attributeFilter: ['class'], attributes: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<{ type?: string; detail?: string }>) => {
      if (event.data.type === 'hubReady') setHubError('');
      if (event.data.type === 'hubError') setHubError(event.data.detail ?? 'Hub failed to start');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (
      telemetry.activeSourceId === null
      || telemetry.activeSourceId === selectionSourceId
      || telemetry.channels.length === 0
    ) return;
    const initial = telemetry.channels.slice(0, 4).map((channel) => channel.id);
    setVisibleChannelIds(new Set(initial));
    setSelectedChannel(initial[0] ?? '');
    setSelectionSourceId(telemetry.activeSourceId);
    setPausedAt(null);
  }, [selectionSourceId, telemetry.activeSourceId, telemetry.channels]);

  const timeline = useMemo(
    () => prepareTimeline(telemetry.data, false),
    [telemetry.data],
  );
  const visibleChannels = useMemo(
    () => new Set(
      telemetry.channels
        .filter((channel) => visibleChannelIds.has(channel.id))
        .map((channel) => channel.id),
    ),
    [telemetry.channels, visibleChannelIds],
  );
  const activeSource = telemetry.sources.find((source) => source.id === telemetry.activeSourceId);
  const isPaused = pausedAt !== null;
  const connected = telemetry.connection === 'connected';
  const getViewTime = useCallback(
    () => timeline.latestTime || telemetry.now(),
    [telemetry.now, timeline.latestTime],
  );

  const toggleChannel = (channelId: string) => {
    setVisibleChannelIds((current) => {
      const next = new Set(current);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
    if (!visibleChannelIds.has(channelId)) setSelectedChannel(channelId);
    else if (selectedChannel === channelId) {
      setSelectedChannel([...visibleChannelIds].find((id) => id !== channelId) ?? '');
    }
  };

  const togglePause = () => setPausedAt((current) => current === null ? getViewTime() : null);
  const showAllChannels = () => {
    const all = telemetry.channels.map((channel) => channel.id);
    setVisibleChannelIds(new Set(all));
    setSelectedChannel((current) => current || all[0] || '');
  };

  const statusLabel = hubError
    ? 'HUB ERROR'
    : isPaused
      ? 'PAUSED'
      : connected
        ? activeSource?.active ? 'LIVE' : 'IDLE'
        : telemetry.connection.toUpperCase();

  return (
    <main className="compact-scope">
      <header className="compact-toolbar">
        <span className={`connection-state ${connected ? 'connected' : ''} ${hubError ? 'error' : ''}`}>
          <i /> {statusLabel}
        </span>

        <label className="source-select">
          <span>Source</span>
          <select
            value={telemetry.activeSourceId ?? ''}
            onChange={(event) => telemetry.setActiveSourceId(Number(event.target.value))}
            disabled={telemetry.sources.length === 0}
            aria-label="Telemetry source"
          >
            {telemetry.sources.length === 0 && <option value="">Waiting for producer</option>}
            {telemetry.sources.map((source) => (
              <option value={source.id} key={source.id}>{source.name}</option>
            ))}
          </select>
        </label>

        <div className="toolbar-actions">
          <label className="window-select">
            <span>Window</span>
            <select
              value={windowSeconds}
              onChange={(event) => setWindowSeconds(Number(event.target.value))}
              aria-label="Visible history window"
            >
              {HISTORY_WINDOWS.map((seconds) => <option value={seconds} key={seconds}>{seconds} s</option>)}
            </select>
          </label>
          <button type="button" onClick={togglePause} title={isPaused ? 'Resume' : 'Pause'}>
            {isPaused ? <Play size={14} /> : <Pause size={14} />}
            <span>{isPaused ? 'Resume' : 'Pause'}</span>
          </button>
          <button type="button" onClick={() => telemetry.clear()} title="Clear history">
            <RotateCcw size={14} /><span>Clear</span>
          </button>
          <button type="button" onClick={() => vscode.postMessage({ type: 'openBrowser' })} title="Open in Browser">
            <ExternalLink size={14} /><span>Browser</span>
          </button>
        </div>
      </header>

      <section className="compact-plot" aria-label="Live waveform">
        <WaveformPlot
          channels={telemetry.channels}
          data={timeline.data}
          dataVersion={telemetry.version}
          visibleChannels={visibleChannels}
          selectedChannel={selectedChannel}
          windowSeconds={windowSeconds}
          pausedAt={pausedAt}
          yScaleMode="fit"
          theme={theme}
          scrollWhenIdle={false}
          getClockTime={getViewTime}
          onShowAllChannels={showAllChannels}
          onVisiblePointCount={() => {}}
          onRenderRate={() => {}}
          emptyTitle={telemetry.channels.length ? 'No visible channels' : 'Waiting for telemetry'}
          emptyMessage={telemetry.channels.length
            ? 'Enable a signal below to show it in this scope.'
            : hubError || 'Run an instrumented program; channels appear automatically.'}
          showEmptyAction={telemetry.channels.length > 0}
        />
      </section>

      <footer className="channel-strip" aria-label="Channels">
        {telemetry.channels.length === 0 ? (
          <span className="channel-placeholder"><Waves size={13} /> No channels discovered</span>
        ) : telemetry.channels.map((channel, index) => {
          const visible = visibleChannelIds.has(channel.id);
          const selected = selectedChannel === channel.id;
          return (
            <button
              className={`${visible ? 'visible' : ''}${selected ? ' selected' : ''}`}
              type="button"
              key={channel.id}
              role="checkbox"
              aria-checked={visible}
              onClick={() => toggleChannel(channel.id)}
              onDoubleClick={() => setSelectedChannel(channel.id)}
              style={{ '--trace': channel.color } as React.CSSProperties}
              title={`${channel.key}: ${telemetry.latest[index]?.toFixed(3) ?? '—'}`}
            >
              <i />
              <span>{channel.label}</span>
              <b>{telemetry.latest[index]?.toFixed(2) ?? '—'}</b>
            </button>
          );
        })}
      </footer>
    </main>
  );
}
