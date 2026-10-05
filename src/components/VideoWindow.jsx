import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { startFromFilename, formatStart, parseStart, syncStep } from '../lib/videoSync.js';
import { equipmentLayout } from '../lib/itsLayout.js';
import PlaybackBar from './PlaybackBar.jsx';
import { ResizeGrip, startPipDrag, rectStyle } from './Pip.jsx';

// The 3D view from a CCTV loads only when it is asked for.
const CctvView = lazy(() => import('../three/CctvView.jsx'));

const STARTS_KEY = 'intersectionMix:videoStarts:v1';
const VIEWS = { video: 'Video', '3d': 'CCTV 3D', split: 'Side by side', overlay: 'Overlay' };

function rememberedStart(file) {
  try {
    const all = JSON.parse(localStorage.getItem(STARTS_KEY) || '{}');
    const v = all[`${file.name}:${file.size}`];
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function rememberStart(file, ms) {
  try {
    const all = JSON.parse(localStorage.getItem(STARTS_KEY) || '{}');
    all[`${file.name}:${file.size}`] = ms;
    localStorage.setItem(STARTS_KEY, JSON.stringify(all));
  } catch {
    // a per-viewer convenience
  }
}

/** The rect, inside a box, that a video of this aspect fills when letterboxed (object-fit: contain). */
function letterbox(boxW, boxH, aspect) {
  if (!boxW || !boxH || !aspect) return null;
  let w = boxW;
  let h = w / aspect;
  if (h > boxH) {
    h = boxH;
    w = h * aspect;
  }
  return { left: (boxW - w) / 2, top: (boxH - h) / 2, width: w, height: h };
}

/**
 * Video playback: a local video, kept in step with signal playback by its
 * start time, in a window that floats over the plan or swaps places with it.
 * Beside or over the video, the intersection in 3D from the CCTV camera it
 * was recorded on, with the lamps following playback.
 */
export default function VideoWindow({
  design, geom, planSvg, store, equipment, updateDesign, say, role, rect, areaRef, onRect, onSwap,
}) {
  const [file, setFile] = useState(null); // { url, name, size }
  const [startMs, setStartMs] = useState(null);
  const [startText, setStartText] = useState('');
  const [view, setView] = useState('video');
  const [cctvId, setCctvId] = useState('');
  const [opacity, setOpacity] = useState(0.5);
  const [aspect, setAspect] = useState(16 / 9);
  const [status, setStatus] = useState({ time: null, outside: null });
  const [collapsed, setCollapsed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [box, setBox] = useState(null);
  const videoRef = useRef(null);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const sync = useRef({ lastStep: -Infinity, lastUi: 0 });

  const synced = !!(store && store.controls && startMs != null);
  const layout = useMemo(() => (equipment ? equipmentLayout(design, geom) : null), [equipment, design, geom]);
  const cctvs = layout ? layout.cctv : [];
  const cctv = cctvs.find((c) => c.cctv.id === cctvId) || cctvs[0] || null;
  const show3d = view !== 'video' && cctv;

  // Release the file when it changes or the window goes.
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);

  const open = (list) => {
    const f = [...(list || [])].find((x) => x.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(x.name));
    if (!f) {
      say('Choose a video file (.mp4, .mov, .webm).', 'warn');
      return;
    }
    setFile({ url: URL.createObjectURL(f), name: f.name, size: f.size });
    const start = rememberedStart(f) ?? startFromFilename(f.name) ?? (store && store.clock ? store.clock.start : null);
    setStartMs(start);
    setStartText(start != null ? formatStart(start) : '');
    setCollapsed(false);
    if (start == null) say('Set the video’s start time to line it up with the signal data.', 'info', 7000);
  };

  const commitStart = (ms) => {
    setStartMs(ms);
    setStartText(ms != null ? formatStart(ms) : '');
    if (ms != null && file) rememberStart(file, ms);
  };

  // Follow the data clock.
  useEffect(() => {
    if (!store) return undefined;
    return store.onFrame((clock) => {
      const v = videoRef.current;
      if (!v || !file || startMs == null || Number.isNaN(v.duration)) return; // Infinity: a recording with no duration yet; still follow
      const now = performance.now();
      const a = syncStep({
        clock, startMs, video: { time: v.currentTime, duration: v.duration, paused: v.paused }, now, lastStep: sync.current.lastStep,
      });
      if (a.rate && v.playbackRate !== a.rate) v.playbackRate = a.rate;
      if (a.seekTo != null) {
        sync.current.lastStep = now;
        if (typeof v.fastSeek === 'function' && clock.playing && clock.speed > 16) v.fastSeek(a.seekTo);
        else v.currentTime = a.seekTo;
      }
      if (a.play) v.play().catch(() => {});
      if (a.pause) v.pause();
      if (now - sync.current.lastUi > 150) {
        sync.current.lastUi = now;
        setStatus({ time: startMs + v.currentTime * 1000, outside: a.outside });
      }
    });
  }, [store, file, startMs]);

  // Without signal data the video runs itself; still show its wall-clock time.
  const onTimeUpdate = () => {
    if (synced || startMs == null || !videoRef.current) return;
    setStatus({ time: startMs + videoRef.current.currentTime * 1000, outside: null });
  };

  // Where the letterboxed picture sits, for the overlay.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const measure = () => setBox(letterbox(el.clientWidth, el.clientHeight, aspect));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [aspect, view, file]);

  const nudgeCctv = (key, delta) => {
    if (!cctv) return;
    updateDesign((d) => {
      const c = d.its.cctv.find((x) => x.id === cctv.cctv.id);
      if (!c) return;
      if (key === 'heading') c.heading = (((c.heading + delta) % 360) + 360) % 360;
      if (key === 'tilt') c.tilt = Math.max(-89, Math.min(30, Math.round((c.tilt + delta) * 10) / 10));
      if (key === 'fov') c.fov = Math.max(10, Math.min(120, c.fov + delta));
      if (key === 'height') c.height = Math.max(3, c.height + delta);
    }, { key: `cctvpose:${cctv.cctv.id}:${key}` });
  };

  const pip = role === 'pip';
  const drag = (e, mode) => startPipDrag(e, mode, rect, areaRef.current, onRect);
  const cctvView = show3d && (
    <Suspense fallback={<div className="cctv-view"><div className="cctv-status">Loading 3D…</div></div>}>
      <CctvView design={design} geom={geom} planSvg={planSvg} pin={cctv.pin} store={store} />
    </Suspense>
  );

  return (
    <section className={`video-window ${pip ? 'pip' : 'main'}${collapsed && pip ? ' collapsed' : ''}${dragOver ? ' drag' : ''}`}
      style={pip ? rectStyle(collapsed ? { ...rect, h: 40 } : rect) : undefined} aria-label="Video playback"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); open(e.dataTransfer.files); }}>
      <header className="video-head" onPointerDown={pip ? (e) => drag(e, 'move') : undefined}>
        <strong className="video-title" title={file ? file.name : ''}>{file ? file.name : 'Video'}</strong>
        {file && cctvs.length > 0 && (
          <select value={view} onChange={(e) => setView(e.target.value)} aria-label="View">
            {Object.entries(VIEWS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        )}
        {file && cctvs.length > 1 && view !== 'video' && (
          <select value={cctv ? cctv.cctv.id : ''} onChange={(e) => setCctvId(e.target.value)} aria-label="CCTV camera">
            {cctvs.map((c) => <option key={c.cctv.id} value={c.cctv.id}>{c.cctv.name}</option>)}
          </select>
        )}
        <span className="spacer" />
        {file && document.pictureInPictureEnabled && (
          <button type="button" className="icon" title="Pop the video out (browser picture-in-picture)" aria-label="Pop out"
            onClick={() => videoRef.current && videoRef.current.requestPictureInPicture().catch(() => {})}>⧉</button>
        )}
        <button type="button" className="icon" onClick={onSwap} title={pip ? 'Make the video the main view' : 'Put the video back in the small window'}
          aria-label="Swap with the plan">⇄</button>
        {pip && (
          <button type="button" className="icon" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? 'Expand' : 'Collapse'}
            title={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? '▢' : '▁'}</button>
        )}
      </header>

      <div className={`video-body view-${show3d ? view : 'video'}`} ref={bodyRef}>
        {!file && (
          <div className="video-empty">
            <button type="button" className="primary" onClick={() => fileRef.current.click()}>Open video…</button>
            <span className="muted small">or drop a video here. It plays from your disk; nothing is uploaded.</span>
            {!equipment && <span className="muted small">Turn on ITS &amp; equipment and add a CCTV camera for a matching 3D view.</span>}
            {equipment && !cctvs.length && <span className="muted small">Add a CCTV camera (Intersection › ITS &amp; equipment) for a matching 3D view.</span>}
          </div>
        )}
        {file && (
          <div className="video-pane">
            <video ref={videoRef} src={file.url} muted playsInline controls={!synced}
              onLoadedMetadata={(e) => setAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight || 16 / 9)}
              onTimeUpdate={onTimeUpdate} />
            {synced && status.outside && (
              <div className="video-outside">{status.outside === 'before' ? 'Before the video starts' : 'After the video ends'}</div>
            )}
            {view === 'overlay' && show3d && box && (
              <div className="cctv-overlay" style={{ ...box, opacity }}>{cctvView}</div>
            )}
          </div>
        )}
        {file && show3d && view !== 'overlay' && <div className="cctv-pane">{cctvView}</div>}
        <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => { open(e.target.files); e.target.value = ''; }} />
      </div>

      {file && (
        <footer className="video-foot">
          {store && store.controls && <PlaybackBar store={store} />}
          <label className="video-start">
            Starts at
            <input type="text" value={startText} placeholder="M/D/YYYY HH:mm:ss.s" onChange={(e) => setStartText(e.target.value)}
              onBlur={() => commitStart(parseStart(startText))}
              onKeyDown={(e) => { if (e.key === 'Enter') commitStart(parseStart(startText)); }} />
          </label>
          <span className="video-nudge" role="group" aria-label="Shift the video">
            {[-1, -0.1, 0.1, 1].map((s) => (
              <button key={s} type="button" disabled={startMs == null} onClick={() => commitStart(startMs + s * 1000)}
                title={`Shift the video ${s > 0 ? 'later' : 'earlier'} by ${Math.abs(s)} s`}>{s > 0 ? `+${s}` : s}s</button>
            ))}
          </span>
          {store && store.clock && (
            <button type="button" title="Make the frame on screen line up with the signal data's time"
              onClick={() => videoRef.current && commitStart(store.clock.t - videoRef.current.currentTime * 1000)}>Sync to playhead</button>
          )}
          {status.time != null && <span className="muted small video-clock">Frame: {formatStart(status.time)}</span>}
          {view === 'overlay' && cctv && (
            <span className="video-align" role="group" aria-label="Line up the CCTV view">
              <label>Overlay <input type="range" min="0.1" max="0.9" step="0.05" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} /></label>
              <button type="button" onClick={() => nudgeCctv('heading', -1)} title="Turn left">⟲</button>
              <button type="button" onClick={() => nudgeCctv('heading', 1)} title="Turn right">⟳</button>
              <button type="button" onClick={() => nudgeCctv('tilt', 0.5)} title="Tilt up">▲</button>
              <button type="button" onClick={() => nudgeCctv('tilt', -0.5)} title="Tilt down">▼</button>
              <button type="button" onClick={() => nudgeCctv('fov', -1)} title="Zoom in">＋</button>
              <button type="button" onClick={() => nudgeCctv('fov', 1)} title="Zoom out">－</button>
              <span className="muted small">{Math.round(cctv.cctv.heading)}° · tilt {cctv.cctv.tilt}° · FOV {cctv.cctv.fov}°</span>
            </span>
          )}
          <button type="button" className="small" onClick={() => fileRef.current.click()}>Open…</button>
          <button type="button" className="small" onClick={() => { setFile(null); setStatus({ time: null, outside: null }); }}>Close video</button>
        </footer>
      )}
      {pip && !collapsed && <ResizeGrip onPointerDown={(e) => drag(e, 'resize')} />}
    </section>
  );
}
