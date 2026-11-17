import { describe, expect, it } from 'vitest';
import { VT } from './devices';
import { BC557, D1N4148, LOGIC_NMOS, POWER_PMOS, solveCircuit } from './index';
import type { ComponentModel, SimInput, SimResult, Terminal } from './index';

// Tiny netlist builder: parts get ids 1, 2, 3... and wires are "id.pin" pairs.
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

const battery = (volts: number, rInternal = 0): ComponentModel => ({ kind: 'battery', volts, rInternal });
const resistor = (ohms: number): ComponentModel => ({ kind: 'resistor', ohms });
const ground: ComponentModel = { kind: 'ground' };

function solved(input: SimInput): SimResult {
  const r = solveCircuit(input);
  expect(r.converged).toBe(true);
  for (const v of r.voltages) expect(Number.isFinite(v)).toBe(true);
  return r;
}

const relErr = (actual: number, expected: number): number => Math.abs(actual - expected) / Math.abs(expected);

describe('1N4148 diode', () => {
  const d = D1N4148 as Extract<ComponentModel, { kind: 'diode' }>;
  // 5 V -> 1 k -> diode -> ground.
  const forward = circuit(
    [battery(5), resistor(1000), D1N4148, ground],
    [['1.pos', '2.a'], ['2.b', '3.anode'], ['3.cathode', '1.neg'], ['1.neg', '4.gnd']],
  );

  it('drops about 0.67 V at a few mA, as the Shockley equation says', () => {
    // Hand solution by fixed-point iteration: I = (5 - Vd) / 1k, Vd = n VT ln(I / Is + 1) + I Rs.
    let i = 0.004;
    for (let k = 0; k < 50; k++) {
      const vd = d.n * VT * Math.log(i / d.is + 1) + i * d.rs;
      i = (5 - vd) / 1000;
    }
    const r = solved(forward);
    const p = r.parts[3];
    expect(p.voltage).toBeGreaterThan(0.6);
    expect(p.voltage).toBeLessThan(0.75);
    expect(relErr(p.current, i)).toBeLessThan(0.001);
    expect(p.current).toBeGreaterThan(0.0042);
    expect(p.current).toBeLessThan(0.0044);
    expect(r.parts[2].current).toBeCloseTo(p.current, 9);
  });

  it('blocks in reverse (only the nA leakage of Is)', () => {
    const r = solved(
      circuit([battery(5), resistor(1000), D1N4148], [['1.pos', '2.a'], ['2.b', '3.cathode'], ['3.anode', '1.neg']]),
    );
    expect(Math.abs(r.parts[3].current)).toBeLessThan(1e-8);
    expect(r.parts[3].voltage).toBeCloseTo(-5, 4);
  });

  it('reports a large current without a resistor instead of failing', () => {
    const r = solved(circuit([battery(9, 1.5), D1N4148], [['1.pos', '2.anode'], ['2.cathode', '1.neg']]));
    expect(r.parts[2].current).toBeGreaterThan(3); // (9 - ~1 V) / (1.5 + 0.57 ohm)
    expect(r.parts[2].current).toBeLessThan(6);
  });
});

describe('PNP transistor (BC557) as a high-side switch', () => {
  // Emitter at +9 V, collector -> 1 k load -> ground, base -> rBase -> ground (on) or +9 V (off).
  const stage = (baseOhms: number, on: boolean): SimInput =>
    circuit(
      [battery(9), BC557, resistor(1000), resistor(baseOhms), ground],
      [
        ['1.pos', '2.e'], ['2.c', '3.a'], ['3.b', '1.neg'],
        ['2.b', '4.a'], ['4.b', on ? '1.neg' : '1.pos'], ['1.neg', '5.gnd'],
      ],
    );

  it('saturates with a 10 k base resistor', () => {
    const r = solved(stage(10_000, true));
    const q = r.parts[2];
    expect(q.voltage).toBeLessThan(0); // Vce of a conducting PNP
    expect(-q.voltage).toBeLessThan(0.2); // Vec(sat)
    // Ib = (9 - ~0.65) / 10k flows out of the base.
    expect(-q.pins.b).toBeGreaterThan(0.00081);
    expect(-q.pins.b).toBeLessThan(0.00086);
    // Load current about (9 - Vec(sat)) / 1k, flowing out of the collector.
    expect(relErr(-q.pins.c, (9 + q.voltage) / 1000)).toBeLessThan(1e-6);
    expect(relErr(r.parts[3].current, 0.00895)).toBeLessThan(0.02);
    expect(q.pins.c + q.pins.b + q.pins.e).toBeCloseTo(0, 12);
  });

  it('amplifies by about beta in the active region', () => {
    // Ib = (9 - ~0.55) / 4.7 M = 1.8 uA, Ic = 250 Ib = 0.45 mA, Vec = 9 - 0.45 V.
    const r = solved(stage(4_700_000, true));
    const q = r.parts[2];
    expect(-q.voltage).toBeGreaterThan(1); // not saturated
    const beta = q.pins.c / q.pins.b;
    expect(beta).toBeGreaterThan(240);
    expect(beta).toBeLessThan(251);
    expect(relErr(-q.pins.c, 0.00045)).toBeLessThan(0.03);
  });

  it('is off with the base at the emitter potential', () => {
    const r = solved(stage(10_000, false));
    expect(Math.abs(r.parts[3].current)).toBeLessThan(1e-6);
    expect(r.parts[2].voltage).toBeLessThan(-8.9); // Vce = 0 - 9
  });
});

describe('N-MOSFET (logic level) as a low-side switch', () => {
  const m = LOGIC_NMOS as Extract<ComponentModel, { kind: 'mosfet' }>;
  // 12 V -> load -> drain; source to ground; gate driven by its own source of `gate` volts.
  const stage = (gate: number | null, loadOhms: number): SimInput =>
    circuit(
      [battery(12), resistor(loadOhms), LOGIC_NMOS, battery(gate ?? 0), ground],
      [
        ['1.pos', '2.a'], ['2.b', '3.d'], ['3.s', '1.neg'], ['1.neg', '5.gnd'],
        ['4.neg', '1.neg'], ...(gate === null ? [] : ([['4.pos', '3.g']] as [string, string][])),
      ],
    );

  it('switches a 10 ohm load fully on with a 5 V gate', () => {
    const r = solved(stage(5, 10));
    const q = r.parts[3];
    // Triode: Rds = 1 / (kp (Vgs - Vth)) = 1 / (13 * 3) = 25.6 mOhm, so Vds = about 1.2 A * 25.6 mOhm.
    expect(q.voltage).toBeGreaterThan(0.029);
    expect(q.voltage).toBeLessThan(0.033);
    expect(relErr(q.current, (12 - q.voltage) / 10)).toBeLessThan(1e-6);
    expect(r.parts[2].current).toBeCloseTo(q.current, 9);
    expect(Math.abs(q.pins.g)).toBeLessThan(1e-8); // no DC gate current
    expect(q.volts?.g).toBeCloseTo(5, 9);
    expect(q.pins.d + q.pins.g + q.pins.s).toBeCloseTo(0, 12);
  });

  it('is off with the gate at 0 V', () => {
    const r = solved(stage(0, 10));
    expect(Math.abs(r.parts[3].current)).toBeLessThan(1e-6);
    expect(r.parts[3].voltage).toBeCloseTo(12, 4);
  });

  it('limits the current in saturation by the square law', () => {
    // Vgs = 2.5 V: Id = kp / 2 (0.5)^2 (1 + lambda Vds) with Vds = 12 - 2 Id
    // -> Id = 1.625 (1.24 - 0.04 Id) = 1.892 A, Vds = 8.22 V (saturated: Vds > Vgs - Vth).
    const r = solved(stage(2.5, 2));
    const q = r.parts[3];
    expect(q.voltage).toBeGreaterThan(0.5);
    const squareLaw = 0.5 * m.kp * (2.5 - m.vth) ** 2 * (1 + m.lambda * q.voltage);
    expect(relErr(q.current, squareLaw)).toBeLessThan(1e-6);
    expect(relErr(q.current, 1.892)).toBeLessThan(0.01);
    expect(relErr(q.voltage, 8.216)).toBeLessThan(0.01);
  });

  it('stays off with a floating gate', () => {
    const r = solved(stage(null, 10));
    expect(Math.abs(r.parts[3].current)).toBeLessThan(1e-6);
  });

  it('conducts backwards (source and drain swap) without failing', () => {
    // Load into the source, drain grounded, gate 5 V above ground: the channel conducts from s to d.
    const r = solved(
      circuit(
        [battery(1), resistor(10), LOGIC_NMOS, battery(5), ground],
        [['1.pos', '2.a'], ['2.b', '3.s'], ['3.d', '1.neg'], ['4.pos', '3.g'], ['4.neg', '1.neg'], ['1.neg', '5.gnd']],
      ),
    );
    expect(r.parts[3].current).toBeLessThan(0); // out of the drain
    expect(relErr(-r.parts[3].current, 0.1)).toBeLessThan(0.02); // about 1 V / 10 ohm
  });
});

describe('P-MOSFET as a high-side switch', () => {
  // Source at +9 V, drain -> 100 ohm -> ground, gate tied to ground (on), +9 V (off) or floating.
  const stage = (gate: 'gnd' | 'supply' | 'floating'): SimInput =>
    circuit(
      [battery(9), POWER_PMOS, resistor(100), ground],
      [
        ['1.pos', '2.s'], ['2.d', '3.a'], ['3.b', '1.neg'], ['1.neg', '4.gnd'],
        ...(gate === 'floating' ? [] : ([['2.g', gate === 'gnd' ? '1.neg' : '1.pos']] as [string, string][])),
      ],
    );

  it('switches the load on with the gate pulled to ground', () => {
    // Vgs = -9 V: Rds = 1 / (1.2 * 6) = 139 mOhm, load current 9 / 100.14 = 89.9 mA.
    const r = solved(stage('gnd'));
    const q = r.parts[2];
    expect(q.volts?.g).toBeCloseTo(-9, 6);
    expect(q.voltage).toBeLessThan(0);
    expect(q.voltage).toBeGreaterThan(-0.02);
    expect(relErr(-q.current, 0.0899)).toBeLessThan(0.01);
    expect(r.parts[3].current).toBeCloseTo(-q.current, 9);
  });

  it('is off with the gate at the source potential', () => {
    const r = solved(stage('supply'));
    expect(Math.abs(r.parts[2].current)).toBeLessThan(1e-6);
  });

  it('stays off with a floating gate', () => {
    const r = solved(stage('floating'));
    expect(Math.abs(r.parts[2].current)).toBeLessThan(1e-6);
  });
});

describe('robustness', () => {
  it('converges with all new parts unconnected or half connected', () => {
    const r = solved(
      circuit(
        [battery(9, 1.5), BC557, D1N4148, LOGIC_NMOS, POWER_PMOS, resistor(1000), ground],
        [['1.pos', '2.e'], ['4.d', '1.pos'], ['5.s', '1.pos'], ['6.a', '4.g'], ['1.neg', '7.gnd']],
      ),
    );
    for (const p of Object.values(r.parts)) expect(Math.abs(p.current)).toBeLessThan(1e-6);
  });

  it('converges in a two-stage switch: an N-FET driving a P-FET high-side switch', () => {
    // 5 V gate on the N-FET pulls the P-FET gate (10 k pull-up to 12 V) low: the 12 ohm load gets about 1 A.
    const r = solved(
      circuit(
        [battery(12), LOGIC_NMOS, resistor(10_000), POWER_PMOS, resistor(12), battery(5), ground],
        [
          ['1.pos', '3.a'], ['3.b', '2.d'], ['2.s', '1.neg'], ['6.pos', '2.g'], ['6.neg', '1.neg'],
          ['1.pos', '4.s'], ['3.b', '4.g'], ['4.d', '5.a'], ['5.b', '1.neg'], ['1.neg', '7.gnd'],
        ],
      ),
    );
    // P-FET: Vgs about -12 V, Rds = 1 / (1.2 * 9) = 93 mOhm.
    expect(relErr(r.parts[5].current, 12 / 12.093)).toBeLessThan(0.01);
  });
});
