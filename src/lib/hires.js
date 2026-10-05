/**
 * High-resolution controller data (the Indiana / Purdue event log) for
 * signal playback.
 *
 * Each file is one controller-hour: a few header lines whose code column is
 * blank (intersection number, IP address, ...), then one event per line:
 *
 *   9/17/2026 08:00:19.8, 8, 4      timestamp, event code, parameter
 *
 * Only the events that change what a road user sees are kept: phase
 * green / yellow / red, pedestrian walk / flashing don't walk / don't walk,
 * overlaps, detector on / off, pushbuttons and the coordination pattern.
 * They become a timeline of state changes per channel, so the state at any
 * moment is a binary search away.
 *
 * Framework free.
 */

import { isOverlap } from './model.js';

const PHASE = { 1: 'green', 8: 'yellow', 9: 'red', 10: 'red', 11: 'red', 12: 'red' };
const PED = { 21: 'walk', 22: 'fdw', 23: 'dw' };
const OVERLAP = { 61: 'green', 62: 'green', 63: 'yellow', 64: 'red', 65: 'red' };
const DETECTOR = { 82: 'on', 81: 'off' };
const BUTTON = { 90: 'on', 89: 'off' };
const PATTERN = 131;
/**
 * Preemption, by preempt number: the call, then the controller's run through
 * entry, track clearance, dwell and the exit interval. Nothing marks the end
 * of the exit interval, so it is given EXIT_MS and then taken as over.
 */
const PREEMPT = {
  101: 'warning', 102: 'call', 103: 'gate', 104: 'off', 105: 'entry', 106: 'track', 107: 'dwell', 111: 'exit',
};
/** Transit signal priority, by priority number: checked in until checked out. */
const TSP = { 112: 'tsp', 115: 'off' };
export const EXIT_MS = 15000;
/** A silence this long (ms) in the log is a gap in the data, not a quiet spell. */
export const GAP_MS = 5 * 60 * 1000;

/** What a channel must have been showing before its first logged change. */
const BEFORE = {
  phase: { green: 'red', yellow: 'green', red: 'yellow' },
  ped: { walk: 'dw', fdw: 'walk', dw: 'fdw' },
  onOff: { on: 'off', off: 'on' },
};

const TIME_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,6}))?$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,6}))?$/;

/** Epoch ms as the data writes times: M/D/YYYY HH:mm:ss.s. */
export function formatTime(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`;
}

/** M/D/YYYY HH:mm:ss.s or YYYY-MM-DD HH:mm:ss.sss, local time, to epoch ms (NaN if neither). */
export function parseTime(text) {
  const s = String(text || '').trim();
  let m = TIME_RE.exec(s);
  let y; let mo; let d;
  if (m) {
    y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    mo = Number(m[1]);
    d = Number(m[2]);
  } else {
    m = ISO_RE.exec(s);
    if (!m) return Number.NaN;
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
  }
  const ms = m[7] ? Number(`${m[7]}000`.slice(0, 3)) : 0;
  return new Date(y, mo - 1, d, Number(m[4]), Number(m[5]), Number(m[6] || 0), ms).getTime();
}

/** One file's text -> { meta: { intersection, ip, start }, events: [{ t, code, param }] }. */
export function parseHiRes(text) {
  const meta = {};
  const events = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw) continue;
    const parts = raw.split(',');
    if (parts.length < 3) continue;
    const code = parts[1].trim();
    if (!code) {
      const key = parts[2].trim().replace(/:$/, '');
      if (/^intersection#?$/i.test(key)) meta.intersection = (parts[3] || '').trim();
      else if (/^ip address$/i.test(key)) meta.ip = (parts[3] || '').trim();
      else if (/data log beginning/i.test(key)) meta.start = parseTime(parts[3]);
      continue;
    }
    const t = parseTime(parts[0]);
    if (!Number.isFinite(t) || !/^\d+$/.test(code)) continue;
    events.push({ t, code: Number(code), param: Number(parts[2]) });
  }
  return { meta, events };
}

/** Several files (hours) as one log: { events, start, end, controllers }. */
export function mergeFiles(parsed) {
  const events = parsed.flatMap((p) => p.events);
  // Stable: events logged at the same tenth keep their file order.
  const order = events.map((e, i) => i);
  order.sort((a, b) => events[a].t - events[b].t || a - b);
  const sorted = order.map((i) => events[i]);
  const controllers = [...new Set(parsed.map((p) => p.meta.intersection).filter(Boolean))];
  return {
    events: sorted,
    start: sorted.length ? sorted[0].t : 0,
    end: sorted.length ? sorted[sorted.length - 1].t : 0,
    controllers,
  };
}

/** Overlap parameter (1, 2, ...) to its letter (A, B, ...). */
export function overlapLetter(n) {
  return n >= 1 && n <= 26 ? String.fromCharCode(64 + n) : String(n);
}

function channel(map, key) {
  if (!map[key]) map[key] = { t: [], s: [] };
  return map[key];
}

function push(ch, t, s) {
  if (ch.s.length && ch.s[ch.s.length - 1] === s) return false; // 9 then 10 are both red
  ch.t.push(t);
  ch.s.push(s);
  return true;
}

/**
 * Sorted events -> { phases, peds, overlaps, detectors, buttons, pattern,
 * changes, start, end }. Each channel is { t: [...], s: [...], first } where
 * `first` is what it showed before its first change. `changes` is every
 * moment anything changed, sorted, for skipping and for a cheap state key.
 * `gaps` are stretches with no events at all: [{ from, to }].
 */
export function buildTimeline(log) {
  const events = log.events || log;
  const tl = {
    phases: {}, peds: {}, overlaps: {}, detectors: {}, buttons: {}, preempts: {}, tsp: {},
    pattern: { t: [], s: [] }, changes: [], gaps: [],
  };
  let last = null;
  for (const e of events) {
    if (last != null && e.t - last > GAP_MS) tl.gaps.push({ from: last, to: e.t });
    last = e.t;
    let changed = false;
    if (PHASE[e.code]) changed = push(channel(tl.phases, String(e.param)), e.t, PHASE[e.code]);
    else if (PED[e.code]) changed = push(channel(tl.peds, String(e.param)), e.t, PED[e.code]);
    else if (OVERLAP[e.code]) changed = push(channel(tl.overlaps, overlapLetter(e.param)), e.t, OVERLAP[e.code]);
    else if (DETECTOR[e.code]) changed = push(channel(tl.detectors, String(e.param)), e.t, DETECTOR[e.code]);
    else if (BUTTON[e.code]) changed = push(channel(tl.buttons, String(e.param)), e.t, BUTTON[e.code]);
    else if (PREEMPT[e.code]) changed = push(channel(tl.preempts, String(e.param)), e.t, PREEMPT[e.code]);
    else if (TSP[e.code]) changed = push(channel(tl.tsp, String(e.param)), e.t, TSP[e.code]);
    else if (e.code === PATTERN) changed = push(tl.pattern, e.t, String(e.param));
    if (changed && tl.changes[tl.changes.length - 1] !== e.t) tl.changes.push(e.t);
  }
  const infer = (map, table) => Object.values(map).forEach((ch) => { ch.first = table[ch.s[0]] || 'unknown'; });
  infer(tl.phases, BEFORE.phase);
  infer(tl.overlaps, BEFORE.phase);
  infer(tl.peds, BEFORE.ped);
  infer(tl.detectors, BEFORE.onOff);
  infer(tl.buttons, BEFORE.onOff);
  // A priority request that is already running when the log starts is not knowable; assume none.
  Object.values(tl.preempts).forEach((ch) => { ch.first = 'off'; });
  Object.values(tl.tsp).forEach((ch) => { ch.first = 'off'; });
  tl.pattern.first = '';
  tl.start = events.length ? events[0].t : 0;
  tl.end = events.length ? events[events.length - 1].t : 0;
  return tl;
}

/** Index of the last value <= x in a sorted array, or -1. */
export function lastAtOrBefore(sorted, x) {
  let lo = 0;
  let hi = sorted.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** What one channel shows at time t. */
export function channelAt(ch, t) {
  if (!ch) return 'unknown';
  const i = lastAtOrBefore(ch.t, t);
  return i < 0 ? ch.first : ch.s[i];
}

const mapAt = (map, t) => Object.fromEntries(Object.entries(map).map(([k, ch]) => [k, channelAt(ch, t)]));

/**
 * The priority requests running at t: { [number]: { kind, state, since } }.
 * An exit interval has no end event, so it lapses after EXIT_MS.
 */
export function priorityAt(tl, t) {
  const out = {};
  const read = (map, kind) => {
    for (const [number, ch] of Object.entries(map)) {
      const i = lastAtOrBefore(ch.t, t);
      const state = i < 0 ? ch.first : ch.s[i];
      if (state === 'off') continue;
      const since = i < 0 ? tl.start : ch.t[i];
      if (state === 'exit' && t - since > EXIT_MS) continue;
      out[number] = { kind, state, since, number };
    }
  };
  read(tl.preempts, 'preempt');
  read(tl.tsp, 'tsp');
  return out;
}

/** Everything at time t: { phases, peds, overlaps, detectors:Set, buttons:Set, pattern }. */
export function stateAt(tl, t) {
  const on = (map) => new Set(Object.keys(map).filter((k) => channelAt(map[k], t) === 'on'));
  return {
    t,
    phases: mapAt(tl.phases, t),
    peds: mapAt(tl.peds, t),
    overlaps: mapAt(tl.overlaps, t),
    detectors: on(tl.detectors),
    buttons: on(tl.buttons),
    priority: priorityAt(tl, t),
    pattern: channelAt(tl.pattern, t),
  };
}

/** Changes only when something changes: the index of the last change at or before t. */
export function changeIndex(tl, t) {
  return lastAtOrBefore(tl.changes, t);
}

/** The next / previous change strictly after / before t (null at the ends). */
export function nextChange(tl, t) {
  const i = lastAtOrBefore(tl.changes, t) + 1;
  return i < tl.changes.length ? tl.changes[i] : null;
}

export function previousChange(tl, t) {
  const i = lastAtOrBefore(tl.changes, t - 1); // -1 ms: step off the change we are on
  return i >= 0 ? tl.changes[i] : null;
}

/** A phase or overlap's indication in a snapshot. */
export function phaseState(design, snap, phase) {
  if (!phase) return 'unknown';
  const map = isOverlap(design, phase) ? snap.overlaps : snap.phases;
  return map[String(phase)] || 'unknown';
}

/**
 * The indication a movement shows: green, yellow, red, unknown, or
 * permissive (a left that may go on its through phase's green, yielding:
 * the flashing yellow arrow, or a green ball for a permissive-only left).
 */
export function movementSignal(design, leg, turn, snap) {
  const move = leg.movements[turn];
  if (!move) return 'unknown';
  const own = phaseState(design, snap, move.phase);
  const left = turn === 'L' || turn === 'U';
  if (!left) return own;
  const treatment = leg.movements.L.treatment;
  if (treatment === 'permissive') return own === 'green' ? 'permissive' : own;
  if ((treatment === 'pp' || treatment === 'fya') && own !== 'green' && own !== 'yellow') {
    const through = phaseState(design, snap, leg.movements.T.phase);
    if (through === 'green') return 'permissive';
    if (through === 'yellow') return 'yellow';
  }
  return own;
}

/** A one-line summary of what the log holds, against the design's detectors. */
export function describeLog(tl, design, detectorChannels) {
  const dataChannels = Object.keys(tl.detectors).sort((a, b) => a - b);
  const numbers = (map) => Object.keys(map).sort((a, b) => a - b);
  const planned = new Set(detectorChannels.map(String));
  return {
    phases: Object.keys(tl.phases).sort((a, b) => a - b),
    overlaps: Object.keys(tl.overlaps).sort(),
    peds: Object.keys(tl.peds).sort((a, b) => a - b),
    channels: dataChannels,
    preempts: numbers(tl.preempts),
    tsp: numbers(tl.tsp),
    notOnPlan: dataChannels.filter((c) => !planned.has(c)),
    noData: [...planned].filter((c) => c && !tl.detectors[c]).sort((a, b) => a - b),
  };
}
