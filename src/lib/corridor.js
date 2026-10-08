/**
 * Corridors: several signals along one road, placed by their real
 * locations and joined by the road between them.
 *
 * A corridor is an ordered list of signals, each with its design (from a
 * GTSS feed). Its layout projects every signal's latitude and longitude
 * into plan feet, finds the approach at each signal that faces the next one,
 * and joins each facing pair with a link road: a smooth curve from one
 * approach's end to the other's, carrying the first approach's lanes (its
 * receiving lanes become the next signal's approach lanes).
 *
 * Plan coordinates, as everywhere: feet, x east, y south.
 * Framework free.
 */

import { readTable, pick, rowSignal } from './gtss.js';
import { listSignals, designFromGtss } from './gtssMapping.js';
import { computeGeometry } from './geometry.js';
import { turnTargets, findLeg } from './model.js';

/** Feet per degree of latitude (and of longitude at the equator). */
export const FT_PER_DEG = 364600;
/** A link's approaches must point within this many degrees of each other's signal. */
export const ALIGN_DEG = 50;
const MIN_CLIP = 60;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
const unit = (a) => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const deg = (r) => (r * 180) / Math.PI;

const finite = (v) => v !== '' && v != null && Number.isFinite(Number(v));

/** Every signal in a feed, with its location and the streets it serves. */
export function feedSignals(files) {
  const f = files || {};
  const named = new Map(listSignals(f).map((s) => [s.id, s]));
  const located = new Map(readTable(f['signals.txt']).records.map((r) => [rowSignal(r.row), r.row]));
  const streets = new Map();
  for (const { row } of readTable(f['approaches.txt']).records) {
    const id = rowSignal(row);
    const street = String(pick(row, 'street_name') || '').trim();
    if (!id || !street) continue;
    if (!streets.has(id)) streets.set(id, new Set());
    streets.get(id).add(street);
  }
  return [...named.values()].map((s) => {
    const row = located.get(s.id);
    const lat = row ? pick(row, 'latitude') : '';
    const lon = row ? pick(row, 'longitude') : '';
    return {
      id: s.id,
      name: s.name,
      lat: finite(lat) ? Number(lat) : null,
      lon: finite(lon) ? Number(lon) : null,
      streets: [...(streets.get(s.id) || [])],
    };
  });
}

const streetKey = (name) => String(name || '').toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();

/** The signals with an approach on a street, by name (case and punctuation ignored). */
export function alongStreet(files, street) {
  const key = streetKey(street);
  return feedSignals(files).filter((s) => s.streets.some((name) => streetKey(name) === key)).map((s) => s.id);
}

/** Latitude and longitude to plan feet about an origin (equirectangular; fine over a few miles). */
export function toFeet(lat, lon, origin) {
  const k = Math.cos((origin.lat * Math.PI) / 180);
  return { x: (lon - origin.lon) * k * FT_PER_DEG, y: -(lat - origin.lat) * FT_PER_DEG };
}

/** Great-circle distance in feet, for checking the projection. */
export function haversineFt(a, b) {
  const R = 20902231; // earth radius, ft
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const located = (design) => finite(design.signal.lat) && finite(design.signal.lon);

/**
 * Orders signals along the corridor: by position along the line their
 * locations run in (the principal axis), west to east or north to south.
 * Signals without a location keep their place at the end.
 */
export function orderSignals(signals) {
  const placed = signals.filter((s) => located(s.design));
  const rest = signals.filter((s) => !located(s.design));
  if (placed.length < 2) return [...placed, ...rest];
  const origin = { lat: Number(placed[0].design.signal.lat), lon: Number(placed[0].design.signal.lon) };
  const pts = placed.map((s) => toFeet(Number(s.design.signal.lat), Number(s.design.signal.lon), origin));
  const mean = pts.reduce((m, p) => add(m, mul(p, 1 / pts.length)), { x: 0, y: 0 });
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const p of pts) {
    const d = sub(p, mean);
    xx += d.x * d.x;
    xy += d.x * d.y;
    yy += d.y * d.y;
  }
  // The principal axis of the 2x2 covariance.
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  let axis = { x: Math.cos(angle), y: Math.sin(angle) };
  // West to east, or for a north-south road, north to south.
  if (Math.abs(axis.x) >= Math.abs(axis.y) ? axis.x < 0 : axis.y < 0) axis = mul(axis, -1);
  const along = new Map(placed.map((s, i) => [s, dot(sub(pts[i], mean), axis)]));
  return [...placed.sort((a, b) => along.get(a) - along.get(b)), ...rest];
}

/** A new corridor from signals in a feed: their designs, in order along the road. */
export function makeCorridor(files, signalIds, { feedId = null, name = '' } = {}) {
  const signals = signalIds.map((id) => ({ signalId: String(id), design: designFromGtss(files, id) }));
  const ordered = orderSignals(signals);
  return {
    v: 1,
    name: name || corridorName(ordered),
    feedId,
    forward: true,
    signals: ordered,
  };
}

/** "Ygnacio Valley Road": the street most of the corridor's signals share. */
export function corridorName(signals) {
  const counts = new Map();
  for (const s of signals) {
    for (const street of new Set(s.design.legs.map((l) => l.street).filter(Boolean))) {
      counts.set(street, (counts.get(street) || 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? `${best[0]} corridor` : 'Corridor';
}

/** Corridor data from untrusted JSON (local storage), or null. */
export function normalizeCorridor(raw, normalizeDesign) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.signals)) return null;
  const signals = [];
  for (const s of raw.signals) {
    try {
      if (s && s.design) signals.push({ signalId: String(s.signalId || s.design.signal?.id || ''), design: normalizeDesign(s.design) });
    } catch {
      // a damaged signal is dropped, not the corridor
    }
  }
  return {
    v: 1,
    name: String(raw.name || corridorName(signals)),
    feedId: raw.feedId || null,
    forward: raw.forward !== false,
    signals,
  };
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/** The leg of a signal whose road points closest to a direction, and by how many degrees. */
function legToward(geom, dir) {
  let best = null;
  for (const g of geom.legs) {
    const c = dot(g.u, dir);
    if (!best || c > best.cos) best = { g, cos: c };
  }
  return best ? { g: best.g, angle: deg(Math.acos(Math.max(-1, Math.min(1, best.cos)))) } : null;
}

function cubic(p0, p1, p2, p3, t) {
  const m = 1 - t;
  return add(add(mul(p0, m * m * m), mul(p1, 3 * m * m * t)), add(mul(p2, 3 * m * t * t), mul(p3, t * t * t)));
}

function cubicTangent(p0, p1, p2, p3, t) {
  const m = 1 - t;
  return unit(add(add(mul(sub(p1, p0), 3 * m * m), mul(sub(p2, p1), 6 * m * t)), mul(sub(p3, p2), 3 * t * t)));
}

/**
 * The road between two facing approaches, sampled every few feet along a
 * cubic from A's leg end to B's. Lateral offsets are measured to the left
 * of the direction of travel from A to B, which is A's own cross-section
 * (x across A's leg); at B the same offsets are B's, negated.
 */
function linkRoad(A, B, ga, gb, ra, rb) {
  const p0 = add(A.offset, ga.world(ra, 0));
  const p3 = add(B.offset, gb.world(rb, 0));
  const reach = len(sub(p3, p0)) * 0.4;
  const p1 = add(p0, mul(ga.u, reach));
  const p2 = add(p3, mul(gb.u, reach));
  const n = Math.max(8, Math.ceil(len(sub(p3, p0)) / 8));
  // Lateral offsets run along A's own r at the start, so the normal is the
  // tangent turned a quarter, whichever way lines it up with A's r.
  const left = (v) => ({ x: -v.y, y: v.x });
  const flip = dot(left(cubicTangent(p0, p1, p2, p3, 0)), ga.r) < 0 ? -1 : 1;
  const points = [];
  let s = 0;
  let prev = null;
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const p = cubic(p0, p1, p2, p3, t);
    const tangent = cubicTangent(p0, p1, p2, p3, t);
    if (prev) s += len(sub(p, prev));
    prev = p;
    points.push({ x: p.x, y: p.y, t, s, tangent, normal: mul(left(tangent), flip) });
  }
  const length = s;
  // Cross-sections at each end, in the link's lateral frame.
  const csA = ga.cs;
  const csB = gb.cs;
  const ends = {
    a: {
      curbs: [csA.curbOut, csA.curbIn],
      median: csA.median,
      walks: [csA.sidewalkOut[0], csA.sidewalkIn[1]],
      lanes: { toB: csA.outbound.map((l) => [l.x0, l.x1]), toA: csA.inbound.map((l) => [l.x0, l.x1]) },
    },
    b: {
      curbs: [-csB.curbIn, -csB.curbOut],
      median: [-csB.median[1], -csB.median[0]],
      walks: [-csB.sidewalkIn[1], -csB.sidewalkOut[0]],
      lanes: { toB: csB.inbound.map((l) => [-l.x1, -l.x0]), toA: csB.outbound.map((l) => [-l.x1, -l.x0]) },
    },
  };
  return { points, length, ends, median: ga.leg.median.type === 'raised' && gb.leg.median.type === 'raised' ? 'raised' : 'paint' };
}

/** Interpolates a link's cross-section at t: { curbs, median, walks } in lateral feet. */
export function sectionAt(link, t) {
  const lerp = (a, b) => a + (b - a) * t;
  const { a, b } = link.road.ends;
  return {
    curbs: [lerp(a.curbs[0], b.curbs[0]), lerp(a.curbs[1], b.curbs[1])],
    median: [lerp(a.median[0], b.median[0]), lerp(a.median[1], b.median[1])],
    walks: [lerp(a.walks[0], b.walks[0]), lerp(a.walks[1], b.walks[1])],
  };
}

/** A point on a link: `s` feet along it, `x` feet to the left of travel toward B. */
export function linkPoint(link, s, x = 0) {
  const pts = link.road.points;
  const along = Math.max(0, Math.min(link.road.length, s));
  let i = 1;
  while (i < pts.length - 1 && pts[i].s < along) i += 1;
  const a = pts[i - 1];
  const b = pts[i];
  const k = b.s > a.s ? (along - a.s) / (b.s - a.s) : 0;
  const nx = a.normal.x + (b.normal.x - a.normal.x) * k;
  const ny = a.normal.y + (b.normal.y - a.normal.y) * k;
  const tx = a.tangent.x + (b.tangent.x - a.tangent.x) * k;
  const ty = a.tangent.y + (b.tangent.y - a.tangent.y) * k;
  return {
    x: a.x + (b.x - a.x) * k + nx * x,
    y: a.y + (b.y - a.y) * k + ny * x,
    tangent: unit({ x: tx, y: ty }),
    t: a.t + (b.t - a.t) * k,
  };
}

/**
 * Places a corridor: every signal at its location with its geometry, the
 * link road between each neighbouring pair, and each signal's chainage
 * (true distance along the corridor). Signals without a location are
 * listed in `unplaced` and left out.
 */
export function corridorLayout(corridor, { designFor } = {}) {
  const list = corridor.signals
    .map((s) => ({ ...s, design: (designFor && designFor(s)) || s.design }))
    .filter((s) => located(s.design));
  const unplaced = corridor.signals.filter((s) => !located(s.design)).map((s) => s.signalId);
  if (!list.length) return { signals: [], links: [], bounds: null, unplaced };
  const origin = { lat: Number(list[0].design.signal.lat), lon: Number(list[0].design.signal.lon) };
  const signals = list.map((s, index) => ({
    index,
    signalId: s.signalId,
    design: s.design,
    geom: computeGeometry(s.design),
    offset: toFeet(Number(s.design.signal.lat), Number(s.design.signal.lon), origin),
  }));

  // How far each intersection is drawn: up to half way to its nearest neighbour.
  for (const s of signals) {
    const far = Math.max(...s.geom.legs.map((g) => g.L), MIN_CLIP);
    const near = signals.filter((o) => o !== s).map((o) => len(sub(o.offset, s.offset)));
    s.clip = Math.max(MIN_CLIP, Math.min(far, near.length ? Math.min(...near) / 2 : far));
  }

  const links = [];
  for (let i = 0; i + 1 < signals.length; i += 1) {
    const A = signals[i];
    const B = signals[i + 1];
    const between = sub(B.offset, A.offset);
    const dist = len(between);
    const dir = unit(between);
    const fromA = legToward(A.geom, dir);
    const fromB = legToward(B.geom, mul(dir, -1));
    const aligned = !!(fromA && fromB && fromA.angle <= ALIGN_DEG && fromB.angle <= ALIGN_DEG);
    const link = {
      index: i,
      a: i,
      b: i + 1,
      dist,
      aligned,
      angles: [fromA ? fromA.angle : null, fromB ? fromB.angle : null],
      legA: aligned ? fromA.g.id : null,
      legB: aligned ? fromB.g.id : null,
    };
    if (aligned) {
      link.road = linkRoad(A, B, fromA.g, fromB.g, Math.min(A.clip, fromA.g.L), Math.min(B.clip, fromB.g.L));
      link.reachA = Math.min(A.clip, fromA.g.L); // where the link starts along A's leg
      link.reachB = Math.min(B.clip, fromB.g.L);
      // Stop bar to stop bar: the link and the two stretches of leg each side of it.
      link.travel = link.reachA + link.road.length + link.reachB;
    } else {
      link.travel = dist;
    }
    links.push(link);
  }

  // Chainage: each signal's centre, by the road between them.
  let s = 0;
  signals.forEach((sig, i) => {
    if (i > 0) s += links[i - 1].travel;
    sig.chainage = s;
  });

  const pts = signals.flatMap((sig) => [add(sig.offset, { x: -sig.clip, y: -sig.clip }), add(sig.offset, { x: sig.clip, y: sig.clip })]);
  for (const link of links) if (link.road) pts.push(...link.road.points);
  // Room on the sides for the signal names, which run wider than the roads.
  const xs = pts.map((p) => p.x);
  const pad = 60;
  const side = Math.max(pad, (Math.max(...xs) - Math.min(...xs)) * 0.12);
  const bounds = {
    minX: Math.min(...xs) - side,
    maxX: Math.max(...xs) + side,
    minY: Math.min(...pts.map((p) => p.y)) - pad,
    maxY: Math.max(...pts.map((p) => p.y)) + pad,
  };
  return { signals, links, bounds, unplaced };
}

/** The approach whose through movement leaves on a given leg. */
function approachInto(design, legId) {
  if (!legId) return null;
  return design.legs.find((leg) => leg.inbound.length && turnTargets(design, leg).T === legId) || null;
}

/**
 * The approaches and through phases that carry the corridor at each signal:
 * forward (from the first signal toward the last) and backward. Traffic
 * going forward arrives on the leg facing the previous signal; at the first
 * signal, on the approach whose through movement heads for the next one.
 */
export function corridorPhases(layout) {
  const { signals, links } = layout;
  return signals.map((sig, i) => {
    const toPrev = i > 0 && links[i - 1].aligned ? links[i - 1].legB : null;
    const toNext = i < links.length && links[i].aligned ? links[i].legA : null;
    const forwardLeg = toPrev ? findLeg(sig.design, toPrev) : approachInto(sig.design, toNext);
    const backwardLeg = toNext ? findLeg(sig.design, toNext) : approachInto(sig.design, toPrev);
    const phase = (leg) => (leg && leg.movements.T.phase) || null;
    return {
      index: i,
      forward: { legId: forwardLeg ? forwardLeg.id : null, phase: phase(forwardLeg) },
      backward: { legId: backwardLeg ? backwardLeg.id : null, phase: phase(backwardLeg) },
    };
  });
}
