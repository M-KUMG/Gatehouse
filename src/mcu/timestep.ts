// First guess for the length of the transient solver's time steps, chosen
// from the circuit alone so the same circuit always starts the same way.
// The steps themselves are error-controlled (src/sim/adaptive.ts): this guess
// only sets the very first step (before the first probe has measured how
// fast the circuit moves), so a poor guess costs a few rejected steps, not
// accuracy.
//
// Rule:
//   R_lo = smallest resistance in the netlist, R_hi = largest, taken from
//          the resistors and the pots' full track, plus the board pins'
//          pull-up for R_hi (floored at 1 ohm, R_hi capped at 1 Mohm; 1 kohm
//          when the circuit has none). Small series resistances (battery
//          internal resistance, a board pin's ~25 ohm output, ESR, DCR) are
//          left out.
//   tau  = min( C * R_lo over the capacitors, L / R_hi over the inductors )
//   dt   = clamp(tau / STEPS_PER_TAU, MIN_STEP_SECONDS, slice length)
// R_hi for inductors errs on the short side (a 10 mH coil anywhere near a
// 1 Mohm pull-down guesses 0.2 us); the error control grows such a step by
// up to x2 per step as soon as the probe shows nothing is moving that fast.
// The bridge spends at most MAX_STEPS_PER_SLICE solves per 1 ms slice and
// averages the pins of slices with more than AVERAGE_ABOVE pin segments.

import type { SimInput } from '../sim';
import { signalMaxStep } from '../sim/signal';
import type { BoardElectrical } from './board';

/** Steps per smallest time constant estimate (first guess only). */
export const STEPS_PER_TAU = 50;
/** Shortest first guess. */
export const MIN_STEP_SECONDS = 1e-6;
/** At most this many solves per 1 ms slice (the cost cap; when it bites the slice is counted as capped). */
export const MAX_STEPS_PER_SLICE = 200;
/** A slice with more pin segments than this (fast PWM) is stepped with time-averaged pins. */
export const AVERAGE_ABOVE = 50;

const R_FLOOR = 1;
const R_CEIL = 1e6;
const R_DEFAULT = 1000;

/**
 * True when the circuit has a capacitor or an inductor, or a part with a
 * logic state (a half-bridge driver, a logic gate, a 555 or an op-amp: input hysteresis,
 * latches and saturation modes need the state of the previous step): it then needs time steps.
 */
export function isReactive(input: SimInput): boolean {
  return input.components.some((c) => (
    c.model.kind === 'capacitor' || c.model.kind === 'inductor' || c.model.kind === 'halfdriver' || c.model.kind === 'gate'
    || c.model.kind === 'timer555' || c.model.kind === 'opamp'
    || c.model.kind === 'signal' || c.model.kind === 'relay' || c.model.kind === 'motor'
  ));
}

/** Smallest time constant estimate of the circuit (seconds), Infinity without reactive parts. */
export function smallestTimeConstant(input: SimInput, boards: readonly BoardElectrical[] = []): number {
  const ohms: number[] = [];
  for (const { model: m } of input.components) {
    if (m.kind === 'resistor') ohms.push(m.ohms);
    else if (m.kind === 'pot') ohms.push(m.ohms);
  }
  const usable = ohms.filter((r) => Number.isFinite(r) && r > 0);
  const lo = usable.length ? Math.max(R_FLOOR, Math.min(...usable)) : R_DEFAULT;
  const highs = [...usable, ...boards.map((e) => e.pullupOhms).filter((r) => Number.isFinite(r) && r > 0)];
  const hi = highs.length ? Math.min(R_CEIL, Math.max(R_FLOOR, ...highs)) : R_DEFAULT;
  let tau = Infinity;
  for (const { model: m } of input.components) {
    if (m.kind === 'capacitor' && m.farads > 0) tau = Math.min(tau, m.farads * lo);
    else if (m.kind === 'inductor' && m.henries > 0) tau = Math.min(tau, m.henries / hi);
    else if (m.kind === 'motor' && m.henries > 0) tau = Math.min(tau, m.henries / Math.max(m.ohms, 1));
    else if (m.kind === 'relay' && m.coilHenries > 0) tau = Math.min(tau, m.coilHenries / Math.max(m.coilOhms, 1));
  }
  return tau;
}

/** The first step length the rule above guesses, within one slice of `sliceSeconds`. */
export function stepSeconds(input: SimInput, boards: readonly BoardElectrical[], sliceSeconds: number): number {
  const tau = smallestTimeConstant(input, boards);
  const signal = signalMaxStep(input); // a function generator also limits the step (a fraction of its period)
  if (!Number.isFinite(tau)) return Math.min(sliceSeconds, Math.max(MIN_STEP_SECONDS, signal));
  return Math.min(sliceSeconds, Math.max(MIN_STEP_SECONDS, Math.min(tau / STEPS_PER_TAU, signal)));
}
