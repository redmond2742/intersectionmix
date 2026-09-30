import { useEffect, useMemo, useRef, useState } from 'react';
import LaneGlyph from './LaneGlyph.jsx';
import { COLORS, detectorColor, phaseColor } from '../palette.js';
import { pt, phaseMovements, phaseCrossings, movementPath, freeRightPath } from '../lib/geometry.js';
import { legTurns, legLabel, normBearing } from '../lib/model.js';
import { bearingToTravel } from '../lib/gtss.js';

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

function LegMarkings({ g, selection, onSelect }) {
  const { cs, leg } = g;
  const selectedLane = selection && selection.laneId;
  const selectedDet = selection && selection.detId;
  const inner = cs.inbound[0];
  const outer = cs.inbound[cs.inbound.length - 1];
  const markStart = g.cwEnd;

  return (
    <g transform={g.matrix}>
      {/* Bike lanes */}
      {cs.bikeIn && <Rect x0={cs.bikeIn[0]} x1={cs.bikeIn[1]} y0={g.S} y1={g.L} fill={COLORS.bike} opacity="0.6" />}
      {cs.bikeOut && <Rect x0={cs.bikeOut[0]} x1={cs.bikeOut[1]} y0={markStart} y1={g.L} fill={COLORS.bike} opacity="0.6" />}
      {cs.bikeIn && <line x1={cs.bikeIn[0]} x2={cs.bikeIn[0]} y1={g.S} y2={g.L} stroke={COLORS.marking} strokeWidth="0.5" />}
      {cs.bikeOut && <line x1={cs.bikeOut[1]} x2={cs.bikeOut[1]} y1={markStart} y2={g.L} stroke={COLORS.marking} strokeWidth="0.5" />}

      {/* Median */}
      {leg.median.type === 'raised' && (
        <Rect x0={cs.median[0]} x1={cs.median[1]} y0={g.S} y1={g.L} rx={Math.min(3, (cs.median[1] - cs.median[0]) / 2)}
          fill={COLORS.median} stroke={COLORS.curb} strokeWidth="0.6" />
      )}
      {leg.median.type === 'paint' && (
        <g>
          <line x1={cs.median[0]} x2={cs.median[0]} y1={markStart} y2={g.L} stroke={COLORS.yellow} strokeWidth="0.5" />
          <line x1={cs.median[1]} x2={cs.median[1]} y1={markStart} y2={g.L} stroke={COLORS.yellow} strokeWidth="0.5" />
          {Array.from({ length: Math.max(0, Math.floor((g.L - markStart - 10) / 16)) }, (_, i) => {
            const y = markStart + 10 + i * 16;
            return <line key={i} x1={cs.median[0]} x2={cs.median[1]} y1={y} y2={y + (cs.median[1] - cs.median[0])} stroke={COLORS.yellow} strokeWidth="0.4" />;
          })}
        </g>
      )}
      {leg.median.type === 'none' && (leg.inbound.length > 0 || leg.outbound.length > 0) && (
        <g>
          <line x1={-0.45} x2={-0.45} y1={markStart} y2={g.L} stroke={COLORS.yellow} strokeWidth="0.35" />
          <line x1={0.45} x2={0.45} y1={markStart} y2={g.L} stroke={COLORS.yellow} strokeWidth="0.35" />
        </g>
      )}

      {/* Lane lines: solid near the stop bar, dashed upstream */}
      {cs.inbound.slice(0, -1).map((item) => (
        <g key={item.lane.id}>
          <line x1={item.x1} x2={item.x1} y1={g.S} y2={g.S + 60} stroke={COLORS.marking} strokeWidth="0.45" />
          <line x1={item.x1} x2={item.x1} y1={g.S + 60} y2={g.L} stroke={COLORS.marking} strokeWidth="0.45" strokeDasharray="10 30" />
        </g>
      ))}
      {cs.outbound.slice(1).map((item) => (
        <line key={item.lane.id} x1={item.x1} x2={item.x1} y1={markStart} y2={g.L} stroke={COLORS.marking} strokeWidth="0.45" strokeDasharray="10 30" />
      ))}

      {/* Stop bar */}
      {inner && <Rect x0={inner.x0} x1={outer.x1} y0={g.S} y1={g.S + 1.8} fill={COLORS.marking} />}

      {/* Crosswalk */}
      {leg.crosswalk.enabled && (
        <g>
          {Array.from({ length: Math.max(0, Math.floor((cs.curbIn - cs.curbOut - 1) / 4)) }, (_, i) => {
            const x = cs.curbOut + 1 + i * 4;
            return <Rect key={i} x0={x} x1={x + 2} y0={g.cwStart + 0.5} y1={g.cwEnd - 0.5} fill={COLORS.marking} />;
          })}
        </g>
      )}

      {/* Lane arrows and click targets */}
      {cs.inbound.map((item) => (
        <g key={item.lane.id} style={{ cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); onSelect({ type: 'lane', legId: g.id, laneId: item.lane.id }); }}>
          <Rect x0={item.x0} x1={item.x1} y0={g.S} y1={g.L} fill="transparent" />
          <g transform={`translate(${item.cx} ${g.S + 14})`}><LaneGlyph turns={item.lane.turns} /></g>
          {selectedLane === item.lane.id && (
            <Rect x0={item.x0 + 0.3} x1={item.x1 - 0.3} y0={g.S} y1={g.L} fill="none" stroke={COLORS.select} strokeWidth="1" data-export="skip" />
          )}
        </g>
      ))}
      {cs.outbound.map((item) => (
        <Rect key={item.lane.id} x0={item.x0} x1={item.x1} y0={markStart} y1={g.L} fill="transparent" style={{ cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); onSelect({ type: 'leg', legId: g.id }); }} />
      ))}

      {/* Detectors */}
      {g.detectors.map((item) => {
        const color = detectorColor(item.det.purpose);
        const selected = selectedDet === item.det.id;
        return (
          <Rect key={item.det.id} x0={item.x0} x1={item.x1} y0={item.y0} y1={item.y1}
            fill={color} fillOpacity="0.32" stroke={selected ? COLORS.select : color} strokeWidth={selected ? 1.2 : 0.6}
            style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onSelect({ type: 'detector', legId: g.id, detId: item.det.id }); }}>
            <title>{`Channel ${item.det.channel} · ${item.det.purpose} · ${item.det.setback} ft back, ${item.det.length} ft long`}</title>
          </Rect>
        );
      })}

      {/* Break line where far detectors are drawn compressed */}
      {g.breakAt && (
        <g>
          <Rect x0={cs.sidewalkOut[0] - 2} x1={cs.sidewalkIn[1] + 2} y0={g.breakAt} y1={g.breakAt + 3} fill={COLORS.land} />
          <line x1={cs.sidewalkOut[0] - 2} x2={cs.sidewalkIn[1] + 2} y1={g.breakAt} y2={g.breakAt} stroke={COLORS.curb} strokeWidth="0.4" />
          <line x1={cs.sidewalkOut[0] - 2} x2={cs.sidewalkIn[1] + 2} y1={g.breakAt + 3} y2={g.breakAt + 3} stroke={COLORS.curb} strokeWidth="0.4" />
        </g>
      )}
    </g>
  );
}

/** A regulatory speed limit sign (R2-1): black on white, the limit large. */
function SpeedSign({ sign }) {
  const { x, y, w, h, limit } = sign;
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      <title>{`Posted speed ${limit} mph`}</title>
      <rect width={w} height={h} rx="1.2" fill="#ffffff" stroke="#1d2126" strokeWidth="0.45" />
      <rect x="0.7" y="0.7" width={w - 1.4} height={h - 1.4} rx="0.8" fill="none" stroke="#1d2126" strokeWidth="0.35" />
      <text x={w / 2} y="4.3" textAnchor="middle" fontSize="2.6" fontWeight="800" fill="#1d2126">SPEED</text>
      <text x={w / 2} y="7.2" textAnchor="middle" fontSize="2.6" fontWeight="800" fill="#1d2126">LIMIT</text>
      <text x={w / 2} y={h - 2.2} textAnchor="middle" fontSize={limit >= 100 ? 5.4 : 7} fontWeight="800" fill="#1d2126">{limit}</text>
    </g>
  );
}

export default function IntersectionCanvas({ design, geom, selection, phase, onSelect, onBearing, onDragEnd, svgRef }) {
  const [frozen, setFrozen] = useState(null);
  const [view, setView] = useState(null); // null: fit the whole design
  const dragging = useRef(null);
  const pan = useRef(null);

  const box = frozen || view || geom.bounds;
  const viewBox = `${box.minX} ${box.minY} ${box.maxX - box.minX} ${box.maxY - box.minY}`;

  const selectedLeg = selection ? geom.byId.get(selection.legId) : null;

  // What to draw over the plan: a selected phase, or the selected leg's movements.
  const overlay = useMemo(() => {
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
  }, [design, geom, phase, selectedLeg, selection]);

  const slips = geom.legs.filter((g) => g.slip).map((g) => ({ g, slip: g.slip }));

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
        {[...markers.entries()].map(([color, id]) => (
          <marker key={id} id={id} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={color} />
          </marker>
        ))}
      </defs>

      <rect x={box.minX - 500} y={box.minY - 500} width={w + 1000} height={box.maxY - box.minY + 1000} fill={COLORS.land} />

      {/* Sidewalk, then asphalt, over the whole footprint */}
      <polygon points={geom.sidewalkCore.map(pt).join(' ')} fill={COLORS.sidewalk} />
      {geom.legs.map((g) => (
        <g key={`sw${g.id}`} transform={g.matrix}>
          <Rect x0={g.cs.sidewalkOut[0]} x1={g.cs.sidewalkIn[1]} y0={0} y1={g.L} fill={COLORS.sidewalk} />
          <line x1={g.cs.sidewalkOut[0]} x2={g.cs.sidewalkOut[0]} y1={g.D} y2={g.L} stroke={COLORS.curb} strokeWidth="0.4" />
          <line x1={g.cs.sidewalkIn[1]} x2={g.cs.sidewalkIn[1]} y1={g.D} y2={g.L} stroke={COLORS.curb} strokeWidth="0.4" />
        </g>
      ))}
      {slips.map(({ g, slip }) => (
        <g key={`slipwalk${g.id}`}>
          <polygon points={slip.sidewalk.map(pt).join(' ')} fill={COLORS.sidewalk} stroke={COLORS.sidewalk} strokeWidth="0.6" strokeLinejoin="round" />
          <polygon points={slip.taper.sidewalk.map(pt).join(' ')} fill={COLORS.sidewalk} />
          <polygon points={slip.receiving.sidewalk.map(pt).join(' ')} fill={COLORS.sidewalk} />
        </g>
      ))}
      <polygon points={geom.asphaltCore.map(pt).join(' ')} fill={COLORS.asphalt} />
      {geom.legs.map((g) => (
        <g key={`as${g.id}`} transform={g.matrix}>
          <Rect x0={g.cs.curbOut} x1={g.cs.curbIn} y0={0} y1={g.L} fill={COLORS.asphalt} />
        </g>
      ))}
      {geom.fillets.map((d, i) => <path key={`f${i}`} d={d} fill={COLORS.asphalt} />)}
      {slips.map(({ g, slip }) => (
        <g key={`slip${g.id}`} style={{ cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); onSelect({ type: 'leg', legId: g.id }); }}>
          <polygon points={slip.taper.asphalt.map(pt).join(' ')} fill={COLORS.asphalt} />
          <polygon points={slip.receiving.asphalt.map(pt).join(' ')} fill={COLORS.asphalt} />
          <polygon points={slip.asphalt.map(pt).join(' ')} fill={COLORS.asphalt} stroke={COLORS.asphalt} strokeWidth="0.6" strokeLinejoin="round" />
          {slip.island && (
            <path d={slip.island} fill={COLORS.median} stroke={COLORS.curb} strokeWidth="0.9" strokeLinejoin="round" />
          )}
        </g>
      ))}

      {/* Markings and click targets, leg by leg */}
      {geom.legs.map((g) => (
        <g key={`mk${g.id}`} style={{ cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); onSelect({ type: 'leg', legId: g.id }); }}>
          <LegMarkings g={g} selection={selection && selection.legId === g.id ? selection : null} onSelect={onSelect} />
        </g>
      ))}

      {/* Slip-lane markings: arrows, lane lines, yield line, crossing */}
      {slips.map(({ g, slip }) => (
        <g key={`slipmk${g.id}`} pointerEvents="none">
          {slip.taper.line && (
            <line x1={slip.taper.line[0].x} y1={slip.taper.line[0].y} x2={slip.taper.line[1].x} y2={slip.taper.line[1].y}
              stroke={COLORS.marking} strokeWidth="0.45" />
          )}
          {slip.receiving.lines.map((l, i) => (
            <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={COLORS.marking} strokeWidth="0.45" strokeDasharray={l.dash || undefined} />
          ))}
          {slip.receiving.teeth.map((tri, i) => <polygon key={`t${i}`} points={tri.map(pt).join(' ')} fill={COLORS.marking} />)}
          {slip.arrows.map((a, i) => (
            <g key={`a${i}`} transform={`translate(${a.x} ${a.y}) rotate(${a.rot})`}><LaneGlyph turns={['R']} /></g>
          ))}
          {slip.crosswalk && (
            <g transform={`translate(${slip.crosswalk.x} ${slip.crosswalk.y}) rotate(${slip.crosswalk.rot})`}>
              {Array.from({ length: Math.floor((slip.crosswalk.w + 1) / 3.2) }, (_, k) => (
                <rect key={k} x={-slip.crosswalk.w / 2 + 0.7 + k * 3.2} y={-4} width={1.8} height={8} fill={COLORS.marking} />
              ))}
            </g>
          )}
        </g>
      ))}

      {selectedLeg && selection.type === 'leg' && (
        <g transform={selectedLeg.matrix} data-export="skip">
          <Rect x0={selectedLeg.cs.sidewalkOut[0]} x1={selectedLeg.cs.sidewalkIn[1]} y0={selectedLeg.D} y1={selectedLeg.L}
            fill="none" stroke={COLORS.select} strokeWidth="1.2" strokeDasharray="4 3" />
        </g>
      )}

      {/* Movements of the selected phase or leg */}
      {overlay && (
        <g pointerEvents="none">
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

      {/* Detector channels */}
      {geom.legs.map((g) => g.detectors.map((item) => (
        <text key={`dl${item.det.id}`} x={item.center.x} y={item.center.y} fontSize="4.2" fontWeight="700" textAnchor="middle"
          dominantBaseline="central" fill="#fff" stroke="#1d2126" strokeWidth="0.9" paintOrder="stroke" pointerEvents="none">
          {item.det.channel}
        </text>
      )))}

      {/* Street labels and rotate handles */}
      {geom.legs.map((g) => (
        <g key={`lb${g.id}`}>
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
      <g transform={`translate(${northAt.x} ${northAt.y}) scale(${northScale})`} pointerEvents="none">
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
