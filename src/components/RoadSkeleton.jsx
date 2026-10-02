import { pt } from '../lib/geometry.js';

/** The road surface alone, in one flat colour: the base of the small phase and conflict diagrams. */
export default function RoadSkeleton({ geom, length, fill = '#c9ccd1' }) {
  return (
    <g fill={fill}>
      <polygon points={geom.asphaltCore.map(pt).join(' ')} />
      {geom.legs.map((g) => (
        <g key={g.id} transform={g.matrix}>
          <rect x={g.cs.curbOut} y={0} width={g.cs.curbIn - g.cs.curbOut} height={length} />
        </g>
      ))}
      {geom.fillets.map((d, i) => <path key={i} d={d} />)}
      {geom.legs.filter((g) => g.slip).map((g) => (
        <g key={`slip${g.id}`}>
          <polygon points={g.slip.asphalt.map(pt).join(' ')} />
          <polygon points={g.slip.taper.asphalt.map(pt).join(' ')} />
          <polygon points={g.slip.receiving.asphalt.map(pt).join(' ')} />
        </g>
      ))}
    </g>
  );
}
