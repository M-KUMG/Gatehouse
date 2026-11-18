// What the compile Worker does with a request, without the Worker itself (so
// Node tests run the same code): load the packs the sketch needs (compiler,
// the profile's board pack, library packs for its includes), then run the
// compile core (compileSketch) with a pack-backed ToolRunner. The object
// cache lives as long as the Worker. No DOM, no Node.

import type { BuildMessage } from '../diagnostics';
import { MemoryObjectCache } from '../cache';
import { resolveLibraries } from '../libraries';
import { compileSketch, type CompileResult } from '../pipeline';
import { getBoardProfile } from '../profiles';
import { sketchFiles } from '../sketch';
import { boardPackName, libraryPackNames, packClosure, PackLoader, type LoadedPack, type PackLoaderOptions } from './packs';
import { PackSysroot, PackTools, PackToolRunner, packsVersion, type GlueLoader } from './packrunner';
import type { WorkerRequest, WorkerResponse } from './protocol';

export interface EngineOptions {
  /** Everything of PackLoaderOptions except the base URL (it comes with each request). */
  packs: Omit<PackLoaderOptions, 'baseUrl'>;
  loadGlue?: GlueLoader;
  compileWasm?: (bytes: Uint8Array) => Promise<WebAssembly.Module>;
}

export const OUT_OF_MEMORY_MESSAGE =
  'Out of memory in the compiler. The compiler was restarted; try again, and close other tabs if it happens again.';

const failed = (message: string): CompileResult => {
  const m: BuildMessage = { severity: 'error', message, raw: message };
  return { ok: false, messages: [m], errors: [`error: ${message}`], timings: { prepareMs: 0, compileMs: 0, linkMs: 0, totalMs: 0, units: [] } };
};

export class CompilerEngine {
  private readonly loaders = new Map<string, PackLoader>();
  private readonly cache = new MemoryObjectCache();
  private tools: { sha: string; tools: PackTools } | undefined;

  constructor(private readonly options: EngineOptions) {}

  private loader(baseUrl: string): PackLoader {
    let l = this.loaders.get(baseUrl);
    if (!l) {
      l = new PackLoader({ ...this.options.packs, baseUrl });
      this.loaders.set(baseUrl, l);
    }
    return l;
  }

  /** Handle one request; every response goes through `post`. Never throws. */
  async handle(req: WorkerRequest, post: (msg: WorkerResponse) => void): Promise<void> {
    try {
      if (req.type === 'prefetch') await this.prefetch(req, post);
      else await this.compile(req, post);
    } catch (e) {
      const message = `The compiler stopped unexpectedly: ${e instanceof Error ? e.message : String(e)}`;
      if (req.type === 'prefetch') post({ id: req.id, type: 'prefetched', ok: false, error: message, fatal: true });
      else post({ id: req.id, type: 'result', result: failed(message), fatal: true });
    }
  }

  private async prefetch(req: Extract<WorkerRequest, { type: 'prefetch' }>, post: (msg: WorkerResponse) => void): Promise<void> {
    const profile = getBoardProfile(req.profileId);
    if (!profile) return post({ id: req.id, type: 'prefetched', ok: false, error: `No board profile '${req.profileId}'.` });
    const loader = this.loader(req.baseUrl);
    const m = await loader.manifest();
    if (!m) return post({ id: req.id, type: 'prefetched', ok: false, error: 'The compiler files cannot be reached.' });
    try {
      await loader.load(packClosure(m.manifest, [boardPackName(profile.mcu)]), (download) => post({ id: req.id, type: 'download', download }));
    } catch (e) {
      return post({ id: req.id, type: 'prefetched', ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    post({ id: req.id, type: 'prefetched', ok: true });
  }

  private async compile(req: Extract<WorkerRequest, { type: 'compile' }>, post: (msg: WorkerResponse) => void): Promise<void> {
    const done = (result: CompileResult, fatal = false): void => post({ id: req.id, type: 'result', result, ...(fatal ? { fatal } : {}) });
    const profile = getBoardProfile(req.profileId);
    if (!profile) return done(failed(`The browser compiler has no board profile '${req.profileId}'.`));
    const loader = this.loader(req.baseUrl);
    const m = await loader.manifest();
    if (!m) return done(failed('The compiler files cannot be reached (toolchain-packs/manifest.json), and none are stored for offline use.'));
    const libraries = resolveLibraries(sketchFiles(req.sketch.files)).libraries.map((l) => l.name);
    let packs: Map<string, LoadedPack>;
    try {
      const entries = packClosure(m.manifest, [boardPackName(profile.mcu), ...libraryPackNames(m.manifest, libraries)]);
      packs = await loader.load(entries, (download) => post({ id: req.id, type: 'download', download }));
    } catch (e) {
      return done(failed(`Could not load the compiler files: ${e instanceof Error ? e.message : String(e)}`));
    }
    const compiler = packs.get('compiler');
    if (!compiler) return done(failed('The toolchain manifest has no compiler pack.'));
    if (this.tools?.sha !== compiler.entry.sha256) {
      this.tools = { sha: compiler.entry.sha256, tools: new PackTools(compiler.reader, this.options.loadGlue, this.options.compileWasm) };
    }
    const all = [...packs.values()];
    const runner = new PackToolRunner(packsVersion(all), this.tools.tools, new PackSysroot(all.map((p) => p.reader)));
    const result = await compileSketch(req.sketch, profile, runner, {
      cache: this.cache,
      onProgress: (progress) => post({ id: req.id, type: 'progress', progress }),
    });
    if (runner.outOfMemory) return done(failed(OUT_OF_MEMORY_MESSAGE), true);
    done(result);
  }
}
