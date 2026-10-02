/**
 * Camera pins in the 3D scene: their markers, and the cameras they define.
 *
 * Markers live in the scene but outside the exported model, and are hidden
 * whenever the scene is rendered from a pin, so a saved view never shows
 * its own camera.
 */

import * as THREE from 'three';
import { FT } from './buildScene.js';
import { eyeOf, lookDirection, PIN_ASPECT } from '../lib/cameras.js';

/** A plan point (x east, y south, z up, in feet) in three.js metres. */
export const toWorld = (p) => new THREE.Vector3(p.x * FT, (p.z || 0) * FT, p.y * FT);

/** Points a perspective camera the way a pin looks. */
export function applyPinCamera(camera, pin, aspect = PIN_ASPECT) {
  const eye = toWorld(eyeOf(pin));
  const dir = lookDirection(pin);
  camera.position.copy(eye);
  camera.up.set(0, 1, 0);
  camera.lookAt(eye.x + dir.x, eye.y + dir.z, eye.z + dir.y);
  camera.fov = pin.fov;
  camera.aspect = aspect;
  camera.near = 0.1;
  camera.far = 4000;
  camera.updateProjectionMatrix();
}

/** The largest region of a given aspect centred in a width x height area, from the bottom left. */
export function fitAspect(width, height, aspect = PIN_ASPECT) {
  let w = width;
  let h = w / aspect;
  if (h > height) {
    h = height;
    w = h * aspect;
  }
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

/**
 * A pin's marker: a ring where it stands, a stem up to the eye, a small
 * camera body, and wire lines tracing its 16:9 view a few metres out.
 */
export function pinMarker(pin, selected) {
  const color = new THREE.Color(selected ? '#ff3d7f' : '#c2255c');
  const group = new THREE.Group();
  group.name = `pin:${pin.id}`;
  const line = new THREE.LineBasicMaterial({ color, transparent: true, opacity: selected ? 1 : 0.7 });
  const solid = new THREE.MeshBasicMaterial({ color });

  const base = toWorld({ x: pin.x, y: pin.y, z: pin.base || 0 });
  const eye = toWorld(eyeOf(pin));
  const d = lookDirection(pin);
  const forward = new THREE.Vector3(d.x, d.z, d.y).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.48, 28), solid);
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(base).add(new THREE.Vector3(0, 0.03, 0));
  const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([base, eye]), line);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.46), solid);
  body.position.copy(eye);
  body.lookAt(eye.clone().add(forward));
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.16, 14), solid);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0, 0.3);
  body.add(lens);

  const reach = Math.max(4, Math.min(12, pin.height * FT * 0.8));
  const halfH = Math.tan(THREE.MathUtils.degToRad(pin.fov) / 2) * reach;
  const halfW = halfH * PIN_ASPECT;
  const centre = eye.clone().addScaledVector(forward, reach);
  const corner = (sx, sy) => centre.clone().addScaledVector(right, sx * halfW).addScaledVector(up, sy * halfH);
  const c = [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)];
  const frustum = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
    eye, c[0], eye, c[1], eye, c[2], eye, c[3],
    c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0],
  ]), line);

  group.add(ring, stem, body, frustum);
  return group;
}

/** Replaces a group's markers with fresh ones for `pins`. */
export function syncMarkers(group, pins, selectedId) {
  for (const child of [...group.children]) {
    child.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) node.material.dispose();
    });
    group.remove(child);
  }
  for (const pin of pins) group.add(pinMarker(pin, pin.id === selectedId));
}
