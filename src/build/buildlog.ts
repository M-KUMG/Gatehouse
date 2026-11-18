// The build output of each board (by part id), for the Build output window
// and the loading screen: status, progress, downloads, every compiler message,
// sizes and timings. Written by the board runtime (src/mcu/runtime.ts) during
// builds, kept until the board's next build, removed with the board.
// DOM-free publish/subscribe.

import type { DownloadProgress } from './compiler';
import type { BuildMessage } from './wasm/diagnostics';

export type BuildStatus = 'idle' | 'downloading' | 'building' | 'succeeded' | 'failed';

export interface BuildProgress {
  /** 'download' while packs arrive, else the compile core's phase: 'prepare' | 'compile' | 'link' | 'done'. */
  phase: string;
  message: string;
  current?: number;
  total?: number;
}

export interface BoardBuildState {
  status: BuildStatus;
  progress?: BuildProgress;
  /** One entry per pack, latest figures. */
  downloads: DownloadProgress[];
  messages: BuildMessage[];
  /** One line for people: "Compiled main.ino: 1064 bytes ...", "Build failed: 2 errors", "Running firmware.hex". */
  summary: string;
  flashBytes?: number;
  flashMax?: number;
  ramBytes?: number;
  ramMax?: number;
  /** Date.now() values. */
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  source: 'compiled' | 'firmware-file' | null;
}

export const idleBuildState = (): BoardBuildState => ({ status: 'idle', downloads: [], messages: [], summary: '', source: null });

/** Listener: the part id that changed, or null when every board was cleared. */
export type BuildLogListener = (partId: number | null) => void;

export class BuildLog {
  private readonly states = new Map<number, BoardBuildState>();
  private readonly listeners: BuildLogListener[] = [];

  /** The board's build state ('idle' when it never built). The returned object is not live: call again after a change. */
  get(partId: number): BoardBuildState {
    const s = this.states.get(partId);
    return s ? { ...s, downloads: [...s.downloads], messages: [...s.messages] } : idleBuildState();
  }

  /** Merge `patch` into the board's state (missing board: from idle) and notify. */
  update(partId: number, patch: Partial<BoardBuildState>): void {
    this.states.set(partId, { ...(this.states.get(partId) ?? idleBuildState()), ...patch });
    this.emit(partId);
  }

  /** Record a pack's download figures (replaces the earlier entry of that pack). */
  download(partId: number, d: DownloadProgress): void {
    const s = this.states.get(partId) ?? idleBuildState();
    const downloads = s.downloads.filter((x) => x.pack !== d.pack);
    downloads.push({ ...d });
    const pct = d.totalBytes > 0 ? Math.floor((d.loadedBytes / d.totalBytes) * 100) : 100;
    this.update(partId, {
      downloads,
      ...(d.fromCache ? {} : { status: 'downloading' as const, progress: { phase: 'download', message: `Downloading compiler files: ${d.pack} (${pct}%)`, current: d.loadedBytes, total: d.totalBytes } }),
    });
  }

  /** Forget a board's build (deleted board). */
  clear(partId: number): void {
    if (this.states.delete(partId)) this.emit(partId);
  }

  /** Forget every board (another project loaded). */
  clearAll(): void {
    if (this.states.size === 0) return;
    this.states.clear();
    for (const fn of [...this.listeners]) fn(null);
  }

  /** Part ids with a build state. */
  boards(): number[] {
    return [...this.states.keys()];
  }

  onChange(fn: BuildLogListener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(partId: number): void {
    for (const fn of [...this.listeners]) fn(partId);
  }
}
