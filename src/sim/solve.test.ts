import { describe, expect, it } from 'vitest';
import { BC547, RED_LED, linkCurrents, solveCircuit } from './index';
import type { ComponentModel, SimInput, Terminal } from './index';

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
const toggle = (closed: boolean): ComponentModel => ({ kind: 'switch', closed });
const ground: ComponentModel = { kind: 'ground' };

function voltageAt(input: SimInput, terminal: string): number {
  const r = solveCircuit(input);
  return r.voltages[r.nets[terminal.replace('.', ':')]];
}

describe('linear circuits', () => {
  it('solves a resistor divider', () => {
    const input = circuit(
      [battery(9), resistor(1000), resistor(2000), ground],
      [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '1.neg'], ['1.neg', '4.gnd']],
    );
    const r = solveCircuit(input);
    expect(r.converged).toBe(true);
    expect(r.reference).toBe('ground');
    expect(voltageAt(input, '2.b')).toBeCloseTo(6, 6);
    expect(r.parts[2].current).toBeCloseTo(0.003, 8);
    expect(r.parts[1].current).toBeCloseTo(0.003, 8); // delivered by the battery
    expect(r.parts[3].power).toBeCloseTo(0.018, 8);
  });

  it('drops voltage over the battery internal resistance', () => {
    const r = solveCircuit(circuit([battery(1.5, 0.5), resistor(1)], [['1.pos', '2.a'], ['2.b', '1.neg']]));
    expect(r.parts[1].current).toBeCloseTo(1, 9);
    expect(r.parts[1].voltage).toBeCloseTo(1, 9);
  });

  it('uses the battery negative as reference when there is no ground', () => {
    const input = circuit([battery(9), resistor(100)], [['1.pos', '2.a'], ['2.b', '1.neg']]);
    const r = solveCircuit(input);
    expect(r.reference).toBe('battery');
    expect(voltageAt(input, '1.neg')).toBe(0);
    expect(voltageAt(input, '1.pos')).toBeCloseTo(9, 6);
  });

  it('carries (almost) nothing through an open switch', () => {
    const wires: [string, string][] = [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '1.neg']];
    const open = solveCircuit(circuit([battery(9), toggle(false), resistor(100)], wires));
    const closed = solveCircuit(circuit([battery(9), toggle(true), resistor(100)], wires));
    expect(Math.abs(open.parts[3].current)).toBeLessThan(1e-6);
    expect(open.parts[2].voltage).toBeCloseTo(9, 4);
    expect(closed.parts[3].current).toBeCloseTo(0.09, 4);
  });

  it('splits a potentiometer at the wiper', () => {
    const pot = (position: number): SimInput =>
      circuit(
        [battery(10), { kind: 'pot', ohms: 10000, position }, ground],
        [['1.pos', '2.a'], ['2.b', '1.neg'], ['1.neg', '3.gnd']],
      );
    expect(voltageAt(pot(0.25), '2.w')).toBeCloseTo(7.5, 6);
    expect(voltageAt(pot(0.5), '2.w')).toBeCloseTo(5, 6);
    expect(voltageAt(pot(1), '2.w')).toBeCloseTo(0.001, 3); // end stop, not a dead short
  });

  it('keeps a shorted battery finite', () => {
    const r = solveCircuit(circuit([battery(1.5, 0.2)], [['1.pos', '1.neg']]));
    expect(r.converged).toBe(true);
    expect(r.parts[1].current).toBeCloseTo(7.5, 6);
    expect(r.parts[1].voltage).toBeCloseTo(0, 9);
  });

  it('reports failure instead of nonsense for an impossible circuit', () => {
    const r = solveCircuit(circuit([battery(1.5, 0)], [['1.pos', '1.neg']]));
    expect(r.converged).toBe(false);
    expect(r.parts[1].current).toBe(0);
  });

  it('does not crash on floating and unconnected parts', () => {
    const input = circuit(
      [battery(9, 1.5), resistor(220), RED_LED, BC547, toggle(false), ground, { kind: 'open' }],
      [['1.pos', '3.anode'], ['2.a', '4.b']], // nothing forms a loop
    );
    const r = solveCircuit(input);
    expect(r.converged).toBe(true);
    for (const v of r.voltages) expect(Number.isFinite(v)).toBe(true);
    for (const p of Object.values(r.parts)) expect(Math.abs(p.current)).toBeLessThan(1e-6);
  });

  it('handles an empty circuit', () => {
    const r = solveCircuit({ components: [], links: [] });
    expect(r).toMatchObject({ converged: true, reference: 'empty', connectedNets: 0, voltages: [] });
  });
});

describe('LED', () => {
  const ledCircuit = (ohms: number): SimInput =>
    circuit(
      [battery(9, 1.5), resistor(ohms), RED_LED, ground],
      [['1.pos', '2.a'], ['2.b', '3.anode'], ['3.cathode', '1.neg'], ['1.neg', '4.gnd']],
    );

  it('matches the hand calculation with a series resistor', () => {
    // (9 V - 2.0 V forward) / (330 + 1.5 ohm) = 21.1 mA
    const r = solveCircuit(ledCircuit(330));
    expect(r.converged).toBe(true);
    const expected = (9 - 2.0) / 331.5;
    expect(Math.abs(r.parts[3].current - expected) / expected).toBeLessThan(0.03);
    expect(r.parts[3].voltage).toBeGreaterThan(1.9);
    expect(r.parts[3].voltage).toBeLessThan(2.1);
    // Kirchhoff: the same current everywhere in the loop.
    expect(r.parts[2].current).toBeCloseTo(r.parts[3].current, 9);
    expect(r.parts[1].current).toBeCloseTo(r.parts[3].current, 9);
  });

  it('glows dimly through a large resistor', () => {
    const i = solveCircuit(ledCircuit(10000)).parts[3].current;
    expect(i).toBeGreaterThan(0.0006);
    expect(i).toBeLessThan(0.0008); // (9 - ~1.8) / 10k
  });

  it('draws a destructive current without a resistor', () => {
    const r = solveCircuit(circuit([battery(9, 1.5), RED_LED], [['1.pos', '2.anode'], ['2.cathode', '1.neg']]));
    expect(r.converged).toBe(true);
    expect(r.parts[2].current).toBeGreaterThan(0.5);
    expect(r.parts[2].current).toBeLessThan(6); // below the battery's short-circuit current
  });

  it('blocks in reverse', () => {
    const r = solveCircuit(
      circuit([battery(9), resistor(330), RED_LED], [['1.pos', '2.a'], ['2.b', '3.cathode'], ['3.anode', '1.neg']]),
    );
    expect(r.converged).toBe(true);
    expect(Math.abs(r.parts[3].current)).toBeLessThan(1e-9);
  });

  it('stays dark on a single 1.5 V cell', () => {
    const r = solveCircuit(circuit([battery(1.5, 0.2), RED_LED], [['1.pos', '2.anode'], ['2.cathode', '1.neg']]));
    expect(r.parts[2].current).toBeLessThan(1e-4);
  });
});

describe('NPN transistor', () => {
  // 9 V -> 330 ohm -> LED -> collector; base through `baseOhms` and a switch to 9 V; emitter grounded.
  const stage = (baseOhms: number, on: boolean): SimInput =>
    circuit(
      [battery(9), resistor(330), RED_LED, BC547, resistor(baseOhms), toggle(on), ground],
      [
        ['1.pos', '2.a'], ['2.b', '3.anode'], ['3.cathode', '4.c'],
        ['1.pos', '6.a'], ['6.b', '5.a'], ['5.b', '4.b'],
        ['4.e', '1.neg'], ['1.neg', '7.gnd'],
      ],
    );

  it('switches a load on (saturated)', () => {
    const r = solveCircuit(stage(10000, true));
    expect(r.converged).toBe(true);
    const q = r.parts[4];
    expect(q.voltage).toBeLessThan(0.2); // Vce(sat)
    expect(q.pins.b).toBeGreaterThan(0.0008); // about (9 - 0.7) / 10k
    expect(q.pins.b).toBeLessThan(0.00086);
    const expected = (9 - 2.0 - 0.1) / 330;
    expect(Math.abs(r.parts[3].current - expected) / expected).toBeLessThan(0.05);
    expect(q.pins.c + q.pins.b + q.pins.e).toBeCloseTo(0, 12);
  });

  it('switches the load off', () => {
    const r = solveCircuit(stage(10000, false));
    expect(r.converged).toBe(true);
    expect(Math.abs(r.parts[3].current)).toBeLessThan(1e-6);
    expect(r.parts[4].voltage).toBeGreaterThan(5);
  });

  it('amplifies the base current by about beta in the active region', () => {
    const r = solveCircuit(stage(2_200_000, true));
    const q = r.parts[4];
    expect(q.voltage).toBeGreaterThan(1); // not saturated
    // Early effect (step 7c): beta = bf (1 + (Vce - Vbe) / VAF), 300 at Vce = 5 V and about 305 here (Vce ~6.8 V).
    const m = BC547 as Extract<ComponentModel, { kind: 'npn' }>;
    const beta = m.bf * (1 + (q.voltage - q.volts!.b) / m.vaf!);
    expect(Math.abs(q.pins.c / q.pins.b - beta) / beta).toBeLessThan(1e-3);
    expect(q.pins.c / q.pins.b).toBeGreaterThan(300);
    expect(q.pins.c / q.pins.b).toBeLessThan(310);
  });
});

describe('determinism and wire currents', () => {
  const input = circuit(
    [battery(9, 1.5), resistor(330), RED_LED, resistor(1000), ground],
    [['1.pos', '2.a'], ['2.b', '3.anode'], ['3.cathode', '1.neg'], ['1.pos', '4.a'], ['4.b', '1.neg'], ['1.neg', '5.gnd']],
  );

  it('gives identical results for identical input', () => {
    expect(solveCircuit(input)).toEqual(solveCircuit(input));
  });

  it('finds the current in every wire of a branching circuit', () => {
    const r = solveCircuit(input);
    const flow = linkCurrents(input, r);
    const led = r.parts[3].current;
    const side = r.parts[4].current;
    expect(flow[0]).toBeCloseTo(led, 9); // battery + -> resistor
    expect(flow[1]).toBeCloseTo(led, 9);
    expect(flow[2]).toBeCloseTo(led, 9); // LED -> battery -
    expect(flow[3]).toBeCloseTo(side, 9);
    expect(flow[4]).toBeCloseTo(side, 9);
    expect(flow[5]).toBeCloseTo(0, 9); // nothing flows into the ground symbol
  });

  it('reports 0 for wires in a loop of wires', () => {
    const loop = circuit(
      [battery(9), resistor(100)],
      [['1.pos', '2.a'], ['1.pos', '2.a'], ['2.b', '1.neg']],
    );
    const flow = linkCurrents(loop, solveCircuit(loop));
    expect(flow[0]).toBe(0);
    expect(flow[1]).toBe(0);
    expect(flow[2]).toBeCloseTo(0.09, 9);
  });
});
