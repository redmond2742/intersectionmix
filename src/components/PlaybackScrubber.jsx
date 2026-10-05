import { useCallback, useEffect, useRef, useState } from 'react';
import { formatTime } from '../lib/hires.js';
import { comparePhases } from '../lib/model.js';
import { LAMP } from './PlaybackOverlay.jsx';

const ROW = 5;
const GAP = 1;
const PRIORITY_ROW = 7;
const PED_COLOR = '#40c057';

/**
 * A scanner bar across everything loaded: a row per phase in its colour,
 * a row marking preempt and priority requests, and the playhead. Drag
 * anywhere on it to scan through the data. Used where the main player is
 * out of sight, above the 3D view.
 */
export default function PlaybackScrubber({ store, label = true }) {
  const canvasRef = useRef(null);
  const bands = useRef(null); // the rows, drawn once per size and timeline
  const [clock, setClock] = useState(store.clock);
  const [hover, setHover] = useState(null);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const tl = store.timeline;
    const c = store.clock;
    if (!canvas || !tl || !c || tl.end <= tl.start) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const phases = Object.keys(tl.phases).sort(comparePhases);
    const peds = Object.keys(tl.peds).sort(comparePhases);
    const h = (phases.length + (peds.length ? 1 : 0)) * (ROW + GAP) + PRIORITY_ROW + 2;
    // Laid out but not measured yet (or hidden): there is nothing to draw on.
    if (w < 1 || h < 1) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
      bands.current = null;
    }
    const span = tl.end - tl.start;
    const xOf = (t) => ((t - tl.start) / span) * w;

    if (!bands.current || bands.current.w !== w || bands.current.source !== tl) {
      const off = document.createElement('canvas');
      off.width = canvas.width;
      off.height = canvas.height;
      const g = off.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      let y = 0;
      const row = (channel, colorOf, height) => {
        for (let i = 0; i < channel.t.length; i += 1) {
          const color = colorOf(channel.s[i]);
          if (!color) continue;
          const x0 = xOf(channel.t[i]);
          const x1 = xOf(i + 1 < channel.t.length ? channel.t[i + 1] : tl.end);
          g.fillStyle = color;
          g.fillRect(x0, y, Math.max(0.5, x1 - x0), height);
        }
        y += height + GAP;
      };
      for (const p of phases) row(tl.phases[p], (state) => (state === 'unknown' ? null : LAMP[state]), ROW);
      if (peds.length) {
        // Every walk interval on one row, so a 40-row feed still fits.
        g.fillStyle = '#1b1e23';
        g.fillRect(0, y, w, ROW);
        for (const p of peds) {
          const ch = tl.peds[p];
          for (let i = 0; i < ch.t.length; i += 1) {
            if (ch.s[i] !== 'walk') continue;
            const x0 = xOf(ch.t[i]);
            const x1 = xOf(i + 1 < ch.t.length ? ch.t[i + 1] : tl.end);
            g.fillStyle = PED_COLOR;
            g.fillRect(x0, y, Math.max(1, x1 - x0), ROW);
          }
        }
        y += ROW + GAP;
      }
      // Preempts and priority requests, so they are easy to find in an hour of data.
      g.fillStyle = '#1b1e23';
      g.fillRect(0, y, w, PRIORITY_ROW);
      const marks = (map, color) => {
        for (const ch of Object.values(map)) {
          for (let i = 0; i < ch.t.length; i += 1) {
            if (ch.s[i] === 'off') continue;
            const x0 = xOf(ch.t[i]);
            const x1 = xOf(i + 1 < ch.t.length ? ch.t[i + 1] : tl.end);
            g.fillStyle = color;
            g.fillRect(x0 - 1, y, Math.max(2.5, x1 - x0), PRIORITY_ROW);
          }
        }
      };
      marks(tl.tsp, '#4dabf7');
      marks(tl.preempts, '#ff6b6b');
      for (const gap of tl.gaps) {
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.fillRect(xOf(gap.from), 0, Math.max(1, xOf(gap.to) - xOf(gap.from)), y + PRIORITY_ROW);
      }
      bands.current = { canvas: off, w, source: tl, height: y + PRIORITY_ROW };
    }

    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (bands.current.canvas.width > 0) g.drawImage(bands.current.canvas, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = xOf(c.t);
    g.fillStyle = '#fff';
    g.fillRect(x - 1, 0, 2, h);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(x - 1, 0, 2, 2);
    if (hover != null) {
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.fillRect(hover.x, 0, 1, h);
    }
  }, [store, hover]);

  useEffect(() => {
    let last = 0;
    const off = store.onFrame((c) => {
      const now = performance.now();
      if (now - last < 60) return;
      last = now;
      setClock({ ...c });
    });
    return off;
  }, [store]);

  useEffect(() => {
    paint();
  }, [paint, clock]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(() => paint());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [paint]);

  const timeAt = (e) => {
    const tl = store.timeline;
    const rect = e.currentTarget.getBoundingClientRect();
    const part = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return { t: tl.start + part * (tl.end - tl.start), x: e.clientX - rect.left };
  };
  const scanTo = (e) => {
    if (!store.controls || !store.timeline) return;
    const { t } = timeAt(e);
    store.controls.seek(t);
  };

  if (!store.timeline || !clock) return null;
  return (
    <div className="scrubber">
      <canvas ref={canvasRef} className="scrubber-canvas" aria-label="Scan through the data"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scanTo(e); }}
        onPointerMove={(e) => {
          const spot = timeAt(e);
          setHover(spot);
          if (e.buttons === 1) store.controls && store.controls.seek(spot.t);
        }}
        onPointerLeave={() => setHover(null)} />
      {label && (
        <div className="scrubber-labels">
          <span>{formatTime(store.timeline.start)}</span>
          <span className="scrubber-now">{formatTime(hover ? hover.t : clock.t)}{hover ? ' ·  click to scan' : ''}</span>
          <span>{formatTime(store.timeline.end)}</span>
        </div>
      )}
    </div>
  );
}
