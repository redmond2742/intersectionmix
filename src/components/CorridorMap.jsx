import { memo, useEffect, useMemo, useRef, useState } from 'react';
import PlanArt from './PlanArt.jsx';
import PlaybackOverlay from './PlaybackOverlay.jsx';
import EquipmentLayer from './EquipmentLayer.jsx';
import { DetectorDefs } from './DetectorShape.jsx';
import { COLORS } from '../palette.js';
import { pt } from '../lib/geometry.js';
import { sectionAt } from '../lib/corridor.js';
import { corridorVehiclesAt } from '../lib/corridorVehicles.js';

const FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';
const OVERLAP = 18; // feet a link road runs on under each intersection, to meet its clipped edge
const CAR_COLORS = ['#e03131', '#1c7ed6', '#f1f3f5', '#343a40', '#f59f00', '#5c7cfa', '#2b8a3e', '#868e96'];

function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A link's centreline, run on a little under each intersection, with the cross-section at each point. */
function roadSamples(link) {
  const pts = link.road.points;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const back = { x: first.x - first.tangent.x * OVERLAP, y: first.y - first.tangent.y * OVERLAP, normal: first.normal, t: 0 };
  const on = { x: last.x + last.tangent.x * OVERLAP, y: last.y + last.tangent.y * OVERLAP, normal: last.normal, t: 1 };
  return [back, ...pts, on].map((p) => ({ ...p, section: sectionAt(link, p.t) }));
}

const offsetLine = (samples, lateral) => samples.map((p) => {
  const x = typeof lateral === 'function' ? lateral(p) : lateral;
  return { x: p.x + p.normal.x * x, y: p.y + p.normal.y * x };
});

const band = (samples, from, to) => [...offsetLine(samples, from), ...offsetLine(samples, to).reverse()].map(pt).join(' ');

/** The road between two signals: sidewalks, asphalt, centreline and lane lines. */
const LinkRoad = memo(function LinkRoad({ link }) {
  const samples = useMemo(() => roadSamples(link), [link]);
  const { a, b } = link.road.ends;
  const lanesToB = Math.max(a.lanes.toB.length, b.lanes.toB.length);
  const lanesToA = Math.max(a.lanes.toA.length, b.lanes.toA.length);
  const line = (lateral) => offsetLine(samples, lateral).map(pt).join(' ');
  const dividers = [];
  // Receiving lanes leaving A (negative side) and A's approach lanes (positive side).
  for (let k = 1; k < lanesToB; k += 1) {
    dividers.push((p) => p.section.median[0] + (p.section.curbs[0] - p.section.median[0]) * (k / lanesToB));
  }
  for (let k = 1; k < lanesToA; k += 1) {
    dividers.push((p) => p.section.median[1] + (p.section.curbs[1] - p.section.median[1]) * (k / lanesToA));
  }
  const raised = link.road.median === 'raised';
  return (
    <g>
      <polygon points={band(samples, (p) => p.section.walks[0], (p) => p.section.curbs[0])} fill={COLORS.sidewalk} />
      <polygon points={band(samples, (p) => p.section.curbs[1], (p) => p.section.walks[1])} fill={COLORS.sidewalk} />
      <polygon points={band(samples, (p) => p.section.curbs[0], (p) => p.section.curbs[1])} fill={COLORS.asphalt} />
      {raised ? (
        <polygon points={band(samples, (p) => p.section.median[0], (p) => p.section.median[1])} fill={COLORS.median} stroke={COLORS.curb} strokeWidth="0.6" />
      ) : (
        <>
          <polyline points={line((p) => (p.section.median[0] + p.section.median[1]) / 2 - 0.45)} fill="none" stroke={COLORS.yellow} strokeWidth="0.35" />
          <polyline points={line((p) => (p.section.median[0] + p.section.median[1]) / 2 + 0.45)} fill="none" stroke={COLORS.yellow} strokeWidth="0.35" />
        </>
      )}
      {dividers.map((lateral, i) => (
        <polyline key={i} points={line(lateral)} fill="none" stroke={COLORS.marking} strokeWidth="0.45" strokeDasharray="10 30" />
      ))}
    </g>
  );
});

/** One intersection where it stands, clipped to its share of the corridor. */
const SignalArt = memo(function SignalArt({ sig, equipment }) {
  const clipped = sig.clip < Math.max(...sig.geom.legs.map((g) => g.L));
  return (
    <g transform={`translate(${sig.offset.x} ${sig.offset.y})`} clipPath={clipped ? `url(#corridor-clip-${sig.index})` : undefined}>
      <PlanArt geom={sig.geom} byTechnology={equipment} breaks={false} />
    </g>
  );
});

/** The vehicles, redrawn on their own as the clock moves. */
function Cars({ master, model }) {
  const [cars, setCars] = useState([]);
  useEffect(() => {
    if (!model) {
      setCars([]);
      return undefined;
    }
    let last = 0;
    const off = master.onFrame((clock) => {
      const now = performance.now();
      if (now - last < 50) return;
      last = now;
      setCars(corridorVehiclesAt(model, clock.t));
    });
    if (master.clock) setCars(corridorVehiclesAt(model, master.clock.t));
    return off;
  }, [master, model]);
  return (
    <g data-3d="skip" data-export="skip" pointerEvents="none">
      {cars.map((c) => (
        <g key={c.id} transform={`translate(${c.x} ${c.y}) rotate(${(Math.atan2(c.dir.x, -c.dir.y) * 180) / Math.PI})`}>
          <rect x="-3" y="-7" width="6" height="14" rx="1.6" fill={CAR_COLORS[hash(c.id) % CAR_COLORS.length]} stroke="#1d2126" strokeWidth="0.5" />
          <rect x="-2.4" y="-3.6" width="4.8" height="3.4" rx="0.6" fill="#2a3642" opacity="0.8" />
        </g>
      ))}
    </g>
  );
}

/**
 * The corridor from above: each intersection at its location with its
 * signals live, joined by the road between them, with the vehicles the
 * detectors saw driving along it. The same drawing, without its overlays,
 * is the ground of the 3D corridor.
 */
export default function CorridorMap({ layout, stores, master, model, equipment, svgRef, onOpen }) {
  const bounds = layout.bounds;
  const [view, setView] = useState(null);
  const box = view || bounds;
  const pan = useRef(null);
  const boxRef = useRef(box);
  boxRef.current = box;

  useEffect(() => setView(null), [bounds]);

  const toSvg = (evt) => {
    const svg = svgRef.current;
    const p = svg.createSVGPoint();
    p.x = evt.clientX;
    p.y = evt.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  };
  const zoomAt = (p, factor) => {
    const b = boxRef.current;
    const fullW = bounds.maxX - bounds.minX;
    const w = Math.min(fullW * 1.6, Math.max(60, (b.maxX - b.minX) * factor));
    const k = w / (b.maxX - b.minX);
    setView({ minX: p.x - (p.x - b.minX) * k, maxX: p.x + (b.maxX - p.x) * k, minY: p.y - (p.y - b.minY) * k, maxY: p.y + (b.maxY - p.y) * k });
  };
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (evt) => {
      evt.preventDefault();
      zoomAt(toSvg(evt), Math.exp(evt.deltaY * 0.0015));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const b = boxRef.current;
    const perPx = Math.max((b.maxX - b.minX) / rect.width, (b.maxY - b.minY) / rect.height);
    pan.current = { x: e.clientX, y: e.clientY, box: b, perPx, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 4) return;
    p.moved = true;
    setView({ minX: p.box.minX - dx * p.perPx, maxX: p.box.maxX - dx * p.perPx, minY: p.box.minY - dy * p.perPx, maxY: p.box.maxY - dy * p.perPx });
  };
  const onPointerUp = () => { pan.current = null; };

  const w = box.maxX - box.minX;
  const k = Math.max(1, w / 1400); // overlay strokes stay readable zoomed out
  const label = Math.max(9, w / 90);

  return (
    <div className="corridor-map">
      <svg ref={svgRef} className="plan corridor-svg" viewBox={`${box.minX} ${box.minY} ${w} ${box.maxY - box.minY}`}
        preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" fontFamily={FONT}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <defs>
          <DetectorDefs />
          {layout.signals.map((sig) => (
            <clipPath key={sig.index} id={`corridor-clip-${sig.index}`}>
              <circle r={sig.clip} />
            </clipPath>
          ))}
        </defs>
        <rect x={bounds.minX - 4000} y={bounds.minY - 4000} width={bounds.maxX - bounds.minX + 8000} height={bounds.maxY - bounds.minY + 8000} fill={COLORS.land} />

        {layout.links.filter((l) => l.road).map((link) => <LinkRoad key={link.index} link={link} />)}
        {layout.signals.map((sig) => <SignalArt key={sig.index} sig={sig} equipment={equipment} />)}

        {/* Live signals, detectors and preemption at each intersection */}
        {layout.signals.map((sig) => (
          <g key={`pb${sig.index}`} transform={`translate(${sig.offset.x} ${sig.offset.y})`} data-3d="skip">
            <PlaybackOverlay design={sig.design} geom={sig.geom} store={stores[sig.index]} k={k} byTechnology={equipment} />
            {equipment && <EquipmentLayer design={sig.design} geom={sig.geom} k={k} />}
          </g>
        ))}

        <Cars master={master} model={model} />

        {/* Links that could not be joined, and the distances between signals */}
        <g data-3d="skip" pointerEvents="none">
          {layout.links.map((link) => {
            const A = layout.signals[link.a].offset;
            const B = layout.signals[link.b].offset;
            const mid = link.road ? link.road.points[Math.floor(link.road.points.length / 2)] : { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
            return (
              <g key={`ln${link.index}`}>
                {!link.road && (
                  <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#c92a2a" strokeWidth={1.2 * k} strokeDasharray={`${6 * k} ${4 * k}`} />
                )}
                <text x={mid.x} y={mid.y} dy={-label * 1.4} textAnchor="middle" fontSize={label} fontWeight="700" fill={link.road ? '#1f2328' : '#c92a2a'}
                  stroke={COLORS.land} strokeWidth={label * 0.25} paintOrder="stroke">
                  {link.road ? `${Math.round(link.travel)} ft` : 'approaches don’t line up'}
                </text>
              </g>
            );
          })}
        </g>
        <g data-3d="skip">
          {layout.signals.map((sig) => (
            <text key={`nm${sig.index}`} x={sig.offset.x} y={sig.offset.y - Math.min(sig.clip, 120) - label * 0.6} textAnchor="middle"
              fontSize={label * 1.1} fontWeight="800" fill="#1f2328" stroke={COLORS.land} strokeWidth={label * 0.28} paintOrder="stroke"
              style={{ cursor: onOpen ? 'pointer' : 'default' }} onDoubleClick={() => onOpen && onOpen(sig)}>
              <title>Double-click to open this signal in the editor</title>
              {`${sig.index + 1}. ${sig.design.name}`}
            </text>
          ))}
        </g>
      </svg>
      <div className="zoom-controls">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, 1 / 1.4)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, 1.4)}>−</button>
        <button type="button" onClick={() => setView(null)} disabled={!view}>Fit</button>
      </div>
    </div>
  );
}
