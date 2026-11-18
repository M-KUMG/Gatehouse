// The build seam: what turns a board's files into the program it runs.
// Callers (the board runtime) only see Compiler / buildFirmware and never
// care where the hex came from. Which one builds a board: see registry.ts.
//
// Real compilers go here: an in-browser (WASM) toolchain, arduino-cli in the
// Electron app, or a build server. Each implements Compiler and is added with
// registerCompiler(boardTypeId, compiler); nothing else changes.

import type { BuildMessage } from './wasm/diagnostics';

/** Bytes of one toolchain pack arriving (from the network or the offline cache). */
export interface DownloadProgress {
  /** Pack name, e.g. "compiler". */
  pack: string;
  loadedBytes: number;
  totalBytes: number;
  /** Served from the offline cache (or memory), no download. */
  fromCache: boolean;
}

/** What a compiler reports while it works (optional; the firmware-file compiler reports nothing). */
export type BuildEvent =
  | { kind: 'progress'; phase: string; message: string; current?: number; total?: number }
  | { kind: 'download'; download: DownloadProgress };

/** What a build gets: the board type and its files (path -> text). */
export interface BuildInput {
  boardTypeId: string;
  files: Readonly<Record<string, string>>;
  /** Called with progress and download events during the build. */
  onEvent?: (e: BuildEvent) => void;
}

export interface BuildSize {
  flashBytes: number;
  flashMax: number;
  ramBytes: number;
  ramMax: number;
}

/** Optional details a real compiler adds (callers that do not know them ignore them). */
export interface BuildDetails {
  /** Every message with file, line and column. */
  buildMessages?: BuildMessage[];
  size?: BuildSize;
}

export type BuildResult =
  | ({
      ok: true;
      /** Intel HEX text to load into the board's flash. */
      hex: string;
      /** Taken from a .hex file in the folder, or compiled from the sketch. */
      source: 'firmware-file' | 'compiled';
      /** What ran, for people: the hex file's path, or the sketch that was compiled. */
      name: string;
      /** Notes for people (warnings, "not compiled" hints). */
      messages: string[];
    } & BuildDetails)
  | ({ ok: false; errors: string[] } & BuildDetails);

export interface Compiler {
  id: string;
  /** False when it cannot build right now (offline, toolchain missing...). */
  available(): boolean | Promise<boolean>;
  build(input: BuildInput): Promise<BuildResult>;
}
