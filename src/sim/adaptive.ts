// Error-controlled time steps for the transient solver (transient.ts).
//
// The integrator stays backward Euler (L-stable: no ringing, no blow-up for
// any step); this file only picks how long each step is, so curves are
// accurate where the circuit changes fast and steps are long where it does not.
//
// Error estimate (no extra solves on an ordinary step): backward Euler's
// local truncation error is LTE = h^2/2 * x'' for every stored quantity x
// (a capacitor's volts, an inductor's amps). A backward Euler step gives
// the mean slope over the step for free, s = i/C for a capacitor and v/L
// for an inductor (the stored amps / volts of the step). Two consecutive
// slopes are a divided difference: x'' ~ 2 (s1 - s0) / (h1 + h0), so
//   LTE ~ h1^2 |s1 - s0| / (h1 + h0).
// This is the cheapest robust estimator: it costs nothing per step (step
// doubling costs two more solves per step, an explicit predictor needs the
// same history but is less robust for stiff parts), it is exact in the
// slopes the solver computed, and it handles variable steps. Its one weak
// point is a discontinuity (a pin edge, a switch, an edit, the start): the
// slope before it says nothing about the slope after. So after every
// discontinuity a "probe" (one solve of PROBE_SECONDS, not kept) measures the
// slopes right after it; the first step compares against those (h0 = 0, the
// probe's slope is a point value). The probe's result is also the circuit
// right after the edge (pin voltages jump at once), which the caller shows.
//
// Acceptance, per stored quantity:
//   LTE <= RTOL * scale + ATOL
//   scale (capacitor) = max(|v| before and after, its peak |v| so far, the
//                           largest node voltage of the circuit so far)
//   scale (inductor)  = max(|i| before and after, its peak |i| so far, the
//                           largest part current of the circuit so far)
//   RTOL = 1e-3, ATOL = 1 uV for volts and 1 nA for amps (small floors so a
//   quantity that sits at zero does not ask for zero error).
// A rejected step is retried shorter (factor 0.9 sqrt(tol / err), at least
// 0.2); an accepted step lets the next one grow by the same rule, at most
// x2. Steps never go below `minStep` (a step at the floor is accepted
// whatever its error) and never above `maxStep`. The first step after a
// discontinuity is at most the previous step and at most the time in which
// any quantity moves FIRST_STEP_FRACTION of its scale at the probed slope
// (for an RC charging from empty that is RC/50, the old fixed rule, but
// from the real slope instead of a guess at the resistance).
//
// Everything is plain arithmetic on the solver's output: the same inputs and
// calls give the same step sequence (deterministic).

import { solveStep, type TransientState } from './transient';
import type { SimInput, SimResult } from './types';

export type Stepper = typeof solveStep;

export interface AdaptiveOptions {
  /** Shortest step the controller picks (seconds); a step this short is accepted whatever its error. */
  minStep: number;
  /** Longest step (seconds). */
  maxStep: number;
  /** Relative tolerance of the local error, against the quantity's scale. */
  rtol: number;
  /** Absolute floor of the tolerance for capacitor volts. */
  atolVolts: number;
  /** Absolute floor of the tolerance for inductor amps. */
  atolAmps: number;
}

export const ADAPTIVE_DEFAULTS: AdaptiveOptions = {
  minStep: 1e-7,
  maxStep: 0.05,
  rtol: 1e-3,
  atolVolts: 1e-6,
  atolAmps: 1e-9,
};

/** Length of the probe solve after a discontinuity (seconds; never kept). */
export const PROBE_SECONDS = 1e-9;
/** First step after a discontinuity: at most the time to move this fraction of the scale at the probed slope. */
export const FIRST_STEP_FRACTION = 0.02;
const SAFETY = 0.9;
const MAX_GROWTH = 2;
const MIN_SHRINK = 0.2;
/** Times closer than this (seconds) are the same time. */
const EPS = 1e-10;

/** A solved instant: the stored charge and (when known) the circuit's result there. */
export interface Point {
  state: TransientState;
  result: SimResult | null;
}

/** An accepted step that became part of the past (for averaging over a slice). */
export interface Piece {
  from: number;
  to: number;
  result: SimResult;
}

/** Ways `advance` may end. */
export interface AdvanceOptions {
  /** The last step may end after `until` (it is kept as `ahead` and interpolated). */
  overshoot: boolean;
  /** Solves this call may spend; when they run out the rest is one step to `until` and `capped` is set. */
  budget: number;
  /** The circuit over (t0, t1] when it is not constant (pins averaged over the step); default: the set input. */
  inputOver?: (t0: number, t1: number) => SimInput;
}

type Reactive = { id: number; kind: 'capacitor'; farads: number } | { id: number; kind: 'inductor'; henries: number };

function reactivesOf(input: SimInput): Reactive[] {
  const out: Reactive[] = [];
  for (const { id, model: m } of input.components) {
    if (m.kind === 'capacitor' && m.farads > 0) out.push({ id, kind: 'capacitor', farads: m.farads });
    else if (m.kind === 'inductor') out.push({ id, kind: 'inductor', henries: Math.max(m.henries, 1e-15) });
  }
  return out;
}

/**
 * Steps one circuit through time with error control. The caller sets the
 * circuit (`setInput`) whenever it changes and asks for time (`advance`);
 * the last step may run past the asked time (`ahead`, when allowed), and
 * the state in between is interpolated linearly (`stateAt`, `weightAt`).
 */
export class AdaptiveStepper {
  /** Last accepted instant at or before the caller's time. */
  base: Point;
  /** An accepted step past the caller's time, with the current input (null: none). */
  ahead: Point | null = null;
  /** Next step length to try. */
  h: number;
  /** Accepted steps that became past since the last `takePieces()`. */
  private pieces: Piece[] = [];
  private key: string | null = null;
  private input: SimInput | null = null;
  private parts: Reactive[] = [];
  /** Slopes after the last accepted step (or probe); null: a discontinuity, probe first. */
  private slopes: Map<number, number> | null = null;
  /** Length of the step those slopes belong to (0 for a probe: a point value). */
  private hPrev = 0;
  private readonly peaks = new Map<number, number>();
  private vScale = 0;
  private iScale = 0;
  /** Totals since construction (diagnostics, benchmarks). */
  readonly stats = { solves: 0, accepted: 0, rejected: 0, probes: 0 };

  constructor(
    private readonly stepper: Stepper,
    readonly options: AdaptiveOptions,
    start: TransientState,
    firstGuess: number,
  ) {
    this.base = { state: start, result: null };
    this.h = clamp(firstGuess, options.minStep, options.maxStep);
  }

  /** Time of the last accepted instant at or before the caller's time. */
  get time(): number {
    return this.base.state.time;
  }

  /**
   * The circuit is `input` from time `t` on (t between `time` and the end of
   * `ahead`). A different `key` than before is a discontinuity: the state is
   * taken at `t` and the error control restarts. Same key: nothing happens.
   */
  setInput(key: string, input: SimInput | null, t: number): void {
    if (key === this.key) return;
    this.moveTo(t);
    this.key = key;
    this.input = input;
    if (input) this.parts = reactivesOf(input);
    this.slopes = null;
  }

  /**
   * Replace the stored state at the current instant (an edit of the circuit):
   * the state is taken at `t`, `edit` maps it, and the next step restarts the
   * error control (the next `setInput` is always taken as new).
   */
  restart(t: number, edit: (state: TransientState) => TransientState): void {
    this.moveTo(t);
    this.base = { state: edit(this.base.state), result: null };
    this.key = null;
    this.input = null;
    this.slopes = null;
  }

  /** Weight of `ahead` in the linear interpolation at time t (0 without one). */
  weightAt(t: number): number {
    const a = this.ahead;
    if (!a || t <= this.base.state.time) return 0;
    return Math.min(1, (t - this.base.state.time) / (a.state.time - this.base.state.time));
  }

  /** The stored state at time t (between `time` and the end of `ahead`), linearly interpolated. */
  stateAt(t: number): TransientState {
    const w = this.weightAt(t);
    const b = this.base.state;
    if (w === 0 || !this.ahead) return b.time === t ? b : { ...b, time: t };
    const a = this.ahead.state;
    const stored: TransientState['stored'] = {};
    for (const id in a.stored) {
      const p = b.stored[id] ?? { volts: 0, amps: 0 };
      const q = a.stored[id];
      stored[id] = { volts: p.volts + (q.volts - p.volts) * w, amps: p.amps + (q.amps - p.amps) * w };
    }
    const out: TransientState = a.warm ? { time: t, stored, warm: a.warm } : { time: t, stored };
    // The drivers' logic is discrete: the step ahead's (it held over that whole step).
    return a.logic ? { ...out, logic: a.logic } : out;
  }

  /** Accepted steps that became past since the last call. */
  takePieces(): Piece[] {
    const out = this.pieces;
    this.pieces = [];
    return out;
  }

  /**
   * Accepted steps from `time` up to `until` with the current input. Returns
   * the solves spent and whether the budget ran out (then the rest of the way
   * was one step without error control).
   */
  advance(until: number, options: AdvanceOptions): { solves: number; capped: boolean } {
    const { minStep, maxStep } = this.options;
    let solves = 0;
    let capped = false;
    for (;;) {
      if (this.ahead) {
        if (this.ahead.state.time >= until - EPS) break;
        this.commit(this.ahead);
        this.ahead = null;
      }
      const t = this.base.state.time;
      const remaining = until - t;
      if (remaining <= EPS) break;
      const inputFor = (t1: number): SimInput => options.inputOver?.(t, t1) ?? this.input!;
      const force = solves >= options.budget;
      if (force) capped = true;
      if (!this.slopes && !force) {
        this.probe(inputFor(t + remaining));
        solves++;
        continue;
      }
      const tried = Math.min(this.h, maxStep);
      let h = tried;
      if (force || h >= remaining) h = remaining;
      else if (!options.overshoot && h > remaining / 2) h = remaining / 2; // two even steps, no sliver
      if (options.overshoot && !force && tried >= remaining) h = tried;
      const input = inputFor(t + h);
      const out = this.stepper(input, this.base.state, h);
      solves++;
      this.stats.solves++;
      const ratio = out.result.converged && this.slopes ? this.errorRatio(input, out.state, h) : 0;
      if (ratio > 1 && !force && h > minStep * (1 + 1e-9)) {
        this.stats.rejected++;
        this.h = Math.max(minStep, h * Math.max(MIN_SHRINK, SAFETY / Math.sqrt(ratio)));
        continue;
      }
      this.stats.accepted++;
      // Next step: grow or shrink from this one; a step cut short by `until` keeps what was tried.
      const next = h * Math.min(MAX_GROWTH, SAFETY / Math.sqrt(Math.max(ratio, 1e-12)));
      this.h = clamp(h < tried && ratio <= 1 ? Math.max(next, tried) : next, minStep, maxStep);
      this.remember(input, out.state, out.result, h);
      if (!out.result.converged) this.slopes = null; // no slopes to trust: probe again
      const point: Point = { state: out.state, result: out.result };
      if (out.state.time > until + EPS) this.ahead = point;
      else this.commit(point);
    }
    return { solves, capped };
  }

  /** Brings the accepted state to exactly t (interpolated inside `ahead`); `ahead` is dropped. */
  private moveTo(t: number): void {
    const a = this.ahead;
    if (!a) return;
    if (t >= a.state.time - EPS) {
      this.commit(a);
    } else if (t > this.base.state.time + EPS) {
      const from = this.base.state.time;
      this.base = { state: this.stateAt(t), result: null };
      if (a.result) this.pieces.push({ from, to: t, result: a.result });
    }
    this.ahead = null;
  }

  private commit(p: Point, from = this.base.state.time): void {
    if (p.result) this.pieces.push({ from, to: p.state.time, result: p.result });
    this.base = p;
  }

  /** One short solve after a discontinuity: the slopes right after it, and the circuit there. */
  private probe(input: SimInput): void {
    const out = this.stepper(input, this.base.state, PROBE_SECONDS);
    this.stats.solves++;
    this.stats.probes++;
    this.base = { state: this.base.state, result: { ...out.result, time: this.base.state.time } };
    this.slopes = new Map();
    this.hPrev = 0;
    if (!out.result.converged) {
      for (const p of this.partsOf(input)) this.slopes.set(p.id, 0);
      return;
    }
    this.updateScales(out.result);
    let h = this.h;
    for (const p of this.partsOf(input)) {
      const s = slopeOf(p, out.state);
      this.slopes.set(p.id, s);
      const x = valueOf(p, this.base.state);
      const scale = Math.max(Math.abs(x), this.peaks.get(p.id) ?? 0, p.kind === 'capacitor' ? this.vScale : this.iScale);
      const tol = this.options.rtol * scale + (p.kind === 'capacitor' ? this.options.atolVolts : this.options.atolAmps);
      if (Math.abs(s) > 0) h = Math.min(h, (FIRST_STEP_FRACTION * Math.max(scale, tol)) / Math.abs(s));
    }
    this.h = clamp(h, this.options.minStep, this.options.maxStep);
  }

  /** Largest LTE / tolerance over the stored quantities for a step of h to `next`. */
  private errorRatio(input: SimInput, next: TransientState, h: number): number {
    let ratio = 0;
    for (const p of this.partsOf(input)) {
      const s1 = slopeOf(p, next);
      const s0 = this.slopes!.get(p.id) ?? 0;
      const lte = (h * h * Math.abs(s1 - s0)) / (h + this.hPrev);
      const x0 = valueOf(p, this.base.state);
      const x1 = valueOf(p, next);
      const scale = Math.max(Math.abs(x0), Math.abs(x1), this.peaks.get(p.id) ?? 0, p.kind === 'capacitor' ? this.vScale : this.iScale);
      const tol = this.options.rtol * scale + (p.kind === 'capacitor' ? this.options.atolVolts : this.options.atolAmps);
      ratio = Math.max(ratio, lte / tol);
    }
    return ratio;
  }

  /** Slopes, peaks and scales after an accepted step. */
  private remember(input: SimInput, next: TransientState, result: SimResult, h: number): void {
    const slopes = new Map<number, number>();
    for (const p of this.partsOf(input)) {
      slopes.set(p.id, slopeOf(p, next));
      const x = Math.abs(valueOf(p, next));
      if (x > (this.peaks.get(p.id) ?? 0)) this.peaks.set(p.id, x);
    }
    this.slopes = slopes;
    this.hPrev = h;
    if (result.converged) this.updateScales(result);
  }

  private partsOf(input: SimInput): Reactive[] {
    return input === this.input ? this.parts : reactivesOf(input);
  }

  private updateScales(r: SimResult): void {
    for (const v of r.voltages) this.vScale = Math.max(this.vScale, Math.abs(v));
    for (const id in r.parts) this.iScale = Math.max(this.iScale, Math.abs(r.parts[id].current));
  }
}

/** dx/dt of the stored quantity over the step that ended in `s`: i/C or v/L. */
function slopeOf(p: Reactive, s: TransientState): number {
  const st = s.stored[p.id];
  if (!st) return 0;
  return p.kind === 'capacitor' ? st.amps / p.farads : st.volts / p.henries;
}

/** The stored quantity: a capacitor's volts, an inductor's amps. */
function valueOf(p: Reactive, s: TransientState): number {
  const st = s.stored[p.id];
  if (!st) return 0;
  return p.kind === 'capacitor' ? st.volts : st.amps;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
