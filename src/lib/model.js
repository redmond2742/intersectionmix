/**
 * The Intersection Mix design model.
 *
 * A design is a list of legs (GTSS approaches). Each leg has a cross-section
 * -- sidewalk, bike lane, receiving lanes, median, approach lanes -- and a
 * phase for each movement it carries. Phases belong to movements, not lanes:
 * a shared through-right lane is one lane carrying two movements, and both
 * of them are served by whatever phase the through and the right are given.
 *
 * Distances are feet. Bearings follow GTSS: the heading of traffic arriving
 * at the intersection, so a leg with bearing 90 carries eastbound traffic
 * and extends west of the intersection.
 *
 * Every operation mutates the design it is given, which is what immer's
 * produce() expects, and is also the simplest thing to test.
 *
 * Framework free.
 */

import { bearingToTravel, compareIds } from './gtss.js';

export const DESIGN_VERSION = 1;
export const TURNS = ['U', 'L', 'T', 'R'];
export const TURN_LABELS = { U: 'U-turn', L: 'Left', T: 'Through', R: 'Right' };
export const DEFAULT_LANE_WIDTH = 11;

/** Left-turn treatment -> the movement_type GTSS uses for a left-only lane. */
export const LEFT_TREATMENTS = { protected: 'L', permissive: 'TL', pp: 'LPP', fya: 'FYA' };
export const LEFT_TREATMENT_LABELS = {
  protected: 'Protected',
  permissive: 'Permissive',
  pp: 'Protected-permissive',
  fya: 'Flashing yellow arrow',
};

export const PURPOSES = ['stop bar', 'advanced', 'count'];
export const MODES = ['presence', 'pulse'];
export const TECHNOLOGIES = ['inductive_loop', 'radar', 'microwave', 'lidar', 'magnetometer', 'hybrid', 'video'];
export const VEHICLE_TYPES = ['', 'car', 'truck', 'bus', 'bicycle'];
export const MEDIAN_TYPES = { none: 'None (double yellow)', paint: 'Painted', raised: 'Raised' };
export const FREE_RIGHT_PED = { '': 'No crossing', P: 'Ped crossing', PI: 'Ped crossing, improved' };

let counter = 0;
export function uid(prefix = 'id') {
  counter += 1;
  return `${prefix}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function normBearing(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

/** Signed difference a - b folded into (-180, 180]. */
export function angleDiff(a, b) {
  let d = (((a - b) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

/* ------------------------------------------------------------------ */
/* Construction                                                        */
/* ------------------------------------------------------------------ */

export function makeLane(turns = ['T'], width = DEFAULT_LANE_WIDTH) {
  return { id: uid('lane'), width, turns: canonicalTurns(turns) };
}

export function makeOutbound(width = DEFAULT_LANE_WIDTH) {
  return { id: uid('out'), width };
}

export function emptyMovements() {
  return { U: { phase: '' }, L: { phase: '', treatment: 'protected' }, T: { phase: '' }, R: { phase: '' } };
}

export function makeLeg(opts = {}) {
  const { inbound, outbound, ...rest } = opts;
  return {
    id: uid('leg'),
    approachId: '',
    street: '',
    bearing: 0,
    speed: 30,
    inbound: (inbound || []).map((turns) => (Array.isArray(turns) ? makeLane(turns) : turns)),
    outbound: typeof outbound === 'number'
      ? Array.from({ length: outbound }, () => makeOutbound())
      : (outbound || []),
    median: { type: 'none', width: 0 },
    bikeIn: 0,
    bikeOut: 0,
    sidewalk: 8,
    movements: emptyMovements(),
    crosswalk: { enabled: true, pedPhase: '', length: '', lengthSig: null },
    freeRight: { lanes: 0, ped: '' },
    detectors: [],
    extra: {},
    ...rest,
  };
}

export function makeDetector(opts = {}) {
  return {
    id: uid('det'),
    channel: '',
    laneId: null, // null: spans every approach lane
    laneNumber: '', // only when an imported lane number matched no lane
    phase: '', // blank: follow the lane's movement
    purpose: 'stop bar',
    mode: 'presence',
    technology: 'inductive_loop',
    vehicleType: '',
    description: '',
    length: 40,
    setback: 0,
    extra: {},
    ...opts,
  };
}

export function emptyDesign() {
  return {
    v: DESIGN_VERSION,
    name: 'Untitled intersection',
    signal: { id: '1', agencyId: '', lat: '', lon: '', extra: {} },
    legs: [],
    scramble: false,
    overlaps: [],
    diagonals: [],
    phaseRowExtra: {},
    unplacedDetectors: [],
    notes: [],
    source: null,
  };
}

/* ------------------------------------------------------------------ */
/* Lanes and turns                                                     */
/* ------------------------------------------------------------------ */

export function canonicalTurns(turns) {
  const set = new Set(turns || []);
  return TURNS.filter((t) => set.has(t));
}

export function turnsKey(turns) {
  return canonicalTurns(turns).join('');
}

/** Inside-to-outside order a lane naturally sits in. */
const LANE_RANK = { U: 0, UL: 0.5, L: 1, LT: 2, ULT: 2, LTR: 3, T: 3, LR: 3.5, TR: 4, R: 5 };
export function laneRank(turns) {
  return LANE_RANK[turnsKey(turns)] ?? 3;
}

export function findLeg(design, legId) {
  return design.legs.find((leg) => leg.id === legId) || null;
}

export function findLane(leg, laneId) {
  return leg ? leg.inbound.find((lane) => lane.id === laneId) || null : null;
}

export function laneIndex(leg, laneId) {
  return leg ? leg.inbound.findIndex((lane) => lane.id === laneId) : -1;
}

/** Adds a lane where it belongs (lefts inside, rights outside) unless told where. */
export function addLane(leg, turns = ['T'], index) {
  const lane = makeLane(turns);
  let at = index;
  if (at == null) {
    const rank = laneRank(lane.turns);
    at = 0;
    leg.inbound.forEach((existing, i) => {
      if (laneRank(existing.turns) <= rank) at = i + 1;
    });
  }
  leg.inbound.splice(Math.max(0, Math.min(at, leg.inbound.length)), 0, lane);
  return lane;
}

export function moveLane(leg, from, to) {
  if (from === to || from < 0 || from >= leg.inbound.length) return;
  const [lane] = leg.inbound.splice(from, 1);
  leg.inbound.splice(Math.max(0, Math.min(to, leg.inbound.length)), 0, lane);
}

export function removeLane(leg, laneId) {
  leg.inbound = leg.inbound.filter((lane) => lane.id !== laneId);
  leg.detectors = leg.detectors.filter((det) => det.laneId !== laneId);
}

export function setLaneTurns(leg, laneId, turns) {
  const lane = findLane(leg, laneId);
  if (lane) lane.turns = canonicalTurns(turns);
}

/** Every movement the leg's lanes carry. */
export function legTurns(leg) {
  const set = new Set();
  for (const lane of leg.inbound) lane.turns.forEach((t) => set.add(t));
  if (leg.freeRight && leg.freeRight.lanes > 0) set.add('R');
  return TURNS.filter((t) => set.has(t));
}

/** True when the leg has a lane that carries lefts and nothing else but U-turns. */
export function hasDedicatedLeft(leg) {
  return leg.inbound.some((lane) => ['L', 'UL'].includes(turnsKey(lane.turns)));
}

/** The phase a detector on this lane calls when none is set: through first. */
export function lanePhase(leg, lane) {
  const turns = lane ? lane.turns : legTurns(leg);
  for (const t of ['T', 'L', 'R', 'U']) {
    if (turns.includes(t) && leg.movements[t].phase) return leg.movements[t].phase;
  }
  return '';
}

export function detectorPhase(leg, det) {
  if (det.phase) return det.phase;
  return lanePhase(leg, findLane(leg, det.laneId));
}

/* ------------------------------------------------------------------ */
/* Legs                                                                */
/* ------------------------------------------------------------------ */

export function nextApproachId(design) {
  const ids = design.legs.map((leg) => String(leg.approachId));
  const prefix = `${design.signal.id}-`;
  const prefixed = ids.filter((id) => id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length)));
  if (prefixed.length && prefixed.length >= ids.length / 2) {
    const max = Math.max(...prefixed.map((id) => Number(id.slice(prefix.length))));
    return `${prefix}${max + 1}`;
  }
  const numeric = ids.filter((id) => /^\d+$/.test(id)).map(Number);
  return String((numeric.length ? Math.max(...numeric) : 0) + 1);
}

/** A bearing in the middle of the widest gap between existing legs. */
export function openBearing(design) {
  const outs = design.legs.map((leg) => normBearing(leg.bearing + 180)).sort((a, b) => a - b);
  if (!outs.length) return 90;
  if (outs.length === 1) return normBearing(outs[0] + 180 + 180);
  let best = { gap: -1, at: 0 };
  outs.forEach((a, i) => {
    const b = i + 1 < outs.length ? outs[i + 1] : outs[0] + 360;
    if (b - a > best.gap) best = { gap: b - a, at: a + (b - a) / 2 };
  });
  // best.at is where the leg extends; its bearing is the reciprocal.
  return normBearing(best.at + 180);
}

export function addLeg(design, opts = {}) {
  const leg = makeLeg({
    approachId: nextApproachId(design),
    street: 'New Street',
    bearing: opts.bearing ?? openBearing(design),
    inbound: [['L'], ['T', 'R']],
    outbound: 1,
    ...opts,
  });
  design.legs.push(leg);
  return leg;
}

export function removeLeg(design, legId) {
  design.legs = design.legs.filter((leg) => leg.id !== legId);
}

export function setBearing(leg, bearing) {
  leg.bearing = normBearing(bearing);
}

/** "Main Street (EB)" */
export function legLabel(leg) {
  if (!leg) return '';
  const travel = bearingToTravel(leg.bearing);
  const name = leg.street || `Approach ${leg.approachId}`;
  return travel ? `${name} (${travel})` : name;
}

/** The leg across the intersection, if one lies within 40 degrees of opposite. */
export function oppositeLeg(design, leg) {
  let best = null;
  let bestErr = 40;
  for (const other of design.legs) {
    if (other === leg || other.id === leg.id) continue;
    const err = Math.abs(Math.abs(angleDiff(other.bearing, leg.bearing)) - 180);
    if (err <= bestErr) {
      best = other;
      bestErr = err;
    }
  }
  return best;
}

/**
 * Which leg each movement leaves on. The turn angle is from the heading of
 * arriving traffic to the heading of traffic leaving along the target leg
 * (its bearing plus 180): about 0 for through, +90 right, -90 left.
 */
export function turnTargets(design, leg) {
  const others = design.legs
    .filter((other) => other.id !== leg.id)
    .map((other) => ({ other, delta: angleDiff(other.bearing + 180, leg.bearing) }));
  const through = others
    .filter((o) => Math.abs(o.delta) < 60)
    .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
  const rest = others.filter((o) => o !== through);
  const right = rest
    .filter((o) => o.delta > 15)
    .sort((a, b) => Math.abs(a.delta - 90) - Math.abs(b.delta - 90))[0];
  const left = rest
    .filter((o) => o.delta < -15)
    .sort((a, b) => Math.abs(a.delta + 90) - Math.abs(b.delta + 90))[0];
  return {
    T: through ? through.other.id : null,
    L: left ? left.other.id : null,
    R: right ? right.other.id : null,
    U: leg.id,
  };
}

/* ------------------------------------------------------------------ */
/* Phases                                                              */
/* ------------------------------------------------------------------ */

export function comparePhases(a, b) {
  return compareIds(a, b);
}

export function isOverlap(design, phase) {
  if (!phase) return false;
  return (design.overlaps || []).includes(phase) || !/^\d+$/.test(String(phase));
}

/** Every phase a movement or crosswalk uses, sorted. */
export function usedPhases(design) {
  const set = new Set();
  for (const leg of design.legs) {
    for (const t of legTurns(leg)) if (leg.movements[t].phase) set.add(String(leg.movements[t].phase));
    if (leg.crosswalk.enabled && leg.crosswalk.pedPhase) set.add(String(leg.crosswalk.pedPhase));
  }
  return [...set].sort(comparePhases);
}

/**
 * Standard NEMA numbering. The pair of legs closest to opposite with the most
 * lanes is the main street: 2 and 6 through, 1 and 5 left, with 1 the left
 * that crosses 2 (it sits on 6's approach). The cross street takes 4 and 8,
 * 3 and 7 the same way, with 4 a quarter turn clockwise from 2.
 *
 * A left with no lane of its own runs permissively with its through phase; an
 * unopposed left (a T or one-way) is protected in its through phase. Crosswalks
 * take their leg's through phase, following GTSS pedX = 1: the crosswalk on
 * the same approach as the phase.
 */
export function autoAssignNema(design) {
  const legs = design.legs;
  const lanes = (leg) => leg.inbound.length;
  const isOpposite = (a, b) => Math.abs(Math.abs(angleDiff(a.bearing, b.bearing)) - 180) <= 40;

  const bestPair = (pool) => {
    let best = null;
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = i + 1; j < pool.length; j += 1) {
        if (!isOpposite(pool[i], pool[j])) continue;
        const score = lanes(pool[i]) + lanes(pool[j]) + (pool[i].speed + pool[j].speed) / 1000;
        if (!best || score > best.score) best = { score, pair: [pool[i], pool[j]] };
      }
    }
    return best ? best.pair : null;
  };

  const northOrEast = (leg) => {
    const b = normBearing(leg.bearing);
    return b >= 315 || b < 135;
  };

  let main = bestPair(legs);
  if (!main) {
    const widest = [...legs].sort((a, b) => lanes(b) - lanes(a))[0];
    main = widest ? [widest, null] : [null, null];
  }
  let [a, b] = main;
  if (a && b && !northOrEast(a) && northOrEast(b)) [a, b] = [b, a];

  const rest = legs.filter((leg) => leg !== a && leg !== b);
  let side = bestPair(rest);
  if (!side) {
    const ranked = rest.length && a
      ? [...rest].sort((x, y) => Math.abs(angleDiff(x.bearing, a.bearing + 90)) - Math.abs(angleDiff(y.bearing, a.bearing + 90)))
      : rest;
    side = [ranked[0] || null, null];
  }
  let [c, d] = side;
  if (a && c && d && Math.abs(angleDiff(d.bearing, a.bearing + 90)) < Math.abs(angleDiff(c.bearing, a.bearing + 90))) {
    [c, d] = [d, c];
  }
  // A lone cross leg is phase 4 or 8 depending on which side it lies.
  if (a && c && !d && Math.abs(angleDiff(c.bearing, a.bearing + 90)) > 90) {
    [c, d] = [null, c];
  }

  const plan = new Map();
  if (a) plan.set(a, { T: '2', L: '5', opposed: !!b });
  if (b) plan.set(b, { T: '6', L: '1', opposed: !!a });
  if (c) plan.set(c, { T: '4', L: '7', opposed: !!d });
  if (d) plan.set(d, { T: '8', L: '3', opposed: !!c });

  const taken = new Set([...plan.values()].flatMap((p) => [p.T, p.L]));
  const nextFree = () => {
    for (let n = 1; n < 99; n += 1) {
      if (!taken.has(String(n))) {
        taken.add(String(n));
        return String(n);
      }
    }
    return '';
  };
  for (const leg of legs) {
    if (!plan.has(leg)) {
      const phase = nextFree();
      plan.set(leg, { T: phase, L: phase, opposed: false });
    }
  }

  for (const leg of legs) {
    const p = plan.get(leg);
    const turns = legTurns(leg);
    const moves = emptyMovements();
    const dedicated = leg.inbound.filter((lane) => ['L', 'UL'].includes(turnsKey(lane.turns))).length;
    if (turns.includes('T')) moves.T.phase = p.T;
    if (turns.includes('R')) moves.R.phase = p.T;
    if (turns.includes('L')) {
      if (!p.opposed) {
        moves.L = { phase: p.T, treatment: 'protected' };
      } else if (!dedicated) {
        moves.L = { phase: p.T, treatment: 'permissive' };
      } else {
        moves.L = { phase: p.L, treatment: dedicated > 1 ? 'protected' : 'pp' };
      }
    }
    if (turns.includes('U')) moves.U.phase = moves.L.phase || p.L;
    // A leg with no through lanes still needs a phase for its other movements.
    if (!turns.includes('T') && turns.includes('R') && !turns.includes('L')) moves.R.phase = p.T;
    leg.movements = moves;
    leg.crosswalk.pedPhase = leg.crosswalk.enabled ? p.T : leg.crosswalk.pedPhase;
  }
  return design;
}

/* ------------------------------------------------------------------ */
/* Detectors                                                           */
/* ------------------------------------------------------------------ */

export function allDetectors(design) {
  return design.legs.flatMap((leg) => leg.detectors.map((det) => ({ leg, det })));
}

export function nextChannel(design) {
  const used = new Set([
    ...allDetectors(design).map(({ det }) => Number(det.channel)),
    ...(design.unplacedDetectors || []).map((row) => Number(row.channel)),
  ]);
  let n = 1;
  while (used.has(n)) n += 1;
  return String(n);
}

/** Roughly five seconds of travel upstream, to the nearest five feet. */
export function advanceSetback(speed) {
  const mph = Number(speed) || 35;
  return Math.max(60, Math.round((mph * 1.467 * 5) / 5) * 5);
}

export function addDetector(design, leg, opts = {}) {
  const purpose = opts.purpose || 'stop bar';
  const det = makeDetector({
    channel: nextChannel(design),
    purpose,
    mode: purpose === 'stop bar' ? 'presence' : 'pulse',
    length: purpose === 'stop bar' ? 40 : 6,
    setback: purpose === 'advanced' ? advanceSetback(leg.speed) : 0,
    ...opts,
  });
  leg.detectors.push(det);
  return det;
}

/** One stop-bar detector per approach lane that does not already have one. */
export function addStopBarDetectors(design, leg) {
  const added = [];
  for (const lane of leg.inbound) {
    const has = leg.detectors.some((det) => det.laneId === lane.id && det.purpose === 'stop bar');
    if (!has) added.push(addDetector(design, leg, { laneId: lane.id, purpose: 'stop bar' }));
  }
  return added;
}

/** Advance detection on each lane carrying through traffic. */
export function addAdvanceDetectors(design, leg) {
  const added = [];
  for (const lane of leg.inbound) {
    if (!lane.turns.includes('T')) continue;
    const has = leg.detectors.some((det) => det.laneId === lane.id && det.purpose === 'advanced');
    if (!has) added.push(addDetector(design, leg, { laneId: lane.id, purpose: 'advanced' }));
  }
  return added;
}

/**
 * Renumbers every placed detector 1..n: by the phase it calls, then stop bar
 * before advance, then lane from the inside out. Channels an import could not
 * place are left alone, and skipped.
 */
export function autoNumberChannels(design) {
  const reserved = new Set((design.unplacedDetectors || []).map((row) => Number(row.channel)));
  const purposeRank = (p) => (p === 'stop bar' ? 0 : p === 'advanced' ? 1 : 2);
  const list = allDetectors(design).map(({ leg, det }) => ({
    det,
    phase: detectorPhase(leg, det),
    purpose: purposeRank(det.purpose),
    lane: det.laneId ? laneIndex(leg, det.laneId) : 99,
    setback: Number(det.setback) || 0,
  }));
  list.sort((x, y) => comparePhases(x.phase || '999', y.phase || '999')
    || x.purpose - y.purpose || x.setback - y.setback || x.lane - y.lane);
  let n = 1;
  for (const item of list) {
    while (reserved.has(n)) n += 1;
    item.det.channel = String(n);
    n += 1;
  }
  return design;
}

export function findDetector(design, detId) {
  for (const leg of design.legs) {
    const det = leg.detectors.find((d) => d.id === detId);
    if (det) return { leg, det };
  }
  return null;
}

export function removeDetector(design, detId) {
  for (const leg of design.legs) leg.detectors = leg.detectors.filter((d) => d.id !== detId);
}

/* ------------------------------------------------------------------ */
/* Cross-section                                                       */
/* ------------------------------------------------------------------ */

const sum = (list) => list.reduce((total, item) => total + (Number(item.width) || 0), 0);

export function medianWidth(leg) {
  return leg.median && leg.median.type !== 'none' ? Math.max(0, Number(leg.median.width) || 0) : 0;
}

/** Curb to curb, the distance a pedestrian crosses. Free-right lanes have their own crossing. */
export function crosswalkLengthFt(leg) {
  return Math.round(
    sum(leg.inbound) + sum(leg.outbound) + medianWidth(leg)
      + (Number(leg.bikeIn) || 0) + (Number(leg.bikeOut) || 0),
  );
}

/** Changes whenever the crossing distance could have. */
export function crossSectionSig(leg) {
  return [
    leg.inbound.map((l) => l.width).join('/'),
    leg.outbound.map((l) => l.width).join('/'),
    leg.median.type, medianWidth(leg), leg.bikeIn, leg.bikeOut,
  ].join('|');
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

/** Problems worth showing, each tied to a leg where it has one. */
export function validate(design) {
  const out = [];
  const warn = (text, legId = null) => out.push({ level: 'warn', text, legId });

  const ids = new Map();
  for (const leg of design.legs) {
    const label = legLabel(leg);
    if (!String(leg.approachId).trim()) warn(`${label} has no approach ID.`, leg.id);
    else if (ids.has(String(leg.approachId))) warn(`Approach ID ${leg.approachId} is used twice.`, leg.id);
    ids.set(String(leg.approachId), leg);

    for (const t of legTurns(leg)) {
      if (!leg.movements[t].phase) warn(`${label}: ${TURN_LABELS[t].toLowerCase()} has no phase.`, leg.id);
    }
    leg.inbound.forEach((lane, i) => {
      const key = turnsKey(lane.turns);
      if (!key) warn(`${label}: lane ${i + 1} carries no movement.`, leg.id);
      if (key === 'LTR' || key === 'LR' || key === 'ULT' || key === 'ULTR') {
        warn(`${label}: lane ${i + 1} (${key}) has no GTSS movement type; it exports as the nearest one.`, leg.id);
      }
    });
    if (leg.crosswalk.enabled && !leg.crosswalk.pedPhase) warn(`${label}: the crosswalk has no ped phase.`, leg.id);

    for (const det of leg.detectors) {
      if (det.laneId && !findLane(leg, det.laneId)) warn(`${label}: detector ${det.channel} is on a lane that no longer exists.`, leg.id);
      if (!detectorPhase(leg, det)) warn(`${label}: detector ${det.channel || '(no channel)'} calls no phase.`, leg.id);
      if (!String(det.channel).trim()) warn(`${label}: a detector has no channel.`, leg.id);
    }
  }

  const channels = new Map();
  for (const { leg, det } of allDetectors(design)) {
    const ch = String(det.channel).trim();
    if (!ch) continue;
    if (channels.has(ch)) warn(`Channel ${ch} is used by more than one detector.`, leg.id);
    channels.set(ch, leg);
  }

  for (let i = 0; i < design.legs.length; i += 1) {
    for (let j = i + 1; j < design.legs.length; j += 1) {
      const a = design.legs[i];
      const b = design.legs[j];
      if (Math.abs(angleDiff(a.bearing, b.bearing)) < 20) {
        warn(`${legLabel(a)} and ${legLabel(b)} are within 20° of each other.`, b.id);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export const TEMPLATES = [
  { id: 'four', label: 'Four-leg arterial' },
  { id: 'tee', label: 'T intersection' },
  { id: 'skew', label: 'Skewed four-leg' },
  { id: 'five', label: 'Five-leg' },
];

function arterialLeg(approachId, bearing, street, speed) {
  return makeLeg({
    approachId, bearing, street, speed,
    inbound: [['L'], ['T'], ['T', 'R']],
    outbound: 2,
    median: { type: 'paint', width: 4 },
    bikeIn: 5,
    bikeOut: 5,
    sidewalk: 10,
  });
}

function sideLeg(approachId, bearing, street, speed = 25) {
  return makeLeg({ approachId, bearing, street, speed, inbound: [['L'], ['T', 'R']], outbound: 1 });
}

export function createTemplate(id = 'four') {
  const design = emptyDesign();
  if (id === 'tee') {
    design.name = 'Main Street & Oak Avenue';
    design.legs = [
      makeLeg({ approachId: '1', bearing: 90, street: 'Main Street', speed: 40, inbound: [['T'], ['T', 'R']], outbound: 2, sidewalk: 10 }),
      makeLeg({ approachId: '2', bearing: 270, street: 'Main Street', speed: 40, inbound: [['L'], ['T'], ['T']], outbound: 2, sidewalk: 10 }),
      makeLeg({ approachId: '3', bearing: 0, street: 'Oak Avenue', speed: 25, inbound: [['L'], ['R']], outbound: 1 }),
    ];
    design.legs[0].crosswalk.enabled = false;
  } else if (id === 'skew') {
    design.name = 'Main Street & Canal Road';
    design.legs = [
      arterialLeg('1', 90, 'Main Street', 40),
      arterialLeg('2', 270, 'Main Street', 40),
      sideLeg('3', 30, 'Canal Road', 30),
      sideLeg('4', 210, 'Canal Road', 30),
    ];
  } else if (id === 'five') {
    design.name = 'Main Street, Oak Avenue & Old County Road';
    design.legs = [
      arterialLeg('1', 90, 'Main Street', 40),
      arterialLeg('2', 270, 'Main Street', 40),
      sideLeg('3', 0, 'Oak Avenue'),
      sideLeg('4', 180, 'Oak Avenue'),
      makeLeg({ approachId: '5', bearing: 135, street: 'Old County Road', speed: 30, inbound: [['L', 'T'], ['R']], outbound: 1 }),
    ];
  } else {
    design.name = 'Main Street & Oak Avenue';
    design.legs = [
      arterialLeg('1', 90, 'Main Street', 40),
      arterialLeg('2', 270, 'Main Street', 40),
      sideLeg('3', 0, 'Oak Avenue'),
      sideLeg('4', 180, 'Oak Avenue'),
    ];
  }
  autoAssignNema(design);
  for (const leg of design.legs) {
    addStopBarDetectors(design, leg);
    if (leg.speed >= 35) addAdvanceDetectors(design, leg);
  }
  autoNumberChannels(design);
  return design;
}

/* ------------------------------------------------------------------ */
/* Normalising designs from storage or a share link                    */
/* ------------------------------------------------------------------ */

const str = (value, fallback = '') => (value == null ? fallback : String(value));
const num = (value, fallback) => (Number.isFinite(Number(value)) && value !== '' && value != null ? Number(value) : fallback);
const obj = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const arr = (value) => (Array.isArray(value) ? value : []);

/**
 * Rebuilds a design from untrusted JSON, filling anything missing with a
 * default. Throws only when the input is not a design at all.
 */
export function normalizeDesign(input) {
  const raw = obj(input);
  if (!Array.isArray(raw.legs)) throw new Error('Not an Intersection Mix design.');
  const design = emptyDesign();
  design.name = str(raw.name, design.name);
  const signal = obj(raw.signal);
  design.signal = {
    id: str(signal.id, '1'), agencyId: str(signal.agencyId), lat: str(signal.lat), lon: str(signal.lon), extra: obj(signal.extra),
  };
  design.scramble = !!raw.scramble;
  design.overlaps = arr(raw.overlaps).map(String);
  design.diagonals = arr(raw.diagonals).filter((d) => d && typeof d === 'object');
  design.phaseRowExtra = obj(raw.phaseRowExtra);
  design.unplacedDetectors = arr(raw.unplacedDetectors).filter((d) => d && typeof d === 'object');
  design.notes = arr(raw.notes).map(String);
  design.source = raw.source && typeof raw.source === 'object' ? raw.source : null;

  design.legs = raw.legs.map((rawLeg) => {
    const l = obj(rawLeg);
    const leg = makeLeg();
    if (l.id) leg.id = str(l.id);
    leg.approachId = str(l.approachId);
    leg.street = str(l.street);
    leg.bearing = normBearing(l.bearing);
    leg.speed = num(l.speed, 30);
    leg.inbound = arr(l.inbound).map((lane) => ({
      id: str(obj(lane).id) || uid('lane'),
      width: num(obj(lane).width, DEFAULT_LANE_WIDTH),
      turns: canonicalTurns(arr(obj(lane).turns)),
    }));
    leg.outbound = arr(l.outbound).map((lane) => ({
      id: str(obj(lane).id) || uid('out'),
      width: num(obj(lane).width, DEFAULT_LANE_WIDTH),
    }));
    const median = obj(l.median);
    leg.median = { type: MEDIAN_TYPES[median.type] ? median.type : 'none', width: num(median.width, 0) };
    leg.bikeIn = num(l.bikeIn, 0);
    leg.bikeOut = num(l.bikeOut, 0);
    leg.sidewalk = num(l.sidewalk, 8);
    const moves = obj(l.movements);
    for (const t of TURNS) {
      leg.movements[t].phase = str(obj(moves[t]).phase);
    }
    const treatment = obj(moves.L).treatment;
    leg.movements.L.treatment = LEFT_TREATMENTS[treatment] ? treatment : 'protected';
    const cw = obj(l.crosswalk);
    leg.crosswalk = {
      enabled: cw.enabled !== false,
      pedPhase: str(cw.pedPhase),
      length: str(cw.length),
      lengthSig: cw.lengthSig == null ? null : str(cw.lengthSig),
    };
    const fr = obj(l.freeRight);
    leg.freeRight = { lanes: Math.max(0, Math.round(num(fr.lanes, 0))), ped: FREE_RIGHT_PED[fr.ped] !== undefined ? fr.ped : '' };
    leg.extra = obj(l.extra);
    leg.detectors = arr(l.detectors).map((rawDet) => {
      const d = obj(rawDet);
      return makeDetector({
        id: str(d.id) || uid('det'),
        channel: str(d.channel),
        laneId: d.laneId ? str(d.laneId) : null,
        laneNumber: str(d.laneNumber),
        phase: str(d.phase),
        purpose: str(d.purpose, 'stop bar'),
        mode: str(d.mode, 'presence'),
        technology: str(d.technology, 'inductive_loop'),
        vehicleType: str(d.vehicleType),
        description: str(d.description),
        length: num(d.length, 6),
        setback: num(d.setback, 0),
        extra: obj(d.extra),
      });
    });
    return leg;
  });
  return design;
}
