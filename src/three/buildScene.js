/**
 * The 3D intersection.
 *
 * The ground is the plan itself: the 2D drawing, rasterised at the plan's
 * bounds, becomes the texture on a flat plane, so every marking, crosswalk,
 * arrow and detector the plan shows is on the road surface for free. What
 * stands up from it is modelled: sidewalks and islands raised to curb height
 * (their tops take the same texture, so they line up), mast-arm signals over
 * each approach's lanes, speed limit signs, cars queued at the stop bars and
 * street trees.
 *
 * Units are metres (glTF's), converted from plan feet. Plan x is east and
 * plan y south; in three.js that is +x and +z, with +y up.
 */

import * as THREE from 'three';
import { surfaceAreas, onRoad, onPavement } from './areas.js';
import { turnTargets, findLeg, legLabel } from '../lib/model.js';

export const FT = 0.3048;
const LAND = '#e8ebdd'; // COLORS.land in the plan
const CURB = 0.5; // curb height, ft

const at = (p, h = 0) => new THREE.Vector3(p.x * FT, h * FT, p.y * FT);
/** rotation.y that turns an object's local +z toward a plan direction. */
const facing = (dir) => Math.atan2(dir.x, dir.y);

function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* Ground and raised surfaces                                          */
/* ------------------------------------------------------------------ */

function shapesFrom(multi) {
  const toVec = (ring) => {
    const pts = ring.map(([x, y]) => new THREE.Vector2(x * FT, -y * FT));
    if (pts.length > 1 && pts[0].equals(pts[pts.length - 1])) pts.pop();
    return pts;
  };
  return multi.map(([outer, ...holes]) => {
    const shape = new THREE.Shape(toVec(outer));
    for (const hole of holes) shape.holes.push(new THREE.Path(toVec(hole)));
    return shape;
  });
}

/** Extrudes plan areas upward; the tops are mapped onto the plan texture so their markings line up. */
function raise(multi, heightFt, topMaterial, sideMaterial, bounds) {
  if (!multi.length) return null;
  const geometry = new THREE.ExtrudeGeometry(shapesFrom(multi), { depth: heightFt * FT, bevelEnabled: false, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i) / FT;
    const y = pos.getZ(i) / FT;
    uv.setXY(i, (x - bounds.minX) / w, 1 - (y - bounds.minY) / h);
  }
  uv.needsUpdate = true;
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, [topMaterial, sideMaterial]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Signs                                                               */
/* ------------------------------------------------------------------ */

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function speedLimitTexture(limit) {
  return canvasTexture(240, 300, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.font = '800 50px Inter, Helvetica, Arial, sans-serif';
    ctx.fillText('SPEED', w / 2, 82);
    ctx.fillText('LIMIT', w / 2, 138);
    ctx.font = `800 ${limit >= 100 ? 100 : 130}px Inter, Helvetica, Arial, sans-serif`;
    ctx.fillText(String(limit), w / 2, 262);
  });
}

function streetNameTexture(name) {
  return canvasTexture(640, 120, (ctx, w, h) => {
    ctx.fillStyle = '#0b6e3b';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 64;
    ctx.font = `700 ${size}px Inter, Helvetica, Arial, sans-serif`;
    while (ctx.measureText(name).width > w - 50 && size > 24) {
      size -= 4;
      ctx.font = `700 ${size}px Inter, Helvetica, Arial, sans-serif`;
    }
    ctx.fillText(name, w / 2, h / 2 + 3);
  });
}

function signPanel(texture, wFt, hFt) {
  const group = new THREE.Group();
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(wFt * FT, hFt * FT),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 }),
  );
  face.position.z = 0.012;
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(wFt * FT, hFt * FT, 0.02),
    new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.4, roughness: 0.5 }),
  );
  face.castShadow = true;
  back.castShadow = true;
  group.add(back, face);
  return group;
}

/* ------------------------------------------------------------------ */
/* Signals                                                             */
/* ------------------------------------------------------------------ */

const LAMP_COLORS = { red: '#ff3b30', yellow: '#ffc400', green: '#2fd158' };

/** What a lane's head shows while `phase` is green. */
export function laneSignal(leg, lane, phase) {
  if (!phase) return 'red';
  const m = leg.movements;
  let state = 'red';
  for (const turn of lane.turns) {
    if (m[turn].phase === phase) return 'green';
    if (turn === 'L' && m.T.phase === phase && m.L.treatment === 'pp') return 'green';
    if (turn === 'L' && m.T.phase === phase && m.L.treatment === 'fya') state = 'yellow';
  }
  return state;
}

function signalHead(materials) {
  const group = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(1.1 * FT, 3.5 * FT, 0.9 * FT), materials.housing);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(2 * FT, 4.4 * FT, 0.08 * FT), materials.plate);
  plate.position.z = -0.46 * FT;
  housing.castShadow = true;
  group.add(plate, housing);
  const lamps = {};
  ['red', 'yellow', 'green'].forEach((color, i) => {
    const material = new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.3 });
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * FT, 0.42 * FT, 0.1 * FT, 20), material);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(0, (1.15 - i * 1.15) * FT, 0.47 * FT);
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * FT, 0.5 * FT, 0.6 * FT, 16, 1, true, -Math.PI / 2, Math.PI), materials.housing);
    visor.rotation.x = Math.PI / 2;
    visor.position.set(0, (1.15 - i * 1.15) * FT + 0.05 * FT, 0.8 * FT);
    group.add(lamp, visor);
    lamps[color] = material;
  });
  return { group, lamps };
}

function setLamps(lamps, state) {
  for (const [color, material] of Object.entries(lamps)) {
    const lit = color === state;
    material.color.set(lit ? LAMP_COLORS[color] : '#1b1b1b');
    material.emissive.set(lit ? LAMP_COLORS[color] : '#000000');
    material.emissiveIntensity = lit ? 2.2 : 0;
  }
}

/**
 * A mast arm over each approach, on the far side of the intersection: the
 * pole on the far-right corner, the arm reaching back over the lanes, one
 * head centred over each approach lane, facing the traffic that lane carries.
 * Free-right slips run free and get no head.
 */
function buildSignals(design, geom, root, materials) {
  const heads = [];
  const maxCw = Math.max(0, ...geom.legs.map((g) => g.cwEnd));
  for (const g of geom.legs) {
    if (!g.cs.inbound.length) continue;
    const targets = turnTargets({ legs: design.legs }, g.leg);
    const through = geom.byId.get(targets.T);
    const yFar = -((through ? through.cwEnd : maxCw) + 8);
    let poleX = g.cs.curbIn + 5;
    for (let tries = 0; tries < 12 && onRoad(geom, g.world(yFar, poleX), 2); tries += 1) poleX += 4;

    const assembly = new THREE.Group();
    assembly.position.copy(at(g.world(yFar, poleX)));
    assembly.rotation.y = facing(g.u); // local +z toward approaching traffic, local +x = g.r

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * FT, 0.55 * FT, 23 * FT, 16), materials.steel);
    pole.position.y = 11.5 * FT;
    pole.castShadow = true;
    assembly.add(pole);

    const innerX = g.cs.inbound[0].cx - poleX - 2;
    const armLength = Math.abs(innerX);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * FT, 0.32 * FT, armLength * FT, 12), materials.steel);
    arm.rotation.z = Math.PI / 2;
    arm.position.set((innerX / 2) * FT, 19.5 * FT, 0);
    arm.castShadow = true;
    assembly.add(arm);

    for (const item of g.cs.inbound) {
      const { group, lamps } = signalHead(materials);
      group.position.set((item.cx - poleX) * FT, 16.8 * FT, 0.4 * FT);
      const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * FT, 0.06 * FT, 1 * FT, 6), materials.steel);
      hanger.position.set((item.cx - poleX) * FT, 19 * FT, 0.2 * FT);
      assembly.add(group, hanger);
      heads.push({ legId: g.id, laneId: item.lane.id, lamps });
    }

    // The cross street's name, on the arm by the pole, as drivers read it.
    const cross = [targets.L, targets.R].map((id) => geom.byId.get(id)).find((t) => t && t.leg.street && t.leg.street !== g.leg.street);
    if (cross) {
      const blade = signPanel(streetNameTexture(cross.leg.street), 8, 1.5);
      blade.position.set(-6.5 * FT, 21.2 * FT, 0.1 * FT);
      assembly.add(blade);
    }
    root.add(assembly);
  }
  return heads;
}

/* ------------------------------------------------------------------ */
/* Street furniture, cars and trees                                    */
/* ------------------------------------------------------------------ */

function speedSigns(geom, root, materials) {
  for (const g of geom.legs) {
    if (!g.speedLimit) continue;
    const sidewalk = g.cs.sidewalkIn[1] - g.cs.sidewalkIn[0];
    const x = g.cs.curbIn + (sidewalk > 3 ? sidewalk / 2 : 2);
    const post = new THREE.Group();
    post.position.copy(at(g.world(Math.min(g.S + 70, g.L - 10), x), CURB));
    post.rotation.y = facing(g.u);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * FT, 0.1 * FT, 8 * FT, 8), materials.steel);
    pipe.position.y = 4 * FT;
    pipe.castShadow = true;
    const panel = signPanel(speedLimitTexture(g.speedLimit), 2.4, 3);
    panel.position.set(0, 7 * FT, 0.12 * FT);
    post.add(pipe, panel);
    root.add(post);
  }
}

const CAR_COLORS = ['#e03131', '#1c7ed6', '#f1f3f5', '#343a40', '#f59f00', '#5c7cfa', '#2b8a3e', '#868e96'];

function car(color, materials) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.45 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(6 * FT, 2.3 * FT, 14.5 * FT), paint);
  body.position.y = 2 * FT;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(5.3 * FT, 1.9 * FT, 7.4 * FT), materials.glass);
  cabin.position.set(0, 4.1 * FT, -0.8 * FT);
  body.castShadow = true;
  cabin.castShadow = true;
  group.add(body, cabin);
  for (const [x, z] of [[-2.9, 4.4], [2.9, 4.4], [-2.9, -4.4], [2.9, -4.4]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(1.15 * FT, 1.15 * FT, 0.8 * FT, 14), materials.tyre);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x * FT, 1.15 * FT, z * FT);
    group.add(wheel);
  }
  return group;
}

/** A car or two queued at each stop bar, and the odd one leaving on the receiving lanes. */
function traffic(geom, root, materials) {
  for (const g of geom.legs) {
    g.cs.inbound.forEach((item) => {
      const h = hash(item.lane.id);
      const count = 1 + (h % 3 === 0 ? 1 : 0);
      for (let i = 0; i < count; i += 1) {
        const vehicle = car(CAR_COLORS[(h >>> (i * 3)) % CAR_COLORS.length], materials);
        vehicle.position.copy(at(g.world(g.S + 11 + i * 22, item.cx)));
        vehicle.rotation.y = facing(g.d);
        root.add(vehicle);
      }
    });
    g.cs.outbound.forEach((item) => {
      const h = hash(item.lane.id);
      if (h % 2) return;
      const vehicle = car(CAR_COLORS[(h >>> 4) % CAR_COLORS.length], materials);
      vehicle.position.copy(at(g.world(g.cwEnd + 40 + (h % 40), item.cx)));
      vehicle.rotation.y = facing(g.u);
      root.add(vehicle);
    });
  }
}

function trees(geom, root, materials) {
  const trunkGeo = new THREE.CylinderGeometry(0.45 * FT, 0.6 * FT, 9 * FT, 8);
  const crownGeo = new THREE.IcosahedronGeometry(6.5 * FT, 1);
  for (const g of geom.legs) {
    for (let y = g.S + 30; y < g.L - 8; y += 45) {
      for (const x of [g.cs.sidewalkIn[1] + 8, g.cs.sidewalkOut[0] - 8]) {
        const p = g.world(y, x);
        if (onPavement(geom, p)) continue;
        const tree = new THREE.Group();
        tree.position.copy(at(p));
        const trunk = new THREE.Mesh(trunkGeo, materials.bark);
        trunk.position.y = 4.5 * FT;
        const crown = new THREE.Mesh(crownGeo, materials.leaves);
        crown.position.y = 12 * FT;
        crown.scale.setScalar(0.85 + (hash(`${g.id}${y}${x}`) % 30) / 100);
        trunk.castShadow = true;
        crown.castShadow = true;
        tree.add(trunk, crown);
        root.add(tree);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

/**
 * Builds the intersection as one group. `planCanvas` is the plan drawn at
 * `geom.bounds`. Returns { root, center, size, setPhase }.
 */
export function buildScene({ design, geom, planCanvas, anisotropy = 8 }) {
  const b = geom.bounds;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const root = new THREE.Group();
  root.name = design.name || 'Intersection';

  const plan = new THREE.CanvasTexture(planCanvas);
  plan.colorSpace = THREE.SRGBColorSpace;
  plan.anisotropy = anisotropy;
  const planMaterial = new THREE.MeshStandardMaterial({ map: plan, roughness: 0.95 });
  const materials = {
    curb: new THREE.MeshStandardMaterial({ color: '#b9b5ab', roughness: 0.9 }),
    islandSide: new THREE.MeshStandardMaterial({ color: '#a9a498', roughness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: '#8d949c', metalness: 0.6, roughness: 0.4 }),
    housing: new THREE.MeshStandardMaterial({ color: '#23262a', roughness: 0.5 }),
    plate: new THREE.MeshStandardMaterial({ color: '#111315', roughness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: '#2a3642', metalness: 0.2, roughness: 0.15 }),
    tyre: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 }),
    bark: new THREE.MeshStandardMaterial({ color: '#6b4f36', roughness: 1 }),
    leaves: new THREE.MeshStandardMaterial({ color: '#4f8a3c', roughness: 0.9, flatShading: true }),
  };

  // The plan, on the ground, and plain land beyond it.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(w * FT, h * FT), planMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(((b.minX + b.maxX) / 2) * FT, 0, ((b.minY + b.maxY) / 2) * FT);
  ground.receiveShadow = true;
  ground.name = 'Plan';
  // The same colour as the plan's own land, so its edge disappears.
  const land = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(w, h) * FT * 30, Math.max(w, h) * FT * 30),
    new THREE.MeshStandardMaterial({ color: LAND, roughness: 1 }),
  );
  land.rotation.x = -Math.PI / 2;
  land.position.set(ground.position.x, -0.02, ground.position.z);
  land.receiveShadow = true;
  land.name = 'Land';
  root.add(land, ground);

  const { walks, islands } = surfaceAreas(geom);
  const sidewalks = raise(walks, CURB, planMaterial, materials.curb, b);
  if (sidewalks) {
    sidewalks.name = 'Sidewalks';
    root.add(sidewalks);
  }
  const raised = raise(islands, CURB, planMaterial, materials.islandSide, b);
  if (raised) {
    raised.name = 'Islands';
    root.add(raised);
  }

  const heads = buildSignals(design, geom, root, materials);
  speedSigns(geom, root, materials);
  traffic(geom, root, materials);
  trees(geom, root, materials);

  const setPhase = (phase) => {
    for (const head of heads) {
      const leg = findLeg(design, head.legId);
      const lane = leg && leg.inbound.find((l) => l.id === head.laneId);
      setLamps(head.lamps, lane ? laneSignal(leg, lane, phase) : 'red');
    }
  };
  setPhase('');

  return {
    root,
    // What a camera pin can stand on: the ground and the raised surfaces, not cars or trees.
    surfaces: [ground, land, sidewalks, raised].filter(Boolean),
    center: new THREE.Vector3(((b.minX + b.maxX) / 2) * FT, 0, ((b.minY + b.maxY) / 2) * FT),
    size: Math.max(w, h) * FT,
    setPhase,
    describe: () => design.legs.map(legLabel).join(', '),
  };
}
