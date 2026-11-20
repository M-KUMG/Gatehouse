// Enhancement MOSFET, SPICE Level 1 (Shichman-Hodges square law):
//   cut-off    Vgs <= Vth:            Id = 0
//   triode     Vds <  Vgs - Vth:      Id = kp ((Vgs - Vth) Vds - Vds^2 / 2) (1 + lambda Vds)
//   saturation Vds >= Vgs - Vth:      Id = kp / 2 (Vgs - Vth)^2 (1 + lambda Vds)
// kp is the whole transconductance parameter (KP * W / L) in A/V^2.
// Everything is computed for an N-channel device; a P-channel one is the
// same with all voltages and currents reversed (polarity -1, vth negative).
// When Vds goes negative, source and drain swap roles (the device is
// symmetric). The gate draws no current but a 1 GOhm leak to the source
// (and GMIN to the drain), so the gate node is never singular and a gate
// left floating settles at the source voltage: the transistor is off. (A real
// floating gate picks up stray charge and may do anything.)
// Not modelled: the body diode, gate capacitance, subthreshold conduction.

import { GMIN } from './devices';
import type { Stamp, VoltOf } from './stamp';
import type { PartResult } from './types';

/** Gate to source leakage conductance (1 GOhm). */
export const GATE_LEAK = 1e-9;

export interface Mosfet {
  part: number; d: number; g: number; s: number;
  polarity: 1 | -1;
  /** Threshold in the N-channel frame (positive for enhancement devices). */
  vth: number;
  kp: number; lambda: number;
  /** Vgs and Vds in the N-channel frame, as limited by the last Newton step. */
  vgs: number; vds: number;
  /**
   * The pins' nodes. d and s above are internal nodes behind the drain and
   * source lead resistances when the model has them (see solve.ts); else the same.
   */
  ext: { d: number; g: number; s: number };
}

export function makeMosfet(
  part: number, nodes: { d: number; g: number; s: number }, polarity: 1 | -1, vth: number, kp: number, lambda: number,
  ext?: { d: number; g: number; s: number },
): Mosfet {
  return { part, ...nodes, polarity, vth: polarity * vth, kp, lambda, vgs: 0, vds: 0, ext: ext ?? { ...nodes } };
}

/** Drain current (drain -> source, N-channel frame, vds >= 0) and its derivatives. */
export function level1(vgs: number, vds: number, vth: number, kp: number, lambda: number): { id: number; gm: number; gds: number } {
  const vov = vgs - vth;
  if (vov <= 0) return { id: 0, gm: 0, gds: 0 };
  const clm = 1 + lambda * vds;
  if (vds < vov) {
    const core = vov * vds - (vds * vds) / 2;
    return { id: kp * core * clm, gm: kp * vds * clm, gds: kp * (vov - vds) * clm + kp * core * lambda };
  }
  const core = (vov * vov) / 2;
  return { id: kp * core * clm, gm: kp * vov * clm, gds: kp * core * lambda };
}

/**
 * The operating point in terms of the terminals actually acting as drain
 * and source (swapped when vds < 0): channel current from `dd` to `ss` in
 * the actual (signed) frame, the actual Vgs / Vds it was evaluated at, gm and gds.
 */
function operatingPoint(q: Mosfet, vgs: number, vds: number) {
  const p = q.polarity;
  const forward = vds >= 0;
  const vgsE = forward ? vgs : vgs - vds; // Vgd when swapped
  const vdsE = forward ? vds : -vds;
  const m = level1(vgsE, vdsE, q.vth, q.kp, q.lambda);
  return {
    forward,
    dd: forward ? q.d : q.s,
    ss: forward ? q.s : q.d,
    i: p * m.id,
    vgsE: p * vgsE,
    vdsE: p * vdsE,
    gm: m.gm,
    gds: m.gds,
  };
}

export function stampMosfet(q: Mosfet, s: Stamp): void {
  // In actual volts d(p f(p v))/dv = f'(v): the conductances do not depend on the polarity.
  const o = operatingPoint(q, q.vgs, q.vds);
  s.addGm(o.dd, o.ss, q.g, o.ss, o.gm);
  s.addGm(o.dd, o.ss, o.dd, o.ss, o.gds);
  s.addI(o.dd, o.ss, o.i - o.gm * o.vgsE - o.gds * o.vdsE);
  s.addG(q.g, q.s, GATE_LEAK);
  s.addG(q.g, q.d, GMIN);
  s.addG(q.d, q.s, GMIN);
}

/** SPICE's DEVfetlim: keeps a Newton step of a gate voltage from jumping across the threshold region. */
export function fetLimit(vNew: number, vOld: number, vto: number): number {
  const hi = Math.abs(2 * (vOld - vto)) + 2;
  const lo = hi / 2 + 2;
  const vtox = vto + 3.5;
  const delta = vNew - vOld;
  if (vOld >= vto) {
    if (vOld >= vtox) {
      if (delta <= 0) {
        if (vNew >= vtox) return -delta > lo ? vOld - lo : vNew; // going off
        return Math.max(vNew, vto + 2);
      }
      return delta >= hi ? vOld + hi : vNew; // staying on
    }
    return delta <= 0 ? Math.max(vNew, vto - 0.5) : Math.min(vNew, vto + 4); // middle region
  }
  if (delta <= 0) return -delta > hi ? vOld - hi : vNew; // off, going further off
  const vtemp = vto + 0.5;
  if (vNew <= vtemp) return delta > lo ? vOld + lo : vNew;
  return vtemp;
}

/** SPICE's DEVlimvds: limits large steps of the drain-source voltage. */
export function vdsLimit(vNew: number, vOld: number): number {
  if (vOld >= 3.5) {
    if (vNew > vOld) return Math.min(vNew, 3 * vOld + 2);
    return vNew < 3.5 ? Math.max(vNew, 2) : vNew;
  }
  return vNew > vOld ? Math.min(vNew, 4) : Math.max(vNew, -0.5);
}

/** Move to the new solution with step limiting. True when the step was limited (not settled yet). */
export function updateMosfet(q: Mosfet, volt: VoltOf, tol: number): boolean {
  const p = q.polarity;
  const vgsRaw = p * (volt(q.g) - volt(q.s));
  const vdsRaw = p * (volt(q.d) - volt(q.s));
  const vgdRaw = vgsRaw - vdsRaw;
  let vgs: number;
  let vds: number;
  if (q.vds >= 0) {
    vgs = fetLimit(vgsRaw, q.vgs, q.vth);
    vds = vdsLimit(vgs - vgdRaw, q.vds);
  } else {
    const vgd = fetLimit(vgdRaw, q.vgs - q.vds, q.vth);
    vds = -vdsLimit(-(vgsRaw - vgd), -q.vds);
    vgs = vgd + vds;
  }
  q.vgs = vgs;
  q.vds = vds;
  return Math.abs(vgs - vgsRaw) > tol || Math.abs(vds - vdsRaw) > tol;
}

/**
 * Result: voltage is Vds, current the drain current into the part (negative
 * for a conducting P-channel device); volts holds each pin against the
 * source. Voltages are the pins' (lead resistances included, also in the power).
 */
export function mosfetResult(q: Mosfet, volt: VoltOf): PartResult {
  const p = q.polarity;
  const vg = volt(q.g);
  const vd = volt(q.d);
  const vs = volt(q.s);
  const o = operatingPoint(q, p * (vg - vs), p * (vd - vs));
  const channel = o.forward ? o.i : -o.i; // into the drain
  const id = channel + GMIN * (vd - vg) + GMIN * (vd - vs);
  const ig = GATE_LEAK * (vg - vs) + GMIN * (vg - vd);
  const vsPin = volt(q.ext.s);
  const vds = volt(q.ext.d) - vsPin;
  const vgs = volt(q.ext.g) - vsPin;
  return {
    voltage: vds,
    current: id,
    power: vds * id + vgs * ig,
    pins: { d: id, g: ig, s: -(id + ig) },
    volts: { g: vgs, d: vds, s: 0 },
  };
}
