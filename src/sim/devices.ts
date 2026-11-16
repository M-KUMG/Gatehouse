// Device constants, ready-made models and the pn-junction math.

import type { ComponentModel } from './types';

/** Thermal voltage kT/q at 300 K. */
export const VT = 0.025852;
/** Tiny conductance from every node to ground and across every junction, so nothing floats. */
export const GMIN = 1e-12;
export const SWITCH_CLOSED_OHMS = 0.01;
export const SWITCH_OPEN_OHMS = 1e11;
/** Smallest resistance of one half of a potentiometer track (end stop). */
export const POT_END_OHMS = 1;

const LED_N = 2;
const LED_RS = 2.5;
/** 5 mm red LED: 2.0 V across it at 20 mA. */
export const RED_LED: ComponentModel = {
  kind: 'diode',
  n: LED_N,
  rs: LED_RS,
  is: 0.02 / Math.exp((2.0 - 0.02 * LED_RS) / (LED_N * VT)),
};

/** BC547B-like small-signal NPN. */
export const BC547: ComponentModel = { kind: 'npn', is: 1.8e-14, bf: 300, br: 10 };

const MAX_EXP_ARG = 80;

/** Shockley current and conductance of a junction at `v` (nvt = n * VT). */
export function junction(v: number, is: number, nvt: number): { i: number; g: number } {
  const x = v / nvt;
  if (x > MAX_EXP_ARG) {
    // Continue as a straight line so a wild Newton step cannot overflow.
    const e = Math.exp(MAX_EXP_ARG);
    return { i: is * (e * (1 + x - MAX_EXP_ARG) - 1), g: (is * e) / nvt };
  }
  const e = Math.exp(x);
  return { i: is * (e - 1), g: (is * e) / nvt };
}

/** Voltage above which the junction current explodes; steps beyond it get limited. */
export function criticalVoltage(is: number, nvt: number): number {
  return nvt * Math.log(nvt / (Math.SQRT2 * is));
}

/**
 * SPICE's junction voltage limiting: stops Newton's method from taking a
 * huge forward step up the exponential. Returns the voltage to use.
 */
export function limitJunction(vNew: number, vOld: number, nvt: number, vCrit: number): number {
  if (vNew > vCrit && Math.abs(vNew - vOld) > 2 * nvt) {
    if (vOld > 0) {
      const arg = 1 + (vNew - vOld) / nvt;
      return arg > 0 ? vOld + nvt * Math.log(arg) : vCrit;
    }
    return nvt * Math.log(vNew / nvt);
  }
  return vNew;
}
