// The simulation engine: the circuit, the mixed-signal bridge (boards and
// simulated time), burned parts and the values the view derives from a
// result. DOM-free and Scene-free: it takes plain data (the netlist, the
// parts' type ids and states, the board slots) and gives plain data back.
//
// It runs in one of two places, with the same code and the same results:
// - in a Web Worker (sim.worker.ts + host.ts, the default in the browser):
//   the main thread's Simulation (src/simulation.ts) is then a facade that
//   sends commands and reads the latest snapshot the worker posted;
// - in-process (unit tests, `?sim=main`, or when a Worker cannot start):
//   Simulation calls it directly.
// See host.ts for the messages and what runs where.
//
// Determinism: time comes only from the bridge (CPU cycles and fixed 1 ms
// slices); nothing here reads the wall clock except `solveMs` (status line
// only). The same commands at the same simulated times give the same results.
//
// Burned parts: a part beyond its limits (PartType.burnAbove / burnWhen,
// burnReason in parts.ts) is burned HERE, on the engine's own copy of the
// circuit: its model becomes the burned model (type.sim(state with burned))
// and the circuit is solved again at once, exactly as when the scene had been
// changed and the netlist rebuilt (up to MAX_PASSES solves). Each burn gets a
// sequence number and is reported to the owner of the scene, which writes it
// into the part's state (the 'burned' semantics are unchanged: a plain state
// change, saved with the project). Until the owner acknowledges a burn
// (`burnAck` with the next setCircuit), the engine applies it again to every
// netlist it receives, so a netlist built before the owner heard of the burn
// cannot bring the part back.

import { MixedSignal, type BoardSlot, type SliceObserver } from '../../mcu/mixedsignal';
import type { SerialBytes } from '../../mcu/board';
import { burnReason, getPart, type PartState } from '../../parts';
import type { StepObserver } from '../../scope/analog';
import { linkCurrents } from '../flow';
import type { SimInput, SimResult } from '../types';

/** A burned part changes the circuit, which is solved again (at most this many solves per change). */
export const MAX_PASSES = 4;

/** A part as the engine needs it: burn rules and the Scope's readers. */
export interface EnginePart {
  id: number;
  typeId: string;
  state: PartState;
}

/** The circuit the engine simulates (plain data). */
export interface EngineCircuit {
  input: SimInput;
  /** Wire ids: input.links[i] is wire wireIds[i] (the rest are internal links and contacts). */
  wireIds: number[];
  /** Every part of the scene in scene order (the burn rules run over them). */
  parts: EnginePart[];
  /** Bumped by the owner whenever a board's program (emulator) is created, replaced or dropped. */
  boardsVersion: number;
}

/** A part the engine burned. */
export interface Burn {
  /** 1, 2, 3... per engine; the owner acknowledges the highest one it applied. */
  seq: number;
  partId: number;
  /** For state.burnedBy. */
  reason: string;
}

/** What a step of the engine produced besides the new result. */
export interface EngineOutput {
  /** Bytes each board sent, by part id and port id. */
  serial: Map<number, SerialBytes>;
  burns: Burn[];
}

export interface EngineObservers {
  /** The Logic analyzer's recorder (or the worker's forwarder). */
  observer?: SliceObserver | null;
  /** The Scope's analog recorder (or the worker's tap). */
  stepObserver?: StepObserver | null;
}

const signatureOf = (c: EngineCircuit): string => `${c.boardsVersion}|${JSON.stringify(c.input)}`;

/** The circuit with `burns` applied: the parts' states and their models (components keep their order). */
export function withBurns(c: EngineCircuit, burns: readonly Burn[]): EngineCircuit {
  if (burns.length === 0) return c;
  const changed = new Map<number, PartState>();
  const parts = c.parts.map((p) => {
    const burn = burns.find((b) => b.partId === p.id);
    if (!burn || p.state.burned) return p;
    const state = { ...p.state, burned: true, burnedBy: burn.reason };
    changed.set(p.id, state);
    return { ...p, state };
  });
  if (changed.size === 0) return c;
  const components = c.input.components.map((comp) => {
    const state = changed.get(comp.id);
    const part = state && c.parts.find((p) => p.id === comp.id);
    const type = part ? getPart(part.typeId) : undefined;
    return state && type?.sim ? { id: comp.id, model: type.sim(state) } : comp;
  });
  return { ...c, parts, input: { ...c.input, components } };
}

export class SimEngine {
  readonly bridge: MixedSignal;
  /** The circuit clock runs (global Start): time advances without a running board on a reactive circuit. */
  clockRunning = false;
  /** Largest voltage magnitude in the shown result. */
  maxVoltage = 0;
  /** How long the last setCircuit solve took (status line only; the one wall-clock reading). */
  solveMs = 0;
  /** Amps along each wire of `circuit.wireIds` (same order). */
  wireAmps = new Float64Array(0);
  private circuit: EngineCircuit = { input: { components: [], links: [] }, wireIds: [], parts: [], boardsVersion: 0 };
  private signature = '';
  private wireIndex = new Map<number, number>();
  private slots: BoardSlot[] = [];
  private burnSeq = 0;
  /** Burns the owner has not acknowledged yet. */
  private pending: Burn[] = [];

  constructor(observers: EngineObservers = {}) {
    this.bridge = new MixedSignal();
    this.bridge.observer = observers.observer ?? null;
    this.bridge.stepObserver = observers.stepObserver ?? null;
  }

  get result(): SimResult | null {
    return this.bridge.result;
  }

  get time(): number {
    return this.bridge.time;
  }

  /** The circuit as the engine simulates it now (burns applied). */
  get current(): EngineCircuit {
    return this.circuit;
  }

  /** Simulated time moves: a board runs, or the circuit clock runs on a circuit with capacitors or inductors. */
  get timeRunning(): boolean {
    return this.slots.some((s) => s.running && s.emulator !== null) || (this.clockRunning && this.bridge.reactive);
  }

  wireCurrent(wireId: number): number {
    const i = this.wireIndex.get(wireId);
    return i === undefined ? 0 : this.wireAmps[i];
  }

  /**
   * A new or changed circuit (or set of boards). Solved at once when it
   * differs from the current one (burns not yet acknowledged applied first);
   * otherwise only the parts' states are taken over. `burnAck`: the highest
   * burn sequence number the owner has applied.
   */
  setCircuit(c: EngineCircuit, slots: BoardSlot[], burnAck: number): EngineOutput {
    this.pending = this.pending.filter((b) => b.seq > burnAck);
    const next = withBurns(c, this.pending);
    const signature = signatureOf(next);
    if (signature === this.signature) {
      this.circuit = { ...this.circuit, parts: next.parts };
      return { serial: new Map(), burns: [] };
    }
    this.slots = slots;
    const burns = this.solveNew(next, signature);
    return { serial: new Map(), burns: this.settle(burns, MAX_PASSES - 1) };
  }

  /**
   * Run `seconds` of simulated time (whole 1 ms slices; the rest carries
   * over). Nothing happens while time does not run.
   */
  advance(seconds: number): EngineOutput {
    if (!this.timeRunning) return { serial: new Map(), burns: [] };
    const serial = this.bridge.advance(seconds);
    return { serial, burns: this.settle(this.afterSolve(), MAX_PASSES) };
  }

  /**
   * Run until simulated time `until` in steps of at most `chunk` seconds (the
   * deterministic driver for tests and benchmarks: the same steps as a clock
   * that asks for `chunk` per call). Stops early when time stops running.
   */
  runTo(until: number, chunk: number, out: EngineOutput = { serial: new Map(), burns: [] }): EngineOutput {
    while (this.timeRunning && this.bridge.time < until - 1e-9) {
      const step = this.advance(Math.min(chunk, until - this.bridge.time));
      mergeOutput(out, step);
    }
    return out;
  }

  /** Back to time 0: capacitors and inductors lose their charge (the DC point is shown). */
  reset(): EngineOutput {
    this.bridge.reset();
    return { serial: new Map(), burns: this.settle(this.afterSolve(), MAX_PASSES) };
  }

  private solveNew(c: EngineCircuit, signature: string): Burn[] {
    this.circuit = c;
    this.signature = signature;
    this.wireIndex = new Map(c.wireIds.map((id, i) => [id, i]));
    const started = performance.now();
    this.bridge.setCircuit(c.input, this.slots);
    this.solveMs = performance.now() - started;
    return this.afterSolve();
  }

  /** After a solve that burned parts: apply them and solve again, at most `passes` more times. */
  private settle(burns: Burn[], passes: number): Burn[] {
    const all = [...burns];
    let fresh = burns;
    for (let pass = 0; pass < passes && fresh.length > 0; pass++) {
      const next = withBurns(this.circuit, fresh);
      const signature = signatureOf(next);
      if (signature === this.signature) {
        this.circuit = { ...this.circuit, parts: next.parts };
        break;
      }
      fresh = this.solveNew(next, signature);
      all.push(...fresh);
    }
    // Out of passes (or burns that do not change the netlist): they are in the parts' states; the next change solves them.
    if (fresh.length > 0) this.circuit = { ...this.circuit, parts: withBurns(this.circuit, fresh).parts };
    return all;
  }

  /** Derived values after a new result; the parts it burns (only a converged result counts). */
  private afterSolve(): Burn[] {
    const result = this.bridge.result;
    if (!result) return [];
    this.maxVoltage = result.voltages.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
    const flows = linkCurrents(this.circuit.input, result);
    const amps = new Float64Array(this.circuit.wireIds.length);
    for (let i = 0; i < amps.length; i++) amps[i] = flows[i] ?? 0;
    this.wireAmps = amps;
    if (!result.converged) return [];
    const burns: Burn[] = [];
    for (const part of this.circuit.parts) {
      const type = getPart(part.typeId);
      const r = result.parts[part.id];
      if (!type || !r) continue;
      const reason = burnReason(type, r, part.state);
      if (reason === null) continue;
      burns.push({ seq: ++this.burnSeq, partId: part.id, reason });
    }
    this.pending.push(...burns);
    return burns;
  }
}

/** Append `more` to `into` (serial bytes per board and port in order, burns in order). */
export function mergeOutput(into: EngineOutput, more: EngineOutput): EngineOutput {
  for (const [id, ports] of more.serial) {
    let to = into.serial.get(id);
    if (!to) into.serial.set(id, (to = {}));
    for (const [port, bytes] of Object.entries(ports)) (to[port] ??= []).push(...bytes);
  }
  into.burns.push(...more.burns);
  return into;
}
