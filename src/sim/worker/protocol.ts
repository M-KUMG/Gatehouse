// Messages between the main thread's Simulation facade (src/simulation.ts)
// and the simulation Worker (sim.worker.ts / host.ts). Plain data only
// (structured clone); typed arrays where the data is numeric.
// See host.ts for what each side does with them.

import type { IdleSkipMode, SerialBytes } from '../../mcu/board';
import type { SimResult } from '../types';
import type { Burn, EngineCircuit } from './engine';

/** A board in a setCircuit message. */
export interface BoardMsg {
  partId: number;
  /** Part type id: the worker makes the emulator from getPart(typeId).board. */
  typeId: string;
  /** Program key (unique per program loaded on the main thread); 0: no program (all pins inputs). */
  key: number;
  /** Program memory, sent once per key (omitted when the worker has it already). */
  flash?: Uint8Array;
  running: boolean;
}

/** Main thread -> Worker. */
export type ToEngine =
  /** The netlist or the boards changed (sent only when its signature changed). `seq` numbers circuits. */
  | { type: 'circuit'; seq: number; circuit: EngineCircuit; boards: BoardMsg[]; burnAck: number }
  /** Run flags: the circuit clock and each board's Run / Pause (sent when one changed). */
  | { type: 'run'; clock: boolean; boards: { partId: number; running: boolean }[] }
  /** Global Reset: time 0, stored charge dropped; analog samples of older epochs are dropped by the main thread. */
  | { type: 'reset'; epoch: number }
  /** Speed multiplier (simulated seconds per wall second; pacing only). */
  | { type: 'speed'; multiplier: number }
  /** Deterministic stepping (tests, benchmarks): `seconds` in one advance, or up to `until` in `chunk` steps. */
  | { type: 'advance'; seconds: number }
  | { type: 'runTo'; until: number; chunk: number }
  /** Bytes typed into the serial console, for the board running program `key`. */
  | { type: 'serial'; partId: number; key: number; port: string; bytes: number[] }
  /** Armed channels: Logic analyzer pins and Scope quantities (the whole set each time). */
  | { type: 'armed'; logic: [number, string][]; analog: [number, string[]][] }
  | { type: 'idleSkip'; mode: IdleSkipMode };

/** Per board in a snapshot. */
export interface BoardSnap {
  partId: number;
  key: number;
  cycles: number;
  clockHz: number;
  /** Baud rate per serial port (null: not set up). */
  bauds: Record<string, number | null>;
}

/** The engine's state after a tick or a command (what the view reads). */
export interface Snapshot {
  /** Circuit `seq` the values belong to (for wireAmps). */
  circuit: number;
  time: number;
  reactive: boolean;
  timeRunning: boolean;
  /** Measured simulated seconds per wall second (0 while time stands still). */
  speed: number;
  solveMs: number;
  maxVoltage: number;
  result: SimResult | null;
  /** The instant solution; only while time stands still (the Scope samples it then). */
  instant: SimResult | null;
  /** Amps along each wire of the circuit `circuit` (its wireIds order). */
  wireAmps: Float64Array;
  boards: BoardSnap[];
}

/** One running board's slice for the Logic analyzer (only boards with armed pins; events thinned to armed pins' changes). */
export interface SliceMsg {
  partId: number;
  key: number;
  clockHz: number;
  start: number;
  end: number;
  drives: string;
  events: { cycle: number; drives: string }[];
}

/** Scope samples of one part: times[i] with values[i * ids.length + j] for ids[j] (null: no value). */
export interface AnalogMsg {
  part: number;
  ids: string[];
  times: number[];
  values: (number | null)[];
}

/** Worker -> main thread. */
export type FromEngine =
  | { type: 'ready' }
  | {
      type: 'frame';
      snapshot: Snapshot;
      /** Serial bytes per board (tagged with the program key that sent them). */
      serial: { partId: number; key: number; bytes: SerialBytes }[];
      burns: Burn[];
      slices: SliceMsg[];
      /** Reset epoch the analog samples belong to. */
      epoch: number;
      analog: AnalogMsg[];
    }
  /** A command failed inside the worker (the worker keeps going). */
  | { type: 'fault'; message: string };
