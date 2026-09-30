/**
 * Export formats other than GTSS: the design file and the detector list.
 *
 * The design file is Intersection Mix's own format: everything in the
 * design, including what GTSS has no field for (lane widths and order,
 * free-right size and receiving, medians, bike lanes). It opens again with
 * the Open button.
 *
 * Framework free.
 */

import { csvLine } from './gtss.js';
import { normalizeDesign, laneIndex, detectorPhase, legLabel, findLane } from './model.js';
import { bearingToTravel } from './gtss.js';

export const DESIGN_FORMAT = 'intersection-mix';
export const DESIGN_FILE_VERSION = 1;

export function designFile(design, now = new Date()) {
  const { notes, ...rest } = design;
  return `${JSON.stringify({ format: DESIGN_FORMAT, version: DESIGN_FILE_VERSION, exported: now.toISOString(), design: rest }, null, 2)}\n`;
}

/** Reads a design file (or a bare design object); throws on anything else. */
export function parseDesignFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (data && data.format && data.format !== DESIGN_FORMAT) throw new Error(`That file is a "${data.format}" file, not an Intersection Mix design.`);
  return normalizeDesign(data && data.design ? data.design : data);
}

/** Every detector, one row each, for a spreadsheet or a cabinet print. */
export function detectorCsv(design) {
  const headers = [
    'channel', 'approach_id', 'street', 'direction', 'lane', 'lane_movements', 'phase',
    'purpose', 'setback_ft', 'length_ft', 'mode', 'technology', 'vehicle_type', 'description',
  ];
  const rows = [];
  for (const leg of design.legs) {
    for (const det of leg.detectors) {
      const index = det.laneId ? laneIndex(leg, det.laneId) : -1;
      const lane = det.laneId ? findLane(leg, det.laneId) : null;
      rows.push([
        det.channel, leg.approachId, leg.street, bearingToTravel(leg.bearing) || '',
        index >= 0 ? index + 1 : det.laneNumber || 'all', lane ? lane.turns.join('') : '',
        detectorPhase(leg, det), det.purpose, det.setback, det.length, det.mode, det.technology,
        det.vehicleType, det.description,
      ]);
    }
  }
  rows.sort((a, b) => (Number(a[0]) || 0) - (Number(b[0]) || 0) || String(a[0]).localeCompare(String(b[0])));
  return `${[headers, ...rows].map(csvLine).join('\n')}\n`;
}

/** "Main Street & Oak Avenue — 4 approaches" style title for sheets. */
export function sheetTitle(design) {
  return `${design.name} · ${design.legs.map(legLabel).join(', ')}`;
}
