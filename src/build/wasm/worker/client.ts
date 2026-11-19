// UI-thread side of the compile Worker. One request at a time (a queue),
// ids on every message, progress and download events relayed, an inactivity
// timeout (no message from the Worker for `timeoutMs`: the Worker is
// replaced and the build fails with "Build timed out"), and the Worker is
// recycled (terminated, a new one made lazily) after a fatal error and every
// `recycleAfter` builds. Successful results are remembered by content, so
// building unchanged sources again is instant.
// Also answers getCompilerStatus() for the loading screen (manifest + offline
// cache lookups on this thread; the pack bytes are only ever loaded in the Worker).

import { contentHash } from '../cache';
import type { BuildMessage } from '../diagnostics';
import type { CompileProgress, CompileResult } from '../pipeline';
import { getBoardProfile } from '../profiles';
import type { SketchInput } from '../sketch';
import type { CompileWith } from '../wasmcompiler';
import {
  DEFAULT_PACKS_URL, PackLoader, platformCaches, platformGunzip, type CompilerStatus, type DownloadProgress,
} from './packs';
import type { WorkerRequest, WorkerResponse } from './protocol';

/** What the client needs of a Worker (the real one fits; tests use a fake). */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export interface CompileHandlers {
  onProgress?: (p: CompileProgress) => void;
  onDownload?: (d: DownloadProgress) => void;
}

export interface WasmCompilerClientOptions {
  createWorker?: () => WorkerLike;
  /** Folder with manifest.json and the packs; relative URLs resolve against the page. Default /toolchain-packs/. */
  baseUrl?: string;
  /** Inactivity timeout per request, ms (default 60 s). */
  timeoutMs?: number;
  /** Replace the Worker after this many builds (default 50). */
  recycleAfter?: number;
  /** For getCompilerStatus(); null: always 'unavailable'. Default: one made from the platform's fetch and caches. */
  statusLoader?: PackLoader | null;
}

export const BUILD_TIMED_OUT = 'Build timed out: the compiler made no progress for a minute and was restarted. Try again.';

/**
 * Resolve the packs folder against the page; null where packs cannot be fetched
 * (file://, no fetch). http(s) is a web host; `gatehouse:` is the scheme the
 * Electron shell serves the app and the packs from (main.js, electron/staticserve.cjs).
 */
export function resolvePacksUrl(base: string = DEFAULT_PACKS_URL): string | null {
  try {
    const href = (globalThis as { location?: { href: string } }).location?.href;
    const url = href ? new URL(base, href) : new URL(base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'gatehouse:') return null;
    if (typeof fetch !== 'function') return null;
    return url.href.endsWith('/') ? url.href : `${url.href}/`;
  } catch {
    return null;
  }
}

const defaultWorker = (): WorkerLike =>
  new Worker(new URL('./compiler.worker.ts', import.meta.url), { type: 'module', name: 'gatehouse-compiler' }) as unknown as WorkerLike;

export const failedResult = (message: string): CompileResult => {
  const m: BuildMessage = { severity: 'error', message, raw: message };
  return { ok: false, messages: [m], errors: [`error: ${message}`], timings: { prepareMs: 0, compileMs: 0, linkMs: 0, totalMs: 0, units: [] } };
};

type Outcome =
  | { kind: 'final'; msg: Extract<WorkerResponse, { type: 'result' | 'prefetched' }> }
  | { kind: 'crash'; message: string }
  | { kind: 'timeout' };

interface Pending {
  id: number;
  onMessage(m: WorkerResponse): void;
  onCrash(message: string): void;
}

const RESULT_CACHE_SIZE = 8;

export class WasmCompilerClient {
  readonly baseUrl: string | null;
  private readonly timeoutMs: number;
  private readonly recycleAfter: number;
  private readonly createWorker: () => WorkerLike;
  private readonly statusLoader: PackLoader | null;
  private worker: WorkerLike | null = null;
  private pending: Pending | null = null;
  private builds = 0;
  private nextId = 1;
  private tail: Promise<unknown> = Promise.resolve();
  /** Packs the current Worker holds in memory (status in memory-only mode). */
  private readonly workerPacks = new Set<string>();
  private readonly results = new Map<string, CompileResult>();
  /** Workers created so far (for tests and diagnostics). */
  workersCreated = 0;

  constructor(options: WasmCompilerClientOptions = {}) {
    this.baseUrl = resolvePacksUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.recycleAfter = options.recycleAfter ?? 50;
    this.createWorker = options.createWorker ?? defaultWorker;
    this.statusLoader =
      options.statusLoader !== undefined
        ? options.statusLoader
        : this.baseUrl
          ? new PackLoader({ baseUrl: this.baseUrl, fetch: (u, i) => fetch(u, i), caches: platformCaches(), gunzip: platformGunzip() })
          : null;
  }

  /** Can this board profile be compiled here, and is a download needed first? Never throws. */
  async getCompilerStatus(profileId = 'uno'): Promise<CompilerStatus> {
    const profile = getBoardProfile(profileId);
    if (!profile) return { status: 'unavailable', reason: `No board profile '${profileId}'.` };
    if (!this.baseUrl || !this.statusLoader) return { status: 'unavailable', reason: 'The compiler files are not served here.' };
    try {
      return await this.statusLoader.status(profile.mcu, (p) => this.workerPacks.has(p.name));
    } catch (e) {
      return { status: 'unavailable', reason: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Download (or load from the offline cache) what a profile needs, with progress. Never throws. */
  prefetch(profileId = 'uno', onDownload?: (d: DownloadProgress) => void): Promise<{ ok: boolean; error?: string }> {
    return this.enqueue(async () => {
      if (!this.baseUrl) return { ok: false, error: 'The compiler files are not served here.' };
      const o = await this.exchange({ type: 'prefetch', baseUrl: this.baseUrl, profileId }, { onDownload });
      if (o.kind === 'timeout') return { ok: false, error: BUILD_TIMED_OUT };
      if (o.kind === 'crash') return { ok: false, error: o.message };
      if (o.msg.type !== 'prefetched') return { ok: false, error: 'Unexpected answer from the compiler.' };
      if (o.msg.fatal) this.recycle();
      return o.msg.ok ? { ok: true } : { ok: false, error: o.msg.error };
    });
  }

  /** Compile a sketch in the Worker. Never throws: problems come back as a failed result. */
  compile(sketch: SketchInput, profileId: string, handlers: CompileHandlers = {}): Promise<CompileResult> {
    return this.enqueue(async () => {
      if (!this.baseUrl) return failedResult('The compiler files are not served here.');
      const key = await contentHash([
        'gatehouse-build-v1', this.baseUrl, profileId, sketch.sketchName ?? '',
        ...Object.entries(sketch.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).flat(),
      ]);
      const known = this.results.get(key);
      if (known) {
        this.results.delete(key);
        this.results.set(key, known);
        handlers.onProgress?.({ phase: 'done', message: 'Done (unchanged)' });
        return known;
      }
      const o = await this.exchange({ type: 'compile', baseUrl: this.baseUrl, sketch: { ...sketch, files: { ...sketch.files } }, profileId }, handlers);
      if (o.kind === 'timeout') return failedResult(BUILD_TIMED_OUT);
      if (o.kind === 'crash') return failedResult(o.message);
      if (o.msg.type !== 'result') return failedResult('Unexpected answer from the compiler.');
      this.builds++;
      if (o.msg.fatal || this.builds >= this.recycleAfter) this.recycle();
      const result = o.msg.result;
      if (result.ok) {
        this.results.set(key, result);
        while (this.results.size > RESULT_CACHE_SIZE) this.results.delete(this.results.keys().next().value as string);
      }
      return result;
    });
  }

  /** For WasmAvrCompiler's `compileWith`. */
  readonly compileWith: CompileWith = (sketch, profile, options) =>
    this.compile(sketch, profile.id, { onProgress: options.onProgress, onDownload: options.onDownload });

  /** Stop the Worker now (a running request fails); the next request makes a new one. */
  terminate(): void {
    this.pending?.onCrash('The compiler was stopped.');
    this.recycle();
  }

  private recycle(): void {
    const w = this.worker;
    this.worker = null;
    this.builds = 0;
    this.workerPacks.clear();
    if (w) {
      w.onmessage = null;
      w.onerror = null;
      w.terminate();
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn, fn);
    this.tail = p.catch(() => undefined);
    return p;
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const w = this.createWorker();
    this.workersCreated++;
    w.onmessage = (e) => {
      const m = e.data;
      if (this.pending && m && m.id === this.pending.id) this.pending.onMessage(m);
    };
    w.onerror = (e) => {
      e?.preventDefault?.();
      const p = this.pending;
      this.recycle();
      p?.onCrash(`The compiler stopped unexpectedly${e?.message ? `: ${e.message}` : ''}.`);
    };
    this.worker = w;
    return w;
  }

  private exchange(body: Omit<Extract<WorkerRequest, { type: 'compile' }>, 'id'> | Omit<Extract<WorkerRequest, { type: 'prefetch' }>, 'id'>, handlers: CompileHandlers): Promise<Outcome> {
    return new Promise<Outcome>((resolve) => {
      let worker: WorkerLike;
      try {
        worker = this.ensureWorker();
      } catch (e) {
        resolve({ kind: 'crash', message: `The compiler could not start: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }
      const id = this.nextId++;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (o: Outcome): void => {
        clearTimeout(timer);
        if (this.pending?.id === id) this.pending = null;
        resolve(o);
      };
      const arm = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          this.recycle();
          finish({ kind: 'timeout' });
        }, this.timeoutMs);
      };
      this.pending = {
        id,
        onMessage: (m) => {
          if (m.type === 'progress') {
            arm();
            handlers.onProgress?.(m.progress);
          } else if (m.type === 'download') {
            arm();
            if (m.download.loadedBytes >= m.download.totalBytes) this.workerPacks.add(m.download.pack);
            handlers.onDownload?.(m.download);
          } else finish({ kind: 'final', msg: m });
        },
        onCrash: (message) => finish({ kind: 'crash', message }),
      };
      arm();
      try {
        worker.postMessage({ ...body, id } as WorkerRequest);
      } catch (e) {
        this.recycle();
        finish({ kind: 'crash', message: `The compiler could not be reached: ${e instanceof Error ? e.message : String(e)}` });
      }
    });
  }
}
