// Runs one Emscripten-built tool (MODULARIZE factory + compiled
// WebAssembly.Module) on a ToolRequest in a fresh instance with an in-memory
// filesystem. Shared by the Node runner and the compile Worker (worker/): it
// uses only the Emscripten module API, no DOM and no Node.

import { resolveMounts, type SysrootSource, type ToolRequest, type ToolResult } from './toolrunner';

/** The subset of Emscripten's FS the runner uses. */
export interface EmscriptenFS {
  mkdir(path: string): void;
  writeFile(path: string, data: Uint8Array | string): void;
  readFile(path: string): Uint8Array;
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
}

export interface EmscriptenModule {
  FS: EmscriptenFS;
  callMain(args: string[]): number | void;
}

/** The default export of a tool's .mjs glue (createTool). */
export type EmscriptenFactory = (options: Record<string, unknown>) => Promise<EmscriptenModule>;

export interface LoadedTool {
  factory: EmscriptenFactory;
  module: WebAssembly.Module;
}

function mkdirs(FS: EmscriptenFS, dir: string): void {
  let cur = '';
  for (const part of dir.split('/').filter(Boolean)) {
    cur += `/${part}`;
    try {
      FS.mkdir(cur);
    } catch {
      // exists
    }
  }
}

function put(FS: EmscriptenFS, path: string, data: Uint8Array | string): void {
  mkdirs(FS, path.slice(0, path.lastIndexOf('/')));
  FS.writeFile(path, data);
}

const SKIP_DIRS = new Set(['/dev', '/proc']);

function walk(FS: EmscriptenFS, dir: string, out: string[]): void {
  for (const name of FS.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    const p = dir === '/' ? `/${name}` : `${dir}/${name}`;
    if (SKIP_DIRS.has(p)) continue;
    if (FS.isDir(FS.stat(p).mode)) walk(FS, p, out);
    else out.push(p);
  }
}

const same = (a: Uint8Array, b: Uint8Array | string): boolean => {
  const bb = typeof b === 'string' ? new TextEncoder().encode(b) : b;
  if (a.length !== bb.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== bb[i]) return false;
  return true;
};

/** Exit status carried by Emscripten's ExitStatus (thrown by exit()). */
function exitStatus(e: unknown): number | undefined {
  if (typeof e === 'object' && e !== null && 'status' in e && typeof (e as { status: unknown }).status === 'number') {
    return (e as { status: number }).status;
  }
  return undefined;
}

export async function runEmscriptenTool(tool: LoadedTool, request: ToolRequest, sysroot: SysrootSource): Promise<ToolResult> {
  const sysFiles = await resolveMounts(sysroot, request.sysroot);
  const stdout: string[] = [];
  const stderr: string[] = [];
  // A failed instantiation (no memory for the instance) never calls `done`, so
  // the factory would wait forever: race it against the failure.
  let instantiateFailed: (e: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => {
    instantiateFailed = reject;
  });
  const M = await Promise.race([
    tool.factory({
      noInitialRun: true,
      thisProgram: request.tool,
      print: (line: string) => stdout.push(line),
      printErr: (line: string) => stderr.push(line),
      stdin: () => null,
      instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
        WebAssembly.instantiate(tool.module, imports).then((instance) => done(instance, tool.module), instantiateFailed);
        return {};
      },
    }),
    failed,
  ]);
  const FS = M.FS;
  for (const [p, d] of sysFiles) put(FS, p, d);
  for (const [p, d] of request.files) put(FS, p, d);
  for (const d of request.dirs ?? []) mkdirs(FS, d);
  let exitCode = 0;
  try {
    const r = M.callMain([...request.args]);
    if (typeof r === 'number') exitCode = r;
  } catch (e) {
    const status = exitStatus(e);
    if (status === undefined) {
      exitCode = 70;
      stderr.push(`${request.tool}: internal error: ${e instanceof Error ? e.message : String(e)}`);
    } else exitCode = status;
  }
  const outputs = new Map<string, Uint8Array>();
  const all: string[] = [];
  walk(FS, '/', all);
  for (const p of all) {
    if (sysFiles.has(p)) continue;
    const data = FS.readFile(p);
    const input = request.files.get(p);
    if (input === undefined || !same(data, input)) outputs.set(p, data);
  }
  return { exitCode, stdout: stdout.join('\n'), stderr: stderr.join('\n'), outputs };
}
