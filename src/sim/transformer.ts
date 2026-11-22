// Transformer, model kind 'transformer'. Pins: p1, p2 (primary), s1, s2
// (secondary; p1 and s1 are the dotted ends: the voltages at them rise together).
//
// Two magnetically coupled windings, solved as coupled inductors (no ideal
// transformer, so it behaves like the real iron-core part):
//     v1 = L1 di1/dt + M di2/dt        v2 = M di1/dt + L2 di2/dt
// each winding behind its own copper resistance. From three nameplate
// numbers (primary volts, secondary volts, VA) the model derives
//   n = V1 / V2                          the turns ratio
//   r1 = 4 % of V1 / I1,  r2 = r1 / n^2   copper loss: about 8 % at full load
//   L1: a magnetizing current of 8 % of the rated primary current at 50 Hz
//   L2 = L1 / n^2, M = k sqrt(L1 L2) with k = 0.998 (a leakage of about 4 %)
// (transformerParams). So at no load the primary draws a small magnetizing
// current, the secondary voltage is V2 up to the small drops of the windings
// and falls a few percent under load; at DC the primary is only its copper
// resistance, so a transformer on DC takes a huge current and burns, as a real one.
// Not modelled: core saturation and losses, and capacitance between windings.
//
// The companion model of one step is a 2x2 conductance matrix G = dt Linv
// (Euler; dt / 2 Linv with the trapezoidal rule) and the previous currents as
// the constant sources; in the DC solve both windings are near shorts and
// independent. The stored state of the primary is under the part's id, the
// one of the secondary under `secondaryId(id)`.

import { contactId } from './relay';
import { INDUCTOR_DC_OHMS, type Companion, type ReactiveState } from './reactive';
import type { ComponentModel, PartResult } from './types';

export type TransformerModel = Extract<ComponentModel, { kind: 'transformer' }>;

export const TRANSFORMER_PINS = ['p1', 'p2', 's1', 's2'] as const;

export const TRANSFORMER_DEFAULT_PRIMARY = 230;
export const TRANSFORMER_DEFAULT_SECONDARY = 12;
export const TRANSFORMER_VA = 50;
export const TRANSFORMER_MIN_VOLTS = 1;
export const TRANSFORMER_MAX_VOLTS = 1000;

const COUPLING = 0.998;
const COPPER_LOSS = 0.04; // per winding, of the rated voltage
const MAGNETIZING = 0.08; // of the rated primary current
const DESIGN_HZ = 50;

/** Overload of a winding (peak current over the rated peak) from which the part is warned about / burned. */
export const TRANSFORMER_WARN_RATIO = 1.5;
export const TRANSFORMER_BURN_RATIO = 4;

export interface TransformerParams {
  /** Turns ratio primary : secondary. */
  n: number;
  l1: number;
  l2: number;
  m: number;
  r1: number;
  r2: number;
  /** Rated RMS currents of the windings. */
  i1: number;
  i2: number;
}

export function transformerParams(model: TransformerModel): TransformerParams {
  const v1 = Math.max(model.primaryVolts, 1e-3);
  const v2 = Math.max(model.secondaryVolts, 1e-3);
  const va = Math.max(model.va, 1e-3);
  const n = v1 / v2;
  const l1 = (v1 * v1) / (MAGNETIZING * va) / (2 * Math.PI * DESIGN_HZ);
  const l2 = l1 / (n * n);
  return {
    n, l1, l2, m: COUPLING * Math.sqrt(l1 * l2),
    r1: (COPPER_LOSS * v1 * v1) / va, r2: (COPPER_LOSS * v2 * v2) / va,
    i1: va / v1, i2: va / v2,
  };
}

/** Id under which the secondary winding's stored state is kept. */
export const secondaryId = (id: number): number => contactId(id, 0);

/** The 2x2 companion of the winding pair for one step (see the header): currents i = ieq + G v. */
export function coupledCompanion(
  p: TransformerParams, step: Companion | undefined, prev1: ReactiveState | undefined, prev2: ReactiveState | undefined,
): { g11: number; g12: number; g22: number; ieq1: number; ieq2: number } {
  if (!step) return { g11: 1 / INDUCTOR_DC_OHMS, g12: 0, g22: 1 / INDUCTOR_DC_OHMS, ieq1: 0, ieq2: 0 };
  const det = p.l1 * p.l2 - p.m * p.m;
  const scale = step.method === 'trapezoidal' ? step.dt / 2 : step.dt;
  const g11 = (scale * p.l2) / det;
  const g22 = (scale * p.l1) / det;
  const g12 = (-scale * p.m) / det;
  const v1 = prev1?.volts ?? 0;
  const v2 = prev2?.volts ?? 0;
  const i1 = prev1?.amps ?? 0;
  const i2 = prev2?.amps ?? 0;
  if (step.method === 'trapezoidal') {
    return { g11, g12, g22, ieq1: i1 + g11 * v1 + g12 * v2, ieq2: i2 + g12 * v1 + g22 * v2 };
  }
  return { g11, g12, g22, ieq1: i1, ieq2: i2 };
}

/**
 * The part's result from the winding currents `i1` (into p1) and `i2` (into s1) and the voltages across the
 * terminals: the primary as the main values, `volts` holds the secondary ('sec') and the turns ratio ('ratio').
 */
export function transformerResult(model: TransformerModel, v1: number, v2: number, i1: number, i2: number): PartResult {
  const p = transformerParams(model);
  return {
    voltage: v1,
    current: i1,
    power: v1 * i1 + v2 * i2,
    pins: { p1: i1, p2: -i1, s1: i2, s2: -i2 },
    volts: { sec: v2, ratio: p.n, 'i.sec': i2 },
  };
}

/** Warning / burn text for the windings' peak currents (instantaneous values), or ok. */
export function transformerStress(
  model: TransformerModel, r: PartResult,
): { level: 'ok' } | { level: 'warn' | 'burn'; short: string; reason: string } {
  const p = transformerParams(model);
  const ratio = Math.max(Math.abs(r.pins.p1 ?? 0) / (Math.SQRT2 * p.i1), Math.abs(r.pins.s1 ?? 0) / (Math.SQRT2 * p.i2));
  if (ratio > TRANSFORMER_BURN_RATIO) {
    return { level: 'burn', short: 'overloaded!', reason: `windings burned out (${ratio.toFixed(1)} x the rated current; a transformer needs AC, and a load within ${TRANSFORMER_VA} VA)` };
  }
  if (ratio > TRANSFORMER_WARN_RATIO) {
    return { level: 'warn', short: 'overloaded!', reason: `Windings carry ${ratio.toFixed(1)} x the rated current (${TRANSFORMER_VA} VA).` };
  }
  return { level: 'ok' };
}
