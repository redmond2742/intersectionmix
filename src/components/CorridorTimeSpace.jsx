import { useEffect, useRef, useState } from 'react';
import { lastAtOrBefore, formatTime } from '../lib/hires.js';
import { trajectories } from '../lib/corridorVehicles.js';
import { LAMP } from './PlaybackOverlay.jsx';

const WINDOWS = [2, 4, 8, 15]; // minutes across
const LEFT = 118;
const RIGHT = 16;
const TOP = 22;
const BOTTOM = 34;
const BAND = 7;
const FORWARD = '#1c7ed6';
const BACKWARD = '#ae3ec9';

/**
 * The time-space diagram: distance along the corridor up the side, time
 * across, the playhead in the middle. At each signal, the through phase
 * each way as a band of green, yellow and red; across them, the paths of
 * the vehicles the detectors saw, one colour each way. A platoon that gets
 * a green wave climbs through the bands without stopping.
 */
export default function CorridorTimeSpace({ layout, phases, timelines, model, master }) {
  const canvasRef = useRef(null);
  const [minutes, setMinutes] = useState(4);
  const cache = useRef({ from: 0, to: 0, model: null, lines: [] });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const W = minutes * 60000;
    const chains = layout.signals.map((s) => s.chainage);
    const c0 = Math.min(...chains);
    const c1 = Math.max(...chains);
    const pad = Math.max(150, (c1 - c0) * 0.08);

    const draw = (t) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 10 || h < 10) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#fbfbf8';
      g.fillRect(0, 0, w, h);
      const t0 = t - W / 2;
      const t1 = t + W / 2;
      const X = (ms) => LEFT + ((ms - t0) / W) * (w - LEFT - RIGHT);
      const Y = (c) => h - BOTTOM - ((c - (c0 - pad)) / (c1 - c0 + 2 * pad)) * (h - TOP - BOTTOM);

      // Time ticks.
      const tick = minutes <= 4 ? 30000 : 60000;
      g.font = '11px Inter, system-ui, sans-serif';
      g.textAlign = 'center';
      for (let s = Math.ceil(t0 / tick) * tick; s <= t1; s += tick) {
        g.fillStyle = '#e9ecef';
        g.fillRect(X(s), TOP, 1, h - TOP - BOTTOM);
        g.fillStyle = '#69707a';
        g.fillText(formatTime(s).split(' ')[1].slice(0, 8), X(s), h - BOTTOM + 16);
      }

      // Vehicle paths, from a cache that is rebuilt as the window moves on.
      const c = cache.current;
      if (model && (c.model !== model || t0 < c.from || t1 > c.to)) {
        c.from = t0 - W / 2;
        c.to = t1 + W / 2;
        c.model = model;
        c.lines = trajectories(model, layout, c.from, c.to, 500);
      }
      if (!model) c.lines = [];
      g.lineWidth = 1.2;
      for (const tr of c.lines) {
        if (tr.points[tr.points.length - 1].t < t0 || tr.points[0].t > t1) continue;
        g.strokeStyle = tr.forward ? FORWARD : BACKWARD;
        g.globalAlpha = 0.55;
        g.beginPath();
        tr.points.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.c)) : g.moveTo(X(p.t), Y(p.c))));
        g.stroke();
      }
      g.globalAlpha = 1;

      // Each signal: its line, and its through phase each way.
      g.textAlign = 'left';
      layout.signals.forEach((sig, i) => {
        const y = Y(sig.chainage);
        g.fillStyle = '#ced4da';
        g.fillRect(LEFT, y, w - LEFT - RIGHT, 1);
        const tl = timelines[i];
        const bandRow = (phase, top) => {
          const ch = tl && phase ? tl.phases[phase] : null;
          if (!ch) {
            g.fillStyle = '#e9ecef';
            g.fillRect(LEFT, top, w - LEFT - RIGHT, BAND);
            return;
          }
          let k = lastAtOrBefore(ch.t, t0);
          let from = t0;
          let state = k < 0 ? ch.first : ch.s[k];
          k += 1;
          const paint = (a, b, s) => {
            const from2 = Math.max(a, tl.start);
            const to2 = Math.min(b, tl.end);
            if (to2 <= from2 || !LAMP[s] || s === 'unknown') return;
            g.fillStyle = LAMP[s];
            g.fillRect(X(from2), top, Math.max(0.6, X(to2) - X(from2)), BAND);
          };
          while (k < ch.t.length && ch.t[k] <= t1) {
            paint(from, ch.t[k], state);
            from = ch.t[k];
            state = ch.s[k];
            k += 1;
          }
          paint(from, t1, state);
        };
        // Forward traffic climbs the chart: its band sits on the upstream side of the line.
        bandRow(phases[i].forward.phase, y + 2);
        bandRow(phases[i].backward.phase, y - 2 - BAND);
        g.fillStyle = '#1f2328';
        g.font = '700 11px Inter, system-ui, sans-serif';
        const name = `${i + 1}. ${sig.design.name}`;
        g.fillText(name.length > 17 ? `${name.slice(0, 16)}…` : name, 6, y - 3);
        g.font = '10px Inter, system-ui, sans-serif';
        g.fillStyle = FORWARD;
        g.fillText(`Ø${phases[i].forward.phase || '–'} ↑`, 6, y + 10);
        g.fillStyle = BACKWARD;
        g.fillText(`Ø${phases[i].backward.phase || '–'} ↓`, 52, y + 10);
      });

      // The playhead.
      g.fillStyle = '#1f2328';
      g.fillRect(X(t) - 1, TOP - 6, 2, h - TOP - BOTTOM + 6);
      g.textAlign = 'center';
      g.font = '700 11px Inter, system-ui, sans-serif';
      g.fillText(formatTime(t).split(' ')[1], X(t), TOP - 9);
    };

    let last = 0;
    const off = master.onFrame((clock) => {
      const now = performance.now();
      if (clock.playing && now - last < 90) return;
      last = now;
      draw(clock.t);
    });
    if (master.clock) draw(master.clock.t);
    const observer = new ResizeObserver(() => master.clock && draw(master.clock.t));
    observer.observe(canvas);
    return () => {
      off();
      observer.disconnect();
    };
  }, [layout, phases, timelines, model, master, minutes]);

  const seekAt = (e) => {
    const clock = master.clock;
    if (!clock || !master.controls) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < LEFT) return;
    const W = minutes * 60000;
    master.controls.setPlaying(false);
    master.controls.seek(clock.t - W / 2 + ((x - LEFT) / (rect.width - LEFT - RIGHT)) * W);
  };

  return (
    <div className="corridor-timespace">
      <div className="timespace-bar">
        <span className="muted small">Distance along the corridor (up) by time (across). Click to jump.</span>
        <span className="timespace-key"><i style={{ background: FORWARD }} />forward <i style={{ background: BACKWARD }} />backward</span>
        <div className="segmented light" role="group" aria-label="Time window">
          {WINDOWS.map((m) => (
            <button key={m} type="button" className={minutes === m ? 'on' : ''} onClick={() => setMinutes(m)}>{m} min</button>
          ))}
        </div>
      </div>
      <canvas ref={canvasRef} className="timespace-canvas" onClick={seekAt} aria-label="Time-space diagram" />
    </div>
  );
}
