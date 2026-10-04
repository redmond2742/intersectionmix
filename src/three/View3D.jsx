import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildScene, FT as FT_M } from './buildScene.js';
import { applyPinCamera, fitAspect, syncMarkers } from './pins.js';
import { buildSpaceTime, disposeGroup } from './spaceTime.js';
import { spaceTime, LIVE_GAP } from '../lib/conflictTime.js';
import { usedPhases, isOverlap } from '../lib/model.js';
import {
  makePin, aimAt, nextPinName, pinCaption, withHeight, CAMERA_PRESETS, OUTPUT_SIZES, PIN_ASPECT,
} from '../lib/cameras.js';
import { bearingToCompass } from '../lib/gtss.js';
import { downloadBlob, slugify, planCanvas } from '../lib/download.js';

/** The isometric camera looks in from this side, the south-east. */
const ISO = new THREE.Vector3(1, 1.05, 1).normalize();

/**
 * The 3D view: a full-screen scene of the current design, opened only from
 * the 3D view button. Three.js loads with it, not with the app.
 *
 * Drag to orbit, right-drag (or two fingers) to pan, scroll to zoom.
 * Perspective or isometric. The signal heads show the chosen phase. The
 * scene exports as a PNG, or as a glTF binary (.glb) in metres for Blender,
 * SketchUp and other modelling tools.
 *
 * Camera pins: click where a camera stands, move to aim and click again.
 * Each pin has an eye height, heading, tilt and field of view; its view
 * shows live in the corner, full screen with Look through, and saves as an
 * image. Pins are kept in the design (updateDesign), not in this view.
 */
export default function View3D({ design, geom, planSvg, initialPhase, onClose, say, updateDesign }) {
  const mount = useRef(null);
  const ctx = useRef({});
  const phases = usedPhases(design);
  const [status, setStatus] = useState('Building the 3D scene…');
  const [mode, setMode] = useState('isometric');
  const [phase, setPhase] = useState(initialPhase && phases.includes(initialPhase) ? initialPhase : phases[0] || '');
  const [ready, setReady] = useState(false);
  const pins = design.cameras || [];
  const [panelOpen, setPanelOpen] = useState(pins.length > 0);
  const [selectedId, setSelectedId] = useState(pins[0] ? pins[0].id : null);
  const [pinMode, setPinMode] = useState('idle'); // idle | place | aim
  const [movingId, setMovingId] = useState(null);
  const [lookThrough, setLookThrough] = useState(false);
  const [newHeight, setNewHeight] = useState(5.5);
  const [outputSize, setOutputSize] = useState('fhd');
  const [caption, setCaption] = useState(true);
  // Conflicts in time
  const [stOn, setStOn] = useState(false);
  const [stMode, setStMode] = useState('signal');
  const [stScale, setStScale] = useState(1.2); // metres of height per second
  const [stPlaying, setStPlaying] = useState(true);
  const [stTime, setStTime] = useState(0);
  const [stInfo, setStInfo] = useState(null);
  const selected = pins.find((p) => p.id === selectedId) || null;

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
    ctx.current = { scene, perspective, ortho, camera: ortho, sun };
    if (import.meta.env.DEV) window.__im3d = ctx; // for inspecting the scene from the console while developing

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
      // Opens in isometric; the mode effect takes over from here.
      const controls = new OrbitControls(ortho, renderer.domElement);
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
      ortho.position.copy(center).add(ISO.clone().multiplyScalar(extent * 1.5));
      controls.target.copy(center);
      controls.maxDistance = extent * 3;
      controls.minDistance = 4;
      ctx.current.orthoHalf = extent * 0.3;
      ctx.current.home = { center, extent };

      const markers = new THREE.Group();
      markers.name = 'Camera pins';
      scene.add(markers); // in the scene, not in built.root: never exported
      const pinCamera = new THREE.PerspectiveCamera(55, PIN_ASPECT, 0.1, 4000);
      Object.assign(ctx.current, { markers, pinCamera, surfaces: built.surfaces });

      // Compile every shader and draw the finished scene once while the
      // canvas is still hidden, then fade it in: no empty sky, no pop.
      const view = renderer.domElement;
      view.className = 'view3d-canvas';
      el.appendChild(view);
      resize();
      controls.update();
      renderer.compile(scene, ctx.current.camera);
      renderer.render(scene, ctx.current.camera);
      observer = new ResizeObserver(resize);
      observer.observe(el);
      // Picking a spot on the ground, for placing and aiming pins. A drag is
      // an orbit, not a pick.
      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const hitAt = (e) => {
        const rect = view.getBoundingClientRect();
        ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(ndc, ctx.current.camera);
        const hit = raycaster.intersectObjects(ctx.current.surfaces, false)[0];
        return hit ? { x: hit.point.x / FT_M, y: hit.point.z / FT_M, z: hit.point.y / FT_M } : null;
      };
      view.addEventListener('pointerdown', (e) => {
        ctx.current.down = { x: e.clientX, y: e.clientY };
      });
      view.addEventListener('pointerup', (e) => {
        const c = ctx.current;
        const down = c.down;
        c.down = null;
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
        if (c.pinMode === 'idle' || c.lookThrough) return;
        const hit = hitAt(e);
        if (hit) c.onPick(hit);
      });
      view.addEventListener('pointermove', (e) => {
        const c = ctx.current;
        if (c.pinMode !== 'aim' || c.lookThrough || c.down) return;
        const hit = hitAt(e);
        if (hit) c.onAim(hit);
      });

      const size = new THREE.Vector2();
      const renderPin = (pin, x, y, w, h) => {
        const c = ctx.current;
        applyPinCamera(c.pinCamera, pin, w / h);
        c.markers.visible = false;
        renderer.setViewport(x, y, w, h);
        renderer.setScissor(x, y, w, h);
        renderer.setScissorTest(true);
        renderer.render(scene, c.pinCamera);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, size.x, size.y);
        c.markers.visible = true;
      };
      let last = performance.now();
      const loop = () => {
        frame = requestAnimationFrame(loop);
        const c = ctx.current;
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        c.controls.update();
        // Conflicts in time: sweep the "now" plane up through the cycle.
        if (c.st) {
          if (c.st.playing) c.st.t = (c.st.t + dt * c.st.rate) % c.st.span;
          c.st.update(c.st.t);
          if (now - (c.st.reported || 0) > 120) {
            c.st.reported = now;
            c.onStTime(c.st.t);
          }
        }
        renderer.getSize(size);
        const pin = c.activePin;
        if (pin && c.lookThrough) {
          // The pin's own 16:9 frame, letterboxed, exactly as it will save.
          renderer.setViewport(0, 0, size.x, size.y);
          renderer.setClearColor('#14171b', 1);
          renderer.clear();
          const r = fitAspect(size.x, size.y, PIN_ASPECT);
          renderPin(pin, r.x, r.y, r.w, r.h);
          return;
        }
        renderer.render(scene, c.camera);
        // The live preview goes wherever the inset frame is laid out (it
        // moves on small screens), just inside its border.
        if (pin && c.insetEl) {
          const frameBox = c.insetEl.getBoundingClientRect();
          const canvasBox = view.getBoundingClientRect();
          const b = 2;
          const w = frameBox.width - b * 2;
          const h = frameBox.height - b * 2;
          const x = frameBox.left - canvasBox.left + b;
          const y = canvasBox.bottom - frameBox.bottom + b;
          if (w > 0 && h > 0) renderPin(pin, x, y, w, h);
        }
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
      c.ortho.position.copy(target).add(ISO.clone().multiplyScalar(extent * 1.5));
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

  /* ---------------- Camera pins ---------------- */

  const editPin = (id, recipe, key) => updateDesign((d) => {
    const pin = (d.cameras || []).find((p) => p.id === id);
    if (pin) recipe(pin, d);
  }, key ? { key: `pin:${id}:${key}` } : undefined);

  const startPlacing = () => {
    setLookThrough(false);
    setMovingId(null);
    setPinMode('place');
    setPanelOpen(true);
  };

  const onPick = (hit) => {
    if (pinMode === 'place') {
      if (movingId) {
        editPin(movingId, (pin) => Object.assign(pin, { x: hit.x, y: hit.y, base: hit.z }));
        setMovingId(null);
        setPinMode('idle');
        return;
      }
      const pin = makePin({ name: nextPinName(pins), x: hit.x, y: hit.y, base: hit.z, height: newHeight });
      // Looking at the middle of the intersection until it is aimed.
      Object.assign(pin, aimAt(pin, { x: 0, y: 0, z: 0 }));
      updateDesign((d) => {
        if (!d.cameras) d.cameras = [];
        d.cameras.push(pin);
      });
      setSelectedId(pin.id);
      setPinMode('aim');
    } else if (pinMode === 'aim' && selected) {
      editPin(selected.id, (pin) => Object.assign(pin, aimAt(pin, hit)), 'aim');
      setPinMode('idle');
    }
  };
  const onAim = (hit) => {
    if (selected) editPin(selected.id, (pin) => Object.assign(pin, aimAt(pin, hit)), 'aim');
  };

  // The render loop and pointer handlers read these, not React state.
  useEffect(() => {
    Object.assign(ctx.current, { onPick, onAim, pinMode, lookThrough: lookThrough && !!selected, activePin: selected });
    if (ctx.current.controls) ctx.current.controls.enabled = !(lookThrough && selected);
  });

  useEffect(() => {
    if (ready && ctx.current.markers) syncMarkers(ctx.current.markers, pins, selectedId);
  }, [pins, selectedId, ready]);

  const removePin = (id) => {
    updateDesign((d) => {
      d.cameras = (d.cameras || []).filter((p) => p.id !== id);
    });
    const rest = pins.filter((p) => p.id !== id);
    setSelectedId(rest[0] ? rest[0].id : null);
    setLookThrough(false);
  };

  /** Renders the selected pin's view at the chosen size, off screen, and saves it. */
  const savePinImage = () => {
    const c = ctx.current;
    const pin = selected;
    if (!c.renderer || !pin) return;
    const { w, h } = OUTPUT_SIZES[outputSize];
    const { renderer } = c;
    const ratio = renderer.getPixelRatio();
    const before = renderer.getSize(new THREE.Vector2());
    c.markers.visible = false;
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    applyPinCamera(c.pinCamera, pin, w / h);
    renderer.render(c.scene, c.pinCamera);

    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const g = out.getContext('2d');
    g.drawImage(renderer.domElement, 0, 0, w, h);
    renderer.setPixelRatio(ratio);
    renderer.setSize(before.x, before.y, false);
    c.markers.visible = true;

    if (caption) {
      const size = Math.round(h * 0.024);
      const pad = Math.round(size * 0.8);
      const lines = [design.name, pinCaption(pin)];
      g.fillStyle = 'rgba(16, 19, 23, 0.62)';
      g.fillRect(0, h - (size * 2.6 + pad * 2), w, size * 2.6 + pad * 2);
      g.fillStyle = '#ffffff';
      g.textBaseline = 'top';
      g.font = `700 ${size}px Inter, Helvetica, Arial, sans-serif`;
      g.fillText(lines[0], pad, h - (size * 2.6 + pad));
      g.font = `400 ${Math.round(size * 0.85)}px Inter, Helvetica, Arial, sans-serif`;
      g.fillText(lines[1], pad, h - (size * 1.3 + pad * 0.6));
    }
    out.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, `${slugify(design.name)}-${slugify(pin.name)}.png`);
        say(`Saved ${pin.name}'s view at ${w} × ${h}.`);
      }
    }, 'image/png');
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (pinMode !== 'idle') {
        setPinMode('idle');
        setMovingId(null);
      } else if (lookThrough) {
        setLookThrough(false);
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pinMode, lookThrough]);

  /* ---------------- Conflicts in time ---------------- */

  useEffect(() => {
    ctx.current.onStTime = setStTime;
  }, []);

  useEffect(() => {
    const c = ctx.current;
    if (!ready || !c.built) return;
    const previous = c.st;
    if (previous) {
      c.scene.remove(previous.group);
      disposeGroup(previous.group);
      c.st = null;
    }
    const layers = Object.values(c.built.layers || {});
    if (!stOn) {
      layers.forEach((layer) => { layer.visible = true; });
      if (previous) resetView();
      setStInfo(null);
      return;
    }
    const data = spaceTime(design, geom, { mode: stMode });
    const built = buildSpaceTime(data, geom, { scale: stScale });
    c.scene.add(built.group);
    layers.forEach((layer) => { layer.visible = false; });
    c.st = {
      ...built,
      span: data.span,
      t: previous ? Math.min(previous.t, data.span) : 0,
      rate: Math.max(1, data.span / 24), // a cycle in about 24 seconds
      playing: stPlaying,
    };
    setStInfo({ span: data.span, cycle: data.schedule.cycle, counts: data.counts, conflicts: data.conflicts.length });
    if (!previous) {
      // Stand back far enough to see the whole column of time.
      const { center, extent } = c.home;
      const tall = built.height;
      const e = Math.max(extent, tall);
      c.controls.target.set(center.x, tall * 0.42, center.z);
      if (c.camera === c.perspective) {
        // From the south-east, so the time axis (off the south-west corner) stands to one side.
        c.perspective.position.set(center.x + e * 0.62, tall * 0.55 + e * 0.32, center.z + e * 0.92);
      } else {
        // Isometric: zoom out until the whole column fits.
        c.ortho.position.copy(c.controls.target).add(ISO.clone().multiplyScalar(e * 1.5));
        c.ortho.zoom = Math.min(1, (c.orthoHalf || 50) / (e * 0.62));
        c.ortho.updateProjectionMatrix();
      }
      c.controls.maxDistance = e * 4;
    }
  }, [stOn, stMode, stScale, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ctx.current.st) ctx.current.st.playing = stPlaying;
  }, [stPlaying]);

  const scrubTo = (t) => {
    const c = ctx.current;
    if (!c.st) return;
    c.st.t = t;
    setStPlaying(false);
    setStTime(t);
  };

  const resetView = () => {
    const c = ctx.current;
    if (!c.home) return;
    const { center, extent } = c.home;
    c.controls.target.copy(center);
    if (c.camera === c.perspective) {
      c.perspective.position.set(center.x - extent * 0.32, extent * 0.5, center.z + extent * 0.62);
    } else {
      c.ortho.position.copy(center).add(ISO.clone().multiplyScalar(extent * 1.5));
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
        <button type="button" className={panelOpen ? 'on' : ''} onClick={() => setPanelOpen((v) => !v)} disabled={!ready}
          aria-pressed={panelOpen}>Camera pins{pins.length ? ` (${pins.length})` : ''}</button>
        <button type="button" className={stOn ? 'on' : ''} onClick={() => setStOn((v) => !v)} disabled={!ready}
          aria-pressed={stOn} title="Conflict points in space and time">Conflicts in time</button>
        <span className="view3d-spacer" />
        <button type="button" onClick={resetView} disabled={!ready}>Reset view</button>
        <button type="button" onClick={snapshot} disabled={!ready}>PNG</button>
        <button type="button" className="primary" onClick={exportModel} disabled={!ready}>3D model (.glb)</button>
        <button type="button" className="view3d-close" aria-label="Close 3D view" onClick={onClose}>×</button>
      </div>
      <div className={`view3d-stage${pinMode !== 'idle' ? ' picking' : ''}`} ref={mount}>
        {status && <div className="view3d-status">{status}</div>}

        {ready && panelOpen && (
          <PinPanel
            pins={pins} selected={selected} pinMode={pinMode} movingId={movingId} lookThrough={lookThrough}
            newHeight={newHeight} setNewHeight={setNewHeight}
            outputSize={outputSize} setOutputSize={setOutputSize} caption={caption} setCaption={setCaption}
            onSelect={(id) => { setSelectedId(id); setPinMode('idle'); }}
            onPlace={startPlacing}
            onCancel={() => { setPinMode('idle'); setMovingId(null); }}
            onMove={() => { setMovingId(selected.id); setLookThrough(false); setPinMode('place'); }}
            onReaim={() => { setLookThrough(false); setPinMode('aim'); }}
            onEdit={editPin}
            onLookThrough={() => setLookThrough((v) => !v)}
            onSave={savePinImage}
            onRemove={removePin}
            onClose={() => setPanelOpen(false)}
          />
        )}

        {ready && stOn && stInfo && (
          <div className="st-panel" onPointerDown={(e) => e.stopPropagation()}>
            <div className="pin-head">
              <strong>Conflicts in time</strong>
              <button type="button" className="pin-x" aria-label="Turn off conflicts in time" onClick={() => setStOn(false)}>×</button>
            </div>
            <p className="pin-note">
              The plan is the ground; height is time. Each tube is a movement crossing the intersection. Every conflict
              point shows the moment each movement reaches it, joined by a link: <b className="st-live">red</b> when they
              are under {LIVE_GAP} s apart, grey when time keeps them apart.
            </p>
            <div className="segmented light" role="group" aria-label="Timing">
              <button type="button" className={stMode === 'none' ? 'on' : ''} onClick={() => setStMode('none')}>No signals</button>
              <button type="button" className={stMode === 'signal' ? 'on' : ''} onClick={() => setStMode('signal')}>Signal timing</button>
            </div>
            <div className="st-counts">
              <span><b className="st-live">{stInfo.counts.live}</b> live</span>
              <span><b>{stInfo.counts.separated}</b> separated by time</span>
              <span className="pin-meta">of {stInfo.conflicts} conflict points</span>
            </div>
            {stMode === 'signal' && (
              <p className="pin-note">
                Default dual-ring cycle of {Math.round(stInfo.cycle)} s: lefts 12 s, throughs 28 s, 4 s change. Coloured
                bands on the time axis are each phase&apos;s green.
              </p>
            )}
            <div className="pin-section">
              <span className="pin-label">Time {stTime.toFixed(1)} s</span>
              <div className="pin-row">
                <button type="button" onClick={() => setStPlaying((v) => !v)} aria-label={stPlaying ? 'Pause' : 'Play'}>
                  {stPlaying ? '❚❚' : '▶'}
                </button>
                <input type="range" min="0" max={stInfo.span} step="0.1" value={Math.min(stTime, stInfo.span)}
                  onChange={(e) => scrubTo(Number(e.target.value))} aria-label="Time" />
              </div>
            </div>
            <div className="pin-section">
              <span className="pin-label">Height per second {stScale.toFixed(1)} m</span>
              <input type="range" min="0.3" max="3" step="0.1" value={stScale} onChange={(e) => setStScale(Number(e.target.value))} aria-label="Height per second" />
            </div>
            <div className="st-legend">
              <span><i style={{ background: '#c92a2a' }} />Diverging</span>
              <span><i style={{ background: '#e8590c' }} />Merging</span>
              <span><i className="ring" />Crossing</span>
              <span><i style={{ background: '#1971c2' }} />Pedestrian</span>
            </div>
          </div>
        )}

        {ready && selected && !lookThrough && (
          <div className="pin-inset" aria-hidden="true" ref={(node) => { ctx.current.insetEl = node; }}>
            <span>{selected.name}</span>
          </div>
        )}
        {ready && selected && lookThrough && (
          <div className="pin-lookbar">
            <span>Viewing from <strong>{selected.name}</strong> · {pinCaption(selected).split(' · ').slice(1).join(' · ')}</span>
            <button type="button" className="primary" onClick={savePinImage}>Save image</button>
            <button type="button" onClick={() => setLookThrough(false)}>Back to 3D</button>
          </div>
        )}
        <div className="view3d-hint">
          {pinMode === 'place' && (movingId ? 'Click where the camera should stand now · Esc to cancel' : 'Click the ground where the camera stands · Esc to cancel')}
          {pinMode === 'aim' && 'Move to aim · click to set the view · Esc to keep it'}
          {pinMode === 'idle' && (lookThrough ? 'Esc to return to the 3D view' : 'Drag to orbit · right-drag to pan · scroll to zoom · Esc to close')}
        </div>
      </div>
    </div>
  );
}

const round1 = (n) => Math.round(n * 10) / 10;

/** The camera pin list and the selected pin's settings. */
function PinPanel({
  pins, selected, pinMode, movingId, lookThrough, newHeight, setNewHeight, outputSize, setOutputSize,
  caption, setCaption, onSelect, onPlace, onCancel, onMove, onReaim, onEdit, onLookThrough, onSave, onRemove, onClose,
}) {
  const set = (field, key) => (value) => onEdit(selected.id, (pin) => { pin[field] = value; }, key || field);
  const num = (fn) => (e) => {
    const n = Number(e.target.value);
    if (e.target.value !== '' && Number.isFinite(n)) fn(n);
  };
  const heightOf = selected ? selected.height : newHeight;
  // A pin's new height keeps it looking at the same spot on the ground.
  const setHeight = selected
    ? (value) => onEdit(selected.id, (pin) => Object.assign(pin, withHeight(pin, value)), 'height')
    : setNewHeight;

  return (
    <div className="pin-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="pin-head">
        <strong>Camera pins</strong>
        <button type="button" className="pin-x" aria-label="Hide camera pins" onClick={onClose}>×</button>
      </div>

      {pinMode === 'idle'
        ? <button type="button" className="primary pin-place" onClick={onPlace}>+ Place pin</button>
        : (
          <div className="pin-step">
            <span>{pinMode === 'aim' ? 'Move the mouse to aim, then click.' : movingId ? 'Click where it should stand now.' : 'Click the ground where the camera stands.'}</span>
            <button type="button" onClick={onCancel}>{pinMode === 'aim' ? 'Done' : 'Cancel'}</button>
          </div>
        )}

      {pins.length > 0 && (
        <ul className="pin-list">
          {pins.map((pin) => (
            <li key={pin.id}>
              <button type="button" className={selected && pin.id === selected.id ? 'on' : ''} onClick={() => onSelect(pin.id)}>
                <span>{pin.name}</span>
                <span className="pin-meta">{round1(pin.height)} ft · {bearingToCompass(pin.heading)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="pin-section">
        <span className="pin-label">{selected ? 'Eye height' : 'Eye height for new pins'}</span>
        <div className="pin-presets">
          {CAMERA_PRESETS.map((p) => (
            <button key={p.id} type="button" className={Math.abs(heightOf - p.height) < 0.05 ? 'on' : ''}
              onClick={() => setHeight(p.height)} title={`${p.height} ft`}>{p.label}</button>
          ))}
        </div>
        <label className="pin-row">
          <input type="range" min="1" max="200" step="0.5" value={Math.min(200, heightOf)} onChange={num(setHeight)} />
          <input type="number" min="0.5" max="2000" step="0.5" value={heightOf} onChange={num(setHeight)} aria-label="Eye height in feet" />
          <span>ft</span>
        </label>
      </div>

      {selected && (
        <>
          <label className="pin-section">
            <span className="pin-label">Name</span>
            <input type="text" value={selected.name} onChange={(e) => set('name')(e.target.value)} />
          </label>
          <div className="pin-section">
            <span className="pin-label">Facing {bearingToCompass(selected.heading)} · {Math.round(selected.heading)}°</span>
            <input type="range" min="0" max="359" value={Math.round(selected.heading)} onChange={num(set('heading'))} aria-label="Heading" />
          </div>
          <div className="pin-section">
            <span className="pin-label">Tilt {round1(selected.tilt)}° {selected.tilt < 0 ? '(down)' : selected.tilt > 0 ? '(up)' : ''}</span>
            <input type="range" min="-89" max="45" step="0.5" value={selected.tilt} onChange={num(set('tilt'))} aria-label="Tilt" />
          </div>
          <div className="pin-section">
            <span className="pin-label">Field of view {Math.round(selected.fov)}° {selected.fov < 35 ? '(zoomed)' : selected.fov > 75 ? '(wide)' : ''}</span>
            <input type="range" min="15" max="110" value={selected.fov} onChange={num(set('fov'))} aria-label="Field of view" />
          </div>
          <div className="pin-buttons">
            <button type="button" onClick={onReaim} disabled={pinMode !== 'idle'}>Aim</button>
            <button type="button" onClick={onMove} disabled={pinMode !== 'idle'}>Move</button>
            <button type="button" className={lookThrough ? 'on' : ''} onClick={onLookThrough}>{lookThrough ? 'Back to 3D' : 'Look through'}</button>
            <button type="button" className="danger" onClick={() => onRemove(selected.id)}>Delete</button>
          </div>
          <div className="pin-section pin-save">
            <span className="pin-label">Save this view</span>
            <select value={outputSize} onChange={(e) => setOutputSize(e.target.value)}>
              {Object.entries(OUTPUT_SIZES).map(([id, o]) => <option key={id} value={id}>{o.label}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={caption} onChange={(e) => setCaption(e.target.checked)} /> Caption</label>
            <button type="button" className="primary" onClick={onSave}>Save image</button>
          </div>
        </>
      )}
      {!pins.length && pinMode === 'idle' && (
        <p className="pin-note">Place a pin to see the intersection from a driver&apos;s seat, a crosswalk, a pole or the air, and save that view as an image.</p>
      )}
    </div>
  );
}
