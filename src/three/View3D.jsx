import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildScene } from './buildScene.js';
import { usedPhases, isOverlap } from '../lib/model.js';
import { downloadBlob, slugify, planCanvas } from '../lib/download.js';

/**
 * The 3D view: a full-screen scene of the current design, opened only from
 * the 3D view button. Three.js loads with it, not with the app.
 *
 * Drag to orbit, right-drag (or two fingers) to pan, scroll to zoom.
 * Perspective or isometric. The signal heads show the chosen phase. The
 * scene exports as a PNG, or as a glTF binary (.glb) in metres for Blender,
 * SketchUp and other modelling tools.
 */
export default function View3D({ design, geom, planSvg, initialPhase, onClose, say }) {
  const mount = useRef(null);
  const ctx = useRef({});
  const phases = usedPhases(design);
  const [status, setStatus] = useState('Building the 3D scene…');
  const [mode, setMode] = useState('perspective');
  const [phase, setPhase] = useState(initialPhase && phases.includes(initialPhase) ? initialPhase : phases[0] || '');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = mount.current;
    let disposed = false;
    let frame = 0;
    let renderer = null;
    let observer = null;

    // Nothing touches the GPU until the plan texture is ready. React's
    // StrictMode mounts this effect twice in development; the throwaway
    // mount is disposed before its await returns, so it never creates a
    // WebGL context. Creating and tearing one down is a visible stall.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#cfe1f1');
    scene.fog = new THREE.Fog('#cfe1f1', 500, 1600);
    const hemi = new THREE.HemisphereLight('#f4f8ff', '#b7b29a', 1.1);
    const sun = new THREE.DirectionalLight('#fff6e8', 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    scene.add(hemi, sun, sun.target);
    const perspective = new THREE.PerspectiveCamera(40, 1, 0.3, 4000);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 4000);
    ctx.current = { scene, perspective, ortho, camera: perspective, sun };

    const resize = () => {
      if (!renderer) return;
      const width = el.clientWidth;
      const height = Math.max(1, el.clientHeight);
      renderer.setSize(width, height);
      perspective.aspect = width / height;
      perspective.updateProjectionMatrix();
      const half = ctx.current.orthoHalf || 50;
      ortho.left = -half * (width / height);
      ortho.right = half * (width / height);
      ortho.top = half;
      ortho.bottom = -half;
      ortho.updateProjectionMatrix();
    };

    (async () => {
      const canvas = await planCanvas(planSvg, geom.bounds, 4096);
      if (disposed) return;

      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const controls = new OrbitControls(perspective, renderer.domElement);
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI * 0.49;
      Object.assign(ctx.current, { renderer, controls });

      const built = buildScene({ design, geom, planCanvas: canvas, anisotropy: renderer.capabilities.getMaxAnisotropy() });
      scene.add(built.root);
      ctx.current.built = built;
      built.setPhase(ctx.current.phase || '');

      const { center, size: extent } = built;
      sun.position.set(center.x - extent * 0.45, extent * 0.9, center.z + extent * 0.55);
      sun.target.position.copy(center);
      const cam = sun.shadow.camera;
      cam.left = -extent * 0.7;
      cam.right = extent * 0.7;
      cam.top = extent * 0.7;
      cam.bottom = -extent * 0.7;
      cam.near = 1;
      cam.far = extent * 3;
      cam.updateProjectionMatrix();

      perspective.position.set(center.x - extent * 0.32, extent * 0.5, center.z + extent * 0.62);
      controls.target.copy(center);
      controls.maxDistance = extent * 3;
      controls.minDistance = 4;
      ctx.current.orthoHalf = extent * 0.3;
      ctx.current.home = { center, extent };

      // Compile every shader and draw the finished scene once while the
      // canvas is still hidden, then fade it in: no empty sky, no pop.
      const view = renderer.domElement;
      view.className = 'view3d-canvas';
      el.appendChild(view);
      resize();
      controls.update();
      renderer.compile(scene, perspective);
      renderer.render(scene, perspective);
      observer = new ResizeObserver(resize);
      observer.observe(el);
      const loop = () => {
        frame = requestAnimationFrame(loop);
        ctx.current.controls.update();
        renderer.render(scene, ctx.current.camera);
      };
      frame = requestAnimationFrame(() => {
        view.classList.add('shown');
        loop();
      });
      setStatus(null);
      setReady(true);
    })().catch((err) => {
      if (!disposed) setStatus(`The 3D view could not be built: ${err.message}`);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
      if (ctx.current.controls) ctx.current.controls.dispose();
      scene.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
        mats.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      });
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss(); // release the GPU context now, not at garbage collection
        renderer.domElement.remove();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    ctx.current.phase = phase;
    if (ready && ctx.current.built) ctx.current.built.setPhase(phase);
  }, [phase, ready]);

  // Switching cameras keeps the point being looked at.
  useEffect(() => {
    if (!ready) return;
    const c = ctx.current;
    const target = c.controls.target.clone();
    const { extent } = c.home;
    c.controls.dispose();
    if (mode === 'isometric') {
      c.ortho.position.copy(target).add(new THREE.Vector3(1, 1.05, 1).normalize().multiplyScalar(extent * 1.5));
      c.ortho.zoom = 1;
      c.ortho.updateProjectionMatrix();
      c.camera = c.ortho;
    } else {
      c.camera = c.perspective;
    }
    c.controls = new OrbitControls(c.camera, c.renderer.domElement);
    c.controls.enableDamping = true;
    c.controls.maxPolarAngle = Math.PI * 0.49;
    c.controls.target.copy(target);
    c.controls.maxDistance = extent * 3;
  }, [mode, ready]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const resetView = () => {
    const c = ctx.current;
    if (!c.home) return;
    const { center, extent } = c.home;
    c.controls.target.copy(center);
    if (c.camera === c.perspective) {
      c.perspective.position.set(center.x - extent * 0.32, extent * 0.5, center.z + extent * 0.62);
    } else {
      c.ortho.position.copy(center).add(new THREE.Vector3(1, 1.05, 1).normalize().multiplyScalar(extent * 1.5));
      c.ortho.zoom = 1;
      c.ortho.updateProjectionMatrix();
    }
  };

  const snapshot = () => {
    const c = ctx.current;
    c.renderer.render(c.scene, c.camera);
    c.renderer.domElement.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${slugify(design.name)}-3d.png`);
    }, 'image/png');
  };

  const exportModel = () => {
    const c = ctx.current;
    if (!c.built) return;
    new GLTFExporter().parse(
      c.built.root,
      (result) => {
        downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), `${slugify(design.name)}.glb`);
        say('Exported the 3D model as glTF binary (.glb), in metres. It opens in Blender, SketchUp, 3ds Max and most modelling tools.');
      },
      (err) => say(`The 3D model could not be exported: ${err.message || err}`, 'error'),
      { binary: true },
    );
  };

  return (
    <div className="view3d" role="dialog" aria-modal="true" aria-label="3D view">
      <div className="view3d-bar">
        <strong className="view3d-title">3D · {design.name}</strong>
        <div className="segmented" role="group" aria-label="Camera">
          <button type="button" className={mode === 'perspective' ? 'on' : ''} onClick={() => setMode('perspective')}>Perspective</button>
          <button type="button" className={mode === 'isometric' ? 'on' : ''} onClick={() => setMode('isometric')}>Isometric</button>
        </div>
        <label className="view3d-phase">
          Signals
          <select value={phase} onChange={(e) => setPhase(e.target.value)}>
            <option value="">All red</option>
            {phases.map((p) => <option key={p} value={p}>Phase {p}{isOverlap(design, p) ? ' (overlap)' : ''}</option>)}
          </select>
        </label>
        <span className="view3d-spacer" />
        <button type="button" onClick={resetView} disabled={!ready}>Reset view</button>
        <button type="button" onClick={snapshot} disabled={!ready}>PNG</button>
        <button type="button" className="primary" onClick={exportModel} disabled={!ready}>3D model (.glb)</button>
        <button type="button" className="view3d-close" aria-label="Close 3D view" onClick={onClose}>×</button>
      </div>
      <div className="view3d-stage" ref={mount}>
        {status && <div className="view3d-status">{status}</div>}
        <div className="view3d-hint">Drag to orbit · right-drag to pan · scroll to zoom · Esc to close</div>
      </div>
    </div>
  );
}
