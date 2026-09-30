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

/** Even-odd point in polygon, for a plan polygon (array of {x, y}). */
export function inside(point, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** True when a plan point is on a roadway (with `margin` feet of kerb to spare). */
export function onRoad(geom, point, margin = 1) {
  if (geom.asphaltCore.length >= 3 && inside(point, geom.asphaltCore)) return true;
  for (const g of geom.legs) {
    const y = point.x * g.u.x + point.y * g.u.y;
    const x = point.x * g.r.x + point.y * g.r.y;
    if (y > -margin && y < g.L + margin && x > g.cs.curbOut - margin && x < g.cs.curbIn + margin) return true;
    if (g.slip && [g.slip.asphalt, g.slip.taper.asphalt, g.slip.receiving.asphalt].some((poly) => inside(point, poly))) return true;
  }
  return false;
}

/** True when a plan point is on roadway, sidewalk or island: anywhere a tree should not grow. */
export function onPavement(geom, point) {
  if (onRoad(geom, point, 3)) return true;
  if (geom.sidewalkCore.length >= 3 && inside(point, geom.sidewalkCore)) return true;
  for (const g of geom.legs) {
    const y = point.x * g.u.x + point.y * g.u.y;
    const x = point.x * g.r.x + point.y * g.r.y;
    if (y > -3 && y < g.L + 3 && x > g.cs.sidewalkOut[0] - 3 && x < g.cs.sidewalkIn[1] + 3) return true;
    if (g.slip && [g.slip.sidewalk, g.slip.taper.sidewalk, g.slip.receiving.sidewalk].some((poly) => inside(point, poly))) return true;
    if (g.slip && g.slip.islandPoints && inside(point, g.slip.islandPoints)) return true;
  }
  return false;
}
