import { useMemo } from 'react';
import { pt } from '../lib/geometry.js';
import { viewCone } from '../lib/cameras.js';
import { equipmentLayout } from '../lib/itsLayout.js';

export const EQUIPMENT_COLORS = {
  pole: '#495057',
  cabinet: '#6f8f72',
  cctv: '#1c7ed6',
  detection: '#7048e8',
  preemptIr: '#e03131',
  preemptVideo: '#f08c00',
  cloud: '#0b7285',
};

const rad = (d) => (d * Math.PI) / 180;
const toward = (p, heading, dist) => ({ x: p.x + Math.sin(rad(heading)) * dist, y: p.y - Math.cos(rad(heading)) * dist });

/** A camera body pointing up (north) before rotation, about 3 ft long. */
function CameraGlyph({ point, heading, color, s = 1 }) {
  return (
    <g transform={`translate(${point.x} ${point.y}) rotate(${heading}) scale(${s})`}>
      <rect x="-1.1" y="-1.6" width="2.2" height="3.2" rx="0.5" fill={color} stroke="#fff" strokeWidth="0.45" />
      <path d="M-0.8 -1.6 L-1.4 -3 L1.4 -3 L0.8 -1.6 Z" fill={color} stroke="#fff" strokeWidth="0.35" />
    </g>
  );
}

function Cloud({ point, s = 1 }) {
  return (
    <g transform={`translate(${point.x} ${point.y}) scale(${s})`}>
      <path d="M-2.6 1.2 A1.4 1.4 0 0 1 -2 -1.2 A1.9 1.9 0 0 1 1.4 -1.6 A1.5 1.5 0 0 1 2.8 1.2 Z"
        fill="#e3fafc" stroke={EQUIPMENT_COLORS.cloud} strokeWidth="0.5" />
    </g>
  );
}

function Label({ at, children, color }) {
  return (
    <text x={at.x} y={at.y} fontSize="3.6" fontWeight="700" textAnchor="middle" dominantBaseline="central" fill={color}
      stroke="#fff" strokeWidth="1" paintOrder="stroke">{children}</text>
  );
}

/**
 * The field equipment on the plan: mast-arm poles and arms, the cabinet on
 * its corner, CCTV cameras with what they see, video detection cameras on
 * the arms looking up their approach, and preemption detectors. Drawn on
 * the plan (and its exports), not into the 3D texture: 3D models them.
 */
export default function EquipmentLayer({ design, geom, k = 1 }) {
  const layout = useMemo(() => equipmentLayout(design, geom), [design, geom]);
  const s = Math.max(1, Math.min(2.2, k * 0.9)); // glyphs stay legible when zoomed out
  const { cabinet } = layout;

  return (
    <g data-3d="skip" pointerEvents="none" className="equipment-layer">
      {/* Mast arms and poles */}
      {layout.poles.map((p) => (
        <g key={p.legId}>
          <line x1={p.point.x} y1={p.point.y} x2={p.armEnd.x} y2={p.armEnd.y} stroke={EQUIPMENT_COLORS.pole} strokeWidth="0.9" strokeLinecap="round" />
          <circle cx={p.point.x} cy={p.point.y} r="1.4" fill={EQUIPMENT_COLORS.pole} stroke="#fff" strokeWidth="0.5" />
        </g>
      ))}

      {/* Preemption detection */}
      {layout.preempt.map((p) => (
        <g key={`pre${p.legId}`}>
          {p.type === 'ir' && (
            <>
              <line x1={p.point.x} y1={p.point.y} x2={p.reach.x} y2={p.reach.y} stroke={EQUIPMENT_COLORS.preemptIr}
                strokeWidth="0.6" strokeDasharray="3 2" opacity="0.7" />
              <g transform={`translate(${p.point.x} ${p.point.y}) rotate(${p.heading}) scale(${s})`}>
                <polygon points="0,-2 1.4,0 0,2 -1.4,0" fill={EQUIPMENT_COLORS.preemptIr} stroke="#fff" strokeWidth="0.45" />
              </g>
            </>
          )}
          {p.type === 'video' && <CameraGlyph point={p.point} heading={p.heading} color={EQUIPMENT_COLORS.preemptVideo} s={s} />}
          {p.type === 'cloud' && <Cloud point={p.point} s={s * 0.8} />}
        </g>
      ))}

      {/* Video detection cameras */}
      {layout.detectionCams.map((c) => (
        <g key={c.cam.id}>
          <polygon points={[c.point, toward(c.point, c.heading - 14, 95), toward(c.point, c.heading + 14, 95)].map(pt).join(' ')}
            fill={EQUIPMENT_COLORS.detection} fillOpacity="0.07" stroke={EQUIPMENT_COLORS.detection} strokeOpacity="0.35" strokeWidth="0.4" />
          <CameraGlyph point={c.point} heading={c.heading} color={EQUIPMENT_COLORS.detection} s={s} />
        </g>
      ))}

      {/* CCTV */}
      {layout.cctv.map((c) => (
        <g key={c.cctv.id}>
          <polygon points={viewCone(c.pin, 70).map(pt).join(' ')} fill={EQUIPMENT_COLORS.cctv} fillOpacity="0.1"
            stroke={EQUIPMENT_COLORS.cctv} strokeWidth="0.6" strokeDasharray="2 1.5" />
          <circle cx={c.point.x} cy={c.point.y} r={1.9 * s} fill="#fff" stroke={EQUIPMENT_COLORS.cctv} strokeWidth="0.6" />
          <circle cx={c.point.x} cy={c.point.y} r={1.1 * s} fill={EQUIPMENT_COLORS.cctv} />
          <Label at={toward(c.point, c.pin.heading + 180, 5 * s)} color={EQUIPMENT_COLORS.cctv}>{c.cctv.name}</Label>
        </g>
      ))}

      {/* Cabinet */}
      {cabinet && (
        <g>
          <g transform={`translate(${cabinet.point.x} ${cabinet.point.y}) rotate(${cabinet.heading})`}>
            <rect x={-Math.max(3, cabinet.spec.w * 1.2) / 2} y={-Math.max(2.2, cabinet.spec.d * 1.2) / 2}
              width={Math.max(3, cabinet.spec.w * 1.2)} height={Math.max(2.2, cabinet.spec.d * 1.2)} rx="0.4"
              fill={EQUIPMENT_COLORS.cabinet} stroke="#2b3a2c" strokeWidth="0.5" />
          </g>
          {layout.cloud && <Cloud point={toward(cabinet.point, cabinet.heading + 90, 4.5)} s={s * 0.7} />}
          <Label at={toward(cabinet.point, cabinet.heading + 180, 4.5)} color="#2b3a2c">{cabinet.type}</Label>
        </g>
      )}
    </g>
  );
}
