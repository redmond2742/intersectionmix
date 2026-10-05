/**
 * Plan areas for the 3D view, in plan feet.
 *
 * The 2D drawing gets away with painting asphalt over sidewalk. In 3D the
 * sidewalks are raised, so they must actually stop at the curb: sidewalk is
 * the union of every sidewalk shape, minus the roadway, minus the islands.
 * Raised islands (porkchops, raised medians) are their own areas.
 *
 * Polygons are in polygon-clipping's format: [ring, ...holes], a ring being
 * [[x, y], ...]. Framework free; three.js is not needed here.
 */

import polygonClipping from 'polygon-clipping';

/** A plan polygon (array of {x, y}) as a polygon-clipping Polygon, or null if degenerate. */
export function toPolygon(points) {
  const ring = (points || [])
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => [p.x, p.y]);
  if (ring.length < 3) return null;
  ring.push([...ring[0]]);
  return [ring];
}

/** A rectangle in a leg's local frame (X across, Y out along the leg), in world coordinates. */
export function legRect(g, x0, x1, y0, y1) {
  return [g.world(y0, x0), g.world(y0, x1), g.world(y1, x1), g.world(y1, x0)];
}

/**
 * Unions shapes one at a time, skipping any that polygon-clipping rejects:
 * a slip lane's offset curve can fold on itself at a very tight corner, and
 * one bad shape should cost that shape, not the whole scene.
 */
export function safeUnion(shapes) {
  let acc = [];
  for (const shape of shapes) {
    if (!shape) continue;
    try {
      acc = polygonClipping.union(acc, shape);
    } catch {
      // skip it
    }
  }
  return acc;
}

function safeDifference(subject, clip) {
  if (!subject.length || !clip.length) return subject;
  try {
    return polygonClipping.difference(subject, clip);
  } catch {
    return subject;
  }
}

/** { road, walks, islands }: roadway, raised sidewalk, raised islands and medians. */
export function surfaceAreas(geom) {
  const road = [toPolygon(geom.asphaltCore), ...geom.filletShapes.map(toPolygon)];
  const walk = [toPolygon(geom.sidewalkCore)];
  const raised = [];

  for (const g of geom.legs) {
    const { cs } = g;
    road.push(toPolygon(legRect(g, cs.curbOut, cs.curbIn, 0, g.L)));
    if (cs.sidewalkOut[1] - cs.sidewalkOut[0] > 0) walk.push(toPolygon(legRect(g, cs.sidewalkOut[0], cs.curbOut, 0, g.L)));
    if (cs.sidewalkIn[1] - cs.sidewalkIn[0] > 0) walk.push(toPolygon(legRect(g, cs.curbIn, cs.sidewalkIn[1], 0, g.L)));
    if (g.leg.median.type === 'raised' && cs.median[1] - cs.median[0] > 0) {
      raised.push(toPolygon(legRect(g, cs.median[0], cs.median[1], g.S, g.L)));
    }
    if (g.slip) {
      const { slip } = g;
      road.push(toPolygon(slip.asphalt), toPolygon(slip.taper.asphalt), toPolygon(slip.receiving.asphalt));
      walk.push(toPolygon(slip.sidewalk), toPolygon(slip.taper.sidewalk), toPolygon(slip.receiving.sidewalk));
      if (slip.islandPoints) raised.push(toPolygon(slip.islandPoints));
    }
  }

  const roadArea = safeUnion(road);
  const islands = safeUnion(raised);
  const walks = safeDifference(safeDifference(safeUnion(walk), roadArea), islands);
  return { road: roadArea, walks, islands };
}

// Point tests live with the plan geometry, so the plan can use them without polygon-clipping.
export { inside, onRoad, onPavement } from '../lib/geometry.js';
