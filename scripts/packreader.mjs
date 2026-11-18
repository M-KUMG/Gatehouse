// Reader for Gatehouse toolchain packs (.pack files made by scripts/make-packs.mjs).
//
// Pure JavaScript with NO imports and no Node APIs (only Uint8Array, DataView, TextDecoder, JSON), so the
// compiler Worker can copy this file as it is. To read a .pack.gz in a browser, decompress it first with
// `new Response(body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()`.
//
// Pack format "GHP1" (all numbers little endian):
//   bytes 0..3    magic "GHP1"
//   bytes 4..7    uint32 N = length of the index in bytes
//   bytes 8..8+N  the index: UTF-8 JSON array of {path, offset, length, sha256}, sorted by path
//   then          the data: every file's bytes, back to back, in index order, no padding
// `offset` counts from the first data byte. Files are contiguous: offset(i+1) = offset(i) + length(i). The
// pack therefore has exactly one valid byte layout for a given list of files.

export const PACK_MAGIC = 'GHP1';

export class PackError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PackError';
  }
}

/** A path that is safe to write below a virtual file system root: relative, no "..", no empty segment. */
export function isSafePackPath(p) {
  if (typeof p !== 'string' || p === '' || p.length > 512) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0') || /^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/**
 * Parse a pack held in memory and check its structure (not the sha256 values, see verifyPack).
 * @param {Uint8Array} bytes
 * @returns {{
 *   files: {path: string, offset: number, length: number, sha256: string}[],
 *   dataStart: number,
 *   has(path: string): boolean,
 *   get(path: string): Uint8Array,
 *   entries(): Iterable<[string, Uint8Array]>
 * }}
 */
export function readPack(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new PackError('pack must be a Uint8Array');
  if (bytes.length < 8) throw new PackError('pack is too short');
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== PACK_MAGIC.charCodeAt(i)) throw new PackError('not a GHP1 pack (bad magic)');
  }
  const indexLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const dataStart = 8 + indexLength;
  if (dataStart > bytes.length) throw new PackError('index is longer than the pack');
  let files;
  try {
    files = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(8, dataStart)));
  } catch (e) {
    throw new PackError(`index is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(files)) throw new PackError('index is not an array');
  const byPath = new Map();
  let expected = 0;
  for (const f of files) {
    if (!f || !isSafePackPath(f.path)) throw new PackError(`unsafe or missing path in index: ${JSON.stringify(f?.path)}`);
    if (!Number.isSafeInteger(f.offset) || !Number.isSafeInteger(f.length) || f.length < 0) {
      throw new PackError(`bad offset or length for ${f.path}`);
    }
    if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) throw new PackError(`bad sha256 for ${f.path}`);
    if (f.offset !== expected) throw new PackError(`files are not contiguous at ${f.path}`);
    if (byPath.has(f.path)) throw new PackError(`duplicate path ${f.path}`);
    expected += f.length;
    byPath.set(f.path, f);
  }
  if (dataStart + expected !== bytes.length) {
    throw new PackError(`pack is ${bytes.length} bytes but the index describes ${dataStart + expected}`);
  }
  const get = (path) => {
    const f = byPath.get(path);
    if (!f) throw new PackError(`no such file in pack: ${path}`);
    return bytes.subarray(dataStart + f.offset, dataStart + f.offset + f.length);
  };
  return {
    files,
    dataStart,
    has: (path) => byPath.has(path),
    get,
    *entries() {
      for (const f of files) yield [f.path, get(f.path)];
    },
  };
}

/**
 * Check every file's sha256 against the index. `sha256Hex` turns bytes into a lowercase hex string; it may be
 * async (in a Worker use crypto.subtle.digest, in Node crypto.createHash).
 * @param {ReturnType<typeof readPack>} pack
 * @param {(data: Uint8Array) => string | Promise<string>} sha256Hex
 */
export async function verifyPack(pack, sha256Hex) {
  for (const f of pack.files) {
    const got = await sha256Hex(pack.get(f.path));
    if (got !== f.sha256) throw new PackError(`sha256 mismatch for ${f.path}: got ${got}, index says ${f.sha256}`);
  }
}
