/**
 * Keeping a local video in step with signal playback.
 *
 * The high-resolution data's clock is the master. A video has a start time
 * (the wall-clock moment of its first frame), so any data time maps to a
 * video time. Browsers play video at up to 16x; faster than that, the video
 * holds still and is stepped a few times a second instead.
 *
 * Framework free.
 */

import { parseTime } from './hires.js';

export const MAX_RATE = 16;
const STEP_MS = 200; // how often the video is stepped above MAX_RATE

/**
 * A start time read from a file name: 20260917_080000, 20260917-080000.5,
 * 2026-09-17 08.00.00, 2026-09-17T08-00-00, 2026_09_17_0800 (as the hi-res
 * files are named). Epoch ms, or null.
 */
export function startFromFilename(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '');
  const patterns = [
    /(\d{4})(\d{2})(\d{2})[ _T-]?(\d{2})(\d{2})(\d{2})(?:[._](\d{1,3}))?/,
    /(\d{4})[-_.](\d{2})[-_.](\d{2})[ _T-](\d{2})[-_.:](\d{2})(?:[-_.:](\d{2}))?/,
    /(\d{4})_(\d{2})_(\d{2})_(\d{2})(\d{2})()/,
  ];
  for (const re of patterns) {
    const m = re.exec(base);
    if (!m) continue;
    const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
    const s = Number(m[6] || 0);
    const ms = m[7] ? Number(`${m[7]}00`.slice(0, 3)) : 0;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) continue;
    return new Date(y, mo - 1, d, h, mi, s, ms).getTime();
  }
  return null;
}

/** The start-time box's text: M/D/YYYY HH:mm:ss.s, as the hi-res data writes it. */
export { formatTime as formatStart } from './hires.js';

export function parseStart(text) {
  const t = parseTime(text);
  return Number.isFinite(t) ? t : null;
}

/**
 * What the video should do this frame to follow the data clock.
 * clock: { t, playing, speed }; video: { time, duration, paused };
 * now: ms (performance.now()), lastStep: when it was last stepped.
 * Returns { target, outside: 'before' | 'after' | null, play, pause, rate, seekTo }.
 */
export function syncStep({ clock, startMs, video, now = 0, lastStep = -Infinity }) {
  const target = (clock.t - startMs) / 1000;
  const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
  const action = { target, outside: null, play: false, pause: false, rate: null, seekTo: null };
  if (target < 0 || target > duration) {
    action.outside = target < 0 ? 'before' : 'after';
    action.pause = !video.paused;
    const edge = target < 0 ? 0 : duration;
    if (Math.abs(video.time - edge) > 0.05) action.seekTo = edge;
    return action;
  }
  const drift = Math.abs(video.time - target);
  if (clock.playing && clock.speed <= MAX_RATE) {
    action.rate = clock.speed;
    action.play = video.paused;
    if (drift > Math.max(0.35, clock.speed * 0.12)) action.seekTo = target;
  } else if (clock.playing) {
    action.pause = !video.paused;
    if (now - lastStep >= STEP_MS && drift > 0.05) action.seekTo = target;
  } else {
    action.pause = !video.paused;
    if (drift > 0.05) action.seekTo = target;
  }
  return action;
}
