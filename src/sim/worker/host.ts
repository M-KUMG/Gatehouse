// The Worker side of the simulation (DOM-free; sim.worker.ts connects it to
// the Worker's message port, tests drive it directly).
//
// What runs where:
//   main thread   Scene and editing, buildNetlist (sent only when its
//                 signature changes), board builds (the compiler Worker) and
//                 the board run states (BoardRuntimes: Run / Pause / Reset,
//                 build log, serial store), the transport buttons, drawing.
//                 Simulation (src/simulation.ts) is a facade over the latest
//                 snapshot; the Scope and Logic analyzer read main-thread
//                 recorders fed with the samples the worker sends.
//   this worker   SimEngine (engine.ts): the emulators (made here from the
//                 program bytes), the mixed-signal bridge, every solve, burn
//                 decisions, recording taps, and the frame clock.
//
// Commands (protocol.ts ToEngine): circuit (netlist + boards + programs +
// burn acknowledgement), run (clock and board run flags), reset, speed,
// serial input, armed channels, idle skipping, and the deterministic
// advance / runTo used by tests. Every command is answered with a frame.
//
// Frames (FromEngine 'frame'): the snapshot (time, result and instant,
// wire currents as a Float64Array, max voltage, board cycles and baud rates,
// measured speed), serial bytes per board, burned parts, Logic analyzer
// slices of armed boards and Scope samples of armed parts. One frame per
// clock tick (at most every FRAME_MS) and one after each command; the main
// thread only keeps the newest snapshot, but applies every frame's data.
//
// The clock (the same rule as BoardClock on the main thread): wall time only
// decides how much simulated time to run per tick (wall time since the last
// tick times the speed multiplier, at most MAX_TICK_SECONDS), in CHUNK_SECONDS
// advances, within TICK_BUDGET_MS of compute per tick. Behind (the budget ran
// out): the next tick starts at once, so the simulation can use a whole core;
// keeping up: the next tick waits for the rest of FRAME_MS. Nothing runs
// (no timer at all) while simulated time stands still. Results never depend
// on the pacing: the bridge only knows CPU cycles and fixed 1 ms slices.

import type { IdleSkipMode, SliceResult } from '../../mcu/board';
import type { BoardSlot, SliceObserver } from '../../mcu/mixedsignal';
import { getPart } from '../../parts';
import type { StepObserver } from '../../scope/analog';
import { inspect, quantityValues, type InspectPart } from '../inspect';
import type { ComponentModel, SimResult } from '../types';
import { SimEngine, mergeOutput, type EngineCircuit, type EngineOutput } from './engine';
import type { AnalogMsg, BoardMsg, BoardSnap, FromEngine, SliceMsg, Snapshot, ToEngine } from './protocol';

/** Wall time per tick the simulation may compute (it has its own thread). */
export const TICK_BUDGET_MS = 16;
/** Shortest time between ticks while keeping up (and so between frames). */
export const FRAME_MS = 16;
/** At most this much wall time counts per tick (after a stall). */
export const MAX_TICK_SECONDS = 0.1;
/** Simulated time per advance() call inside a tick. */
export const CHUNK_SECONDS = 0.004;

/** Time source and scheduling (the worker's by default; tests pass their own). */
export interface HostTimer {
  now(): number;
  /** Call `fn` after `ms` (0: as soon as pending messages were handled). */
  schedule(fn: () => void, ms: number): void;
}

export type PostFrame = (msg: FromEngine, transfer: Transferable[]) => void;

/** Forwards the slices of boards with armed pins (events thinned to changes of armed pins). */
class SliceForwarder implements SliceObserver {
  armed = new Map<number, string[]>();
  private out: SliceMsg[] = [];

  constructor(private readonly keyOf: (partId: number) => number) {}

  boards(): void {
    // The main thread tells its own recorder about new programs (it knows them first).
  }

  slice(slot: BoardSlot, run: SliceResult): void {
    const pins = this.armed.get(slot.partId);
    if (!pins || pins.length === 0 || !slot.emulator) return;
    const idx = pins.map((p) => slot.io.findIndex((x) => x.id === p)).filter((j) => j >= 0);
    const events: SliceMsg['events'] = [];
    let prev = run.drives;
    for (const e of run.events) {
      if (idx.some((j) => e.drives[j] !== prev[j])) events.push({ cycle: e.cycle, drives: e.drives });
      prev = e.drives;
    }
    this.out.push({
      partId: slot.partId, key: this.keyOf(slot.partId), clockHz: slot.emulator.clockHz,
      start: run.start, end: run.end, drives: run.drives, events,
    });
  }

  take(): SliceMsg[] {
    const out = this.out;
    this.out = [];
    return out;
  }
}

/** Collects the armed quantities of the armed parts at every solved instant (the values the Scope's reader would read). */
class AnalogTap implements StepObserver {
  armed = new Map<number, string[]>();
  private batches = new Map<number, AnalogMsg>();

  constructor(private readonly readerFor: (part: number) => ((r: SimResult) => ReadonlyMap<string, number>) | null) {}

  get active(): boolean {
    return this.armed.size > 0;
  }

  sample(time: number, result: SimResult): void {
    if (!result.converged) return;
    for (const [part, ids] of this.armed) {
      if (!result.parts[part]) continue;
      const read = this.readerFor(part);
      if (!read) continue;
      const values = read(result);
      let b = this.batches.get(part);
      if (!b || b.ids !== ids) this.batches.set(part, (b = { part, ids, times: [], values: [] }));
      b.times.push(time);
      for (const id of ids) b.values.push(values.get(id) ?? null);
    }
  }

  take(): AnalogMsg[] {
    const out = [...this.batches.values()];
    this.batches.clear();
    return out;
  }

  clear(): void {
    this.batches.clear();
  }
}

interface HostBoard {
  key: number;
  typeId: string;
  slot: BoardSlot;
  ports: string[];
}

export class EngineHost {
  readonly engine: SimEngine;
  /** Measured simulated seconds per wall second (0 while time stands still). */
  speed = 0;
  multiplier = 1;
  private readonly forwarder: SliceForwarder;
  private readonly tap: AnalogTap;
  private readonly boards = new Map<number, HostBoard>();
  private seq = 0;
  private epoch = 0;
  private idleSkip: IdleSkipMode | null = null;
  private out: EngineOutput = { serial: new Map(), burns: [] };
  private ticking = false;
  private last = 0;
  private readers: { circuit: EngineCircuit; models: Map<number, ComponentModel>; info: Map<number, InspectPart> } | null = null;

  constructor(
    private readonly post: PostFrame,
    private readonly timer: HostTimer,
  ) {
    this.forwarder = new SliceForwarder((id) => this.boards.get(id)?.key ?? 0);
    this.tap = new AnalogTap((part) => this.readerFor(part));
    this.engine = new SimEngine({ observer: this.forwarder, stepObserver: this.tap });
  }

  /** The emulator of a board here (tests and diagnostics). */
  emulator(partId: number): BoardSlot['emulator'] {
    return this.boards.get(partId)?.slot.emulator ?? null;
  }

  /** Handle one command, answer with a frame and start the clock if time runs now. */
  handle(msg: ToEngine): void {
    try {
      this.apply(msg);
    } catch (e) {
      this.post({ type: 'fault', message: e instanceof Error ? (e.stack ?? e.message) : String(e) }, []);
    }
    this.flush();
    this.wake();
  }

  private apply(msg: ToEngine): void {
    const engine = this.engine;
    switch (msg.type) {
      case 'circuit': {
        this.seq = msg.seq;
        const slots = this.syncBoards(msg.boards);
        mergeOutput(this.out, engine.setCircuit(msg.circuit, slots, msg.burnAck));
        return;
      }
      case 'run':
        engine.clockRunning = msg.clock;
        for (const b of msg.boards) {
          const hb = this.boards.get(b.partId);
          if (hb) hb.slot.running = b.running;
        }
        return;
      case 'reset':
        this.epoch = msg.epoch;
        mergeOutput(this.out, engine.reset());
        this.tap.clear();
        return;
      case 'speed':
        this.multiplier = msg.multiplier;
        return;
      case 'advance':
        mergeOutput(this.out, engine.advance(msg.seconds));
        return;
      case 'runTo':
        engine.runTo(msg.until, msg.chunk, this.out);
        return;
      case 'serial': {
        const hb = this.boards.get(msg.partId);
        if (hb && hb.key === msg.key) hb.slot.emulator?.sendSerial(msg.port, msg.bytes);
        return;
      }
      case 'armed': {
        const logic = new Map<number, string[]>();
        for (const [board, pin] of msg.logic) {
          const pins = logic.get(board) ?? [];
          pins.push(pin);
          logic.set(board, pins);
        }
        this.forwarder.armed = logic;
        this.tap.armed = new Map(msg.analog.map(([part, ids]) => [part, [...ids]]));
        return;
      }
      case 'idleSkip':
        this.idleSkip = msg.mode;
        for (const hb of this.boards.values()) hb.slot.emulator?.setIdleSkip?.(msg.mode);
        return;
    }
  }

  /** The worker's slots for the boards of a circuit message: emulators made from new programs, the others kept. */
  private syncBoards(boards: readonly BoardMsg[]): BoardSlot[] {
    const keep = new Set(boards.map((b) => b.partId));
    for (const id of this.boards.keys()) if (!keep.has(id)) this.boards.delete(id);
    return boards.map((b) => {
      const spec = getPart(b.typeId)?.board;
      if (!spec) throw new Error(`Unknown board type "${b.typeId}"`);
      let hb = this.boards.get(b.partId);
      if (hb && hb.typeId !== b.typeId) hb = undefined;
      if (!hb || hb.key !== b.key) {
        const emulator = b.key !== 0 && b.flash ? spec.create(b.flash, { clockHz: b.clockHz }) : null;
        if (emulator && this.idleSkip) emulator.setIdleSkip?.(this.idleSkip);
        if (hb) {
          hb.key = b.key;
          hb.slot.emulator = emulator;
        } else {
          hb = {
            key: b.key, typeId: b.typeId, ports: spec.serialPorts.map((p) => p.id),
            slot: { partId: b.partId, io: spec.io, electrical: spec.electrical, emulator, running: b.running },
          };
          this.boards.set(b.partId, hb);
        }
      }
      hb.slot.running = b.running;
      return hb.slot;
    });
  }

  /** The Scope's reader for a part (its model and inspector info from the current circuit), or null. */
  private readerFor(part: number): ((r: SimResult) => ReadonlyMap<string, number>) | null {
    const circuit = this.engine.current;
    if (this.readers?.circuit !== circuit) {
      const models = new Map(circuit.input.components.map((c) => [c.id, c.model]));
      const info = new Map<number, InspectPart>();
      for (const p of circuit.parts) {
        const type = getPart(p.typeId);
        if (type) info.set(p.id, { id: p.id, pins: type.pins, led: p.typeId === 'led', type: p.typeId, burnedBy: p.state.burnedBy });
      }
      this.readers = { circuit, models, info };
    }
    const model = this.readers.models.get(part);
    const info = this.readers.info.get(part);
    if (!model || !info) return null;
    return (r) => quantityValues(inspect(model, r, info));
  }

  /** Post a frame with the snapshot and everything collected since the last one. */
  flush(): void {
    const out = this.out;
    this.out = { serial: new Map(), burns: [] };
    const snapshot = this.snapshot();
    this.post(
      {
        type: 'frame',
        snapshot,
        serial: [...out.serial].map(([partId, bytes]) => ({ partId, key: this.boards.get(partId)?.key ?? 0, bytes })),
        burns: out.burns,
        slices: this.forwarder.take(),
        epoch: this.epoch,
        analog: this.tap.take(),
      },
      [snapshot.wireAmps.buffer],
    );
  }

  private snapshot(): Snapshot {
    const engine = this.engine;
    const timeRunning = engine.timeRunning;
    const boards: BoardSnap[] = [];
    for (const [partId, hb] of this.boards) {
      const emu = hb.slot.emulator;
      const bauds: Record<string, number | null> = {};
      for (const port of hb.ports) bauds[port] = emu ? emu.serialBaud(port) : null;
      boards.push({ partId, key: hb.key, cycles: emu?.cycles ?? 0, clockHz: emu?.clockHz ?? 0, bauds });
    }
    return {
      circuit: this.seq,
      time: engine.time,
      reactive: engine.bridge.reactive,
      timeRunning,
      speed: this.speed,
      solveMs: engine.solveMs,
      maxVoltage: engine.maxVoltage,
      result: engine.result,
      instant: timeRunning ? null : engine.bridge.instant,
      wireAmps: engine.wireAmps.slice(),
      boards,
    };
  }

  /** Start the clock if simulated time runs and no tick is scheduled. */
  wake(): void {
    if (this.ticking || !this.engine.timeRunning) return;
    this.ticking = true;
    this.last = this.timer.now();
    this.timer.schedule(this.tick, FRAME_MS);
  }

  private tick = (): void => {
    const engine = this.engine;
    if (!engine.timeRunning) {
      // Time stopped since the last tick: one last frame (speed 0), then no timer until wake().
      this.ticking = false;
      this.speed = 0;
      this.flush();
      return;
    }
    const now = this.timer.now();
    const wall = Math.min(Math.max(0, (now - this.last) / 1000), MAX_TICK_SECONDS);
    this.last = now;
    const wanted = wall * this.multiplier;
    let done = 0;
    while (done < wanted - 1e-12 && this.timer.now() - now < TICK_BUDGET_MS && engine.timeRunning) {
      const step = Math.min(CHUNK_SECONDS, wanted - done);
      mergeOutput(this.out, engine.advance(step));
      done += step;
    }
    if (wall > 0) {
      const ratio = done / wall;
      this.speed = this.speed > 0 ? this.speed + (ratio - this.speed) * 0.1 : ratio;
    }
    // Still ticking (wake() stays a no-op): behind, the next tick at once; keeping up, after the rest of the frame.
    const behind = done < wanted - 1e-12;
    this.timer.schedule(this.tick, behind ? 0 : Math.max(0, FRAME_MS - (this.timer.now() - now)));
    this.flush();
  };
}
