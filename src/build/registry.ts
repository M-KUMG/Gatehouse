// Which compiler builds which board type. A real compiler registers itself
// here (see compiler.ts); until then every board uses the firmware file.

import type { BuildInput, BuildResult, Compiler } from './compiler';
import { FirmwareFileCompiler } from './firmwarefile';

const fallback = new FirmwareFileCompiler();
const byType = new Map<string, Compiler>();

/** Use `compiler` for boards of `boardTypeId` (replaces an earlier one). Returns a function that undoes it. */
export function registerCompiler(boardTypeId: string, compiler: Compiler): () => void {
  byType.set(boardTypeId, compiler);
  return () => {
    if (byType.get(boardTypeId) === compiler) byType.delete(boardTypeId);
  };
}

/** The compiler for a board type: a registered one, else the firmware-file compiler. */
export function getCompiler(boardTypeId: string): Compiler {
  return byType.get(boardTypeId) ?? fallback;
}

/**
 * Build a board's program with its compiler, falling back to the firmware
 * file when that compiler is not available. Never throws: a failing
 * compiler becomes { ok: false }.
 */
export async function buildFirmware(input: BuildInput): Promise<BuildResult> {
  try {
    const compiler = getCompiler(input.boardTypeId);
    const usable = compiler === fallback || (await compiler.available());
    return await (usable ? compiler : fallback).build(input);
  } catch (e) {
    return { ok: false, errors: [`The build failed: ${e instanceof Error ? e.message : String(e)}`] };
  }
}
