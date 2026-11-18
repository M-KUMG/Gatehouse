// TypeScript port of scripts/packreader.mjs for the compile Worker: reads a
// toolchain pack (.pack, GHP1) held in memory. Same checks, same errors; a
// test compares it with the .mjs reader on the real packs. Pure (Uint8Array,
// DataView, TextDecoder, JSON), no DOM, no Node.
//
// Format (little endian): "GHP1", uint32 N, N bytes of JSON index
// [{path, offset, length, sha256}] sorted by path, then the files back to back.

export const PACK_MAGIC = 'GHP1';

export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackError';
  }
}

export interface PackFileEntry {
  path: string;
  offset: number;
  length: number;
  sha256: string;
}

export interface PackReader {
  files: PackFileEntry[];
  dataStart: number;
  has(path: string): boolean;
  /** The file's bytes (a view into the pack, not a copy). */
  get(path: string): Uint8Array;
  entries(): Iterable<[string, Uint8Array]>;
}

/** A path that is safe to write below a virtual file system root: relative, no "..", no empty segment. */
export function isSafePackPath(p: unknown): p is string {
  if (typeof p !== 'string' || p === '' || p.length > 512) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0') || /^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** Parse a pack held in memory and check its structure (not the sha256 values, see verifyPack). */
export function readPack(bytes: Uint8Array): PackReader {
  if (!(bytes instanceof Uint8Array)) throw new PackError('pack must be a Uint8Array');
  if (bytes.length < 8) throw new PackError('pack is too short');
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== PACK_MAGIC.charCodeAt(i)) throw new PackError('not a GHP1 pack (bad magic)');
  }
  const indexLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const dataStart = 8 + indexLength;
  if (dataStart > bytes.length) throw new PackError('index is longer than the pack');
  let files: unknown;
  try {
    files = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(8, dataStart)));
  } catch (e) {
    throw new PackError(`index is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(files)) throw new PackError('index is not an array');
  const byPath = new Map<string, PackFileEntry>();
  let expected = 0;
  for (const f of files as Partial<PackFileEntry>[]) {
    if (!f || !isSafePackPath(f.path)) throw new PackError(`unsafe or missing path in index: ${JSON.stringify(f?.path)}`);
    if (!Number.isSafeInteger(f.offset) || !Number.isSafeInteger(f.length) || (f.length as number) < 0) {
      throw new PackError(`bad offset or length for ${f.path}`);
    }
    if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) throw new PackError(`bad sha256 for ${f.path}`);
    if (f.offset !== expected) throw new PackError(`files are not contiguous at ${f.path}`);
    if (byPath.has(f.path)) throw new PackError(`duplicate path ${f.path}`);
    expected += f.length as number;
    byPath.set(f.path, f as PackFileEntry);
  }
  if (dataStart + expected !== bytes.length) {
    throw new PackError(`pack is ${bytes.length} bytes but the index describes ${dataStart + expected}`);
  }
  const get = (path: string): Uint8Array => {
    const f = byPath.get(path);
    if (!f) throw new PackError(`no such file in pack: ${path}`);
    return bytes.subarray(dataStart + f.offset, dataStart + f.offset + f.length);
  };
  const list = files as PackFileEntry[];
  return {
    files: list,
    dataStart,
    has: (path) => byPath.has(path),
    get,
    *entries() {
      for (const f of list) yield [f.path, get(f.path)] as [string, Uint8Array];
    },
  };
}

/** Check every file's sha256 against the index (`sha256Hex` may be async). */
export async function verifyPack(pack: PackReader, sha256Hex: (data: Uint8Array) => string | Promise<string>): Promise<void> {
  for (const f of pack.files) {
    const got = await sha256Hex(pack.get(f.path));
    if (got !== f.sha256) throw new PackError(`sha256 mismatch for ${f.path}: got ${got}, index says ${f.sha256}`);
  }
}

/** Lowercase hex SHA-256 with Web Crypto (Worker, browser and Node 20+). */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
