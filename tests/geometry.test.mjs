import { describe, test, expect } from 'vitest';
import { vectors, crossSection, computeGeometry, phaseMovements, phaseCrossings } from '../src/lib/geometry.js';
import { createTemplate, crosswalkLengthFt, TEMPLATES } from '../src/lib/model.js';

const close = (a, b) => Math.abs(a - b) < 1e-9;

describe('geometry', () => {
  test('a bearing of 90 (eastbound) is a leg extending west, approach lanes on its south side', () => {
    const { u, r } = vectors(90);
    expect(close(u.x, -1) && close(u.y, 0)).toBe(true);
    expect(close(r.x, 0) && close(r.y, 1)).toBe(true);
  });

  test('the cross-section adds up to the crossing distance', () => {
    const leg = createTemplate('four').legs[0];
    const cs = crossSection(leg);
    expect(cs.curbIn - cs.curbOut).toBe(crosswalkLengthFt(leg));
    expect(cs.inbound[0].x0).toBe(2); // half of a 4 ft painted median
  });

  test('stop bars clear the crossing street', () => {
    for (const { id } of TEMPLATES) {
      const geom = computeGeometry(createTemplate(id));
      for (const g of geom.legs) {
        expect(g.S).toBeGreaterThan(g.D);
        for (const other of geom.legs) {
          if (other === g) continue;
          // The stop bar's inside corner must not sit on another leg's roadway.
          const p = g.world(g.S, g.cs.inbound[0] ? g.cs.inbound[0].x0 : 0);
          const s = p.x * other.u.x + p.y * other.u.y;
          const x = p.x * other.r.x + p.y * other.r.y;
          const onOther = s > other.D && x > other.cs.curbOut && x < other.cs.curbIn;
          expect(onOther).toBe(false);
        }
      }
    }
  });

  test('phase 2 in the four-leg template carries through, right and the permissive left', () => {
    const design = createTemplate('four');
    const geom = computeGeometry(design);
    const moves = phaseMovements(design, geom, '2');
    const eb = design.legs[0];
    const wb = design.legs[1];
    expect(moves.filter((m) => m.legId === eb.id).map((m) => m.turn).sort()).toEqual(['L', 'R', 'T']);
    expect(moves.find((m) => m.legId === eb.id && m.turn === 'L').permissive).toBe(true);
    expect(moves.some((m) => m.legId === wb.id)).toBe(false);
    expect(phaseCrossings(design, geom, '2')).toHaveLength(1);
  });

  test('far advance detectors are compressed into view', () => {
    const design = createTemplate('four');
    design.legs[0].detectors.push({ ...design.legs[0].detectors[0], id: 'far', setback: 600, length: 6 });
    const geom = computeGeometry(design);
    const g = geom.legs[0];
    const far = g.detectors.find((d) => d.det.id === 'far');
    expect(far.y1).toBeLessThanOrEqual(g.L);
    expect(far.compressed).toBe(true);
    expect(g.breakAt).not.toBeNull();
  });
});
