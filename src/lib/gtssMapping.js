/**
 * GTSS feed <-> Intersection Mix design.
 *
 * Import is literal about what a feed does not say. phases.txt gives, for
 * each phase and approach, a movement type and a lane count; it does not give
 * lane order, receiving lanes or lane widths. Lanes are laid out in the order
 * they almost always sit (U, left, left-through, through, through-right,
 * right, inside to outside), receiving lanes are drawn to match the traffic
 * entering each leg, and both are said so in the design's notes. A leg with
 * no right-turn row gets no right-turn arrow: absent is not the same as
 * "shared with the through lane", and guessing would be exported back as fact.
 *
 * Export rewrites only this signal's rows. Every other signal's rows, and
 * every file this tool does not model (basic_timings.txt, preempt.txt, ...),
 * are written back byte for byte, so an agency feed can be edited one
 * intersection at a time. Columns the model does not use ride along on each
 * row, and a spec column the source file lacks is added only when the design
 * has something to put in it.
 *
 * pedX (phases.txt) places a phase's crosswalk relative to the phase's own
 * approach: 1 crosses that approach's leg, 3 the leg opposite, 2 both, 4-6
 * are diagonals and 7 is every crosswalk.
 *
 * Framework free.
 */

import { readTable, csvLine, pick, rowSignal, crossStreetName, compareIds } from './gtss.js';
import {
  emptyDesign, makeLeg, makeLane, makeOutbound, makeDetector, normBearing, legLabel, legTurns,
  oppositeLeg, turnTargets, turnsKey, crossSectionSig, crosswalkLengthFt, detectorPhase,
  laneIndex, isOverlap, openBearing, LEFT_TREATMENTS, TURN_LABELS,
} from './model.js';

export const SPEC_HEADERS = {
  'agency.txt': ['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_email'],
  'signals.txt': ['signal_id', 'agency_id', 'latitude', 'longitude'],
  'approaches.txt': ['approach_id', 'signal_id', 'street_name', 'compass_bearing', 'posted_speed', 'free_right'],
  'phases.txt': ['phase', 'approach_id', 'signal_id', 'movement_type', 'num_of_lanes', 'ped_phase_enabled', 'is_overlap', 'pedX', 'crosswalk_length'],
  'detectors.txt': ['channel', 'signal_id', 'phase', 'description', 'purpose', 'vehicle_type', 'lane', 'technology_type', 'mode', 'length', 'stopbar_setback_dist'],
};

const SIGNAL_COLUMNS = new Set(['signal_id', 'signalid']);
const TREATMENT_BY_TYPE = { L: 'protected', TL: 'permissive', LPP: 'pp', FYA: 'fya' };
const LANE_ORDER = ['U', 'L', 'LT', 'T', 'TR', 'R'];
const TRUE = /^(true|1|yes|y)$/i;

const text = (value) => (value == null ? '' : String(value).trim());
const numberOr = (value, fallback) => {
  const n = Number(value);
  return text(value) !== '' && Number.isFinite(n) ? n : fallback;
};

/** Columns on a row that the spec does not define for this file. */
function extraColumns(row, file) {
  const known = new Set(SPEC_HEADERS[file].map((h) => h.toLowerCase()));
  const extra = {};
  for (const [key, value] of Object.entries(row || {})) {
    const lower = key.toLowerCase();
    if (known.has(lower) || SIGNAL_COLUMNS.has(lower)) continue;
    extra[key] = value;
  }
  return extra;
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

/** Every signal a feed describes, named from its streets. */
export function listSignals(files) {
  const f = files || {};
  const approaches = readTable(f['approaches.txt']).records.map((r) => r.row);
  const signals = readTable(f['signals.txt']).records.map((r) => r.row);
  const ids = new Set();
  const streets = new Map();
  for (const row of signals) if (rowSignal(row)) ids.add(rowSignal(row));
  for (const row of approaches) {
    const id = rowSignal(row);
    if (!id) continue;
    ids.add(id);
    if (!streets.has(id)) streets.set(id, []);
    streets.get(id).push(text(pick(row, 'street_name')));
  }
  return [...ids].sort(compareIds).map((id) => ({
    id,
    name: crossStreetName(streets.get(id)) || `Signal ${id}`,
    approaches: (streets.get(id) || []).length,
  }));
}

/**
 * Builds a design for one signal. Returns the design; what the feed left
 * unsaid is listed in design.notes.
 */
export function designFromGtss(files, signalId) {
  const f = files || {};
  const S = text(signalId);
  const notes = [];
  const note = (message) => {
    if (!notes.includes(message)) notes.push(message);
  };
  const rowsFor = (name) => readTable(f[name]).records.map((r) => r.row).filter((row) => rowSignal(row) === S);

  const approachRows = rowsFor('approaches.txt');
  const phaseRows = rowsFor('phases.txt');
  const detectorRows = rowsFor('detectors.txt');
  const signalRow = rowsFor('signals.txt')[0];

  const design = emptyDesign();
  design.source = { signalId: S };
  design.signal = {
    id: S,
    agencyId: text(pick(signalRow, 'agency_id')),
    lat: text(pick(signalRow, 'latitude')),
    lon: text(pick(signalRow, 'longitude')),
    extra: signalRow ? extraColumns(signalRow, 'signals.txt') : {},
  };
  if (!signalRow) note(`signals.txt has no row for signal ${S}.`);
  if (!approachRows.length) note(`approaches.txt has no approaches for signal ${S}.`);

  const legByApproach = new Map();
  for (const row of approachRows) {
    const approachId = text(pick(row, 'approach_id'));
    if (!approachId || legByApproach.has(approachId)) continue;
    const bearing = numberOr(pick(row, 'compass_bearing'), null);
    const leg = makeLeg({
      approachId,
      street: text(pick(row, 'street_name')),
      bearing: bearing == null ? 0 : normBearing(bearing),
      speed: numberOr(pick(row, 'posted_speed'), 30),
      outbound: [],
      extra: extraColumns(row, 'approaches.txt'),
    });
    if (bearing == null) note(`Approach ${approachId} has no compass bearing; it is drawn pointing north.`);
    leg.crosswalk.enabled = false;
    const free = /^(\d+)-FR(?:-(PI|P))?$/i.exec(text(pick(row, 'free_right')));
    if (free) leg.freeRight = { lanes: Number(free[1]), ped: (free[2] || '').toUpperCase() };
    legByApproach.set(approachId, leg);
    design.legs.push(leg);
  }

  const counts = new Map(); // leg -> Map(key -> lanes)
  const pedRecords = [];

  const setMove = (leg, turn, phase) => {
    const move = leg.movements[turn];
    if (!move.phase) move.phase = phase;
    else if (move.phase !== phase) {
      note(`${legLabel(leg)}: ${TURN_LABELS[turn].toLowerCase()} appears under phases ${move.phase} and ${phase}; phase ${move.phase} is kept.`);
    }
  };

  for (const row of phaseRows) {
    const approachId = text(pick(row, 'approach_id'));
    const phase = text(pick(row, 'phase'));
    const type = text(pick(row, 'movement_type')).toUpperCase();
    if (!approachId) {
      note(`A phases.txt row for phase ${phase || '?'} names no approach and was skipped.`);
      continue;
    }
    let leg = legByApproach.get(approachId);
    if (!leg) {
      leg = makeLeg({ approachId, street: '', bearing: openBearing(design), outbound: [] });
      leg.crosswalk.enabled = false;
      legByApproach.set(approachId, leg);
      design.legs.push(leg);
      note(`phases.txt names approach ${approachId}, which approaches.txt does not describe; its bearing is a guess.`);
    }
    if (TRUE.test(text(pick(row, 'is_overlap'))) && phase && !design.overlaps.includes(phase)) {
      design.overlaps.push(phase);
    }
    const extra = extraColumns(row, 'phases.txt');
    if (Object.keys(extra).length) design.phaseRowExtra[`${approachId}|${phase}|${type}`] = extra;

    let lanes = numberOr(pick(row, 'num_of_lanes'), null);
    if (lanes == null) {
      lanes = type === 'PED' ? 0 : 1;
      if (type !== 'PED') note(`${legLabel(leg)}: phase ${phase} (${type}) gives no lane count; one lane is drawn.`);
    }
    lanes = Math.max(0, Math.round(lanes));

    let key = null;
    if (TREATMENT_BY_TYPE[type]) {
      key = 'L';
      setMove(leg, 'L', phase);
      leg.movements.L.treatment = TREATMENT_BY_TYPE[type];
    } else if (type === 'T') {
      key = 'T';
      setMove(leg, 'T', phase);
    } else if (type === 'LT') {
      key = 'LT';
      setMove(leg, 'T', phase);
      if (!leg.movements.L.phase) leg.movements.L = { phase, treatment: 'permissive' };
    } else if (type === 'TR') {
      key = 'TR';
      setMove(leg, 'T', phase);
      setMove(leg, 'R', phase);
    } else if (type === 'R') {
      key = 'R';
      setMove(leg, 'R', phase);
    } else if (type === 'U') {
      key = 'U';
      setMove(leg, 'U', phase);
    } else if (type !== 'PED') {
      note(`${legLabel(leg)}: movement type "${type}" for phase ${phase} is not a GTSS movement type and was skipped.`);
    }
    if (key && lanes) {
      if (!counts.has(leg)) counts.set(leg, new Map());
      const byKey = counts.get(leg);
      byKey.set(key, (byKey.get(key) || 0) + lanes);
    }

    const pedField = text(pick(row, 'pedX'));
    let pedX = numberOr(pedField, null);
    if (pedX == null) pedX = TRUE.test(text(pick(row, 'ped_phase_enabled'))) || type === 'PED' ? 1 : 0;
    if (pedX > 0) pedRecords.push({ leg, phase, pedX, length: text(pick(row, 'crosswalk_length')) });
  }

  for (const [leg, byKey] of counts) {
    for (const key of LANE_ORDER) {
      for (let i = 0; i < (byKey.get(key) || 0); i += 1) leg.inbound.push(makeLane(key.split('')));
    }
  }

  // Receiving lanes: as many as the most lanes that feed any one movement into the leg.
  for (const leg of design.legs) {
    let most = 0;
    for (const other of design.legs) {
      if (other === leg) continue;
      const targets = turnTargets(design, other);
      const feeding = other.inbound.filter((lane) => lane.turns.some((t) => targets[t] === leg.id)).length;
      most = Math.max(most, feeding);
    }
    leg.outbound = Array.from({ length: Math.max(1, most) }, () => makeOutbound());
  }
  if (design.legs.length) note('GTSS does not record receiving lanes, lane order or lane widths; they are drawn from the lanes feeding each leg, at 11 ft.');

  for (const leg of design.legs) {
    if (leg.inbound.length && !legTurns(leg).includes('R')) note(`${legLabel(leg)}: the feed describes no right turn.`);
  }

  for (const rec of pedRecords) {
    const opposite = oppositeLeg(design, rec.leg);
    let targets = [];
    if (rec.pedX === 1) targets = [rec.leg];
    else if (rec.pedX === 2) targets = [rec.leg, opposite];
    else if (rec.pedX === 3) targets = [opposite];
    else if (rec.pedX >= 4 && rec.pedX <= 7) {
      design.scramble = true;
      design.diagonals.push({ phase: rec.phase, approachId: rec.leg.approachId, pedX: rec.pedX });
      if (rec.pedX === 7) targets = [...design.legs];
    } else {
      note(`${legLabel(rec.leg)}: pedX ${rec.pedX} for phase ${rec.phase} is not a GTSS value and was skipped.`);
    }
    if ((rec.pedX === 2 || rec.pedX === 3) && !opposite) {
      note(`${legLabel(rec.leg)}: phase ${rec.phase} has a crosswalk on the opposite leg, but no leg lies opposite.`);
    }
    for (const target of targets.filter(Boolean)) {
      const cw = target.crosswalk;
      if (cw.enabled && cw.pedPhase && cw.pedPhase !== rec.phase) {
        note(`${legLabel(target)}: the crosswalk is claimed by phases ${cw.pedPhase} and ${rec.phase}; phase ${cw.pedPhase} is kept.`);
        continue;
      }
      cw.enabled = true;
      cw.pedPhase = rec.phase;
      if (rec.length && rec.pedX !== 7) {
        cw.length = rec.length;
        cw.lengthSig = crossSectionSig(target);
      }
    }
  }

  let unplaced = 0;
  for (const row of detectorRows) {
    const channel = text(pick(row, 'channel'));
    const phase = text(pick(row, 'phase'));
    const laneNumber = numberOr(pick(row, 'lane'), null);
    const candidates = phase && phase !== '0'
      ? design.legs.filter((leg) => ['U', 'L', 'T', 'R'].some((t) => leg.movements[t].phase === phase))
      : [];
    if (!candidates.length) {
      design.unplacedDetectors.push({ ...row });
      unplaced += 1;
      continue;
    }
    const servesPhase = (leg) => {
      const lane = laneNumber ? leg.inbound[laneNumber - 1] : null;
      return lane && lane.turns.some((t) => leg.movements[t].phase === phase);
    };
    const leg = candidates.find(servesPhase) || candidates[0];
    const lane = laneNumber ? leg.inbound[laneNumber - 1] : null;
    leg.detectors.push(makeDetector({
      channel,
      laneId: lane ? lane.id : null,
      laneNumber: laneNumber && !lane ? String(laneNumber) : '',
      phase,
      purpose: text(pick(row, 'purpose')),
      vehicleType: text(pick(row, 'vehicle_type')),
      technology: text(pick(row, 'technology_type')),
      mode: text(pick(row, 'mode')),
      description: text(pick(row, 'description')),
      length: numberOr(pick(row, 'length'), 6),
      setback: numberOr(pick(row, 'stopbar_setback_dist'), 0),
      extra: extraColumns(row, 'detectors.txt'),
    }));
    if (laneNumber && !lane) note(`${legLabel(leg)}: detector ${channel} is on lane ${laneNumber}, beyond the lanes the feed describes; it is drawn across the approach.`);
  }
  if (unplaced) {
    note(`${unplaced} detector${unplaced === 1 ? '' : 's'} call no phase this signal uses (count stations, or phase 0); kept as-is and exported unchanged.`);
  }

  design.name = crossStreetName(approachRows.map((row) => text(pick(row, 'street_name')))) || `Signal ${S}`;
  design.notes = notes;
  return design;
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

const isDefault = (value) => value == null || value === '' || value === 'false' || value === '0';

/** movement_type and phase for one approach lane. */
export function laneMovement(leg, lane) {
  const m = leg.movements;
  switch (turnsKey(lane.turns)) {
    case 'L':
    case 'UL':
    case 'LR':
      return { type: LEFT_TREATMENTS[m.L.treatment] || 'L', phase: m.L.phase };
    case 'U':
      return { type: 'U', phase: m.U.phase };
    case 'T':
      return { type: 'T', phase: m.T.phase };
    case 'LT':
    case 'ULT':
    case 'LTR':
    case 'ULTR':
      return { type: 'LT', phase: m.T.phase || m.L.phase };
    case 'TR':
      return { type: 'TR', phase: m.T.phase || m.R.phase };
    case 'R':
    case 'UR':
      return { type: 'R', phase: m.R.phase };
    default:
      return null;
  }
}

function crosswalkLengthValue(leg) {
  const cw = leg.crosswalk;
  if (cw.length && (cw.lengthSig == null || cw.lengthSig === crossSectionSig(leg))) return cw.length;
  return `LE-${crosswalkLengthFt(leg)}`;
}

/** phases.txt rows for the design, as objects keyed by spec column. */
export function phaseRows(design) {
  const S = design.signal.id;
  const rows = [];
  for (const leg of design.legs) {
    const byKey = new Map();
    for (const lane of leg.inbound) {
      const move = laneMovement(leg, lane);
      if (!move) continue;
      const key = `${move.phase}|${move.type}`;
      if (!byKey.has(key)) {
        const row = { leg, phase: move.phase, type: move.type, lanes: 0 };
        byKey.set(key, row);
        rows.push(row);
      }
      byKey.get(key).lanes += 1;
    }
  }

  const THROUGHISH = ['T', 'TR', 'LT'];
  const choose = (list) => list.find((r) => THROUGHISH.includes(r.type)) || list[0];
  for (const leg of design.legs) {
    const cw = leg.crosswalk;
    if (!cw.enabled || !cw.pedPhase) continue;
    const own = choose(rows.filter((r) => r.leg === leg && r.phase === cw.pedPhase));
    if (own) {
      own.same = crosswalkLengthValue(leg);
      continue;
    }
    const opposite = oppositeLeg(design, leg);
    const across = opposite && choose(rows.filter((r) => r.leg === opposite && r.phase === cw.pedPhase));
    if (across) {
      across.opp = crosswalkLengthValue(leg);
      continue;
    }
    rows.push({ leg, phase: cw.pedPhase, type: 'PED', lanes: 0, same: crosswalkLengthValue(leg) });
  }

  for (const row of rows) {
    row.pedX = row.same && row.opp ? 2 : row.same ? 1 : row.opp ? 3 : 0;
  }
  if (design.scramble) {
    for (const diag of design.diagonals || []) {
      const leg = design.legs.find((l) => String(l.approachId) === String(diag.approachId));
      if (!leg) continue;
      const row = choose(rows.filter((r) => r.leg === leg && r.phase === diag.phase));
      if (row && (row.pedX === 0 || Number(diag.pedX) === 7)) row.pedX = Number(diag.pedX);
      else if (!row) rows.push({ leg, phase: diag.phase, type: 'PED', lanes: 0, pedX: Number(diag.pedX) });
    }
  }

  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => compareIds(a.row.phase || '~', b.row.phase || '~') || a.index - b.index)
    .map(({ row }) => row);

  return ordered.map((row) => ({
    phase: row.phase,
    approach_id: row.leg.approachId,
    signal_id: S,
    movement_type: row.type,
    num_of_lanes: String(row.lanes),
    ped_phase_enabled: row.pedX > 0 ? 'true' : 'false',
    is_overlap: isOverlap(design, row.phase) ? 'true' : 'false',
    pedX: String(row.pedX),
    crosswalk_length: row.same || row.opp || '',
    __extra: (design.phaseRowExtra || {})[`${row.leg.approachId}|${row.phase}|${row.type}`],
  }));
}

export function approachRows(design) {
  return design.legs.map((leg) => ({
    approach_id: leg.approachId,
    signal_id: design.signal.id,
    street_name: leg.street,
    compass_bearing: String(Math.round(leg.bearing)),
    posted_speed: String(leg.speed),
    free_right: leg.freeRight.lanes > 0 ? `${leg.freeRight.lanes}-FR${leg.freeRight.ped ? `-${leg.freeRight.ped}` : ''}` : '',
    __extra: leg.extra,
  }));
}

export function detectorRows(design) {
  const rows = [];
  for (const leg of design.legs) {
    for (const det of leg.detectors) {
      const index = det.laneId ? laneIndex(leg, det.laneId) : -1;
      rows.push({
        channel: det.channel,
        signal_id: design.signal.id,
        phase: detectorPhase(leg, det),
        description: det.description,
        purpose: det.purpose,
        vehicle_type: det.vehicleType,
        lane: index >= 0 ? String(index + 1) : det.laneNumber || '',
        technology_type: det.technology,
        mode: det.mode,
        length: String(det.length),
        stopbar_setback_dist: String(det.setback),
        __extra: det.extra,
      });
    }
  }
  for (const raw of design.unplacedDetectors || []) rows.push({ __raw: raw, channel: pick(raw, 'channel') });
  return rows.sort((a, b) => compareIds(text(a.channel), text(b.channel)));
}

/**
 * Merges new rows for one signal into a file, keeping every other line as it
 * was. The new rows go where the signal's old rows first appeared.
 */
function mergeFile(name, sourceText, newRows, isThisSignal, { signalOnly, signalId }) {
  const table = readTable(sourceText);
  const spec = SPEC_HEADERS[name];
  const headers = table.headers.length ? [...table.headers] : [...spec];
  const has = (col) => headers.some((h) => h.toLowerCase() === col.toLowerCase()
    || (SIGNAL_COLUMNS.has(col.toLowerCase()) && SIGNAL_COLUMNS.has(h.toLowerCase())));

  let added = 0;
  for (const col of spec) {
    if (has(col)) continue;
    if (!table.headers.length || newRows.some((row) => !row.__raw && !isDefault(row[col]))) {
      headers.push(col);
      added += 1;
    }
  }
  for (const row of newRows) {
    for (const [key, value] of Object.entries(row.__extra || {})) {
      if (!has(key) && !isDefault(value)) {
        headers.push(key);
        added += 1;
      }
    }
  }

  const specByLower = new Map(spec.map((col) => [col.toLowerCase(), col]));
  const render = (row) => csvLine(headers.map((header) => {
    const lower = header.toLowerCase();
    if (row.__raw) {
      if (SIGNAL_COLUMNS.has(lower)) return signalId;
      return row.__raw[header] ?? '';
    }
    const specCol = SIGNAL_COLUMNS.has(lower) ? 'signal_id' : specByLower.get(lower);
    if (specCol && row[specCol] !== undefined) return row[specCol];
    const extra = row.__extra || {};
    const key = Object.keys(extra).find((k) => k.toLowerCase() === lower);
    return key !== undefined ? extra[key] : '';
  }));

  const pad = ','.repeat(added);
  const out = [added || !table.headerLine ? csvLine(headers) : table.headerLine];
  let inserted = false;
  for (const record of table.records) {
    if (isThisSignal(record.row)) {
      if (!inserted) {
        out.push(...newRows.map(render));
        inserted = true;
      }
      continue;
    }
    if (signalOnly) continue;
    out.push(record.line + pad);
  }
  if (!inserted) out.push(...newRows.map(render));
  return out.join(table.eol) + table.eol;
}

/** Keeps a pass-through file, filtered to one signal when asked, renaming it if its ID changed. */
function passThrough(sourceText, { signalOnly, isThisSignal, signalId, renamed }) {
  const table = readTable(sourceText);
  const signalHeader = table.headers.findIndex((h) => SIGNAL_COLUMNS.has(h.toLowerCase()));
  if (signalHeader < 0 || (!signalOnly && !renamed)) return sourceText;
  const out = [table.headerLine];
  for (const record of table.records) {
    const mine = isThisSignal(record.row);
    if (signalOnly && !mine) continue;
    if (mine && renamed) {
      out.push(csvLine(table.headers.map((h, i) => (i === signalHeader ? signalId : record.row[h]))));
    } else {
      out.push(record.line);
    }
  }
  return out.join(table.eol) + table.eol;
}

/**
 * Writes a GTSS feed. With `base` (the files the design was imported from),
 * the result is that feed with this signal's rows replaced; with
 * `signalOnly`, just this signal. Returns { files, warnings }.
 */
export function gtssFromDesign(design, base = null, { signalOnly = false } = {}) {
  const baseFiles = base || {};
  const warnings = [];
  const S = design.signal.id;
  const oldS = (design.source && design.source.signalId) || S;
  const renamed = oldS !== S;
  const isThisSignal = (row) => {
    const id = rowSignal(row);
    return id === S || id === oldS;
  };
  const opts = { signalOnly, signalId: S };

  const files = {};
  files['signals.txt'] = mergeFile('signals.txt', baseFiles['signals.txt'], [{
    signal_id: S,
    agency_id: design.signal.agencyId,
    latitude: design.signal.lat,
    longitude: design.signal.lon,
    __extra: design.signal.extra,
  }], isThisSignal, opts);
  files['approaches.txt'] = mergeFile('approaches.txt', baseFiles['approaches.txt'], approachRows(design), isThisSignal, opts);
  const phases = phaseRows(design);
  files['phases.txt'] = mergeFile('phases.txt', baseFiles['phases.txt'], phases, isThisSignal, opts);
  files['detectors.txt'] = mergeFile('detectors.txt', baseFiles['detectors.txt'], detectorRows(design), isThisSignal, opts);

  for (const [name, content] of Object.entries(baseFiles)) {
    if (files[name] !== undefined) continue;
    if (name === 'agency.txt' && signalOnly && design.signal.agencyId) {
      const table = readTable(content);
      const keep = table.records.filter((r) => text(pick(r.row, 'agency_id')) === design.signal.agencyId);
      files[name] = [table.headerLine, ...(keep.length ? keep : table.records).map((r) => r.line)].join(table.eol) + table.eol;
      continue;
    }
    files[name] = passThrough(content, { signalOnly, isThisSignal, signalId: S, renamed });
  }

  if (!files['agency.txt']) {
    files['agency.txt'] = `${SPEC_HEADERS['agency.txt'].join(',')}\n${csvLine([design.signal.agencyId || 'agency', '', '', '', ''])}\n`;
    warnings.push('agency.txt is a placeholder: add the agency name, URL, timezone and email before publishing the feed.');
  }
  if (!design.signal.lat || !design.signal.lon) warnings.push('signals.txt has no latitude and longitude for this signal.');
  if (phases.some((row) => !row.phase)) warnings.push('Some movements have no phase and were exported with a blank phase.');
  if (!baseFiles['basic_timings.txt']) warnings.push('No basic_timings.txt was loaded, so the feed has no timing.');
  return { files, warnings };
}
