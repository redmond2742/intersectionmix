/**
 * Plan-view geometry for a design, in feet.
 *
 * World coordinates are SVG-style: x east, y south. Each leg also has a
 * local frame, which is what most drawing uses:
 *
 *   X  across the leg, positive to the right of arriving traffic, so approach
 *      lanes have positive X and receiving lanes negative X;
 *   Y  distance out from the centre of the intersection.
 *
 * `leg.matrix` maps local to world, so a lane is an axis-aligned rectangle
 * inside <g transform="matrix(...)">. Approach traffic travels toward -Y.
 *
 * Cross-section, from the centreline outward on the approach side: half the
 * median, approach lanes (inside lane first, GTSS lane 1), bike lane, then,
 * behind an island, any free-right lanes, then sidewalk. The receiving side
 * mirrors it without the free rights.
 *
 * Framework free.
 */

import { medianWidth, turnTargets, findLeg, TURNS } from './model.js';

export const CROSSWALK_WIDTH = 10;
export const STOP_BAR_GAP = 4;
export const CORNER_RADIUS = 22;
export const ISLAND_WIDTH = 6;
export const FREE_LANE_WIDTH = 12;
/** How far past the stop bar a leg is drawn. */
export const VIEW_LENGTH = 150;
/** Beyond this distance past the stop bar, far detectors are drawn compressed. */
export const COMPRESS_FROM = 100;

const rad = (deg) => (deg * Math.PI) / 180;
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
const fmt = (n) => (Math.round(n * 100) / 100).toString();
export const pt = (p) => `${fmt(p.x)},${fmt(p.y)}`;

/** Unit vectors for a bearing: d = travel of arriving traffic, u = out along the leg, r = right of d. */
export function vectors(bearing) {
  const t = rad(bearing);
  const d = { x: Math.sin(t), y: -Math.cos(t) };
  return { d, u: { x: -d.x, y: -d.y }, r: { x: -d.y, y: d.x } };
}

const widthOf = (item) => Number(item.width) || 0;

/** Offsets across one leg, in local X. */
export function crossSection(leg) {
  const half = medianWidth(leg) / 2;
  let x = half;
  const inbound = leg.inbound.map((lane) => {
    const x0 = x;
    x += widthOf(lane);
    return { lane, x0, x1: x, cx: (x0 + x) / 2 };
  });
  const bikeIn = Number(leg.bikeIn) > 0 ? [x, (x += Number(leg.bikeIn))] : null;
  const curbIn = x;
  let island = null;
  const free = [];
  if (leg.freeRight && leg.freeRight.lanes > 0) {
    island = [x, (x += ISLAND_WIDTH)];
    for (let i = 0; i < leg.freeRight.lanes; i += 1) {
      const x0 = x;
      x += FREE_LANE_WIDTH;
      free.push({ x0, x1: x, cx: (x0 + x) / 2 });
    }
  }
  const outerIn = x;
  const sidewalk = Math.max(0, Number(leg.sidewalk) || 0);

  let y = -half;
  const outbound = leg.outbound.map((lane) => {
    const x1 = y;
    y -= widthOf(lane);
    return { lane, x0: y, x1, cx: (y + x1) / 2 };
  });
  const bikeOut = Number(leg.bikeOut) > 0 ? [y - Number(leg.bikeOut), y] : null;
  if (bikeOut) y -= Number(leg.bikeOut);
  const curbOut = y;

  return {
    median: [-half, half],
    inbound,
    bikeIn,
    curbIn,
    island,
    free,
    outerIn,
    sidewalkIn: [outerIn, outerIn + sidewalk],
    outbound,
    bikeOut,
    curbOut,
    sidewalkOut: [curbOut - sidewalk, curbOut],
  };
}

/** Where lines p + a*v and q + b*w meet, as { a, b }, or null when parallel. */
function intersect(p, v, q, w) {
  const det = v.x * -w.y - -w.x * v.y;
  if (Math.abs(det) < 1e-6) return null;
  const rhs = sub(q, p);
  const a = (rhs.x * -w.y - -w.x * rhs.y) / det;
  const b = (v.x * rhs.y - v.y * rhs.x) / det;
  return { a, b };
}

const outAngle = (g) => ((Math.atan2(g.u.y, g.u.x) * 180) / Math.PI + 360) % 360;

/**
 * The corner between two neighbouring legs: where the curb of each facing the
 * other meets. `offset` widens each edge (a sidewalk width, for the outer edge).
 */
function corner(gi, gj, offset = 0) {
  const sideI = dot(gj.u, gi.r) > 0 ? gi.cs.curbIn + offset : gi.cs.curbOut - offset;
  const sideJ = dot(gi.u, gj.r) > 0 ? gj.cs.curbIn + offset : gj.cs.curbOut - offset;
  const pI = mul(gi.r, sideI);
  const pJ = mul(gj.r, sideJ);
  const hit = intersect(pI, gi.u, pJ, gj.u);
  return { hit, pI, pJ, sideI, sideJ, point: hit ? add(pI, mul(gi.u, hit.a)) : null };
}

/**
 * Lays the design out. Returns per-leg geometry plus the shared shapes: the
 * asphalt and sidewalk cores that fill the middle, curb-return fillets, and
 * bounds for the viewBox.
 */
export function computeGeometry(design) {
  const legs = design.legs.map((leg) => {
    const { d, u, r } = vectors(leg.bearing);
    return { leg, id: leg.id, d, u, r, cs: crossSection(leg), D: 8 };
  });

  const order = [...legs].sort((a, b) => outAngle(a) - outAngle(b));
  const corners = [];
  if (order.length >= 2) {
    for (let i = 0; i < order.length; i += 1) {
      const gi = order[i];
      const gj = order[(i + 1) % order.length];
      if (gi === gj) continue;
      const gap = (outAngle(gj) - outAngle(gi) + 360) % 360;
      const inner = corner(gi, gj);
      const outer = corner(gi, gj, Math.max(Number(gi.leg.sidewalk) || 0, Number(gj.leg.sidewalk) || 0));
      const valid = gap > 2 && gap < 175 && inner.hit && inner.hit.a > -60 && inner.hit.b > -60;
      if (valid) {
        gi.D = Math.max(gi.D, Math.min(260, inner.hit.a + 4));
        gj.D = Math.max(gj.D, Math.min(260, inner.hit.b + 4));
      }
      corners.push({ gi, gj, gap, valid, inner, outer });
    }
  }

  // Every leg's stop bar sits behind its crosswalk, which sits at the box edge.
  for (const g of legs) {
    g.cwStart = g.D;
    g.cwEnd = g.leg.crosswalk.enabled ? g.D + CROSSWALK_WIDTH : g.D;
    g.S = g.cwEnd + STOP_BAR_GAP;
  }
  const far = Math.max(0, ...legs.map((g) => g.S)) + VIEW_LENGTH;

  for (const g of legs) {
    g.L = far;
    const maxEnd = Math.max(0, ...g.leg.detectors.map((det) => (Number(det.setback) || 0) + (Number(det.length) || 0)));
    const room = far - g.S - COMPRESS_FROM - 12;
    g.compress = maxEnd > COMPRESS_FROM + room ? room / (maxEnd - COMPRESS_FROM) : 1;
    g.breakAt = g.compress < 1 ? g.S + COMPRESS_FROM + 4 : null;
    /** Distance past the stop bar -> local Y, compressing far detectors. */
    g.mapY = (dist) => {
      const past = Math.max(0, dist);
      if (past <= COMPRESS_FROM || g.compress >= 1) return g.S + past;
      return g.S + COMPRESS_FROM + (past - COMPRESS_FROM) * g.compress;
    };
    g.matrix = `matrix(${fmt(g.r.x)} ${fmt(g.r.y)} ${fmt(g.u.x)} ${fmt(g.u.y)} 0 0)`;
    g.world = (y, x) => add(mul(g.u, y), mul(g.r, x));
    g.detectors = g.leg.detectors.map((det) => {
      const lane = det.laneId ? g.cs.inbound.find((item) => item.lane.id === det.laneId) : null;
      const x0 = lane ? lane.x0 + 1.2 : (g.cs.inbound[0] ? g.cs.inbound[0].x0 + 1.2 : g.cs.median[1]);
      const x1 = lane ? lane.x1 - 1.2 : (g.cs.inbound.length ? g.cs.inbound[g.cs.inbound.length - 1].x1 - 1.2 : g.cs.curbIn);
      const setback = Number(det.setback) || 0;
      const length = Math.max(1, Number(det.length) || 1);
      const y0 = g.mapY(setback);
      const y1 = Math.max(y0 + 2.5, g.mapY(setback + length));
      return { det, x0, x1, y0, y1, center: g.world((y0 + y1) / 2, (x0 + x1) / 2), compressed: setback + length > COMPRESS_FROM && g.compress < 1 };
    });
    g.handle = g.world(far + 12, (g.cs.curbIn + g.cs.curbOut) / 2);
    // The street label sits past the handle, far enough along the leg that
    // its box clears the handle whichever way the leg points.
    const name = g.leg.street || `Approach ${g.leg.approachId}`;
    g.labelWidth = Math.max(name.length * 4.3, 22 * 2.9);
    const clearX = Math.abs(g.u.x) > 1e-6 ? (g.labelWidth / 2 + 9) / Math.abs(g.u.x) : Infinity;
    const clearY = Math.abs(g.u.y) > 1e-6 ? 20 / Math.abs(g.u.y) : Infinity;
    g.labelAt = g.world(far + 12 + Math.min(clearX, clearY), (g.cs.curbIn + g.cs.curbOut) / 2);
    if (g.u.y < -0.5) g.labelAt = { x: g.labelAt.x, y: g.labelAt.y - 8 };
  }

  // The middle: a polygon through each corner, or through the curb points at
  // the centre where no corner forms (the open side of a T).
  const asphaltCore = [];
  const sidewalkCore = [];
  const fillets = [];
  for (const c of corners) {
    if (c.valid) {
      asphaltCore.push(c.inner.point);
      const outerOk = c.outer.hit && c.outer.hit.a > -80 && c.outer.hit.b > -80 && c.outer.hit.a < 400 && c.outer.hit.b < 400;
      if (outerOk) sidewalkCore.push(c.outer.point);
      else sidewalkCore.push(c.outer.pI, c.outer.pJ);
      const radius = Math.min(CORNER_RADIUS, Math.max(0, c.gi.L - c.inner.hit.a - 5), Math.max(0, c.gj.L - c.inner.hit.b - 5));
      if (radius > 1 && c.gap < 170) {
        const p1 = add(c.inner.point, mul(c.gi.u, radius));
        const p2 = add(c.inner.point, mul(c.gj.u, radius));
        fillets.push(`M${pt(p1)} Q${pt(c.inner.point)} ${pt(p2)} L${pt(c.inner.point)} Z`);
      }
    } else {
      asphaltCore.push(c.inner.pI, c.inner.pJ);
      sidewalkCore.push(c.outer.pI, c.outer.pJ);
    }
  }

  const byId = new Map(legs.map((g) => [g.id, g]));
  const points = [];
  for (const g of legs) {
    points.push(g.world(g.L, g.cs.sidewalkIn[1]), g.world(g.L, g.cs.sidewalkOut[0]), g.handle);
    points.push(
      { x: g.labelAt.x - g.labelWidth / 2, y: g.labelAt.y - 8 },
      { x: g.labelAt.x + g.labelWidth / 2, y: g.labelAt.y + 12 },
    );
    points.push(g.world(g.D, g.cs.sidewalkIn[1]), g.world(g.D, g.cs.sidewalkOut[0]));
  }
  points.push(...sidewalkCore, ...asphaltCore);
  if (!points.length) points.push({ x: -100, y: -100 }, { x: 100, y: 100 });
  const pad = 24;
  // An extra margin on the left holds the north arrow clear of the drawing.
  const bounds = {
    minX: Math.min(...points.map((p) => p.x)) - pad - 34,
    maxX: Math.max(...points.map((p) => p.x)) + pad,
    minY: Math.min(...points.map((p) => p.y)) - pad,
    maxY: Math.max(...points.map((p) => p.y)) + pad,
  };

  return { legs, byId, corners, asphaltCore, sidewalkCore, fillets, bounds, far };
}

/* ------------------------------------------------------------------ */
/* Movements                                                           */
/* ------------------------------------------------------------------ */

/** Local X of the receiving lane a turning lane enters. */
function exitX(target, turn, rank, count) {
  const out = target.cs.outbound;
  if (!out.length) return target.cs.median[0] - 5;
  let index;
  if (turn === 'L' || turn === 'U') index = Math.min(rank, out.length - 1);
  else if (turn === 'R') index = Math.max(0, out.length - count + rank);
  else index = Math.max(0, Math.min(out.length - 1, out.length - count + rank));
  return out[index].cx;
}

/** SVG path for one lane's movement, from upstream of the stop bar to past the far crosswalk. */
export function movementPath(geom, legId, turn, laneItem, rank = 0, count = 1) {
  const g = geom.byId.get(legId);
  if (!g) return null;
  const targets = turnTargets({ legs: geom.legs.map((item) => item.leg) }, g.leg);
  const target = geom.byId.get(targets[turn]);
  if (!target) return null;
  const x = laneItem.cx;
  const start = g.world(g.S + 22, x);
  const p0 = g.world(g.S, x);
  const tx = exitX(target, turn, rank, count);
  if (turn === 'U') {
    const p3 = g.world(g.S, tx);
    const k = Math.max(30, Math.abs(x - tx) * 1.2);
    const end = g.world(g.S + 22, tx);
    return `M${pt(start)} L${pt(p0)} C${pt(add(p0, mul(g.d, k)))} ${pt(add(p3, mul(g.d, k)))} ${pt(p3)} L${pt(end)}`;
  }
  const p3 = target.world(target.D, tx);
  const end = target.world(target.cwEnd + 16, tx);
  const k = Math.max(8, len(sub(p3, p0)) * 0.42);
  return `M${pt(start)} L${pt(p0)} C${pt(add(p0, mul(g.d, k)))} ${pt(sub(p3, mul(target.u, k)))} ${pt(p3)} L${pt(end)}`;
}

/** The free-right slip: from upstream of the stop bar, cutting the corner, into the target's outer lane. */
export function freeRightPath(geom, legId, index = 0) {
  const g = geom.byId.get(legId);
  if (!g || !g.cs.free[index]) return null;
  const targets = turnTargets({ legs: geom.legs.map((item) => item.leg) }, g.leg);
  const target = geom.byId.get(targets.R);
  if (!target) return null;
  const x = g.cs.free[index].cx;
  const start = g.world(g.S + 40, x);
  const p0 = g.world(g.S + 8, x);
  const outer = target.cs.outbound.length ? target.cs.outbound[target.cs.outbound.length - 1].cx : target.cs.curbOut + 6;
  const tx = outer - (target.cs.bikeOut ? 0 : 0);
  const p3 = target.world(target.cwEnd + 30, tx);
  const end = target.world(target.cwEnd + 50, tx);
  const k = Math.max(10, len(sub(p3, p0)) * 0.45);
  return `M${pt(start)} L${pt(p0)} C${pt(add(p0, mul(g.d, k)))} ${pt(sub(p3, mul(target.u, k)))} ${pt(p3)} L${pt(end)}`;
}

/**
 * Every movement served in a phase: one entry per lane (perLane) or one per
 * leg and turn. A protected-permissive or FYA left is also served,
 * permissively, in its approach's through phase.
 */
export function phaseMovements(design, geom, phase, { perLane = false } = {}) {
  const out = [];
  if (!phase) return out;
  for (const g of geom.legs) {
    const leg = findLeg(design, g.id) || g.leg;
    for (const turn of TURNS) {
      const move = leg.movements[turn];
      let permissive = null;
      if (move.phase === phase) permissive = turn === 'L' && move.treatment === 'permissive';
      else if (turn === 'L' && ['pp', 'fya'].includes(move.treatment) && leg.movements.T.phase === phase) permissive = true;
      else if (turn === 'U' && ['pp', 'fya'].includes(leg.movements.L.treatment) && leg.movements.T.phase === phase && move.phase === leg.movements.L.phase) permissive = true;
      if (permissive === null) continue;

      const lanes = g.cs.inbound.filter((item) => item.lane.turns.includes(turn));
      const chosen = perLane ? lanes : lanes.length ? [lanes[Math.floor((lanes.length - 1) / 2)]] : [];
      chosen.forEach((item) => {
        const rank = lanes.indexOf(item);
        const d = movementPath(geom, g.id, turn, item, perLane ? rank : Math.floor((lanes.length - 1) / 2), perLane ? lanes.length : lanes.length);
        if (d) out.push({ legId: g.id, laneId: item.lane.id, turn, permissive, d });
      });
      if (turn === 'R' && g.cs.free.length) {
        const d = freeRightPath(geom, g.id, 0);
        if (d) out.push({ legId: g.id, laneId: null, turn, permissive, d, free: true });
      }
    }
  }
  return out;
}

/** Crosswalks served in a phase, as a path across each. */
export function phaseCrossings(design, geom, phase) {
  const out = [];
  if (!phase) return out;
  for (const g of geom.legs) {
    const cw = g.leg.crosswalk;
    if (!cw.enabled || cw.pedPhase !== phase) continue;
    const y = (g.cwStart + g.cwEnd) / 2;
    const a = g.world(y, g.cs.curbOut - 2);
    const b = g.world(y, g.cs.curbIn + 2);
    out.push({ legId: g.id, d: `M${pt(a)} L${pt(b)}`, a, b });
  }
  return out;
}
