/**
 * Conflicts in space and time.
 *
 * A conflict point says two paths share a spot. Whether they actually
 * conflict depends on when each gets there. Here every movement is given a
 * start time and a speed, so each spot along its path has a time, and every
 * conflict point becomes two moments, one per movement. The gap between them
 * is what the signal buys. With no signals everything starts at once and most
 * gaps are small. With signal timing, movements start when their phase turns
 * green, and the signal lifts conflicting movements apart in time. What stays
 * close are the conflicts it permits: a permissive left against opposing
 * traffic, turns across a walking crosswalk, and free rights.
 *
 * The cycle is a default dual-ring NEMA sequence (leading lefts, then
 * throughs, a barrier, then the cross street). It is not the controller's
 * timing, which the design does not hold, just enough to show the shape.
 *
 * Framework free.
 */

import { usedPhases, findLeg } from './model.js';
import { conflictPoints } from './conflicts.js';

export const DEFAULT_TIMING = { left: 12, through: 28, clearance: 4 };
/** Two movements reaching the same spot within this many seconds are a live conflict. */
export const LIVE_GAP = 4;
export const PED_SPEED = 3.5; // ft/s, the MUTCD walking speed
const MPH = 1.467; // ft/s per mph

const RING_1 = [['1', '2'], ['3', '4']];
const RING_2 = [['5', '6'], ['7', '8']];

/**
 * Green windows for each phase in use: { windows: { phase: { start, end } }, cycle }.
 * Each ring runs its phases in order up to the barrier; the ring that
 * finishes first rests in its last phase until the other catches up.
 * Phases outside 1-8 run alone after the second barrier.
 */
export function phaseSchedule(design, timing = DEFAULT_TIMING) {
  const used = new Set(usedPhases(design));
  const green = (p) => (Number(p) % 2 === 1 ? timing.left : timing.through);
  const windows = {};
  let t = 0;
  for (let b = 0; b < 2; b += 1) {
    const rings = [RING_1[b], RING_2[b]].map((sequence) => {
      let at = t;
      const placed = [];
      for (const p of sequence) {
        if (!used.has(p)) continue;
        windows[p] = { start: at, end: at + green(p) };
        at += green(p) + timing.clearance;
        placed.push(p);
      }
      return { at, placed };
    });
    const barrier = Math.max(t, ...rings.map((r) => r.at));
    for (const r of rings) {
      if (r.placed.length) windows[r.placed[r.placed.length - 1]].end = barrier - timing.clearance;
    }
    t = barrier;
  }
  for (const p of [...used].filter((q) => !windows[q])) {
    windows[p] = { start: t, end: t + timing.through };
    t += timing.through + timing.clearance;
  }
  return { windows, cycle: t };
}

/** Travel speed along a movement, ft/s: throughs near the posted speed, turns slower. */
export function movementSpeed(m, leg) {
  if (m.turn === 'T') return Math.min(Number(leg && leg.speed) || 30, 45) * 0.75 * MPH;
  if (m.free) return 18 * MPH;
  if (m.turn === 'R') return 12 * MPH;
  return 15 * MPH; // lefts and U-turns
}

/** Cumulative length at each point of a polyline. */
export function measure(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return cum;
}

/** How far along a polyline its closest point to p lies. */
export function distanceAlong(points, cum, p) {
  let best = { d2: Infinity, along: 0 };
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
    const qx = a.x + t * vx;
    const qy = a.y + t * vy;
    const d2 = (p.x - qx) ** 2 + (p.y - qy) ** 2;
    if (d2 < best.d2) best = { d2, along: cum[i] + t * Math.sqrt(l2) };
  }
  return best.along;
}

/** The point a given distance along a polyline, or null past either end. */
export function pointAlong(points, cum, d) {
  if (d < 0 || d > cum[cum.length - 1]) return null;
  for (let i = 1; i < points.length; i += 1) {
    if (cum[i] >= d) {
      const span = cum[i] - cum[i - 1] || 1;
      const t = (d - cum[i - 1]) / span;
      return { x: points[i - 1].x + t * (points[i].x - points[i - 1].x), y: points[i - 1].y + t * (points[i].y - points[i - 1].y) };
    }
  }
  return points[points.length - 1];
}

/**
 * The space-time picture: every movement as a track with its runs (start
 * times), and every conflict point with the time each movement reaches it.
 * mode is 'signal' (start at phase green) or 'none' (all start at once).
 */
export function spaceTime(design, geom, { mode = 'signal', timing = DEFAULT_TIMING, liveGap = LIVE_GAP } = {}) {
  const { points, vehicles, peds } = conflictPoints(design, geom);
  const schedule = phaseSchedule(design, timing);
  const start = (phase) => (phase && schedule.windows[phase] ? schedule.windows[phase].start : null);

  const tracks = [];
  for (const m of vehicles) {
    const leg = findLeg(design, m.legId);
    const runs = [];
    if (mode === 'none' || m.free) {
      runs.push({ t0: 0, phase: m.phase, permissive: false });
    } else {
      const protectedStart = start(m.phase);
      const permissiveLeft = m.turn === 'L' && leg && leg.movements.L.treatment === 'permissive';
      if (protectedStart != null) runs.push({ t0: protectedStart, phase: m.phase, permissive: permissiveLeft });
      const later = start(m.permissivePhase);
      if (later != null && m.permissivePhase !== m.phase) runs.push({ t0: later, phase: m.permissivePhase, permissive: true });
    }
    if (!runs.length) continue;
    tracks.push({ id: m.id, kind: 'vehicle', label: m.label, points: m.points, cum: measure(m.points), speed: movementSpeed(m, leg), runs, free: m.free });
  }
  for (const p of peds) {
    const line = [p.a, p.b];
    const t0 = mode === 'none' || p.uncontrolled ? 0 : start(p.phase);
    if (t0 == null) continue;
    tracks.push({ id: p.id, kind: 'ped', label: p.label, points: line, cum: measure(line), speed: PED_SPEED, runs: [{ t0, phase: p.phase, permissive: false }] });
  }

  const byId = new Map(tracks.map((t) => [t.id, t]));
  const conflicts = [];
  for (const c of points) {
    const a = byId.get(c.a);
    const b = byId.get(c.b);
    if (!a || !b) continue;
    const ta = a.runs.map((r) => r.t0 + distanceAlong(a.points, a.cum, c) / a.speed);
    const tb = b.runs.map((r) => r.t0 + distanceAlong(b.points, b.cum, c) / b.speed);
    let best = null;
    for (const x of ta) for (const y of tb) if (!best || Math.abs(x - y) < best.gap) best = { ta: x, tb: y, gap: Math.abs(x - y) };
    conflicts.push({ ...c, ...best, live: best.gap < liveGap });
  }

  const ends = tracks.flatMap((t) => t.runs.map((r) => r.t0 + t.cum[t.cum.length - 1] / t.speed));
  const span = Math.max(mode === 'signal' ? schedule.cycle : 0, ...ends, 10);
  return {
    mode,
    schedule,
    tracks,
    conflicts,
    span,
    counts: {
      live: conflicts.filter((c) => c.live).length,
      separated: conflicts.filter((c) => !c.live).length,
    },
  };
}
