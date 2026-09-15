import { useEffect, useRef, useState } from 'react';
import { Circle, Square, X } from 'lucide-react';
import { FloatingPanel } from './FloatingPanel';

// Region Capture is not yet included in TypeScript's DOM declarations.
type CropTrack = MediaStreamTrack & { cropTo(target: unknown): Promise<void> };
type CaptureWindow = Window & { CropTarget?: { fromElement(element: Element): Promise<unknown> } };
type Session = { stream: MediaStream; recorder?: MediaRecorder };

function stopSession(session: Session | null) {
  if (session?.recorder && session.recorder.state !== 'inactive') session.recorder.stop();
  session?.stream.getTracks().forEach(track => track.stop());
}

function saveVideo(chunks: Blob[], mimeType: string, title: string) {
  const blob = new Blob(chunks, { type: mimeType });
  if (!blob.size) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const name = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'panel';
  link.download = `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Records the composited panel pixels, including DOM, canvas and WebGL. */
export function PanelRecording({ title }: { title: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const session = useRef<Session | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'saving'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopSession(session.current);
    };
  }, []);

  useEffect(() => {
    if (state !== 'recording') return;
    const start = performance.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((performance.now() - start) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [state]);

  async function start() {
    if (pending.current || session.current) return;
    const crop = (window as CaptureWindow).CropTarget;
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder || !crop) {
      setError('Panel recording requires a browser with Region Capture support (desktop Chrome or Edge), on localhost or HTTPS.');
      return;
    }
    const panel = button.current?.closest('[data-panel-id]');
    if (!panel) return;
    pending.current = true;
    setState('starting');
    setError('');
    let current: Session | null = null;
    try {
      // Invoke the chooser directly within the click's transient activation.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
      } as DisplayMediaStreamOptions);
      current = { stream };
      if (!mounted.current) { stopSession(current); return; }
      session.current = current;
      const track = stream.getVideoTracks()[0] as CropTrack | undefined;
      if (!track?.cropTo) throw new Error('Select this DebugScope browser tab to record a panel.');
      try {
        await track.cropTo(await crop.fromElement(panel));
      } catch {
        throw new Error('Could not capture this panel. Select the current DebugScope tab, then try again.');
      }
      if (!mounted.current) { stopSession(current); return; }
      if (track.readyState === 'ended') throw new Error('Screen sharing ended before recording started.');
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
        .find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('This browser does not support a video recording format.');
      const recorder = new MediaRecorder(stream, { mimeType });
      current.recorder = recorder;
      const recording = current;
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder.ondataavailable = event => {
        if (event.data.size) { chunks.push(event.data); bytes += event.data.size; }
        // Bound in-memory buffering; retain and download everything recorded so far.
        if (bytes >= 256 * 1024 * 1024 && recorder.state !== 'inactive') {
          if (mounted.current) setError('Recording reached 256 MB and was saved automatically. Start again to continue.');
          stopSession(recording);
        }
      };
      recorder.onstop = () => {
        stopSession(recording);
        saveVideo(chunks, recorder.mimeType, title);
        if (session.current === recording) session.current = null;
        if (mounted.current) setState('idle');
      };
      recorder.onerror = () => {
        if (mounted.current) setError('Recording was interrupted. Any available video has been saved.');
        stopSession(recording);
      };
      track.addEventListener('ended', () => stopSession(recording), { once: true });
      recorder.start(1000);
      setState('recording');
    } catch (cause) {
      stopSession(current);
      session.current = null;
      if (mounted.current) {
        setState('idle');
        if (!(cause instanceof DOMException && cause.name === 'NotAllowedError')) {
          setError(cause instanceof Error ? cause.message : 'Could not start recording. Please try again.');
        }
      }
    } finally {
      pending.current = false;
    }
  }

  const recording = state === 'recording';
  return <>
    <button ref={button} type="button" className={`scope-action panel-recording${recording ? ' recording' : ''}`}
      aria-label={`${recording ? 'Stop recording' : 'Record'} ${title}`}
      aria-pressed={recording} disabled={state === 'starting' || state === 'saving'}
      title={recording ? 'Stop recording and download video' : 'Record panel video — select this tab when prompted'}
      onClick={() => {
        if (recording) { setState('saving'); stopSession(session.current); }
        else void start();
      }}>
      {recording ? <Square size={12} fill="currentColor" /> : <Circle size={13} />}
      {recording && <span className="recording-time">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>}
      {state === 'starting' && <span>…</span>}
    </button>
    {error && <FloatingPanel className="recording-message" label={`Recording ${title}`} width={340}
      anchor={() => button.current} onClose={() => setError('')}>
      <span role="alert">{error}</span>
      <button type="button" className="scope-action" aria-label="Dismiss recording message" onClick={() => setError('')}><X size={14} /></button>
    </FloatingPanel>}
  </>;
}
