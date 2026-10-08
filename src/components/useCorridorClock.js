import { useEffect, useRef } from 'react';
import { stateAt, changeIndex, nextChange, previousChange } from '../lib/hires.js';

const PUSH_MS = 40; // a signal's lamps redraw at most this often while playing

function isTyping(target) {
  return target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) && target.type !== 'range';
}

/**
 * One clock for every signal in a corridor. Each frame it moves the
 * playhead, gives each signal's store that signal's state whenever it
 * changes, and publishes the clock on the master store, which also carries
 * the controls (seek, play, speed) and the composite timeline that the
 * transport bar and scanner draw.
 *
 * `timelines[i]` is signal i's buildTimeline() (or null); `stores[i]` its
 * playback store; `composite` a timeline-shaped summary for the scanner.
 */
export function useCorridorClock({ master, stores, timelines, composite }) {
  const clock = useRef({ t: 0, playing: false, speed: 1, last: [], lastPush: 0, dirty: true });

  const range = composite && composite.end > composite.start ? composite : null;

  // Start at the beginning whenever the data changes.
  useEffect(() => {
    const c = clock.current;
    if (range) c.t = Math.max(range.start, Math.min(range.end, c.t || range.start));
    c.last = [];
    c.dirty = true;
  }, [range]);

  useEffect(() => {
    if (!range) {
      master.controls = null;
      master.timeline = null;
      master.clock = null;
      stores.forEach((s) => s.set(null));
      return undefined;
    }
    const c = clock.current;
    const seek = (t) => {
      c.t = Math.max(range.start, Math.min(range.end, t));
      c.dirty = true;
    };
    master.timeline = range;
    master.controls = {
      seek,
      setPlaying: (v) => {
        const next = typeof v === 'function' ? v(c.playing) : v;
        if (next && c.t >= range.end) c.t = range.start;
        c.playing = !!next;
        c.dirty = true;
      },
      setSpeed: (s) => {
        c.speed = s;
        c.dirty = true;
      },
      next: () => {
        const ahead = timelines.map((tl) => (tl ? nextChange(tl, c.t) : null)).filter((x) => x != null);
        if (ahead.length) seek(Math.min(...ahead));
      },
      previous: () => {
        const back = timelines.map((tl) => (tl ? previousChange(tl, c.t) : null)).filter((x) => x != null);
        if (back.length) seek(Math.max(...back));
      },
    };

    let frame = 0;
    let last = performance.now();
    const loop = (now) => {
      frame = requestAnimationFrame(loop);
      const dt = Math.min(1000, now - last); // a background tab pauses, it doesn't leap
      last = now;
      if (c.playing) {
        c.t += dt * c.speed;
        if (c.t >= range.end) {
          c.t = range.end;
          c.playing = false;
        }
      }
      const throttled = c.playing && now - c.lastPush < PUSH_MS;
      if (!throttled) {
        timelines.forEach((tl, i) => {
          if (!tl || !stores[i]) return;
          const index = changeIndex(tl, c.t);
          if (c.dirty || index !== c.last[i] || !stores[i].get()) {
            stores[i].set(stateAt(tl, c.t));
            c.last[i] = index;
          }
        });
        c.lastPush = now;
      }
      master.frame({ t: c.t, playing: c.playing, speed: c.speed, start: range.start, end: range.end });
      c.dirty = false;
    };
    frame = requestAnimationFrame(loop);

    const onKey = (e) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        master.controls.setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const forward = e.key === 'ArrowRight';
        if (e.shiftKey) master.controls[forward ? 'next' : 'previous']();
        else seek(c.t + (forward ? 1000 : -1000));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      master.controls = null;
      master.timeline = null;
      master.clock = null;
    };
  }, [range, master, stores, timelines]);
}
