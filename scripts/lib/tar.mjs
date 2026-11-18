// A small, safe tar reader (ustar, pax and GNU long-name headers) for archives we do not control.
// Node built-ins only. Use readTar(bytes, limits) to parse and validate, extractEntries(entries, dir) to write.
//
// Safety rules (every violation throws a TarError, nothing is written before the whole archive validated):
//   - paths must be relative, with no "..", no backslash, no drive letter or ":" and no NUL;
//   - only regular files and directories are kept; device nodes, fifos and unknown types are rejected;
//   - a hardlink or symlink is accepted only when its target is a regular file that is inside the archive
//     (and inside the destination folder). It is then written as a plain COPY of that file, so no link is ever
//     created on disk. Links to absolute paths, to paths that leave the folder, or to anything else are rejected;
//   - limits on the number of entries, the path length and the total number of content bytes.

import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, posix, resolve, sep } from 'node:path';

export class TarError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TarError';
  }
}

export const DEFAULT_LIMITS = {
  maxEntries: 20000,
  maxPathLength: 1024,
  maxTotalBytes: 256 * 1024 * 1024,
};

const dec = new TextDecoder('utf-8', { fatal: false });

function cstr(buf, off, len) {
  let end = off;
  const max = off + len;
  while (end < max && buf[end] !== 0) end++;
  return dec.decode(buf.subarray(off, end));
}

/** Octal number field, or GNU base-256 when the high bit of the first byte is set. */
function num(buf, off, len) {
  if (buf[off] & 0x80) {
    let v = buf[off] & 0x7f;
    for (let i = 1; i < len; i++) {
      v = v * 256 + buf[off + i];
      if (!Number.isSafeInteger(v)) throw new TarError('number in header too large');
    }
    return v;
  }
  const s = cstr(buf, off, len).trim();
  if (s === '') return 0;
  if (!/^[0-7]+$/.test(s)) throw new TarError(`bad number in header: ${JSON.stringify(s)}`);
  return parseInt(s, 8);
}

function isZeroBlock(buf, off) {
  for (let i = 0; i < 512; i++) if (buf[off + i] !== 0) return false;
  return true;
}

function checksumOk(buf, off) {
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : buf[off + i];
  return sum === num(buf, off + 148, 8);
}

/** Pax extended header: records "<len> <key>=<value>\n". Returns a plain object. */
function parsePax(data) {
  const out = {};
  let p = 0;
  while (p < data.length) {
    let q = p;
    while (q < data.length && data[q] !== 0x20) q++;
    const len = parseInt(dec.decode(data.subarray(p, q)), 10);
    if (!Number.isInteger(len) || len < 4 || p + len > data.length) throw new TarError('bad pax record');
    const rec = dec.decode(data.subarray(q + 1, p + len - 1)); // without trailing newline
    const eq = rec.indexOf('=');
    if (eq < 1) throw new TarError('bad pax record');
    out[rec.slice(0, eq)] = rec.slice(eq + 1);
    p += len;
  }
  return out;
}

/**
 * Validate a path from an archive and return it normalised ("a/b/c", no leading "./", no trailing "/").
 * Returns '' for "." (the archive root itself). Throws for anything unsafe.
 */
export function safeRelPath(p, limits = DEFAULT_LIMITS) {
  if (typeof p !== 'string' || p.includes('\0')) throw new TarError('bad path (NUL)');
  if (p.length > limits.maxPathLength) throw new TarError(`path too long: ${p.slice(0, 80)}...`);
  if (p.includes('\\')) throw new TarError(`backslash in path: ${JSON.stringify(p)}`);
  if (p.startsWith('/')) throw new TarError(`absolute path: ${JSON.stringify(p)}`);
  if (/^[A-Za-z]:/.test(p)) throw new TarError(`drive letter in path: ${JSON.stringify(p)}`);
  const parts = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') throw new TarError(`".." in path: ${JSON.stringify(p)}`);
    if (seg.includes(':')) throw new TarError(`":" in path: ${JSON.stringify(p)}`);
    parts.push(seg);
  }
  return parts.join('/');
}

/** Target of a link, relative to the folder of the link (symlinks) or to the archive root (hardlinks). */
function linkTarget(path, linkname, kind, limits) {
  if (kind === 'hardlink') return safeRelPath(linkname, limits);
  if (linkname.startsWith('/') || linkname.includes('\\') || /^[A-Za-z]:/.test(linkname)) {
    throw new TarError(`symlink with absolute target: ${path} -> ${linkname}`);
  }
  const joined = posix.normalize(posix.join(posix.dirname(path), linkname));
  if (joined === '..' || joined.startsWith('../')) throw new TarError(`symlink escapes the folder: ${path} -> ${linkname}`);
  return safeRelPath(joined, limits);
}

/**
 * Parse a tar archive held in memory.
 * @param {Uint8Array} buf
 * @param {Partial<typeof DEFAULT_LIMITS>} [userLimits]
 * @returns {{path: string, type: 'file'|'dir', data: Uint8Array, mode: number}[]} files and directories
 */
export function readTar(buf, userLimits = {}) {
  const limits = { ...DEFAULT_LIMITS, ...userLimits };
  const entries = [];
  const links = [];
  let total = 0;
  let pos = 0;
  let pax = {};
  let longName = null;
  let longLink = null;

  while (pos + 512 <= buf.length) {
    if (isZeroBlock(buf, pos)) break; // end of archive
    if (!checksumOk(buf, pos)) throw new TarError(`bad header checksum at offset ${pos}`);
    const name = cstr(buf, pos, 100);
    const mode = num(buf, pos + 100, 8);
    let size = num(buf, pos + 124, 12);
    const type = String.fromCharCode(buf[pos + 156] || 0x30); // NUL means regular file
    const linkname = cstr(buf, pos + 157, 100);
    const ustar = cstr(buf, pos + 257, 5) === 'ustar';
    const prefix = ustar ? cstr(buf, pos + 345, 155) : '';
    const isExt = type === 'x' || type === 'g' || type === 'L' || type === 'K';
    if (!isExt && pax.size !== undefined) {
      size = Number(pax.size);
      if (!Number.isSafeInteger(size) || size < 0) throw new TarError('bad pax size');
    }
    pos += 512;
    const isData = type === '0' || type === '7';
    total += size;
    if (total > limits.maxTotalBytes) throw new TarError(`archive content exceeds ${limits.maxTotalBytes} bytes`);
    if (pos + size > buf.length) throw new TarError('archive is truncated');
    const data = buf.subarray(pos, pos + size);
    pos += Math.ceil(size / 512) * 512;

    if (type === 'x') { pax = { ...pax, ...parsePax(data) }; continue; }
    if (type === 'g') { parsePax(data); continue; } // global pax headers are validated and ignored
    if (type === 'L') { longName = cstr(data, 0, data.length); continue; }
    if (type === 'K') { longLink = cstr(data, 0, data.length); continue; }

    const rawPath = pax.path ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    const rawLink = pax.linkpath ?? longLink ?? linkname;
    pax = {};
    longName = null;
    longLink = null;

    const path = safeRelPath(rawPath, limits);
    if (entries.length + links.length >= limits.maxEntries) throw new TarError(`more than ${limits.maxEntries} entries`);

    if (isData) {
      if (path === '') throw new TarError('file with empty name');
      entries.push({ path, type: 'file', data, mode });
    } else if (type === '5') {
      if (path !== '') entries.push({ path, type: 'dir', data: new Uint8Array(0), mode });
    } else if (type === '1' || type === '2') {
      if (path === '') throw new TarError('link with empty name');
      const kind = type === '1' ? 'hardlink' : 'symlink';
      links.push({ path, mode, kind, target: linkTarget(path, rawLink, kind, limits), raw: rawLink });
    } else {
      throw new TarError(`unsupported entry type ${JSON.stringify(type)} for ${rawPath}`);
    }
  }

  // Turn links into copies of regular files of the archive (resolving chains of links).
  const byPath = new Map(entries.map((e) => [e.path, e]));
  let pending = links;
  while (pending.length > 0) {
    const stillPending = [];
    for (const l of pending) {
      const target = byPath.get(l.target);
      if (target && target.type === 'file') {
        const copy = { path: l.path, type: 'file', data: target.data, mode: l.mode };
        entries.push(copy);
        byPath.set(l.path, copy);
        total += copy.data.length;
        if (total > limits.maxTotalBytes) throw new TarError(`archive content exceeds ${limits.maxTotalBytes} bytes`);
      } else {
        stillPending.push(l);
      }
    }
    if (stillPending.length === pending.length) {
      const l = stillPending[0];
      throw new TarError(`${l.kind} target is not a regular file in the archive: ${l.path} -> ${l.raw}`);
    }
    pending = stillPending;
  }
  return entries;
}

/**
 * Write validated entries below destDir (created if missing). Re-checks that every target stays inside destDir.
 * @returns {{path: string, size: number, sha256: string}[]} one record per file written, sorted by path
 */
export function extractEntries(entries, destDir) {
  const root = resolve(destDir);
  mkdirSync(root, { recursive: true });
  const written = [];
  for (const e of entries) {
    const target = resolve(root, ...e.path.split('/'));
    if (target !== root && !target.startsWith(root + sep)) throw new TarError(`path escapes the folder: ${e.path}`);
    if (e.type === 'dir') {
      mkdirSync(target, { recursive: true });
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, e.data);
      written.push({ path: e.path, size: e.data.length, sha256: createHash('sha256').update(e.data).digest('hex') });
    }
  }
  written.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return written;
}

/** Convenience: join(destDir, path) for callers that want to look at a written file. */
export function entryPath(destDir, path) {
  return join(destDir, ...path.split('/'));
}
