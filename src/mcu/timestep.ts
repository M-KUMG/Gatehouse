// How long the time steps of the transient (time-stepping) solve are, chosen
// from the circuit alone so the same circuit always steps the same way.
//
// Rule (documented in the mixed-signal bridge too):
//   R_lo = smallest resistance in the netlist, R_hi = largest, taken from
//          the resistors and the pots' full track, plus the board pins'
//          pull-up for R_hi (floored at 1 ohm, R_hi capped at 1 Mohm; 1 kohm
//          when the circuit has none). Small series resistances (battery
//          internal resistance, a board pin's ~25 ohm output, ESR, DCR, a pot
//          turned to an end) are left out on purpose: they are nearly always
//          in series with a real resistor and would force the shortest steps
//          on most circuits; where they alone set the time constant the step
//          is too long and the edge is smoothed (stable, less accurate).
//   tau  = min( C * R_lo over the capacitors, L / R_hi over the inductors )
//   dt   = clamp(tau / STEPS_PER_TAU, MIN_STEP_SECONDS, slice length)
// Using R_lo for capacitors and R_hi for inductors errs on the short side
// (more steps than the real time constant needs): it costs time, not accuracy.
// The bridge then cuts every slice into at most MAX_STEPS_PER_SLICE steps;
// when that cap bites the steps are longer than the rule wants, so curves
// are less accurate (backward Euler stays stable: a step much longer than the
// time constant jumps to the settled value), but the result stays deterministic.

import type { SimInput } from '../sim';
import type { BoardElectrical } from './board';

/** Steps per smallest time constant: backward Euler then stays within ~1% of e^(-t/tau). */
export const STEPS_PER_TAU = 50;
/** Shortest step the rule picks. */
export const MIN_STEP_SECONDS = 1e-6;
/** At most this many solves per slice (the cost cap; also ends the step rule at slice / 200 = 5 us). */
export const MAX_STEPS_PER_SLICE = 200;

const R_FLOOR = 1;
const R_CEIL = 1e6;
const R_DEFAULT = 1000;

/** True when the circuit has a capacitor or an inductor (it then needs time steps). */
export function isReactive(input: SimInput): boolean {
  return input.components.some((c) => c.model.kind === 'capacitor' || c.model.kind === 'inductor');
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
  }
  return tau;
}

/** The step length the rule above asks for, within one slice of `sliceSeconds`. */
export function stepSeconds(input: SimInput, boards: readonly BoardElectrical[], sliceSeconds: number): number {
  const tau = smallestTimeConstant(input, boards);
  if (!Number.isFinite(tau)) return sliceSeconds;
  return Math.min(sliceSeconds, Math.max(MIN_STEP_SECONDS, tau / STEPS_PER_TAU));
}
