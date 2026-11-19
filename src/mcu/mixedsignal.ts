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
// instead (transient solve, src/sim/transient.ts, backward Euler), with
// error-controlled step lengths (src/sim/adaptive.ts: the steps grow while
// the circuit settles and shrink on fast changes, 0.1 us .. 50 ms):
// - Every pin segment of the slice is stepped on its own: a pin change is a
//   discontinuity at its exact time (steps end there, the error control
//   restarts with a short probe). The last step of a slice may run past the
//   slice end (up to 50 ms, `ahead`); slice ends inside it are linearly
//   interpolated (shown values, pin voltages fed back, the stored charge),
//   and a pin change or edit before its end takes the state at that moment
//   from the interpolation and steps on from there. So a circuit that
//   settles slowly costs a few steps per simulated second, not one per slice.
// - With more than AVERAGE_ABOVE segments in a slice (fast PWM, many
//   edges) the slice is stepped as one piece in which each pin is the
//   time-weighted Norton mean of its setups during each step (exact for a
//   linear RC smoothing PWM, an approximation for nonlinear loads); these
//   steps end at the slice end.
// - Cost cap: at most MAX_STEPS_PER_SLICE solves per slice (+1 to show an
//   averaged slice). When the error control would need more, the rest of the
//   slice is stepped without it (one step per remaining segment): less
//   accurate, still stable and deterministic, and counted in `capped` /
//   `lastSlice.capped`.
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
import { ADAPTIVE_DEFAULTS, AdaptiveStepper } from '../sim/adaptive';
import type { BoardElectrical, BoardEmulator, DriveCode, IoPinDef, SerialBytes, SliceResult } from './board';
import { AVERAGE_ABOVE, MAX_STEPS_PER_SLICE, isReactive, stepSeconds } from './timestep';

/** Simulated time between pin feedback steps. */
export const SLICE_SECONDS = 0.001;
/** Time constant of the moving average used for display. */
export const AVERAGE_SECONDS = 0.01;
/** Distinct pin setups kept solved per circuit. */
const CACHE_LIMIT = 512;
/** Step used to show a stepped circuit between slices (charge held, the step is not kept). */
const FREEZE_SECONDS = 1e-9;
/** Input key of an averaged slice (never a drive string). */
const AVERAGED_KEY = '~averaged';

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

/**
 * Watches the boards' slices (the Scope's recorder, src/scope/recorder.ts).
 * Read-only: an observer must not change the slots or slice results it is
 * given, so watching never changes the simulation.
 */
export interface SliceObserver {
  /** The set of boards (or one of their emulators) may have changed (every setCircuit). */
  boards(slots: readonly BoardSlot[]): void;
  /** A running board ran one slice: its cycle-exact pin events. */
  slice(slot: BoardSlot, run: SliceResult): void;
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
  /**
   * The last stepped slice: solves it took (steps, rejected steps and probes;
   * 0 when an earlier step already covered it), whether it used averaged pins
   * and whether the cost cap cut its error control short (diagnostics).
   */
  lastSlice = { steps: 0, averaged: false, capped: false };
  /** Stepped slices whose cost cap bit since the last reset() (the curves there are less accurate). */
  capped = 0;
  /** First step length guess for this circuit (seconds; timestep.ts). */
  private step = SLICE_SECONDS;
  /** The error-controlled stepping while the circuit is reactive and has started; null before. */
  private engine: AdaptiveStepper | null = null;
  /** Circuits per pin setup for the time steps. */
  private readonly inputs = new Map<string, SimInput>();
  /** Told about every slice of every running board (the Scope's recorder); null: nobody watches. */
  observer: SliceObserver | null = null;

  constructor(
    private readonly solve: (input: SimInput) => SimResult = solveCircuit,
    private readonly stepper: Stepper = solveStep,
  ) {}

  /** A new or changed circuit (or set of boards). Solves it for the current pins. */
  setCircuit(circuit: SimInput, slots: BoardSlot[]): void {
    this.circuit = circuit;
    this.slots = slots;
    this.observer?.boards(slots);
    this.cache.clear();
    this.inputs.clear();
    this.levels = slots.map((s) => s.io.map(() => false));
    this.reactive = isReactive(circuit);
    this.step = stepSeconds(circuit, slots.map((s) => s.electrical), SLICE_SECONDS);
    if (!this.reactive) {
      this.transient = null;
      this.engine = null;
    } else if (this.engine) {
      // An edit is a discontinuity: the charge now (interpolated if a step ran
      // ahead) is kept for the parts that still exist, the error control restarts.
      // The warm start stays: the solver ignores it if the netlist changed shape.
      this.engine.restart(this.time, ({ time, stored, warm }) => ({ time, stored: keepStored(circuit, stored), ...(warm ? { warm } : {}) }));
      this.transient = this.engine.base.state;
    }
    this.refresh();
  }

  /** Next step length the error control will try (seconds; before the first step, the first guess from timestep.ts). */
  get stepLength(): number {
    return this.engine?.h ?? this.step;
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
    this.engine = null;
    this.capped = 0;
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
      this.observer?.slice(s, run);
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
    const end = this.time;
    const start = end - dt;
    const engine = (this.engine ??= new AdaptiveStepper(
      this.stepper, { ...ADAPTIVE_DEFAULTS }, this.transient ?? { time: start, stored: {} }, this.step,
    ));
    const before = engine.stats.solves;
    const at = (offset: number): number => (offset >= dt ? end : start + offset);
    const averaged = segments.length > AVERAGE_ABOVE;
    let capped = false;
    if (!averaged) {
      segments.forEach((seg, k) => {
        engine.setInput(seg.drives.join('|'), this.inputFor(seg.drives), at(seg.from));
        // Keep a probe and a step for each later segment, and the one step a capped advance adds.
        const later = segments.length - 1 - k;
        const budget = MAX_STEPS_PER_SLICE - (engine.stats.solves - before) - 2 * later - 1;
        const run = engine.advance(at(seg.to), { overshoot: k === segments.length - 1, budget: Math.max(0, budget) });
        capped ||= run.capped;
      });
    } else {
      engine.setInput(AVERAGED_KEY, null, start);
      const offsetOf = (t: number): number => Math.min(dt, Math.max(0, t - start));
      const run = engine.advance(end, {
        overshoot: false,
        budget: MAX_STEPS_PER_SLICE - 1,
        inputOver: (t0, t1) => this.meanOver(segments, offsetOf(t0), offsetOf(t1)),
      });
      capped = run.capped;
    }
    this.lastSlice = { steps: engine.stats.solves - before, averaged, capped };
    if (capped) this.capped++;
    this.transient = engine.stateAt(end);
    this.instant = averaged ? this.frozen(current) : this.interpolated(engine, end);
    if (this.slots.some((s) => s.running && s.emulator)) {
      // The slice mean: the accepted steps inside it, then the shown instant for the rest.
      const parts: [SimResult, number][] = [];
      let covered = start;
      for (const p of engine.takePieces()) {
        const w = Math.min(p.to, end) - Math.max(p.from, start);
        if (w > 0) parts.push([p.result, w]);
        covered = Math.max(covered, p.to);
      }
      if (end - covered > 1e-12) parts.push([this.instant, end - covered]);
      const mean = parts.length ? mixResults(parts, this.time) : this.instant;
      const alpha = 1 - Math.exp(-dt / AVERAGE_SECONDS);
      const prev = this.result;
      this.result = prev && prev.converged && mean.converged ? mixResults([[prev, 1 - alpha], [mean, alpha]], this.time) : mean;
    } else {
      engine.takePieces();
      this.result = this.instant;
    }
    this.feedInputs(this.instant);
  }

  /** The circuit at time t from the engine: its last result, or interpolated towards the step ahead. */
  private interpolated(engine: AdaptiveStepper, t: number): SimResult {
    const base = engine.base.result;
    const ahead = engine.ahead?.result;
    const w = engine.weightAt(t);
    if (!base) return ahead && w >= 1 ? { ...ahead, time: t } : this.frozen(this.currentDrives());
    if (!ahead || w === 0) return { ...base, time: t };
    return mixResults([[base, 1 - w], [ahead, w]], t);
  }

  /** The circuit with every pin at its time-weighted Norton mean over slice offsets [a, b]. */
  private meanOver(segments: readonly Segment[], a: number, b: number): SimInput {
    const parts: { drives: string[]; weight: number }[] = [];
    for (const seg of segments) {
      const weight = Math.min(b, seg.to) - Math.max(a, seg.from);
      if (weight > 0) parts.push({ drives: seg.drives, weight });
    }
    if (parts.length === 0) {
      // A zero-length span: the pins at that moment.
      const seg = segments.find((x) => x.to > a) ?? segments[segments.length - 1];
      return this.inputFor(seg.drives);
    }
    return parts.length === 1 ? this.inputFor(parts[0].drives) : this.meanInput(parts);
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
