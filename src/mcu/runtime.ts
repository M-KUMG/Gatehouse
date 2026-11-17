// Live state of the boards in the scene, which is not saved: the emulator
// built from each board's program, whether it runs, and its serial output.
// Kept in step with the scene by sync(). No DOM.

import type { BoardProgram, BoardSpec } from './board';
import { HexError, parseIntelHex } from './hex';
import type { BoardSlot } from './mixedsignal';

/** Serial text kept per board; older text is dropped. */
const SERIAL_LIMIT = 20_000;

export interface BoardRuntime extends BoardSlot {
  spec: BoardSpec;
  /** The program the emulator was built from (null: none). */
  program: BoardProgram | null;
  /** Its flash image, for resets. */
  flash: Uint8Array | null;
  serial: string;
  /** Why the program could not be loaded. */
  error: string | null;
}

/** What sync() needs to know about a part. */
export interface BoardPartInfo {
  id: number;
  spec: BoardSpec;
  program: BoardProgram | undefined;
}

export class BoardRuntimes {
  /** Bumped whenever an emulator is created, replaced or reset. */
  version = 0;
  private readonly byId = new Map<number, BoardRuntime>();

  /** Match the runtimes to the board parts (in order); returns them in that order. */
  sync(parts: readonly BoardPartInfo[]): BoardRuntime[] {
    const keep = new Set(parts.map((p) => p.id));
    for (const id of this.byId.keys()) {
      if (!keep.has(id)) {
        this.byId.delete(id);
        this.version++;
      }
    }
    return parts.map((p) => {
      let rt = this.byId.get(p.id);
      if (!rt) {
        rt = {
          partId: p.id, spec: p.spec, io: p.spec.io, electrical: p.spec.electrical,
          emulator: null, running: false, program: null, flash: null, serial: '', error: null,
        };
        this.byId.set(p.id, rt);
        this.version++;
      }
      const program = p.program ?? null;
      if (program?.hex !== rt.program?.hex || program?.name !== rt.program?.name) this.load(rt, program);
      return rt;
    });
  }

  /** Forget every board (e.g. before another project loads): all start stopped again. */
  clear(): void {
    this.byId.clear();
    this.version++;
  }

  get(id: number): BoardRuntime | undefined {
    return this.byId.get(id);
  }

  get anyRunning(): boolean {
    return [...this.byId.values()].some((rt) => rt.running && rt.emulator !== null);
  }

  run(id: number): void {
    const rt = this.byId.get(id);
    if (rt?.emulator) rt.running = true;
  }

  pause(id: number): void {
    const rt = this.byId.get(id);
    if (rt) rt.running = false;
  }

  /** Back to the start of the program (keeps running if it was). */
  reset(id: number): void {
    const rt = this.byId.get(id);
    if (!rt?.flash) return;
    rt.emulator = rt.spec.create(rt.flash);
    rt.serial = '';
    this.version++;
  }

  addSerial(id: number, bytes: readonly number[]): void {
    const rt = this.byId.get(id);
    if (!rt) return;
    const text = rt.serial + bytes.map((b) => String.fromCharCode(b)).join('');
    rt.serial = text.length > SERIAL_LIMIT ? text.slice(text.length - SERIAL_LIMIT) : text;
  }

  /** Build the emulator for a (new) program; a stopped board stays stopped. */
  private load(rt: BoardRuntime, program: BoardProgram | null): void {
    rt.program = program;
    rt.emulator = null;
    rt.flash = null;
    rt.running = false;
    rt.serial = '';
    rt.error = null;
    if (program) {
      try {
        rt.flash = parseIntelHex(program.hex, rt.spec.flashBytes).bytes;
        rt.emulator = rt.spec.create(rt.flash);
      } catch (e) {
        rt.error = e instanceof HexError ? e.message : String(e);
      }
    }
    this.version++;
  }
}
