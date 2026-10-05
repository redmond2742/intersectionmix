/**
 * ITS equipment in 3D, placed from the same layout as the plan
 * (equipmentLayout): the cabinet on its pad, CCTV domes on their poles,
 * video detection cameras and preemption detectors on the mast arms, and a
 * cloud-preemption antenna on the cabinet.
 */

import * as THREE from 'three';
import { equipmentLayout, DOME_REACH } from '../lib/itsLayout.js';
import { onPavement } from '../lib/geometry.js';

const FT = 0.3048;
const CURB = 0.5;
const ARM_HEIGHT = 19.5; // the mast arm, as buildScene hangs it
const POLE_HEIGHT = 23;

const at = (p, h = 0) => new THREE.Vector3(p.x * FT, h * FT, p.y * FT);
const dirOf = (heading) => ({ x: Math.sin((heading * Math.PI) / 180), y: -Math.cos((heading * Math.PI) / 180) });
/** rotation.y that turns local +z toward a compass heading. */
const facing = (heading) => {
  const d = dirOf(heading);
  return Math.atan2(d.x, d.y);
};

function box(w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * FT, h * FT, d * FT), material);
  mesh.castShadow = true;
  return mesh;
}

function cylinder(r, h, material, segments = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r * FT, r * FT, h * FT, segments), material);
  mesh.castShadow = true;
  return mesh;
}

/** A box camera, lens along local +z, tipped down a little. */
function cameraBody(material, lens) {
  const g = new THREE.Group();
  const body = box(0.55, 0.5, 1.4, material);
  const hood = box(0.7, 0.08, 1.6, material);
  hood.position.set(0, 0.3 * FT, 0.1 * FT);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.18 * FT, 16), lens);
  glass.position.z = 0.71 * FT;
  g.add(body, hood, glass);
  g.rotation.x = 0.26; // aims down the approach
  return g;
}

export function buildEquipment(design, geom, group) {
  const layout = equipmentLayout(design, geom);
  const m = {
    cabinet: new THREE.MeshStandardMaterial({ color: '#8a9a8c', roughness: 0.55, metalness: 0.3 }),
    pad: new THREE.MeshStandardMaterial({ color: '#bdb8ad', roughness: 0.95 }),
    steel: new THREE.MeshStandardMaterial({ color: '#8d949c', metalness: 0.6, roughness: 0.4 }),
    dome: new THREE.MeshStandardMaterial({ color: '#23262a', roughness: 0.2, metalness: 0.4, transparent: true, opacity: 0.85 }),
    white: new THREE.MeshStandardMaterial({ color: '#f1f3f5', roughness: 0.5 }),
    camera: new THREE.MeshStandardMaterial({ color: '#d9dce0', roughness: 0.45 }),
    lens: new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.1, metalness: 0.5 }),
    ir: new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.5 }),
    strobe: new THREE.MeshStandardMaterial({ color: '#e7f5ff', emissive: '#a5d8ff', emissiveIntensity: 0.6 }),
    amber: new THREE.MeshStandardMaterial({ color: '#f08c00', roughness: 0.5 }),
  };
  const groundAt = (p) => (onPavement(geom, p) ? CURB : 0);

  // Cabinet
  const cab = layout.cabinet;
  if (cab) {
    const { spec } = cab;
    const base = groundAt(cab.point);
    const g = new THREE.Group();
    g.position.copy(at(cab.point, base));
    g.rotation.y = facing(cab.heading);
    if (spec.pole) {
      const post = cylinder(0.25, 3, m.steel);
      post.position.y = 1.5 * FT;
      const body = box(spec.w, spec.h, spec.d, m.cabinet);
      body.position.y = (3 + spec.h / 2) * FT;
      g.add(post, body);
    } else {
      const pad = box(spec.w + 1.2, 0.35, spec.d + 1.2, m.pad);
      pad.position.y = 0.17 * FT;
      pad.receiveShadow = true;
      const body = box(spec.w, spec.h, spec.d, m.cabinet);
      body.position.y = (0.35 + spec.h / 2) * FT;
      const roof = box(spec.w + 0.2, 0.12, spec.d + 0.2, m.cabinet);
      roof.position.y = (0.35 + spec.h + 0.06) * FT;
      g.add(pad, body, roof);
    }
    if (layout.cloud) {
      const antenna = cylinder(0.05, 2.2, m.white, 6);
      antenna.position.set((spec.w / 2 - 0.3) * FT, ((spec.pole ? 3 : 0.35) + spec.h + 1.1) * FT, 0);
      g.add(antenna);
    }
    g.name = `Cabinet ${cab.type}`;
    group.add(g);
  }

  // CCTV: a dome on a short arm, on the signal pole (extended if it must be taller) or its own pole.
  for (const c of layout.cctv) {
    const height = Number(c.cctv.height) || 30;
    const base = c.onPole ? 0 : groundAt(c.point);
    const g = new THREE.Group();
    g.position.copy(at(c.point, base));
    const poleTop = c.onPole ? POLE_HEIGHT : 0;
    if (height > poleTop - 0.5) {
      const extra = cylinder(c.onPole ? 0.3 : 0.4, height - poleTop + 0.6, m.steel);
      extra.position.y = (poleTop + (height - poleTop + 0.6) / 2) * FT;
      g.add(extra);
    }
    const mount = new THREE.Group();
    mount.position.y = height * FT;
    mount.rotation.y = facing(c.pin.heading);
    const arm = box(0.25, 0.25, DOME_REACH, m.steel);
    arm.position.z = (DOME_REACH / 2) * FT;
    const housing = cylinder(0.5, 0.4, m.white, 20);
    housing.position.set(0, -0.2 * FT, DOME_REACH * FT);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.45 * FT, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), m.dome);
    dome.position.set(0, -0.4 * FT, DOME_REACH * FT);
    mount.add(arm, housing, dome);
    g.add(mount);
    g.name = c.cctv.name || 'CCTV';
    group.add(g);
  }

  // Video detection cameras, on a short riser above the arm.
  for (const c of layout.detectionCams) {
    const g = new THREE.Group();
    g.position.copy(at(c.point, ARM_HEIGHT));
    const riser = cylinder(0.08, 2.2, m.steel, 6);
    riser.position.y = 1.1 * FT;
    const cam = cameraBody(m.camera, m.lens);
    cam.position.y = 2.5 * FT;
    g.add(riser, cam);
    g.rotation.y = facing(c.heading);
    g.name = `Detection camera ${c.index}`;
    group.add(g);
  }

  // Preemption detectors on the arms: IR (with its strobe) or a video unit.
  for (const p of layout.preempt) {
    if (p.type === 'cloud') continue;
    const g = new THREE.Group();
    g.position.copy(at(p.point, ARM_HEIGHT - 0.6));
    g.rotation.y = facing(p.heading);
    if (p.type === 'ir') {
      const unit = box(0.6, 0.45, 0.5, m.ir);
      const strobe = cylinder(0.12, 0.35, m.strobe, 10);
      strobe.position.y = 0.4 * FT;
      g.add(unit, strobe);
    } else {
      g.add(cameraBody(m.amber, m.lens));
    }
    g.name = `Preemption ${p.type}`;
    group.add(g);
  }
  return layout;
}
