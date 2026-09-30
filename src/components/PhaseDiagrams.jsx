import { useMemo } from 'react';
import { COLORS, phaseColor } from '../palette.js';
import { pt, phaseMovements, phaseCrossings } from '../lib/geometry.js';
import { usedPhases, isOverlap } from '../lib/model.js';
import { bearingToTravel } from '../lib/gtss.js';

const RING_1 = ['1', '2', '3', '4'];
const RING_2 = ['5', '6', '7', '8'];

function Diagram({ design, geom, phase, selected, onPick }) {
  const moves = useMemo(() => phaseMovements(design, geom, phase), [design, geom, phase]);
  const crossings = useMemo(() => phaseCrossings(design, geom, phase), [design, geom, phase]);
  const color = phaseColor(phase);
  const empty = !moves.length && !crossings.length;

  // Tighter than the plan view: the middle and the first stretch of each leg.
  const reach = Math.max(...geom.legs.map((g) => g.S)) + 45;
  const box = `${-reach} ${-reach} ${reach * 2} ${reach * 2}`;
  const markerId = `pd-${String(phase).replace(/[^a-z0-9]/gi, '')}`;

  const summary = useMemo(() => {
    const byLeg = new Map();
    for (const m of moves) {
      const g = geom.byId.get(m.legId);
      const label = bearingToTravel(g.leg.bearing) || g.leg.approachId;
      if (!byLeg.has(label)) byLeg.set(label, []);
      byLeg.get(label).push(m.permissive ? `${m.turn}*` : m.turn);
    }
    const parts = [...byLeg.entries()].map(([label, turns]) => `${label} ${[...new Set(turns)].join('')}`);
    if (crossings.length) parts.push(`ped ×${crossings.length}`);
    return parts.join(' · ');
  }, [moves, crossings, geom]);

  return (
    <button type="button" className={`phase-cell${selected ? ' selected' : ''}${empty ? ' empty' : ''}`}
      onClick={() => onPick(selected ? null : phase)} aria-pressed={selected}
      title={empty ? `Phase ${phase} serves nothing` : `Phase ${phase}: ${summary}`}>
      <span className="phase-name" style={{ color: empty ? undefined : color }}>
        Ø{phase}{isOverlap(design, phase) ? ' (overlap)' : ''}
      </span>
      <svg viewBox={box} aria-hidden="true">
        <defs>
          <marker id={markerId} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={color} />
          </marker>
        </defs>
        <polygon points={geom.asphaltCore.map(pt).join(' ')} fill="#c9ccd1" />
        {geom.legs.map((g) => (
          <g key={g.id} transform={g.matrix}>
            <rect x={g.cs.curbOut} y={0} width={g.cs.curbIn - g.cs.curbOut} height={reach * 1.5} fill="#c9ccd1" />
          </g>
        ))}
        {geom.fillets.map((d, i) => <path key={i} d={d} fill="#c9ccd1" />)}
        {geom.legs.filter((g) => g.slip).map((g) => (
          <g key={`slip${g.id}`} fill="#c9ccd1">
            <polygon points={g.slip.asphalt.map(pt).join(' ')} />
            <polygon points={g.slip.taper.asphalt.map(pt).join(' ')} />
            <polygon points={g.slip.receiving.asphalt.map(pt).join(' ')} />
          </g>
        ))}
        {moves.map((m, i) => (
          <path key={i} d={m.d} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={m.permissive ? '9 6' : undefined} markerEnd={`url(#${markerId})`} />
        ))}
        {crossings.map((c, i) => (
          <path key={`c${i}`} d={c.d} fill="none" stroke={COLORS.text} strokeWidth="3.2" strokeDasharray="2 4" strokeLinecap="round" />
        ))}
      </svg>
      <span className="phase-summary">{empty ? '—' : summary}</span>
    </button>
  );
}

/**
 * One small diagram per phase, laid out as the ring-and-barrier: ring 1 over
 * ring 2, the barrier between 2|3 and 6|7. Phases outside 1-8 and overlaps
 * follow on their own row.
 */
export default function PhaseDiagrams({ design, geom, phase, onPick }) {
  const used = usedPhases(design);
  const nema = used.some((p) => RING_1.includes(p) || RING_2.includes(p));
  const others = used.filter((p) => !RING_1.includes(p) && !RING_2.includes(p));
  const cell = (p) => <Diagram key={p} design={design} geom={geom} phase={p} selected={phase === p} onPick={onPick} />;

  return (
    <section className="panel phases">
      <div className="section-head">
        <h2>Phases</h2>
        <span className="muted small">Click a phase to show it on the drawing. Dashed arrows are permissive; * marks them in the summary.</span>
      </div>
      {!used.length && <p className="muted">No phases assigned yet. Try “Auto-assign NEMA phases”.</p>}
      {nema && (
        <div className="ring-grid">
          <span className="ring-label">Ring 1</span>
          {RING_1.slice(0, 2).map(cell)}
          <span className="barrier" aria-hidden="true" />
          {RING_1.slice(2).map(cell)}
          <span className="ring-label">Ring 2</span>
          {RING_2.slice(0, 2).map(cell)}
          <span className="barrier" aria-hidden="true" />
          {RING_2.slice(2).map(cell)}
        </div>
      )}
      {others.length > 0 && (
        <div className="other-phases">
          <span className="ring-label">{nema ? 'Other' : 'Phases'}</span>
          {others.map(cell)}
        </div>
      )}
    </section>
  );
}
