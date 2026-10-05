/**
 * Where the ITS equipment stands, in plan feet: one layout for the plan
 * drawing and the 3D view, so they always agree. Built on the mast-arm
 * poles (signalPoles) and the named corners from computeGeometry.
 *
 * Framework free.
 */

import { signalPoles } from './geometry.js';
import { makePin } from './cameras.js';
import { CABINET_TYPES } from './its.js';

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
const len = (a) => Math.hypot(a.x, a.y);
const round1 = (n) => Math.round(n * 10) / 10;

/** Compass heading of a plan direction (x east, y south). */
export function headingOf(v) {
  return ((Math.atan2(v.x, -v.y) * 180) / Math.PI + 360) % 360;
}

/** How far the dome hangs out from its pole, and how far below the mount the lens sits, in feet. */
export const DOME_REACH = 2.2;
const LENS_DROP = 0.6;

/**
 * The camera-pin pose for a CCTV mounted at a plan point, for viewCone and
 * the 3D camera: at the lens, out on its arm and inside the dome, so the
 * view is not blocked by its own housing.
 */
export function cctvPin(cctv, point) {
  const h = ((Number(cctv.heading) || 0) * Math.PI) / 180;
  return makePin({
    id: cctv.id,
    name: cctv.name,
    x: point.x + Math.sin(h) * DOME_REACH,
    y: point.y - Math.cos(h) * DOME_REACH,
    base: 0,
    height: (Number(cctv.height) || 30) - LENS_DROP,
    heading: Number(cctv.heading) || 0,
    tilt: Number(cctv.tilt) || 0,
    fov: Number(cctv.fov) || 60,
  });
}

/** Heading and tilt that look from a mount at the middle of the intersection. */
export function aimAtCentre(cctv, point) {
  const dist = Math.max(10, len(point));
  return {
    heading: Math.round(headingOf(mul(point, -1))),
    tilt: round1(-((Math.atan((Number(cctv.height) || 30) / dist) * 180) / Math.PI)),
  };
}

/**
 * Round loops, 6 ft across, along a loop detector: about one per 9 ft of its
 * length, in each lane it covers. In the leg's local frame, like the
 * detector rectangle. Shrinks where a far detector is drawn compressed.
 */
export function loopCircles(g, item) {
  const { det } = item;
  const lanes = det.laneId ? g.cs.inbound.filter((l) => l.lane.id === det.laneId) : g.cs.inbound;
  const length = Math.max(1, Number(det.length) || 1);
  const n = Math.max(1, Math.round(length / 9));
  const drawn = item.y1 - item.y0;
  const out = [];
  for (const lane of lanes) {
    const r = Math.max(0.6, Math.min(3, drawn / n / 2 - 0.3, (lane.x1 - lane.x0) / 2 - 0.8));
    for (let i = 0; i < n; i += 1) out.push({ x: lane.cx, y: item.y0 + (drawn * (i + 0.5)) / n, r });
  }
  return out;
}

/**
 * Everything's position: { poles, cabinet, cctv, detectionCams, preempt }.
 * Mast-arm poles always; the rest only when entered. Each item has a plan
 * `point`, and cameras a compass `heading`.
 */
export function equipmentLayout(design, geom) {
  const its = design.its;
  const poles = signalPoles(design, geom);
  const corners = geom.corners;
  const cornerById = new Map(corners.map((c) => [c.id, c]));
  const fallback = corners.find((c) => c.valid) || corners[0] || null;
  const cornerOf = (id) => cornerById.get(id) || fallback;
  /** On a corner: its mast-arm pole when it has one, else the corner's sidewalk. */
  const mountOn = (id) => {
    const c = cornerOf(id);
    if (!c) return { point: { x: 0, y: 0 }, corner: null, pole: null };
    const pole = poles.find((p) => p.cornerId === c.id);
    return { point: pole ? pole.point : c.mount, corner: c, pole: pole || null };
  };
  const out = { poles, cabinet: null, cctv: [], detectionCams: [], preempt: [], cloud: false };
  if (!its) return out;

  if (its.cabinet.type) {
    const c = cornerOf(its.cabinet.corner);
    if (c) {
      const spec = CABINET_TYPES[its.cabinet.type] || CABINET_TYPES.other;
      const pole = spec.pole ? mountOn(c.id) : null;
      out.cabinet = {
        point: pole ? lerp(pole.point, c.back, 0.25) : c.back,
        heading: headingOf(mul(c.out, -1)), // its door faces the intersection
        spec,
        type: its.cabinet.type,
        corner: c,
      };
    }
  }

  for (const cctv of its.cctv) {
    const mount = mountOn(cctv.corner);
    out.cctv.push({ cctv, point: mount.point, corner: mount.corner, onPole: !!mount.pole, pin: cctvPin(cctv, mount.point) });
  }

  const legGeom = (legId) => geom.byId.get(legId);
  if (its.detection.system === 'video' || its.detection.system === 'mixed') {
    its.detection.cameras.forEach((cam, i) => {
      const g = legGeom(cam.legId);
      if (!g || !g.cs.inbound.length) return;
      const watch = g.world(g.S + 60, (g.cs.inbound[0].x0 + g.cs.curbIn) / 2);
      let point;
      if (cam.corner) point = mountOn(cam.corner).point;
      else {
        const pole = poles.find((p) => p.legId === g.id);
        point = pole ? lerp(pole.point, pole.armEnd, 0.4) : g.world(-10, g.cs.curbIn);
      }
      // Several cameras on one arm sit side by side.
      const same = its.detection.cameras.slice(0, i).filter((c) => c.legId === cam.legId && c.corner === cam.corner).length;
      if (same) point = add(point, mul(g.r, -3 * same));
      out.detectionCams.push({ cam, index: i + 1, legId: g.id, point, heading: headingOf(sub(watch, point)) });
    });
  }

  const pre = its.preemption;
  if (pre.type !== 'none') {
    const covered = pre.legIds.length ? pre.legIds : design.legs.filter((l) => l.inbound.length).map((l) => l.id);
    for (const legId of covered) {
      const g = legGeom(legId);
      if (!g || !g.cs.inbound.length) continue;
      const pole = poles.find((p) => p.legId === g.id);
      const point = pole ? lerp(pole.point, pole.armEnd, 0.75) : g.world(-10, g.cs.curbIn);
      out.preempt.push({ legId, type: pre.type, point, heading: headingOf(g.u), reach: g.world(g.S + 150, (g.cs.inbound[0].x0 + g.cs.curbIn) / 2) });
    }
    out.cloud = pre.type === 'cloud';
  }
  return out;
}
