// The build seam: what turns a board's files into the program it runs.
// Callers (the board runtime) only see Compiler / buildFirmware and never
// care where the hex came from.
//
// Real compilers go here: an in-browser (WASM) toolchain, arduino-cli in the
// Electron app, or a build server. Each implements Compiler and is added with
// registerCompiler(boardTypeId, compiler); nothing else changes.

/** What a build gets: the board type and its files (path -> text). */
export interface BuildInput {
  boardTypeId: string;
  files: Readonly<Record<string, string>>;
}

export type BuildResult =
  | {
      ok: true;
      /** Intel HEX text to load into the board's flash. */
      hex: string;
      /** Taken from a .hex file in the folder, or compiled from the sketch. */
      source: 'firmware-file' | 'compiled';
      /** What ran, for people: the hex file's path, or the sketch that was compiled. */
      name: string;
      /** Notes for people (warnings, "not compiled" hints). */
      messages: string[];
    }
  | { ok: false; errors: string[] };

export interface Compiler {
  id: string;
  /** False when it cannot build right now (offline, toolchain missing...). */
  available(): boolean | Promise<boolean>;
  build(input: BuildInput): Promise<BuildResult>;
}
