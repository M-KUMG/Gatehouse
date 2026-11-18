// The ToolRunner of the compile Worker: tools and sysroot come out of the
// loaded toolchain packs. Each tool's wasm is compiled ONCE into a
// WebAssembly.Module and its Emscripten glue imported once (from the pack
// bytes, through `loadGlue`); every run gets a fresh instance (see
// ../emscripten.ts). Tool memory: each binary declares ~24 MB initial memory
// (fixed in the wasm, it holds the tool's static data) and the glue grows it
// on demand up to 2 GB; a run that dies of memory exhaustion sets `outOfMemory`.
// No DOM, no Node: the loader functions are injected.

import { runEmscriptenTool, type EmscriptenFactory, type LoadedTool } from '../emscripten';
import type { SysrootSource, ToolName, ToolRequest, ToolResult, ToolRunner } from '../toolrunner';
import type { LoadedPack } from './packs';
import type { PackReader } from './packreader';

/** Imports a tool's glue module (.mjs bytes) and returns its default export. */
export type GlueLoader = (glue: Uint8Array, tool: ToolName) => Promise<EmscriptenFactory>;

/** Browser / Worker glue loader: a Blob URL and a dynamic import. */
export const blobGlueLoader: GlueLoader = async (glue) => {
  const url = URL.createObjectURL(new Blob([glue as Uint8Array<ArrayBuffer>], { type: 'text/javascript' }));
  try {
    const mod = (await import(/* @vite-ignore */ url)) as { default?: EmscriptenFactory };
    if (typeof mod.default !== 'function') throw new Error('the tool glue has no default export');
    return mod.default;
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** Pack paths that are never mounted: programs and licence texts. */
const NOT_MOUNTED = /^(tools|licenses)\//;

/**
 * The sysroot as the tools see it: every mountable file of the packs at
 * "/<pack path>". `aliases` maps a tools'-filesystem prefix to where the file
 * really is (the profile names the linker script under /sysroot/avr/lib/ldscripts,
 * the compiler pack ships it at /ldscripts).
 */
export class PackSysroot implements SysrootSource {
  private readonly files = new Map<string, Uint8Array>();
  private readonly sorted: string[];

  constructor(packs: Iterable<PackReader>, private readonly aliases: Readonly<Record<string, string>> = DEFAULT_ALIASES) {
    for (const pack of packs) {
      for (const f of pack.files) if (!NOT_MOUNTED.test(f.path)) this.files.set(`/${f.path}`, pack.get(f.path));
    }
    this.sorted = [...this.files.keys()].sort();
  }

  private real(path: string): string {
    for (const [from, to] of Object.entries(this.aliases)) if (path.startsWith(from)) return to + path.slice(from.length);
    return path;
  }

  list(path: string): Promise<readonly string[]> {
    const real = this.real(path);
    if (this.files.has(real)) return Promise.resolve([path]);
    const prefix = `${real.replace(/\/$/, '')}/`;
    return Promise.resolve(this.sorted.filter((p) => p.startsWith(prefix)).map((p) => path.replace(/\/$/, '') + p.slice(prefix.length - 1)));
  }

  read(path: string): Promise<Uint8Array> {
    const b = this.files.get(this.real(path));
    return b ? Promise.resolve(b) : Promise.reject(new Error(`The compiler's sysroot has no ${path}`));
  }
}

export const DEFAULT_ALIASES: Readonly<Record<string, string>> = { '/sysroot/avr/lib/ldscripts/': '/ldscripts/' };

/** The tools of a compiler pack, compiled and imported once. */
export class PackTools {
  private readonly loaded = new Map<ToolName, Promise<LoadedTool>>();
  /** WebAssembly.compile time per tool (first use), ms. */
  readonly compileMs: Partial<Record<ToolName, number>> = {};

  constructor(
    private readonly compiler: PackReader,
    private readonly loadGlue: GlueLoader = blobGlueLoader,
    private readonly compileWasm: (bytes: Uint8Array) => Promise<WebAssembly.Module> = (b) => WebAssembly.compile(b as Uint8Array<ArrayBuffer>),
  ) {}

  get(tool: ToolName): Promise<LoadedTool> {
    let p = this.loaded.get(tool);
    if (!p) {
      p = (async () => {
        const t0 = performance.now();
        const [factory, module] = await Promise.all([
          this.loadGlue(this.compiler.get(`tools/${tool}.mjs`), tool),
          this.compileWasm(this.compiler.get(`tools/${tool}.wasm`)),
        ]);
        this.compileMs[tool] = performance.now() - t0;
        return { factory, module };
      })();
      // A failed load is tried again next time.
      p.catch(() => this.loaded.delete(tool));
      this.loaded.set(tool, p);
    }
    return p;
  }
}

const OOM = /out of memory|\bOOM\b|cannot allocate (?:wasm )?memory|maximum memory size|cannot enlarge memory|memory allocation failed|virtual memory exhausted/i;

/** Does this tool output (or error) look like the tool ran out of memory? */
export const looksOutOfMemory = (text: string): boolean => OOM.test(text);

export class PackToolRunner implements ToolRunner {
  /** Set when a run died of memory exhaustion; the Worker then reports it and is recycled. */
  outOfMemory = false;

  constructor(
    readonly version: string,
    private readonly tools: PackTools,
    private readonly sysroot: SysrootSource,
  ) {}

  async run(request: ToolRequest): Promise<ToolResult> {
    let result: ToolResult;
    try {
      result = await runEmscriptenTool(await this.tools.get(request.tool), request, this.sysroot);
    } catch (e) {
      // Instantiation or set-up failed (no memory for the instance, missing sysroot file...).
      const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      result = { exitCode: 70, stdout: '', stderr: `${request.tool}: internal error: ${message}`, outputs: new Map() };
    }
    if (result.exitCode !== 0 && looksOutOfMemory(result.stderr)) this.outOfMemory = true;
    return result;
  }
}

/** Runner version from the packs that define the tools and the sysroot (part of the object cache key). */
export const packsVersion = (packs: readonly LoadedPack[]): string =>
  `packs(${packs.filter((p) => p.entry.kind !== 'library').map((p) => `${p.entry.name}@${p.entry.sha256.slice(0, 16)}`).join(',')})`;
