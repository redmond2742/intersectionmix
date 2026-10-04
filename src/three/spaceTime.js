/**
 * Conflicts in time, in 3D: the plan on the ground, time going up.
 *
 * Each movement is a tube that climbs as it crosses the intersection, so a
 * steep tube is a slow movement and a late one starts high. Each conflict
 * point appears twice, at the moment each movement reaches it, joined by a
 * vertical link: red when the two are under four seconds apart (a live
 * conflict), grey when time separates them. A translucent "now" plane sweeps
 * up through the cycle with a dot riding each tube, so the whole cycle can
 * be frozen, scrubbed and orbited.
 */

import * as THREE from 'three';
import { FT } from './buildScene.js';
import { pointAlong } from '../lib/conflictTime.js';
import { phaseColor } from '../palette.js';

const TYPE_COLORS = { diverge: '#c92a2a', merge: '#e8590c', cross: '#ffffff', ped: '#1971c2' };
const PED_COLOR = '#1971c2';
const FREE_COLOR = '#868e96';

function label(text, { size = 1.4, color = '#1f2328', background = 'rgba(255,255,255,0.85)' } = {}) {
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d');
  const px = 48;
  g.font = `700 ${px}px Inter, Helvetica, Arial, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 28;
  canvas.width = w;
  canvas.height = px + 22;
  g.font = `700 ${px}px Inter, Helvetica, Arial, sans-serif`;
  g.fillStyle = background;
  g.beginPath();
  g.roundRect(0, 0, canvas.width, canvas.height, 14);
  g.fill();
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 14, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set((size * canvas.width) / canvas.height, size, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/**
 * Builds the space-time group. `data` is spaceTime() output; `scale` is
 * metres of height per second. Returns { group, update(t), height }.
 */
export function buildSpaceTime(data, geom, { scale = 1.2 } = {}) {
  const group = new THREE.Group();
  group.name = 'Conflicts in time';
  const at = (p, t) => new THREE.Vector3(p.x * FT, t * scale, p.y * FT);
  const height = data.span * scale;

  // Tracks: one tube per run of each movement.
  const dots = [];
  const dotGeometry = new THREE.SphereGeometry(0.5, 16, 12);
  for (const track of data.tracks) {
    const isPed = track.kind === 'ped';
    for (const run of track.runs) {
      const color = isPed ? PED_COLOR : track.free ? FREE_COLOR : phaseColor(run.phase);
      const points = track.points.map((p, i) => at(p, run.t0 + track.cum[i] / track.speed));
      const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.max(24, points.length * 3), isPed ? 0.12 : 0.2, 8, false),
        new THREE.MeshStandardMaterial({
          color, roughness: 0.5, transparent: true, opacity: run.permissive ? 0.45 : 0.92, emissive: color, emissiveIntensity: 0.15,
        }),
      );
      group.add(tube);
      const dot = new THREE.Mesh(dotGeometry, new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: color, emissiveIntensity: 0.9 }));
      dot.visible = false;
      group.add(dot);
      dots.push({ dot, track, run });
    }
  }

  // Conflicts: a marker at each movement's moment, joined by the gap.
  const sphere = new THREE.SphereGeometry(0.55, 18, 14);
  const materials = Object.fromEntries(Object.entries(TYPE_COLORS).map(([type, color]) => [type, new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: type === 'cross' ? 0.2 : 0.35, roughness: 0.4,
  })]));
  const ringMaterial = new THREE.MeshBasicMaterial({ color: '#c92a2a' });
  const liveLink = new THREE.MeshBasicMaterial({ color: '#e03131' });
  const calmLink = new THREE.MeshBasicMaterial({ color: '#adb5bd', transparent: true, opacity: 0.7 });
  for (const c of data.conflicts) {
    const a = at(c, c.ta);
    const b = at(c, c.tb);
    for (const p of [a, b]) {
      const m = new THREE.Mesh(sphere, materials[c.type]);
      m.position.copy(p);
      group.add(m);
      if (c.type === 'cross') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.1, 8, 24), ringMaterial);
        ring.position.copy(p);
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
      }
    }
    const length = Math.abs(b.y - a.y);
    if (length > 0.05) {
      const link = new THREE.Mesh(new THREE.CylinderGeometry(c.live ? 0.1 : 0.05, c.live ? 0.1 : 0.05, length, 8), c.live ? liveLink : calmLink);
      link.position.set(a.x, (a.y + b.y) / 2, a.z);
      group.add(link);
    }
    if (c.live && (c.type === 'cross' || c.type === 'ped')) {
      const tag = label(`${c.gap.toFixed(1)} s`, { size: 1.1, color: '#c92a2a' });
      tag.position.set(a.x, Math.max(a.y, b.y) + 1.4, a.z);
      group.add(tag);
    }
    // Where it is on the ground.
    const foot = new THREE.Mesh(new THREE.CircleGeometry(0.45, 18), new THREE.MeshBasicMaterial({ color: TYPE_COLORS[c.type] === '#ffffff' ? '#c92a2a' : TYPE_COLORS[c.type], transparent: true, opacity: 0.5 }));
    foot.rotation.x = -Math.PI / 2;
    foot.position.set(a.x, 0.06, a.z);
    group.add(foot);
  }

  // Time axis beside the intersection, with each phase's green as a band.
  const b = geom.bounds;
  const core = geom.asphaltCore.length ? geom.asphaltCore : [{ x: 0, y: 0 }];
  const reach = Math.max(...core.map((p) => Math.hypot(p.x, p.y))) + 30;
  const base = { x: -reach * 1.05, y: reach * 1.05 }; // off the south-west corner, clear of the action
  const axis = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, height, 8), new THREE.MeshBasicMaterial({ color: '#343a40' }));
  axis.position.set(base.x * FT, height / 2, base.y * FT);
  group.add(axis);
  const step = data.span > 120 ? 20 : 10;
  for (let t = 0; t <= data.span + 0.01; t += step) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: '#343a40' }));
    tick.position.set(base.x * FT, t * scale, base.y * FT);
    group.add(tick);
    const tag = label(`${t} s`, { size: 1.2 });
    tag.position.set(base.x * FT - 2.2, t * scale, base.y * FT);
    group.add(tag);
  }
  if (data.mode === 'signal') {
    Object.entries(data.schedule.windows).forEach(([phase, w]) => {
      const ring = ['5', '6', '7', '8'].includes(phase) ? 1 : 0;
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, Math.max(0.1, (w.end - w.start) * scale), 0.4),
        new THREE.MeshStandardMaterial({ color: phaseColor(phase), emissive: phaseColor(phase), emissiveIntensity: 0.3 }),
      );
      band.position.set(base.x * FT + 0.8 + ring * 0.6, ((w.start + w.end) / 2) * scale, base.y * FT);
      group.add(band);
      const tag = label(`Ø${phase}`, { size: 1.1, color: phaseColor(phase) });
      tag.position.set(base.x * FT + 2.6 + ring * 2.2, ((w.start + w.end) / 2) * scale, base.y * FT);
      group.add(tag);
    });
  }

  // The "now" plane, across the plan.
  const w = (b.maxX - b.minX) * FT;
  const h = (b.maxY - b.minY) * FT;
  const now = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: '#4dabf7', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
  );
  now.rotation.x = -Math.PI / 2;
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)), new THREE.LineBasicMaterial({ color: '#1c7ed6' }));
  edge.rotation.x = -Math.PI / 2;
  const nowGroup = new THREE.Group();
  nowGroup.add(now, edge);
  nowGroup.position.set(((b.minX + b.maxX) / 2) * FT, 0, ((b.minY + b.maxY) / 2) * FT);
  group.add(nowGroup);
  const nowTag = label('0.0 s', { size: 1.5, color: '#ffffff', background: 'rgba(28,126,214,0.9)' });
  group.add(nowTag);

  let lastTag = '';
  const update = (t) => {
    nowGroup.position.y = t * scale;
    const text = `${t.toFixed(1)} s`;
    if (text !== lastTag) {
      // Redraw the tag's text in place.
      const canvas = nowTag.material.map.image;
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = 'rgba(28,126,214,0.9)';
      g.beginPath();
      g.roundRect(0, 0, canvas.width, canvas.height, 14);
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = '700 48px Inter, Helvetica, Arial, sans-serif';
      g.textBaseline = 'middle';
      g.fillText(text, 14, canvas.height / 2 + 2);
      nowTag.material.map.needsUpdate = true;
      lastTag = text;
    }
    nowTag.position.set(base.x * FT - 2.4, t * scale, base.y * FT + 3);
    for (const { dot, track, run } of dots) {
      const p = pointAlong(track.points, track.cum, (t - run.t0) * track.speed);
      dot.visible = !!p;
      if (p) dot.position.copy(at(p, t));
    }
  };
  update(0);

  return { group, update, height, base: at(base, 0) };
}

export function disposeGroup(group) {
  group.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    mats.forEach((m) => {
      if (m.map) m.map.dispose();
      m.dispose();
    });
  });
}
