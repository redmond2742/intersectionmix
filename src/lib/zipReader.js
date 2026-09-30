/**
 * Minimal ZIP reader.
 *
 * The counterpart to zipWriter.js, and written for the same reason: reading a
 * handful of text files out of an archive does not justify a dependency.
 * DEFLATE is handled by the platform's own DecompressionStream, which exists
 * in every current browser and in Node, so there is no inflate to implement.
 *
 * Reads the central directory rather than scanning for local headers, because
 * only the central directory is authoritative about what an archive contains.
 *
 * Framework free, so it runs under `node --test`.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** The comment field is variable length, so the record has to be searched for. */
function findEndOfCentralDirectory(view) {
  const maxComment = 0xffff;
  const earliest = Math.max(0, view.byteLength - maxComment - 22);
  for (let offset = view.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Returns every file in the archive as { name, bytes }.
 * Directory entries are skipped; encrypted archives are refused.
 */
export async function readZipEntries(buffer) {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error('Not a zip file: no end-of-central-directory record found.');

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > data.byteLength || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error('Damaged zip: central directory entry ' + (i + 1) + ' is not where it should be.');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue; // directory
    if (flags & 0x0001) throw new Error(`"${name}" is encrypted; export the archive without a password.`);

    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw new Error(`Damaged zip: "${name}" does not start where the directory says.`);
    }
    // The local header's own name and extra lengths are the ones that count
    // here; they can differ from the central directory's.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = data.subarray(start, start + compressedSize);

    if (method === METHOD_STORED) {
      entries.push({ name, bytes: raw });
    } else if (method === METHOD_DEFLATE) {
      entries.push({ name, bytes: await inflateRaw(raw) });
    } else {
      throw new Error(`"${name}" uses an unsupported compression method (${method}).`);
    }
  }

  return entries;
}

/** The same, decoded as text and keyed by base name without its directory. */
export async function readZipText(buffer) {
  const decoder = new TextDecoder();
  const files = {};
  for (const entry of await readZipEntries(buffer)) {
    const base = entry.name.split('/').pop();
    if (base) files[base] = decoder.decode(entry.bytes);
  }
  return files;
}
