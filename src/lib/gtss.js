/**
 * GTSS basics: CSV reading and writing, and bearing vocabulary.
 *
 * A GTSS feed is a zip of comma-separated text files that reference each other
 * by ID (https://gtss.dev). The spec's own examples quote their strings, so
 * the reader is quote-aware; unquoted input reads exactly as a naive split
 * would.
 *
 * compass_bearing is the heading of traffic arriving at the intersection, so a
 * bearing of 90 is eastbound traffic that entered from the west.
 *
 * Adapted from Traffic Signal Kit's src/utils/gtss.js. Framework free.
 */

const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

const TRAVEL = { N: 'NB', NNE: 'NB', NE: 'NEB', ENE: 'EB', E: 'EB', ESE: 'EB', SE: 'SEB', SSE: 'SB',
  S: 'SB', SSW: 'SB', SW: 'SWB', WSW: 'WB', W: 'WB', WNW: 'WB', NW: 'NWB', NNW: 'NB' };

/** 120 -> "ESE". Null for anything that is not a bearing. */
export function bearingToCompass(bearing) {
  const degrees = Number(bearing);
  if (bearing === '' || bearing == null || !Number.isFinite(degrees)) return null;
  const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[index];
}

/** The direction traffic on the approach is travelling: 240 -> "WB". */
export function bearingToTravel(bearing) {
  return TRAVEL[bearingToCompass(bearing)] ?? null;
}

/** The compass point traffic on the approach arrives from: the reciprocal. */
export function bearingToOrigin(bearing) {
  const degrees = Number(bearing);
  if (bearing === '' || bearing == null || !Number.isFinite(degrees)) return null;
  return bearingToCompass(degrees + 180);
}

/** Splits one CSV line, honouring double quotes and "" escapes. */
export function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      wasQuoted = true;
      cell = '';
    } else if (ch === ',') {
      cells.push(wasQuoted ? cell : cell.trim());
      cell = '';
      wasQuoted = false;
    } else if (!(wasQuoted && ch.trim() === '')) {
      cell += ch;
    }
  }
  cells.push(wasQuoted ? cell : cell.trim());
  return cells;
}

/**
 * Reads a table keeping each line's raw text, so rows that are not being
 * edited can be written back byte for byte.
 */
export function readTable(text) {
  const source = String(text || '');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { headers: [], headerLine: '', records: [], eol };
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const records = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((header, i) => {
      row[header] = (cells[i] ?? '').trim();
    });
    return { line, row };
  });
  return { headers, headerLine: lines[0], records, eol };
}

/** Rows as objects keyed by the header row. */
export function parseTable(text) {
  return readTable(text).records.map((record) => record.row);
}

/** Quotes a cell only when it has to be quoted. */
export function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text) || text !== text.trim()) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvLine(values) {
  return values.map(csvCell).join(',');
}

/** Case-insensitive column lookup: GTSS exports spell pedX as PedX, and preempt.txt says signalID. */
export function pick(row, ...names) {
  if (!row) return undefined;
  for (const name of names) {
    if (row[name] !== undefined) return row[name];
  }
  const lower = new Map(Object.keys(row).map((key) => [key.toLowerCase(), key]));
  for (const name of names) {
    const key = lower.get(name.toLowerCase());
    if (key !== undefined) return row[key];
  }
  return undefined;
}

/** The signal a row belongs to, whichever way the file spells the column. */
export function rowSignal(row) {
  const value = pick(row, 'signal_id', 'signalID');
  return value == null ? '' : String(value).trim();
}

/**
 * A readable name for a signal from the streets meeting at it: the two
 * streets with the most legs, ties broken by the export's own order.
 */
export function crossStreetName(streets) {
  const counts = new Map();
  const order = new Map();
  (streets || []).forEach((street, index) => {
    if (!street) return;
    counts.set(street, (counts.get(street) || 0) + 1);
    if (!order.has(street)) order.set(street, index);
  });
  if (!counts.size) return '';
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || order.get(a[0]) - order.get(b[0]),
  );
  return ranked.slice(0, 2).map(([street]) => street).join(' & ');
}

/** Numeric-aware sort for IDs that are usually, but not always, numbers. */
export function compareIds(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}
