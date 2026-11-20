// Time-stepping (transient) solver for circuits with capacitors and inductors.
//
// How a caller advances time:
//   let state = initialState(input);            // t = input.time ?? 0, caps charged to the DC point
//   for each step:
//     const { result, state: next } = solveStep(input, state, dt);
//     // result is the circuit at t = state.time + dt (result.time), next.time === result.time
//     state = next;
// `input` is the circuit during the step (state.time, state.time + dt]: change
// it between steps (a switch flips, a battery or a board pin changes) and the
// new values hold for the whole next step. `SimInput.time` is ignored here;
// time lives only in the TransientState, which is plain data (no hidden module
// state), so the same input, state and dt always give the same output, and a
// state can be saved, copied or sent to a Web Worker. Variable dt is allowed
// (each step uses its own). adaptive.ts picks error-controlled step lengths
// (the mixed-signal bridge steps with it).
//
// Method: companion models (reactive.ts) with backward Euler by default,
// which is L-stable (no ringing or blow-up for any dt, a dt much larger than
// RC just jumps to the steady state). 'trapezoidal' is more accurate for
// smooth signals but needs consistent stored currents: after an abrupt change
// (start from empty, a switch, a pin edge) it rings (+-error every step) unless
// a short Euler step is taken first. Nonlinear parts reuse the DC
// solver's Newton loop with its junction step limiting inside every step.
// Each step starts Newton where the previous one ended (`TransientState.warm`:
// node voltages, junction voltages and which convergence aid it needed), so a
// step usually takes a few iterations instead of starting from zero.
//
// If a step does not converge, result.converged is false and its numbers are
// zeros (as in the DC solve); the returned state keeps every part's previous
// charge and advances the time, so the caller can carry on.

import type { Integration, ReactiveState } from './reactive';
import { solveSettled, type LogicState, type WarmStart } from './solve';
import type { SimInput, SimResult } from './types';

export type { Integration, ReactiveState } from './reactive';
export type { AidHint, LogicState, WarmStart } from './solve';

export interface TransientState {
  /** Simulated time in seconds the state belongs to. */
  time: number;
  /** Capacitor and inductor state per component id; missing = uncharged (0 V, 0 A). */
  stored: Record<number, ReactiveState>;
  /**
   * Where the last solve ended (node voltages, device junction voltages and
   * whether it needed a convergence aid), so the next step starts there
   * instead of from zero; absent: start from zero. It only speeds Newton up
   * (the answer is the same within the solver's tolerance) and is ignored
   * when the netlist changed shape (see WarmStart in solve.ts).
   */
  warm?: WarmStart;
  /**
   * Accepted logic state of each half-bridge driver by component id (see
   * driver.ts): the next step decides its input levels and lockouts with
   * hysteresis against it. Missing: everything low/off (DEFAULT_LOGIC).
   */
  logic?: LogicState;
}

export interface StepOptions {
  /** Default 'euler' (backward Euler). */
  method?: Integration;
}

/**
 * The state to start from at `input.time ?? 0`. By default every capacitor
 * is charged to its DC operating-point voltage and every inductor carries
 * its DC current (the circuit has settled). With `charged: false` (or when
 * the DC solve does not converge) every part starts empty.
 */
export function initialState(input: SimInput, options: { charged?: boolean } = {}): TransientState {
  const time = input.time ?? 0;
  if (options.charged === false) return { time, stored: {} };
  const { stored, warm, logic } = solveSettled(input, undefined, time);
  return withLogic(warm ? { time, stored: stored ?? {}, warm } : { time, stored: stored ?? {} }, logic);
}

/** `state` with the drivers' logic (left out when there are no drivers, so other states stay as they were). */
function withLogic(state: TransientState, logic: LogicState | undefined): TransientState {
  return logic && Object.keys(logic).length > 0 ? { ...state, logic } : state;
}

/** Solves one time step of `dt` seconds (> 0) after `state`. */
export function solveStep(
  input: SimInput, state: TransientState, dt: number, options: StepOptions = {},
): { result: SimResult; state: TransientState } {
  if (!(dt > 0) || !Number.isFinite(dt)) throw new RangeError(`solveStep: dt must be a positive number, got ${dt}`);
  const time = state.time + dt;
  const { result, stored, warm, logic } = solveSettled(
    input, { dt, method: options.method ?? 'euler', stored: state.stored }, time, state.warm, state.logic,
  );
  if (stored) return { result, state: withLogic(warm ? { time, stored, warm } : { time, stored }, logic) };
  // Not converged: hold the previous charge of the parts that still exist.
  const held: Record<number, ReactiveState> = {};
  for (const { id, model } of input.components) {
    const prev = state.stored[id];
    if (prev && (model.kind === 'capacitor' || model.kind === 'inductor')) held[id] = { ...prev };
  }
  return { result, state: withLogic({ time, stored: held }, state.logic) };
}
