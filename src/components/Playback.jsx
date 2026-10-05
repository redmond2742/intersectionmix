import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  parseHiRes, mergeFiles, buildTimeline, stateAt, changeIndex, nextChange, previousChange, describeLog, lastAtOrBefore,
  formatTime,
} from '../lib/hires.js';
import { readZipText } from '../lib/zipReader.js';
import { SPEEDS } from '../lib/playbackClock.js';
import { allDetectors, comparePhases } from '../lib/model.js';
import { LAMP } from './PlaybackOverlay.jsx';

const SKIP_MS = 30000;
const WINDOW_MS = 120000; // the timeline strip shows two minutes around the playhead
const PUSH_MS = 40; // the plan redraws at most this often while playing
const UI_MS = 100; // the clock and scrubber update this often

const PED_COLORS = { walk: '#40c057', fdw: '#f76707' };

function isTyping(target) {
  return target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) && target.type !== 'range';
}

/** Rows for the timeline strip: phases, overlaps, peds, then detectors. */
function stripRows(tl) {
  const rows = [];
  Object.keys(tl.phases).sort(comparePhases).forEach((p) => rows.push({ label: `Ø${p}`, ch: tl.phases[p], kind: 'phase', h: 12 }));
  Object.keys(tl.overlaps).sort().forEach((p) => rows.push({ label: `OL ${p}`, ch: tl.overlaps[p], kind: 'phase', h: 12 }));
  Object.keys(tl.peds).sort(comparePhases).forEach((p) => rows.push({ label: `Ped ${p}`, ch: tl.peds[p], kind: 'ped', h: 10 }));
  Object.keys(tl.detectors).sort((a, b) => a - b).forEach((c) => rows.push({ label: `Det ${c}`, ch: tl.detectors[c], kind: 'det', h: 5 }));
  return rows;
}

const LABEL_W = 58;
const GAP = 2;
const GROUP_GAP = 6; // between the signal rows and the detector rows

/**
 * Signal playback: load high-resolution controller data, then play it on the
 * plan like a video. The snapshot at the playhead goes into `store`, which
 * the plan's playback layer reads.
 */
export default function Playback({ design, store, say, onLoaded }) {
  const [log, setLog] = useState(null); // { tl, meta, files }
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const canvasRef = useRef(null);
  const clock = useRef({ t: 0, playing: false, speed: 1, lastIndex: null, lastPush: 0, lastUi: 0, lastDraw: 0, dirty: true });
  const snap = useSyncExternalStore(store.subscribe, store.get);

  const tl = log ? log.tl : null;
  const rows = useMemo(() => (tl ? stripRows(tl) : []), [tl]);
  const channels = useMemo(() => allDetectors(design).map(({ det }) => String(det.channel)).filter(Boolean), [design]);
  const info = useMemo(() => (tl ? describeLog(tl, design, channels) : null), [tl, design, channels]);

  // Leaving playback clears the plan.
  useEffect(() => () => store.set(null), [store]);
  useEffect(() => { onLoaded(!!log); }, [log, onLoaded]);

  /* ---------------- Loading ---------------- */

  const load = async (fileList) => {
    const list = [...fileList];
    if (!list.length) return;
    setLoading(true);
    try {
      const texts = [];
      for (const file of list) {
        if (/\.zip$/i.test(file.name)) {
          const files = await readZipText(await file.arrayBuffer());
          Object.entries(files).filter(([name]) => /\.(csv|txt)$/i.test(name)).forEach(([name, text]) => texts.push({ name, text }));
        } else {
          texts.push({ name: file.name, text: await file.text() });
        }
      }
      const parsed = texts.map(({ text }) => parseHiRes(text)).filter((p) => p.events.length);
      if (!parsed.length) {
        say('No high-resolution events found. Expected lines like "9/17/2026 08:00:19.8, 8, 4".', 'warn', 9000);
        return;
      }
      const merged = mergeFiles(parsed);
      const timeline = buildTimeline(merged);
      const controllers = merged.controllers;
      setLog({ tl: timeline, controllers, files: parsed.length, events: merged.events.length });
      const c = clock.current;
      c.t = timeline.start;
      c.lastIndex = null;
      c.dirty = true;
      setTime(timeline.start);
      setPlaying(false);
      const signalId = String(design.signal && design.signal.id || '');
      if (controllers.length > 1) {
        say(`These files come from ${controllers.length} controllers (${controllers.join(', ')}); playing them together will mix them up.`, 'warn', 12000);
      } else if (controllers.length && signalId && controllers[0] !== signalId) {
        say(`The data is from controller ${controllers[0]}; this design is signal ${signalId}. Playing it anyway.`, 'warn', 9000);
      } else {
        say(`Loaded ${merged.events.length.toLocaleString()} events from ${parsed.length} file${parsed.length === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      say(`Could not read that data: ${err.message}`, 'warn', 9000);
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- Clock ---------------- */

  const seek = useCallback((t) => {
    if (!tl) return;
    const c = clock.current;
    c.t = Math.max(tl.start, Math.min(tl.end, t));
    c.dirty = true;
    setTime(c.t);
  }, [tl]);

  useEffect(() => {
    clock.current.playing = playing;
    clock.current.speed = speed;
    if (!playing) setTime(clock.current.t); // land the clock exactly where it stopped
  }, [playing, speed]);

  // Draws the two minutes around the playhead.
  const drawStrip = useCallback((t) => {
    const canvas = canvasRef.current;
    if (!canvas || !tl) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth;
    const firstDet = rows.find((r) => r.kind === 'det');
    const cssH = rows.reduce((h, r) => h + r.h + GAP, 0) + 14 + (firstDet ? GROUP_GAP : 0);
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.height = `${cssH}px`;
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    const t0 = t - WINDOW_MS / 2;
    const t1 = t + WINDOW_MS / 2;
    const plotW = cssW - LABEL_W;
    const xOf = (ms) => LABEL_W + ((ms - t0) / WINDOW_MS) * plotW;
    const blink = Math.floor(performance.now() / 500) % 2 === 0;

    // Gaps in the data.
    g.fillStyle = 'rgba(134,142,150,0.18)';
    for (const gap of tl.gaps) {
      if (gap.to < t0 || gap.from > t1) continue;
      g.fillRect(xOf(Math.max(gap.from, t0)), 0, xOf(Math.min(gap.to, t1)) - xOf(Math.max(gap.from, t0)), cssH - 14);
    }

    let y = 0;
    g.font = '600 10px Inter, system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (const row of rows) {
      const { ch } = row;
      if (row === firstDet) {
        y += GROUP_GAP;
        const dets = rows.filter((r) => r.kind === 'det').length;
        g.fillStyle = '#5b616a';
        g.fillText('Detectors', 2, y + (dets * (row.h + GAP)) / 2);
      }
      if (row.kind !== 'det') {
        g.fillStyle = '#5b616a';
        g.fillText(row.label, 2, y + row.h / 2 + 0.5);
      }
      // Walk the changes inside the window.
      let i = lastAtOrBefore(ch.t, t0);
      let from = t0;
      let state = i < 0 ? ch.first : ch.s[i];
      i += 1;
      const paint = (a, b, s) => {
        let color = null;
        if (row.kind === 'phase') color = LAMP[s] && s !== 'unknown' ? LAMP[s] : null;
        else if (row.kind === 'ped') color = s === 'fdw' && !blink ? '#ffc078' : PED_COLORS[s];
        else if (row.kind === 'det') color = s === 'on' ? '#1fb6cc' : null;
        if (!color) return;
        const from2 = Math.max(a, tl.start); // nothing is known outside the data
        const to2 = Math.min(b, tl.end);
        if (to2 <= from2) return;
        g.fillStyle = color;
        g.fillRect(xOf(from2), y, Math.max(0.6, xOf(to2) - xOf(from2)), row.h);
      };
      while (i < ch.t.length && ch.t[i] <= t1) {
        paint(from, ch.t[i], state);
        from = ch.t[i];
        state = ch.s[i];
        i += 1;
      }
      paint(from, t1, state);
      y += row.h + GAP;
    }

    // Seconds along the bottom, and the playhead.
    g.fillStyle = '#868e96';
    g.font = '10px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    const tick = plotW < 400 ? 30 : 15;
    for (let s = -60; s <= 60; s += tick) {
      const x = xOf(t + s * 1000);
      g.fillRect(x, y, 1, 3);
      g.fillText(s === 0 ? 'now' : `${s > 0 ? '+' : ''}${s}s`, Math.min(cssW - 12, Math.max(LABEL_W + 10, x)), y + 9);
    }
    g.textAlign = 'left';
    g.fillStyle = '#1f2328';
    g.fillRect(xOf(t) - 1, 0, 2, y);
  }, [tl, rows]);

  useEffect(() => {
    if (!tl) return undefined;
    let frame = 0;
    let last = performance.now();
    const loop = (now) => {
      frame = requestAnimationFrame(loop);
      const c = clock.current;
      const dt = Math.min(1000, now - last); // a background tab pauses, it doesn't leap
      last = now;
      if (c.playing) {
        c.t += dt * c.speed;
        // Skip straight across gaps in the data.
        const gap = tl.gaps.find((x) => c.t > x.from && c.t < x.to);
        if (gap) c.t = gap.to;
        if (c.t >= tl.end) {
          c.t = tl.end;
          c.playing = false;
          setPlaying(false);
        }
        c.dirty = true;
      }
      const index = changeIndex(tl, c.t);
      if ((index !== c.lastIndex || c.dirty || !store.get()) && (now - c.lastPush >= PUSH_MS || !c.playing)) {
        if (index !== c.lastIndex || !store.get()) store.set(stateAt(tl, c.t));
        c.lastIndex = index;
        c.lastPush = now;
      }
      store.frame({ t: c.t, playing: c.playing, speed: c.speed, start: tl.start, end: tl.end });
      // Paused, it still redraws now and then, to keep flashing don't walk flashing.
      if (c.dirty || c.playing || now - c.lastDraw > 250) {
        drawStrip(c.t);
        c.lastDraw = now;
      }
      if (c.playing && now - c.lastUi >= UI_MS) {
        c.lastUi = now;
        setTime(c.t);
      }
      c.dirty = false;
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [tl, store, drawStrip]);

  // Let the 3D views and the video window drive the player.
  useEffect(() => {
    if (!tl) return undefined;
    store.timeline = tl;
    store.controls = {
      seek: (t) => seek(t),
      setPlaying: (v) => {
        if (v === true && clock.current.t >= tl.end) seek(tl.start);
        setPlaying(v);
      },
      setSpeed,
    };
    return () => {
      store.controls = null;
      store.clock = null;
      store.timeline = null;
    };
  }, [tl, store, seek]);

  /* ---------------- Keys ---------------- */

  useEffect(() => {
    if (!tl) return undefined;
    const onKey = (e) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('.view3d')) return; // the 3D view has its own keys
      const c = clock.current;
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const forward = e.key === 'ArrowRight';
        if (e.shiftKey) {
          const to = forward ? nextChange(tl, c.t) : previousChange(tl, c.t);
          if (to != null) seek(to);
        } else seek(c.t + (forward ? 1000 : -1000));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tl, seek]);

  /* ---------------- UI ---------------- */

  const fileInput = (
    <input ref={fileRef} type="file" accept=".csv,.txt,.zip" multiple hidden
      onChange={(e) => { const files = e.target.files; load(files).then(() => { e.target.value = ''; }); }} />
  );
  const dropProps = {
    onDragOver: (e) => { e.preventDefault(); setDragOver(true); },
    onDragLeave: () => setDragOver(false),
    onDrop: (e) => { e.preventDefault(); setDragOver(false); load(e.dataTransfer.files); },
  };

  if (!tl) {
    return (
      <section className={`playback empty${dragOver ? ' drag' : ''}`} {...dropProps} aria-label="Signal playback">
        <div className="playback-head">
          <strong>Signal playback</strong>
          <span className="muted">Advanced</span>
        </div>
        <p className="muted small">
          Load high-resolution controller data: the Indiana event log, one CSV per controller-hour (or a .zip of them).
          Detectors are matched to the plan by channel. Data stays in this browser tab and is not saved.
        </p>
        <button type="button" className="primary" disabled={loading} onClick={() => fileRef.current.click()}>
          {loading ? 'Reading…' : 'Load hi-res data…'}
        </button>
        <span className="muted small"> or drop files here</span>
        {fileInput}
      </section>
    );
  }

  const active = snap ? [...snap.detectors].sort((a, b) => a - b) : [];
  const step = (to) => to != null && seek(to);
  const span = tl.end - tl.start;

  return (
    <section className={`playback${dragOver ? ' drag' : ''}`} {...dropProps} aria-label="Signal playback">
      <div className="playback-head">
        <strong>Signal playback</strong>
        <span className="playback-clock">{formatTime(time)}</span>
        <span className="muted small playback-source">
          {log.controllers.length ? `Controller ${log.controllers.join(', ')} · ` : ''}
          {log.events.toLocaleString()} events · {log.files} file{log.files === 1 ? '' : 's'}
        </span>
        <span className="spacer" />
        <button type="button" className="small" onClick={() => fileRef.current.click()} disabled={loading}>
          {loading ? 'Reading…' : 'Load…'}
        </button>
        <button type="button" className="small" onClick={() => { setLog(null); store.set(null); }}>Close data</button>
        {fileInput}
      </div>

      <div className="playback-transport">
        <button type="button" onClick={() => seek(clock.current.t - SKIP_MS)} title="Back 30 seconds" aria-label="Back 30 seconds">⏮ 30s</button>
        <button type="button" onClick={() => step(previousChange(tl, clock.current.t))} title="Previous change (Shift ←)" aria-label="Previous change">⏪</button>
        <button type="button" className="primary playback-play" onClick={() => {
          if (!playing && clock.current.t >= tl.end) seek(tl.start);
          setPlaying((p) => !p);
        }} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)">{playing ? '⏸' : '▶'}</button>
        <button type="button" onClick={() => step(nextChange(tl, clock.current.t))} title="Next change (Shift →)" aria-label="Next change">⏩</button>
        <button type="button" onClick={() => seek(clock.current.t + SKIP_MS)} title="Ahead 30 seconds" aria-label="Ahead 30 seconds">30s ⏭</button>
        <div className="segmented light playback-speed" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>
          ))}
        </div>
      </div>

      <div className="playback-scrub">
        <input type="range" min={tl.start} max={tl.end} step={100} value={time} aria-label="Playback time"
          onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }} />
        <div className="playback-gaps" aria-hidden="true">
          {span > 0 && tl.gaps.map((gap) => (
            <i key={gap.from} style={{ left: `${((gap.from - tl.start) / span) * 100}%`, width: `${Math.max(0.3, ((gap.to - gap.from) / span) * 100)}%` }} />
          ))}
        </div>
        <div className="playback-range muted small">
          <span>{formatTime(tl.start)}</span>
          <span>{formatTime(tl.end)}</span>
        </div>
      </div>

      <canvas ref={canvasRef} className="playback-strip" aria-label="Signal timeline around the playhead"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          if (x < LABEL_W) return;
          setPlaying(false);
          seek(clock.current.t + ((x - LABEL_W) / (rect.width - LABEL_W) - 0.5) * WINDOW_MS);
        }} />

      <div className="playback-status small">
        <span className="playback-legend">
          <span><i style={{ background: LAMP.green }} />green</span>
          <span><i style={{ background: LAMP.yellow }} />yellow</span>
          <span><i style={{ background: LAMP.red }} />red</span>
          <span><i className="pb-blink" style={{ background: LAMP.permissive }} />permissive left</span>
          <span><i style={{ background: PED_COLORS.walk }} />walk</span>
          <span><i style={{ background: PED_COLORS.fdw }} />flashing don&apos;t walk</span>
          <span><i style={{ background: '#1fb6cc' }} />detector on</span>
        </span>
        {snap && snap.pattern && <span>Pattern <strong>{snap.pattern}</strong></span>}
        <span>Detectors on: <strong>{active.length ? active.join(', ') : 'none'}</strong></span>
        {info && info.notOnPlan.length > 0 && (
          <span className="muted" title="These channels are in the data but no detector on the plan has them">
            Not on the plan: {info.notOnPlan.join(', ')}
          </span>
        )}
        {info && info.noData.length > 0 && (
          <span className="muted" title="Detectors on the plan whose channel never appears in the data">
            No data for channel{info.noData.length === 1 ? '' : 's'} {info.noData.join(', ')}
          </span>
        )}
      </div>
    </section>
  );
}
