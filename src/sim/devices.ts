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

/**
 * BC557B-like small-signal PNP: hFE 250 (datasheet B group 220..475, lower
 * than the NPN as usual for PNPs), Veb about 0.63 V at 2 mA, poor reverse beta.
 */
export const BC557: ComponentModel = { kind: 'pnp', is: 6e-14, bf: 250, br: 5 };

/**
 * 1N4148 small-signal silicon diode: the widely used SPICE parameters
 * (IS 2.52 nA, N 1.752, RS 0.568 ohm). About 0.58 V at 1 mA, 0.69 V at 10 mA.
 */
export const D1N4148: ComponentModel = { kind: 'diode', is: 2.52e-9, n: 1.752, rs: 0.568 };

/**
 * Logic-level N-channel power MOSFET, IRLZ44N-like: kp chosen so that
 * Rds(on) = 1 / (kp (Vgs - Vth)) is about 25 mOhm at Vgs = 5 V (the datasheet
 * maximum); saturation current at 5 V is kp / 2 * 3^2 = 58 A.
 */
export const LOGIC_NMOS: ComponentModel = { kind: 'mosfet', polarity: 1, vth: 2.0, kp: 13, lambda: 0.02 };

/**
 * P-channel power MOSFET, IRF9540N-like: Rds(on) = 1 / (kp (|Vgs| - 3)) is
 * about 120 mOhm at Vgs = -10 V (datasheet 117 mOhm), 0.4 ohm at -5 V.
 */
export const POWER_PMOS: ComponentModel = { kind: 'mosfet', polarity: -1, vth: -3.0, kp: 1.2, lambda: 0.02 };

/**
 * Generic 600 V / 20 A N-channel IGBT in TO-247 (the usual MOSFET + PNP
 * equivalent, see the `igbt` model). Vge(th) 4.5 V; the PNP has a low gain
 * (bf 1: half the collector current is the MOSFET's), its Veb is about
 * 0.74 V at 10 A, and rc (23 mOhm drift region) brings Vce(sat) to about
 * 1.7 V at 20 A with Vge = 15 V. Measured with this model (Ic at Vce = 2 V /
 * Vce at Ic = 20 A, see semiconductors.test.ts):
 *   Vge  5 V: 0.51 A (saturates at about 0.5 A: too weak to switch a load)
 *   Vge 10 V: 17 A   / 2.2 V
 *   Vge 15 V: 26 A   / 1.7 V
 * Off-state leakage through rleak (10 MOhm, times 1 + bf): 0.12 mA at 600 V.
 */
export const GENERIC_IGBT: ComponentModel = {
  kind: 'igbt', polarity: 1, vth: 4.5, kp: 2, lambda: 0.01, is: 2.5e-12, bf: 1, br: 0.1, rc: 0.023, rleak: 1e7,
};

/** The P-channel complement of GENERIC_IGBT (P-MOSFET + NPN): the same curves with every sign reversed. */
export const GENERIC_PIGBT: ComponentModel = { ...GENERIC_IGBT, polarity: -1, vth: -4.5 } as ComponentModel;

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
