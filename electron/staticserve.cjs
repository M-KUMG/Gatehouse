'use strict';
// The pure part of the Electron static server (main.js wires it to the
// `gatehouse` protocol): URL -> file resolution with strict traversal
// protection, MIME types, cache headers, and a handler that answers a standard
// Request with a standard Response. No Electron import, so vitest can test it.
//
//   gatehouse://app/<path>
//     /                      -> <appRoot>/index.html
//     /toolchain-packs/<f>   -> <packsRoot>/<f>   (manifest.json, *.pack, *.pack.gz only)
//     anything else          -> <appRoot>/<path>
//
// Nothing outside the two roots is ever served (not even through a symlink
// inside them), and the content-type rules for the packs mirror the Vite dev
// plugin in vite.config.ts: .pack.gz is plain octet-stream with NO
// Content-Encoding (the Worker gunzips it itself), manifest.json is revalidated
// every time.

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const SCHEME = 'gatehouse';
const HOST = 'app';
const ORIGIN = `${SCHEME}://${HOST}`;
const PACKS_SEGMENT = 'toolchain-packs';

const TEXT = (type) => `${type}; charset=utf-8`;
/** Extension (lower case) -> Content-Type. Anything else is application/octet-stream. */
const MIME = {
  '.html': TEXT('text/html'),
  '.js': TEXT('text/javascript'),
  '.mjs': TEXT('text/javascript'),
  '.css': TEXT('text/css'),
  '.json': TEXT('application/json'),
  '.map': TEXT('application/json'),
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': TEXT('text/plain'),
  '.pack': 'application/octet-stream',
  '.gz': 'application/octet-stream',
};

/** Content-Type of a file name (by its last extension, so `x.pack.gz` is octet-stream). */
function mimeFor(name) {
  return MIME[path.posix.extname(String(name).toLowerCase())] || 'application/octet-stream';
}

/** What /toolchain-packs/ may serve: the manifest and the packs, as plain file names (same as vite.config.ts). */
const PACK_FILE = /^(?:manifest\.json|[A-Za-z0-9][\w.-]*\.pack(?:\.gz)?)$/;
/** Windows device names (`nul`, `COM1`, ...) are refused as path segments on every platform. */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_PATH_LENGTH = 1024;

/**
 * The path part of a `gatehouse://app/...` URL, taken from the string as it is
 * (no URL normalisation, so `..` and `%2e%2e` reach the checks below), or null
 * for any other scheme or host. A query or fragment is dropped.
 * @param {string} url
 * @returns {string | null}
 */
function pathnameOf(url) {
  if (typeof url !== 'string') return null;
  const m = /^gatehouse:\/\/app(?=[/?#]|$)([^?#]*)/i.exec(url);
  if (!m) return null;
  return m[1] === '' ? '/' : m[1];
}

/**
 * Validate and split a URL path into plain segments. The path is
 * percent-decoded exactly once; whatever is still suspicious afterwards is
 * refused: a `..` or `.` segment, backslash, NUL and other control characters,
 * `:` (drive letters, NTFS streams), `%` (a double-encoded escape), an encoded
 * slash or backslash, an empty segment, names Windows reads differently
 * (trailing dot or space, device names). A dotfile is not served (404).
 * @param {string} pathname begins with "/"
 * @returns {{ segments: string[] } | { status: 400 | 404 }}
 */
function splitPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.length > MAX_PATH_LENGTH) return { status: 400 };
  if (/[\\\0]/.test(pathname) || /%(?:2f|5c)/i.test(pathname)) return { status: 400 };
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { status: 400 };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\0-\x1f\x7f\\:%]/.test(decoded)) return { status: 400 };
  if (decoded === '/') return { segments: [] };
  const segments = decoded.slice(1).split('/');
  let status = 200;
  for (const s of segments) {
    if (s === '') {
      status = 404; // "a//b" or a trailing slash: no such file (never a directory listing)
      continue;
    }
    if (s === '.' || s === '..' || /[. ]$/.test(s) || DEVICE_NAME.test(s)) return { status: 400 };
    if (s.startsWith('.')) status = 404;
  }
  return status === 200 ? { segments } : { status: 404 };
}

/**
 * Is `file` strictly inside `root`? Case-insensitive on Windows (path.win32).
 * @param {string} root
 * @param {string} file
 * @param {typeof path} [pathImpl]
 */
function isInside(root, file, pathImpl = path) {
  const rel = pathImpl.relative(root, file);
  if (rel === '' || pathImpl.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${pathImpl.sep}`);
}

/**
 * @typedef {{ appRoot: string, packsRoot?: string | null }} Roots
 * @typedef {{ status: 200, file: string, root: string, kind: 'app' | 'packs', rel: string }
 *   | { status: 400 | 404 }} Resolution
 */

/**
 * Map a request URL to a file path under one of the two roots. Only the path
 * is looked at; reading the disk is the handler's job.
 * @param {string} url
 * @param {Roots} roots absolute paths
 * @param {typeof path} [pathImpl] path.win32 / path.posix for tests
 * @returns {Resolution}
 */
function resolveUrl(url, roots, pathImpl = path) {
  const pathname = pathnameOf(url);
  if (pathname === null) return { status: 404 };
  const split = splitPath(pathname);
  if ('status' in split) return split;
  let segments = split.segments;
  if (segments.length === 0) segments = ['index.html'];
  /** @type {'app' | 'packs'} */
  let kind = 'app';
  let root = roots.appRoot;
  if (segments[0] === PACKS_SEGMENT) {
    kind = 'packs';
    root = roots.packsRoot || '';
    segments = segments.slice(1);
    if (segments.length !== 1 || !PACK_FILE.test(segments[0])) return { status: 404 };
  }
  if (!root) return { status: 404 };
  const file = pathImpl.resolve(root, ...segments);
  if (!isInside(root, file, pathImpl)) return { status: 400 };
  return { status: 200, file, root, kind, rel: segments.join('/') };
}

/** Is this URL one the app may navigate to (the gatehouse scheme and host only)? */
function isAppUrl(url) {
  return pathnameOf(url) !== null;
}

/**
 * Cache-Control for a resolved file. Pack names contain their hash and Vite's
 * assets/ files are hashed, so those never change; everything else (index.html,
 * the manifest) is revalidated on every load.
 * @param {'app' | 'packs'} kind
 * @param {string} rel
 */
function cacheControlFor(kind, rel) {
  const immutable = kind === 'packs' ? rel !== 'manifest.json' : rel.startsWith('assets/');
  return immutable ? 'public, max-age=31536000, immutable, no-transform' : 'no-cache, no-transform';
}

/**
 * The response headers of a file (never a Content-Encoding).
 * @param {'app' | 'packs'} kind
 * @param {string} rel
 * @param {{ size: number, mtimeMs: number }} st
 * @returns {Record<string, string>}
 */
function headersFor(kind, rel, st) {
  return {
    'Content-Type': mimeFor(rel),
    'Content-Length': String(st.size),
    'Cache-Control': cacheControlFor(kind, rel),
    ETag: `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
    'X-Content-Type-Options': 'nosniff',
  };
}

const text = (status, body, extra = {}) =>
  new Response(body, { status, headers: { 'Content-Type': TEXT('text/plain'), 'X-Content-Type-Options': 'nosniff', ...extra } });

/**
 * A handler for `protocol.handle('gatehouse', handler)`: Request -> Response.
 * `roots` may be a function so the folders can be looked up on every request.
 * @param {Roots | (() => Roots)} roots
 * @returns {(request: Request) => Promise<Response>}
 */
function createHandler(roots) {
  return async function handle(request) {
    try {
      const r = resolveUrl(request.url, typeof roots === 'function' ? roots() : roots);
      if (r.status !== 200) return text(r.status, r.status === 400 ? 'Bad request' : 'Not found');
      const method = request.method.toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return text(405, 'Method not allowed', { Allow: 'GET, HEAD' });

      // Follow symlinks and check again: a link inside a root must not lead out of it.
      let real;
      let st;
      try {
        const [rootReal, fileReal] = await Promise.all([fs.promises.realpath(r.root), fs.promises.realpath(r.file)]);
        if (!isInside(rootReal, fileReal)) return text(404, 'Not found');
        real = fileReal;
        st = await fs.promises.stat(real);
      } catch {
        return text(404, r.kind === 'packs' ? `${r.rel} not found: run "npm run toolchain:fetch" and "npm run toolchain:packs".` : 'Not found');
      }
      if (!st.isFile()) return text(404, 'Not found');

      const headers = headersFor(r.kind, r.rel, st);
      const inm = request.headers.get('if-none-match');
      if (inm && inm.split(',').some((t) => t.trim() === headers.ETag || t.trim() === '*')) {
        return new Response(null, { status: 304, headers: { ETag: headers.ETag, 'Cache-Control': headers['Cache-Control'] } });
      }
      if (method === 'HEAD') return new Response(null, { status: 200, headers });
      return new Response(/** @type {ReadableStream} */ (Readable.toWeb(fs.createReadStream(real))), { status: 200, headers });
    } catch (e) {
      console.error('gatehouse protocol:', e);
      return text(500, 'Internal error');
    }
  };
}

module.exports = {
  SCHEME,
  HOST,
  ORIGIN,
  PACKS_SEGMENT,
  MIME,
  mimeFor,
  pathnameOf,
  splitPath,
  isInside,
  resolveUrl,
  isAppUrl,
  cacheControlFor,
  headersFor,
  createHandler,
};
