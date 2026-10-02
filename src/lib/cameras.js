/**
 * Camera pins: saved viewpoints for the 3D view.
 *
 * A pin stands on a spot of the plan (x east, y south, in feet, like every
 * other plan coordinate) at an eye height above the surface it stands on,
 * and looks along a compass heading, tilted up or down. They are kept in
 * the design, so they travel with autosave, share links and design files.
 *
 * Framework free.
 */

import { bearingToCompass } from './gtss.js';

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Eye heights, in feet. */
export const CAMERA_PRESETS = [
  { id: 'driver', label: 'Driver', height: 3.5 },
  { id: 'pedestrian', label: 'Pedestrian', height: 5.5 },
  { id: 'truck', label: 'Truck driver', height: 8 },
  { id: 'pole', label: 'Signal pole', height: 25 },
  { id: 'drone', label: 'Drone', height: 150 },
];

/** Saved-image sizes; the view is always framed 16:9. */
export const OUTPUT_SIZES = {
  hd: { w: 1280, h: 720, label: 'HD 1280 × 720' },
  fhd: { w: 1920, h: 1080, label: 'Full HD 1920 × 1080' },
  uhd: { w: 3840, h: 2160, label: '4K 3840 × 2160' },
};
export const PIN_ASPECT = 16 / 9;

let counter = 0;
const pinId = () => {
  counter += 1;
  return `cam${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
};

export function makePin(opts = {}) {
  return {
    id: pinId(),
    name: 'Camera',
    x: 0,
    y: 0,
    base: 0, // height of the surface stood on: 0 road, 0.5 sidewalk
    height: 5.5,
    heading: 0, // compass degrees, 0 = north
    tilt: -3, // degrees, negative looks down
    fov: 55, // vertical field of view, degrees
    ...opts,
  };
}

const finite = (value, fallback) => (Number.isFinite(Number(value)) && value !== '' && value != null ? Number(value) : fallback);

/** A pin from untrusted JSON, or null. */
export function normalizePin(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Number.isFinite(Number(raw.x)) || !Number.isFinite(Number(raw.y))) return null;
  return makePin({
    id: raw.id ? String(raw.id) : pinId(),
    name: raw.name == null ? 'Camera' : String(raw.name),
    x: Number(raw.x),
    y: Number(raw.y),
    base: clamp(finite(raw.base, 0), -50, 50),
    height: clamp(finite(raw.height, 5.5), 0.5, 2000),
    heading: ((finite(raw.heading, 0) % 360) + 360) % 360,
    tilt: clamp(finite(raw.tilt, -3), -89, 89),
    fov: clamp(finite(raw.fov, 55), 10, 120),
  });
}

export function nextPinName(pins) {
  const used = new Set((pins || []).map((p) => p.name));
  let n = (pins || []).length + 1;
  while (used.has(`Camera ${n}`)) n += 1;
  return `Camera ${n}`;
}

/** The eye, in plan feet with z up. */
export function eyeOf(pin) {
  return { x: pin.x, y: pin.y, z: (pin.base || 0) + pin.height };
}

/** Unit view direction, in plan terms (x east, y south, z up). */
export function lookDirection(pin) {
  const h = rad(pin.heading);
  const t = rad(pin.tilt);
  return { x: Math.sin(h) * Math.cos(t), y: -Math.cos(h) * Math.cos(t), z: Math.sin(t) };
}

/** Heading and tilt that point a pin's eye at a plan point (z defaults to the ground). */
export function aimAt(pin, target) {
  const eye = eyeOf(pin);
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = (target.z || 0) - eye.z;
  const flat = Math.hypot(dx, dy);
  if (flat < 0.5) return { heading: pin.heading, tilt: pin.tilt };
  return {
    heading: round1((deg(Math.atan2(dx, -dy)) + 360) % 360),
    tilt: round1(clamp(deg(Math.atan2(dz, flat)), -89, 89)),
  };
}

/**
 * A new eye height that keeps the pin looking at the same spot: the point
 * where its view meets the ground, or, looking level or up, a point 150 ft
 * ahead. Raising a pedestrian's eye to a drone's then still frames the
 * intersection rather than the horizon.
 */
export function withHeight(pin, height) {
  const eye = eyeOf(pin);
  const down = -rad(pin.tilt);
  let reach = 150;
  if (down > rad(0.2)) reach = Math.min(2000, eye.z / Math.tan(down));
  const dir = lookDirection({ ...pin, tilt: 0 });
  const target = { x: pin.x + dir.x * reach, y: pin.y + dir.y * reach, z: pin.base || 0 };
  const next = { ...pin, height };
  return { height, tilt: aimAt(next, target).tilt };
}

/** "Camera 1 · eye 5.5 ft · facing ENE (68°) · 55° view" */
export function pinCaption(pin) {
  const facing = bearingToCompass(pin.heading) || '';
  return `${pin.name} · eye ${round1(pin.height)} ft · facing ${facing} (${Math.round(pin.heading)}°) · tilt ${round1(pin.tilt)}° · ${Math.round(pin.fov)}° view`;
}

/** The view cone on the plan: the pin's spot, then the two edges of its horizontal view, `reach` feet out. */
export function viewCone(pin, reach = 60, aspect = PIN_ASPECT) {
  const halfV = rad(pin.fov) / 2;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const h = rad(pin.heading);
  const edge = (a) => ({ x: pin.x + Math.sin(h + a) * reach, y: pin.y - Math.cos(h + a) * reach });
  return [{ x: pin.x, y: pin.y }, edge(-halfH), edge(halfH)];
}
