import { loopCircles } from '../lib/itsLayout.js';

/** Shared patterns for detector shapes; rendered once in the plan's <defs>. */
export function DetectorDefs() {
  return (
    <pattern id="det-hatch" patternUnits="userSpaceOnUse" width="2.6" height="2.6" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="2.6" stroke="#ffffff" strokeWidth="0.7" strokeOpacity="0.85" />
    </pattern>
  );
}

function Rect({ x0, x1, y0, y1, ...rest }) {
  return <rect x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} {...rest} />;
}

const RADAR = new Set(['radar', 'microwave', 'lidar']);

/**
 * One detector, in its leg's local frame. With `byTechnology` off (the
 * regular view) every detector is its zone rectangle. With it on:
 * inductive loops are 6 ft round loops along their length, video keeps the
 * zone, radar / microwave / lidar are a hatched zone with a dashed edge,
 * magnetometers a row of pucks, and hybrids the zone with loops.
 */
export default function DetectorShape({
  g, item, byTechnology, fill, fillOpacity, stroke, strokeWidth, children, ...events
}) {
  const tech = byTechnology ? item.det.technology : 'zone';
  const rect = { x0: item.x0, x1: item.x1, y0: item.y0, y1: item.y1 };
  const paint = { fill, fillOpacity, stroke, strokeWidth };

  if (tech === 'inductive_loop' || tech === 'hybrid') {
    const circles = loopCircles(g, item);
    return (
      <g {...events}>
        {tech === 'hybrid'
          ? <Rect {...rect} {...paint} fillOpacity={Number(fillOpacity) * 0.6} />
          : <Rect {...rect} fill="transparent" />}
        {circles.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={c.r} fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={Math.max(0.5, strokeWidth)} />
        ))}
        {children}
      </g>
    );
  }
  if (tech === 'magnetometer') {
    const lanes = item.det.laneId ? g.cs.inbound.filter((l) => l.lane.id === item.det.laneId) : g.cs.inbound;
    const n = Math.max(1, Math.round((Number(item.det.length) || 6) / 10));
    const drawn = item.y1 - item.y0;
    return (
      <g {...events}>
        <Rect {...rect} fill="transparent" stroke={stroke} strokeWidth={strokeWidth * 0.6} strokeDasharray="1 1.5" />
        {lanes.flatMap((lane) => Array.from({ length: n }, (_, i) => (
          <rect key={`${lane.lane.id}${i}`} x={lane.cx - 0.8} y={item.y0 + (drawn * (i + 0.5)) / n - 0.8} width="1.6" height="1.6" rx="0.4"
            fill={fill} fillOpacity={Math.max(0.8, Number(fillOpacity))} stroke={stroke} strokeWidth="0.3" />
        )))}
        {children}
      </g>
    );
  }
  if (RADAR.has(tech)) {
    return (
      <g {...events}>
        <Rect {...rect} {...paint} strokeDasharray="2 1.2" />
        <Rect {...rect} fill="url(#det-hatch)" />
        {children}
      </g>
    );
  }
  return <Rect {...rect} {...paint} {...events}>{children}</Rect>;
}
