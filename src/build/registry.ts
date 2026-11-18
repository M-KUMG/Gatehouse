// Which compiler builds which board type, and how a board's program is
// chosen (buildFirmware):
//   (a) sketch sources (.ino/.cpp/.c/.h/.hpp at the root or in src/) and a
//       registered compiler that is available -> compile them; a failed
//       compile is the result (never a silent fall back to an old .hex);
//   (b) else the firmware .hex in the folder (FirmwareFileCompiler), with a
//       note when sources exist but the registered compiler is unavailable;
//   (c) neither -> the firmware-file compiler's "No firmware" error.

import type { BuildInput, BuildResult, Compiler } from './compiler';
import { FirmwareFileCompiler } from './firmwarefile';
import { sketchFiles } from './wasm/sketch';

const fallback = new FirmwareFileCompiler();
const byType = new Map<string, Compiler>();

export const COMPILER_UNAVAILABLE_NOTE = 'Sketch files are not compiled: compiler files not available here (run npm run toolchain:fetch).';

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

/** True when the folder has sketch sources the compiler would read (root or src/). */
export function hasSketchSources(files: Readonly<Record<string, string>>): boolean {
  return sketchFiles(files).length > 0;
}

/** Build a board's program (rules at the top of this file). Never throws: a failing compiler becomes { ok: false }. */
export async function buildFirmware(input: BuildInput): Promise<BuildResult> {
  try {
    const compiler = byType.get(input.boardTypeId);
    if (!compiler || !hasSketchSources(input.files)) return await fallback.build(input);
    if (await compiler.available()) return await compiler.build(input);
    const r = await fallback.build(input);
    return r.ok ? { ...r, messages: [COMPILER_UNAVAILABLE_NOTE] } : { ...r, errors: [...r.errors, COMPILER_UNAVAILABLE_NOTE] };
  } catch (e) {
    return { ok: false, errors: [`The build failed: ${e instanceof Error ? e.message : String(e)}`] };
  }
}
