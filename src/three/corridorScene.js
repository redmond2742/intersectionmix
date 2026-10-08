/**
 * The corridor in 3D: the corridor map, without its overlays, laid on the
 * ground in tiles (so lane lines stay sharp along a long road), every
 * intersection's signals, signs and equipment where it stands, trees along
 * the links, and one pool of cars for the vehicles driving between signals.
 */

import * as THREE from 'three';
import { buildScene, FT, carPool } from './buildScene.js';
import { planCanvas } from '../lib/download.js';

const LAND = '#e8ebdd';
const TILE_FT = 1500;

const at = (p, h = 0) => new THREE.Vector3(p.x * FT, h * FT, p.y * FT);

/** The ground: the corridor map rasterised tile by tile. */
async function groundTiles(svg, bounds, maxTexture, anisotropy) {
  const group = new THREE.Group();
  group.name = 'Ground';
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const nx = Math.max(1, Math.ceil(w / TILE_FT));
  const ny = Math.max(1, Math.ceil(h / TILE_FT));
  const tw = w / nx;
  const th = h / ny;
  const size = Math.min(4096, maxTexture);
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const tile = {
        minX: bounds.minX + i * tw, maxX: bounds.minX + (i + 1) * tw,
        minY: bounds.minY + j * th, maxY: bounds.minY + (j + 1) * th,
      };
      // eslint-disable-next-line no-await-in-loop
      const canvas = await planCanvas(svg, tile, size);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = anisotropy;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(tw * FT, th * FT),
        new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(((tile.minX + tile.maxX) / 2) * FT, 0, ((tile.minY + tile.maxY) / 2) * FT);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}

/** Street trees along both sides of each link road, clear of the intersections. */
function linkTrees(layout, root) {
  const trunkGeo = new THREE.CylinderGeometry(0.45 * FT, 0.6 * FT, 9 * FT, 8);
  const crownGeo = new THREE.IcosahedronGeometry(6.5 * FT, 1);
  const bark = new THREE.MeshStandardMaterial({ color: '#6b4f36', roughness: 1 });
  const leaves = new THREE.MeshStandardMaterial({ color: '#4f8a3c', roughness: 0.9, flatShading: true });
  const clear = (p) => layout.signals.every((s) => Math.hypot(p.x - s.offset.x, p.y - s.offset.y) > s.clip + 10);
  for (const link of layout.links) {
    if (!link.road) continue;
    const { a, b } = link.road.ends;
    for (let s = 30; s < link.road.length - 30; s += 50) {
      const k = s / link.road.length;
      const p = link.road.points.find((q) => q.s >= s) || link.road.points[link.road.points.length - 1];
      for (const side of [a.walks[0] + (b.walks[0] - a.walks[0]) * k - 7, a.walks[1] + (b.walks[1] - a.walks[1]) * k + 7]) {
        const spot = { x: p.x + p.normal.x * side, y: p.y + p.normal.y * side };
        if (!clear(spot)) continue;
        const tree = new THREE.Group();
        tree.position.copy(at(spot));
        const trunk = new THREE.Mesh(trunkGeo, bark);
        trunk.position.y = 4.5 * FT;
        const crown = new THREE.Mesh(crownGeo, leaves);
        crown.position.y = 12 * FT;
        trunk.castShadow = true;
        crown.castShadow = true;
        tree.add(trunk, crown);
        root.add(tree);
      }
    }
  }
}

/**
 * Builds the corridor. `svg` is the corridor map's <svg>. Returns
 * { root, signals: [built per signal], setVehicles, center, size }.
 */
export async function buildCorridorScene({ layout, svg, equipment = false, maxTexture = 4096, anisotropy = 8 }) {
  const root = new THREE.Group();
  root.name = 'Corridor';
  const b = layout.bounds;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;

  const land = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(w, h) * FT * 12, Math.max(w, h) * FT * 12),
    new THREE.MeshStandardMaterial({ color: LAND, roughness: 1 }),
  );
  land.rotation.x = -Math.PI / 2;
  land.position.set(((b.minX + b.maxX) / 2) * FT, -0.03, ((b.minY + b.maxY) / 2) * FT);
  land.receiveShadow = true;
  land.name = 'Land';
  root.add(land);
  root.add(await groundTiles(svg, b, maxTexture, anisotropy));

  // Each intersection's furniture where it stands; the corridor has laid its ground.
  const signals = layout.signals.map((sig) => {
    const built = buildScene({
      design: sig.design, geom: sig.geom, planCanvas: null, ground: false, traffic: false, clipRadius: sig.clip, equipment,
    });
    built.root.position.set(sig.offset.x * FT, 0, sig.offset.y * FT);
    root.add(built.root);
    return built;
  });

  const trees = new THREE.Group();
  trees.name = 'Link trees';
  linkTrees(layout, trees);
  root.add(trees);

  const vehicles = new THREE.Group();
  vehicles.name = 'Vehicles';
  root.add(vehicles);
  const setVehicles = carPool(vehicles);

  return {
    root,
    signals,
    setVehicles,
    center: new THREE.Vector3(((b.minX + b.maxX) / 2) * FT, 0, ((b.minY + b.maxY) / 2) * FT),
    size: Math.max(w, h) * FT,
  };
}
