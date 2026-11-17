// Bipolar transistors: Ebers-Moll model in transport form. A PNP is the
// same device with every junction voltage and terminal current reversed
// (polarity -1); for an NPN (polarity 1) every multiplication by the
// polarity is exact, so NPN results are bit-for-bit those of the plain model.

import { GMIN, VT, criticalVoltage, junction } from './devices';
import type { Stamp, VoltOf } from './stamp';
import type { PartResult } from './types';

export interface Bjt {
  part: number; c: number; b: number; e: number;
  polarity: 1 | -1;
  is: number; bf: number; br: number; vCrit: number;
  /** Actual (signed) junction voltages the model is linearized at. */
  vbe: number; vbc: number;
}

export function makeBjt(
  part: number, nodes: { c: number; b: number; e: number }, polarity: 1 | -1, is: number, bf: number, br: number,
): Bjt {
  return { part, ...nodes, polarity, is, bf, br, vCrit: criticalVoltage(is, VT), vbe: 0, vbc: 0 };
}

/** Collector and base currents (into the part) at actual junction voltages, and the junction conductances. */
function bjtCurrents(q: Bjt, vbe: number, vbc: number) {
  const p = q.polarity;
  const f = junction(p * vbe, q.is, VT);
  const r = junction(p * vbc, q.is, VT);
  return {
    ic: p * (f.i - r.i * (1 + 1 / q.br)),
    ib: p * (f.i / q.bf + r.i / q.br),
    gf: f.g,
    gr: r.g,
  };
}

/** Linearized model at (vbe, vbc). The polarity cancels out of the conductances. */
export function stampBjt(q: Bjt, s: Stamp): void {
  const { ic, ib, gf, gr } = bjtCurrents(q, q.vbe, q.vbc);
  const gcr = gr * (1 + 1 / q.br);
  // Collector current flows c -> e, base current b -> e.
  s.addGm(q.c, q.e, q.b, q.e, gf);
  s.addGm(q.c, q.e, q.b, q.c, -gcr);
  s.addI(q.c, q.e, ic - gf * q.vbe + gcr * q.vbc);
  s.addGm(q.b, q.e, q.b, q.e, gf / q.bf);
  s.addGm(q.b, q.e, q.b, q.c, gr / q.br);
  s.addI(q.b, q.e, ib - (gf / q.bf) * q.vbe - (gr / q.br) * q.vbc);
  s.addG(q.b, q.e, GMIN);
  s.addG(q.b, q.c, GMIN);
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

/** Result: voltage is Vce (negative for a conducting PNP), current the collector current into the part. */
export function bjtResult(q: Bjt, volt: VoltOf): PartResult {
  const vbe = volt(q.b) - volt(q.e);
  const vbc = volt(q.b) - volt(q.c);
  const m = bjtCurrents(q, vbe, vbc);
  const ic = m.ic - GMIN * vbc;
  const ib = m.ib + GMIN * (vbe + vbc);
  const vce = volt(q.c) - volt(q.e);
  return { voltage: vce, current: ic, power: vce * ic + vbe * ib, pins: { c: ic, b: ib, e: -(ic + ib) } };
}
