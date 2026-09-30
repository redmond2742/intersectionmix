import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import IntersectionCanvas from './components/IntersectionCanvas.jsx';
import Inspector from './components/Inspector.jsx';
import LegStrip from './components/LegStrip.jsx';
import PhaseDiagrams from './components/PhaseDiagrams.jsx';
import SignalPicker from './components/SignalPicker.jsx';
import ExportMenu from './components/ExportMenu.jsx';
import { useHistory } from './useHistory.js';
import { computeGeometry } from './lib/geometry.js';
import {
  createTemplate, TEMPLATES, validate, findLeg, removeLane, removeDetector, setBearing, uid,
} from './lib/model.js';
import { listSignals, designFromGtss, gtssFromDesign } from './lib/gtssMapping.js';
import { readZipText } from './lib/zipReader.js';
import { zipBlob } from './lib/zipWriter.js';
import { saveDesign, loadDesign, saveFeed, loadFeed, encodeShare, decodeShare, SHARE_PREFIX } from './lib/store.js';
import { downloadBlob, slugify, svgMarkup, svgToPngBlob, phaseSheetMarkup } from './lib/download.js';
import { designFile, parseDesignFile, detectorCsv, sheetTitle } from './lib/exports.js';
import { DETECTOR_COLORS, COLORS } from './palette.js';

// Three.js and the 3D scene load only when the 3D view is opened.
const View3D = lazy(() => import('./three/View3D.jsx'));

function isTyping(target) {
  return target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
}

export default function App() {
  const history = useHistory(() => loadDesign() || createTemplate('four'));
  const { design, update, replace, undo, redo, commit } = history;
  const [selection, setSelection] = useState(null);
  const [phase, setPhase] = useState(null);
  const [feed, setFeed] = useState(() => loadFeed());
  const [picker, setPicker] = useState(null); // { files, label, signals }
  const [show3d, setShow3d] = useState(false);
  const [toast, setToast] = useState(null);
  const [canvasKey, setCanvasKey] = useState(0); // remounts the canvas, refitting it, on a new design
  const svgRef = useRef(null);
  const phasesRef = useRef(null);
  const fileRef = useRef(null);
  const linked = useRef(null);

  const geom = useMemo(() => computeGeometry(design), [design]);
  const checks = useMemo(() => validate(design), [design]);
  const attachedFeed = feed && design.source && design.source.feedId === feed.id ? feed : null;

  const say = useCallback((text, tone = 'info', ms = 5000) => {
    setToast({ text, tone, id: uid('t') });
    if (ms) setTimeout(() => setToast((t) => (t && t.text === text ? null : t)), ms);
  }, []);

  // A shared link wins over the autosave.
  useEffect(() => {
    if (!window.location.hash.startsWith(SHARE_PREFIX)) return;
    decodeShare(window.location.hash).then((shared) => {
      if (shared) {
        linked.current = shared;
        replace(shared);
        setCanvasKey((k) => k + 1);
        setSelection(null);
        say(`Opened a shared design: ${shared.name}.`);
      } else {
        say('That link could not be read; showing your last design instead.', 'warn');
      }
    });
  }, [replace, say]);

  // Autosave, and drop a share hash once the design moves on from it.
  useEffect(() => {
    const timer = setTimeout(() => saveDesign(design), 400);
    if (linked.current && linked.current !== design && window.location.hash.startsWith(SHARE_PREFIX)) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      linked.current = null;
    }
    return () => clearTimeout(timer);
  }, [design]);

  const select = useCallback((next) => {
    setSelection(next);
    if (next) setPhase(null);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (show3d) return; // the 3D view handles its own keys
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        if (isTyping(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        if (isTyping(e.target)) return;
        e.preventDefault();
        redo();
      } else if (e.key === 'Escape') {
        setSelection(null);
        setPhase(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping(e.target) && selection) {
        if (selection.type === 'detector') {
          update((d) => removeDetector(d, selection.detId));
          setSelection({ type: 'leg', legId: selection.legId });
        } else if (selection.type === 'lane') {
          update((d) => removeLane(findLeg(d, selection.legId), selection.laneId));
          setSelection({ type: 'leg', legId: selection.legId });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, update, selection, show3d]);

  const newFromTemplate = (id) => {
    replace(createTemplate(id));
    setCanvasKey((k) => k + 1);
    setSelection(null);
    setPhase(null);
  };

  /* ---------------- GTSS in ---------------- */

  const openFiles = async (event) => {
    const list = [...(event.target.files || [])];
    event.target.value = '';
    if (!list.length) return;
    const designFileSource = list.find((file) => /\.json$/i.test(file.name));
    if (designFileSource) {
      try {
        const opened = parseDesignFile(await designFileSource.text());
        replace(opened);
        setCanvasKey((k) => k + 1);
        setSelection(null);
        setPhase(null);
        say(`Opened ${designFileSource.name}: ${opened.name}.`);
      } catch (err) {
        say(`Could not open ${designFileSource.name}: ${err.message}`, 'error', 8000);
      }
      return;
    }
    const files = {};
    try {
      for (const file of list) {
        if (/\.zip$/i.test(file.name)) Object.assign(files, await readZipText(await file.arrayBuffer()));
        else files[file.name.split('/').pop()] = await file.text();
      }
    } catch (err) {
      say(`Could not read the feed: ${err.message}`, 'error', 8000);
      return;
    }
    const signals = listSignals(files);
    if (!signals.length) {
      say('No signals found. A GTSS feed needs approaches.txt or signals.txt.', 'error', 8000);
      return;
    }
    const label = list.length === 1 ? list[0].name : `${list.length} files`;
    const loaded = { id: uid('feed'), files, label, signals };
    if (signals.length === 1) importSignal(loaded, signals[0].id);
    else setPicker(loaded);
  };

  const importSignal = (picked, signalId) => {
    // Switching signals within the loaded feed keeps the edits made so far:
    // they are folded into the feed before the next signal is read from it.
    let loaded = picked;
    if (attachedFeed && picked.id === attachedFeed.id) {
      loaded = { ...picked, files: gtssFromDesign(design, picked.files).files };
    }
    const imported = designFromGtss(loaded.files, signalId);
    imported.source = { ...imported.source, feedId: loaded.id };
    setPicker(null);
    setFeed(loaded);
    const kept = saveFeed(loaded);
    replace(imported);
    setCanvasKey((k) => k + 1);
    setSelection(null);
    setPhase(null);
    const size = Object.values(loaded.files).reduce((n, text) => n + text.length, 0);
    say(
      kept || size < 1000
        ? `Loaded signal ${signalId}: ${imported.name}. ${imported.notes.length ? 'See the import notes below.' : ''}`
        : `Loaded signal ${signalId}. The feed is too large to keep after a reload, so export it before closing the tab.`,
      kept ? 'info' : 'warn',
      8000,
    );
  };

  /* ---------------- GTSS out ---------------- */

  const exportGtss = (signalOnly = false) => {
    const { files, warnings } = gtssFromDesign(design, attachedFeed ? attachedFeed.files : null, { signalOnly });
    const entries = Object.entries(files).map(([name, data]) => ({ name, data }));
    const whole = attachedFeed && !signalOnly;
    const name = whole ? `${slugify(attachedFeed.label.replace(/\.zip$/i, ''))}-edited.zip` : `gtss-${slugify(design.name)}.zip`;
    downloadBlob(zipBlob(entries), name);
    say(
      `Exported ${name}${whole ? ` (${attachedFeed.signals.length} signals, signal ${design.signal.id} rewritten)` : ''}.${warnings.length ? ` ${warnings.join(' ')}` : ''}`,
      warnings.length ? 'warn' : 'info',
      warnings.length ? 12000 : 5000,
    );
  };

  /* ---------------- Share and images ---------------- */

  const copyLink = async () => {
    const hash = await encodeShare(design);
    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    window.history.replaceState(null, '', hash);
    linked.current = design;
    try {
      await navigator.clipboard.writeText(url);
      say(`Link copied. It holds the whole design${attachedFeed ? ', but not the rest of the feed' : ''}; nothing is uploaded.`);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  const exportImage = async (kind) => {
    if (!svgRef.current) return;
    const { markup, width, height } = svgMarkup(svgRef.current, 2000);
    const base = slugify(design.name);
    if (kind === 'svg') {
      downloadBlob(new Blob([markup], { type: 'image/svg+xml' }), `${base}.svg`);
    } else {
      try {
        downloadBlob(await svgToPngBlob(markup, width, height), `${base}.png`);
      } catch (err) {
        say(err.message, 'error');
      }
    }
  };

  const exportPhaseSheet = async (kind) => {
    const panel = phasesRef.current;
    if (!panel || !panel.querySelector('.phase-cell')) {
      say('There are no phase diagrams yet: assign phases first.', 'warn');
      return;
    }
    const { markup, width, height } = phaseSheetMarkup(panel, sheetTitle(design));
    const base = `${slugify(design.name)}-phases`;
    if (kind === 'svg') {
      downloadBlob(new Blob([markup], { type: 'image/svg+xml' }), `${base}.svg`);
    } else {
      try {
        downloadBlob(await svgToPngBlob(markup, width * 2, height * 2), `${base}.png`);
      } catch (err) {
        say(err.message, 'error');
      }
    }
  };

  const exportText = (text, type, name) => downloadBlob(new Blob([text], { type }), name);

  const signalCount = attachedFeed ? attachedFeed.signals.length : 0;
  const exportItems = [
    {
      id: 'gtss',
      label: attachedFeed ? `GTSS feed, all ${signalCount} signal${signalCount === 1 ? '' : 's'} (.zip)` : 'GTSS feed (.zip)',
      detail: attachedFeed
        ? `${attachedFeed.label} with signal ${design.signal.id} rewritten; everything else unchanged`
        : 'Agency, signal, approaches, phases and detectors',
      onSelect: () => exportGtss(false),
    },
    attachedFeed && {
      id: 'gtss-one',
      label: 'GTSS, this signal only (.zip)',
      detail: `Signal ${design.signal.id}, with its timings and preempts`,
      onSelect: () => exportGtss(true),
    },
    { separator: true },
    { id: 'png', label: 'Plan drawing (.png)', detail: '2000 px wide, as framed on screen', onSelect: () => exportImage('png') },
    { id: 'svg', label: 'Plan drawing (.svg)', detail: 'Vector, for reports and CAD', onSelect: () => exportImage('svg') },
    { id: 'phases-png', label: 'Phase diagrams (.png)', detail: 'Ring-and-barrier sheet', onSelect: () => exportPhaseSheet('png') },
    { id: 'phases-svg', label: 'Phase diagrams (.svg)', detail: 'The same sheet, as vector', onSelect: () => exportPhaseSheet('svg') },
    { separator: true },
    {
      id: 'detectors',
      label: 'Detector list (.csv)',
      detail: 'Channel, approach, lane, phase, setback: for the cabinet',
      onSelect: () => exportText(detectorCsv(design), 'text/csv', `${slugify(design.name)}-detectors.csv`),
    },
    {
      id: 'design',
      label: 'Design file (.json)',
      detail: 'Everything, including what GTSS can’t hold. Opens with Open…',
      onSelect: () => exportText(designFile(design), 'application/json', `${slugify(design.name)}.intersection-mix.json`),
    },
  ];

  const onBearing = useCallback((legId, bearing) => {
    update((d) => {
      const leg = findLeg(d, legId);
      if (leg) setBearing(leg, bearing);
    }, { key: `drag:${legId}` });
  }, [update]);

  const stripLeg = selection ? selection.legId : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="26" height="26" viewBox="-12 -12 24 24" aria-hidden="true">
            <rect x="-12" y="-4" width="24" height="8" fill="#4f535a" />
            <rect x="-4" y="-12" width="8" height="24" fill="#4f535a" />
            <circle r="2.2" fill="#f2c230" />
          </svg>
          <span>Intersection Mix</span>
        </div>
        <span className="design-name" title={design.name}>{design.name}</span>
        <nav className="actions">
          <select value="" onChange={(e) => e.target.value && newFromTemplate(e.target.value)} aria-label="New from template">
            <option value="">New…</option>
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button type="button" onClick={() => fileRef.current.click()}
            title="Open a GTSS feed (.zip or .txt files) or an Intersection Mix design (.json)">Open…</button>
          <ExportMenu items={exportItems} />
          <button type="button" onClick={copyLink}>Copy link</button>
          <button type="button" className="btn-3d" onClick={() => { setSelection(null); setShow3d(true); }}
            title="Open the intersection in 3D">3D view</button>
          <span className="sep" />
          <button type="button" onClick={undo} disabled={!history.canUndo} title="Undo (⌘Z)" aria-label="Undo">↶</button>
          <button type="button" onClick={redo} disabled={!history.canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">↷</button>
        </nav>
        <input ref={fileRef} type="file" accept=".zip,.txt,.json" multiple hidden onChange={openFiles} />
      </header>

      {attachedFeed && (
        <div className="feedbar">
          <span>
            <strong>GTSS feed:</strong> {attachedFeed.label} · {attachedFeed.signals.length} signal{attachedFeed.signals.length === 1 ? '' : 's'} ·
            editing signal <strong>{design.source.signalId}</strong>
          </span>
          {attachedFeed.signals.length > 1 && (
            <button type="button" className="small" onClick={() => setPicker(attachedFeed)}>Switch signal</button>
          )}
        </div>
      )}

      <main className="workspace">
        <section className="canvas-wrap panel">
          <IntersectionCanvas key={canvasKey} design={design} geom={geom} selection={selection} phase={phase}
            onSelect={select} onBearing={onBearing} onDragEnd={commit} svgRef={svgRef} />
          <div className="legend" aria-label="Legend">
            {Object.entries(DETECTOR_COLORS).map(([purpose, color]) => (
              <span key={purpose}><i style={{ background: color }} />{purpose}</span>
            ))}
            <span><i style={{ background: COLORS.bike }} />bike lane</span>
            <span className="muted">Drag ⟳ handles to rotate · click to select</span>
          </div>
          {phase && (
            <button type="button" className="phase-flag" onClick={() => setPhase(null)}>Showing phase {phase} ×</button>
          )}
        </section>
        <Inspector design={design} selection={selection} update={update} onSelect={select} />
      </main>

      <LegStrip design={design} legId={stripLeg || (design.legs[0] && design.legs[0].id)} selection={selection} onSelect={select} update={update} />

      <div ref={phasesRef}>
        <PhaseDiagrams design={design} geom={geom} phase={phase} onPick={(p) => { setPhase(p); if (p) setSelection(null); }} />
      </div>

      <section className="panel checks">
        <div className="section-head">
          <h2>Checks</h2>
          <span className="muted small">{checks.length ? `${checks.length} to look at` : 'Nothing to flag.'}</span>
        </div>
        {checks.length > 0 && (
          <ul>
            {checks.map((c, i) => (
              <li key={i}>
                {c.legId ? <button type="button" className="link" onClick={() => select({ type: 'leg', legId: c.legId })}>{c.text}</button> : c.text}
              </li>
            ))}
          </ul>
        )}
        {design.notes.length > 0 && (
          <>
            <div className="section-head">
              <h3>From the GTSS import</h3>
              <button type="button" className="small" onClick={() => update((d) => { d.notes = []; })}>Dismiss</button>
            </div>
            <ul className="notes">{design.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </>
        )}
      </section>

      <details className="panel about">
        <summary>About Intersection Mix</summary>
        <p>
          Build a signalized intersection one approach at a time, the way Streetmix builds a street: lanes, receiving
          lanes, medians, bike lanes and sidewalks, then a phase for every movement and detectors on the lanes. It reads
          and writes <a href="https://gtss.dev" target="_blank" rel="noreferrer">GTSS</a>, the General Traffic Signal
          Specification, so a feed from your agency can be drawn, checked, corrected and exported again.
        </p>
        <h3>Conventions</h3>
        <ul>
          <li><strong>Bearing</strong> is the heading of arriving traffic (GTSS <code>compass_bearing</code>): 90 is an eastbound approach, which extends west of the intersection.</li>
          <li><strong>Lanes</strong> are counted from the inside (lane 1 is nearest the centre line), as GTSS <code>detectors.txt</code> counts them. Right-hand traffic.</li>
          <li><strong>Phases</strong> belong to movements, not lanes. A protected-permissive or FYA left is protected in its own phase and permissive in its approach&apos;s through phase.</li>
          <li><strong>Crosswalks</strong> follow <code>pedX</code>: a crosswalk crosses the approach its phase is on (pedX 1), or the one opposite (pedX 3).</li>
          <li><strong>What GTSS doesn&apos;t say</strong>: lane order, lane widths and receiving lanes. Imports draw sensible defaults and list them under Checks; nothing unstated is exported as fact.</li>
        </ul>
        <h3>Export</h3>
        <p>
          With a feed loaded, Export › GTSS feed writes the whole feed back with only this signal&apos;s rows replaced. Other
          signals, <code>basic_timings.txt</code>, <code>preempt.txt</code> and columns this tool doesn&apos;t use pass
          through unchanged. Everything runs in your browser; share links carry the design in the URL fragment, which is
          never sent to a server.
        </p>
        <h3>3D view</h3>
        <p>
          The 3D view button opens the design in 3D. The road surface is the plan itself, and the sidewalks and islands are
          raised to curb height. Mast-arm signals hang over every approach lane, and their lamps show whichever phase you
          choose. Orbit, pan and zoom, switch to isometric, save a PNG, or export a glTF model (.glb, in metres) to carry
          on modelling in Blender, SketchUp or similar tools.
        </p>
        <h3>Keys</h3>
        <p>⌘/Ctrl-Z undo · ⇧⌘Z or Ctrl-Y redo · Delete removes the selected lane or detector · Esc clears the selection · Shift while dragging a handle rotates by 1°.</p>
      </details>

      {show3d && (
        <Suspense fallback={<div className="view3d"><div className="view3d-status">Loading 3D engine…</div></div>}>
          <View3D design={design} geom={geom} planSvg={svgRef.current} initialPhase={phase}
            onClose={() => setShow3d(false)} say={say} />
        </Suspense>
      )}
      {picker && <SignalPicker feed={picker} onPick={(id) => importSignal(picker, id)} onClose={() => setPicker(null)} />}
      {toast && (
        <div className={`toast ${toast.tone}`} role="status" key={toast.id}>
          <span>{toast.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </div>
  );
}
