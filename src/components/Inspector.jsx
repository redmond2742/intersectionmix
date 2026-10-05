import LaneGlyph from './LaneGlyph.jsx';
import { phaseColor, detectorColor } from '../palette.js';
import {
  findLeg, findLane, findDetector, laneIndex, legLabel, legTurns, removeLeg, removeLane, removeDetector,
  moveLane, setBearing, addDetector, addStopBarDetectors, addAdvanceDetectors, autoAssignNema,
  autoNumberChannels, crosswalkLengthFt, crossSectionSig, lanePhase, canonicalTurns, makeOutbound,
  TURNS, TURN_LABELS, LEFT_TREATMENTS, LEFT_TREATMENT_LABELS, PURPOSES, MODES, TECHNOLOGIES, VEHICLE_TYPES,
  MEDIAN_TYPES, FREE_RIGHT_PED, FREE_RIGHT_RECEIVING, FREE_RIGHT_SIZES, usedPhases, uid,
} from '../lib/model.js';
import { bearingToTravel, bearingToOrigin } from '../lib/gtss.js';

import { Field, Text, Num, Choice } from './fields.jsx';
import EquipmentPanel from './EquipmentPanel.jsx';

const PHASE_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8'];

function PhaseInput({ value, onChange, placeholder = '—' }) {
  return (
    <span className="phase-input">
      <span className="swatch" style={{ background: value ? phaseColor(value) : 'transparent' }} />
      <input type="text" list="phase-options" value={value ?? ''} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.trim())} aria-label="Phase" />
    </span>
  );
}

function DetectorList({ leg, dets, onSelect }) {
  if (!dets.length) return <p className="muted small">No detectors yet.</p>;
  return (
    <ul className="det-list">
      {dets.map((det) => {
        const index = det.laneId ? laneIndex(leg, det.laneId) : -1;
        return (
          <li key={det.id}>
            <button type="button" onClick={() => onSelect({ type: 'detector', legId: leg.id, detId: det.id })}>
              <span className="det-dot" style={{ background: detectorColor(det.purpose) }} />
              <strong>Ch {det.channel || '?'}</strong>
              <span>{det.purpose}</span>
              <span className="muted">{index >= 0 ? `lane ${index + 1}` : 'all lanes'} · {det.setback} ft</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function IntersectionPanel({ design, geom, equipment, update, onSelect }) {
  const set = (key, recipe) => update(recipe, { key: `design:${key}` });
  const detCount = design.legs.reduce((n, leg) => n + leg.detectors.length, 0);
  return (
    <div className="inspector-body">
      <h2>Intersection</h2>
      <Field label="Name"><Text value={design.name} onChange={(v) => set('name', (d) => { d.name = v; })} /></Field>
      <div className="grid2">
        <Field label="Signal ID"><Text value={design.signal.id} onChange={(v) => set('sid', (d) => { d.signal.id = v; })} /></Field>
        <Field label="Agency ID"><Text value={design.signal.agencyId} onChange={(v) => set('aid', (d) => { d.signal.agencyId = v; })} /></Field>
        <Field label="Latitude"><Text value={design.signal.lat} onChange={(v) => set('lat', (d) => { d.signal.lat = v; })} inputMode="decimal" /></Field>
        <Field label="Longitude"><Text value={design.signal.lon} onChange={(v) => set('lon', (d) => { d.signal.lon = v; })} inputMode="decimal" /></Field>
      </div>
      <p className="muted small">
        {design.legs.length} approaches · phases {usedPhases(design).join(', ') || 'none'} · {detCount} detectors
      </p>
      <div className="button-col">
        <button type="button" onClick={() => update((d) => autoAssignNema(d))}>Auto-assign NEMA phases</button>
        <button type="button" onClick={() => update((d) => autoNumberChannels(d))}>Renumber detector channels</button>
        <label className="check">
          <input type="checkbox" checked={design.scramble} onChange={(e) => update((d) => { d.scramble = e.target.checked; })} />
          Diagonal (scramble) crossings
        </label>
      </div>
      <h3>Approaches</h3>
      <ul className="leg-list">
        {design.legs.map((leg) => (
          <li key={leg.id}>
            <button type="button" onClick={() => onSelect({ type: 'leg', legId: leg.id })}>
              <span>{legLabel(leg)}</span>
              <span className="muted">{leg.inbound.length} in · {leg.outbound.length} out</span>
            </button>
          </li>
        ))}
      </ul>
      {equipment && geom && <EquipmentPanel design={design} geom={geom} update={update} />}
    </div>
  );
}

function LegPanel({ design, leg, update, onSelect }) {
  const edit = (key, recipe) => update((d) => {
    const draft = findLeg(d, leg.id);
    if (draft) recipe(draft, d);
  }, key ? { key: `${leg.id}:${key}` } : undefined);
  const turns = legTurns(leg);
  const autoLength = crosswalkLengthFt(leg);
  const cw = leg.crosswalk;
  const lengthStale = cw.length && cw.lengthSig != null && cw.lengthSig !== crossSectionSig(leg);

  return (
    <div className="inspector-body">
      <div className="inspector-head">
        <h2>{legLabel(leg)}</h2>
        <button type="button" className="danger small" onClick={() => {
          if (window.confirm(`Remove ${legLabel(leg)}?`)) {
            update((d) => removeLeg(d, leg.id));
            onSelect(null);
          }
        }}>Remove</button>
      </div>
      <div className="grid2">
        <Field label="Street"><Text value={leg.street} onChange={(v) => edit('street', (l) => { l.street = v; })} /></Field>
        <Field label="Approach ID"><Text value={leg.approachId} onChange={(v) => edit('aid', (l) => { l.approachId = v; })} /></Field>
        <Field label="Bearing" hint={`${bearingToTravel(leg.bearing) || ''}, arriving from the ${bearingToOrigin(leg.bearing) || '?'}`}>
          <Num value={leg.bearing} min={0} max={359} onChange={(v) => edit('bearing', (l) => setBearing(l, v))} />
        </Field>
        <Field label="Posted speed (mph)"><Num value={leg.speed} min={5} max={85} step={5} onChange={(v) => edit('speed', (l) => { l.speed = v; })} /></Field>
      </div>
      <input type="range" min="0" max="359" value={leg.bearing} aria-label="Bearing"
        onChange={(e) => edit('bearing', (l) => setBearing(l, Number(e.target.value)))} />

      <h3>Movements</h3>
      {!turns.length && <p className="muted small">No approach lanes: add some in the cross-section below.</p>}
      <table className="moves">
        <tbody>
          {TURNS.filter((t) => turns.includes(t)).map((t) => (
            <tr key={t}>
              <th scope="row">{TURN_LABELS[t]}</th>
              <td><PhaseInput value={leg.movements[t].phase} onChange={(v) => edit(`mv${t}`, (l) => { l.movements[t].phase = v; })} /></td>
              <td>
                {t === 'L' && (
                  <Choice value={leg.movements.L.treatment} options={LEFT_TREATMENT_LABELS}
                    onChange={(v) => edit(null, (l) => { l.movements.L.treatment = v; })} />
                )}
                {t === 'L' && <span className="field-hint">GTSS {LEFT_TREATMENTS[leg.movements.L.treatment]}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Crosswalk</h3>
      <label className="check">
        <input type="checkbox" checked={cw.enabled} onChange={(e) => edit(null, (l) => { l.crosswalk.enabled = e.target.checked; })} />
        Crosswalk across this approach
      </label>
      {cw.enabled && (
        <div className="grid2">
          <Field label="Ped phase"><PhaseInput value={cw.pedPhase} onChange={(v) => edit('ped', (l) => { l.crosswalk.pedPhase = v; })} /></Field>
          <Field label="Length (ft)" hint={lengthStale ? `Imported; the lanes changed, so LE-${autoLength} is exported` : cw.length ? 'Exported as entered' : `Blank exports LE-${autoLength}`}>
            <Text value={cw.length} placeholder={`LE-${autoLength}`}
              onChange={(v) => edit('cwlen', (l) => { l.crosswalk.length = v; l.crosswalk.lengthSig = null; })} />
          </Field>
        </div>
      )}

      <h3>Cross-section</h3>
      <div className="grid2">
        <Field label="Median"><Choice value={leg.median.type} options={MEDIAN_TYPES}
          onChange={(v) => edit(null, (l) => { l.median.type = v; if (v !== 'none' && !l.median.width) l.median.width = v === 'raised' ? 8 : 4; })} /></Field>
        {leg.median.type !== 'none' && (
          <Field label="Median width (ft)"><Num value={leg.median.width} min={1} max={60} onChange={(v) => edit('mw', (l) => { l.median.width = v; })} /></Field>
        )}
        <Field label="Receiving lanes">
          <Num value={leg.outbound.length} min={0} max={8} onChange={(v) => edit('outn', (l) => {
            while (l.outbound.length < v) l.outbound.push(makeOutbound());
            if (l.outbound.length > v) l.outbound.splice(Math.max(0, v));
          })} />
        </Field>
        <Field label="Sidewalk (ft)"><Num value={leg.sidewalk} min={0} max={30} onChange={(v) => edit('sw', (l) => { l.sidewalk = v; })} /></Field>
        <Field label="Bike lane in (ft)"><Num value={leg.bikeIn} min={0} max={12} onChange={(v) => edit('bi', (l) => { l.bikeIn = v; })} /></Field>
        <Field label="Bike lane out (ft)"><Num value={leg.bikeOut} min={0} max={12} onChange={(v) => edit('bo', (l) => { l.bikeOut = v; })} /></Field>
        <Field label="Free-right lanes"><Num value={leg.freeRight.lanes} min={0} max={2} onChange={(v) => edit('fr', (l) => { l.freeRight.lanes = v; })} /></Field>
        {leg.freeRight.lanes > 0 && (
          <Field label="Free-right crossing"><Choice value={leg.freeRight.ped} options={FREE_RIGHT_PED} onChange={(v) => edit(null, (l) => { l.freeRight.ped = v; })} /></Field>
        )}
        {leg.freeRight.lanes > 0 && (
          <Field label="Free-right size">
            <Choice value={leg.freeRight.size} options={FREE_RIGHT_SIZES} onChange={(v) => edit(null, (l) => { l.freeRight.size = v; })} />
          </Field>
        )}
        {leg.freeRight.lanes > 0 && (
          <Field label="Free-right receiving" hint="Size and receiving aren't part of GTSS; they're kept in the design and share links.">
            <Choice value={leg.freeRight.receiving} options={FREE_RIGHT_RECEIVING} onChange={(v) => edit(null, (l) => { l.freeRight.receiving = v; })} />
          </Field>
        )}
      </div>

      <h3>Detectors</h3>
      <DetectorList leg={leg} dets={leg.detectors} onSelect={onSelect} />
      <div className="button-row">
        <button type="button" onClick={() => edit(null, (l, d) => addStopBarDetectors(d, l))}>Stop bar on each lane</button>
        <button type="button" onClick={() => edit(null, (l, d) => addAdvanceDetectors(d, l))}>Advance on through lanes</button>
      </div>
    </div>
  );
}

function LanePanel({ design, leg, lane, update, onSelect }) {
  const index = laneIndex(leg, lane.id);
  const edit = (key, recipe) => update((d) => {
    const l = findLeg(d, leg.id);
    const ln = l && findLane(l, lane.id);
    if (ln) recipe(ln, l, d);
  }, key ? { key: `${lane.id}:${key}` } : undefined);
  const toggle = (t) => edit(null, (ln) => {
    const next = ln.turns.includes(t) ? ln.turns.filter((x) => x !== t) : [...ln.turns, t];
    ln.turns = canonicalTurns(next);
  });
  const dets = leg.detectors.filter((d) => d.laneId === lane.id);
  const addDet = (purpose) => {
    const id = uid('det');
    update((d) => {
      const l = findLeg(d, leg.id);
      addDetector(d, l, { id, laneId: lane.id, purpose });
    });
    onSelect({ type: 'detector', legId: leg.id, detId: id });
  };

  return (
    <div className="inspector-body">
      <button type="button" className="link" onClick={() => onSelect({ type: 'leg', legId: leg.id })}>← {legLabel(leg)}</button>
      <div className="inspector-head">
        <h2>Lane {index + 1} <span className="muted small">of {leg.inbound.length}, counted from the inside</span></h2>
      </div>
      <div className="turn-toggles">
        {TURNS.map((t) => (
          <button key={t} type="button" className={lane.turns.includes(t) ? 'turn on' : 'turn'} onClick={() => toggle(t)} aria-pressed={lane.turns.includes(t)}>
            <svg width="30" height="30" viewBox="-9 -9 18 18" aria-hidden="true"><LaneGlyph turns={[t]} color="currentColor" width={1.4} /></svg>
            <span>{TURN_LABELS[t]}</span>
          </button>
        ))}
      </div>
      <div className="grid2">
        <Field label="Width (ft)"><Num value={lane.width} min={8} max={18} step={0.5} onChange={(v) => edit('w', (ln) => { ln.width = v; })} /></Field>
        <Field label="Position">
          <span className="button-row tight">
            <button type="button" disabled={index <= 0} onClick={() => update((d) => moveLane(findLeg(d, leg.id), index, index - 1))}>Inward</button>
            <button type="button" disabled={index >= leg.inbound.length - 1} onClick={() => update((d) => moveLane(findLeg(d, leg.id), index, index + 1))}>Outward</button>
          </span>
        </Field>
      </div>
      <p className="small">
        {lane.turns.map((t) => (
          <span key={t} className="chip" style={{ background: phaseColor(leg.movements[t].phase) }}>
            {TURN_LABELS[t]} → phase {leg.movements[t].phase || 'none'}
          </span>
        ))}
      </p>
      <p className="muted small">Phases belong to the movement, and are set on the approach.</p>
      <h3>Detectors on this lane</h3>
      <DetectorList leg={leg} dets={dets} onSelect={onSelect} />
      <div className="button-row">
        <button type="button" onClick={() => addDet('stop bar')}>+ Stop bar</button>
        <button type="button" onClick={() => addDet('advanced')}>+ Advance</button>
        <button type="button" onClick={() => addDet('count')}>+ Count</button>
      </div>
      <button type="button" className="danger" onClick={() => { update((d) => removeLane(findLeg(d, leg.id), lane.id)); onSelect({ type: 'leg', legId: leg.id }); }}>
        Remove lane
      </button>
    </div>
  );
}

function DetectorPanel({ leg, det, update, onSelect }) {
  const edit = (key, recipe) => update((d) => {
    const found = findDetector(d, det.id);
    if (found) recipe(found.det, found.leg, d);
  }, key ? { key: `${det.id}:${key}` } : undefined);
  const auto = lanePhase(leg, findLane(leg, det.laneId));
  const laneOptions = { '': 'All approach lanes', ...Object.fromEntries(leg.inbound.map((l, i) => [l.id, `Lane ${i + 1} (${l.turns.join('') || '—'})`])) };

  return (
    <div className="inspector-body">
      <button type="button" className="link" onClick={() => onSelect({ type: 'leg', legId: leg.id })}>← {legLabel(leg)}</button>
      <div className="inspector-head">
        <h2><span className="det-dot" style={{ background: detectorColor(det.purpose) }} /> Channel {det.channel || '?'}</h2>
        <button type="button" className="danger small" onClick={() => { update((d) => removeDetector(d, det.id)); onSelect({ type: 'leg', legId: leg.id }); }}>Remove</button>
      </div>
      <div className="grid2">
        <Field label="Channel"><Text value={det.channel} onChange={(v) => edit('ch', (x) => { x.channel = v; })} /></Field>
        <Field label="Phase" hint={det.phase ? 'Set here' : `Follows the lane: ${auto || 'none'}`}>
          <PhaseInput value={det.phase} placeholder={auto || '—'} onChange={(v) => edit('ph', (x) => { x.phase = v; })} />
        </Field>
        <Field label="Purpose"><Choice value={det.purpose} options={PURPOSES} onChange={(v) => edit(null, (x) => { x.purpose = v; })} /></Field>
        <Field label="Lane"><Choice value={det.laneId || ''} options={laneOptions} onChange={(v) => edit(null, (x) => { x.laneId = v || null; x.laneNumber = ''; })} /></Field>
        <Field label="Setback from stop bar (ft)"><Num value={det.setback} min={0} max={2000} onChange={(v) => edit('sb', (x) => { x.setback = v; })} /></Field>
        <Field label="Length (ft)"><Num value={det.length} min={1} max={400} onChange={(v) => edit('len', (x) => { x.length = v; })} /></Field>
        <Field label="Mode"><Choice value={det.mode} options={MODES} onChange={(v) => edit(null, (x) => { x.mode = v; })} /></Field>
        <Field label="Technology"><Choice value={det.technology} options={TECHNOLOGIES} onChange={(v) => edit(null, (x) => { x.technology = v; })} /></Field>
        <Field label="Vehicle type"><Choice value={det.vehicleType} options={VEHICLE_TYPES} onChange={(v) => edit(null, (x) => { x.vehicleType = v; })} /></Field>
      </div>
      <Field label="Description"><Text value={det.description} onChange={(v) => edit('desc', (x) => { x.description = v; })} /></Field>
      {det.laneNumber && <p className="muted small">The feed placed this on lane {det.laneNumber}, which this approach does not have.</p>}
    </div>
  );
}

export default function Inspector({ design, geom, equipment, selection, update, onSelect }) {
  let body = null;
  const leg = selection ? findLeg(design, selection.legId) : null;
  if (selection && selection.type === 'detector' && leg) {
    const det = leg.detectors.find((d) => d.id === selection.detId);
    if (det) body = <DetectorPanel leg={leg} det={det} update={update} onSelect={onSelect} />;
  } else if (selection && selection.type === 'lane' && leg) {
    const lane = findLane(leg, selection.laneId);
    if (lane) body = <LanePanel design={design} leg={leg} lane={lane} update={update} onSelect={onSelect} />;
  }
  if (!body && leg) body = <LegPanel design={design} leg={leg} update={update} onSelect={onSelect} />;
  if (!body) body = <IntersectionPanel design={design} geom={geom} equipment={equipment} update={update} onSelect={onSelect} />;

  return (
    <aside className="inspector panel">
      {selection && <button type="button" className="close" aria-label="Back to intersection" onClick={() => onSelect(null)}>×</button>}
      {body}
      <datalist id="phase-options">
        {PHASE_OPTIONS.map((p) => <option key={p} value={p} />)}
      </datalist>
    </aside>
  );
}
