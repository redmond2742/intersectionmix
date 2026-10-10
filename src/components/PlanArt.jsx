import LaneGlyph from './LaneGlyph.jsx';
import DetectorShape from './DetectorShape.jsx';
import { COLORS, detectorColor } from '../palette.js';
import { pt } from '../lib/geometry.js';

/**
 * The plan of one intersection as it lies on the ground: sidewalks,
 * asphalt, curb returns and slip lanes, then every leg's markings, lanes,
 * crosswalks and detectors. A <g> in plan feet, so the editor draws it in
 * its own <svg> and the corridor map draws several, each at its location.
 *
 * Clicks select a leg, lane or detector when `onSelect` is given. `breaks`
 * draws the break across a leg where far detectors are drawn closer than
 * they are; a corridor, whose legs run on into the next signal, leaves it out.
 */

function Rect({ x0, x1, y0, y1, ...rest }) {
  return <rect x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} {...rest} />;
}

const noop = () => {};

const BOX_GREEN = '#3f9b5b';
const SIDEWALK_MARK = '#857f72';

/**
 * The bicycle pavement marking (MUTCD 9C-3), about 6 ft wide, read the
 * right way up by a rider travelling toward -y.
 */
function BikeGlyph({ color = COLORS.marking, width = 0.45 }) {
  const stroke = { fill: 'none', stroke: color, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <g>
      <circle cx="-2.1" cy="0.6" r="1.25" {...stroke} />
      <circle cx="2.1" cy="0.6" r="1.25" {...stroke} />
      <path d="M-2.1 0.6 L-0.6 -1.2 L1.3 -1.2 L2.1 0.6 M-0.6 -1.2 L0.3 0.6 L1.3 -1.2 M-0.9 -1.8 L-0.2 -1.8 M1.3 -1.2 L1 -2" {...stroke} />
      <circle cx="0.5" cy="-3.2" r="0.55" fill={color} />
      <path d="M0.3 -2.6 L-0.2 -1.5" {...stroke} />
    </g>
  );
}

/** Positions every `step` feet from `from` to `to` along a leg. */
const every = (from, to, step) => {
  const out = [];
  for (let y = from; y <= to; y += step) out.push(y);
  return out;
};

/** A bicycle and an arrow in each bike lane; the arrow points the way riders go. */
function BikeLaneArrows({ g }) {
  const { cs } = g;
  const marks = [];
  if (cs.bikeIn) {
    const x = (cs.bikeIn[0] + cs.bikeIn[1]) / 2;
    for (const y of every(g.S + 22, g.L - 14, 110)) marks.push({ x, y, toward: true });
  }
  if (cs.bikeOut) {
    const x = (cs.bikeOut[0] + cs.bikeOut[1]) / 2;
    for (const y of every(g.cwEnd + 30, g.L - 14, 110)) marks.push({ x, y, toward: false });
  }
  return marks.map((m) => (
    // Toward the intersection is -y; a rider leaving reads it turned round.
    <g key={`${m.x}:${m.y}`} transform={`translate(${m.x} ${m.y}) rotate(${m.toward ? 0 : 180})`} pointerEvents="none">
      <g transform="translate(0 2.2) scale(0.62)"><BikeGlyph /></g>
      <g transform="translate(0 -4.6) scale(0.42)"><LaneGlyph turns={['T']} width={1.4} /></g>
    </g>
  ));
}

/** Arrows along the sidewalks: with the traffic beside them, one way, or both. */
function SidewalkArrows({ g, mode }) {
  const { cs } = g;
  const sides = [];
  const wide = (w) => w[1] - w[0] >= 4;
  if (wide(cs.sidewalkIn)) sides.push({ x: (cs.sidewalkIn[0] + cs.sidewalkIn[1]) / 2, from: g.S + 18, inbound: true });
  if (wide(cs.sidewalkOut)) sides.push({ x: (cs.sidewalkOut[0] + cs.sidewalkOut[1]) / 2, from: g.cwEnd + 18, inbound: false });
  const marks = [];
  for (const side of sides) {
    // 'traffic': the sidewalk beside the approach lanes points in, the other out.
    const dirs = mode === 'both' ? [true, false] : [mode === 'in' || (mode === 'traffic' && side.inbound)];
    for (const y of every(side.from, g.L - 10, 60)) {
      dirs.forEach((toward, i) => marks.push({ x: side.x + (dirs.length > 1 ? (i ? 1.3 : -1.3) : 0), y, toward }));
    }
  }
  return marks.map((m) => (
    <g key={`${m.x}:${m.y}:${m.toward}`} transform={`translate(${m.x} ${m.y}) rotate(${m.toward ? 0 : 180}) scale(0.38)`} pointerEvents="none">
      <LaneGlyph turns={['T']} color={SIDEWALK_MARK} width={1.6} />
    </g>
  ));
}

/** The bike box: green across the approach lanes (and bike lane) from the stop bar up to the cyclists' stop line. */
function BikeBox({ g }) {
  const { cs } = g;
  if (!g.bikeBox) return null;
  const x0 = cs.inbound[0].x0;
  const x1 = cs.bikeIn ? cs.bikeIn[1] : cs.curbIn;
  const lanes = cs.inbound.length > 2 ? cs.inbound.filter((_, i) => i % 2 === 0) : cs.inbound;
  return (
    <g pointerEvents="none">
      <Rect x0={x0} x1={x1} y0={g.bikeStop} y1={g.S} fill={BOX_GREEN} />
      {/* The cyclists' stop line, across the front of the box */}
      <Rect x0={x0} x1={x1} y0={g.bikeStop} y1={g.bikeStop + 1} fill={COLORS.marking} />
      {lanes.map((item) => (
        <g key={item.lane.id} transform={`translate(${item.cx} ${(g.bikeStop + g.S) / 2 + 0.6}) scale(${Math.min(1, (g.S - g.bikeStop) / 9)})`}>
          <BikeGlyph width={0.5} />
        </g>
      ))}
    </g>
  );
}

function LegMarkings({ g, selection, onSelect, byTechnology, breaks }) {
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
      {leg.bikeArrows && <BikeLaneArrows g={g} />}
      {leg.sidewalkArrows && leg.sidewalkArrows !== 'none' && <SidewalkArrows g={g} mode={leg.sidewalkArrows} />}
      <BikeBox g={g} />

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
          <DetectorShape key={item.det.id} g={g} item={item} byTechnology={byTechnology}
            fill={color} fillOpacity="0.32" stroke={selected ? COLORS.select : color} strokeWidth={selected ? 1.2 : 0.6}
            style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onSelect({ type: 'detector', legId: g.id, detId: item.det.id }); }}>
            <title>{`Channel ${item.det.channel} · ${item.det.purpose} · ${item.det.technology.replace('_', ' ')} · ${item.det.setback} ft back, ${item.det.length} ft long`}</title>
          </DetectorShape>
        );
      })}

      {/* Break line where far detectors are drawn compressed; a plan convention, not pavement */}
      {breaks && g.breakAt && (
        <g data-3d="skip">
          <Rect x0={cs.sidewalkOut[0] - 2} x1={cs.sidewalkIn[1] + 2} y0={g.breakAt} y1={g.breakAt + 3} fill={COLORS.land} />
          <line x1={cs.sidewalkOut[0] - 2} x2={cs.sidewalkIn[1] + 2} y1={g.breakAt} y2={g.breakAt} stroke={COLORS.curb} strokeWidth="0.4" />
          <line x1={cs.sidewalkOut[0] - 2} x2={cs.sidewalkIn[1] + 2} y1={g.breakAt + 3} y2={g.breakAt + 3} stroke={COLORS.curb} strokeWidth="0.4" />
        </g>
      )}
    </g>
  );
}

/** A regulatory speed limit sign (R2-1): black on white, the limit large. */
export function SpeedSign({ sign }) {
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

/** Each detector's channel number, over the detector. */
export function ChannelLabels({ geom }) {
  return (
    <g pointerEvents="none">
      {geom.legs.map((g) => g.detectors.map((item) => (
        <text key={`dl${item.det.id}`} x={item.center.x} y={item.center.y} fontSize="4.2" fontWeight="700" textAnchor="middle"
          dominantBaseline="central" fill="#fff" stroke="#1d2126" strokeWidth="0.9" paintOrder="stroke" pointerEvents="none">
          {item.det.channel}
        </text>
      )))}
    </g>
  );
}

export default function PlanArt({ geom, selection = null, onSelect = noop, byTechnology = false, breaks = true }) {
  const slips = geom.legs.filter((g) => g.slip).map((g) => ({ g, slip: g.slip }));
  return (
    <g className="plan-art">
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
        <LegMarkings g={g} selection={selection && selection.legId === g.id ? selection : null} onSelect={onSelect} byTechnology={byTechnology} breaks={breaks} />
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
    </g>
  );
}
