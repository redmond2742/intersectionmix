import { describe, test, expect } from 'vitest';
import {
  normalizeIts, emptyIts, itsInUse, setDetectionSystem, setCameraCount, makeCctv, itsChecks,
} from '../src/lib/its.js';
import { equipmentLayout, loopCircles, aimAtCentre, headingOf } from '../src/lib/itsLayout.js';
import { computeGeometry, cornerKey, signalPoles } from '../src/lib/geometry.js';
import { createTemplate, normalizeDesign, addDetector } from '../src/lib/model.js';
import { loadSettings, DEFAULT_SETTINGS } from '../src/lib/store.js';

describe('ITS data', () => {
  test('defaults, junk dropped, and older designs without it still load', () => {
    expect(normalizeIts(undefined)).toEqual(emptyIts());
    const its = normalizeIts({
      cabinet: { type: '332', corner: 'a|b' },
      cctv: [{ name: 'North cam', fov: 500, tilt: 'x' }, 'junk'],
      detection: { system: 'telepathy', cameras: [{ legId: 'L1' }] },
      preemption: { type: 'ir', legIds: [1, 2] },
    });
    expect(its.cabinet.type).toBe('332');
    expect(its.cctv).toHaveLength(1);
    expect(its.cctv[0]).toMatchObject({ name: 'North cam', fov: 120, tilt: -20, height: 30 });
    expect(its.detection.system).toBe('loops');
    expect(its.detection.cameras[0].legId).toBe('L1');
    expect(its.preemption).toEqual({ type: 'ir', legIds: ['1', '2'], numbers: {} });

    const old = createTemplate('four');
    delete old.its;
    const loaded = normalizeDesign(JSON.parse(JSON.stringify(old)));
    expect(loaded.its).toEqual(emptyIts());
    expect(itsInUse(loaded.its)).toBe(false);
  });

  test('corner keys do not care about leg order', () => {
    expect(cornerKey('b', 'a')).toBe(cornerKey('a', 'b'));
  });

  test('switching to video sets every detector and gives each approach a camera', () => {
    const design = createTemplate('four');
    design.legs.forEach((leg) => addDetector(design, leg, { laneId: leg.inbound[0].id }));
    setDetectionSystem(design, 'video');
    const techs = design.legs.flatMap((leg) => leg.detectors.map((d) => d.technology));
    expect(techs.length).toBeGreaterThan(0);
    expect(techs.every((t) => t === 'video')).toBe(true);
    const cams = design.its.detection.cameras;
    expect(cams).toHaveLength(4);
    expect(new Set(cams.map((c) => c.legId)).size).toBe(4);

    setCameraCount(design, 6);
    expect(cams).toHaveLength(6);
    setCameraCount(design, 2);
    expect(cams).toHaveLength(2);

    setDetectionSystem(design, 'mixed');
    expect(design.legs[0].detectors[0].technology).toBe('video'); // mixed leaves them
    setDetectionSystem(design, 'loops');
    expect(design.legs[0].detectors[0].technology).toBe('inductive_loop');
  });
});

describe('corners and poles', () => {
  const design = createTemplate('four');
  const geom = computeGeometry(design);

  test('a four-leg intersection has NE, NW, SE and SW corners', () => {
    expect(geom.corners.map((c) => c.label).sort()).toEqual(['NE corner', 'NW corner', 'SE corner', 'SW corner']);
    for (const c of geom.corners) {
      expect(c.id).toBe(cornerKey(c.gi.id, c.gj.id));
      expect(Math.hypot(c.back.x, c.back.y)).toBeGreaterThan(Math.hypot(c.mount.x, c.mount.y));
    }
  });

  test('each approach has a mast-arm pole on the far-right corner', () => {
    const poles = signalPoles(design, geom);
    expect(poles).toHaveLength(4);
    const label = (p) => geom.corners.find((c) => c.id === p.cornerId).label;
    const north = design.legs.find((l) => Math.round(l.bearing) === 0); // northbound traffic
    expect(label(poles.find((p) => p.legId === north.id))).toBe('NE corner');
  });

  test('a T has two corners and an open side', () => {
    const tee = computeGeometry(createTemplate('tee'));
    expect(tee.corners.filter((c) => c.label.endsWith('corner'))).toHaveLength(2);
    expect(tee.corners.some((c) => c.label.endsWith('side'))).toBe(true);
  });
});

describe('equipment layout', () => {
  test('cabinet on its corner, CCTV aimed at the middle, cameras on their approach poles', () => {
    const design = createTemplate('four');
    const geom = computeGeometry(design);
    const se = geom.corners.find((c) => c.label === 'SE corner');
    design.its.cabinet = { type: '332', corner: se.id, controller: '' };
    const cctv = makeCctv({ corner: geom.corners.find((c) => c.label === 'NW corner').id });
    design.its.cctv.push(cctv);
    setDetectionSystem(design, 'video');
    design.its.preemption = { type: 'ir', legIds: [], numbers: {} };

    const layout = equipmentLayout(design, geom);
    expect(layout.cabinet.corner.id).toBe(se.id);
    expect(layout.cabinet.point).toEqual(se.back);
    expect(layout.cctv[0].point.x).toBeLessThan(0); // NW: west...
    expect(layout.cctv[0].point.y).toBeLessThan(0); // ...and north

    Object.assign(cctv, aimAtCentre(cctv, layout.cctv[0].point));
    expect(cctv.heading).toBeGreaterThan(90);
    expect(cctv.heading).toBeLessThan(180); // from the NW corner, the middle is to the SE
    expect(cctv.tilt).toBeLessThan(0);

    expect(layout.detectionCams).toHaveLength(4);
    const poles = signalPoles(design, geom);
    for (const cam of layout.detectionCams) {
      const pole = poles.find((p) => p.legId === cam.legId);
      expect(Math.hypot(cam.point.x - pole.point.x, cam.point.y - pole.point.y)).toBeLessThan(20);
      const g = geom.byId.get(cam.legId);
      expect(Math.abs(((cam.heading - headingOf(g.u) + 540) % 360) - 180)).toBeLessThan(30); // looks up its approach
    }
    expect(layout.preempt).toHaveLength(4);
    expect(itsChecks(design, geom.corners.map((c) => c.id))).toEqual([]);
    design.its.cabinet.corner = 'gone|corner';
    expect(itsChecks(design, geom.corners.map((c) => c.id))).toHaveLength(1);
  });

  test('round loops: a 40 ft loop is four 6 ft circles, a 6 ft loop one', () => {
    const design = createTemplate('four');
    const leg = design.legs[0];
    addDetector(design, leg, { laneId: leg.inbound[0].id, purpose: 'stop bar' });
    const geom = computeGeometry(design);
    const g = geom.byId.get(leg.id);
    const long = loopCircles(g, { ...g.detectors[0], det: { ...g.detectors[0].det, length: 40 } });
    expect(long).toHaveLength(4);
    expect(long.every((c) => c.r === 3)).toBe(true);
    const short = loopCircles(g, { ...g.detectors[0], y1: g.detectors[0].y0 + 6, det: { ...g.detectors[0].det, length: 6 } });
    expect(short).toHaveLength(1);
    expect(short[0].r).toBeLessThanOrEqual(3);
  });
});

test('settings default to everything advanced off', () => {
  expect(DEFAULT_SETTINGS).toEqual({ playback: false, its: false, video: false, corridor: false });
  expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
});
