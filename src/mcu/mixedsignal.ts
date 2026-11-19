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
//
// Circuits with capacitors or inductors (`reactive`) are stepped in time
// instead (transient solve, src/sim/transient.ts, backward Euler):
// - Each slice is cut into steps of the length timestep.ts picks from the
//   circuit (a fiftieth of the smallest R*C or L/R estimate, 1 us .. 1 ms).
//   When the slice's pin segments fit into MAX_STEPS_PER_SLICE steps, every
//   segment is stepped on its own, so a pin change acts at its exact time.
//   Otherwise (fast PWM, many edges) the slice gets a uniform grid of at most
//   MAX_STEPS_PER_SLICE steps and each pin is the time-weighted Norton mean
//   of its setups during that step (exact for a linear RC smoothing PWM,
//   an approximation for nonlinear loads). Either way the cost per slice is
//   bounded and the outcome deterministic; the cap only costs accuracy.
// - The stored charge (`transient`, per component id) carries from slice to
//   slice and survives circuit edits for the parts that still exist (new
//   parts start empty). Before the first step (and after reset()) it is
//   null and the DC operating point is shown, as for any other circuit; the
//   first step starts with every part uncharged, so a charging curve shows.
// - Shown result: the instant at the end of the slice; while a board runs,
//   the slice mean smoothed like above (so PWM still reads as brightness).
//   Between slices (an edit while paused) the circuit is solved with the
//   charge held (one tiny step that is not kept).

import { solveCircuit, solveStep, type PartResult, type PinDrive, type SimInput, type SimResult, type TransientState } from '../sim';
import type { BoardElectrical, BoardEmulator, DriveCode, IoPinDef, SerialBytes } from './board';
import { MAX_STEPS_PER_SLICE, isReactive, stepSeconds } from './timestep';

/** Simulated time between pin feedback steps. */
export const SLICE_SECONDS = 0.001;
/** Time constant of the moving average used for display. */
export const AVERAGE_SECONDS = 0.01;
/** Distinct pin setups kept solved per circuit. */
const CACHE_LIMIT = 512;
/** Step used to show a stepped circuit between slices (charge held, the step is not kept). */
const FREEZE_SECONDS = 1e-9;

type Stepper = typeof solveStep;

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
  return withPins(circuit, slots, (i, j) => pinDrive((drives[i][j] ?? 'Z') as DriveCode, slots[i].electrical), time);
}

/** The circuit with pin j of slot i driven as `drive(i, j)`. */
function withPins(circuit: SimInput, slots: readonly BoardSlot[], drive: (i: number, j: number) => PinDrive, time: number): SimInput {
  const components = circuit.components.map((c) => {
    const i = slots.findIndex((s) => s.partId === c.id);
    if (i < 0 || c.model.kind !== 'board') return c;
    const { io, electrical } = slots[i];
    const pins: Record<string, PinDrive> = {};
    io.forEach((pin, j) => (pins[pin.id] = drive(i, j)));
    return { id: c.id, model: { kind: 'board' as const, rails: { ...electrical.rails }, io: pins } };
  });
  return { components, links: circuit.links, time };
}

/** Time-weighted Norton mean of several setups of one pin (weights need not add up to 1). */
export function meanDrive(parts: readonly { drive: PinDrive; weight: number }[]): PinDrive {
  let total = 0;
  let g = 0;
  let amps = 0;
  for (const { drive, weight } of parts) {
    total += weight;
    g += weight / drive.ohms;
    amps += (weight * drive.volts) / drive.ohms;
  }
  return { ohms: total / g, volts: amps / g };
}

/** Stored charge of the parts of `circuit` that are still a capacitor or inductor. */
function keepStored(circuit: SimInput, stored: TransientState['stored']): TransientState['stored'] {
  const out: TransientState['stored'] = {};
  for (const { id, model } of circuit.components) {
    const s = stored[id];
    if (s && (model.kind === 'capacitor' || model.kind === 'inductor')) out[id] = { ...s };
  }
  return out;
}

interface Segment {
  from: number;
  to: number;
  drives: string[];
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
  /** The circuit has capacitors or inductors: slices are solved in time steps. */
  reactive = false;
  /** Charge of the reactive parts while stepping; null before the first step (the DC point is shown). */
  transient: TransientState | null = null;
  /** Steps the last stepped slice took, and whether it used averaged pins (for tests and diagnostics). */
  lastSlice = { steps: 0, averaged: false };
  /** Step length the time-step rule picked for this circuit (seconds). */
  private step = SLICE_SECONDS;
  /** Circuits per pin setup for the time steps. */
  private readonly inputs = new Map<string, SimInput>();

  constructor(
    private readonly solve: (input: SimInput) => SimResult = solveCircuit,
    private readonly stepper: Stepper = solveStep,
  ) {}

  /** A new or changed circuit (or set of boards). Solves it for the current pins. */
  setCircuit(circuit: SimInput, slots: BoardSlot[]): void {
    this.circuit = circuit;
    this.slots = slots;
    this.cache.clear();
    this.inputs.clear();
    this.levels = slots.map((s) => s.io.map(() => false));
    this.reactive = isReactive(circuit);
    this.step = stepSeconds(circuit, slots.map((s) => s.electrical), SLICE_SECONDS);
    if (!this.reactive) this.transient = null;
    else if (this.transient) this.transient = { time: this.transient.time, stored: keepStored(circuit, this.transient.stored) };
    this.refresh();
  }

  /** Step length the time-step rule picked for the current circuit (seconds; one slice without reactive parts). */
  get stepLength(): number {
    return this.step;
  }

  /** Pins changed outside a slice (a reset, a new program): solve again, restart the average. */
  refresh(): void {
    const drives = this.currentDrives();
    this.instant = this.transient ? this.frozen(drives) : this.solveFor(drives);
    this.result = this.instant;
    this.feedInputs(this.instant);
  }

  /** Back to the start: time 0, no stored charge (the DC point is shown until the next step). */
  reset(): void {
    this.time = 0;
    this.pending = 0;
    this.transient = null;
    this.refresh();
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

    // The slice as segments in which no pin changes.
    const segments: Segment[] = [];
    let from = 0;
    const close = (until: number): void => {
      if (until > from) segments.push({ from, to: until, drives: [...current] });
      from = until;
    };
    for (const c of changes) {
      if (c.at > from) close(c.at);
      current[c.slot] = c.drives;
    }
    close(dt);

    this.time += dt;
    if (this.reactive) {
      this.steppedSlice(segments, current, dt);
      return;
    }
    // Time spent in each distinct pin setup during the slice.
    const weights = new Map<string, { drives: string[]; seconds: number }>();
    for (const seg of segments) {
      const key = seg.drives.join('|');
      const w = weights.get(key) ?? { drives: seg.drives, seconds: 0 };
      w.seconds += seg.to - seg.from;
      weights.set(key, w);
    }
    const mean = mixResults([...weights.values()].filter((w) => w.seconds > 0).map((w) => [this.solveFor(w.drives), w.seconds]), this.time);
    const alpha = 1 - Math.exp(-dt / AVERAGE_SECONDS);
    const prev = this.result;
    this.result = prev && prev.converged && mean.converged ? mixResults([[prev, 1 - alpha], [mean, alpha]], this.time) : mean;
    this.instant = { ...this.solveFor(current), time: this.time };
    this.feedInputs(this.instant);
  }

  /** One slice of a circuit with capacitors or inductors, in time steps (see the top of the file). */
  private steppedSlice(segments: readonly Segment[], current: readonly string[], dt: number): void {
    let state: TransientState = this.transient ?? { time: this.time - dt, stored: {} };
    const steps: [SimResult, number][] = [];
    const run = (input: SimInput, seconds: number): void => {
      const out = this.stepper(input, state, seconds);
      state = out.state;
      steps.push([out.result, seconds]);
    };
    const h = this.step;
    const count = (seconds: number): number => Math.max(1, Math.ceil(seconds / h - 1e-9));
    const exact = segments.reduce((n, s) => n + count(s.to - s.from), 0);
    // One segment needs no averaging: it just gets fewer, longer steps when the cap bites.
    const averaged = exact > MAX_STEPS_PER_SLICE && segments.length > 1;
    if (!averaged) {
      for (const seg of segments) {
        const n = Math.min(MAX_STEPS_PER_SLICE, count(seg.to - seg.from));
        const input = this.inputFor(seg.drives);
        for (let k = 0; k < n; k++) run(input, (seg.to - seg.from) / n);
      }
    } else {
      const n = Math.min(MAX_STEPS_PER_SLICE, count(dt));
      let first = 0;
      for (let k = 0; k < n; k++) {
        const a = (k * dt) / n;
        const b = ((k + 1) * dt) / n;
        const parts: { drives: string[]; weight: number }[] = [];
        let j = first;
        while (j < segments.length && segments[j].from < b) {
          const weight = Math.min(b, segments[j].to) - Math.max(a, segments[j].from);
          if (weight > 0) parts.push({ drives: segments[j].drives, weight });
          if (segments[j].to <= b) j++;
          else break;
        }
        first = j;
        run(parts.length === 1 ? this.inputFor(parts[0].drives) : this.meanInput(parts), b - a);
      }
    }
    this.lastSlice = { steps: steps.length, averaged };
    this.transient = { time: this.time, stored: state.stored };
    const last = steps[steps.length - 1][0];
    this.instant = averaged ? this.frozen(current) : { ...last, time: this.time };
    if (this.slots.some((s) => s.running && s.emulator)) {
      const mean = mixResults(steps, this.time);
      const alpha = 1 - Math.exp(-dt / AVERAGE_SECONDS);
      const prev = this.result;
      this.result = prev && prev.converged && mean.converged ? mixResults([[prev, 1 - alpha], [mean, alpha]], this.time) : mean;
    } else {
      this.result = this.instant;
    }
    this.feedInputs(this.instant);
  }

  /** The stepped circuit for `drives` with the stored charge held (nothing is kept). */
  private frozen(drives: readonly string[]): SimResult {
    const state = this.transient ?? { time: this.time, stored: {} };
    return { ...this.stepper(this.inputFor(drives), state, FREEZE_SECONDS).result, time: this.time };
  }

  /** The circuit for one pin setup (cached per circuit). */
  private inputFor(drives: readonly string[]): SimInput {
    const key = drives.join('|');
    let input = this.inputs.get(key);
    if (!input) {
      if (this.inputs.size >= CACHE_LIMIT) this.inputs.clear();
      input = withDrives(this.circuit, this.slots, drives, 0);
      this.inputs.set(key, input);
    }
    return input;
  }

  /** The circuit with every pin at its time-weighted Norton mean over `parts`. */
  private meanInput(parts: readonly { drives: string[]; weight: number }[]): SimInput {
    return withPins(this.circuit, this.slots, (i, j) => {
      const e = this.slots[i].electrical;
      return meanDrive(parts.map((p) => ({ drive: pinDrive((p.drives[i][j] ?? 'Z') as DriveCode, e), weight: p.weight })));
    }, 0);
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
