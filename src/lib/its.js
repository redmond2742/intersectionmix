/**
 * ITS and field equipment at the signal: the cabinet, CCTV cameras, the
 * detection system (with video detection cameras on the poles) and
 * preemption. An advanced setting; the design always carries it so it
 * survives autosave, share links and design files, but it is only shown and
 * edited when switched on. GTSS has no columns for it.
 *
 * Corners are named by their two legs (cornerKey in geometry.js), so they
 * survive legs being reordered or rotated.
 *
 * Framework free, and free of geometry: positions are in itsLayout.js.
 */

/** Cabinet types, with a rough footprint and height in feet for drawing. */
export const CABINET_TYPES = {
  332: { label: '332 (Caltrans, base)', w: 2, d: 2.5, h: 5.6 },
  '332D': { label: '332D (base, wide)', w: 3.7, d: 2.5, h: 5.6 },
  334: { label: '334 (pole)', w: 2, d: 1.7, h: 3.8, pole: true },
  336: { label: '336 (base)', w: 2, d: 1.6, h: 3.4 },
  '336S': { label: '336S (pole)', w: 2, d: 1.6, h: 3.4, pole: true },
  P: { label: 'P (NEMA, base)', w: 3.7, d: 2.2, h: 4.7 },
  M: { label: 'M (NEMA, base)', w: 2.5, d: 2, h: 4.3 },
  R: { label: 'R (NEMA, pole)', w: 2, d: 1.4, h: 3.8, pole: true },
  'TS-1': { label: 'NEMA TS-1', w: 3.7, d: 2.2, h: 4.7 },
  'TS-2 Type 1': { label: 'NEMA TS-2 Type 1', w: 3.7, d: 2.2, h: 4.7 },
  'TS-2 Type 2': { label: 'NEMA TS-2 Type 2', w: 3.7, d: 2.2, h: 4.7 },
  ATC: { label: 'ATC', w: 3.7, d: 2.2, h: 4.7 },
  pedestal: { label: 'Pedestal (pole-mounted)', w: 1.8, d: 1.2, h: 3, pole: true },
  other: { label: 'Other', w: 3, d: 2, h: 4.5 },
};

export const DETECTION_SYSTEMS = {
  loops: 'Inductive loops',
  video: 'Video detection',
  radar: 'Radar',
  mixed: 'Mixed (set per detector)',
};

/** The detector technology each system sets (mixed leaves detectors alone). */
export const SYSTEM_TECHNOLOGY = { loops: 'inductive_loop', video: 'video', radar: 'radar' };

export const PREEMPT_TYPES = {
  none: 'None',
  ir: 'Infrared (optical)',
  video: 'Video',
  cloud: 'Cloud / GPS',
};

let counter = 0;
export function itsId(prefix) {
  counter += 1;
  return `${prefix}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyIts() {
  return {
    cabinet: { type: '', corner: '', controller: '' },
    cctv: [],
    detection: { system: 'loops', cameras: [] },
    preemption: { type: 'none', legIds: [], numbers: {} },
  };
}

export function makeCctv(opts = {}) {
  return { id: itsId('cctv'), name: 'CCTV', corner: '', height: 30, heading: 0, tilt: -20, fov: 60, ...opts };
}

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v, fallback = '') => (v == null ? fallback : String(v));
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : fallback);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** ITS data from untrusted JSON, with defaults for anything missing. */
export function normalizeIts(raw) {
  const its = emptyIts();
  const r = obj(raw);
  const cab = obj(r.cabinet);
  its.cabinet = {
    type: CABINET_TYPES[cab.type] ? String(cab.type) : '',
    corner: str(cab.corner),
    controller: str(cab.controller),
  };
  its.cctv = arr(r.cctv).filter((c) => c && typeof c === 'object').map((c) => ({
    id: str(c.id) || itsId('cctv'),
    name: str(c.name, 'CCTV'),
    corner: str(c.corner),
    height: clamp(num(c.height, 30), 3, 200),
    heading: ((num(c.heading, 0) % 360) + 360) % 360,
    tilt: clamp(num(c.tilt, -20), -89, 30),
    fov: clamp(num(c.fov, 60), 10, 120),
  }));
  const det = obj(r.detection);
  its.detection = {
    system: DETECTION_SYSTEMS[det.system] ? det.system : 'loops',
    cameras: arr(det.cameras).filter((c) => c && typeof c === 'object')
      .map((c) => ({ id: str(c.id) || itsId('vcam'), legId: str(c.legId), corner: str(c.corner) })),
  };
  const pre = obj(r.preemption);
  its.preemption = {
    type: PREEMPT_TYPES[pre.type] ? pre.type : 'none',
    legIds: arr(pre.legIds).map(String),
    // Which preempt or priority number in the data belongs to each approach.
    numbers: Object.fromEntries(Object.entries(obj(pre.numbers)).map(([k, v]) => [String(k), str(v).trim()])),
  };
  return its;
}

/** True when anything has been entered. */
export function itsInUse(its) {
  if (!its) return false;
  return !!(its.cabinet.type || its.cctv.length || its.detection.system !== 'loops'
    || its.detection.cameras.length || its.preemption.type !== 'none');
}

/** Approaches that carry traffic in, which are the ones cameras and preemption watch. */
const approaches = (design) => design.legs.filter((leg) => leg.inbound.length);

/**
 * Sets the detection system. Loops, video and radar also set every
 * detector's technology; switching to video gives each approach a camera.
 */
export function setDetectionSystem(design, system) {
  const det = design.its.detection;
  det.system = DETECTION_SYSTEMS[system] ? system : 'loops';
  const tech = SYSTEM_TECHNOLOGY[det.system];
  if (tech) design.legs.forEach((leg) => leg.detectors.forEach((d) => { d.technology = tech; }));
  if ((det.system === 'video' || det.system === 'mixed') && !det.cameras.length) {
    setCameraCount(design, approaches(design).length);
  }
}

/** Grows or trims the video detection cameras: new ones go to the approaches with the fewest. */
export function setCameraCount(design, n) {
  const cams = design.its.detection.cameras;
  const count = clamp(Math.round(Number(n) || 0), 0, 32);
  cams.splice(count);
  const legs = approaches(design);
  while (cams.length < count && legs.length) {
    const tally = (leg) => cams.filter((c) => c.legId === leg.id).length;
    const leg = legs.reduce((best, l) => (tally(l) < tally(best) ? l : best), legs[0]);
    cams.push({ id: itsId('vcam'), legId: leg.id, corner: '' });
  }
}

/**
 * Which approaches a running priority request lights up, from a playback
 * snapshot: { legId: { kind, state, number } }.
 *
 * The data names a preempt or priority by number, which only the agency can
 * match to an approach, so each approach carries its number (set in the
 * equipment panel). Until any are set, every approach the preemption covers
 * lights up together, so something is still visible.
 */
export function priorityApproaches(design, snap) {
  const out = {};
  const running = snap && snap.priority ? Object.values(snap.priority) : [];
  if (!running.length) return out;
  const pre = design.its ? design.its.preemption : null;
  const covered = (pre && pre.legIds.length ? pre.legIds : design.legs.filter((l) => l.inbound.length).map((l) => l.id));
  const numbers = (pre && pre.numbers) || {};
  const assigned = covered.filter((id) => numbers[id]);
  for (const request of running) {
    const matched = assigned.filter((id) => numbers[id] === String(request.number));
    for (const legId of (matched.length ? matched : (assigned.length ? [] : covered))) {
      // A preempt outranks a priority request on the same approach.
      if (!out[legId] || (out[legId].kind === 'tsp' && request.kind === 'preempt')) out[legId] = request;
    }
  }
  return out;
}

/** Checks for the equipment, in the shape validate() returns. */
export function itsChecks(design, cornerIds) {
  const out = [];
  const its = design.its;
  if (!itsInUse(its)) return out;
  const corners = new Set(cornerIds);
  const legs = new Set(design.legs.map((l) => l.id));
  if (its.cabinet.type && its.cabinet.corner && !corners.has(its.cabinet.corner)) {
    out.push({ text: 'The cabinet is on a corner that no longer exists; it is drawn on the first corner.' });
  }
  its.cctv.forEach((c) => {
    if (c.corner && !corners.has(c.corner)) out.push({ text: `${c.name || 'A CCTV camera'} is on a corner that no longer exists.` });
  });
  its.detection.cameras.forEach((c, i) => {
    if (!legs.has(c.legId)) out.push({ text: `Detection camera ${i + 1} watches an approach that no longer exists.` });
  });
  return out;
}
