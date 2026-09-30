import { useRef, useState } from 'react';
import LaneGlyph from './LaneGlyph.jsx';
import { phaseColor } from '../palette.js';
import {
  findLeg, moveLane, addLane, removeLane, makeOutbound, legLabel, addLeg, TURN_LABELS, medianWidth, uid,
} from '../lib/model.js';
import { bearingToTravel } from '../lib/gtss.js';

const PX = 7; // pixels per foot
const HEADING = {
  NB: 'north', NEB: 'northeast', EB: 'east', SEB: 'southeast',
  SB: 'south', SWB: 'southwest', WB: 'west', NWB: 'northwest',
};
const PALETTE = [
  { turns: ['L'], label: 'Left' },
  { turns: ['T'], label: 'Through' },
  { turns: ['R'], label: 'Right' },
  { turns: ['L', 'T'], label: 'Left + through' },
  { turns: ['T', 'R'], label: 'Through + right' },
  { turns: ['U'], label: 'U-turn' },
];

function Glyph({ turns, flip = false, size = 38, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="-9 -9 18 18" aria-hidden="true">
      <g transform={flip ? 'rotate(180)' : undefined}><LaneGlyph turns={turns} color={color} width={1.3} /></g>
    </svg>
  );
}

function Stepper({ value, onChange, min, max, step = 0.5, unit = 'ft' }) {
  const set = (v) => onChange(Math.max(min, Math.min(max, Math.round(v * 10) / 10)));
  return (
    <span className="stepper" onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Narrower" onClick={() => set(value - step)}>−</button>
      <span>{value} {unit}</span>
      <button type="button" aria-label="Wider" onClick={() => set(value + step)}>+</button>
    </span>
  );
}

export default function LegStrip({ design, legId, selection, onSelect, update }) {
  const leg = findLeg(design, legId);
  const [drop, setDropState] = useState(null); // insertion index while dragging, for the marker
  const dropRef = useRef(null); // the same, for the drop handler, which may run before a re-render
  const setDrop = (value) => {
    dropRef.current = value;
    setDropState(value);
  };

  const edit = (recipe, key) => update((d) => {
    const draft = findLeg(d, legId);
    if (draft) recipe(draft, d);
  }, key ? { key: `${legId}:${key}` } : undefined);

  const addApproach = () => {
    const id = uid('leg');
    update((d) => {
      addLeg(d, { id });
    });
    onSelect({ type: 'leg', legId: id });
  };

  const tabs = (
    <div className="strip-tabs" role="tablist">
      {design.legs.map((l) => (
        <button key={l.id} type="button" role="tab" aria-selected={l.id === legId}
          className={l.id === legId ? 'tab active' : 'tab'} onClick={() => onSelect({ type: 'leg', legId: l.id })}>
          {legLabel(l)}
        </button>
      ))}
      <button type="button" className="tab add" onClick={addApproach}>+ Approach</button>
    </div>
  );

  if (!leg) {
    return (
      <section className="strip panel">
        {tabs}
        <p className="muted strip-empty">Pick an approach above, or click one on the drawing, to edit its cross-section.</p>
      </section>
    );
  }

  const travel = bearingToTravel(leg.bearing);
  const onDragStart = (e, payload) => {
    dropRef.current = null;
    e.dataTransfer.setData('text/plain', payload);
    e.dataTransfer.effectAllowed = 'move';
  };
  const overLane = (e, index) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDrop(e.clientX < rect.left + rect.width / 2 ? index : index + 1);
  };
  const onDrop = (e, fallback) => {
    e.preventDefault();
    e.stopPropagation(); // a tile's drop must not reach the row's as well
    const payload = e.dataTransfer.getData('text/plain');
    const at = dropRef.current ?? fallback;
    setDrop(null);
    if (payload.startsWith('lane:')) {
      const from = Number(payload.slice(5));
      edit((l) => moveLane(l, from, from < at ? at - 1 : at));
    } else if (payload.startsWith('new:')) {
      const turns = payload.slice(4).split('');
      edit((l) => addLane(l, turns, at));
    }
  };

  const tiles = [];
  const side = (key, cls, width, label, body, onRemove, stepper) => {
    tiles.push(
      <div key={key} className={`tile ${cls}`} style={{ width: Math.max(28, width * PX) }}
        onClick={() => onSelect({ type: 'leg', legId })}>
        <span className="tile-label">{label}</span>
        {body}
        {stepper}
        {onRemove && <button type="button" className="tile-x" aria-label={`Remove ${label}`} onClick={(e) => { e.stopPropagation(); onRemove(); }}>×</button>}
      </div>,
    );
  };

  if (leg.sidewalk > 0) {
    side('swo', 'sidewalk', leg.sidewalk, 'Sidewalk', null, null,
      <Stepper value={leg.sidewalk} min={0} max={30} step={1} onChange={(v) => edit((l) => { l.sidewalk = v; }, 'sidewalk')} />);
  }
  if (leg.bikeOut > 0) {
    side('bko', 'bike', leg.bikeOut, 'Bike', <span className="bike-icon">🚲</span>, () => edit((l) => { l.bikeOut = 0; }));
  }
  [...leg.outbound].reverse().forEach((lane) => {
    side(lane.id, 'outbound', lane.width, 'Receiving', <Glyph turns={['T']} flip color="rgba(255,255,255,.55)" />,
      () => edit((l) => { l.outbound = l.outbound.filter((o) => o.id !== lane.id); }),
      <Stepper value={lane.width} min={8} max={18} onChange={(v) => edit((l) => { l.outbound.find((o) => o.id === lane.id).width = v; }, `ow${lane.id}`)} />);
  });
  if (medianWidth(leg) > 0) {
    side('med', `median ${leg.median.type}`, medianWidth(leg), 'Median', null, null,
      <Stepper value={leg.median.width} min={2} max={40} step={1} onChange={(v) => edit((l) => { l.median.width = v; }, 'median')} />);
  } else {
    tiles.push(<div key="cl" className="tile centerline" aria-label="Centre line" />);
  }

  leg.inbound.forEach((lane, index) => {
    const selected = selection && selection.laneId === lane.id;
    tiles.push(
      <div key={lane.id}
        className={`tile inbound${selected ? ' selected' : ''}${drop === index ? ' drop-before' : ''}${drop === index + 1 && index === leg.inbound.length - 1 ? ' drop-after' : ''}`}
        style={{ width: lane.width * PX }}
        draggable onDragStart={(e) => onDragStart(e, `lane:${index}`)} onDragEnd={() => setDrop(null)}
        onDragOver={(e) => overLane(e, index)} onDrop={(e) => onDrop(e, index)}
        onClick={() => onSelect({ type: 'lane', legId, laneId: lane.id })}>
        <span className="tile-label">Lane {index + 1}</span>
        <Glyph turns={lane.turns} />
        <span className="chips">
          {lane.turns.map((t) => (
            <span key={t} className="chip" style={{ background: phaseColor(leg.movements[t].phase) }} title={`${TURN_LABELS[t]}: phase ${leg.movements[t].phase || 'none'}`}>
              {t}{leg.movements[t].phase ? ` ${leg.movements[t].phase}` : ''}
            </span>
          ))}
        </span>
        <Stepper value={lane.width} min={8} max={18} onChange={(v) => edit((l) => { l.inbound.find((x) => x.id === lane.id).width = v; }, `w${lane.id}`)} />
        <button type="button" className="tile-x" aria-label="Remove lane"
          onClick={(e) => { e.stopPropagation(); edit((l) => removeLane(l, lane.id)); onSelect({ type: 'leg', legId }); }}>×</button>
      </div>,
    );
  });
  if (!leg.inbound.length) {
    tiles.push(
      <div key="empty" className={`tile inbound empty${drop === 0 ? ' drop-before' : ''}`} style={{ width: 11 * PX }}
        onDragOver={(e) => { e.preventDefault(); setDrop(0); }} onDrop={(e) => onDrop(e, 0)}>
        <span className="tile-label">Drop a lane</span>
      </div>,
    );
  }

  if (leg.bikeIn > 0) {
    side('bki', 'bike', leg.bikeIn, 'Bike', <span className="bike-icon">🚲</span>, () => edit((l) => { l.bikeIn = 0; }));
  }
  if (leg.freeRight.lanes > 0) {
    side('isl', 'island', 6, 'Island', null, null, null);
    for (let i = 0; i < leg.freeRight.lanes; i += 1) {
      side(`fr${i}`, 'inbound free', 12, 'Free right', <Glyph turns={['R']} />,
        () => edit((l) => { l.freeRight.lanes = Math.max(0, l.freeRight.lanes - 1); }));
    }
  }
  if (leg.sidewalk > 0) side('swi', 'sidewalk', leg.sidewalk, 'Sidewalk', null, null, null);

  return (
    <section className="strip panel">
      {tabs}
      <div className="strip-head">
        <h2>{leg.street || `Approach ${leg.approachId}`}</h2>
        <span className="muted">
          Looking {HEADING[travel] || 'ahead'} toward the intersection, as {travel || 'arriving'} traffic sees it.
          Drag lanes to reorder; drag a lane type from below to add one.
        </span>
      </div>
      <div className="strip-scroll">
        <div className="strip-row" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, leg.inbound.length)}>
          {tiles}
        </div>
        <div className="strip-ground" />
      </div>
      <div className="palette">
        {PALETTE.map((item) => (
          <button key={item.label} type="button" className="palette-item" draggable
            onDragStart={(e) => onDragStart(e, `new:${item.turns.join('')}`)} onDragEnd={() => setDrop(null)}
            onClick={() => edit((l) => addLane(l, item.turns))} title={`Add a ${item.label.toLowerCase()} lane`}>
            <Glyph turns={item.turns} size={26} />
            <span>{item.label}</span>
          </button>
        ))}
        <span className="palette-sep" />
        <button type="button" className="palette-item text" onClick={() => edit((l) => { l.outbound.push(makeOutbound()); })}>+ Receiving lane</button>
        {leg.bikeIn === 0 && <button type="button" className="palette-item text" onClick={() => edit((l) => { l.bikeIn = 5; })}>+ Bike lane (in)</button>}
        {leg.bikeOut === 0 && <button type="button" className="palette-item text" onClick={() => edit((l) => { l.bikeOut = 5; })}>+ Bike lane (out)</button>}
        {leg.freeRight.lanes === 0 && <button type="button" className="palette-item text" onClick={() => edit((l) => { l.freeRight.lanes = 1; })}>+ Free right</button>}
      </div>
    </section>
  );
}
