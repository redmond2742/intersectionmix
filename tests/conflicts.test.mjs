import { describe, test, expect } from 'vitest';
import { conflictPoints, signalStages, movements, describeCounts } from '../src/lib/conflicts.js';
import { computeGeometry } from '../src/lib/geometry.js';
import { createTemplate, emptyDesign, makeLeg, autoAssignNema } from '../src/lib/model.js';

/** One lane per movement and no crosswalks: the textbook diagram's intersection. */
function textbook(bearings, lanes) {
  const design = emptyDesign();
  design.legs = bearings.map((bearing, i) => makeLeg({ approachId: String(i + 1), bearing, inbound: lanes[i], outbound: 1 }));
  autoAssignNema(design);
  for (const leg of design.legs) leg.crosswalk.enabled = false;
  return design;
}

const run = (design, opts) => conflictPoints(design, computeGeometry(design), opts);

describe('conflict points, all movements', () => {
  test('a four-leg intersection has the textbook 32: 8 diverging, 8 merging, 16 crossing', () => {
    const lanes = [['L'], ['T'], ['R']];
    const { counts, points } = run(textbook([0, 90, 180, 270], [lanes, lanes, lanes, lanes]));
    expect(counts).toMatchObject({ diverge: 8, merge: 8, cross: 16, ped: 0, vehicle: 32 });
    const pairs = {};
    for (const p of points.filter((q) => q.type === 'cross')) {
      const key = [p.a, p.b].map((id) => id.split(':')[1]).sort().join('-');
      pairs[key] = (pairs[key] || 0) + 1;
    }
    expect(pairs).toEqual({ 'L-L': 4, 'L-T': 8, 'T-T': 4 });
  });

  test('a T intersection has the textbook 9: 3 of each', () => {
    const { counts } = run(textbook([90, 270, 0], [[['T'], ['R']], [['L'], ['T']], [['L'], ['R']]]));
    expect(counts).toMatchObject({ diverge: 3, merge: 3, cross: 3, vehicle: 9 });
  });

  test('extra lanes do not change the count: one path per movement', () => {
    expect(run(createTemplate('four')).counts).toMatchObject({ diverge: 8, merge: 8, cross: 16 });
  });

  test('every vehicle path crossing a crosswalk is a pedestrian conflict', () => {
    const design = createTemplate('four');
    const all = run(design).counts.ped;
    expect(all).toBeGreaterThan(0);
    design.legs[0].crosswalk.enabled = false;
    expect(run(design).counts.ped).toBeLessThan(all);
  });
});

describe('free rights', () => {
  const withSlip = (receiving, ped = '') => {
    const design = createTemplate('four');
    design.legs[0].freeRight = { lanes: 1, ped, receiving, size: 'standard' };
    return design;
  };

  test('a slip adds a diverge, and a merge unless it has its own receiving lane', () => {
    const base = run(createTemplate('four')).counts;
    const merge = run(withSlip('merge')).counts;
    const added = run(withSlip('added')).counts;
    expect(merge.diverge).toBe(base.diverge + 1);
    expect(merge.merge).toBe(base.merge + 1);
    expect(added.merge).toBe(base.merge);
  });

  test('a slip with a crossing conflicts with pedestrians in every stage: it is not signalized', () => {
    const design = withSlip('merge', 'P');
    const geom = computeGeometry(design);
    const { peds } = movements(design, geom);
    expect(peds.some((p) => p.uncontrolled)).toBe(true);
    for (const stage of signalStages(design)) {
      const { points } = conflictPoints(design, geom, { phases: stage.phases });
      expect(points.some((p) => p.type === 'ped' && p.b.endsWith(':ped:free'))).toBe(true);
    }
  });
});

describe('signal stages', () => {
  test('stages are the concurrent NEMA pairs in use, plus unpaired phases alone', () => {
    expect(signalStages(createTemplate('four')).map((s) => s.id)).toEqual(['1+5', '1+6', '2+5', '2+6', '3+7', '3+8', '4+7', '4+8']);
    expect(signalStages(createTemplate('tee')).map((s) => s.id)).toEqual(['1+6', '2+6', '8']);
  });

  test('protected lefts conflict with nothing; the through stage keeps the permitted conflicts', () => {
    const design = createTemplate('four');
    expect(run(design, { phases: ['1', '5'] }).counts.total).toBe(0);
    const throughs = run(design, { phases: ['2', '6'] });
    // Each protected-permissive left yields to the opposing through: two crossings.
    expect(throughs.counts.cross).toBe(2);
    const crossings = throughs.points.filter((p) => p.type === 'cross').map((p) => [p.a, p.b].map((id) => id.split(':')[1]).sort().join('-'));
    expect(crossings).toEqual(['L-T', 'L-T']);
    // Turning traffic crosses the walking crosswalks.
    expect(throughs.counts.ped).toBeGreaterThan(0);
    expect(describeCounts(throughs.counts)).toMatch(/^8 vehicle conflict points/);
  });

  test('protected-only lefts leave the through stage with no crossings', () => {
    const design = createTemplate('four');
    for (const leg of design.legs) leg.movements.L.treatment = 'protected';
    expect(run(design, { phases: ['2', '6'] }).counts.cross).toBe(0);
  });
});
