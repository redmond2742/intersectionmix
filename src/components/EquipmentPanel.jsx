import { useMemo } from 'react';
import { Field, Text, Num, Choice } from './fields.jsx';
import {
  CABINET_TYPES, DETECTION_SYSTEMS, PREEMPT_TYPES, makeCctv, setDetectionSystem, setCameraCount,
} from '../lib/its.js';
import { equipmentLayout, aimAtCentre } from '../lib/itsLayout.js';
import { legLabel } from '../lib/model.js';

/**
 * ITS & equipment inputs, under the Intersection panel when the advanced
 * setting is on: cabinet, CCTV cameras, detection system with its cameras,
 * and preemption.
 */
export default function EquipmentPanel({ design, geom, update }) {
  const its = design.its;
  const corners = useMemo(() => geom.corners.map((c) => [c.id, c.label]), [geom]);
  const cornerOptions = { '': 'Choose a corner', ...Object.fromEntries(corners) };
  const layout = useMemo(() => equipmentLayout(design, geom), [design, geom]);
  const approaches = design.legs.filter((l) => l.inbound.length);
  const set = (key, recipe) => update((d) => recipe(d.its, d), key ? { key: `its:${key}` } : undefined);

  const addCctv = () => update((d) => {
    const used = new Set(d.its.cctv.map((c) => c.corner));
    const corner = (geom.corners.find((c) => c.valid && !used.has(c.id)) || geom.corners[0] || {}).id || '';
    const cctv = makeCctv({ name: `CCTV ${d.its.cctv.length + 1}`, corner });
    d.its.cctv.push(cctv);
    // Aim it at the middle from wherever it lands.
    const placed = equipmentLayout(d, geom).cctv.find((c) => c.cctv.id === cctv.id);
    if (placed) Object.assign(cctv, aimAtCentre(cctv, placed.point));
  });
  const editCctv = (id, key, recipe) => set(`${id}:${key}`, (x) => {
    const cctv = x.cctv.find((c) => c.id === id);
    if (cctv) recipe(cctv);
  });
  const camOptions = {
    '': 'Its approach’s mast arm',
    ...Object.fromEntries(corners.map(([id, label]) => [id, `Pole on the ${label}`])),
  };

  return (
    <div className="equipment-panel">
      <h3>ITS &amp; equipment</h3>

      <h4>Cabinet</h4>
      <div className="grid2">
        <Field label="Type">
          <Choice value={its.cabinet.type} options={{ '': 'None', ...Object.fromEntries(Object.entries(CABINET_TYPES).map(([k, v]) => [k, v.label])) }}
            onChange={(v) => set(null, (x) => {
              x.cabinet.type = v;
              if (v && !x.cabinet.corner && corners[0]) x.cabinet.corner = corners[0][0];
            })} />
        </Field>
        <Field label="Corner">
          <Choice value={its.cabinet.corner} options={cornerOptions} onChange={(v) => set(null, (x) => { x.cabinet.corner = v; })} />
        </Field>
      </div>
      <Field label="Controller"><Text value={its.cabinet.controller} placeholder="e.g. Econolite Cobalt, 2070"
        onChange={(v) => set('ctrl', (x) => { x.cabinet.controller = v; })} /></Field>

      <div className="section-head">
        <h4>CCTV cameras</h4>
        <button type="button" className="small" onClick={addCctv}>+ Add CCTV</button>
      </div>
      {its.cctv.length === 0 && <p className="muted small">None. A CCTV camera can also drive the video window&apos;s 3D view.</p>}
      {its.cctv.map((cctv) => {
        const placed = layout.cctv.find((c) => c.cctv.id === cctv.id);
        return (
          <div key={cctv.id} className="equipment-card">
            <div className="grid2">
              <Field label="Name"><Text value={cctv.name} onChange={(v) => editCctv(cctv.id, 'name', (c) => { c.name = v; })} /></Field>
              <Field label="Corner" hint={placed && placed.onPole ? 'On the corner’s signal pole' : 'On its own pole'}>
                <Choice value={cctv.corner} options={cornerOptions} onChange={(v) => update((d) => {
                  const c = d.its.cctv.find((x) => x.id === cctv.id);
                  if (!c) return;
                  c.corner = v;
                  const moved = equipmentLayout(d, geom).cctv.find((x) => x.cctv.id === c.id);
                  if (moved) Object.assign(c, aimAtCentre(c, moved.point));
                })} />
              </Field>
              <Field label="Height (ft)"><Num value={cctv.height} min={3} max={200} onChange={(v) => editCctv(cctv.id, 'h', (c) => { c.height = v; })} /></Field>
              <Field label="Heading (°)"><Num value={cctv.heading} min={0} max={359} onChange={(v) => editCctv(cctv.id, 'hd', (c) => { c.heading = ((v % 360) + 360) % 360; })} /></Field>
              <Field label="Tilt (°)" hint="Negative looks down"><Num value={cctv.tilt} min={-89} max={30} step={0.5} onChange={(v) => editCctv(cctv.id, 'tilt', (c) => { c.tilt = v; })} /></Field>
              <Field label="Field of view (°)"><Num value={cctv.fov} min={10} max={120} onChange={(v) => editCctv(cctv.id, 'fov', (c) => { c.fov = v; })} /></Field>
            </div>
            <div className="button-row">
              <button type="button" className="small" disabled={!placed}
                onClick={() => editCctv(cctv.id, null, (c) => Object.assign(c, aimAtCentre(c, placed.point)))}>Aim at centre</button>
              <button type="button" className="small danger" onClick={() => set(null, (x) => { x.cctv = x.cctv.filter((c) => c.id !== cctv.id); })}>Remove</button>
            </div>
          </div>
        );
      })}

      <h4>Detection</h4>
      <Field label="System" hint={its.detection.system === 'mixed' ? 'Set each detector’s technology on the detector' : 'Sets every detector’s technology'}>
        <Choice value={its.detection.system} options={DETECTION_SYSTEMS} onChange={(v) => update((d) => setDetectionSystem(d, v))} />
      </Field>
      {(its.detection.system === 'video' || its.detection.system === 'mixed') && (
        <>
          <Field label="Video detection cameras">
            <Num value={its.detection.cameras.length} min={0} max={32} onChange={(v) => update((d) => setCameraCount(d, v), { key: 'its:camcount' })} />
          </Field>
          {its.detection.cameras.map((cam, i) => (
            <div key={cam.id} className="grid2 camera-row">
              <Field label={`Camera ${i + 1} watches`}>
                <Choice value={cam.legId} options={Object.fromEntries(approaches.map((l) => [l.id, legLabel(l)]))}
                  onChange={(v) => set(null, (x) => { x.detection.cameras[i].legId = v; })} />
              </Field>
              <Field label="Mounted on">
                <Choice value={cam.corner} options={camOptions} onChange={(v) => set(null, (x) => { x.detection.cameras[i].corner = v; })} />
              </Field>
            </div>
          ))}
        </>
      )}

      <h4>Preemption</h4>
      <Field label="Type">
        <Choice value={its.preemption.type} options={PREEMPT_TYPES} onChange={(v) => set(null, (x) => { x.preemption.type = v; })} />
      </Field>
      {its.preemption.type !== 'none' && (
        <div className="check-list">
          {approaches.map((leg) => {
            const all = its.preemption.legIds.length === 0;
            const on = all || its.preemption.legIds.includes(leg.id);
            return (
              <div key={leg.id} className="preempt-row">
                <label className="check">
                  <input type="checkbox" checked={on} onChange={(e) => set(null, (x) => {
                    const current = x.preemption.legIds.length ? x.preemption.legIds : approaches.map((l) => l.id);
                    const next = e.target.checked ? [...new Set([...current, leg.id])] : current.filter((id) => id !== leg.id);
                    if (!next.length) x.preemption.type = 'none'; // none left: no preemption
                    x.preemption.legIds = next.length === approaches.length ? [] : next;
                  })} />
                  {legLabel(leg)}
                </label>
                {on && (
                  <label className="preempt-number" title="The preempt or priority number this approach has in high-resolution data">
                    #
                    <Text value={its.preemption.numbers[leg.id] || ''} placeholder="—"
                      onChange={(v) => set(`num:${leg.id}`, (x) => { x.preemption.numbers[leg.id] = v.trim(); })} />
                  </label>
                )}
              </div>
            );
          })}
          <p className="muted small">
            The number is the preempt (or priority) this approach answers in the data, so playback can light it up.
            Leave them blank and every approach lights together.
          </p>
          {its.preemption.type === 'cloud' && <p className="muted small">Cloud / GPS preemption needs no detector on the poles; it is shown on the cabinet.</p>}
        </div>
      )}
    </div>
  );
}
