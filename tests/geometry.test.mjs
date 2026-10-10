import { describe, test, expect } from 'vitest';
import { vectors, crossSection, computeGeometry, phaseMovements, phaseCrossings, SLIP_SIZES } from '../src/lib/geometry.js';
import { createTemplate, crosswalkLengthFt, TEMPLATES, addStopBarDetectors, normalizeDesign } from '../src/lib/model.js';

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

  describe('free-right slip', () => {
    const withSlip = (receiving, size = 'standard') => {
      const design = createTemplate('four');
      design.legs[0].freeRight = { lanes: 1, ped: 'P', receiving, size }; // EB, turning right onto the south leg
      return { design, geom: computeGeometry(design) };
    };
    const local = (g, p) => ({ y: p.x * g.u.x + p.y * g.u.y, x: p.x * g.r.x + p.y * g.r.y });

    test('is not part of the cross-section', () => {
      const { design } = withSlip('merge');
      const cs = crossSection(design.legs[0]);
      expect(cs.sidewalkIn[0]).toBe(cs.curbIn);
    });

    test('leaves the approach at its curb and joins the receiving leg at its curb', () => {
      const { design, geom } = withSlip('merge');
      const g = geom.byId.get(design.legs[0].id);
      const t = geom.byId.get(g.slip.targetId);
      expect(t.leg.approachId).toBe(design.legs[2].approachId); // the NB approach's leg, south
      const n = g.slip.asphalt.length / 2;
      const innerStart = local(g, g.slip.asphalt[g.slip.asphalt.length - 1]);
      const innerEnd = local(t, g.slip.asphalt[n]);
      // The slip leaves each curb at an angle, so the island's tips are wedges.
      const second = local(g, g.slip.asphalt[g.slip.asphalt.length - 2]);
      expect(second.x - innerStart.x).toBeGreaterThan(0.3);
      expect(innerStart.x).toBeCloseTo(g.cs.curbIn, 6);
      expect(innerEnd.x).toBeCloseTo(t.cs.curbOut, 6);
      expect(g.slip.island).toMatch(/^M.+Q.+Z$/);
      expect(g.slip.crosswalk).not.toBeNull();
    });

    test('the island stays in the corner, clear of both roadways', () => {
      const { design, geom } = withSlip('merge');
      const g = geom.byId.get(design.legs[0].id);
      const t = geom.byId.get(g.slip.targetId);
      const nums = g.slip.island.match(/-?\d+(\.\d+)?/g).map(Number);
      for (let i = 0; i < nums.length; i += 2) {
        const p = { x: nums[i], y: nums[i + 1] };
        const a = local(g, p);
        const b = local(t, p);
        expect(a.x).toBeGreaterThanOrEqual(g.cs.curbIn - 0.01);
        expect(b.x).toBeLessThanOrEqual(t.cs.curbOut + 0.01);
      }
    });

    test('merges within a taper, or runs to the end of the leg as its own lane', () => {
      const merge = withSlip('merge');
      const added = withSlip('added');
      const gm = merge.geom.byId.get(merge.design.legs[0].id);
      const ga = added.geom.byId.get(added.design.legs[0].id);
      const tm = merge.geom.byId.get(gm.slip.targetId);
      const ta = added.geom.byId.get(ga.slip.targetId);
      const far = (g, t) => Math.max(...g.slip.receiving.asphalt.map((p) => local(t, p).y));
      expect(far(gm, tm)).toBeCloseTo(tm.cwEnd + SLIP_SIZES.standard.end + SLIP_SIZES.standard.merge, 6);
      expect(gm.slip.receiving.teeth.length).toBeGreaterThan(0);
      expect(far(ga, ta)).toBeCloseTo(ta.L, 6);
      expect(ga.slip.receiving.teeth).toHaveLength(0);
    });

    test('the right turn is drawn along the slip', () => {
      const { design, geom } = withSlip('added');
      const moves = phaseMovements(design, geom, design.legs[0].movements.R.phase);
      expect(moves.some((m) => m.free && m.d === geom.byId.get(design.legs[0].id).slip.path)).toBe(true);
    });

    test('compact puts the island at the crosswalks, with no deceleration lane', () => {
      const sizes = ['compact', 'standard', 'long'].map((size) => {
        const { design, geom } = withSlip('merge', size);
        const g = geom.byId.get(design.legs[0].id);
        const t = geom.byId.get(g.slip.targetId);
        const tipA = local(g, g.slip.asphalt[g.slip.asphalt.length - 1]).y;
        const tipB = local(t, g.slip.asphalt[g.slip.asphalt.length / 2]).y;
        return { g, t, tipA, tipB, slip: g.slip };
      });
      const [compact, standard, long] = sizes;
      expect(compact.tipA).toBeCloseTo(compact.g.cwEnd + SLIP_SIZES.compact.start, 6);
      expect(compact.tipB).toBeCloseTo(compact.t.cwEnd + SLIP_SIZES.compact.end, 6);
      expect(compact.slip.taper.line).toBeNull();
      expect(compact.slip.island).not.toBeNull();
      expect(compact.tipA).toBeLessThan(standard.tipA);
      expect(standard.tipA).toBeLessThan(long.tipA);
      // Long tapers are squeezed to stay on the leg as drawn.
      const reach = Math.max(...long.slip.taper.asphalt.map((p) => local(long.g, p).y));
      expect(reach).toBeLessThanOrEqual(long.g.L);
    });
  });

  test('each approach has a speed limit sign beside its label, inside the drawing', () => {
    const design = createTemplate('four');
    design.legs[3].speed = '';
    const geom = computeGeometry(design);
    for (const g of geom.legs.slice(0, 3)) {
      expect(g.speedSign.limit).toBe(Number(g.leg.speed));
      expect(g.speedSign.x).toBeGreaterThan(g.labelTextX + g.textWidth / 2 - 0.01);
      expect(g.speedSign.x + g.speedSign.w).toBeLessThanOrEqual(geom.bounds.maxX);
      expect(g.speedSign.y).toBeGreaterThanOrEqual(geom.bounds.minY);
    }
    expect(geom.legs[3].speedSign).toBeNull();
  });
});

describe('bike boxes and arrows', () => {
  test('a bike box moves the stop bar back by its depth, and the detectors with it', () => {
    const design = createTemplate('four');
    const leg = design.legs[0];
    addStopBarDetectors(design, leg);
    const other = design.legs[1].id;
    const plain = computeGeometry(design);
    const before = plain.byId.get(leg.id);
    leg.bikeBox = { on: true, depth: 14 };
    const boxed = computeGeometry(design);
    const after = boxed.byId.get(leg.id);
    expect(after.bikeStop).toBe(before.S); // cyclists stop where vehicles used to
    expect(after.S).toBe(before.S + 14);
    expect(after.detectors[0].y0).toBeCloseTo(before.detectors[0].y0 + 14);
    // Other approaches are untouched.
    expect(boxed.byId.get(other).S).toBe(plain.byId.get(other).S);
  });

  test('the options survive a design file, with sensible defaults', () => {
    const design = createTemplate('four');
    expect(design.legs[0].bikeBox).toEqual({ on: false, depth: 14 });
    design.legs[0].bikeBox = { on: true, depth: 99 };
    design.legs[0].bikeArrows = true;
    design.legs[0].sidewalkArrows = 'traffic';
    design.legs[1].sidewalkArrows = 'sideways';
    const back = normalizeDesign(JSON.parse(JSON.stringify(design)));
    expect(back.legs[0].bikeBox).toEqual({ on: true, depth: 30 }); // clamped
    expect(back.legs[0].bikeArrows).toBe(true);
    expect(back.legs[0].sidewalkArrows).toBe('traffic');
    expect(back.legs[1].sidewalkArrows).toBe('none');
  });
});
