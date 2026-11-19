import { describe, expect, it } from 'vitest';
import { BC547, GENERIC_IGBT, GENERIC_PIGBT, LOGIC_NMOS, POWER_PMOS, RED_LED, solveCircuit } from './index';
import type { ComponentModel, PartResult, SimInput, SimResult, Terminal } from './index';
import { bjtRegion, defaultPlot, inspect, ledBrightness, mosfetRegion, quantityValues, type Quantity } from './inspect';

const ID = 5;

/** A result holding one part with the given pin voltages (each pin its own net) and part values. */
function resultFor(pinVolts: Record<string, number>, part: Partial<PartResult>, converged = true): SimResult {
  const nets: Record<string, number> = {};
  const voltages = [0];
  for (const [pin, v] of Object.entries(pinVolts)) {
    nets[`${ID}:${pin}`] = voltages.length;
    voltages.push(v);
  }
  return {
    time: 0, converged, iterations: 1, reference: 'ground', connectedNets: 0, nets, voltages,
    parts: { [ID]: { voltage: 0, current: 0, power: 0, pins: {}, ...part } },
  };
}

function byId(qs: readonly Quantity[]): Record<string, Quantity> {
  return Object.fromEntries(qs.map((q) => [q.id, q]));
}

function values(model: ComponentModel, pinVolts: Record<string, number>, part: Partial<PartResult>, led = false): Record<string, Quantity> {
  return byId(inspect(model, resultFor(pinVolts, part), { id: ID, led }));
}

describe('inspect: passive parts', () => {
  it('resistor: V, I, P, R and the pin voltages in definition order with names', () => {
    const r = resultFor({ a: 5, b: 3 }, { voltage: 2, current: 0.01, power: 0.02 });
    const qs = inspect({ kind: 'resistor', ohms: 200 }, r, { id: ID, pins: [{ id: 'b', name: '2' }, { id: 'a', name: '1' }] });
    const q = byId(qs);
    expect(q.v.value).toBe(2);
    expect(q.i.value).toBe(0.01);
    expect(q.p.value).toBe(0.02);
    expect(q.r.value).toBe(200);
    expect(q.v.label).toBe('V');
    const pins = qs.filter((x) => x.group === 'pin');
    expect(pins.map((x) => [x.id, x.label, x.value])).toEqual([['v:b', 'V(2)', 3], ['v:a', 'V(1)', 5]]);
  });

  it('capacitor: charge Q = C V and energy C V^2 / 2 of the voltage behind the ESR', () => {
    const q = values({ kind: 'capacitor', farads: 1e-6 }, { a: 5, b: 0 }, { voltage: 5, current: 0, power: 0 });
    expect(q.q.value).toBeCloseTo(5e-6, 15);
    expect(q.e.value).toBeCloseTo(12.5e-6, 15);
    expect(q.q.unit).toBe('C');
    expect(q.e.unit).toBe('J');
    // 5.1 V across with 0.1 A through 1 ohm ESR: 5 V on the capacitance.
    const esr = values({ kind: 'capacitor', farads: 2e-6, esr: 1 }, { a: 5.1, b: 0 }, { voltage: 5.1, current: 0.1, power: 0.51 });
    expect(esr.q.value).toBeCloseTo(10e-6, 15);
    expect(esr.e.value).toBeCloseTo(25e-6, 15);
    expect(esr.v.value).toBe(5.1);
  });

  it('inductor: flux L I and energy L I^2 / 2', () => {
    const q = values({ kind: 'inductor', henries: 0.01 }, { a: 0.002, b: 0 }, { voltage: 0.002, current: 0.2, power: 0.0004 });
    expect(q.flux.value).toBeCloseTo(0.002, 12);
    expect(q.flux.unit).toBe('Wb');
    expect(q.e.value).toBeCloseTo(0.0002, 12);
    expect(q.i.value).toBe(0.2);
  });

  it('battery: terminal voltage, delivered current and power, internal loss', () => {
    const q = values({ kind: 'battery', volts: 9, rInternal: 1.5 }, { pos: 8.7, neg: 0 }, { voltage: 8.7, current: 0.2, power: 1.74 });
    expect(q.v.value).toBe(8.7);
    expect(q.i.value).toBe(0.2);
    expect(q.p.value).toBe(1.74);
    expect(q.ploss.value).toBeCloseTo(0.06, 12);
    expect(q.emf.value).toBe(9);
  });

  it('switch: state as text, current through', () => {
    const q = values({ kind: 'switch', closed: true }, { a: 5, b: 5 }, { voltage: 1e-4, current: 0.01, power: 1e-6 });
    expect(q.state.kind).toBe('text');
    expect(q.state.text).toBe('closed');
    expect(q.i.value).toBe(0.01);
    expect(values({ kind: 'switch', closed: false }, { a: 5, b: 0 }, {}).state.text).toBe('open');
  });

  it('potentiometer: wiper voltage and both track currents', () => {
    const q = values(
      { kind: 'pot', ohms: 10000, position: 0.5 }, { a: 10, w: 5, b: 0 },
      { voltage: 10, current: 0.001, power: 0.01, pins: { a: 0.001, w: 0, b: -0.001 } },
    );
    expect(q.vw.value).toBe(5);
    expect(q.vaw.value).toBe(5);
    expect(q.vwb.value).toBe(5);
    expect(q.iaw.value).toBe(0.001);
    expect(q.iwb.value).toBe(0.001);
    expect(q.iw.value).toBe(0);
    expect(q.pos.value).toBe(50);
  });
});

describe('inspect: diodes and LEDs', () => {
  it('LED brightness from the current (0 below 0.3 mA, log scale, full at 15 mA)', () => {
    expect(ledBrightness(0.0002)).toBe(0);
    expect(ledBrightness(0.015)).toBeCloseTo(1, 12);
    expect(ledBrightness(0.05)).toBe(1);
    expect(ledBrightness(0.001)).toBeCloseTo(Math.log(1 / 0.3) / Math.log(50), 12); // 0.3078
    const q = values(RED_LED, { anode: 2, cathode: 0 }, { voltage: 2, current: 0.001, power: 0.002 }, true);
    expect(q.brightness.value).toBeCloseTo(30.78, 2);
    expect(q.brightness.unit).toBe('%');
    expect(q.vf.value).toBe(2);
    expect(q.if.value).toBe(0.001);
    expect(q.region.text).toBe('forward');
  });

  it('plain diode: no brightness; reverse and off regions', () => {
    const rev = values({ kind: 'diode', is: 1e-9, n: 1.8, rs: 0.5 }, { anode: 0, cathode: 5 }, { voltage: -5, current: -1e-9 });
    expect(rev.brightness).toBeUndefined();
    expect(rev.region.text).toBe('reverse');
    expect(values(RED_LED, { anode: 0.1, cathode: 0 }, { voltage: 0.1, current: 1e-12 }, true).region.text).toBe('off');
  });

  it('a burned LED (open model) only says so', () => {
    const qs = inspect({ kind: 'open' }, resultFor({}, {}), { id: ID, led: true });
    expect(qs).toHaveLength(1);
    expect(qs[0].text).toMatch(/burned/);
  });
});

describe('inspect: bipolar transistors', () => {
  const npn = (vc: number, vb: number, ve: number, ic = 0.001, ib = 0.00001) =>
    values(BC547, { c: vc, b: vb, e: ve }, { voltage: vc - ve, current: ic, power: 0.005, pins: { c: ic, b: ib, e: -(ic + ib) } });

  it('NPN in the active region: junction voltages, currents, beta', () => {
    const q = npn(5, 0.7, 0);
    expect(q.vbe.value).toBeCloseTo(0.7, 12);
    expect(q.vbc.value).toBeCloseTo(-4.3, 12);
    expect(q.vce.value).toBe(5);
    expect(q.ic.value).toBe(0.001);
    expect(q.ib.value).toBe(0.00001);
    expect(q.ie.value).toBeCloseTo(0.00101, 15);
    expect(q.beta.value).toBeCloseTo(100, 9);
    expect(q.region.text).toBe('active');
    expect(q.vce.label).toBe('Vce');
  });

  it('NPN saturation, cutoff and reverse-active', () => {
    expect(npn(0.2, 0.7, 0).region.text).toBe('saturation'); // Vbc = 0.5 V
    expect(npn(0.3, 0.7, 0).region.text).toBe('active'); // Vbc = 0.4 V
    expect(npn(5, 0, 0, 1e-12, 0).region.text).toBe('cutoff');
    expect(npn(0, 0.7, 5).region.text).toBe('reverse-active');
    expect(npn(5, 0, 0, 1e-12, 0).beta.value).toBeNaN(); // no base current: undefined
  });

  it('PNP: signs turned round into the device frame and labelled Veb, Vcb, Vec', () => {
    const pnp = (vc: number) =>
      values({ kind: 'pnp', is: 6e-14, bf: 250, br: 5 }, { c: vc, b: 4.3, e: 5 }, {
        voltage: vc - 5, current: -0.001, power: 0.005, pins: { c: -0.001, b: -0.00001, e: 0.00101 },
      });
    const q = pnp(0);
    expect(q.vbe.label).toBe('Veb');
    expect(q.vbe.value).toBeCloseTo(0.7, 12);
    expect(q.vbc.label).toBe('Vcb');
    expect(q.vbc.value).toBeCloseTo(-4.3, 12);
    expect(q.vce.label).toBe('Vec');
    expect(q.vce.value).toBe(5);
    expect(q.ic.value).toBe(0.001);
    expect(q.ib.value).toBe(0.00001);
    expect(q.ie.value).toBeCloseTo(0.00101, 15);
    expect(q.beta.value).toBeCloseTo(100, 9);
    expect(q.region.text).toBe('active');
    expect(pnp(4.8).region.text).toBe('saturation');
  });

  it('region thresholds', () => {
    expect(bjtRegion(0.49, -5)).toBe('cutoff');
    expect(bjtRegion(0.5, 0.49)).toBe('active');
    expect(bjtRegion(0.5, 0.5)).toBe('saturation');
    expect(bjtRegion(-1, 0.6)).toBe('reverse-active');
  });

  it('matches the solver on a real common-emitter stage (active, beta near bf)', () => {
    // 5 V, 470 k into the base, 1 k collector resistor, emitter to ground.
    const t = (s: string): Terminal => ({ part: Number(s.split('.')[0]), pin: s.split('.')[1] });
    const input: SimInput = {
      components: [
        { id: 1, model: { kind: 'battery', volts: 5, rInternal: 0 } }, { id: 2, model: { kind: 'resistor', ohms: 470e3 } },
        { id: 3, model: { kind: 'resistor', ohms: 1000 } }, { id: 4, model: BC547 }, { id: 6, model: { kind: 'ground' } },
      ],
      links: ([['1.pos', '2.a'], ['1.pos', '3.a'], ['2.b', '4.b'], ['3.b', '4.c'], ['4.e', '1.neg'], ['1.neg', '6.gnd']] as const).map(([a, b]) => [t(a), t(b)]),
    };
    const r = solveCircuit(input);
    const q = byId(inspect(BC547, r, { id: 4 }));
    expect(q.region.text).toBe('active');
    expect(q.beta.value).toBeGreaterThan(290);
    expect(q.beta.value).toBeLessThan(301);
    expect(q.ic.value).toBeCloseTo(r.parts[4].current, 15);
    expect(q.vce.value).toBeCloseTo(r.parts[4].voltage, 12);
  });
});

describe('inspect: MOSFETs', () => {
  const nmos = (vgs: number, vds: number, id = 0) => values(LOGIC_NMOS, { g: vgs, d: vds, s: 0 }, { voltage: vds, current: id, volts: { g: vgs, d: vds, s: 0 } });

  it('N-channel cutoff, triode with the Rds(on) estimate, saturation', () => {
    const off = nmos(1, 5);
    expect(off.region.text).toBe('cutoff');
    expect(off.rds.value).toBeNaN();
    const on = nmos(5, 0.1, 3.8);
    expect(on.region.text).toBe('triode');
    expect(on.rds.value).toBeCloseTo(1 / (13 * 3), 12); // 25.6 mOhm
    expect(on.id.value).toBe(3.8);
    expect(on.vgs.label).toBe('Vgs');
    expect(nmos(3, 5).region.text).toBe('saturation'); // Vds 5 >= Vgs - Vth = 1
    expect(nmos(3, 0.99).region.text).toBe('triode');
  });

  it('N-channel run backwards: source and drain swap for the region', () => {
    expect(mosfetRegion(5, -0.1, 2)).toBe('triode'); // Vgd 5.1 V, |Vds| 0.1
    expect(mosfetRegion(1.9, -0.05, 2)).toBe('cutoff'); // Vgd 1.95 V
    expect(mosfetRegion(2.5, -0.6, 2)).toBe('triode'); // Vgd 3.1, |Vds| 0.6 < 1.1
    expect(mosfetRegion(0, -5, 2)).toBe('saturation'); // Vgd 5, |Vds| 5 >= 3
  });

  it('P-channel: Vsg, Vsd and Isd positive when it conducts', () => {
    const q = values(POWER_PMOS, { g: 2, d: 11.5, s: 12 }, { voltage: -0.5, current: -2, power: 1, volts: { g: -10, d: -0.5, s: 0 } });
    expect(q.vgs.label).toBe('Vsg');
    expect(q.vgs.value).toBe(10);
    expect(q.vds.label).toBe('Vsd');
    expect(q.vds.value).toBe(0.5);
    expect(q.id.label).toBe('Isd');
    expect(q.id.value).toBe(2);
    expect(q.region.text).toBe('triode');
    expect(q.rds.value).toBeCloseTo(1 / (1.2 * 7), 12); // 119 mOhm at Vgs -10 V
    const off = values(POWER_PMOS, { g: 12, d: 0, s: 12 }, { voltage: -12, current: 0, volts: { g: 0, d: -12, s: 0 } });
    expect(off.region.text).toBe('cutoff');
  });
});

describe('inspect: IGBTs and the electrolytic capacitor', () => {
  /** N-IGBT (part 3): Vge on the gate, Vce through `ohms` to the collector, emitter grounded. */
  function igbtAt(model: ComponentModel, vge: number, vcc: number, ohms: number) {
    const t = (s: string): Terminal => ({ part: Number(s.split('.')[0]), pin: s.split('.')[1] });
    const input: SimInput = {
      components: [
        { id: 1, model: { kind: 'battery', volts: vge, rInternal: 0 } }, { id: 2, model: { kind: 'battery', volts: vcc, rInternal: 0 } },
        { id: 3, model }, { id: 4, model: { kind: 'resistor', ohms } }, { id: 6, model: { kind: 'ground' } },
      ],
      links: ([['1.neg', '6.gnd'], ['2.neg', '6.gnd'], ['1.pos', '3.g'], ['2.pos', '4.a'], ['4.b', '3.c'], ['3.e', '6.gnd']] as const)
        .map(([a, b]) => [t(a), t(b)]),
    };
    const r = solveCircuit(input);
    expect(r.converged).toBe(true);
    return { r, q: byId(inspect(model, r, { id: 3, pins: [{ id: 'g', name: 'Gate' }, { id: 'c', name: 'Collector' }, { id: 'e', name: 'Emitter' }] })) };
  }

  it('N-IGBT: Vge, Vce, Ic, Pd, region, the MOSFET / PNP split and the rating state', () => {
    const on = igbtAt(GENERIC_IGBT, 15, 12, 1); // about 10 A, fully on
    expect(on.q.vge.value).toBeCloseTo(15, 9);
    expect(on.q.vge.label).toBe('Vge');
    expect(on.q.vce.value).toBeCloseTo(on.r.parts[3].voltage, 12);
    expect(on.q.ic.value).toBeCloseTo(on.r.parts[3].current, 12);
    expect(on.q.ic.value).toBeGreaterThan(9);
    expect(on.q.region.text).toBe('saturation');
    // bf 1: the MOSFET carries about half of the collector current.
    expect(on.q.imos.value / on.q.ic.value).toBeGreaterThan(0.45);
    expect(on.q.imos.value / on.q.ic.value).toBeLessThan(0.55);
    expect(on.q.imos.value + on.q.ibjt.value).toBeCloseTo(on.q.ic.value, 9);
    expect(on.q.state.text).toBe('ok');
    expect(on.q['v:c'].group).toBe('pin');
    expect(igbtAt(GENERIC_IGBT, 5, 12, 1).q.region.text).toBe('active'); // the gate limits the current
    expect(igbtAt(GENERIC_IGBT, 3, 12, 1).q.region.text).toBe('cutoff');
    expect(igbtAt(GENERIC_IGBT, 15, 12, 0.2).q.state.text).toBe('over-current!'); // above 20 A continuous
    expect(defaultPlot(GENERIC_IGBT)).toEqual(['vge', 'vce', 'ic']);
  });

  it('P-IGBT reads positive in its own frame (Veg, Vec, Ic out of the collector)', () => {
    const { q } = igbtAt(GENERIC_PIGBT, -15, -12, 1);
    expect(q.vge.label).toBe('Veg');
    expect(q.vge.value).toBeCloseTo(15, 9);
    expect(q.vce.label).toBe('Vec');
    expect(q.vce.value).toBeGreaterThan(0);
    expect(q.ic.value).toBeGreaterThan(9);
    expect(q.region.text).toBe('saturation');
  });

  it('a plain capacitor has no rating entries; a polarized one has ESR, rated V and state', () => {
    const plain = values({ kind: 'capacitor', farads: 1e-6 }, { a: 5, b: 0 }, { voltage: 5 });
    expect(plain.esr).toBeUndefined();
    expect(plain.state).toBeUndefined();
    const model: ComponentModel = { kind: 'capacitor', farads: 100e-6, esr: 0.5, polarized: true, ratedVolts: 16 };
    const rev = values(model, { pos: -0.5, neg: 0 }, { voltage: -0.5 });
    expect(rev.state.text).toBe('reverse!');
    expect(rev['v:pos'].value).toBe(-0.5);
    expect(values(model, { pos: 9, neg: 0 }, { voltage: 9 }).state.text).toBe('ok');
  });
});

describe('inspect: boards and special cases', () => {
  it('board: pin voltages in definition order (only pins with a voltage), rail and ground currents', () => {
    const model: ComponentModel = { kind: 'board', rails: { '5v': 5 }, io: { d13: { volts: 5, ohms: 25 } } };
    const r = resultFor({}, { voltage: 5, current: 0.03, power: 0.15, pins: { '5v': -0.02, d13: -0.01, gnd: 0.03 }, volts: { gnd: 0, '5v': 5, d13: 4.75 } });
    const qs = inspect(model, r, {
      id: ID, pins: [{ id: 'd13', name: 'D13 (LED L)' }, { id: '5v', name: '5V' }, { id: 'gnd', name: 'GND' }, { id: 'gnd2', name: 'GND' }],
    });
    expect(qs.map((q) => q.id)).toEqual(['v:d13', 'v:5v', 'v:gnd', 'i:5v', 'i:gnd', 'p']);
    const q = byId(qs);
    expect(q['v:d13'].value).toBe(4.75);
    expect(q['v:d13'].label).toBe('D13 (LED L)');
    expect(q['i:5v'].value).toBe(0.02);
    expect(q['i:gnd'].value).toBe(0.03);
    expect(q.p.value).toBe(0.15);
    expect(qs.some((x) => x.group === 'pin')).toBe(false);
  });

  it('ground and junctions have no values; a failed solve says so', () => {
    expect(inspect({ kind: 'ground' }, resultFor({ gnd: 0 }, {}), { id: ID })).toEqual([]);
    expect(inspect({ kind: 'node' }, resultFor({ n: 0 }, {}), { id: ID })).toEqual([]);
    const failed = inspect({ kind: 'resistor', ohms: 1 }, resultFor({ a: 0, b: 0 }, {}, false), { id: ID });
    expect(failed.map((q) => q.id)).toEqual(['status']);
    expect(inspect({ kind: 'resistor', ohms: 1 }, { ...resultFor({}, {}), parts: {} }, { id: ID })[0].id).toBe('status');
  });

  it('default graphs per part type, all ids that exist', () => {
    expect(defaultPlot(BC547)).toEqual(['vce', 'ic']);
    expect(defaultPlot(RED_LED)).toEqual(['vf', 'if']);
    expect(defaultPlot({ kind: 'capacitor', farads: 1e-6 })).toEqual(['v', 'i']);
    expect(defaultPlot(LOGIC_NMOS)).toEqual(['vgs', 'vds', 'id']);
    expect(defaultPlot({ kind: 'board', rails: {}, io: {} })).toEqual([]);
    const ids = new Set(inspect(LOGIC_NMOS, resultFor({ g: 0, d: 0, s: 0 }, {}), { id: ID }).map((q) => q.id));
    for (const id of defaultPlot(LOGIC_NMOS)) expect(ids.has(id)).toBe(true);
  });

  it('quantityValues leaves the text out', () => {
    const v = quantityValues(inspect(BC547, resultFor({ c: 5, b: 0.7, e: 0 }, { pins: { c: 1, b: 0.01, e: -1.01 } }), { id: ID }));
    expect(v.has('region')).toBe(false);
    expect(v.get('vbe')).toBeCloseTo(0.7, 12);
  });
});
