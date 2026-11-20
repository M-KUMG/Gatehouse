// Bipolar transistors: Ebers-Moll model in transport form. A PNP is the
// same device with every junction voltage and terminal current reversed
// (polarity -1); for an NPN (polarity 1) every multiplication by the
// polarity is exact, so NPN results are bit-for-bit those of the plain model.
//
// Optional non-idealities (all absent = the plain model, bit for bit):
//  - Series resistances rb, rc, re: the solver (solve.ts) puts them between
//    the pins and internal nodes; this model then sits on the internal
//    nodes (c, b, e) and `ext` keeps the pins' nodes for the result.
//  - Early effect (forward Early voltage vaf), in SPICE's Gummel-Poon form
//    without high injection: the transport current (If - Ir) is multiplied
//    by 1 - Vbc / VAF, which in the active region is 1 + (Vce - Vbe) / VAF.
//    The base current is not, so the current gain grows with Vce the same way.
//  - Collector-base leakage conductance gleak (1 / rleak): ICBO; with an
//    open base the transistor amplifies it to ICEO = (1 + beta) ICBO.

import { GMIN, VT, criticalVoltage, junction } from './devices';
import type { Stamp, VoltOf } from './stamp';
import type { PartResult } from './types';

/** Smallest Early factor 1 - Vbc / VAF (only reached by a wild Newton step with Vbc near VAF). */
const EARLY_MIN = 0.05;

export interface Bjt {
  part: number; c: number; b: number; e: number;
  polarity: 1 | -1;
  is: number; bf: number; br: number; vCrit: number;
  /** Forward Early voltage (Infinity: no Early effect). */
  vaf: number;
  /** Collector-base leakage conductance beyond GMIN (0: none). */
  gleak: number;
  /** The pins' nodes (the same as c, b, e without series resistances). */
  ext: { c: number; b: number; e: number };
  /** Actual (signed) junction voltages the model is linearized at. */
  vbe: number; vbc: number;
}

export interface BjtOptions {
  vaf?: number;
  gleak?: number;
  ext?: { c: number; b: number; e: number };
}

export function makeBjt(
  part: number, nodes: { c: number; b: number; e: number }, polarity: 1 | -1, is: number, bf: number, br: number,
  options: BjtOptions = {},
): Bjt {
  const vaf = options.vaf !== undefined && options.vaf > 0 ? options.vaf : Infinity;
  return {
    part, ...nodes, polarity, is, bf, br, vCrit: criticalVoltage(is, VT),
    vaf, gleak: options.gleak ?? 0, ext: options.ext ?? { ...nodes }, vbe: 0, vbc: 0,
  };
}

/**
 * Collector and base currents (into the part) at actual junction voltages,
 * and the derivatives of the collector current by Vbe (gme) and Vbc (gmc)
 * and of the base current (gbe, gbc). The polarity cancels out of them.
 */
function bjtCurrents(q: Bjt, vbe: number, vbc: number) {
  const p = q.polarity;
  const f = junction(p * vbe, q.is, VT);
  const r = junction(p * vbc, q.is, VT);
  const gbe = f.g / q.bf;
  const gbc = r.g / q.br;
  const ib = p * (f.i / q.bf + r.i / q.br);
  if (q.vaf === Infinity) {
    const gcr = r.g * (1 + 1 / q.br);
    return { ic: p * (f.i - r.i * (1 + 1 / q.br)), ib, gme: f.g, gmc: -gcr, gbe, gbc };
  }
  const raw = 1 - (p * vbc) / q.vaf;
  const early = Math.max(raw, EARLY_MIN);
  const transport = f.i - r.i;
  const dEarly = raw > EARLY_MIN ? -transport / q.vaf : 0; // d(early * transport) / dVbc beyond the junction terms
  return {
    ic: p * (early * transport - r.i / q.br),
    ib,
    gme: early * f.g,
    gmc: -early * r.g + dEarly - r.g / q.br,
    gbe,
    gbc,
  };
}

/** Linearized model at (vbe, vbc). */
export function stampBjt(q: Bjt, s: Stamp): void {
  const { ic, ib, gme, gmc, gbe, gbc } = bjtCurrents(q, q.vbe, q.vbc);
  // Collector current flows c -> e, base current b -> e.
  s.addGm(q.c, q.e, q.b, q.e, gme);
  s.addGm(q.c, q.e, q.b, q.c, gmc);
  s.addI(q.c, q.e, ic - gme * q.vbe - gmc * q.vbc);
  s.addGm(q.b, q.e, q.b, q.e, gbe);
  s.addGm(q.b, q.e, q.b, q.c, gbc);
  s.addI(q.b, q.e, ib - gbe * q.vbe - gbc * q.vbc);
  s.addG(q.b, q.e, GMIN);
  s.addG(q.b, q.c, GMIN);
  if (q.gleak > 0) s.addG(q.b, q.c, q.gleak);
}

/**
 * Move the junctions to the new solution; `limit` applies junction voltage
 * limiting to a forward-positive voltage (it is told the old value too).
 */
export function updateBjt(q: Bjt, volt: VoltOf, limit: (raw: number, old: number, vCrit: number) => number): void {
  const p = q.polarity;
  q.vbe = p * limit(p * (volt(q.b) - volt(q.e)), p * q.vbe, q.vCrit);
  q.vbc = p * limit(p * (volt(q.b) - volt(q.c)), p * q.vbc, q.vCrit);
}

/**
 * Result: voltage is Vce at the pins (negative for a conducting PNP),
 * current the collector current into the part; power includes the series
 * resistances; volts holds the pins against the emitter pin.
 */
export function bjtResult(q: Bjt, volt: VoltOf): PartResult {
  const vbe = volt(q.b) - volt(q.e);
  const vbc = volt(q.b) - volt(q.c);
  const m = bjtCurrents(q, vbe, vbc);
  const ic = m.ic - GMIN * vbc - q.gleak * vbc;
  const ib = m.ib + GMIN * (vbe + vbc) + q.gleak * vbc;
  const ve = volt(q.ext.e);
  const vce = volt(q.ext.c) - ve;
  const vbePins = volt(q.ext.b) - ve;
  return {
    voltage: vce, current: ic, power: vce * ic + vbePins * ib,
    pins: { c: ic, b: ib, e: -(ic + ib) }, volts: { c: vce, b: vbePins, e: 0 },
  };
}
