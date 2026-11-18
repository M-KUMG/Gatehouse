// The browser compiler behind the build seam (see ../compiler.ts): compiles
// a board's sketch with the WebAssembly AVR toolchain through an injected
// ToolRunner. NOT registered anywhere yet: the Worker integration registers
// it (registerCompiler('uno', ...)) once a runner can be created in the app.

import type { BuildInput, BuildResult, Compiler } from '../compiler';
import { MemoryObjectCache, type ObjectCache } from './cache';
import { formatMessage, type BuildMessage } from './diagnostics';
import { compileSketch, type CompileProgress, type CompileResult } from './pipeline';
import { getBoardProfile, type BoardProfile } from './profiles';
import type { ToolRunner } from './toolrunner';

/** BuildResult plus the structured messages (optional field: existing callers ignore it). */
export type WasmBuildResult = BuildResult & { buildMessages?: BuildMessage[] };

export interface WasmAvrCompilerOptions {
  /** Creates (or returns a shared) runner; may download the toolchain the first time. */
  runner: () => ToolRunner | Promise<ToolRunner>;
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
    const runner = await this.options.runner();
    return compileSketch({ files: input.files, profileId: profile.id, sketchName }, profile, runner, {
      cache: this.cache, onProgress: this.options.onProgress,
    });
  }

  async build(input: BuildInput): Promise<WasmBuildResult> {
    const r = await this.compile(input);
    if (!r.ok) return { ok: false, errors: r.errors, buildMessages: r.messages };
    return {
      ok: true,
      hex: r.hex,
      source: 'compiled',
      name: r.firmwareName.replace(/\.hex$/, ''),
      messages: r.messages.filter((m) => m.severity !== 'error').map(formatMessage),
      buildMessages: r.messages,
    };
  }
}
