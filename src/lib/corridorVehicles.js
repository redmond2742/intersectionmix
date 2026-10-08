/**
 * Vehicles along a corridor.
 *
 * Each signal's detectors already give its own vehicles (buildTracks): up
 * the approach, over the advance loop, queued on the stop bar. Here they
 * leave too: past the stop bar a vehicle follows its movement through the
 * intersection, and one leaving toward the next signal drives the link road
 * between them. There it is matched to a vehicle arriving at the next
 * signal on the facing approach, first in first out, if it could have got
 * there in the time between; the two become one vehicle, so a platoon can
 * be followed from signal to signal.
 *
 * What the detectors cannot say is approximated: the speed between them,
 * the lane on the link, and which turn a vehicle in a shared lane makes
 * (through, where it can). Unmatched departures fade out down the link;
 * unmatched arrivals appear at the end of the link, in time to reach the
 * detector that saw them.
 *
 * Plan feet in corridor coordinates (corridorLayout); times in ms.
 * Framework free.
 */

import { buildTracks, trackAt, queueAhead, QUEUE_GAP } from './vehicles.js';
import { movementPoints } from './geometry.js';
import { linkPoint, corridorPhases } from './corridor.js';

const TURN_PREFERENCE = ['T', 'L', 'R', 'U'];
const MIN_SPEED = 8; // ft/s: slower than this across a link and it is not the same vehicle
const MAX_LINK_WAIT = 4 * 60 * 1000; // ms: a link takes no longer than this to drive

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);

function measure(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1] + len(sub(points[i], points[i - 1])));
  return cum;
}

/** A point `d` feet along a polyline, with its direction of travel. */
function along(points, cum, d) {
  const total = cum[cum.length - 1];
  const at = Math.max(0, Math.min(total, d));
  let i = 1;
  while (i < points.length - 1 && cum[i] < at) i += 1;
  const a = points[i - 1];
  const b = points[i];
  const span = cum[i] - cum[i - 1] || 1;
  const k = (at - cum[i - 1]) / span;
  const dir = sub(b, a);
  const l = len(dir) || 1;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dir: { x: dir.x / l, y: dir.y / l } };
}

/** Where a track's lane is drawn, in corridor coordinates, `dist` feet upstream of the stop bar. */
function onApproach(sig, g, laneItem, dist) {
  const y = dist >= 0 ? g.mapY(dist) : g.S + dist;
  return add(sig.offset, g.world(y, laneItem.cx));
}

/**
 * The corridor's vehicles, built once per set of timelines.
 * `timelines` maps a signal's index in the layout to its buildTimeline().
 * Returns { vehicles, span } with vehicles sorted by when they appear.
 */
export function corridorVehicles(layout, timelines) {
  const phases = corridorPhases(layout);
  const sign = (i, legId) => {
    if (!legId) return 0;
    if (phases[i].forward.legId === legId) return 1;
    if (phases[i].backward.legId === legId) return -1;
    return 0;
  };
  /** Chainage of a spot on an approach: before the signal going forward, after it going back. */
  const approachChain = (i, g, dist) => {
    const s = sign(i, g.id);
    return s ? layout.signals[i].chainage - s * (g.S + dist) : null;
  };

  // Every signal's own vehicles.
  const local = layout.signals.map((sig) => {
    const tl = timelines[sig.index];
    return tl ? buildTracks(tl, sig.design, sig.geom).tracks : [];
  });

  // Which link each leg of each signal opens onto, and in which direction.
  const linkFromLeg = new Map(); // `${i}:${legId}` -> { link, toward: index of the far signal, forward }
  for (const link of layout.links) {
    if (!link.aligned) continue;
    linkFromLeg.set(`${link.a}:${link.legA}`, { link, from: link.a, toward: link.b, forward: true });
    linkFromLeg.set(`${link.b}:${link.legB}`, { link, from: link.b, toward: link.a, forward: false });
  }

  const boxCache = new Map();
  /** A movement through the box, from the stop bar to past the far crosswalk, in the signal's own frame. */
  const boxPath = (sig, g, laneItem) => {
    const key = `${sig.index}:${g.id}:${laneItem.lane.id}`;
    if (boxCache.has(key)) return boxCache.get(key);
    const turn = TURN_PREFERENCE.find((t) => laneItem.lane.turns.includes(t));
    let result = null;
    if (turn) {
      const lanes = g.cs.inbound.filter((l) => l.lane.turns.includes(turn));
      const m = movementPoints(sig.geom, g.id, turn, laneItem, lanes.indexOf(laneItem), lanes.length, 16);
      if (m) {
        const stop = g.world(g.S, laneItem.cx);
        let k = 0;
        m.points.forEach((p, i) => { if (len(sub(p, stop)) < len(sub(m.points[k], stop))) k = i; });
        const points = [stop, ...m.points.slice(k + 1)];
        result = { points, target: m.targetId, turn };
      }
    }
    boxCache.set(key, result);
    return result;
  };

  /** A path from leaving `sig` through its box, out along the target leg to the link, along the link. */
  const departurePath = (sig, g, laneItem, box, onward) => {
    const pts = box.points.map((p) => add(sig.offset, p));
    if (!onward) return { points: pts, lateral: null };
    const { link, forward } = onward;
    const gt = sig.geom.byId.get(box.target);
    const end = box.points[box.points.length - 1];
    const x = dot(end, gt.r); // the receiving lane it ends up in, across the target leg
    const reach = forward ? link.reachA : link.reachB;
    pts.push(add(sig.offset, gt.world(reach, x)));
    // On the link, lateral offsets are A's: going back toward A they are negated.
    return { points: pts, lateral: forward ? x : -x };
  };

  /** The link road from one end to the other, easing from one lateral offset to another. */
  const linkPath = (link, forward, fromX, toX) => {
    const n = link.road.points.length;
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const k = i / (n - 1);
      const s = forward ? link.road.points[i].s : link.road.points[n - 1 - i].s;
      out.push(linkPoint(link, s, fromX + (toX - fromX) * k));
    }
    return out;
  };

  /** From the end of the link into an approach, up to the detector the vehicle is first seen on. */
  const arrivalPath = (sig, g, laneItem, link, forward, dist) => {
    const reach = forward ? link.reachB : link.reachA;
    return [add(sig.offset, g.world(reach, laneItem.cx)), onApproach(sig, g, laneItem, dist)];
  };

  // Every vehicle seen at every signal, with where it goes when it leaves.
  const entries = [];
  const departures = new Map(); // `${link.index}:${forward}` -> entries leaving onto that link that way
  const arrivals = new Map(); // the same key -> entries arriving off it
  layout.signals.forEach((sig, i) => {
    for (const track of local[i]) {
      const g = sig.geom.byId.get(track.legId);
      const laneItem = g && g.cs.inbound.find((l) => l.lane.id === track.laneId);
      if (!laneItem) continue;
      const last = track.hits[track.hits.length - 1];
      const box = boxPath(sig, g, laneItem);
      const entry = {
        track, sig, g, laneItem,
        first: track.hits[0],
        cross: last.off + (last.near / track.speed) * 1000, // when it passes the stop bar
        box,
        onward: box ? linkFromLeg.get(`${i}:${box.target}`) || null : null,
        arrivingFrom: linkFromLeg.get(`${i}:${g.id}`) || null, // the link this approach faces
      };
      entries.push(entry);
      if (entry.onward) {
        const key = `${entry.onward.link.index}:${entry.onward.forward}`;
        if (!departures.has(key)) departures.set(key, []);
        departures.get(key).push(entry);
      }
      if (entry.arrivingFrom) {
        // Arriving here, it drove that link the other way.
        const key = `${entry.arrivingFrom.link.index}:${!entry.arrivingFrom.forward}`;
        if (!arrivals.has(key)) arrivals.set(key, []);
        arrivals.get(key).push(entry);
      }
    }
  });

  // When each vehicle was first seen, lane by lane: the order a queue discharges in.
  const laneTimes = new Map();
  for (const e of entries) {
    const key = `${e.sig.index}:${e.track.laneId}`;
    if (!laneTimes.has(key)) laneTimes.set(key, []);
    laneTimes.get(key).push(e.first.on);
  }
  laneTimes.forEach((list) => list.sort((a, b) => a - b));

  // Match departures to arrivals, link by link, first in first out, when the
  // time between could have been driven.
  const matched = new Map(); // departure -> arrival
  const arrived = new Set(); // arrivals that are someone's departure
  for (const [key, outs] of departures) {
    const ins = (arrivals.get(key) || []).sort((a, b) => a.first.on - b.first.on);
    outs.sort((a, b) => a.cross - b.cross);
    let from = 0;
    for (const dep of outs) {
      const fast = dep.track.speed * 1.25;
      for (let j = from; j < ins.length; j += 1) {
        const arr = ins[j];
        const dt = (arr.first.on - dep.cross) / 1000;
        if (dt <= 0) continue;
        if (dt * 1000 > MAX_LINK_WAIT) break;
        const distance = dep.onward.link.travel - dep.g.S - arr.g.S - arr.first.far;
        if (distance / dt > fast) continue; // it could not have got there that quickly
        if (distance / dt < MIN_SPEED) break; // nor that slowly; later arrivals are slower still
        matched.set(dep, arr);
        arrived.add(arr);
        from = j + 1;
        break;
      }
    }
  }

  const trackSegment = (e, t0) => ({ t0, t1: e.cross, kind: 'track', e });
  const pathSegment = (points, t0, t1, c0, c1) => ({ t0, t1, kind: 'path', points, cum: measure(points), c0, c1 });

  // A vehicle starts wherever it was first seen and nobody drove in as it;
  // from there it is followed signal to signal for as long as it matches.
  const vehicles = [];
  let serial = 0;
  for (const entry of entries) {
    if (arrived.has(entry)) continue;
    const { track, sig, g, laneItem } = entry;
    const i = sig.index;
    const segments = [];
    const from = entry.arrivingFrom;
    if (from && from.link.road) {
      // An arrival nobody was matched to appears at the end of the link.
      const pts = arrivalPath(sig, g, laneItem, from.link, !from.forward, entry.first.far);
      const length = len(sub(pts[1], pts[0]));
      const t0 = entry.first.on - (length / track.speed) * 1000;
      const c1 = approachChain(i, g, entry.first.far);
      segments.push(pathSegment(pts, t0, entry.first.on, c1 == null ? null : c1 - sign(i, g.id) * length, c1));
      segments.push(trackSegment(entry, entry.first.on));
    } else {
      segments.push(trackSegment(entry, track.from));
    }

    let cur = entry;
    for (let guard = 0; guard < 64 && cur.box; guard += 1) {
      const s = cur.sig;
      const dir = sign(s.index, cur.g.id);
      const c0 = dir ? s.chainage - dir * cur.g.S : null;
      const out = departurePath(s, cur.g, cur.laneItem, cur.box, cur.onward);
      const next = matched.get(cur);
      if (next) {
        const { link, forward } = cur.onward;
        const toX = forward ? -next.laneItem.cx : next.laneItem.cx;
        const pts = [
          ...out.points,
          ...linkPath(link, forward, out.lateral, toX),
          ...arrivalPath(next.sig, next.g, next.laneItem, link, forward, next.first.far),
        ];
        const c1 = approachChain(next.sig.index, next.g, next.first.far);
        const trip = pathSegment(pts, cur.cross, next.first.on, c0 ?? (c1 == null ? null : s.chainage), c1);
        // Free flow would have got it there sooner: it drove up and waited in the queue.
        const speed = cur.track.speed;
        if (cur.cross + (trip.cum.at(-1) / speed) * 1000 < next.first.on - 1000) {
          trip.queue = { speed, times: laneTimes.get(`${next.sig.index}:${next.track.laneId}`) || [], own: next.first.on };
        }
        segments.push(trip);
        segments.push(trackSegment(next, next.first.on));
        cur = next;
        continue;
      }
      // Not followed further: through the box (and down the link, if it heads that way), then gone.
      let pts = out.points;
      if (cur.onward && cur.onward.link.road) {
        pts = [...pts, ...linkPath(cur.onward.link, cur.onward.forward, out.lateral, out.lateral)];
      }
      const length = measure(pts).at(-1);
      const t1 = cur.cross + (length / cur.track.speed) * 1000;
      const through = cur.box.turn === 'T' && dir;
      segments.push(pathSegment(pts, cur.cross, t1, through ? c0 : null, through ? c0 + dir * length : null));
      break;
    }

    serial += 1;
    vehicles.push({ id: `cv${serial}`, segments, from: segments[0].t0, to: segments[segments.length - 1].t1 });
  }

  vehicles.sort((a, b) => a.from - b.from);
  const span = Math.max(0, ...vehicles.map((v) => v.to - v.from));
  return { vehicles, span, matched: matched.size };
}

/** One segment's position at t: { x, y, dir, stopped, chainage }, or null. */
function segmentAt(seg, t) {
  if (seg.kind === 'track') {
    const { e } = seg;
    const at = trackAt(e.track, t);
    if (!at) return null;
    const dist = Math.max(0, at.dist);
    const p = onApproach(e.sig, e.g, e.laneItem, dist);
    // Further out than the intersection is drawn (and not on a link road), it is off the map.
    if (Math.hypot(p.x - e.sig.offset.x, p.y - e.sig.offset.y) > (e.sig.clip || Infinity) + 4) return null;
    const s = e.sig.index;
    return { x: p.x, y: p.y, dir: e.g.d, stopped: at.stopped, signal: s, chainage: null, e, dist };
  }
  const total = seg.cum[seg.cum.length - 1];
  let d = seg.t1 > seg.t0 ? ((t - seg.t0) / (seg.t1 - seg.t0)) * total : total;
  let stopped = false;
  if (seg.queue) {
    // At free speed until it reaches the back of the queue, then forward as the queue moves.
    const free = ((t - seg.t0) / 1000) * seg.queue.speed;
    const slot = total - QUEUE_GAP * queueAhead(seg.queue.times, t, seg.queue.own);
    d = Math.max(0, Math.min(total, free, slot));
    stopped = slot < free - 1;
  }
  const k = total > 0 ? d / total : 1;
  const p = along(seg.points, seg.cum, d);
  const chainage = seg.c0 != null && seg.c1 != null ? seg.c0 + (seg.c1 - seg.c0) * k : null;
  return { x: p.x, y: p.y, dir: p.dir, stopped, chainage };
}

/** A vehicle's position at t, or null when it is not on the road. */
export function vehicleAt(vehicle, t) {
  if (t < vehicle.from || t > vehicle.to) return null;
  for (const seg of vehicle.segments) {
    if (t >= seg.t0 && t <= seg.t1) return segmentAt(seg, t);
  }
  return null;
}

/** Every vehicle on the corridor at t: [{ id, x, y, dir, stopped }]. */
export function corridorVehiclesAt({ vehicles, span }, t, limit = 400) {
  let lo = 0;
  let hi = vehicles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (vehicles[mid].from <= t) lo = mid + 1;
    else hi = mid;
  }
  const out = [];
  for (let i = lo - 1; i >= 0 && vehicles[i].from >= t - span; i -= 1) {
    const v = vehicles[i];
    if (t > v.to) continue;
    const at = vehicleAt(v, t);
    if (at) out.push({ id: v.id, x: at.x, y: at.y, dir: at.dir, stopped: at.stopped });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Vehicle trajectories on the corridor's main road between t0 and t1, for
 * the time-space diagram: [{ id, forward, points: [{ t, c }] }], where c is
 * chainage in feet. Side-street vehicles are left out.
 */
export function trajectories(model, layout, t0, t1, step = 500) {
  const phases = corridorPhases(layout);
  const out = [];
  for (const v of model.vehicles) {
    if (v.to < t0 || v.from > t1) continue;
    const points = [];
    for (let t = Math.max(t0, v.from); t <= Math.min(t1, v.to); t += step) {
      const at = vehicleAt(v, t);
      let c = at ? at.chainage : null;
      if (at && c == null && at.e) {
        const i = at.signal;
        const legId = at.e.g.id;
        const dir = phases[i].forward.legId === legId ? 1 : phases[i].backward.legId === legId ? -1 : 0;
        if (dir) c = layout.signals[i].chainage - dir * (at.e.g.S + at.dist);
      }
      if (c == null) {
        if (points.length > 1) out.push({ id: v.id, points: points.splice(0) });
        else points.length = 0;
        continue;
      }
      points.push({ t, c });
    }
    if (points.length > 1) out.push({ id: v.id, points });
  }
  for (const tr of out) tr.forward = tr.points[tr.points.length - 1].c >= tr.points[0].c;
  return out;
}

