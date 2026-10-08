import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import CorridorMap from './CorridorMap.jsx';
import CorridorTimeSpace from './CorridorTimeSpace.jsx';
import PlaybackBar from './PlaybackBar.jsx';
import PlaybackScrubber from './PlaybackScrubber.jsx';
import { useCorridorClock } from './useCorridorClock.js';
import {
  feedSignals, alongStreet, makeCorridor, corridorLayout, corridorPhases, orderSignals,
} from '../lib/corridor.js';
import {
  controllerKey, hoursAvailable, bestHour, filesInRange, readLogs, timelinesByController, sharedWindow,
} from '../lib/corridorData.js';
import { corridorVehicles } from '../lib/corridorVehicles.js';
import { createPlaybackStore } from '../lib/playbackClock.js';
import { formatTime } from '../lib/hires.js';
import { readZipText } from '../lib/zipReader.js';
import { loadCorridor, saveCorridor } from '../lib/store.js';

// three.js loads only when the 3D tab is opened.
const CorridorScene3D = lazy(() => import('../three/CorridorScene3D.jsx'));

const TABS = { map: 'Map', timespace: 'Time-space', '3d': '3D' };

// The loaded data outlives the view, so closing it to look at one signal
// doesn't mean reading the files again. It goes when the page does.
let keptData = {};
const HOUR = 3600000;

/** A timeline-shaped summary for the scanner bar: each signal's forward through phase, and every priority request. */
function compositeTimeline(layout, phases, timelines) {
  const live = timelines.filter(Boolean);
  if (!live.length) return null;
  const out = {
    start: Math.min(...live.map((tl) => tl.start)),
    end: Math.max(...live.map((tl) => tl.end)),
    gaps: [], phases: {}, peds: {}, preempts: {}, tsp: {},
  };
  layout.signals.forEach((sig, i) => {
    const tl = timelines[i];
    if (!tl) return;
    const phase = phases[i].forward.phase;
    if (phase && tl.phases[phase]) out.phases[String(i + 1)] = tl.phases[phase];
    Object.entries(tl.preempts).forEach(([n, ch]) => { out.preempts[`${i + 1}.${n}`] = ch; });
    Object.entries(tl.tsp).forEach(([n, ch]) => { out.tsp[`${i + 1}.${n}`] = ch; });
  });
  return out;
}

const hourLabel = (ms) => formatTime(ms).replace(/:\d\d\.\d$/, '');

/**
 * The corridor view: several signals from a GTSS feed, placed by their
 * locations and joined by the road between them, with their
 * high-resolution data replayed on one clock. Map, time-space diagram and
 * 3D. An advanced setting; full screen, like the 3D view.
 */
export default function CorridorView({ feed, editorDesign, equipment, onOpenSignal, onClose, say }) {
  const [corridor, setCorridor] = useState(() => loadCorridor());
  const [panel, setPanel] = useState(() => !loadCorridor());
  const [tab, setTab] = useState('map');
  const [data, setDataState] = useState(() => keptData); // controller key -> { timeline, events, files, start, end }
  const setData = (next) => setDataState((d) => {
    keptData = typeof next === 'function' ? next(d) : next;
    return keptData;
  });
  const [folder, setFolder] = useState(null); // a folder being narrowed: { files, hours, from, to, unnamed }
  const [loading, setLoading] = useState(false);
  const mapRef = useRef(null);
  const filesRef = useRef(null);
  const folderRef = useRef(null);

  useEffect(() => {
    if (corridor && !saveCorridor(corridor)) say('The corridor is too large to keep after a reload.', 'warn');
    if (!corridor) saveCorridor(null);
  }, [corridor]); // eslint-disable-line react-hooks/exhaustive-deps

  // The signal open in the editor is drawn as it is being edited.
  const layout = useMemo(() => {
    if (!corridor || !corridor.signals.length) return null;
    const live = editorDesign && editorDesign.source && editorDesign.source.feedId === corridor.feedId ? editorDesign : null;
    return corridorLayout(corridor, {
      designFor: (s) => (live && controllerKey(live.signal.id) === controllerKey(s.signalId) ? live : null),
    });
  }, [corridor, editorDesign]);
  const phases = useMemo(() => (layout ? corridorPhases(layout) : []), [layout]);
  const timelines = useMemo(
    () => (layout ? layout.signals.map((s) => (data[controllerKey(s.signalId)] || {}).timeline || null) : []),
    [layout, data],
  );
  const signalKey = layout ? layout.signals.map((s) => s.signalId).join(',') : '';
  const stores = useMemo(() => (layout ? layout.signals.map(() => createPlaybackStore()) : []), [signalKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const master = useMemo(() => createPlaybackStore(), []);
  const composite = useMemo(() => (layout ? compositeTimeline(layout, phases, timelines) : null), [layout, phases, timelines]);
  const model = useMemo(() => {
    if (!layout || !timelines.some(Boolean)) return null;
    return corridorVehicles(layout, Object.fromEntries(timelines.map((tl, i) => [i, tl]).filter(([, tl]) => tl)));
  }, [layout, timelines]);
  useCorridorClock({ master, stores, timelines, composite });
  if (import.meta.env.DEV) window.__imCorridor = { layout, model, master, stores, data }; // for the console while developing

  const controllers = corridor ? corridor.signals.map((s) => controllerKey(s.signalId)) : [];

  /* ---------------- Loading data ---------------- */

  const takeLogs = async (files) => {
    setLoading(true);
    try {
      const parsed = await readLogs(files, readZipText);
      const { byController, unknown } = timelinesByController(parsed);
      const mine = [...byController.entries()].filter(([key]) => controllers.includes(key));
      const others = [...byController.keys()].filter((key) => !controllers.includes(key));
      if (!mine.length) {
        say(`None of these files are from the corridor's controllers (${controllers.join(', ')}).`, 'warn', 9000);
        return;
      }
      setData((d) => ({ ...d, ...Object.fromEntries(mine) }));
      const overlap = sharedWindow(mine.map(([, v]) => v));
      const events = mine.reduce((n, [, v]) => n + v.events, 0);
      const parts = [`Loaded ${events.toLocaleString()} events for signal${mine.length === 1 ? '' : 's'} ${mine.map(([k]) => k).join(', ')}.`];
      if (others.length) parts.push(`Not in the corridor: ${others.join(', ')}.`);
      if (unknown) parts.push(`${unknown} file${unknown === 1 ? '' : 's'} had no controller number.`);
      if (mine.length > 1 && !overlap) parts.push('Their times do not overlap, so they cannot be compared.');
      say(parts.join(' '), mine.length > 1 && !overlap ? 'warn' : 'info', 9000);
    } catch (err) {
      say(`Could not read that data: ${err.message}`, 'warn', 9000);
    } finally {
      setLoading(false);
    }
  };

  const pickFolder = (list) => {
    const files = [...list];
    const { hours, unnamed } = hoursAvailable(files, controllers);
    if (!hours.length) {
      say(`No logger files for the corridor's controllers (${controllers.join(', ')}) in that folder.`, 'warn', 9000);
      return;
    }
    const best = bestHour(hours, controllers);
    setFolder({ files, hours, from: best, to: best, unnamed });
  };

  /* ---------------- Building the corridor ---------------- */

  const fromFeed = (ids) => {
    if (!feed) return;
    const next = makeCorridor(feed.files, ids, { feedId: feed.id });
    setCorridor(next);
    say(`${next.name}: ${next.signals.length} signals, in order along the road.`);
  };
  const move = (i, by) => setCorridor((c) => {
    const signals = [...c.signals];
    const [one] = signals.splice(i, 1);
    signals.splice(Math.max(0, Math.min(signals.length, i + by)), 0, one);
    return { ...c, signals };
  });
  const remove = (i) => setCorridor((c) => ({ ...c, signals: c.signals.filter((_, j) => j !== i) }));

  const hasData = timelines.some(Boolean);

  return (
    <div className="view3d corridor-view" role="dialog" aria-modal="true" aria-label="Corridor view">
      <div className="view3d-bar">
        <strong className="view3d-title">{corridor ? corridor.name : 'Corridor'}</strong>
        <div className="segmented" role="tablist" aria-label="View">
          {Object.entries(TABS).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''}
              disabled={!layout} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        <button type="button" className={panel ? 'on' : ''} onClick={() => setPanel((v) => !v)} aria-pressed={panel}>
          Signals{corridor ? ` (${corridor.signals.length})` : ''}
        </button>
        <button type="button" disabled={!corridor || loading} onClick={() => folderRef.current.click()}
          title="Pick a folder of logger files (such as CsvData); only the corridor's controllers, for the hours you choose, are read">
          {loading ? 'Reading…' : 'Load data folder…'}
        </button>
        <button type="button" disabled={!corridor || loading} onClick={() => filesRef.current.click()}>Load files…</button>
        {hasData && <PlaybackBar store={master} className="dark" />}
        <span className="view3d-spacer" />
        <button type="button" className="view3d-close" aria-label="Close corridor view" onClick={onClose}>×</button>
        <input ref={filesRef} type="file" accept=".csv,.txt,.zip" multiple hidden
          onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) takeLogs(f); }} />
        <input ref={folderRef} type="file" webkitdirectory="" directory="" multiple hidden
          onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) pickFolder(f); }} />
      </div>
      {hasData && <PlaybackScrubber store={master} />}

      <div className="corridor-body">
        {!layout && (
          <div className="corridor-empty">
            <p><strong>No corridor yet.</strong></p>
            <p className="muted">
              {feed
                ? 'Choose its signals in the Signals panel: pick a road to collect every signal along it, or tick signals one by one.'
                : 'Open a GTSS feed first (Open… in the toolbar). The corridor is made from its signals, placed by their latitude and longitude.'}
            </p>
          </div>
        )}
        {layout && (
          <>
            {/* The map stays mounted: the 3D corridor's ground is drawn from it. */}
            <div className={`corridor-tab${tab === 'map' ? '' : ' hidden'}`}>
              <CorridorMap layout={layout} stores={stores} master={master} model={model} equipment={equipment} svgRef={mapRef}
                onOpen={(sig) => onOpenSignal(sig.signalId)} />
              {!hasData && (
                <div className="corridor-hint">Load the signals&apos; high-resolution data to replay them together.</div>
              )}
            </div>
            {tab === 'timespace' && (
              <div className="corridor-tab">
                <CorridorTimeSpace layout={layout} phases={phases} timelines={timelines} model={model} master={master} />
                {!hasData && <div className="corridor-hint">Load data to see the signals and vehicles in time.</div>}
              </div>
            )}
            {tab === '3d' && (
              <div className="corridor-tab">
                <Suspense fallback={<div className="view3d-status">Loading 3D engine…</div>}>
                  <CorridorScene3D layout={layout} mapSvgRef={mapRef} stores={stores} master={master} model={model} equipment={equipment} />
                </Suspense>
              </div>
            )}
          </>
        )}

        {panel && (
          <CorridorSignals feed={feed} corridor={corridor} layout={layout} data={data} editorDesign={editorDesign}
            onFromFeed={fromFeed} onMove={move} onRemove={remove} onOpen={onOpenSignal}
            onRename={(name) => setCorridor((c) => ({ ...c, name }))}
            onFlip={() => setCorridor((c) => ({ ...c, signals: [...c.signals].reverse() }))}
            onReorder={() => setCorridor((c) => ({ ...c, signals: orderSignals(c.signals) }))}
            onClear={() => { setCorridor(null); setData({}); }}
            onClose={() => setPanel(false)} />
        )}
      </div>

      {folder && (
        <div className="modal-backdrop" role="presentation" onClick={() => setFolder(null)}>
          <div className="modal panel corridor-folder" role="dialog" aria-label="Choose the hours to load" onClick={(e) => e.stopPropagation()}>
            <h2>Which hours?</h2>
            <p className="muted small">
              The folder has {folder.hours.length} hour{folder.hours.length === 1 ? '' : 's'} of data for this corridor&apos;s controllers
              ({controllers.join(', ')}). Only the files for these controllers in the hours you choose are read.
            </p>
            <div className="grid2">
              <label className="field">
                <span className="field-label">From</span>
                <select value={folder.from} onChange={(e) => setFolder((f) => ({ ...f, from: Number(e.target.value), to: Math.max(f.to, Number(e.target.value)) }))}>
                  {folder.hours.map((h) => <option key={h.start} value={h.start}>{hourLabel(h.start)} ({h.controllers.size}/{controllers.length})</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">To (the hour starting)</span>
                <select value={folder.to} onChange={(e) => setFolder((f) => ({ ...f, to: Number(e.target.value), from: Math.min(f.from, Number(e.target.value)) }))}>
                  {folder.hours.map((h) => <option key={h.start} value={h.start}>{hourLabel(h.start)} ({h.controllers.size}/{controllers.length})</option>)}
                </select>
              </label>
            </div>
            {(() => {
              const picked = filesInRange(folder.files, controllers, folder.from, folder.to);
              const hours = Math.round((folder.to - folder.from) / HOUR) + 1;
              return (
                <div className="button-row">
                  <button type="button" className="primary" disabled={!picked.length}
                    onClick={() => { setFolder(null); takeLogs(picked); }}>
                    Read {picked.length} file{picked.length === 1 ? '' : 's'} ({hours} hour{hours === 1 ? '' : 's'})
                  </button>
                  <button type="button" onClick={() => setFolder(null)}>Cancel</button>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

/** Choosing and arranging the corridor's signals. */
function CorridorSignals({
  feed, corridor, layout, data, editorDesign, onFromFeed, onMove, onRemove, onOpen, onRename, onFlip, onReorder, onClear, onClose,
}) {
  const all = useMemo(() => (feed ? feedSignals(feed.files) : []), [feed]);
  const streets = useMemo(() => {
    const counts = new Map();
    for (const s of all) for (const street of s.streets) counts.set(street, (counts.get(street) || 0) + 1);
    return [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [all]);
  // Start with the editor's own road: of its streets, the one most signals share.
  const editorStreet = editorDesign
    && streets.find(([name]) => editorDesign.legs.some((l) => l.street === name));
  const firstStreet = editorStreet ? editorStreet[0] : (streets[0] ? streets[0][0] : '');
  const [street, setStreet] = useState(firstStreet);
  const [ticked, setTicked] = useState(() => new Set(corridor ? corridor.signals.map((s) => s.signalId) : []));
  const [query, setQuery] = useState('');
  const onStreet = feed && street ? alongStreet(feed.files, street) : [];
  const shown = all.filter((s) => !query || `${s.id} ${s.name}`.toLowerCase().includes(query.toLowerCase())).slice(0, 200);
  const sameFeed = !corridor || !feed || corridor.feedId === feed.id;

  return (
    <aside className="corridor-panel panel" aria-label="Corridor signals">
      <div className="section-head">
        <h2>Signals</h2>
        <button type="button" className="close" aria-label="Close" onClick={onClose}>×</button>
      </div>

      {corridor && (
        <>
          <label className="field">
            <span className="field-label">Name</span>
            <input type="text" value={corridor.name} onChange={(e) => onRename(e.target.value)} />
          </label>
          <ol className="corridor-list">
            {corridor.signals.map((s, i) => {
              const placed = layout && layout.signals.find((p) => p.signalId === s.signalId);
              const d = data[controllerKey(s.signalId)];
              const link = layout && placed && placed.index < layout.links.length ? layout.links[placed.index] : null;
              return (
                <li key={s.signalId}>
                  <div className="corridor-signal">
                    <span className="corridor-num">{i + 1}</span>
                    <span className="corridor-name">
                      <strong>{s.design.name}</strong>
                      <span className="muted small">
                        Signal {s.signalId}
                        {!placed && ' · no location, not placed'}
                        {d ? ` · ${d.events.toLocaleString()} events, ${formatTime(d.start).split(' ')[1].slice(0, 5)}–${formatTime(d.end).split(' ')[1].slice(0, 5)}` : ' · no data'}
                      </span>
                    </span>
                    <span className="corridor-actions">
                      <button type="button" className="small" disabled={i === 0} onClick={() => onMove(i, -1)} aria-label="Move up">↑</button>
                      <button type="button" className="small" disabled={i === corridor.signals.length - 1} onClick={() => onMove(i, 1)} aria-label="Move down">↓</button>
                      <button type="button" className="small" onClick={() => onOpen(s.signalId)} title="Open this signal in the editor">Open</button>
                      <button type="button" className="small danger" onClick={() => onRemove(i)} aria-label="Remove">×</button>
                    </span>
                  </div>
                  {link && (
                    <div className={`corridor-link${link.aligned ? '' : ' bad'}`}>
                      {link.aligned
                        ? `↓ ${Math.round(link.travel)} ft along the road`
                        : `↓ ${Math.round(link.dist)} ft apart, but no approaches face each other (${Math.round(link.angles[0])}°, ${Math.round(link.angles[1])}° off)`}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="button-row">
            <button type="button" className="small" onClick={onReorder} title="Put the signals in order along the road again">Order by location</button>
            <button type="button" className="small" onClick={onFlip} title="Swap which way counts as forward">Flip direction</button>
            <button type="button" className="small danger" onClick={onClear}>Clear corridor</button>
          </div>
        </>
      )}

      <h3>{corridor ? 'Change the signals' : 'Choose signals'}</h3>
      {!feed && <p className="muted small">Open a GTSS feed first (Open… in the toolbar). Its signals, with their locations, are listed here.</p>}
      {feed && !sameFeed && <p className="muted small">This corridor was made from another feed; choosing again replaces it.</p>}
      {feed && (
        <>
          <label className="field">
            <span className="field-label">Every signal along a road</span>
            <select value={street} onChange={(e) => setStreet(e.target.value)}>
              {streets.map(([name, n]) => <option key={name} value={name}>{`${name} (${n})`}</option>)}
            </select>
          </label>
          <button type="button" className="primary" disabled={onStreet.length < 2} onClick={() => onFromFeed(onStreet)}>
            Use the {onStreet.length} signals on {street || 'this road'}
          </button>

          <label className="field">
            <span className="field-label">Or tick signals</span>
            <input type="search" placeholder="Search by number or street" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="corridor-pick">
            {shown.map((s) => (
              <label key={s.id} className={`check${s.lat == null ? ' muted' : ''}`} title={s.lat == null ? 'No location in signals.txt' : ''}>
                <input type="checkbox" checked={ticked.has(s.id)} disabled={s.lat == null}
                  onChange={(e) => setTicked((t) => {
                    const next = new Set(t);
                    if (e.target.checked) next.add(s.id);
                    else next.delete(s.id);
                    return next;
                  })} />
                <span>{s.id}. {s.name}</span>
              </label>
            ))}
          </div>
          <button type="button" disabled={ticked.size < 2} onClick={() => onFromFeed([...ticked])}>
            Make a corridor of {ticked.size} signal{ticked.size === 1 ? '' : 's'}
          </button>
        </>
      )}
    </aside>
  );
}
