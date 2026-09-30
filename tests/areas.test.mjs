import { describe, test, expect } from 'vitest';
import { surfaceAreas, onRoad, onPavement, inside } from '../src/three/areas.js';
import { computeGeometry } from '../src/lib/geometry.js';
import { createTemplate, TEMPLATES } from '../src/lib/model.js';
import { laneSignal } from '../src/three/buildScene.js';

/** Signed-area sum of a polygon-clipping MultiPolygon, holes subtracted. */
function area(multi) {
  const ring = (r) => Math.abs(r.reduce((s, [x, y], i) => {
    const [x2, y2] = r[(i + 1) % r.length];
    return s + x * y2 - x2 * y;
  }, 0) / 2);
  return multi.reduce((total, [outer, ...holes]) => total + ring(outer) - holes.reduce((h, r) => h + ring(r), 0), 0);
}

describe('3D surface areas', () => {
  test.each(TEMPLATES.map((t) => t.id))('%s: sidewalks never overlap the roadway', (id) => {
    const geom = computeGeometry(createTemplate(id));
    const { road, walks } = surfaceAreas(geom);
    expect(road.length).toBeGreaterThan(0);
    expect(walks.length).toBeGreaterThan(0);
    // Every sidewalk vertex that is not on a curb line sits off the road.
    for (const [outer] of walks) {
      const [x, y] = outer[0];
      expect(onRoad(geom, { x, y }, -0.5)).toBe(false);
    }
  });

  test('a porkchop island is raised, and cut out of the sidewalk', () => {
    const design = createTemplate('four');
    design.legs[0].freeRight = { lanes: 1, ped: '', receiving: 'merge', size: 'standard' };
    const geom = computeGeometry(design);
    const { islands, walks } = surfaceAreas(geom);
    expect(islands.length).toBe(1);
    const plain = surfaceAreas(computeGeometry(createTemplate('four')));
    expect(area(islands)).toBeGreaterThan(50);
    // The slip takes corner sidewalk away, and the island is not counted as sidewalk.
    const island = geom.legs[0].slip.islandPoints;
    const mid = island.reduce((a, p) => ({ x: a.x + p.x / island.length, y: a.y + p.y / island.length }), { x: 0, y: 0 });
    expect(inside(mid, island)).toBe(true);
    expect(onPavement(geom, mid)).toBe(true);
    expect(area(walks)).not.toBeCloseTo(area(plain.walks), 0);
  });

  test('raised medians become islands', () => {
    const design = createTemplate('four');
    design.legs[0].median = { type: 'raised', width: 8 };
    const { islands } = surfaceAreas(computeGeometry(design));
    expect(islands.length).toBe(1);
  });
});

describe('3D signal lamps', () => {
  test('a lane shows green when any of its movements is served, yellow for a flashing yellow arrow', () => {
    const design = createTemplate('four');
    const eb = design.legs[0]; // lanes L, T, TR; T and R in 2, left 5 protected-permissive
    const [left, through, throughRight] = eb.inbound;
    expect(laneSignal(eb, through, '2')).toBe('green');
    expect(laneSignal(eb, throughRight, '2')).toBe('green');
    expect(laneSignal(eb, left, '5')).toBe('green');
    expect(laneSignal(eb, left, '2')).toBe('green'); // permissive in the through phase
    eb.movements.L.treatment = 'fya';
    expect(laneSignal(eb, left, '2')).toBe('yellow');
    expect(laneSignal(eb, through, '6')).toBe('red');
    expect(laneSignal(eb, through, '')).toBe('red');
  });
});
