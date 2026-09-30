/**
 * Minimal store-mode ZIP writer.
 *
 * Framework free so it runs in the view, in a worker, or under `node --test`.
 *
 * Every entry is written with method 0 (store), which sounds lossy-by-omission
 * but is the correct choice here: a YOLO dataset is JPEG/PNG images that are
 * already entropy coded, so deflate would recover ~1-3% for the price of a
 * compression dependency. More importantly, store mode copies the payload
 * verbatim, so an extracted image is byte-identical to the file the user
 * picked — the dataset never passes through a canvas re-encode.
 *
 * No ZIP64: the format's u32 offsets and u16 counts cap this at 4 GiB and
 * 65535 entries. `assertZipLimits` reports that in words the UI can show.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;

const VERSION = 20; // 2.0 — the minimum that understands folders
const FLAG_UTF8 = 0x0800; // bit 11: the name is UTF-8, not CP437
const METHOD_STORE = 0;

export const MAX_ZIP_ENTRIES = 65535;
export const MAX_ZIP_BYTES = 0xffffffff;

export const CRC32_INIT = 0xffffffff;

let CRC_TABLE = null;

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

const encoder = new TextEncoder();

/** Accepts a string (encoded UTF-8) or any ArrayBuffer view. */
export function toBytes(value) {
  if (value == null) return new Uint8Array(0);
  if (typeof value === 'string') return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError('Unsupported byte source');
}

/** Folds more bytes into a running CRC. Start from CRC32_INIT. */
export function crc32Update(state, value) {
  const table = crcTable();
  const bytes = toBytes(value);
  let c = state >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return c >>> 0;
}

export function crc32Finish(state) {
  return (state ^ 0xffffffff) >>> 0;
}

/** One-shot CRC-32 (IEEE) of a string or byte source. */
export function crc32(value) {
  return crc32Finish(crc32Update(CRC32_INIT, value));
}

/**
 * MS-DOS packed date/time. These fields are unzoned wall clock, so local time
 * is the right reading. Anything before 1980 is clamped — the year subtraction
 * would otherwise shift negative and write garbage into a u16.
 */
export function dosDateTime(date = new Date()) {
  const d = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const year = d.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 }; // 1980-01-01 00:00
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

function normalizeEntry(entry) {
  const name = String(entry.name || '').replace(/^\/+/, '');
  if (!name) throw new Error('Every zip entry needs a name');
  if (name.includes('..')) throw new Error(`Unsafe zip entry name: ${name}`);

  const nameBytes = encoder.encode(name);
  const hasInlineData = entry.data != null;
  const bytes = hasInlineData ? toBytes(entry.data) : null;

  const size = hasInlineData ? bytes.length : Number(entry.size);
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`Zip entry "${name}" needs a byte size`);
  }

  const crc = hasInlineData ? crc32(bytes) : Number(entry.crc);
  if (!Number.isFinite(crc)) {
    throw new Error(`Zip entry "${name}" needs a CRC-32 (streamed entries must supply one)`);
  }

  return {
    name,
    nameBytes,
    size,
    crc: crc >>> 0,
    payload: hasInlineData ? bytes : entry.blob,
    stamp: dosDateTime(entry.date),
  };
}

/**
 * Throws a message fit for the UI when the archive would exceed what a
 * non-ZIP64 archive can address.
 */
export function assertZipLimits(entries) {
  const list = (entries || []).map(normalizeEntry);

  if (list.length > MAX_ZIP_ENTRIES) {
    throw new Error(
      `This dataset needs ${list.length.toLocaleString()} files, over the ${MAX_ZIP_ENTRIES.toLocaleString()} a standard zip can hold. Export in smaller batches.`,
    );
  }

  let total = EOCD_SIZE;
  for (const entry of list) {
    if (entry.size > MAX_ZIP_BYTES) {
      throw new Error(`"${entry.name}" is over 4 GB, which a standard zip cannot store.`);
    }
    total += LOCAL_HEADER_SIZE + entry.nameBytes.length + entry.size;
    total += CENTRAL_HEADER_SIZE + entry.nameBytes.length;
  }
  if (total > MAX_ZIP_BYTES) {
    throw new Error(
      `This dataset would produce a ${(total / 1024 ** 3).toFixed(1)} GB zip, over the 4 GB a standard zip can address. Export in smaller batches.`,
    );
  }

  return { entries: list.length, totalSize: total };
}

function localHeader(entry) {
  const buffer = new Uint8Array(LOCAL_HEADER_SIZE + entry.nameBytes.length);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, LOCAL_SIG, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, FLAG_UTF8, true);
  view.setUint16(8, METHOD_STORE, true);
  view.setUint16(10, entry.stamp.time, true);
  view.setUint16(12, entry.stamp.date, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.size, true); // compressed === uncompressed under store
  view.setUint32(22, entry.size, true);
  view.setUint16(26, entry.nameBytes.length, true); // bytes, not characters
  view.setUint16(28, 0, true);
  buffer.set(entry.nameBytes, LOCAL_HEADER_SIZE);
  return buffer;
}

function centralHeader(entry, localOffset) {
  const buffer = new Uint8Array(CENTRAL_HEADER_SIZE + entry.nameBytes.length);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, CENTRAL_SIG, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, VERSION, true);
  view.setUint16(8, FLAG_UTF8, true);
  view.setUint16(10, METHOD_STORE, true);
  view.setUint16(12, entry.stamp.time, true);
  view.setUint16(14, entry.stamp.date, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true); // extra
  view.setUint16(32, 0, true); // comment
  view.setUint16(34, 0, true); // disk number start
  view.setUint16(36, 0, true); // internal attrs
  view.setUint32(38, 0, true); // external attrs
  view.setUint32(42, localOffset, true);
  buffer.set(entry.nameBytes, CENTRAL_HEADER_SIZE);
  return buffer;
}

function endOfCentralDirectory(count, cdSize, cdOffset) {
  const buffer = new Uint8Array(EOCD_SIZE);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, EOCD_SIG, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, cdSize, true);
  view.setUint32(16, cdOffset, true);
  view.setUint16(20, 0, true);
  return buffer;
}

/**
 * Assembles the archive as an ordered list of parts.
 *
 * Entries backed by a File/Blob are passed through untouched, so the browser
 * keeps them disk-backed instead of holding every image in memory; only the
 * ~80-byte headers are materialized as bytes.
 */
export function buildZipParts(entries) {
  const list = (entries || []).map(normalizeEntry);
  assertZipLimits(entries);

  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of list) {
    const header = localHeader(entry);
    central.push(centralHeader(entry, offset));
    parts.push(header);
    offset += header.length;

    if (entry.size > 0) {
      parts.push(entry.payload);
      offset += entry.size;
    }
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const record of central) {
    parts.push(record);
    cdSize += record.length;
  }

  parts.push(endOfCentralDirectory(list.length, cdSize, cdOffset));

  return {
    parts,
    count: list.length,
    cdOffset,
    cdSize,
    totalSize: cdOffset + cdSize + EOCD_SIZE,
  };
}

export function zipBlob(entries) {
  const { parts } = buildZipParts(entries);
  return new Blob(parts, { type: 'application/zip' });
}

/** Test/inspection helper: flattens byte parts into one array. */
export function concatParts(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
