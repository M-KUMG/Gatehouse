// Live state of the boards in the scene, which is not saved: the emulator
// built from each board's firmware, whether it runs, and its serial output
// (in the serial store, per board and port). Kept in step with the scene by
// sync(). No DOM.
//
// The program comes from the board's files through the build seam
// (src/build), at the moment the board starts from a fresh state:
//   runBoard    fresh (never run, or after Reset): build from the current
//               files, then run; paused: continue the same emulator.
//   pauseBoard  stop the clock for this board; the emulator is kept.
//   resetBoard  build again from the current files, start from zero, stopped.
// A failed build leaves the board in the 'error' state with the message.
// Builds are async; onChange listeners hear about every change (also when a
// build finishes), and `version` is bumped whenever an emulator is created,
// replaced or dropped.

import type { BuildInput, BuildResult } from '../build/compiler';
import { buildFirmware } from '../build/registry';
import type { BoardSpec, SerialBytes } from './board';
import { HexError, parseIntelHex } from './hex';
import type { BoardSlot } from './mixedsignal';
import { SerialStore } from './serialstore';

export interface BoardRuntime extends BoardSlot {
  spec: BoardSpec;
  /** Started since the last reset: Run continues it instead of building again. */
  started: boolean;
  /** A build is in progress. */
  building: boolean;
  /** What the last successful build ran (e.g. "firmware.hex"). */
  firmwareName: string | null;
  /** Notes from the last build. */
  messages: string[];
  /** Why the last build or load failed. */
  error: string | null;
  /** Bumped by every build; a build that finishes after a newer one started is dropped. */
  generation: number;
}

/** What sync() needs to know about a part. */
export interface BoardPartInfo {
  id: number;
  spec: BoardSpec;
}

export type BoardRunStatus = 'stopped' | 'running' | 'paused' | 'error';

/** Everything a board's controls show. Plain data. */
export interface BoardRunState {
  state: BoardRunStatus;
  /** Simulated seconds since the program started (0 without an emulator). */
  time: number;
  /** Simulated seconds per wall second while running, else 0. */
  speed: number;
  /** What runs (or ran last), e.g. "firmware.hex"; null before a successful build. */
  firmwareName: string | null;
  /** Notes from the last build (e.g. that the sketch is not compiled yet). */
  messages: string[];
  /** Set in the 'error' state. */
  error?: string;
  /** A build is in progress (Run / Reset pressed, result not there yet). */
  building: boolean;
}

/** The files to build a board from, by part id (read at the moment of the build), or null. */
export type BuildSource = (partId: number) => BuildInput | null;
export type BuildFn = (input: BuildInput) => Promise<BuildResult>;

export class BoardRuntimes {
  /** Bumped whenever an emulator is created, replaced or reset. */
  version = 0;
  /** Simulated seconds per wall second of the shared clock (set by BoardClock). */
  speed = 0;
  /** Serial output per board and port; buffers go with their board (reset, new build, deleted). */
  readonly serial = new SerialStore();
  private readonly byId = new Map<number, BoardRuntime>();
  private readonly listeners: (() => void)[] = [];

  constructor(
    private readonly source: BuildSource = () => null,
    private readonly build: BuildFn = buildFirmware,
  ) {}

  /** Call `fn` after every change of a board's run state (also async build results). Returns an unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private changed(): void {
    for (const fn of [...this.listeners]) fn();
  }

  /** Match the runtimes to the board parts (in order); returns them in that order. */
  sync(parts: readonly BoardPartInfo[]): BoardRuntime[] {
    const keep = new Set(parts.map((p) => p.id));
    for (const id of this.byId.keys()) {
      if (!keep.has(id)) {
        this.byId.delete(id);
        this.serial.removeBoard(id);
        this.version++;
      }
    }
    return parts.map((p) => {
      let rt = this.byId.get(p.id);
      if (!rt) {
        rt = {
          partId: p.id, spec: p.spec, io: p.spec.io, electrical: p.spec.electrical, emulator: null, running: false,
          started: false, building: false, firmwareName: null, messages: [], error: null, generation: 0,
        };
        this.byId.set(p.id, rt);
        this.version++;
      }
      return rt;
    });
  }

  /** Forget every board (e.g. before another project loads): all start stopped again. */
  clear(): void {
    this.byId.clear();
    this.serial.clearAll();
    this.version++;
    this.changed();
  }

  get(id: number): BoardRuntime | undefined {
    return this.byId.get(id);
  }

  get anyRunning(): boolean {
    return [...this.byId.values()].some((rt) => rt.running && rt.emulator !== null);
  }

  boardRunState(id: number): BoardRunState {
    const rt = this.byId.get(id);
    if (!rt) return { state: 'stopped', time: 0, speed: 0, firmwareName: null, messages: [], building: false };
    const emu = rt.emulator;
    const state: BoardRunStatus = rt.error !== null ? 'error' : rt.running ? 'running' : rt.started ? 'paused' : 'stopped';
    return {
      state,
      time: emu ? emu.cycles / emu.clockHz : 0,
      speed: state === 'running' ? this.speed : 0,
      firmwareName: rt.firmwareName,
      messages: [...rt.messages],
      ...(rt.error !== null ? { error: rt.error } : {}),
      building: rt.building,
    };
  }

  /** Run: a fresh board builds from its current files first; a paused one continues. */
  async runBoard(id: number): Promise<void> {
    const rt = this.byId.get(id);
    if (!rt || rt.building || rt.running) return;
    if (rt.started && rt.emulator) {
      rt.running = true;
      this.changed();
      return;
    }
    const generation = await this.load(rt);
    if (generation === null || !rt.emulator) return;
    rt.started = true;
    rt.running = true;
    this.changed();
  }

  pauseBoard(id: number): void {
    const rt = this.byId.get(id);
    if (!rt?.running) return;
    rt.running = false;
    this.changed();
  }

  /** Build again from the current files and start from zero, stopped. Serial buffers are cleared. */
  async resetBoard(id: number): Promise<void> {
    const rt = this.byId.get(id);
    if (!rt) return;
    rt.running = false;
    rt.started = false;
    this.serial.clear(id);
    await this.load(rt);
  }

  /** Store what a board sent (bytes per port id). */
  addSerial(id: number, bytes: SerialBytes): void {
    if (!this.byId.has(id)) return;
    for (const [port, data] of Object.entries(bytes)) this.serial.write(id, port, data);
  }

  /** The build result for a board; never throws. */
  private async buildFor(partId: number): Promise<BuildResult> {
    try {
      const input = this.source(partId);
      if (!input) return { ok: false, errors: ['This board has no files to build from.'] };
      return await this.build(input);
    } catch (e) {
      return { ok: false, errors: [`The build failed: ${e instanceof Error ? e.message : String(e)}`] };
    }
  }

  /**
   * Build the board's program and make a new emulator at its start
   * (stopped). Returns null when a newer build or a removal overtook this one.
   */
  private async load(rt: BoardRuntime): Promise<number | null> {
    const generation = ++rt.generation;
    rt.building = true;
    this.changed();
    const result = await this.buildFor(rt.partId);
    if (generation !== rt.generation || this.byId.get(rt.partId) !== rt) return null;
    rt.building = false;
    rt.emulator = null;
    rt.running = false;
    rt.started = false;
    this.serial.clear(rt.partId);
    if (!result.ok) {
      rt.error = result.errors.join('\n');
      rt.messages = [];
      rt.firmwareName = null;
    } else {
      rt.messages = [...result.messages];
      rt.firmwareName = result.name;
      try {
        rt.emulator = rt.spec.create(parseIntelHex(result.hex, rt.spec.flashBytes).bytes);
        rt.error = null;
      } catch (e) {
        rt.error = `${result.name} is not a valid program. ${e instanceof HexError ? e.message : String(e)}`;
      }
    }
    this.version++;
    this.changed();
    return generation;
  }
}
