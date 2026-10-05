import { useEffect, useState } from 'react';
import { formatTime } from '../lib/hires.js';
import { SPEEDS } from '../lib/playbackClock.js';

/**
 * A compact transport for signal playback, for places that cover the main
 * player: the 3D view and the video window. Follows the player's clock and
 * drives it through the store's controls.
 */
export default function PlaybackBar({ store, className = '' }) {
  const [clock, setClock] = useState(store.clock);
  useEffect(() => {
    let last = 0;
    let lastPlaying = null;
    return store.onFrame((c) => {
      const now = performance.now();
      if (now - last < 120 && c.playing === lastPlaying) return;
      last = now;
      lastPlaying = c.playing;
      setClock({ ...c });
    });
  }, [store]);

  const controls = store.controls;
  if (!clock || !controls) return null;
  return (
    <div className={`playback-bar ${className}`} role="group" aria-label="Signal playback">
      <button type="button" onClick={() => controls.seek(clock.t - 30000)} aria-label="Back 30 seconds" title="Back 30 seconds">−30s</button>
      <button type="button" className="primary" onClick={() => controls.setPlaying(!clock.playing)}
        aria-label={clock.playing ? 'Pause' : 'Play'}>{clock.playing ? '⏸' : '▶'}</button>
      <button type="button" onClick={() => controls.seek(clock.t + 30000)} aria-label="Ahead 30 seconds" title="Ahead 30 seconds">+30s</button>
      <select value={clock.speed} onChange={(e) => controls.setSpeed(Number(e.target.value))} aria-label="Playback speed">
        {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
      </select>
      <span className="playback-bar-time">{formatTime(clock.t)}</span>
    </div>
  );
}
