import { describe, test, expect } from 'vitest';
import { phaseSchedule, spaceTime, measure, distanceAlong, pointAlong, DEFAULT_TIMING } from '../src/lib/conflictTime.js';
import { computeGeometry } from '../src/lib/geometry.js';
import { createTemplate } from '../src/lib/model.js';

const kinds = (c) => [c.a, c.b].map((id) => id.split(':')[1]).sort().join('-');

describe('phase schedule', () => {
  test('dual ring: lefts lead, throughs follow, the cross street after the barrier', () => {
    const { windows, cycle } = phaseSchedule(createTemplate('four'));
    const { left, through, clearance } = DEFAULT_TIMING;
    expect(windows['1']).toEqual({ start: 0, end: left });
    expect(windows['5'].start).toBe(0);
    expect(windows['2'].start).toBe(left + clearance);
    const barrier = left + clearance + through + clearance;
    expect(windows['4'].start).toBe(barrier + left + clearance);
    expect(windows['8'].start).toBe(windows['4'].start);
    expect(cycle).toBe(barrier * 2);
  });

  test('a ring with less to do rests in its last phase until the barrier', () => {
    const design = createTemplate('tee'); // 1, 2 and 6 on the main street, 8 alone
    const { windows } = phaseSchedule(design);
    expect(windows['6'].start).toBe(0);
    expect(windows['6'].end).toBe(windows['2'].end);
  });
});

describe('polylines', () => {
  test('measure, project and walk along', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const cum = measure(pts);
    expect(cum).toEqual([0, 10, 20]);
    expect(distanceAlong(pts, cum, { x: 4, y: 3 })).toBeCloseTo(4);
    expect(pointAlong(pts, cum, 15)).toEqual({ x: 10, y: 5 });
    expect(pointAlong(pts, cum, 25)).toBeNull();
  });
});

describe('conflicts in time', () => {
  const design = createTemplate('four');
  const geom = computeGeometry(design);

  test('with no signals, crossing throughs meet within seconds', () => {
    const { conflicts } = spaceTime(design, geom, { mode: 'none' });
    const tt = conflicts.filter((c) => c.type === 'cross' && kinds(c) === 'T-T');
    expect(tt.length).toBe(4);
    expect(tt.every((c) => c.live)).toBe(true);
  });

  test('with signal timing, the signal separates crossing throughs by a phase', () => {
    const { conflicts } = spaceTime(design, geom, { mode: 'signal' });
    const tt = conflicts.filter((c) => c.type === 'cross' && kinds(c) === 'T-T');
    expect(tt.every((c) => !c.live && c.gap > 20)).toBe(true);
  });

  test('what the signal permits stays live: a permissive left against opposing traffic', () => {
    const { conflicts, counts } = spaceTime(design, geom, { mode: 'signal' });
    const permitted = conflicts.filter((c) => c.type === 'cross' && c.live);
    expect(permitted.length).toBeGreaterThan(0);
    expect(permitted.every((c) => kinds(c) === 'L-T')).toBe(true);
    expect(counts.live).toBeLessThan(spaceTime(design, geom, { mode: 'none' }).counts.live);
  });

  test('protected-permissive lefts run twice: protected, then permissive with the through', () => {
    const { tracks } = spaceTime(design, geom, { mode: 'signal' });
    const left = tracks.find((t) => t.id === `${design.legs[0].id}:L`);
    expect(left.runs.map((r) => r.permissive)).toEqual([false, true]);
  });
});
