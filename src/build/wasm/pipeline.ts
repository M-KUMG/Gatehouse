// The compile core: sketch files + board profile -> Intel HEX, through an
// injected ToolRunner (cc1plus -> as per translation unit, then ld and
// objcopy). Never throws for user errors: they come back as messages.
// Pure, no DOM, no Node; runs the same in Node tests and a browser Worker.

import { contentHash, type ObjectCache } from './cache';
import { formatMessage, parseAsOutput, parseGccOutput, parseLdOutput, type BuildMessage } from './diagnostics';
import { resolveLibraries } from './libraries';
import type { BoardProfile } from './profiles';
import { hexDataBytes, ramBytes } from './size';
import { BUILD_ROOT, displayPath, layoutSketch, SKETCH_ROOT, type SketchInput, type SketchLayout, type TranslationUnit } from './sketch';
import type { BundledLibrary } from './sysroot';
import { asText, type SysrootMount, type ToolRequest, type ToolResult, type ToolRunner } from './toolrunner';

export interface CompileProgress {
  phase: 'prepare' | 'compile' | 'link' | 'done';
  /** For people: "Preparing sketch", "Compiling main.ino (1/3)", "Linking", "Done". */
  message: string;
  /** 1-based unit number while compiling. */
  current?: number;
  total?: number;
}

export interface CompileOptions {
  cache?: ObjectCache;
  onProgress?: (p: CompileProgress) => void;
}

export interface UnitTiming {
  file: string;
  ms: number;
  cached: boolean;
}

export interface CompileTimings {
  prepareMs: number;
  compileMs: number;
  linkMs: number;
  totalMs: number;
  units: UnitTiming[];
}

export type CompileResult =
  | {
      ok: true;
      hex: string;
      flashBytes: number;
      flashMax: number;
      /** Static RAM (.data + .bss), bytes. */
      ramBytes: number;
      ramMax: number;
      /** Warnings and notes (and the size summary note). */
      messages: BuildMessage[];
      timings: CompileTimings;
      /** e.g. "main.ino.hex" */
      firmwareName: string;
      /** Names of the bundled libraries linked. */
      libraries: string[];
    }
  | {
      ok: false;
      /** Every message (errors, warnings, notes). */
      messages: BuildMessage[];
      /** The errors as text lines ("main.ino:5:3: error: ..."). */
      errors: string[];
      timings: CompileTimings;
    };

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** cc1plus arguments for one unit. */
export function compileArgs(profile: BoardProfile, unit: TranslationUnit, libraries: readonly BundledLibrary[], asmOut: string): string[] {
  return [
    '-quiet',
    ...profile.targetFlags,
    ...profile.defines.map((d) => `-D${d}`),
    ...(unit.isC ? ['-U__cplusplus', '-D_Bool=bool'] : []),
    ...profile.systemIncludeDirs.flatMap((d) => ['-isystem', d]),
    ...profile.includeDirs.flatMap((d) => ['-I', d]),
    ...libraries.flatMap((l) => ['-I', l.includeDir]),
    '-I', SKETCH_ROOT, '-I', `${SKETCH_ROOT}/src`,
    ...profile.cppFlags,
    unit.path,
    '-o', asmOut,
  ];
}

/** Sysroot pieces cc1plus reads. */
const compileMounts = (profile: BoardProfile, libraries: readonly BundledLibrary[]): SysrootMount[] =>
  [...profile.systemIncludeDirs, ...profile.includeDirs, ...libraries.map((l) => l.includeDir)].map((from) => ({ from }));

function sketchFileMap(layout: SketchLayout): Map<string, string> {
  const files = new Map<string, string>();
  for (const f of layout.sources) files.set(`${SKETCH_ROOT}/${f.path}`, f.text);
  return files;
}

interface UnitOutcome {
  object?: Uint8Array;
  messages: BuildMessage[];
  cached: boolean;
}

/** A failure of the tools themselves (crash, missing sysroot), not of the user's code. */
const internal = (message: string): BuildMessage => ({ severity: 'error', message: `Internal compiler problem: ${message}`, raw: message });

async function compileUnit(
  runner: ToolRunner, profile: BoardProfile, layout: SketchLayout, unit: TranslationUnit,
  libraries: readonly BundledLibrary[], cache: ObjectCache | undefined, mapPath: (p: string) => string,
): Promise<UnitOutcome> {
  const asmOut = `${BUILD_ROOT}/unit.s`;
  const args = compileArgs(profile, unit, libraries, asmOut);
  const key = await contentHash([
    'gatehouse-avr-object-v1', runner.version, profile.id, unit.path, unit.text, ...args, ...profile.asFlags,
    ...layout.headers.flatMap((h) => [h.path, h.text]),
  ]);
  const hit = cache ? await cache.get(key) : undefined;
  if (hit) return { object: hit.object, messages: parseGccOutput(hit.stderr, mapPath), cached: true };
  const files = sketchFileMap(layout);
  files.set(unit.path, unit.text);
  const cc = await runner.run({ tool: 'cc1plus', args, files, sysroot: compileMounts(profile, libraries), dirs: [BUILD_ROOT] });
  const messages = parseGccOutput(cc.stderr, mapPath);
  const asm = cc.outputs.get(asmOut);
  if (cc.exitCode !== 0 || !asm) {
    if (!messages.some((m) => m.severity === 'error')) messages.push(internal(`cc1plus exited with ${cc.exitCode} for ${unit.display}. ${cc.stderr}`));
    return { messages, cached: false };
  }
  const objOut = `${BUILD_ROOT}/unit.o`;
  const as = await runner.run({
    tool: 'as', args: [...profile.asFlags, '-o', objOut, asmOut], files: new Map([[asmOut, asm]]), sysroot: [],
  });
  const object = as.outputs.get(objOut);
  if (as.exitCode !== 0 || !object) {
    const asMessages = parseAsOutput(as.stderr, unit.display);
    if (!asMessages.some((m) => m.severity === 'error')) asMessages.push(internal(`as exited with ${as.exitCode} for ${unit.display}.`));
    return { messages: [...messages, ...asMessages], cached: false };
  }
  await cache?.set(key, { object, stderr: cc.stderr });
  return { object, messages, cached: false };
}

function linkRequest(profile: BoardProfile, objects: Map<string, Uint8Array>, libraries: readonly BundledLibrary[], elf: string): ToolRequest {
  const archives = [...libraries.flatMap((l) => (l.archive ? [l.archive] : [])), profile.coreArchive];
  const L = profile.link;
  return {
    tool: 'ld',
    args: [
      ...L.flags, '-o', elf, L.crt, ...objects.keys(),
      '--start-group', ...archives, '--end-group',
      ...L.libDirs.map((d) => `-L${d}`), ...L.libs.map((l) => `-l${l}`),
    ],
    files: objects,
    sysroot: [
      { from: L.crt }, ...archives.map((from) => ({ from })), ...L.libFiles.map((from) => ({ from })),
      { from: L.script.from, to: L.script.to },
    ],
    dirs: [BUILD_ROOT],
  };
}

const pct = (n: number, max: number): number => Math.round((n / max) * 100);

function fail(messages: BuildMessage[], timings: CompileTimings): CompileResult {
  return { ok: false, messages, errors: messages.filter((m) => m.severity === 'error').map(formatMessage), timings };
}

/**
 * Compile a sketch for a board profile. Never throws for problems in the
 * sketch; a crashing runner (missing tools) is reported as an internal error.
 */
export async function compileSketch(input: SketchInput, profile: BoardProfile, runner: ToolRunner, options: CompileOptions = {}): Promise<CompileResult> {
  const t0 = now();
  const timings: CompileTimings = { prepareMs: 0, compileMs: 0, linkMs: 0, totalMs: 0, units: [] };
  const progress = options.onProgress ?? (() => {});
  const finish = (r: CompileResult): CompileResult => {
    timings.totalMs = now() - t0;
    progress({ phase: 'done', message: 'Done' });
    return r;
  };
  try {
    progress({ phase: 'prepare', message: 'Preparing sketch' });
    const layout = layoutSketch(input);
    const mapPath = displayPath(layout);
    if (layout.units.length === 0) {
      const message = 'No sketch to compile: add a .ino file (or .cpp files) to the board folder.';
      return finish(fail([{ severity: 'error', message, raw: message }], timings));
    }
    const libs = resolveLibraries(layout.sources);
    timings.prepareMs = now() - t0;
    if (libs.errors.length) return finish(fail(libs.errors, timings));

    const messages: BuildMessage[] = [];
    const objects = new Map<string, Uint8Array>();
    const tc = now();
    let failed = false;
    for (const [k, unit] of layout.units.entries()) {
      progress({ phase: 'compile', message: `Compiling ${unit.display} (${k + 1}/${layout.units.length})`, current: k + 1, total: layout.units.length });
      const tu = now();
      const r = await compileUnit(runner, profile, layout, unit, libs.libraries, options.cache, mapPath);
      timings.units.push({ file: unit.display, ms: now() - tu, cached: r.cached });
      messages.push(...r.messages);
      if (r.object) objects.set(unit.object, r.object);
      else failed = true;
    }
    timings.compileMs = now() - tc;
    // A compile error never reaches the linker (its errors would hide the real one).
    if (failed) return finish(fail(messages, timings));

    progress({ phase: 'link', message: 'Linking' });
    const tl = now();
    const elfPath = `${BUILD_ROOT}/firmware.elf`;
    const ld: ToolResult = await runner.run(linkRequest(profile, objects, libs.libraries, elfPath));
    const ldMessages = parseLdOutput(ld.stderr, mapPath);
    messages.push(...ldMessages);
    const elf = ld.outputs.get(elfPath);
    if (ld.exitCode !== 0 || !elf) {
      if (!ldMessages.some((m) => m.severity === 'error')) messages.push(internal(`ld exited with ${ld.exitCode}.`));
      timings.linkMs = now() - tl;
      return finish(fail(messages, timings));
    }
    const hexPath = `${BUILD_ROOT}/firmware.hex`;
    const oc = await runner.run({
      tool: 'objcopy', args: ['-O', 'ihex', '-R', '.eeprom', elfPath, hexPath], files: new Map([[elfPath, elf]]), sysroot: [],
    });
    timings.linkMs = now() - tl;
    const hexData = oc.outputs.get(hexPath);
    if (oc.exitCode !== 0 || !hexData) {
      messages.push(internal(`objcopy exited with ${oc.exitCode}. ${oc.stderr}`));
      return finish(fail(messages, timings));
    }
    const hex = asText(hexData);
    const flashBytes = hexDataBytes(hex);
    const ram = ramBytes(elf);
    const sizeLine =
      `Sketch uses ${flashBytes} bytes (${pct(flashBytes, profile.flashMax)}%) of program storage space. Maximum is ${profile.flashMax} bytes. ` +
      `Global variables use ${ram} bytes (${pct(ram, profile.ramSize)}%) of dynamic memory, leaving ${profile.ramSize - ram} bytes for local variables. Maximum is ${profile.ramSize} bytes.`;
    if (flashBytes > profile.flashMax) {
      const message = `Sketch too big: ${flashBytes} bytes of ${profile.flashMax} bytes maximum (${pct(flashBytes, profile.flashMax)}%). Make it smaller (fewer or shorter strings, smaller arrays, F("...") for text).`;
      messages.push({ severity: 'error', message, raw: sizeLine });
      return finish(fail(messages, timings));
    }
    if (ram > profile.ramSize) {
      const message = `Not enough memory: global variables use ${ram} bytes of ${profile.ramSize} bytes of RAM.`;
      messages.push({ severity: 'error', message, raw: sizeLine });
      return finish(fail(messages, timings));
    }
    messages.push({ severity: 'note', message: sizeLine, raw: sizeLine });
    if (ram > profile.ramSize * 0.75) {
      const message = 'Low memory available, stability problems may occur.';
      messages.push({ severity: 'warning', message, raw: message });
    }
    return finish({
      ok: true, hex, flashBytes, flashMax: profile.flashMax, ramBytes: ram, ramMax: profile.ramSize,
      messages, timings, firmwareName: layout.firmwareName, libraries: libs.libraries.map((l) => l.name),
    });
  } catch (e) {
    return finish(fail([internal(e instanceof Error ? e.message : String(e))], timings));
  }
}
