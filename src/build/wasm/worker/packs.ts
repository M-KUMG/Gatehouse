// Loads the toolchain packs (docs/toolchain-packs.md) with byte progress, a
// sha256 check against manifest.json and an offline copy in Cache Storage
// (keyed by pack name + sha256, so a cached pack is never stale; entries a
// new manifest no longer names are deleted). Without Cache Storage (private
// mode, file://) it keeps the packs in memory only and still builds.
// Runs in the Worker (loading) and on the UI thread (status only). fetch,
// Cache Storage, gunzip and sha256 are injected for tests. No DOM.

import type { DownloadProgress } from '../../compiler';
import { PackError, readPack, sha256Hex, type PackReader } from './packreader';

export type { DownloadProgress };

/** Where the dev server (vite.config.ts) serves toolchain/packs/. */
export const DEFAULT_PACKS_URL = '/toolchain-packs/';
export const PACK_CACHE_NAME = 'gatehouse-packs';
const KEY_ORIGIN = 'https://gatehouse.invalid';
/** The last manifest fetched, for offline use. */
export const MANIFEST_CACHE_KEY = `${KEY_ORIGIN}/manifest.json`;

export const packCacheKey = (name: string, sha256: string): string => `${KEY_ORIGIN}/pack/${encodeURIComponent(name)}/${sha256}`;

export function parsePackCacheKey(url: string): { name: string; sha256: string } | null {
  const m = /^https:\/\/gatehouse\.invalid\/pack\/([^/]+)\/([0-9a-f]{64})$/.exec(url);
  return m ? { name: decodeURIComponent(m[1]), sha256: m[2] } : null;
}

export interface PackEntry {
  name: string;
  kind: 'compiler' | 'board' | 'library' | string;
  version: string;
  /** For library packs: the Arduino library name ("Wire") and its top-level headers. */
  library?: string;
  includes?: string[];
  dependencies: string[];
  file: string;
  fileGz: string;
  size: { raw: number; gzip: number; brotli?: number };
  /** sha256 of the raw .pack. */
  sha256: string;
}

export interface PackManifest {
  schema: number;
  packs: PackEntry[];
}

/** Check a parsed manifest.json; throws PackError when it is not one. */
export function parseManifest(json: unknown): PackManifest {
  const m = json as Partial<PackManifest> | null;
  if (!m || typeof m !== 'object' || m.schema !== 1 || !Array.isArray(m.packs)) throw new PackError('not a toolchain pack manifest (schema 1)');
  for (const p of m.packs) {
    const ok =
      p && typeof p.name === 'string' && typeof p.file === 'string' && typeof p.fileGz === 'string' &&
      /^[0-9a-f]{64}$/.test(p.sha256) && Array.isArray(p.dependencies) && p.size && Number.isSafeInteger(p.size.raw) && Number.isSafeInteger(p.size.gzip) &&
      /^[\w.-]+$/.test(p.file) && /^[\w.-]+$/.test(p.fileGz);
    if (!ok) throw new PackError(`bad manifest entry ${JSON.stringify(p?.name)}`);
  }
  return m as PackManifest;
}

/** The board pack of an MCU ("atmega328p" -> "board-atmega328p"). */
export const boardPackName = (mcu: string): string => `board-${mcu}`;

/** The packs `roots` need, dependencies first. Throws PackError for a name the manifest lacks. */
export function packClosure(manifest: PackManifest, roots: readonly string[]): PackEntry[] {
  const byName = new Map(manifest.packs.map((p) => [p.name, p]));
  const out: PackEntry[] = [];
  const seen = new Set<string>();
  const visit = (name: string, depth: number): void => {
    if (seen.has(name)) return;
    const p = byName.get(name);
    if (!p) throw new PackError(`the toolchain has no pack named ${name}`);
    if (depth > 16) throw new PackError(`pack dependencies too deep at ${name}`);
    seen.add(name);
    for (const d of p.dependencies) visit(d, depth + 1);
    out.push(p);
  };
  for (const r of roots) visit(r, 0);
  return out;
}

/** Names of the library packs for these Arduino library names (unknown ones are skipped: the compiler reports them). */
export function libraryPackNames(manifest: PackManifest, libraries: readonly string[]): string[] {
  const want = new Set(libraries);
  return manifest.packs.filter((p) => p.kind === 'library' && p.library !== undefined && want.has(p.library)).map((p) => p.name);
}

export type CompilerStatus =
  | { status: 'ready' }
  | { status: 'needs-download'; /** Bytes still to transfer. */ downloadBytes: number; packs: string[] }
  | { status: 'unavailable'; reason: string };

/**
 * Pure status logic. `manifest` null: not reachable and no cached copy.
 * `fresh`: the manifest came from the server just now (else from the cache).
 */
export function compilerStatus(args: {
  manifest: PackManifest | null; fresh: boolean; needed: readonly PackEntry[]; present: (p: PackEntry) => boolean; gzip: boolean;
}): CompilerStatus {
  if (!args.manifest) return { status: 'unavailable', reason: 'The compiler files cannot be reached and none are stored for offline use.' };
  const missing = args.needed.filter((p) => !args.present(p));
  if (missing.length === 0) return { status: 'ready' };
  if (!args.fresh) return { status: 'unavailable', reason: 'Offline, and the compiler files are not stored for offline use yet.' };
  return {
    status: 'needs-download',
    downloadBytes: missing.reduce((n, p) => n + (args.gzip ? p.size.gzip : p.size.raw), 0),
    packs: missing.map((p) => p.name),
  };
}

// ---------------------------------------------------------------------------

/** The parts of Cache / CacheStorage the loader uses (the real ones fit). */
export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
  delete(key: string): Promise<boolean>;
  keys(): Promise<readonly { url: string }[]>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface PackLoaderOptions {
  /** Folder URL with manifest.json and the packs (absolute, or relative to the page in a browser). */
  baseUrl: string;
  fetch: FetchLike;
  /** Cache Storage; null/undefined, or failing to open: memory only. */
  caches?: CacheStorageLike | null;
  /** gunzip; null: download the raw .pack instead of the .pack.gz. */
  gunzip?: ((data: Uint8Array) => Promise<Uint8Array>) | null;
  sha256?: (data: Uint8Array) => Promise<string>;
  /** How long to wait before asking the server again after the manifest could not be fetched (ms). */
  manifestRetryMs?: number;
  now?: () => number;
}

export interface LoadedPack {
  entry: PackEntry;
  bytes: Uint8Array;
  reader: PackReader;
}

/** gunzip with the platform's DecompressionStream, or null when there is none. */
export function platformGunzip(): ((data: Uint8Array) => Promise<Uint8Array>) | null {
  if (typeof DecompressionStream === 'undefined') return null;
  return async (data) => {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
}

/** The platform's Cache Storage, or null. */
export function platformCaches(): CacheStorageLike | null {
  const c = (globalThis as { caches?: CacheStorageLike }).caches;
  return c && typeof c.open === 'function' ? c : null;
}

/** Read a response body, reporting bytes as they arrive (at most every 64 KiB, and at the end). */
export async function readWithProgress(res: Response, onBytes: (loaded: number) => void): Promise<Uint8Array> {
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    onBytes(all.length);
    return all;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (loaded - reported >= 65536) {
      reported = loaded;
      onBytes(loaded);
    }
  }
  if (reported !== loaded || loaded === 0) onBytes(loaded);
  const out = new Uint8Array(loaded);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

const joinUrl = (base: string, file: string): string => (base.endsWith('/') ? base + file : `${base}/${file}`);

export class PackLoader {
  private readonly gunzip: ((data: Uint8Array) => Promise<Uint8Array>) | null;
  private readonly sha: (data: Uint8Array) => Promise<string>;
  private readonly memory = new Map<string, LoadedPack>();
  private cachePromise: Promise<CacheLike | null> | undefined;
  private fresh: PackManifest | undefined;
  private inflight: Promise<{ manifest: PackManifest; fresh: boolean } | null> | undefined;
  private lastFailure = -Infinity;

  constructor(private readonly options: PackLoaderOptions) {
    this.gunzip = options.gunzip === undefined ? platformGunzip() : options.gunzip;
    this.sha = options.sha256 ?? sha256Hex;
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  /** The Cache Storage cache, or null for memory only (never throws). */
  cache(): Promise<CacheLike | null> {
    this.cachePromise ??= (async () => {
      try {
        return this.options.caches ? await this.options.caches.open(PACK_CACHE_NAME) : null;
      } catch {
        return null; // private mode, opaque origin...
      }
    })();
    return this.cachePromise;
  }

  /** The manifest: fetched (fresh) once per loader, else the cached copy, else null. */
  manifest(): Promise<{ manifest: PackManifest; fresh: boolean } | null> {
    if (this.fresh) return Promise.resolve({ manifest: this.fresh, fresh: true });
    this.inflight ??= this.loadManifest().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async loadManifest(): Promise<{ manifest: PackManifest; fresh: boolean } | null> {
    const now = (this.options.now ?? Date.now)();
    if (now - this.lastFailure >= (this.options.manifestRetryMs ?? 10_000)) {
      try {
        const res = await this.options.fetch(joinUrl(this.options.baseUrl, 'manifest.json'), { cache: 'no-cache' });
        if (!res.ok) throw new PackError(`HTTP ${res.status}`);
        const text = await res.text();
        const manifest = parseManifest(JSON.parse(text));
        this.fresh = manifest;
        await this.afterFreshManifest(manifest, text);
        return { manifest, fresh: true };
      } catch {
        this.lastFailure = now;
      }
    }
    const cache = await this.cache();
    try {
      const hit = await cache?.match(MANIFEST_CACHE_KEY);
      return hit ? { manifest: parseManifest(JSON.parse(await hit.text())), fresh: false } : null;
    } catch {
      return null;
    }
  }

  /** Keep the manifest for offline use and drop cached packs it no longer names. */
  private async afterFreshManifest(manifest: PackManifest, text: string): Promise<void> {
    const cache = await this.cache();
    if (!cache) return;
    try {
      await cache.put(MANIFEST_CACHE_KEY, new Response(text, { headers: { 'Content-Type': 'application/json' } }));
      const keep = new Set(manifest.packs.map((p) => packCacheKey(p.name, p.sha256)));
      for (const req of await cache.keys()) {
        if (parsePackCacheKey(req.url) && !keep.has(req.url)) await cache.delete(req.url);
      }
    } catch {
      // quota or a broken cache: the build still works from memory
    }
  }

  /** Download size of a pack (what progress counts). */
  transferSize(p: PackEntry): number {
    return this.gunzip ? p.size.gzip : p.size.raw;
  }

  /** Is the pack in memory or in the offline cache? */
  async present(p: PackEntry): Promise<boolean> {
    if (this.memory.get(p.name)?.entry.sha256 === p.sha256) return true;
    const cache = await this.cache();
    try {
      return Boolean(await cache?.match(packCacheKey(p.name, p.sha256)));
    } catch {
      return false;
    }
  }

  /** Status for building a board of this MCU (base packs only; libraries come on demand). */
  async status(mcu: string, alsoPresent: (p: PackEntry) => boolean = () => false): Promise<CompilerStatus> {
    const m = await this.manifest();
    if (!m) return compilerStatus({ manifest: null, fresh: false, needed: [], present: () => false, gzip: Boolean(this.gunzip) });
    let needed: PackEntry[];
    try {
      needed = packClosure(m.manifest, [boardPackName(mcu)]);
    } catch (e) {
      return { status: 'unavailable', reason: e instanceof Error ? e.message : String(e) };
    }
    const here = new Set<string>();
    for (const p of needed) if (alsoPresent(p) || (await this.present(p))) here.add(p.name);
    return compilerStatus({ manifest: m.manifest, fresh: m.fresh, needed, present: (p) => here.has(p.name), gzip: Boolean(this.gunzip) });
  }

  /** Load packs by name (resolve the closure first), from memory, the cache, or the network. */
  async load(entries: readonly PackEntry[], onProgress: (d: DownloadProgress) => void = () => {}): Promise<Map<string, LoadedPack>> {
    const out = new Map<string, LoadedPack>();
    for (const entry of entries) out.set(entry.name, await this.loadOne(entry, onProgress));
    return out;
  }

  private async loadOne(entry: PackEntry, onProgress: (d: DownloadProgress) => void): Promise<LoadedPack> {
    const mem = this.memory.get(entry.name);
    if (mem && mem.entry.sha256 === entry.sha256) {
      onProgress({ pack: entry.name, loadedBytes: entry.size.raw, totalBytes: entry.size.raw, fromCache: true });
      return mem;
    }
    let bytes = await this.fromCache(entry);
    if (bytes) {
      onProgress({ pack: entry.name, loadedBytes: bytes.length, totalBytes: bytes.length, fromCache: true });
    } else {
      bytes = await this.download(entry, onProgress, false).catch((e: unknown) => {
        if (!(e instanceof PackError)) throw e;
        return this.download(entry, onProgress, true); // one retry, past any HTTP cache
      });
      await this.store(entry, bytes);
    }
    const loaded = { entry, bytes, reader: readPack(bytes) };
    this.memory.set(entry.name, loaded);
    return loaded;
  }

  private async fromCache(entry: PackEntry): Promise<Uint8Array | null> {
    const cache = await this.cache();
    if (!cache) return null;
    const key = packCacheKey(entry.name, entry.sha256);
    try {
      const hit = await cache.match(key);
      if (!hit) return null;
      const bytes = new Uint8Array(await hit.arrayBuffer());
      if ((await this.sha(bytes)) === entry.sha256) return bytes;
      await cache.delete(key); // damaged: fetch again
    } catch {
      // unreadable entry: fetch again
    }
    return null;
  }

  private async download(entry: PackEntry, onProgress: (d: DownloadProgress) => void, retry: boolean): Promise<Uint8Array> {
    const gz = this.gunzip !== null;
    const file = gz ? entry.fileGz : entry.file;
    const total = this.transferSize(entry);
    let res: Response;
    try {
      res = await this.options.fetch(joinUrl(this.options.baseUrl, file), retry ? { cache: 'reload' } : undefined);
    } catch (e) {
      throw new Error(`Could not download ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) throw new PackError(`Could not download ${file}: HTTP ${res.status}`);
    onProgress({ pack: entry.name, loadedBytes: 0, totalBytes: total, fromCache: false });
    const body = await readWithProgress(res, (loaded) => onProgress({ pack: entry.name, loadedBytes: loaded, totalBytes: total, fromCache: false }));
    let bytes: Uint8Array;
    try {
      bytes = gz ? await this.gunzip!(body) : body;
    } catch (e) {
      throw new PackError(`${file} is not valid gzip: ${e instanceof Error ? e.message : String(e)}`);
    }
    const got = await this.sha(bytes);
    if (got !== entry.sha256) throw new PackError(`${file} is damaged: its sha256 does not match the manifest`);
    return bytes;
  }

  private async store(entry: PackEntry, bytes: Uint8Array): Promise<void> {
    const cache = await this.cache();
    if (!cache) return;
    try {
      await cache.put(packCacheKey(entry.name, entry.sha256), new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'application/octet-stream' } }));
      for (const req of await cache.keys()) {
        const k = parsePackCacheKey(req.url);
        if (k && k.name === entry.name && k.sha256 !== entry.sha256) await cache.delete(req.url);
      }
    } catch {
      // quota exceeded or no write access: keep it in memory only
    }
  }

  /** Packs held in memory by name. */
  loaded(name: string): LoadedPack | undefined {
    return this.memory.get(name);
  }
}
