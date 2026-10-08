import { describe, test, expect } from 'vitest';
import { corridorVehicles, corridorVehiclesAt, vehicleAt, trajectories } from '../src/lib/corridorVehicles.js';
import { corridorLayout } from '../src/lib/corridor.js';
import { buildTimeline, parseHiRes } from '../src/lib/hires.js';
import { createTemplate, addDetector } from '../src/lib/model.js';

const LAT = 37.9;
const LON = -122.06;

/** Two four-leg intersections on an east-west street, B 700 ft east of A. */
function twoSignals() {
  const make = (id, lonOffsetFt) => {
    const design = createTemplate('four');
    design.signal.id = id;
    design.signal.lat = String(LAT);
    design.signal.lon = String(LON + lonOffsetFt / (364600 * Math.cos((LAT * Math.PI) / 180)));
    design.legs.forEach((leg) => { leg.detectors.length = 0; leg.speed = 30; });
    return design;
  };
  const A = make('1', 0);
  const B = make('2', 700);
  const eastbound = (d) => d.legs.find((l) => Math.round(l.bearing) === 90);
  const through = (leg) => leg.inbound.find((l) => l.turns.includes('T') && l.turns.length === 1);
  // A: a stop bar detector on an eastbound through lane.
  const legA = eastbound(A);
  const stopA = addDetector(A, legA, { laneId: through(legA).id, purpose: 'stop bar' });
  Object.assign(stopA, { channel: '1', setback: 0, length: 40 });
  // B: an advance loop 250 ft back and a stop bar detector, on the same lane.
  const legB = eastbound(B);
  const advB = addDetector(B, legB, { laneId: through(legB).id, purpose: 'advanced' });
  Object.assign(advB, { channel: '2', setback: 250, length: 6 });
  const stopB = addDetector(B, legB, { laneId: through(legB).id, purpose: 'stop bar' });
  Object.assign(stopB, { channel: '1', setback: 0, length: 40 });
  const layout = corridorLayout({ signals: [{ signalId: '1', design: A }, { signalId: '2', design: B }] });
  return { layout, A, B };
}

const T0 = new Date(2026, 8, 17, 8, 0, 0).getTime();
const stamp = (ms) => {
  const d = new Date(T0 + ms);
  const p = (n) => String(n).padStart(2, '0');
  return `9/17/2026 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`;
};
const timeline = (events) => buildTimeline(parseHiRes(events.map(([ms, code, ch]) => `${stamp(ms)}, ${code}, ${ch}`).join('\n')));

/** Seconds a vehicle at ~40 ft/s takes from A's stop bar to B's advance loop. */
function linkSeconds(layout) {
  const link = layout.links[0];
  const A = layout.signals[0];
  const B = layout.signals[1];
  const ga = A.geom.legs.find((g) => Math.round(g.leg.bearing) === 90);
  const gb = B.geom.legs.find((g) => Math.round(g.leg.bearing) === 90);
  return (link.travel - ga.S - gb.S - 256) / 40;
}

describe('vehicles between two signals', () => {
  const { layout } = twoSignals();

  test('the layout joins them with Main Street', () => {
    expect(layout.links[0].aligned).toBe(true);
    expect(layout.links[0].dist).toBeCloseTo(700, -1);
  });

  test('a departure from A is the arrival at B: one vehicle, continuous across the link', () => {
    const travel = linkSeconds(layout) * 1000;
    const arrive = 1000 + travel;
    const model = corridorVehicles(layout, {
      0: timeline([[0, 82, 1], [1000, 81, 1]]),
      1: timeline([[arrive, 82, 2], [arrive + 300, 81, 2], [arrive + 7000, 82, 1], [arrive + 8000, 81, 1]]),
    });
    expect(model.matched).toBe(1);
    expect(model.vehicles).toHaveLength(1);
    const [v] = model.vehicles;
    expect(v.segments.map((s) => s.kind)).toEqual(['track', 'path', 'track', 'path']);
    // No jumps where one segment hands over to the next.
    for (let i = 1; i < v.segments.length; i += 1) {
      const t = v.segments[i].t0;
      const before = vehicleAt(v, t - 1);
      const after = vehicleAt(v, t + 1);
      expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeLessThan(6);
    }
    // Half way along the link it is between the two signals.
    const mid = vehicleAt(v, T0 + 1000 + travel / 2);
    expect(mid.x).toBeGreaterThan(layout.signals[0].offset.x + 40);
    expect(mid.x).toBeLessThan(layout.signals[1].offset.x - 40);
    expect(corridorVehiclesAt(model, T0 + 1000 + travel / 2)).toHaveLength(1);
  });

  test('an arrival too soon to have come from A is a different vehicle', () => {
    const model = corridorVehicles(layout, {
      0: timeline([[0, 82, 1], [1000, 81, 1]]),
      1: timeline([[1500, 82, 2], [1800, 81, 2]]),
    });
    expect(model.matched).toBe(0);
    expect(model.vehicles).toHaveLength(2);
  });

  test('a departure nobody arrives as drives down the link and is gone before B', () => {
    const model = corridorVehicles(layout, { 0: timeline([[0, 82, 1], [1000, 81, 1]]), 1: timeline([]) });
    const [v] = model.vehicles;
    const last = v.segments[v.segments.length - 1];
    const end = vehicleAt(v, last.t1 - 1);
    expect(end.x).toBeGreaterThan(layout.signals[0].offset.x + 200); // well down the link
    expect(end.x).toBeLessThan(layout.signals[1].offset.x); // but not past B
    expect(vehicleAt(v, last.t1 + 1000)).toBeNull();
  });

  test('an arrival nobody left A as appears at the end of the link', () => {
    const model = corridorVehicles(layout, { 0: timeline([]), 1: timeline([[20000, 82, 2], [20300, 81, 2]]) });
    const [v] = model.vehicles;
    expect(v.segments[0].kind).toBe('path');
    const start = vehicleAt(v, v.from + 1);
    expect(start.x).toBeGreaterThan(layout.signals[0].offset.x); // on the link, not back at A
    expect(start.x).toBeLessThan(layout.signals[1].offset.x - 200);
  });

  test('trajectories rise along the corridor for a vehicle going forward', () => {
    const travel = linkSeconds(layout) * 1000;
    const arrive = 1000 + travel;
    const model = corridorVehicles(layout, {
      0: timeline([[0, 82, 1], [1000, 81, 1]]),
      1: timeline([[arrive, 82, 2], [arrive + 300, 81, 2], [arrive + 7000, 82, 1], [arrive + 8000, 81, 1]]),
    });
    const [tr] = trajectories(model, layout, T0 - 10000, T0 + arrive + 20000, 250);
    expect(tr.forward).toBe(true);
    for (let i = 1; i < tr.points.length; i += 1) expect(tr.points[i].c).toBeGreaterThanOrEqual(tr.points[i - 1].c - 0.5);
    expect(tr.points[0].c).toBeLessThan(layout.signals[0].chainage);
    expect(tr.points[tr.points.length - 1].c).toBeGreaterThan(layout.signals[1].chainage - 100);
  });

  test('a vehicle that could have arrived sooner drives up and waits in the queue', () => {
    // Stop bar only at B (no advance loop): leaving A at 1 s, first seen on B's stop bar at 60 s.
    const model = corridorVehicles(layout, {
      0: timeline([[0, 82, 1], [1000, 81, 1]]),
      1: timeline([[60000, 82, 1], [61000, 81, 1]]),
    });
    expect(model.matched).toBe(1);
    const [v] = model.vehicles;
    const trip = v.segments.find((seg) => seg.kind === 'path' && seg.queue);
    expect(trip).toBeTruthy();
    // Half a minute in, it has long since reached the stop bar and is waiting there.
    const waiting = vehicleAt(v, T0 + 30000);
    const atBar = vehicleAt(v, T0 + 59900);
    expect(waiting.stopped).toBe(true);
    expect(Math.hypot(waiting.x - atBar.x, waiting.y - atBar.y)).toBeLessThan(1);
    // Early on it is moving at speed, well down the link.
    const early = vehicleAt(v, T0 + 6000);
    expect(early.stopped).toBe(false);
    expect(early.x).toBeGreaterThan(layout.signals[0].offset.x + 150);
  });
});
