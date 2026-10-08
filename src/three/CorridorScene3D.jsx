import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildCorridorScene } from './corridorScene.js';
import { createStage, aimSun, createRenderer } from './stage.js';
import { FT } from './buildScene.js';
import { movementSignal } from '../lib/hires.js';
import { priorityApproaches } from '../lib/its.js';
import { corridorVehiclesAt } from '../lib/corridorVehicles.js';

/** The isometric camera looks in from the south-east, as the single-intersection view does. */
const ISO = new THREE.Vector3(1, 1.05, 1).normalize();

function disposeTree(root) {
  root.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    mats.forEach((m) => {
      if (m.map) m.map.dispose();
      m.dispose();
    });
  });
}

/**
 * The corridor in 3D: every signal's lamps following its own data, the
 * vehicles the detectors saw driving from signal to signal, and an
 * approach washed in colour while a preempt or priority request runs on it.
 * Orbit, pan and zoom; isometric or perspective; jump to any signal.
 */
export default function CorridorScene3D({ layout, mapSvgRef, stores, master, model, equipment }) {
  const mount = useRef(null);
  const ctx = useRef({});
  const [status, setStatus] = useState('Building the corridor…');
  const [mode, setMode] = useState('isometric');
  const [focus, setFocus] = useState('all');

  // Renderer, cameras and the frame loop: once.
  useEffect(() => {
    const el = mount.current;
    const renderer = createRenderer();
    const { scene, sun } = createStage();
    const perspective = new THREE.PerspectiveCamera(40, 1, 0.5, 20000);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -20000, 20000);
    renderer.domElement.className = 'view3d-canvas shown';
    el.appendChild(renderer.domElement);
    const controls = new OrbitControls(ortho, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    const c = ctx.current;
    Object.assign(c, { renderer, scene, sun, perspective, ortho, camera: ortho, controls, half: 200 });
    if (import.meta.env.DEV) window.__imCorridor3d = ctx; // for inspecting the scene from the console while developing

    const resize = () => {
      const w = el.clientWidth;
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h);
      perspective.aspect = w / h;
      perspective.updateProjectionMatrix();
      ortho.left = -c.half * (w / h);
      ortho.right = c.half * (w / h);
      ortho.top = c.half;
      ortho.bottom = -c.half;
      ortho.updateProjectionMatrix();
    };
    c.resize = resize;
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    let frame = 0;
    const loop = (now) => {
      frame = requestAnimationFrame(loop);
      c.controls.update();
      const built = c.built;
      if (built) {
        // Vehicles, from the shared clock.
        if (c.model && master.clock && now - (c.lastCars || 0) > 40) {
          c.lastCars = now;
          built.setVehicles(corridorVehiclesAt(c.model, master.clock.t));
        }
        // Flashing yellow arrows, and approaches being preempted, keep moving.
        if (now - (c.lastBlink || 0) > 120) {
          c.lastBlink = now;
          built.signals.forEach((b, i) => {
            const snap = c.snaps[i];
            if (!snap) return;
            const design = c.layout.signals[i].design;
            if (c.flashing[i]) c.flashing[i] = b.setSignals((leg, turn) => movementSignal(design, leg, turn, snap), now);
            if (c.priorityOn[i]) c.priorityOn[i] = b.setPriority(priorityApproaches(design, snap), now);
          });
        }
      }
      renderer.render(scene, c.camera);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      c.controls.dispose();
      if (c.built) disposeTree(c.built.root);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      ctx.current = {};
    };
  }, [master]);

  // The scene, rebuilt when the corridor changes.
  useEffect(() => {
    const c = ctx.current;
    const svg = mapSvgRef.current;
    if (!svg || !layout.signals.length) return undefined;
    let cancelled = false;
    setStatus('Building the corridor…');
    (async () => {
      try {
        const built = await buildCorridorScene({
          layout, svg, equipment,
          maxTexture: c.renderer.capabilities.maxTextureSize,
          anisotropy: c.renderer.capabilities.getMaxAnisotropy(),
        });
        if (cancelled || !c.renderer) {
          disposeTree(built.root);
          return;
        }
        if (c.built) {
          c.scene.remove(c.built.root);
          disposeTree(c.built.root);
        }
        c.scene.add(built.root);
        Object.assign(c, { built, layout, snaps: [], flashing: [], priorityOn: [] });
        aimSun(c.sun, built.center, built.size);
        // A corridor is far bigger than an intersection: push the haze out to match.
        c.scene.fog.near = Math.max(500, built.size * 2.5);
        c.scene.fog.far = Math.max(1600, built.size * 8);
        c.home = { center: built.center, size: built.size };
        c.frame(focus);
        // Lamps from whatever each signal shows now.
        stores.forEach((store, i) => c.applySignal && c.applySignal(i, store.get()));
        setStatus(null);
      } catch (err) {
        if (!cancelled) setStatus(`The 3D corridor could not be built: ${err.message}`);
      }
    })();
    return () => { cancelled = true; };
  }, [layout, equipment, mapSvgRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each signal's lamps and preemption wash, from its own store.
  useEffect(() => {
    const c = ctx.current;
    c.applySignal = (i, snap) => {
      if (!c.built || !c.built.signals[i]) return;
      const design = c.layout.signals[i].design;
      const b = c.built.signals[i];
      c.snaps[i] = snap;
      if (snap) {
        c.flashing[i] = b.setSignals((leg, turn) => movementSignal(design, leg, turn, snap));
        c.priorityOn[i] = b.setPriority(priorityApproaches(design, snap));
      } else {
        c.flashing[i] = false;
        b.setPhase('');
        c.priorityOn[i] = b.setPriority({});
      }
    };
    const offs = stores.map((store, i) => store.subscribe(() => c.applySignal(i, store.get())));
    stores.forEach((store, i) => c.applySignal(i, store.get()));
    return () => offs.forEach((off) => off());
  }, [stores]);

  useEffect(() => {
    ctx.current.model = model;
    if (!model && ctx.current.built) ctx.current.built.setVehicles([]);
  }, [model]);

  // Framing: the whole corridor, or one signal; isometric or perspective.
  useEffect(() => {
    const c = ctx.current;
    c.frame = (which) => {
      if (!c.home) return;
      const sig = which === 'all' ? null : layout.signals[Number(which)];
      const target = sig ? new THREE.Vector3(sig.offset.x * FT, 0, sig.offset.y * FT) : c.home.center.clone();
      const extent = sig ? Math.max(60, sig.clip * 2.2 * FT) : c.home.size;
      c.controls.dispose();
      if (mode === 'isometric') {
        c.half = extent * 0.36;
        c.ortho.position.copy(target).add(ISO.clone().multiplyScalar(extent * 1.6));
        c.ortho.zoom = 1;
        c.camera = c.ortho;
      } else {
        c.perspective.position.set(target.x + extent * 0.45, extent * 0.42, target.z + extent * 0.7);
        c.camera = c.perspective;
      }
      c.resize();
      c.controls = new OrbitControls(c.camera, c.renderer.domElement);
      c.controls.enableDamping = true;
      c.controls.maxPolarAngle = Math.PI * 0.49;
      c.controls.target.copy(target);
      c.controls.maxDistance = c.home.size * 3;
      c.controls.update();
    };
    c.frame(focus);
  }, [mode, focus, layout]);

  return (
    <div className="corridor-3d">
      <div className="view3d-stage" ref={mount}>
        {status && <div className="view3d-status">{status}</div>}
      </div>
      <div className="corridor-3d-bar">
        <div className="segmented" role="group" aria-label="Camera">
          <button type="button" className={mode === 'isometric' ? 'on' : ''} onClick={() => setMode('isometric')}>Isometric</button>
          <button type="button" className={mode === 'perspective' ? 'on' : ''} onClick={() => setMode('perspective')}>Perspective</button>
        </div>
        <select value={focus} onChange={(e) => setFocus(e.target.value)} aria-label="Look at">
          <option value="all">Whole corridor</option>
          {layout.signals.map((s) => <option key={s.index} value={s.index}>{`${s.index + 1}. ${s.design.name}`}</option>)}
        </select>
      </div>
    </div>
  );
}
