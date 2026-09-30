/**
 * A pavement arrow for a lane's turns, drawn pointing up (-y), about 14 units
 * tall and centred on the origin. The plan view places it in feet; the
 * cross-section strip scales it into a tile.
 */
export default function LaneGlyph({ turns, color = '#f7f7f2', width = 1.1 }) {
  const has = (t) => turns.includes(t);
  if (!turns.length) {
    return <circle r="1.4" fill="none" stroke={color} strokeWidth={width} />;
  }
  const stroke = { fill: 'none', stroke: color, strokeWidth: width, strokeLinecap: 'butt', strokeLinejoin: 'round' };
  return (
    <g>
      <path d="M0 6.5 L0 1" {...stroke} />
      {has('T') && (
        <>
          <path d="M0 1.2 L0 -3.6" {...stroke} />
          <polygon points="-2,-3.5 0,-7.5 2,-3.5" fill={color} />
        </>
      )}
      {has('L') && (
        <>
          <path d="M0 1.2 Q0 -2.2 -3.3 -2.2" {...stroke} />
          <polygon points="-3.2,-4.1 -6.7,-2.2 -3.2,-0.3" fill={color} />
        </>
      )}
      {has('R') && (
        <>
          <path d="M0 1.2 Q0 -2.2 3.3 -2.2" {...stroke} />
          <polygon points="3.2,-4.1 6.7,-2.2 3.2,-0.3" fill={color} />
        </>
      )}
      {has('U') && (
        <>
          <path d="M0 1.2 L0 -1.2 Q0 -5 -2.4 -5 Q-4.8 -5 -4.8 -1.6" {...stroke} />
          <polygon points="-6.7,-1.6 -4.8,1.9 -2.9,-1.6" fill={color} />
        </>
      )}
    </g>
  );
}
