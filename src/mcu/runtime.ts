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
//   buildBoard  compile only: same build and build log, the board's state
//               (stopped / paused / running, its emulator) is not touched.
// Which program a build produces (compiled sketch or the .hex file): see
// src/build/registry.ts. A failed build leaves the board in the 'error' state
// with a short message; the full output is in `buildLog` (per board, kept
// until its next build, removed with the board).
// Builds are async; onChange listeners hear about every change (also when a
// build finishes), and `version` is bumped whenever an emulator is created,
// replaced or dropped.

import { BuildLog, idleBuildState, type BoardBuildState } from '../build/buildlog';
import type { BuildEvent, BuildInput, BuildResult } from '../build/compiler';
import { buildFirmware } from '../build/registry';
import { formatMessage, type BuildMessage } from '../build/wasm/diagnostics';
import type { BoardEmulator, BoardSpec, SerialBytes } from './board';
import { HexError, parseIntelHex } from './hex';
import type { BoardSlot } from './mixedsignal';
import { SerialStore } from './serialstore';

export interface BoardRuntime extends BoardSlot {
  spec: BoardSpec;
  /** Started since the last reset: Run continues it instead of building again. */
  started: boolean;
  /** A build is in progress. */
  building: boolean;
  /** That build is a buildBoard() (compile only): Run may overtake it. */
  buildOnly: boolean;
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
  /** Build output per board (status, progress, downloads, messages, sizes). */
  readonly buildLog = new BuildLog();
  /**
   * Makes a board's emulator from a successful build. The real one by
   * default; with the simulation in a Worker the Simulation sets a stand-in
   * (RemoteEmulator, src/sim/worker/client.ts) and the real one runs there.
   */
  createEmulator: (spec: BoardSpec, flash: Uint8Array, partId: number) => BoardEmulator = (spec, flash) => spec.create(flash);
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
        this.buildLog.clear(id);
        this.version++;
      }
    }
    return parts.map((p) => {
      let rt = this.byId.get(p.id);
      if (!rt) {
        rt = {
          partId: p.id, spec: p.spec, io: p.spec.io, electrical: p.spec.electrical, emulator: null, running: false,
          started: false, building: false, buildOnly: false, firmwareName: null, messages: [], error: null, generation: 0,
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
    this.buildLog.clearAll();
    this.version++;
    this.changed();
  }

  get(id: number): BoardRuntime | undefined {
    return this.byId.get(id);
  }

  /** Every board runtime (in no particular order). */
  runtimes(): BoardRuntime[] {
    return [...this.byId.values()];
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
    if (!rt || (rt.building && !rt.buildOnly) || rt.running) return;
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

  /**
   * Send bytes to a board's serial port (from the serial console). Accepted
   * only while the board has a program that was started: running, or paused
   * (the bytes then wait in the emulator's queue and arrive once it runs
   * again, at the line's pace in simulated time). Returns false, and drops
   * the bytes, when the board does not exist, is stopped, failed to build or
   * has no such port.
   */
  sendSerial(id: number, port: string, bytes: readonly number[]): boolean {
    if (!this.canSendSerial(id, port)) return false;
    this.byId.get(id)!.emulator!.sendSerial(port, bytes);
    return true;
  }

  /** Whether sendSerial(id, port, ...) would be accepted now. */
  canSendSerial(id: number, port: string): boolean {
    const rt = this.byId.get(id);
    if (!rt?.emulator || !rt.started || rt.error !== null) return false;
    return rt.spec.serialPorts.some((p) => p.id === port);
  }

  /**
   * Compile only (Build button): the same build and build log as Run, but the
   * board keeps its state and emulator. Ignored while Run / Reset builds;
   * a Run or Reset meanwhile overtakes it. Never throws.
   */
  async buildBoard(id: number): Promise<void> {
    const rt = this.byId.get(id);
    if (!rt || rt.building) return;
    const generation = ++rt.generation;
    rt.building = true;
    rt.buildOnly = true;
    this.changed();
    const result = await this.buildLogged(rt, generation);
    if (result === null) return; // overtaken: the newer build owns `building`
    rt.building = false;
    rt.buildOnly = false;
    this.changed();
  }

  /** The build result for a board; never throws. */
  private async buildFor(partId: number, onEvent: (e: BuildEvent) => void): Promise<BuildResult> {
    try {
      const input = this.source(partId);
      if (!input) return { ok: false, errors: ['This board has no files to build from.'] };
      return await this.build({ ...input, onEvent });
    } catch (e) {
      return { ok: false, errors: [`The build failed: ${e instanceof Error ? e.message : String(e)}`] };
    }
  }

  /** Build with the build log kept up to date; null when a newer build or a removal overtook it. */
  private async buildLogged(rt: BoardRuntime, generation: number): Promise<BuildResult | null> {
    const id = rt.partId;
    const current = (): boolean => generation === rt.generation && this.byId.get(id) === rt;
    const startedAt = Date.now();
    this.buildLog.update(id, { ...idleBuildState(), status: 'building', progress: { phase: 'prepare', message: 'Starting build' }, startedAt });
    const result = await this.buildFor(id, (e) => {
      if (!current()) return;
      if (e.kind === 'download') this.buildLog.download(id, e.download);
      else this.buildLog.update(id, { status: 'building', progress: { phase: e.phase, message: e.message, current: e.current, total: e.total } });
    });
    if (!current()) return null;
    this.buildLog.update(id, finishedLog(result, startedAt, Date.now()));
    return result;
  }

  /**
   * Build the board's program and make a new emulator at its start
   * (stopped). Returns null when a newer build or a removal overtook this one.
   */
  private async load(rt: BoardRuntime): Promise<number | null> {
    const generation = ++rt.generation;
    rt.building = true;
    rt.buildOnly = false;
    this.changed();
    const result = await this.buildLogged(rt, generation);
    if (result === null) return null;
    rt.building = false;
    rt.emulator = null;
    rt.running = false;
    rt.started = false;
    this.serial.clear(rt.partId);
    if (!result.ok) {
      rt.error = shortError(result);
      rt.messages = [];
      rt.firmwareName = null;
    } else {
      rt.messages = [...result.messages];
      rt.firmwareName = result.name;
      try {
        rt.emulator = this.createEmulator(rt.spec, parseIntelHex(result.hex, rt.spec.flashBytes).bytes, rt.partId);
        rt.error = null;
      } catch (e) {
        rt.error = `${result.name} is not a valid program. ${e instanceof HexError ? e.message : String(e)}`;
        this.buildLog.update(rt.partId, { status: 'failed', summary: rt.error });
      }
    }
    this.version++;
    this.changed();
    return generation;
  }
}

/** The board's error text: the firmware-file errors as they are; for a compile, the first error and a count. */
function shortError(result: Extract<BuildResult, { ok: false }>): string {
  if (!result.buildMessages) return result.errors.join('\n');
  const errors = result.buildMessages.filter((m) => m.severity === 'error');
  if (errors.length === 0) return result.errors.join('\n') || 'Build failed.';
  const more = errors.length > 1 ? ` (and ${errors.length - 1} more error${errors.length > 2 ? 's' : ''}, see the build output)` : '';
  return `Build failed: ${formatMessage(errors[0])}${more}`;
}

const plain = (severity: BuildMessage['severity'], text: string): BuildMessage => ({ severity, message: text, raw: text });
const pct = (n: number, max: number): number => Math.round((n / max) * 100);

/** The build log's state once a build finished. */
function finishedLog(result: BuildResult, startedAt: number, finishedAt: number): Partial<BoardBuildState> {
  const times = { startedAt, finishedAt, durationMs: finishedAt - startedAt };
  if (!result.ok) {
    const messages = result.buildMessages ?? result.errors.map((e) => plain('error', e));
    const n = messages.filter((m) => m.severity === 'error').length;
    return {
      ...times, status: 'failed', progress: { phase: 'done', message: 'Failed' }, messages,
      summary: `Build failed: ${n} error${n === 1 ? '' : 's'}.`, source: result.buildMessages ? 'compiled' : null,
    };
  }
  const messages = result.buildMessages ?? result.messages.map((m) => plain('note', m));
  const s = result.size;
  const summary =
    result.source === 'compiled'
      ? `Compiled ${result.name}${s ? `: ${s.flashBytes} bytes of flash (${pct(s.flashBytes, s.flashMax)}%), ${s.ramBytes} bytes of RAM (${pct(s.ramBytes, s.ramMax)}%)` : ''}.`
      : `Running ${result.name} (not compiled).`;
  return {
    ...times, status: 'succeeded', progress: { phase: 'done', message: 'Done' }, messages, summary, source: result.source,
    ...(s ? { flashBytes: s.flashBytes, flashMax: s.flashMax, ramBytes: s.ramBytes, ramMax: s.ramMax } : {}),
  };
}
