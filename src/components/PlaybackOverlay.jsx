import { useMemo, useSyncExternalStore } from 'react';
import LaneGlyph from './LaneGlyph.jsx';
import DetectorShape from './DetectorShape.jsx';
import { detectorColor } from '../palette.js';
import { movementPath } from '../lib/geometry.js';
import { legTurns, TURNS } from '../lib/model.js';
import { movementSignal } from '../lib/hires.js';
import { priorityApproaches } from '../lib/its.js';

/** Lamp colours. "permissive" is the flashing yellow arrow: go, but yield. */
export const LAMP = {
  green: '#2fb344',
  yellow: '#f2c230',
  red: '#e03131',
  permissive: '#f2c230',
  unknown: '#868e96',
};
const WALK = '#40c057';
const FDW = '#f76707';

function Rect({ x0, x1, y0, y1, ...rest }) {
  return <rect x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} {...rest} />;
}

const NO_SNAPSHOT = () => null;
const noSubscribe = () => () => {};

/**
 * Signal playback drawn over the plan: every lane's stop bar and signal face
 * in the colour its movement shows, the movements that may go, walk and
 * flashing don't walk on the crosswalks, and occupied detectors lit up.
 * The snapshot comes from a small store, so only this layer redraws as the
 * playback moves, not the whole plan.
 */
export default function PlaybackOverlay({ design, geom, store, k, byTechnology }) {
  const snap = useSyncExternalStore(store ? store.subscribe : noSubscribe, store ? store.get : NO_SNAPSHOT);

  // Every lane's path for every turn, worked out once per design.
  const paths = useMemo(() => {
    const out = [];
    for (const g of geom.legs) {
      for (const turn of legTurns(g.leg)) {
        const lanes = g.cs.inbound.filter((item) => item.lane.turns.includes(turn));
        lanes.forEach((item, rank) => {
          const d = movementPath(geom, g.id, turn, item, rank, lanes.length);
          if (d) out.push({ legId: g.id, turn, d });
        });
        if (turn === 'R' && g.slip && g.slip.path) out.push({ legId: g.id, turn, d: g.slip.path });
      }
    }
    return out;
  }, [geom]);

  if (!snap) return null;
  const legOf = new Map(geom.legs.map((g) => [g.id, g.leg]));
  const priority = priorityApproaches(design, snap);
  const signal = (leg, turn) => movementSignal(design, leg, turn, snap);
  const going = paths
    .map((p) => ({ ...p, state: signal(legOf.get(p.legId), p.turn) }))
    .filter((p) => p.state === 'green' || p.state === 'permissive' || p.state === 'yellow');

  return (
    <g pointerEvents="none" data-export="skip" data-3d="skip" className="playback-layer">
      <defs>
        {Object.entries({ green: LAMP.green, yellow: LAMP.yellow }).map(([name, color]) => (
          <marker key={name} id={`pb-${name}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={color} />
          </marker>
        ))}
      </defs>

      {/* Movements that may go now */}
      {going.map((p, i) => {
        const color = p.state === 'yellow' ? LAMP.yellow : LAMP.green;
        const dash = p.state === 'permissive' ? `${4 * k} ${3 * k}` : undefined;
        return (
          <g key={i} opacity="0.9">
            <path d={p.d} fill="none" stroke="#fff" strokeWidth={3.2 * k} strokeLinecap="round" strokeDasharray={dash} opacity="0.8" />
            <path d={p.d} fill="none" stroke={color} strokeWidth={1.9 * k} strokeLinecap="round" strokeDasharray={dash}
              markerEnd={`url(#pb-${p.state === 'yellow' ? 'yellow' : 'green'})`} />
          </g>
        );
      })}

      {geom.legs.map((g) => {
        const { cs, leg } = g;
        const cw = leg.crosswalk;
        const ped = cw.enabled && cw.pedPhase ? snap.peds[String(cw.pedPhase)] : null;
        const pushed = cw.enabled && cw.pedPhase && snap.buttons.has(String(cw.pedPhase));
        const request = priority[g.id];
        return (
          <g key={g.id} transform={g.matrix}>
            {/* A preempt or priority request running on this approach */}
            {request && g.cs.inbound.length > 0 && (
              <>
                <Rect x0={g.cs.inbound[0].x0} x1={g.cs.curbIn} y0={g.S} y1={g.L}
                  fill={request.kind === 'preempt' ? '#e03131' : '#1c7ed6'} fillOpacity="0.3" className="pb-pulse" />
                <text x={(g.cs.inbound[0].x0 + g.cs.curbIn) / 2} y={g.S + 26} textAnchor="middle" fontSize="9" fontWeight="800"
                  fill="#fff" stroke="#1d2126" strokeWidth="2.4" paintOrder="stroke" transform={`rotate(180 ${(g.cs.inbound[0].x0 + g.cs.curbIn) / 2} ${g.S + 26})`}>
                  {request.kind === 'preempt' ? `PREEMPT ${request.number}` : `PRIORITY ${request.number}`}
                </text>
              </>
            )}
            {/* Crosswalk: walk, or flashing don't walk */}
            {(ped === 'walk' || ped === 'fdw') && (
              <Rect x0={cs.curbOut} x1={cs.curbIn} y0={g.cwStart} y1={g.cwEnd}
                fill={ped === 'walk' ? WALK : FDW} fillOpacity="0.55" stroke="#fff" strokeWidth="0.7"
                className={ped === 'fdw' ? 'pb-blink' : undefined} />
            )}
            {pushed && [cs.curbOut - 2.2, cs.curbIn + 2.2].map((x) => (
              <circle key={x} cx={x} cy={(g.cwStart + g.cwEnd) / 2} r="1.6" fill="#1c7ed6" stroke="#fff" strokeWidth="0.6" />
            ))}

            {/* Occupied detectors */}
            {g.detectors.filter((item) => snap.detectors.has(String(item.det.channel))).map((item) => (
              <DetectorShape key={item.det.id} g={g} item={item} byTechnology={byTechnology}
                fill={detectorColor(item.det.purpose)} fillOpacity="0.95" stroke="#fff" strokeWidth="0.8" />
            ))}

            {/* Each lane's stop bar and signal face, one lamp per turn */}
            {cs.inbound.map((item) => {
              const turns = TURNS.filter((t) => item.lane.turns.includes(t));
              if (!turns.length) return null;
              const width = item.x1 - item.x0;
              const lamp = 3.4;
              const face = turns.length * lamp + 0.8;
              return (
                <g key={item.lane.id}>
                  {turns.map((turn, i) => {
                    const state = signal(leg, turn);
                    const x0 = item.x0 + (width * i) / turns.length;
                    return (
                      <Rect key={turn} x0={x0 + 0.15} x1={x0 + width / turns.length - 0.15} y0={g.S - 0.2} y1={g.S + 2}
                        fill={LAMP[state]} className={state === 'permissive' ? 'pb-blink' : undefined} />
                    );
                  })}
                  <rect x={item.cx - face / 2} y={g.S - lamp - 0.9} width={face} height={lamp + 0.6} rx="1" fill="#1d2126" />
                  {turns.map((turn, i) => {
                    const state = signal(leg, turn);
                    const cx = item.cx - face / 2 + 0.4 + lamp * (i + 0.5);
                    const cy = g.S - 0.6 - lamp / 2; // between the crosswalk and the stop bar, clear of the loops
                    return (
                      <g key={turn} className={state === 'permissive' ? 'pb-blink' : undefined}>
                        <circle cx={cx} cy={cy} r={lamp / 2 - 0.25} fill={LAMP[state]} />
                        {turn !== 'T' && (
                          <g transform={`translate(${cx} ${cy + 0.3}) scale(0.2)`}><LaneGlyph turns={[turn]} color="#1d2126" width={1.6} /></g>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}
