import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { buildScene } from './buildScene.js';
import { createStage, aimSun, createRenderer } from './stage.js';
import { applyPinCamera } from './pins.js';
import { planCanvas } from '../lib/download.js';
import { movementSignal } from '../lib/hires.js';

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
 * The intersection in 3D, seen from a CCTV camera's pole, height and aim,
 * with its signal lamps following playback: for setting beside (or over)
 * that camera's video. Draws on demand, not every frame.
 *
 * `pin` is the CCTV's camera pose; `aspect`, when given, is the video's,
 * so the two frame the same view.
 */
export default function CctvView({ design, geom, planSvg, pin, store, aspect }) {
  const mount = useRef(null);
  const ctx = useRef({});
  const [status, setStatus] = useState('Building the view…');

  // Renderer, once.
  useEffect(() => {
    const el = mount.current;
    const renderer = createRenderer();
    const { scene, sun } = createStage({ shadowSize: 2048 });
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 4000);
    renderer.domElement.className = 'cctv-canvas';
    el.appendChild(renderer.domElement);
    const c = ctx.current;
    Object.assign(c, { renderer, scene, sun, camera });
    c.draw = () => {
      if (!c.pin) return;
      const w = el.clientWidth;
      const h = Math.max(1, el.clientHeight);
      const size = renderer.getSize(new THREE.Vector2());
      if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
      applyPinCamera(camera, c.pin, w / h);
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(() => c.draw());
    observer.observe(el);
    // A flashing yellow arrow needs redrawing a few times a second.
    const blink = setInterval(() => {
      if (c.flashing && c.built && c.snap) {
        c.built.setSignals((leg, turn) => movementSignal(c.design, leg, turn, c.snap));
        c.draw();
      }
    }, 250);
    return () => {
      clearInterval(blink);
      observer.disconnect();
      if (c.built) disposeTree(c.built.root);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      ctx.current = {};
    };
  }, []);

  const applySignals = () => {
    const c = ctx.current;
    if (!c.built) return;
    if (c.snap) c.flashing = c.built.setSignals((leg, turn) => movementSignal(c.design, leg, turn, c.snap));
    else {
      c.flashing = false;
      c.built.setPhase('');
    }
  };

  // The scene, rebuilt (debounced) when the design changes.
  useEffect(() => {
    const c = ctx.current;
    c.design = design;
    if (!planSvg) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const canvas = await planCanvas(planSvg, geom.bounds, 2048);
        if (cancelled || !c.renderer) return;
        const built = buildScene({ design, geom, planCanvas: canvas, anisotropy: c.renderer.capabilities.getMaxAnisotropy(), equipment: true });
        if (c.built) {
          c.scene.remove(c.built.root);
          disposeTree(c.built.root);
        }
        c.scene.add(built.root);
        c.built = built;
        aimSun(c.sun, built.center, built.size);
        applySignals();
        c.draw();
        setStatus(null);
      } catch (err) {
        if (!cancelled) setStatus(`The 3D view could not be built: ${err.message}`);
      }
    }, ctx.current.built ? 500 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [design, geom, planSvg]); // eslint-disable-line react-hooks/exhaustive-deps

  // The camera pose.
  useEffect(() => {
    ctx.current.pin = pin;
    if (ctx.current.draw) ctx.current.draw();
  }, [pin]);

  // The lamps, from playback.
  useEffect(() => {
    if (!store) return undefined;
    const c = ctx.current;
    const onChange = () => {
      c.snap = store.get();
      applySignals();
      if (c.draw) c.draw();
    };
    onChange();
    return store.subscribe(onChange);
  }, [store]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cctv-view" ref={mount} style={aspect ? { aspectRatio: String(aspect) } : undefined}>
      {status && <div className="cctv-status">{status}</div>}
    </div>
  );
}
