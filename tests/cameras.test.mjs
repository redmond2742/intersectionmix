import { describe, test, expect } from 'vitest';
import { makePin, normalizePin, aimAt, lookDirection, eyeOf, viewCone, nextPinName, pinCaption, withHeight } from '../src/lib/cameras.js';
import { createTemplate, normalizeDesign } from '../src/lib/model.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe('camera pins', () => {
  test('heading is a compass bearing: 0 looks north (-y), 90 east (+x)', () => {
    const north = lookDirection(makePin({ heading: 0, tilt: 0 }));
    expect(close(north.x, 0) && close(north.y, -1) && close(north.z, 0)).toBe(true);
    const east = lookDirection(makePin({ heading: 90, tilt: 0 }));
    expect(close(east.x, 1) && close(east.y, 0)).toBe(true);
    const down = lookDirection(makePin({ heading: 0, tilt: -90 }));
    expect(close(down.z, -1)).toBe(true);
  });

  test('aiming at a point gives the heading and the downward tilt to it', () => {
    const pin = makePin({ x: 0, y: 100, height: 5.5 }); // 100 ft south of the centre
    const { heading, tilt } = aimAt(pin, { x: 0, y: 0, z: 0 });
    expect(heading).toBe(0);
    expect(tilt).toBeCloseTo(-3.1, 1);
    expect(aimAt(pin, { x: 100, y: 100 }).heading).toBe(90);
    // Aiming at your own feet changes nothing.
    expect(aimAt(pin, { x: 0, y: 100 })).toEqual({ heading: pin.heading, tilt: pin.tilt });
  });

  test('changing the eye height keeps the view on the same spot', () => {
    const pin = makePin({ x: 0, y: 100, height: 5.5 });
    Object.assign(pin, aimAt(pin, { x: 0, y: 0 }));
    const drone = withHeight(pin, 150);
    expect(drone.height).toBe(150);
    expect(drone.tilt).toBeCloseTo(-56.3, 0); // atan(150 / 100)
    // Looking level, it frames a point 150 ft ahead.
    expect(withHeight(makePin({ tilt: 0, height: 5.5 }), 150).tilt).toBeCloseTo(-45, 0);
  });

  test('the eye stands on the surface it was placed on', () => {
    expect(eyeOf(makePin({ base: 0.5, height: 5.5 })).z).toBe(6);
  });

  test('the plan view cone opens around the heading', () => {
    const [apex, a, b] = viewCone(makePin({ x: 0, y: 0, heading: 90, fov: 50 }), 60);
    expect(apex).toEqual({ x: 0, y: 0 });
    expect(a.x).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThan(0);
    expect(a.y).toBeLessThan(0); // left edge leans north
    expect(b.y).toBeGreaterThan(0);
  });

  test('untrusted pins are cleaned up or dropped', () => {
    expect(normalizePin({ x: 'nope', y: 1 })).toBeNull();
    const pin = normalizePin({ x: 3, y: 4, heading: -90, tilt: 400, fov: 1, height: 0 });
    expect(pin).toMatchObject({ x: 3, y: 4, heading: 270, tilt: 89, fov: 10, height: 0.5 });
    expect(nextPinName([{ name: 'Camera 1' }, { name: 'Camera 3' }])).toBe('Camera 4');
    expect(pinCaption(makePin({ name: 'NB view', heading: 68, height: 5.5 }))).toMatch(/NB view · eye 5.5 ft · facing ENE \(68°\)/);
  });

  test('pins are part of the design, and survive normalising', () => {
    const design = createTemplate('four');
    expect(design.cameras).toEqual([]);
    design.cameras.push(makePin({ name: 'Approach', x: -200, y: 30, heading: 90 }));
    const again = normalizeDesign(JSON.parse(JSON.stringify(design)));
    expect(again.cameras).toEqual(design.cameras);
  });
});
