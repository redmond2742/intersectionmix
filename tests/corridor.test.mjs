import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  feedSignals, alongStreet, toFeet, haversineFt, orderSignals, makeCorridor, corridorLayout, corridorPhases,
  linkPoint, sectionAt, normalizeCorridor,
} from '../src/lib/corridor.js';
import { normalizeDesign, findLeg } from '../src/lib/model.js';

const dir = new URL('./fixtures/wc-corridor/', import.meta.url);
const files = Object.fromEntries(readdirSync(dir).map((name) => [name, readFileSync(new URL(name, dir), 'utf8')]));
const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

describe('signals in a feed', () => {
  test('locations and streets', () => {
    const signals = feedSignals(files);
    expect(signals.map((s) => s.id)).toEqual(['1', '2', '3', '4']);
    expect(signals[0].lat).toBeCloseTo(37.9045, 3);
    expect(signals[0].streets).toContain('Ygnacio Valley Road');
  });

  test('along a road, punctuation and case aside', () => {
    expect(alongStreet(files, 'ygnacio valley road')).toEqual(['1', '2', '3', '4']);
    expect(alongStreet(files, 'N Main Street')).toEqual(['3']);
  });
});

describe('placing signals', () => {
  test('the projection agrees with great-circle distance to within 1%', () => {
    const [a, , , d] = feedSignals(files);
    const p = toFeet(d.lat, d.lon, a);
    const straight = Math.hypot(p.x, p.y);
    expect(Math.abs(straight - haversineFt(a, d)) / haversineFt(a, d)).toBeLessThan(0.01);
    expect(p.x).toBeGreaterThan(0); // signal 4 is east of signal 1
    expect(p.y).toBeLessThan(0); // and north (y is south)
  });

  test('signals are put in order along the road, whatever order they are picked in', () => {
    const corridor = makeCorridor(files, ['3', '1', '4', '2']);
    expect(corridor.signals.map((s) => s.signalId)).toEqual(['1', '2', '3', '4']);
    expect(corridor.name).toBe('Ygnacio Valley Road corridor');
    expect(orderSignals([...corridor.signals].reverse()).map((s) => s.signalId)).toEqual(['1', '2', '3', '4']);
  });
});

describe('the layout', () => {
  const corridor = makeCorridor(files, ['1', '2', '3', '4']);
  const layout = corridorLayout(corridor);

  test('neighbours are joined by Ygnacio Valley Road, about 600 to 900 ft apart', () => {
    expect(layout.links).toHaveLength(3);
    for (const link of layout.links) {
      expect(link.aligned).toBe(true);
      expect(link.dist).toBeGreaterThan(500);
      expect(link.dist).toBeLessThan(1000);
      const A = layout.signals[link.a];
      const B = layout.signals[link.b];
      expect(findLeg(A.design, link.legA).street).toBe('Ygnacio Valley Road');
      expect(findLeg(B.design, link.legB).street).toBe('Ygnacio Valley Road');
    }
  });

  test('the link road starts at one approach and ends at the other', () => {
    const link = layout.links[0];
    const A = layout.signals[0];
    const B = layout.signals[1];
    const ga = A.geom.byId.get(link.legA);
    const gb = B.geom.byId.get(link.legB);
    const start = linkPoint(link, 0);
    const end = linkPoint(link, link.road.length);
    const aEnd = { x: A.offset.x + ga.world(link.reachA, 0).x, y: A.offset.y + ga.world(link.reachA, 0).y };
    const bEnd = { x: B.offset.x + gb.world(link.reachB, 0).x, y: B.offset.y + gb.world(link.reachB, 0).y };
    expect(len(start, aEnd)).toBeLessThan(0.01);
    expect(len(end, bEnd)).toBeLessThan(0.01);
    // A's receiving lanes (left of travel toward B... in A's frame, negative x) carry on to B's approach lanes.
    const leaving = linkPoint(link, 0, ga.cs.outbound[0].cx);
    const fromA = { x: A.offset.x + ga.world(link.reachA, ga.cs.outbound[0].cx).x, y: A.offset.y + ga.world(link.reachA, ga.cs.outbound[0].cx).y };
    expect(len(leaving, fromA)).toBeLessThan(0.01);
    const section = sectionAt(link, 1);
    expect(section.curbs[0]).toBeCloseTo(-gb.cs.curbIn);
  });

  test('chainage grows along the corridor, by more than the straight distances', () => {
    const chain = layout.signals.map((s) => s.chainage);
    expect(chain[0]).toBe(0);
    for (let i = 1; i < chain.length; i += 1) {
      expect(chain[i]).toBeGreaterThan(chain[i - 1] + layout.links[i - 1].dist * 0.98);
    }
  });

  test('each intersection is drawn up to half way to its neighbour', () => {
    for (const s of layout.signals) {
      const nearest = Math.min(...layout.signals.filter((o) => o !== s).map((o) => len(o.offset, s.offset)));
      expect(s.clip).toBeLessThanOrEqual(nearest / 2 + 1e-6);
    }
  });

  test('forward and backward through phases', () => {
    const phases = corridorPhases(layout);
    expect(phases).toHaveLength(4);
    // Signal 2: eastbound arrives on 2-2 (phase 6), westbound on 2-4 (phase 2).
    const two = phases[1];
    expect(findLeg(layout.signals[1].design, two.forward.legId).approachId).toBe('2-2');
    expect(two.forward.phase).toBe('6');
    expect(findLeg(layout.signals[1].design, two.backward.legId).approachId).toBe('2-4');
    expect(two.backward.phase).toBe('2');
    // The first signal: forward traffic is whatever goes through toward signal 2.
    expect(phases[0].forward.phase).toBe('6');
  });

  test('approaches that do not face each other are not joined', () => {
    const turned = makeCorridor(files, ['1', '2']);
    // Point every leg of signal 2 away from signal 1.
    turned.signals[1].design.legs.forEach((leg) => { leg.bearing = 250; });
    const crossed = corridorLayout(turned);
    expect(crossed.links[0].aligned).toBe(false);
    expect(crossed.links[0].road).toBeUndefined();
  });

  test('a stored corridor comes back', () => {
    const again = normalizeCorridor(JSON.parse(JSON.stringify(corridor)), normalizeDesign);
    expect(again.signals.map((s) => s.signalId)).toEqual(['1', '2', '3', '4']);
    expect(normalizeCorridor({ nope: true }, normalizeDesign)).toBeNull();
  });
});

import { controllerKey, hoursAvailable, bestHour, filesInRange, timelinesByController, sharedWindow } from '../src/lib/corridorData.js';
import { parseHiRes } from '../src/lib/hires.js';

describe('loading a corridor\'s data', () => {
  const fake = (path) => ({ name: path.split('/').pop(), webkitRelativePath: path });
  const folder = [
    'CsvData/Ctrl00001/TRAF_00001_2026_09_17_0700.csv',
    'CsvData/Ctrl00001/TRAF_00001_2026_09_17_0800.csv',
    'CsvData/Ctrl00002/TRAF_00002_2026_09_17_0800.csv',
    'CsvData/Ctrl00003/TRAF_00003_2026_09_17_0800.csv',
    'CsvData/Ctrl00003/TRAF_00003_2026_09_17_0900.csv',
    'CsvData/Ctrl00099/TRAF_00099_2026_09_17_0800.csv',
    'CsvData/notes.txt',
  ].map(fake);
  const hour = (h) => new Date(2026, 8, 17, h).getTime();

  test('leading zeros do not matter', () => {
    expect(controllerKey('00001')).toBe('1');
    expect(controllerKey(' 12 ')).toBe('12');
    expect(controllerKey('A')).toBe('A');
  });

  test('a folder is narrowed to the corridor\'s controllers and an hour, by name alone', () => {
    const { hours, unnamed } = hoursAvailable(folder, ['1', '2', '3']);
    expect(hours.map((h) => h.start)).toEqual([hour(7), hour(8), hour(9)]);
    expect(unnamed).toBe(1);
    expect(bestHour(hours, ['1', '2', '3'])).toBe(hour(8)); // the only hour all three have
    const picked = filesInRange(folder, ['1', '2', '3'], hour(8), hour(8));
    expect(picked.map((f) => f.name)).toEqual([
      'TRAF_00001_2026_09_17_0800.csv', 'TRAF_00002_2026_09_17_0800.csv', 'TRAF_00003_2026_09_17_0800.csv',
    ]);
  });

  test('files are grouped by the controller in their header', () => {
    const log = (n, t) => ({ name: `x${n}.csv`, data: parseHiRes(`9/17/2026 08:00:00.0,,Intersection#,${n}\n9/17/2026 ${t}, 82, 1\n9/17/2026 08:30:00.0, 81, 1\n`) });
    const { byController } = timelinesByController([log(1, '08:00:01.0'), log(2, '08:10:00.0'), log(1, '08:20:00.0')]);
    expect([...byController.keys()].sort()).toEqual(['1', '2']);
    expect(byController.get('1').files).toBe(2);
    const shared = sharedWindow(byController.values());
    expect(shared.start).toBe(new Date(2026, 8, 17, 8, 10).getTime());
    expect(sharedWindow([{ start: 0, end: 10 }, { start: 20, end: 30 }])).toBeNull();
  });
});
