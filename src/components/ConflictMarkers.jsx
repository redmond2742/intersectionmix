import { CONFLICT_TYPES } from '../lib/conflicts.js';

export const CONFLICT_COLORS = { vehicle: '#c92a2a', ped: '#1971c2' };

/** One conflict point, drawn as in the FHWA diagrams: filled, half-filled or open. */
export function ConflictMarker({ type, x, y, r }) {
  const red = CONFLICT_COLORS.vehicle;
  const sw = r * 0.32;
  if (type === 'diverge') return <circle cx={x} cy={y} r={r} fill={red} stroke={red} strokeWidth={sw} />;
  if (type === 'merge') {
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill="#fff" stroke={red} strokeWidth={sw} />
        <path d={`M${x} ${y - r} A${r} ${r} 0 0 0 ${x} ${y + r} Z`} fill={red} />
      </g>
    );
  }
  if (type === 'cross') return <circle cx={x} cy={y} r={r} fill="#fff" stroke={red} strokeWidth={sw} />;
  const s = r * 1.15;
  return <polygon points={`${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`} fill="#d0ebff" stroke={CONFLICT_COLORS.ped} strokeWidth={sw} />;
}

/** Movement paths (thin) and crosswalks (dashed) under the markers. */
export function ConflictPaths({ result, width = 1, opacity = 0.75 }) {
  return (
    <g fill="none" strokeLinecap="round" opacity={opacity}>
      {result.vehicles.map((m) => (
        <polyline key={m.id} points={m.points.map((p) => `${p.x},${p.y}`).join(' ')} stroke="#343a40" strokeWidth={width} />
      ))}
      {result.peds.map((p) => (
        <line key={p.id} x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} stroke={CONFLICT_COLORS.ped} strokeWidth={width * 1.4} strokeDasharray={`${width * 2} ${width * 2}`} />
      ))}
    </g>
  );
}

export function ConflictLegend() {
  return (
    <div className="conflict-legend">
      {Object.entries(CONFLICT_TYPES).map(([type, label]) => (
        <span key={type}>
          <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true"><ConflictMarker type={type} x={0} y={0} r={5} /></svg>
          {label}
        </span>
      ))}
    </div>
  );
}
