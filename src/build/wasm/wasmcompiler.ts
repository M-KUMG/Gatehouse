// The browser compiler behind the build seam (see ../compiler.ts): compiles
// a board's sketch with the WebAssembly AVR toolchain. Either through an
// injected ToolRunner (compileSketch runs here; Node tests) or through
// `compileWith` (the compile Worker client runs compileSketch in the Worker).
// Registered for the AVR boards in src/build/wasm/worker/register.ts.

import type { BuildInput, BuildResult, Compiler, DownloadProgress } from '../compiler';
import { MemoryObjectCache, type ObjectCache } from './cache';
import { formatMessage, type BuildMessage } from './diagnostics';
import { compileSketch, type CompileOptions, type CompileProgress, type CompileResult } from './pipeline';
import { getBoardProfile, type BoardProfile } from './profiles';
import type { SketchInput } from './sketch';
import type { ToolRunner } from './toolrunner';

/** BuildResult with the structured messages (kept for existing callers; the fields live in BuildDetails). */
export type WasmBuildResult = BuildResult;

/** Compile options plus download progress (for a compiler that fetches its toolchain first). */
export interface RemoteCompileOptions extends CompileOptions {
  onDownload?: (d: DownloadProgress) => void;
}

/** Runs the compile core somewhere else (the Worker) and returns its result. */
export type CompileWith = (sketch: SketchInput, profile: BoardProfile, options: RemoteCompileOptions) => Promise<CompileResult>;

export interface WasmAvrCompilerOptions {
  /** Creates (or returns a shared) runner; compileSketch then runs on this thread. */
  runner?: () => ToolRunner | Promise<ToolRunner>;
  /** Runs the compile elsewhere (wins over `runner`). */
  compileWith?: CompileWith;
  /** Board type id -> profile (defaults to the profile with the same id). */
  profileFor?: (boardTypeId: string) => BoardProfile | undefined;
  /** False while the toolchain cannot be used (offline and not cached...). Defaults to true. */
  available?: () => boolean | Promise<boolean>;
  cache?: ObjectCache;
  onProgress?: (p: CompileProgress) => void;
}

export class WasmAvrCompiler implements Compiler {
  readonly id = 'wasm-avr-gcc';
  private readonly cache: ObjectCache;

  constructor(private readonly options: WasmAvrCompilerOptions) {
    if (!options.runner && !options.compileWith) throw new Error('WasmAvrCompiler needs a runner or compileWith');
    this.cache = options.cache ?? new MemoryObjectCache();
  }

  available(): boolean | Promise<boolean> {
    return this.options.available ? this.options.available() : true;
  }

  /** Compile with the full result (hex, sizes, structured messages, timings). */
  async compile(input: BuildInput, sketchName?: string): Promise<CompileResult | { ok: false; messages: BuildMessage[]; errors: string[] }> {
    const profile = (this.options.profileFor ?? getBoardProfile)(input.boardTypeId);
    if (!profile) {
      const message = `The browser compiler cannot build boards of type '${input.boardTypeId}'.`;
      return { ok: false, messages: [{ severity: 'error', message, raw: message }], errors: [message] };
    }
    const onProgress = (p: CompileProgress): void => {
      this.options.onProgress?.(p);
      input.onEvent?.({ kind: 'progress', ...p });
    };
    const onDownload = (download: DownloadProgress): void => input.onEvent?.({ kind: 'download', download });
    const sketch: SketchInput = { files: input.files, profileId: profile.id, sketchName };
    if (this.options.compileWith) return this.options.compileWith(sketch, profile, { onProgress, onDownload });
    const runner = await this.options.runner!();
    return compileSketch(sketch, profile, runner, { cache: this.cache, onProgress });
  }

  async build(input: BuildInput): Promise<BuildResult> {
    const r = await this.compile(input);
    if (!r.ok) return { ok: false, errors: r.errors, buildMessages: r.messages };
    return {
      ok: true,
      hex: r.hex,
      source: 'compiled',
      name: r.firmwareName.replace(/\.hex$/, ''),
      messages: r.messages.filter((m) => m.severity !== 'error').map(formatMessage),
      buildMessages: r.messages,
      size: { flashBytes: r.flashBytes, flashMax: r.flashMax, ramBytes: r.ramBytes, ramMax: r.ramMax },
    };
  }
}
