// Zener diode (1N4733A-like: 5.1 V, 1 W) as a diode model with reverse
// breakdown, and the diode element math the solver uses for every diode-
// like element (plain, Zener, the buzzer's curve).
//
// Breakdown: the junction conducts ibv * exp(-(v + bv) / (nbv VT))
// backwards (SPICE's diode breakdown without the -1 term), so it carries
// `ibv` at -bv and its current grows tenfold every 60 mV (nbv 1) beyond:
// a sharp knee. The series resistance rs (7 ohm, the 1N4733A's dynamic
// impedance Zzt) sits in series as for any diode, so in breakdown
//   Vz(I) = bv + nbv VT ln(I / ibv) + rs I.
// The part's value Vz is the voltage at ZENER_REF_AMPS (20 mA, a typical
// hobby operating point); bv is set from it (zenerModel). At the
// datasheet's test current 49 mA a 5.1 V part reads 5.33 V (datasheet:
// 4.85..5.36 V), at 5 mA 4.99 V.
// Forward: is 1e-12 A, n 1 (about 0.6 V at 10 mA before rs); the 7 ohm
// also applies forward (0.75 V at 20 mA, 2.1 V at 200 mA where the
// datasheet has at most 1.2 V: forward use at high current reads high).
// Newton limiting: on the breakdown side the junction voltage is limited
// like a forward junction, mirrored about -bv (SPICE's DEVpnjlim use).

import { VT, criticalVoltage, junction, limitJunction } from './devices';
import type { ComponentModel } from './types';

export type DiodeModel = Extract<ComponentModel, { kind: 'diode' }>;

/** Zener voltages offered by the part (state.value), volts. */
export const ZENER_MIN_VOLTS = 2.4;
export const ZENER_MAX_VOLTS = 75;
export const ZENER_DEFAULT_VOLTS = 5.1;
/** Current at which the part's Vz is specified. */
export const ZENER_REF_AMPS = 0.02;
/** Dynamic impedance (series resistance), ohms. */
export const ZENER_RS = 7;
/** Knee current: the reverse current at a junction voltage of -bv. */
export const ZENER_IBV = 1e-3;

/** The Zener diode model for a breakdown voltage `vz` (volts across the part at ZENER_REF_AMPS). */
export function zenerModel(vz: number): DiodeModel {
  const bv = vz - ZENER_REF_AMPS * ZENER_RS - VT * Math.log(ZENER_REF_AMPS / ZENER_IBV);
  return { kind: 'diode', is: 1e-12, n: 1, rs: ZENER_RS, bv, ibv: ZENER_IBV, nbv: 1 };
}

/** What the solver keeps of one diode-like element for its current. */
export interface DiodeCurve {
  is: number;
  nvt: number;
  vCrit: number;
  /** Breakdown (see the header): junction voltage -bv carries ibv; nvtBv = nbv VT. */
  bv?: number;
  ibv?: number;
  nvtBv?: number;
  vCritBv?: number;
  /** A curve of its own instead of the junction (the buzzer): no limiting. */
  curve?: (v: number) => { i: number; g: number };
}

/** The breakdown fields of a diode element for model `m` (empty without bv). */
export function breakdownOf(m: DiodeModel): Pick<DiodeCurve, 'bv' | 'ibv' | 'nvtBv' | 'vCritBv'> {
  if (m.bv === undefined || !(m.bv > 0)) return {};
  const ibv = m.ibv !== undefined && m.ibv > 0 ? m.ibv : 1e-3;
  const nvtBv = (m.nbv ?? 1) * VT;
  return { bv: m.bv, ibv, nvtBv, vCritBv: criticalVoltage(ibv, nvtBv) };
}

/** Current (anode to cathode through the junction) and its slope at junction voltage `v`. */
export function diodeCurrent(d: DiodeCurve, v: number): { i: number; g: number } {
  if (d.curve) return d.curve(v);
  const f = junction(v, d.is, d.nvt);
  if (d.bv === undefined || d.ibv === undefined || d.nvtBv === undefined) return f;
  // ibv exp(x) with x = -(v + bv) / nvtBv, through junction() so a wild step cannot overflow.
  const r = junction(-(v + d.bv), d.ibv, d.nvtBv);
  return { i: f.i - (r.i + d.ibv), g: f.g + r.g };
}

/**
 * The junction voltage Newton's method moves to from `old` towards `raw`:
 * forward limiting as for every junction (`step` is the solver's limiter,
 * which also notes when it limited), on the breakdown side the same limit
 * mirrored about -bv; a curve of its own is not limited.
 */
export function diodeStep(
  d: DiodeCurve, raw: number, old: number,
  step: (raw: number, old: number, nvt: number, vCrit: number) => number = limitJunction,
): number {
  if (d.curve) return raw;
  if (d.bv !== undefined && d.nvtBv !== undefined && d.vCritBv !== undefined && raw < Math.min(0, -d.bv + 10 * d.nvtBv)) {
    const mirrored = step(-(raw + d.bv), -(old + d.bv), d.nvtBv, d.vCritBv);
    return -(mirrored + d.bv);
  }
  return step(raw, old, d.nvt, d.vCrit);
}
