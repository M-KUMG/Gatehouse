// The mixed-signal boundary: the ONE place where emulated microcontrollers
// and the analog circuit meet. Headless and deterministic.
//
// How it works:
// - Simulated time advances in fixed slices (SLICE_SECONDS). The wall clock
//   only decides how many slices to run per animation frame (see clock.ts);
//   nothing in here looks at it, so the outcome never depends on frame rate.
// - In a slice each running board executes its share of CPU cycles and
//   reports the cycle-exact moments its pins changed (PinEvents).
// - The slice is cut into segments where all pins stay the same. Each
//   distinct pin setup becomes a circuit for the DC solver: an output pin is
//   a vcc or 0 V source behind ~25 ohm, INPUT_PULLUP a ~30 kohm resistor to
//   vcc, an input a very high resistance. Each setup is solved once per
//   circuit (cached), so PWM toggling between two setups costs two solves.
// - The shown result is the time-weighted mean of the segments, smoothed
//   over AVERAGE_SECONDS of simulated time (an exponential moving average).
//   A 1 Hz blink stays a crisp blink; PWM reads as a steady mean current,
//   so an LED shows a brightness instead of flicker. First approximation:
//   it averages currents, it is not a transient analysis.
// - After the slice the circuit is solved for the pins as they are now and
//   the pin voltages are fed back to the boards (digital thresholds, ADC).
//   Inputs therefore lag outputs by at most one slice (1 ms).

import { solveCircuit, type PartResult, type PinDrive, type SimInput, type SimResult } from '../sim';
import type { BoardElectrical, BoardEmulator, DriveCode, IoPinDef, SerialBytes } from './board';

/** Simulated time between pin feedback steps. */
export const SLICE_SECONDS = 0.001;
/** Time constant of the moving average used for display. */
export const AVERAGE_SECONDS = 0.01;
/** Distinct pin setups kept solved per circuit. */
const CACHE_LIMIT = 512;

/** A board in the circuit, as the bridge sees it. Plain data plus its emulator. */
export interface BoardSlot {
  /** Id of the board part (and of its 'board' component in the circuit). */
  partId: number;
  io: readonly IoPinDef[];
  electrical: BoardElectrical;
  /** Null while the board has no program: all pins are inputs. */
  emulator: BoardEmulator | null;
  /** Only running boards execute code; the others keep their pins as they are. */
  running: boolean;
}

/** Thevenin model of one pin for its drive code. */
export function pinDrive(code: DriveCode, e: BoardElectrical): PinDrive {
  switch (code) {
    case 'H':
      return { volts: e.vcc, ohms: e.outputOhms };
    case 'L':
      return { volts: 0, ohms: e.outputOhms };
    case 'P':
      return { volts: e.vcc, ohms: e.pullupOhms };
    case 'Z':
      return { volts: 0, ohms: e.inputOhms };
  }
}

/** The circuit with every board's pins set up as `drives` (one string per slot). */
export function withDrives(circuit: SimInput, slots: readonly BoardSlot[], drives: readonly string[], time: number): SimInput {
  const components = circuit.components.map((c) => {
    const i = slots.findIndex((s) => s.partId === c.id);
    if (i < 0 || c.model.kind !== 'board') return c;
    const { io, electrical } = slots[i];
    const pins: Record<string, PinDrive> = {};
    io.forEach((pin, j) => (pins[pin.id] = pinDrive((drives[i][j] ?? 'Z') as DriveCode, electrical)));
    return { id: c.id, model: { kind: 'board' as const, rails: { ...electrical.rails }, io: pins } };
  });
  return { components, links: circuit.links, time };
}

/** Weighted mean of results that share one circuit (same nets and parts). */
export function mixResults(parts: readonly [SimResult, number][], time: number): SimResult {
  const [first] = parts[0];
  const failed = parts.find(([r]) => !r.converged);
  if (failed) return { ...failed[0], time };
  const total = parts.reduce((sum, [, w]) => sum + w, 0) || 1;
  const voltages = first.voltages.map(() => 0);
  const out: Record<number, PartResult> = {};
  const addRecord = (into: Record<string, number>, from: Record<string, number>, w: number): void => {
    for (const key in from) into[key] = (into[key] ?? 0) + from[key] * w;
  };
  for (const [r, weight] of parts) {
    const w = weight / total;
    r.voltages.forEach((v, i) => (voltages[i] += v * w));
    for (const id in r.parts) {
      const p = r.parts[id];
      const o = (out[id] ??= { voltage: 0, current: 0, power: 0, pins: {}, ...(p.volts ? { volts: {} } : {}) });
      o.voltage += p.voltage * w;
      o.current += p.current * w;
      o.power += p.power * w;
      addRecord(o.pins, p.pins, w);
      if (p.volts && o.volts) addRecord(o.volts, p.volts, w);
    }
  }
  return { ...first, time, voltages, parts: out };
}

export class MixedSignal {
  /** Simulated seconds on the global timeline. */
  time = 0;
  /** Values to show: averaged over the last few ms of simulated time. */
  result: SimResult | null = null;
  /** Solution for the pins as they are right now. */
  instant: SimResult | null = null;
  private circuit: SimInput = { components: [], links: [] };
  private slots: BoardSlot[] = [];
  private readonly cache = new Map<string, SimResult>();
  /** Last digital level fed to each board pin (kept inside the threshold band). */
  private levels: boolean[][] = [];
  /** Simulated time asked for but not yet run (less than one slice). */
  private pending = 0;

  constructor(private readonly solve: (input: SimInput) => SimResult = solveCircuit) {}

  /** A new or changed circuit (or set of boards). Solves it for the current pins. */
  setCircuit(circuit: SimInput, slots: BoardSlot[]): void {
    this.circuit = circuit;
    this.slots = slots;
    this.cache.clear();
    this.levels = slots.map((s) => s.io.map(() => false));
    this.refresh();
  }

  /** Pins changed outside a slice (a reset, a new program): solve again, restart the average. */
  refresh(): void {
    this.instant = this.solveFor(this.currentDrives());
    this.result = this.instant;
    this.feedInputs(this.instant);
  }

  /**
   * Advance the timeline by `seconds` of simulated time, in whole slices
   * (a remainder is kept for the next call). Returns the serial bytes each
   * board sent, by part id and serial port id.
   */
  advance(seconds: number): Map<number, SerialBytes> {
    const serial = new Map<number, SerialBytes>();
    this.pending += seconds;
    while (this.pending >= SLICE_SECONDS - 1e-12) {
      this.pending -= SLICE_SECONDS;
      this.slice(serial);
    }
    return serial;
  }

  /** Volts at a board pin in the instant solution (against the board's gnd). */
  pinVolts(partId: number, pinId: string): number | undefined {
    return this.instant?.parts[partId]?.volts?.[pinId];
  }

  private slice(serial: Map<number, SerialBytes>): void {
    const dt = SLICE_SECONDS;
    // Run every board and collect its pin changes as (time offset, slot, drives).
    const current = this.currentDrives();
    const changes: { at: number; slot: number; drives: string }[] = [];
    this.slots.forEach((s, i) => {
      if (!s.running || !s.emulator) return;
      const run = s.emulator.run(Math.round(dt * s.emulator.clockHz));
      current[i] = run.drives;
      const span = Math.max(1, run.end - run.start);
      for (const e of run.events) changes.push({ at: (Math.min(Math.max(e.cycle - run.start, 0), span) / span) * dt, slot: i, drives: e.drives });
      for (const [port, bytes] of Object.entries(run.serial)) {
        if (bytes.length === 0) continue;
        let byPort = serial.get(s.partId);
        if (!byPort) serial.set(s.partId, (byPort = {}));
        (byPort[port] ??= []).push(...bytes);
      }
    });
    changes.sort((a, b) => a.at - b.at || a.slot - b.slot); // stable: keeps each board's own order

    // Time spent in each distinct pin setup during the slice.
    const weights = new Map<string, { drives: string[]; seconds: number }>();
    let from = 0;
    const spend = (until: number): void => {
      const key = current.join('|');
      const w = weights.get(key) ?? { drives: [...current], seconds: 0 };
      w.seconds += until - from;
      weights.set(key, w);
      from = until;
    };
    for (const c of changes) {
      if (c.at > from) spend(c.at);
      current[c.slot] = c.drives;
    }
    spend(dt);

    this.time += dt;
    const mean = mixResults([...weights.values()].filter((w) => w.seconds > 0).map((w) => [this.solveFor(w.drives), w.seconds]), this.time);
    const alpha = 1 - Math.exp(-dt / AVERAGE_SECONDS);
    const prev = this.result;
    this.result = prev && prev.converged && mean.converged ? mixResults([[prev, 1 - alpha], [mean, alpha]], this.time) : mean;
    this.instant = { ...this.solveFor(current), time: this.time };
    this.feedInputs(this.instant);
  }

  private currentDrives(): string[] {
    return this.slots.map((s) => s.emulator?.drives() ?? 'Z'.repeat(s.io.length));
  }

  private solveFor(drives: readonly string[]): SimResult {
    const key = drives.join('|');
    let r = this.cache.get(key);
    if (!r) {
      if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
      r = this.solve(withDrives(this.circuit, this.slots, drives, this.time));
      this.cache.set(key, r);
    }
    return r;
  }

  /** Pin voltages back into the boards: logic levels with a dead band, volts for the ADC. */
  private feedInputs(r: SimResult): void {
    this.slots.forEach((s, i) => {
      if (!s.emulator) return;
      const volts = r.parts[s.partId]?.volts ?? {};
      const levels = this.levels[i];
      const analog = s.io.map((pin, j) => {
        const v = r.converged ? (volts[pin.id] ?? 0) : 0;
        if (v > s.electrical.highAbove) levels[j] = true;
        else if (v < s.electrical.lowBelow) levels[j] = false;
        return v;
      });
      s.emulator.setInputs({ digital: [...levels], analog });
    });
  }
}
