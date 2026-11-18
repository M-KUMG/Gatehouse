// The contract between the compile core and whatever runs the WebAssembly
// tools: Node for tests now, a browser Worker later. The core only builds
// argument lists and in-memory files; a ToolRunner runs one tool on them.
// Pure types plus small helpers, no DOM, no Node.

export type ToolName = 'cc1plus' | 'as' | 'ld' | 'objcopy';

export type FileData = Uint8Array | string;

/**
 * A sysroot file or directory a run needs, by its path in the tools'
 * filesystem (the sysroot pack is mounted at /, e.g. /arduino/core or
 * /arduino/core.a). A directory brings everything under it. `to` mounts it
 * at another path (ld wants its default script at ldscripts/<arch>.xn).
 */
export interface SysrootMount {
  from: string;
  to?: string;
}

export interface ToolRequest {
  tool: ToolName;
  /** argv without the program name. */
  args: readonly string[];
  /** Files written into the tool's filesystem before it runs (absolute paths). Their directories are created. */
  files: ReadonlyMap<string, FileData>;
  /** Sysroot pieces the run reads; the runner gets their bytes from its own sysroot lookup. */
  sysroot: readonly SysrootMount[];
  /** Directories to create even when no input file is in them (output folders). */
  dirs?: readonly string[];
}

export interface ToolResult {
  /** 0 on success. A crash of the tool itself (not a user error) is reported as a non-zero code with the reason in stderr. */
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Files the run created or changed (absolute paths), sysroot excluded. */
  outputs: ReadonlyMap<string, Uint8Array>;
}

export interface ToolRunner {
  /** Identifies the tool binaries and sysroot (part of the object cache key). */
  readonly version: string;
  run(request: ToolRequest): Promise<ToolResult>;
}

/** Read access to the unpacked sysroot pack, by tools'-filesystem path. */
export interface SysrootSource {
  /** Every file under `path` (recursively), or [path] when it is a file, or [] when missing. */
  list(path: string): Promise<readonly string[]>;
  read(path: string): Promise<Uint8Array>;
}

/** The files a request's sysroot mounts bring in: tools'-filesystem path -> bytes. */
export async function resolveMounts(source: SysrootSource, mounts: readonly SysrootMount[]): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const m of mounts) {
    const files = await source.list(m.from);
    if (files.length === 0) throw new Error(`The compiler's sysroot has no ${m.from}`);
    for (const f of files) out.set(m.to === undefined ? f : m.to + f.slice(m.from.length), await source.read(f));
  }
  return out;
}

const decoder = new TextDecoder();
export const asText = (data: FileData): string => (typeof data === 'string' ? data : decoder.decode(data));
