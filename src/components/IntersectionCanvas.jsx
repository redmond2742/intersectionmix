import { useEffect, useMemo, useRef, useState } from 'react';
import { COLORS, detectorColor, phaseColor } from '../palette.js';
import { pt, phaseMovements, phaseCrossings, movementPath, freeRightPath } from '../lib/geometry.js';
import { legTurns, legLabel, normBearing } from '../lib/model.js';
import { bearingToTravel } from '../lib/gtss.js';
import { viewCone } from '../lib/cameras.js';
import { ConflictMarker, ConflictPaths } from './ConflictMarkers.jsx';
import PlaybackOverlay from './PlaybackOverlay.jsx';
import { DetectorDefs } from './DetectorShape.jsx';
import EquipmentLayer from './EquipmentLayer.jsx';
import PlanArt, { ChannelLabels, SpeedSign } from './PlanArt.jsx';

const FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';

function Rect({ x0, x1, y0, y1, ...rest }) {
  return <rect x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} {...rest} />;
}

/** Arrowhead markers, one per colour in use. */
function useMarkers(colors) {
  return useMemo(() => {
    const ids = new Map();
    [...new Set(colors)].forEach((color, i) => ids.set(color, `ah${i}`));
    return ids;
  }, [colors.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
}

export default function IntersectionCanvas({
  design, geom, selection, phase, conflicts, playback, equipment, onSelect, onBearing, onDragEnd, svgRef,
}) {
  const [frozen, setFrozen] = useState(null);
  const [view, setView] = useState(null); // null: fit the whole design
  const dragging = useRef(null);
  const pan = useRef(null);

  const box = frozen || view || geom.bounds;
  const viewBox = `${box.minX} ${box.minY} ${box.maxX - box.minX} ${box.maxY - box.minY}`;

  const selectedLeg = selection ? geom.byId.get(selection.legId) : null;

  // What to draw over the plan: a selected phase, or the selected leg's movements.
  // During signal playback the signals say what moves, so this steps aside.
  const overlay = useMemo(() => {
    if (playback) return null;
    if (phase) {
      return {
        moves: phaseMovements(design, geom, phase, { perLane: true }).map((m) => ({ ...m, color: phaseColor(phase) })),
        crossings: phaseCrossings(design, geom, phase).map((c) => ({ ...c, color: phaseColor(phase) })),
      };
    }
    if (!selectedLeg) return null;
    const leg = selectedLeg.leg;
    const moves = [];
    for (const turn of legTurns(leg)) {
      const lanes = selectedLeg.cs.inbound.filter((item) => item.lane.turns.includes(turn));
      lanes.forEach((item, rank) => {
        if (selection.type === 'lane' && selection.laneId !== item.lane.id) return;
        const d = movementPath(geom, leg.id, turn, item, rank, lanes.length);
        if (d) moves.push({ d, color: phaseColor(leg.movements[turn].phase), permissive: turn === 'L' && leg.movements.L.treatment === 'permissive' });
      });
      if (turn === 'R' && selectedLeg.slip && selection.type === 'leg') {
        const d = freeRightPath(geom, leg.id);
        if (d) moves.push({ d, color: phaseColor(leg.movements.R.phase), permissive: false });
      }
    }
    return { moves, crossings: [] };
  }, [design, geom, phase, selectedLeg, selection, playback]);


  const markers = useMarkers(overlay ? [...overlay.moves, ...overlay.crossings].map((m) => m.color) : []);

  const toSvg = (evt) => {
    const svg = svgRef.current;
    const p = svg.createSVGPoint();
    p.x = evt.clientX;
    p.y = evt.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  };

  const startDrag = (evt, legId) => {
    evt.stopPropagation();
    evt.currentTarget.setPointerCapture(evt.pointerId);
    dragging.current = legId;
    setFrozen(view || geom.bounds);
    onSelect({ type: 'leg', legId });
  };

  // Wheel zooms about the pointer. React's wheel listener is passive, so this
  // one is attached by hand to be allowed to stop the page scrolling.
  const boxRef = useRef(box);
  boxRef.current = box;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (evt) => {
      evt.preventDefault();
      const p = toSvg(evt);
      zoomAt(p, Math.exp(evt.deltaY * 0.0015));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (p, factor) => {
    const b = boxRef.current;
    const full = geom.bounds;
    const fullW = full.maxX - full.minX;
    const w = Math.min(fullW * 1.5, Math.max(40, (b.maxX - b.minX) * factor));
    const k = w / (b.maxX - b.minX);
    setView({
      minX: p.x - (p.x - b.minX) * k,
      maxX: p.x + (b.maxX - p.x) * k,
      minY: p.y - (p.y - b.minY) * k,
      maxY: p.y + (b.maxY - p.y) * k,
    });
  };
  const zoomCentre = (factor) => {
    const b = boxRef.current;
    zoomAt({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, factor);
  };

  // Dragging anywhere that is not a handle pans; a drag is not a click.
  const startPan = (evt) => {
    if (evt.button !== 0 || dragging.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const b = boxRef.current;
    const perPx = Math.max((b.maxX - b.minX) / rect.width, (b.maxY - b.minY) / rect.height);
    pan.current = { x: evt.clientX, y: evt.clientY, box: b, perPx, moved: false, id: evt.pointerId };
  };
  const swallowClickAfterPan = (evt) => {
    if (pan.current && pan.current.moved) {
      evt.stopPropagation();
      evt.preventDefault();
    }
    pan.current = null;
  };

  const moveDrag = (evt) => {
    if (pan.current && !dragging.current) {
      const dx = evt.clientX - pan.current.x;
      const dy = evt.clientY - pan.current.y;
      if (!pan.current.moved && Math.hypot(dx, dy) > 4) {
        pan.current.moved = true;
        svgRef.current.setPointerCapture(pan.current.id);
      }
      if (pan.current.moved) {
        const { box: b, perPx } = pan.current;
        setView({ minX: b.minX - dx * perPx, maxX: b.maxX - dx * perPx, minY: b.minY - dy * perPx, maxY: b.maxY - dy * perPx });
      }
      return;
    }
    if (!dragging.current) return;
    const p = toSvg(evt);
    if (Math.hypot(p.x, p.y) < 10) return;
    let bearing = (Math.atan2(-p.x, p.y) * 180) / Math.PI;
    bearing = evt.shiftKey ? Math.round(bearing) : Math.round(bearing / 5) * 5;
    onBearing(dragging.current, normBearing(bearing));
  };
  const endDrag = () => {
    if (pan.current && !pan.current.moved) pan.current = null;
    if (!dragging.current) return;
    dragging.current = null;
    setFrozen(null);
    onDragEnd();
  };

  const w = box.maxX - box.minX;
  // Overlay lines keep a readable on-screen weight when zoomed out.
  const k = Math.max(1, w / 320);
  // The north arrow stays in the top-left corner at a constant size on screen.
  const northScale = w / 520;
  const northAt = { x: box.minX + 26 * northScale, y: box.minY + 34 * northScale };

  return (
    <>
    <svg ref={svgRef} className={`plan${pan.current && pan.current.moved ? ' panning' : ''}`} viewBox={viewBox} preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg" fontFamily={FONT}
      onClick={() => onSelect(null)} onClickCapture={swallowClickAfterPan}
      onPointerDown={startPan} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <defs>
        <DetectorDefs />
        {[...markers.entries()].map(([color, id]) => (
          <marker key={id} id={id} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={color} />
          </marker>
        ))}
      </defs>

      <rect x={box.minX - 500} y={box.minY - 500} width={w + 1000} height={box.maxY - box.minY + 1000} fill={COLORS.land} />

      <PlanArt geom={geom} selection={selection} onSelect={onSelect} byTechnology={equipment} />

      {selectedLeg && selection.type === 'leg' && (
        <g transform={selectedLeg.matrix} data-export="skip">
          <Rect x0={selectedLeg.cs.sidewalkOut[0]} x1={selectedLeg.cs.sidewalkIn[1]} y0={selectedLeg.D} y1={selectedLeg.L}
            fill="none" stroke={COLORS.select} strokeWidth="1.2" strokeDasharray="4 3" />
        </g>
      )}

      {/* Movements of the selected phase or leg */}
      {overlay && (
        <g pointerEvents="none" data-3d="skip">
          {phase && <rect x={box.minX - 500} y={box.minY - 500} width={w + 1000} height={box.maxY - box.minY + 1000} fill="#101418" opacity="0.28" />}
          {overlay.moves.map((m, i) => (
            <g key={`m${i}`}>
              <path d={m.d} fill="none" stroke="#fff" strokeWidth={3.6 * k} strokeLinecap="round" opacity="0.85" strokeDasharray={m.permissive ? `${5 * k} ${3 * k}` : undefined} />
              <path d={m.d} fill="none" stroke={m.color} strokeWidth={2.2 * k} strokeLinecap="round"
                strokeDasharray={m.permissive ? `${5 * k} ${3 * k}` : undefined} markerEnd={`url(#${markers.get(m.color)})`} />
            </g>
          ))}
          {overlay.crossings.map((c, i) => (
            <path key={`c${i}`} d={c.d} fill="none" stroke={c.color} strokeWidth={2.2 * k} strokeDasharray={`${1.5 * k} ${2.5 * k}`} strokeLinecap="round"
              markerStart={`url(#${markers.get(c.color)})`} markerEnd={`url(#${markers.get(c.color)})`} />
          ))}
        </g>
      )}

      {/* Camera pins from the 3D view: where each stands and what it sees */}
      {(design.cameras || []).map((pin) => {
        const cone = viewCone(pin, 55);
        return (
          <g key={pin.id} pointerEvents="none" data-3d="skip">
            <polygon points={cone.map(pt).join(' ')} fill={COLORS.select} fillOpacity="0.16" stroke={COLORS.select} strokeWidth="0.6" strokeDasharray="2 1.5" />
            <circle cx={pin.x} cy={pin.y} r="2.6" fill={COLORS.select} stroke="#fff" strokeWidth="0.8" />
            <text x={pin.x} y={pin.y - 4.5} textAnchor="middle" fontSize="4.6" fontWeight="700" fill={COLORS.select}
              stroke="#fff" strokeWidth="1.2" paintOrder="stroke">{pin.name}</text>
          </g>
        );
      })}

      {/* Conflict points for the chosen scope */}
      {conflicts && (
        <g pointerEvents="none" data-3d="skip">
          <rect x={box.minX - 500} y={box.minY - 500} width={w + 1000} height={box.maxY - box.minY + 1000} fill="#ffffff" opacity="0.25" />
          <ConflictPaths result={conflicts} width={0.9 * k} opacity={0.85} />
          {conflicts.points.map((p, i) => <ConflictMarker key={i} type={p.type} x={p.x} y={p.y} r={2.4 * k} />)}
        </g>
      )}

      {/* Signal playback: what every signal and detector shows at the playhead */}
      {playback && <PlaybackOverlay design={design} geom={geom} store={playback} k={k} byTechnology={equipment} />}

      {/* Cabinet, poles, cameras and preemption (advanced setting) */}
      {equipment && <EquipmentLayer design={design} geom={geom} k={k} />}

      {/* Detector channels */}
      <ChannelLabels geom={geom} />

      {/* Street labels and rotate handles */}
      {geom.legs.map((g) => (
        <g key={`lb${g.id}`} data-3d="skip">
          <text x={g.labelTextX} y={g.labelAt.y} textAnchor="middle" fontSize="7.5" fontWeight="700" fill={COLORS.text}
            stroke={COLORS.land} strokeWidth="2" paintOrder="stroke" style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onSelect({ type: 'leg', legId: g.id }); }}>
            {g.leg.street || `Approach ${g.leg.approachId}`}
          </text>
          <text x={g.labelTextX} y={g.labelAt.y + 8.5} textAnchor="middle" fontSize="5.2" fill="#5b616a"
            stroke={COLORS.land} strokeWidth="1.6" paintOrder="stroke" pointerEvents="none">
            {`${bearingToTravel(g.leg.bearing) || ''} · ${Math.round(g.leg.bearing)}° · ${g.leg.approachId}`}
          </text>
          {g.speedSign && <SpeedSign sign={g.speedSign} />}
          <g data-export="skip" transform={`translate(${g.handle.x} ${g.handle.y})`} style={{ cursor: 'grab' }}
            onPointerDown={(e) => startDrag(e, g.id)} onClick={(e) => e.stopPropagation()}>
            <title>{`Drag to rotate ${legLabel(g.leg)} (Shift for 1°)`}</title>
            <circle r="6.5" fill="#fff" stroke={selection && selection.legId === g.id ? COLORS.select : COLORS.asphalt} strokeWidth="1.3" />
            <path d="M-3 -1.2 A3.2 3.2 0 1 1 -1.2 3" fill="none" stroke={COLORS.asphalt} strokeWidth="1" />
            <polygon points="-4.6,-1.6 -1.6,-1.6 -3,-4.4" fill={COLORS.asphalt} />
          </g>
        </g>
      ))}

      {/* North arrow */}
      <g transform={`translate(${northAt.x} ${northAt.y}) scale(${northScale})`} pointerEvents="none" data-3d="skip">
        <polygon points="0,-14 5,2 0,-2 -5,2" fill={COLORS.text} />
        <text y="12" textAnchor="middle" fontSize="8" fontWeight="700" fill={COLORS.text}>N</text>
      </g>
    </svg>
    <div className="zoom-controls">
      <button type="button" aria-label="Zoom in" onClick={() => zoomCentre(1 / 1.35)}>+</button>
      <button type="button" aria-label="Zoom out" onClick={() => zoomCentre(1.35)}>−</button>
      <button type="button" onClick={() => setView(null)} disabled={!view}>Fit</button>
    </div>
    </>
  );
}
