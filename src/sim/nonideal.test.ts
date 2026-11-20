// Step 7c non-idealities of the transistor models against hand calculations:
// BJT series resistances (saturation voltage), Early effect (active-region
// slope), collector-base leakage (ICBO, ICEO); MOSFET lead resistances.

import { describe, expect, it } from 'vitest';
import { VT } from './devices';
import { BC547, BC557, LOGIC_NMOS, solveCircuit } from './index';
import type { ComponentModel, SimInput, SimResult, Terminal } from './index';

type Bjt = Extract<ComponentModel, { kind: 'npn' }>;
type Fet = Extract<ComponentModel, { kind: 'mosfet' }>;
const npn = BC547 as Bjt;

function circuit(models: ComponentModel[], wires: [string, string][]): SimInput {
  const terminal = (s: string): Terminal => {
    const [part, pin] = s.split('.');
    return { part: Number(part), pin };
  };
  return {
    components: models.map((model, i) => ({ id: i + 1, model })),
    links: wires.map(([a, b]) => [terminal(a), terminal(b)]),
  };
}

const battery = (volts: number): ComponentModel => ({ kind: 'battery', volts, rInternal: 0 });
const resistor = (ohms: number): ComponentModel => ({ kind: 'resistor', ohms });
const ground: ComponentModel = { kind: 'ground' };

function solved(input: SimInput): SimResult {
  const r = solveCircuit(input);
  expect(r.converged).toBe(true);
  return r;
}

/**
 * NPN common emitter: `vcc` -> `rc` -> collector (no resistor: straight to
 * vcc), base from its own `vb` supply through `rb`, emitter to ground.
 * Parts: 1 vcc, 2 rc, 3 the transistor, 4 rb, 5 vb, 6 ground.
 */
function commonEmitter(model: ComponentModel, vcc: number, rc: number | null, vb: number, rb: number): SimInput {
  return circuit(
    [battery(vcc), rc === null ? { kind: 'node' } : resistor(rc), model, resistor(rb), battery(vb), ground],
    [
      ...(rc === null ? ([['1.pos', '3.c']] as [string, string][]) : ([['1.pos', '2.a'], ['2.b', '3.c']] as [string, string][])),
      ['5.pos', '4.a'], ['4.b', '3.b'], ['3.e', '1.neg'], ['5.neg', '1.neg'], ['1.neg', '6.gnd'],
    ],
  );
}

/**
 * Intrinsic Vce of the Ebers-Moll model with the Early factor at given
 * terminal currents (NPN frame): Ib = If / bf + Ir / br and
 * Ic = T (If - Ir) - Ir / br with T = 1 - Vbc / VAF, solved for If and Ir
 * (fixed point in T), Vce = Vbe - Vbc.
 */
function intrinsicVce(m: Bjt, ic: number, ib: number): number {
  let t = 1;
  let vbe = 0;
  let vbc = 0;
  for (let k = 0; k < 50; k++) {
    const ir = (t * m.bf * ib - ic) / ((t * m.bf) / m.br + t + 1 / m.br);
    const iF = m.bf * (ib - ir / m.br);
    vbe = VT * Math.log(iF / m.is + 1);
    vbc = VT * Math.log(ir / m.is + 1);
    t = 1 - vbc / m.vaf!;
  }
  return vbe - vbc;
}

describe('BJT series resistances (BC547: rb 10, rc 1, re 0.3 ohm)', () => {
  it('saturates at Ic 10 mA / Ib 1 mA with Vce(sat) = intrinsic + rc Ic + re Ie (about 0.08 V)', () => {
    // 10 V -> 1 k -> collector; 10 V -> 9.3 k -> base: Ic about 9.9 mA, Ib about 1 mA.
    const r = solved(commonEmitter(BC547, 10, 1000, 10, 9300));
    const q = r.parts[3];
    const ic = q.pins.c;
    const ib = q.pins.b;
    expect(ic).toBeGreaterThan(0.0098);
    expect(ib).toBeGreaterThan(0.00098);
    expect(ib).toBeLessThan(0.00102);
    const hand = intrinsicVce(npn, ic, ib) + npn.rc! * ic + npn.re! * (ic + ib);
    expect(Math.abs(q.voltage - hand)).toBeLessThan(1e-5);
    expect(q.voltage).toBeGreaterThan(0.06);
    expect(q.voltage).toBeLessThan(0.2);
    // Without the resistances the same currents would give only the intrinsic ~0.065 V.
    expect(q.voltage - intrinsicVce(npn, ic, ib)).toBeCloseTo(0.0133, 3);
    // The base series resistance adds rb Ib to the pin Vbe.
    expect(q.volts!.b).toBeGreaterThan(0.65);
    expect(q.volts!.b).toBeLessThan(0.85);
  });

  it('meets the datasheet saturation points (10 mA / 0.5 mA: ~0.1 V; 100 mA / 5 mA: ~0.21 V)', () => {
    const low = solved(commonEmitter(BC547, 10, 1000, 10, 18_600)).parts[3];
    expect(low.pins.c / low.pins.b).toBeCloseTo(20, 0);
    expect(low.voltage).toBeGreaterThan(0.08);
    expect(low.voltage).toBeLessThan(0.12); // datasheet typical 0.09 V, max 0.25 V
    const high = solved(commonEmitter(BC547, 10, 100, 10, 1860)).parts[3];
    expect(high.pins.c / high.pins.b).toBeGreaterThan(19);
    expect(high.voltage).toBeGreaterThan(0.18);
    expect(high.voltage).toBeLessThan(0.26); // datasheet typical 0.2 V, max 0.6 V
  });

  it('PNP (BC557): Vec(sat) about 0.1 V at 10 mA / 0.5 mA', () => {
    // Emitter at +10 V, collector -> 1 k -> ground, base -> 18.6 k -> ground.
    const r = solved(circuit(
      [battery(10), BC557, resistor(1000), resistor(18_600), ground],
      [['1.pos', '2.e'], ['2.c', '3.a'], ['3.b', '1.neg'], ['2.b', '4.a'], ['4.b', '1.neg'], ['1.neg', '5.gnd']],
    ));
    const q = r.parts[2];
    expect(-q.voltage).toBeGreaterThan(0.08);
    expect(-q.voltage).toBeLessThan(0.13); // datasheet max 0.3 V
  });
});

describe('BJT Early effect (BC547: VAF 100 V)', () => {
  // Collector straight on the supply, base current fixed by 5 V through 1 Mohm (about 4.3 uA).
  const at = (vcc: number) => solved(commonEmitter(BC547, vcc, null, 5, 1_000_000)).parts[3];

  it('current gain bf (1 - Vbc / VAF) at the internal junction, 300 at Vce = 5 V', () => {
    for (const vcc of [1, 5, 20, 40]) {
      const q = at(vcc);
      const vbcInternal = (q.volts!.b - q.pins.b * npn.rb!) - (q.voltage - q.pins.c * npn.rc!); // both against the emitter pin
      const beta = npn.bf * (1 - vbcInternal / npn.vaf!);
      // The leakage (Vcb / 20 GOhm, under 2 nA) is all that separates them.
      expect(Math.abs(q.pins.c / q.pins.b - beta) / beta).toBeLessThan(1e-3);
    }
    expect(at(5).pins.c / at(5).pins.b).toBeCloseTo(300, 0);
  });

  it('slopes in the active region by Ic / (VAF + Vce - Vbe): output resistance about 23 kohm at 4.3 uA x 300', () => {
    const q5 = at(5);
    const q10 = at(10);
    const slope = (q10.pins.c - q5.pins.c) / (q10.voltage - q5.voltage);
    const hand = q5.pins.c / (npn.vaf! + q5.voltage - q5.volts!.b);
    expect(Math.abs(slope - hand) / hand).toBeLessThan(0.02);
    expect(q10.pins.c / q5.pins.c).toBeGreaterThan(1.04); // 5 V more: about 4.8 % more current
    expect(q10.pins.c / q5.pins.c).toBeLessThan(1.06);
  });
});

describe('BJT leakage (collector-base 20 GOhm: ICBO 1.5 nA at 30 V)', () => {
  it('leaks ICBO with the base tied to the emitter', () => {
    const r = solved(circuit(
      [battery(30), BC547, ground],
      [['1.pos', '2.c'], ['2.b', '2.e'], ['2.e', '1.neg'], ['1.neg', '3.gnd']],
    ));
    // 30 V / 20 GOhm, plus GMIN (1e-12 S) across the base-collector junction.
    expect(r.parts[2].pins.c).toBeCloseTo(30 / npn.rleak! + 30e-12, 12);
  });

  it('amplifies it with an open base: ICEO = (1 + beta) ICBO', () => {
    const r = solved(circuit(
      [battery(30), BC547, ground],
      [['1.pos', '2.c'], ['2.e', '1.neg'], ['1.neg', '3.gnd']],
    ));
    const q = r.parts[2];
    const icbo = (30 - 0.5) / npn.rleak!; // the base sits about 0.5 V above the emitter
    const beta = npn.bf * (1 + (30 - 0.5) / npn.vaf!);
    expect(q.pins.c / ((1 + beta) * icbo)).toBeGreaterThan(0.95);
    expect(q.pins.c / ((1 + beta) * icbo)).toBeLessThan(1.05);
    expect(q.pins.c).toBeLessThan(1e-6); // still "off": under a microamp
  });

  it('a PNP leaks the same way, the other way round', () => {
    const r = solved(circuit(
      [battery(30), BC557, ground],
      [['1.pos', '2.e'], ['2.b', '2.e'], ['2.c', '1.neg'], ['1.neg', '3.gnd']],
    ));
    expect(-r.parts[2].pins.c).toBeCloseTo(30 / (BC557 as Bjt).rleak! + 30e-12, 12);
  });
});

describe('MOSFET lead resistances (0.5 mOhm at drain and source)', () => {
  it('adds Id (rd + rs) to Vds and takes Id rs off the channel Vgs', () => {
    const m = LOGIC_NMOS as Fet;
    // 1 V -> 0.05 ohm -> drain, source grounded, gate 5 V: about 13 A.
    const r = solved(circuit(
      [battery(1), resistor(0.05), LOGIC_NMOS, battery(5), ground],
      [['1.pos', '2.a'], ['2.b', '3.d'], ['3.s', '1.neg'], ['4.pos', '3.g'], ['4.neg', '1.neg'], ['1.neg', '5.gnd']],
    ));
    const q = r.parts[3];
    const id = q.current;
    expect(id).toBeGreaterThan(12);
    // Hand: the channel's Vds solves the triode equation at the internal Vgs.
    const vgs = 5 - id * m.rs!;
    const triode = (v: number) => m.kp * ((vgs - m.vth) * v - (v * v) / 2) * (1 + m.lambda * v) - id;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 100; k++) {
      const mid = (lo + hi) / 2;
      if (triode(mid) > 0) hi = mid;
      else lo = mid;
    }
    const vdsChannel = (lo + hi) / 2;
    expect(q.voltage).toBeCloseTo(vdsChannel + id * (m.rd! + m.rs!), 6);
    expect(q.voltage - vdsChannel).toBeCloseTo(id * 0.001, 6); // 13 mV of the leads
    // The power includes the leads: Vds Id at the pins.
    expect(q.power).toBeCloseTo(q.voltage * id, 6);
  });
});
