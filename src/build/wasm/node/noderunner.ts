/// <reference types="node" />
// NODE ONLY: a ToolRunner that loads the startabit tools from a toolchain
// folder on disk (tools/<tool>.mjs + <tool>.wasm or .wasm.gz, sysroot/...).
// Used by tests and scripts; the browser uses a Worker runner instead.
// Nothing outside src/build/wasm/node may import this file.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { runEmscriptenTool, type EmscriptenFactory, type LoadedTool } from '../emscripten';
import type { SysrootSource, ToolName, ToolRequest, ToolResult, ToolRunner } from '../toolrunner';

const TOOLS: readonly ToolName[] = ['cc1plus', 'as', 'ld', 'objcopy'];

/** The sysroot folder on disk, read through a cache. */
export class DiskSysroot implements SysrootSource {
  private readonly bytes = new Map<string, Uint8Array>();
  private readonly lists = new Map<string, string[]>();

  constructor(private readonly root: string) {}

  private disk(path: string): string {
    return join(this.root, ...path.split('/').filter(Boolean));
  }

  list(path: string): Promise<readonly string[]> {
    let out = this.lists.get(path);
    if (!out) {
      const d = this.disk(path);
      if (!existsSync(d)) out = [];
      else if (!statSync(d).isDirectory()) out = [path];
      else {
        out = readdirSync(d, { recursive: true, withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => `${path}/${join(e.parentPath, e.name).slice(d.length + 1).split(/[\\/]/).join('/')}`)
          .sort();
      }
      this.lists.set(path, out);
    }
    return Promise.resolve(out);
  }

  read(path: string): Promise<Uint8Array> {
    let b = this.bytes.get(path);
    if (!b) {
      b = new Uint8Array(readFileSync(this.disk(path)));
      this.bytes.set(path, b);
    }
    return Promise.resolve(b);
  }
}

/** True when `dir` looks like an unpacked toolchain (tools + sysroot). */
export function isToolchainDir(dir: string): boolean {
  return (
    TOOLS.every((t) => existsSync(join(dir, 'tools', `${t}.mjs`)) && (existsSync(join(dir, 'tools', `${t}.wasm`)) || existsSync(join(dir, 'tools', `${t}.wasm.gz`)))) &&
    existsSync(join(dir, 'sysroot', 'arduino', 'core.a'))
  );
}

export interface NodeToolRunnerStats {
  /** Runs per tool since creation. */
  runs: Record<ToolName, number>;
  /** WebAssembly.compile time per tool (first use), ms. */
  compileMs: Partial<Record<ToolName, number>>;
}

export class NodeToolRunner implements ToolRunner {
  readonly version: string;
  readonly stats: NodeToolRunnerStats = { runs: { cc1plus: 0, as: 0, ld: 0, objcopy: 0 }, compileMs: {} };
  private readonly sysroot: DiskSysroot;
  private readonly loaded = new Map<ToolName, Promise<LoadedTool>>();

  constructor(private readonly dir: string) {
    if (!isToolchainDir(dir)) throw new Error(`Not a toolchain folder (tools/ + sysroot/): ${dir}`);
    this.sysroot = new DiskSysroot(join(dir, 'sysroot'));
    const sizes = TOOLS.map((t) => {
      const plain = join(dir, 'tools', `${t}.wasm`);
      return `${t}:${statSync(existsSync(plain) ? plain : `${plain}.gz`).size}`;
    });
    const core = statSync(join(dir, 'sysroot', 'arduino', 'core.a')).size;
    this.version = `startabit-avr-gcc-wasm(${sizes.join(',')},core.a:${core})`;
  }

  private load(tool: ToolName): Promise<LoadedTool> {
    let p = this.loaded.get(tool);
    if (!p) {
      p = (async () => {
        const base = join(this.dir, 'tools', tool);
        const glue = (await import(/* @vite-ignore */ pathToFileURL(`${base}.mjs`).href)) as { default: EmscriptenFactory };
        const raw = existsSync(`${base}.wasm`) ? readFileSync(`${base}.wasm`) : gunzipSync(readFileSync(`${base}.wasm.gz`));
        const t0 = performance.now();
        const module = await WebAssembly.compile(new Uint8Array(raw));
        this.stats.compileMs[tool] = performance.now() - t0;
        return { factory: glue.default, module };
      })();
      this.loaded.set(tool, p);
    }
    return p;
  }

  async run(request: ToolRequest): Promise<ToolResult> {
    const tool = await this.load(request.tool);
    this.stats.runs[request.tool]++;
    // The glue's Node branch sets process.exitCode when a tool exits non-zero
    // (a compile error); that must not fail the host process.
    const exitCode = process.exitCode;
    try {
      return await runEmscriptenTool(tool, request, this.sysroot);
    } finally {
      process.exitCode = exitCode;
    }
  }
}
