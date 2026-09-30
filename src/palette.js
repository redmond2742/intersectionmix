/** Drawing colours. The plan view keeps its own palette in dark mode, like a map. */
export const COLORS = {
  land: '#e8ebdd',
  sidewalk: '#d8d4cb',
  curb: '#b9b4a8',
  asphalt: '#4f535a',
  marking: '#f7f7f2',
  yellow: '#f2c230',
  bike: '#4f9a68',
  median: '#a6bf8a',
  island: '#cdc8bd',
  select: '#ff3d7f',
  text: '#23262b',
};

export const DETECTOR_COLORS = {
  'stop bar': '#1fb6cc',
  advanced: '#f59f00',
  count: '#9775fa',
};

export function detectorColor(purpose) {
  return DETECTOR_COLORS[String(purpose || '').toLowerCase()] || '#adb5bd';
}

const PHASE_COLORS = {
  1: '#e8590c',
  2: '#1c7ed6',
  3: '#ae3ec9',
  4: '#2f9e44',
  5: '#f08c00',
  6: '#0c8599',
  7: '#d6336c',
  8: '#5c940d',
};

/** A stable colour per phase: NEMA 1-8 fixed, anything else hashed. */
export function phaseColor(phase) {
  if (!phase) return '#868e96';
  if (PHASE_COLORS[phase]) return PHASE_COLORS[phase];
  let hash = 0;
  for (const ch of String(phase)) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash}, 55%, 45%)`;
}
