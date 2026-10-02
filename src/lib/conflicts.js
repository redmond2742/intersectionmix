/**
 * Conflict points: where movements diverge, merge and cross, and where
 * vehicle paths cross pedestrian crossings.
 *
 * Each movement is one representative path (its middle lane), as in the
 * conflict diagrams of the FHWA and the Highway Safety Manual. The counts follow
 * those diagrams. An approach with n movements has n - 1 diverging points,
 * and an exit leg entered by n movements has n - 1 merging points. Crossing
 * points are found geometrically, where two paths from different approaches
 * cross. A four-leg intersection with lefts, throughs and rights from every
 * approach gives the textbook 32: 8 diverging, 8 merging, 16 crossing.
 *
 * Pedestrian conflicts are vehicle paths crossing a crosswalk: the
 * signalized crosswalks, and the uncontrolled crossings of free-right slips.
 *
 * With `phases`, only what runs together in that signal stage is counted.
 * This is what the signals leave behind: a permissive left yielding to
 * opposing through traffic, turns across a walking crosswalk, and free rights,
 * which are not signalized at all.
 *
 * Framework free.
 */

import { legTurns, turnTargets, usedPhases, TURN_LABELS } from './model.js';
import { movementPoints } from './geometry.js';
import { bearingToTravel } from './gtss.js';

export const CONFLICT_TYPES = {
  diverge: 'Diverging',
  merge: 'Merging',
  cross: 'Crossing',
  ped: 'Pedestrian',
};

/** NEMA phases that run together: ring 1 with ring 2, on the same side of the barrier. */
export const CONCURRENT_PAIRS = [
  ['1', '5'], ['1', '6'], ['2', '5'], ['2', '6'],
  ['3', '7'], ['3', '8'], ['4', '7'], ['4', '8'],
];

const TURN_ORDER = { U: 0, L: 1, T: 2, R: 3 };

/** Local coordinates of a plan point on a leg: { y } along it, { x } across it. */
const local = (g, p) => ({ y: p.x * g.u.x + p.y * g.u.y, x: p.x * g.r.x + p.y * g.r.y });

/**
 * Every movement, as a path: vehicles (one per approach and turn, plus each
 * free-right slip) and pedestrians (one per crosswalk).
 */
export function movements(design, geom) {
  const legs = design.legs;
  const vehicles = [];
  const peds = [];
  for (const g of geom.legs) {
    const leg = legs.find((l) => l.id === g.id) || g.leg;
    const travel = bearingToTravel(leg.bearing) || leg.approachId;
    const targets = turnTargets({ legs }, leg);
    for (const turn of legTurns(leg)) {
      const lanes = g.cs.inbound.filter((item) => item.lane.turns.includes(turn));
      const move = leg.movements[turn];
      const permissivePhase = (turn === 'L' || turn === 'U') && ['pp', 'fya'].includes(leg.movements.L.treatment)
        ? leg.movements.T.phase || null
        : null;
      if (lanes.length && targets[turn]) {
        const middle = Math.floor((lanes.length - 1) / 2);
        const path = movementPoints(geom, g.id, turn, lanes[middle], middle, lanes.length);
        if (path) {
          vehicles.push({
            id: `${g.id}:${turn}`,
            legId: g.id,
            turn,
            free: false,
            targetId: path.targetId,
            points: path.points,
            phase: move.phase || null,
            permissivePhase,
            label: `${travel} ${TURN_LABELS[turn].toLowerCase()}`,
          });
        }
      }
    }
    if (g.slip) {
      vehicles.push({
        id: `${g.id}:R:free`,
        legId: g.id,
        turn: 'R',
        free: true,
        mergesIn: g.slip.receiving.mode === 'merge',
        targetId: g.slip.targetId,
        points: g.slip.pathPoints,
        phase: null,
        permissivePhase: null,
        label: `${travel} free right`,
      });
      if (g.slip.crosswalk) {
        peds.push({ id: `${g.id}:ped:free`, legId: g.id, phase: null, uncontrolled: true, a: g.slip.crosswalk.a, b: g.slip.crosswalk.b, label: `${travel} free-right crossing` });
      }
    }
    if (leg.crosswalk.enabled) {
      const y = (g.cwStart + g.cwEnd) / 2;
      peds.push({
        id: `${g.id}:ped`,
        legId: g.id,
        phase: leg.crosswalk.pedPhase || null,
        uncontrolled: false,
        a: g.world(y, g.cs.curbOut),
        b: g.world(y, g.cs.curbIn),
        label: `Crosswalk across ${leg.street || `approach ${leg.approachId}`}`,
      });
    }
  }
  return { vehicles, peds };
}

/**
 * Signal stages: the NEMA pairs that run together, where both phases are in
 * use, then any phase in use that pairs with nothing (split phasing, a
 * T intersection's side street, an overlap) on its own.
 */
export function signalStages(design) {
  const used = usedPhases(design);
  const has = new Set(used);
  const stages = CONCURRENT_PAIRS
    .filter(([a, b]) => has.has(a) && has.has(b))
    .map(([a, b]) => ({ id: `${a}+${b}`, phases: [a, b], label: `Phases ${a} + ${b}` }));
  const paired = new Set(stages.flatMap((s) => s.phases));
  for (const phase of used) {
    if (!paired.has(phase)) stages.push({ id: phase, phases: [phase], label: `Phase ${phase}` });
  }
  return stages;
}

function servedVehicle(m, phases) {
  if (m.free) return true; // a free right is not signalized
  return phases.some((p) => p === m.phase || p === m.permissivePhase);
}

function servedPed(p, phases) {
  if (p.uncontrolled) return true;
  return phases.includes(p.phase);
}

/** Where segments p1-p2 and p3-p4 cross, or null. */
function segmentHit(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

function polylineHits(a, b) {
  const hits = [];
  for (let i = 0; i < a.length - 1; i += 1) {
    for (let j = 0; j < b.length - 1; j += 1) {
      const hit = segmentHit(a[i], a[i + 1], b[j], b[j + 1]);
      if (hit) hits.push(hit);
    }
  }
  return hits;
}

const near = (p, q, d) => Math.hypot(p.x - q.x, p.y - q.y) < d;

/**
 * The conflict points among all movements, or among those running in a
 * signal stage when `phases` is given. Returns
 * { points, vehicles, peds, counts }, each point being
 * { type, x, y, a, b } with a and b the movements involved.
 */
export function conflictPoints(design, geom, { phases = null } = {}) {
  const all = movements(design, geom);
  const vehicles = phases ? all.vehicles.filter((m) => servedVehicle(m, phases)) : all.vehicles;
  const peds = phases ? all.peds.filter((p) => servedPed(p, phases)) : all.peds;
  const points = [];
  const byLeg = (id) => geom.byId.get(id);
  const ordered = (list) => [...list].sort((a, b) => (a.free - b.free) || TURN_ORDER[a.turn] - TURN_ORDER[b.turn]);

  // Diverging: where each approach's movements split, inside to outside.
  const fromLeg = new Map();
  for (const m of vehicles) {
    if (!fromLeg.has(m.legId)) fromLeg.set(m.legId, []);
    fromLeg.get(m.legId).push(m);
  }
  for (const [legId, list] of fromLeg) {
    const g = byLeg(legId);
    const sorted = ordered(list);
    for (let k = 1; k < sorted.length; k += 1) {
      const a = sorted[k - 1];
      const b = sorted[k];
      let at;
      if (b.free) {
        at = g.slip.divergeAt;
      } else {
        const x = (local(g, a.points[0]).x + local(g, b.points[0]).x) / 2;
        at = g.world(g.S + 26 + (k - 1) * 9, x);
      }
      points.push({ type: 'diverge', x: at.x, y: at.y, a: a.id, b: b.id });
    }
  }

  // Merging: where movements join the same exit leg. A slip with a lane of its own joins nothing.
  const intoLeg = new Map();
  for (const m of vehicles) {
    if (m.free && !m.mergesIn) continue;
    if (!intoLeg.has(m.targetId)) intoLeg.set(m.targetId, []);
    intoLeg.get(m.targetId).push(m);
  }
  for (const [legId, list] of intoLeg) {
    const t = byLeg(legId);
    const lanes = list.filter((m) => !m.free);
    const exitX = (m) => local(t, m.points[m.points.length - 1]).x;
    const sorted = [...lanes].sort((a, b) => exitX(b) - exitX(a)); // inside lane first
    for (let k = 1; k < sorted.length; k += 1) {
      const x = (exitX(sorted[k - 1]) + exitX(sorted[k])) / 2;
      const at = t.world(t.cwEnd + 20 + (k - 1) * 9, x);
      points.push({ type: 'merge', x: at.x, y: at.y, a: sorted[k - 1].id, b: sorted[k].id });
    }
    for (const slip of list.filter((m) => m.free)) {
      const g = byLeg(slip.legId);
      if (sorted.length && g.slip.mergeAt) {
        points.push({ type: 'merge', x: g.slip.mergeAt.x, y: g.slip.mergeAt.y, a: sorted[sorted.length - 1].id, b: slip.id });
      }
    }
  }

  // Crossing: paths from different approaches that cross, short of any shared exit.
  for (let i = 0; i < vehicles.length; i += 1) {
    for (let j = i + 1; j < vehicles.length; j += 1) {
      const a = vehicles[i];
      const b = vehicles[j];
      if (a.legId === b.legId) continue;
      const shared = a.targetId === b.targetId ? byLeg(a.targetId) : null;
      const ends = [a.points[0], a.points[a.points.length - 1], b.points[0], b.points[b.points.length - 1]];
      for (const hit of polylineHits(a.points, b.points)) {
        if (shared && local(shared, hit).y > shared.D - 1) continue; // that is the merge, counted above
        if (ends.some((e) => near(e, hit, 1))) continue;
        // The same pair can register twice where a hit lands on a joint between
        // segments; different pairs crossing close together are separate conflicts.
        if (points.some((p) => p.type === 'cross' && p.a === a.id && p.b === b.id && near(p, hit, 2))) continue;
        points.push({ type: 'cross', x: hit.x, y: hit.y, a: a.id, b: b.id });
      }
    }
  }

  // Pedestrians: every vehicle path across a crossing that is in use.
  for (const ped of peds) {
    for (const m of vehicles) {
      for (const hit of polylineHits(m.points, [ped.a, ped.b])) {
        if (points.some((p) => p.type === 'ped' && p.b === ped.id && near(p, hit, 1.5))) continue;
        points.push({ type: 'ped', x: hit.x, y: hit.y, a: m.id, b: ped.id });
      }
    }
  }

  const counts = { diverge: 0, merge: 0, cross: 0, ped: 0 };
  for (const p of points) counts[p.type] += 1;
  counts.vehicle = counts.diverge + counts.merge + counts.cross;
  counts.total = counts.vehicle + counts.ped;
  return { points, vehicles, peds, counts };
}

/** "32 vehicle conflict points (8 diverging, 8 merging, 16 crossing) and 24 pedestrian" */
export function describeCounts(counts) {
  const parts = [`${counts.diverge} diverging`, `${counts.merge} merging`, `${counts.cross} crossing`];
  const vehicle = `${counts.vehicle} vehicle conflict point${counts.vehicle === 1 ? '' : 's'} (${parts.join(', ')})`;
  return counts.ped ? `${vehicle} and ${counts.ped} pedestrian` : vehicle;
}
