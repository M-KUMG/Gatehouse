// Ideal logic gates (model 'gate', sim/gates.ts; parts in gateparts.ts):
// registration and art, truth tables in DC, thresholds and hysteresis,
// floating inputs, chains and feedback loops (SR latch, inverter ring),
// ratings, the inspector, save / load and both examples.

import { describe, expect, it } from 'vitest';
import { ART_CELL } from './art/common';
import { EXAMPLES } from './examples';
import { isReactive } from './mcu/timestep';
import { Scene } from './model';
import { PARTS, burnReason, canMirror, getPart, partWarning } from './parts';
import { stringifyProject } from './project/format';
import { Project } from './project/project';
import { readProject } from './project/read';
import {
  modelPins, solveCircuit, solveStep, type ComponentModel, type PartResult, type SimInput, type SimResult, type Terminal,
  type TransientState,
} from './sim';
import {
  GATE_FNS, GATE_OUT_OHMS, GATE_VCC_CHOICES, GATE_VIH_FRACTION, GATE_VIL_FRACTION, gateInputs, gateOutput, type GateFn,
} from './sim/gates';
import { inspect } from './sim/inspect';
import { buildNetlist } from './simulation';

const t = (part: number, pin: string): Terminal => ({ part, pin });
const bat = (volts: number): ComponentModel => ({ kind: 'battery', volts, rInternal: 0.01 });
const gate = (fn: GateFn, vcc = 5): ComponentModel => ({ kind: 'gate', fn, inputs: gateInputs(fn), vcc });
const G = 10;
const LOAD = 10e3;

/** One gate, inputs from ideal-ish sources (undefined = left unconnected), 10 k load from Y to ground. */
function single(fn: GateFn, vcc: number, va: number | undefined, vb?: number): SimInput {
  const components = [
    { id: 1, model: { kind: 'ground' } as ComponentModel },
    { id: 4, model: { kind: 'resistor', ohms: LOAD } as ComponentModel },
    { id: G, model: gate(fn, vcc) },
  ];
  const links: [Terminal, Terminal][] = [[t(4, 'a'), t(G, 'y')], [t(4, 'b'), t(1, 'gnd')]];
  if (va !== undefined) {
    components.push({ id: 2, model: bat(va) });
    links.push([t(2, 'pos'), t(G, 'a')], [t(2, 'neg'), t(1, 'gnd')]);
  }
  if (vb !== undefined && gateInputs(fn) === 2) {
    components.push({ id: 3, model: bat(vb) });
    links.push([t(3, 'pos'), t(G, 'b')], [t(3, 'neg'), t(1, 'gnd')]);
  }
  return { components, links };
}

const logicY = (r: SimResult, id = G): number => r.parts[id].volts!['logic.y'];

describe('logic gate parts', () => {
  it('registers the eight gates with A (B) on the left and Y on the right, on grid points', () => {
    const ids = GATE_FNS.map((fn) => `gate-${fn}`);
    expect(ids).toEqual(['gate-not', 'gate-buf', 'gate-and', 'gate-nand', 'gate-or', 'gate-nor', 'gate-xor', 'gate-xnor']);
    const names = ['NOT gate', 'BUFFER gate', 'AND gate', 'NAND gate', 'OR gate', 'NOR gate', 'XOR gate', 'XNOR gate'];
    ids.forEach((id, k) => {
      const type = getPart(id)!;
      expect(PARTS.filter((p) => p.id === id)).toHaveLength(1);
      expect(type.name).toBe(names[k]);
      const two = gateInputs(GATE_FNS[k]) === 2;
      expect(type.pins.map((p) => p.id)).toEqual(two ? ['a', 'b', 'y'] : ['a', 'y']);
      const at = Object.fromEntries(type.pins.map((p) => [p.id, [p.x, p.y]]));
      expect([type.cols, type.rows]).toEqual([4, 4]);
      expect(at.y).toEqual([4, 2]);
      if (two) expect([at.a, at.b]).toEqual([[0, 1], [0, 3]]);
      else expect(at.a).toEqual([0, 2]);
      expect(canMirror(type)).toBe(two);
      expect(type.defaults).toEqual({ vcc: 5 });
      expect(type.value).toMatchObject({ key: 'vcc', unit: 'V', options: GATE_VCC_CHOICES });
      const model = type.sim!(type.defaults!);
      expect(model).toEqual({ kind: 'gate', fn: GATE_FNS[k], inputs: two ? 2 : 1, vcc: 5 });
      expect(modelPins(model)).toEqual(type.pins.map((p) => p.id));
      expect(type.sim!({ vcc: 3.3 })).toMatchObject({ vcc: 3.3 });
      expect(type.sim!({ vcc: 4 })).toMatchObject({ vcc: 5 }); // not a choice: the default
      expect(type.sim!({ burned: true })).toEqual({ kind: 'open' });
      expect(type.svg).toContain(`viewBox="0 0 ${type.cols * ART_CELL} ${type.rows * ART_CELL}"`);
      expect(type.svg).toContain('>5V<');
      expect(type.variant!({ vcc: 5 })).toBeNull();
      expect(type.variant!({ vcc: 12 })?.svg).toContain('>12V<');
      expect(type.variant!({ burned: true })?.key).toMatch(/^burned/);
    });
  });

  it('keeps the inversion bubble on NOT, NAND, NOR and XNOR only', () => {
    for (const fn of GATE_FNS) {
      const bubble = getPart(`gate-${fn}`)!.svg.includes('<circle cx="5');
      expect(bubble, fn).toBe(['not', 'nand', 'nor', 'xnor'].includes(fn));
    }
  });
});

describe('logic gates in DC', () => {
  it('follow their truth tables at 3.3, 5 and 12 V (outputs within 2 %)', () => {
    for (const vcc of [3.3, 5, 12]) {
      for (const fn of GATE_FNS) {
        const two = gateInputs(fn) === 2;
        for (const a of [false, true]) {
          for (const b of two ? [false, true] : [false]) {
            const r = solveCircuit(single(fn, vcc, a ? vcc : 0, b ? vcc : 0));
            const what = `${fn} ${vcc} V a=${a} b=${b}`;
            expect(r.converged, what).toBe(true);
            const high = gateOutput(fn, { a, b });
            expect(logicY(r), what).toBe(high ? 1 : 0);
            const vy = r.parts[G].volts!.y;
            expect(Math.abs(vy - (high ? vcc : 0)), what).toBeLessThan(0.02 * vcc);
            expect(vy).toBeCloseTo(high ? (vcc * LOAD) / (LOAD + GATE_OUT_OHMS) : 0, 6);
          }
        }
      }
    }
  });

  it('reads a floating input as low (10 Mohm pull-down) and draws about 1 uA per input', () => {
    expect(logicY(solveCircuit(single('not', 5, undefined)))).toBe(1);
    expect(logicY(solveCircuit(single('buf', 5, undefined)))).toBe(0);
    expect(logicY(solveCircuit(single('or', 5, 5)))).toBe(1); // b floating
    expect(logicY(solveCircuit(single('and', 5, 5)))).toBe(0);
    expect(logicY(solveCircuit(single('nand', 5, 5)))).toBe(1);
    const r = solveCircuit(single('and', 12, 10, 10));
    expect(r.parts[G].pins.a).toBeCloseTo(1e-6, 8);
    expect(r.parts[G].volts!.vcc).toBe(12);
  });

  it('switches at 0.7 vcc going up and 0.3 vcc going down; a DC solve starts low', () => {
    for (const vcc of [1.8, 5, 12]) {
      expect(logicY(solveCircuit(single('buf', vcc, 0.69 * vcc)))).toBe(0);
      expect(logicY(solveCircuit(single('buf', vcc, 0.71 * vcc)))).toBe(1);
      expect(logicY(solveCircuit(single('buf', vcc, 0.5 * vcc)))).toBe(0); // between: the low start state
    }
  });

  it('settles a 3-gate chain in one call, whatever the component order', () => {
    // a -> NOT (id 30) -> NOT (id 20) -> AND with a (id 10): y = a AND a = a.
    const chain = (va: number): SimInput => ({
      components: [
        { id: 1, model: { kind: 'ground' } }, { id: 2, model: bat(va) },
        { id: 10, model: gate('and') }, { id: 20, model: gate('not') }, { id: 30, model: gate('not') },
        { id: 4, model: { kind: 'resistor', ohms: LOAD } },
      ],
      links: [
        [t(2, 'neg'), t(1, 'gnd')], [t(2, 'pos'), t(30, 'a')], [t(30, 'y'), t(20, 'a')], [t(20, 'y'), t(10, 'a')],
        [t(2, 'pos'), t(10, 'b')], [t(10, 'y'), t(4, 'a')], [t(4, 'b'), t(1, 'gnd')],
      ],
    });
    for (const va of [0, 5]) {
      const r = solveCircuit(chain(va));
      expect(r.converged).toBe(true);
      expect(logicY(r, 30)).toBe(va ? 0 : 1);
      expect(logicY(r, 20)).toBe(va ? 1 : 0);
      expect(logicY(r, 10)).toBe(va ? 1 : 0);
      expect(r.parts[10].volts!.y).toBeCloseTo(va ? (5 * LOAD) / (LOAD + GATE_OUT_OHMS) : 0, 6);
    }
  });

  it('warns above 40 mA output current, burns above 100 mA, warns (never burns) on input voltage', () => {
    const type = getPart('gate-and')!;
    const at = (current: number, va = 0): PartResult => ({ voltage: 0, current, power: 0, pins: {}, volts: { a: va, b: 0, y: 0 } });
    expect(partWarning(type, at(0.039), { vcc: 5 })).toBeNull();
    expect(partWarning(type, at(-0.041), { vcc: 5 })).toMatch(/Too much current/);
    expect(burnReason(type, at(0.099), { vcc: 5 })).toBeNull();
    expect(burnReason(type, at(-0.101), { vcc: 5 })).toBe('too much current');
    expect(partWarning(type, at(0, 5.4), { vcc: 5 })).toBeNull();
    expect(partWarning(type, at(0, 5.6), { vcc: 5 })).toMatch(/above the supply level/);
    expect(partWarning(type, at(0, 5.6), { vcc: 9 })).toBeNull();
    expect(partWarning(type, at(0, -0.6), { vcc: 5 })).toMatch(/below -0.5 V/);
    expect(burnReason(type, at(0, 20), { vcc: 5 })).toBeNull();
    // A real short: Y high straight into 10 ohm to ground, 5 V / 35 ohm = 143 mA.
    const input = single('buf', 5, 5);
    input.components = input.components.map((c) => (c.id === 4 ? { id: 4, model: { kind: 'resistor', ohms: 10 } } : c));
    const r = solveCircuit(input).parts[G];
    expect(r.current).toBeCloseTo(5 / 35, 4);
    expect(burnReason(getPart('gate-buf')!, r, { vcc: 5 })).toBe('too much current');
  });

  it('shows levels, volts, output current and supply level in the inspector', () => {
    const model = gate('xor', 5);
    const r = solveCircuit(single('xor', 5, 5, 0));
    const q = new Map(inspect(model, r, { id: G, pins: getPart('gate-xor')!.pins }).map((x) => [x.id, x]));
    expect(q.get('a')?.text).toBe('high');
    expect(q.get('b')?.text).toBe('low');
    expect(q.get('y')?.text).toBe('high');
    expect(q.get('region')?.text).toBe('high');
    expect(q.get('va')?.value).toBeCloseTo(5, 2);
    expect(q.get('vb')?.value).toBeCloseTo(0, 6);
    expect(q.get('vy')?.value).toBeCloseTo((5 * LOAD) / (LOAD + GATE_OUT_OHMS), 6);
    expect(q.get('iy')?.value).toBeCloseTo(5 / (LOAD + GATE_OUT_OHMS), 7);
    expect(q.get('vcc')?.value).toBe(5);
    expect(q.get('state')?.text).toBe('ok');
    expect(q.get('v:y')?.group).toBe('pin');
    const readout = getPart('gate-xor')!.readout!(r.parts[G]);
    expect(readout[0]).toBe('A high · B low → Y high');
  });

  it('makes a circuit with a gate time-stepped', () => {
    expect(isReactive(single('not', 5, 0))).toBe(true);
  });
});

describe('logic gates in time steps', () => {
  it('have input hysteresis: a slow noisy ramp switches once up and once down', () => {
    const vcc = 5;
    let state: TransientState = { time: 0, stored: {} };
    const levels: number[] = [];
    const volts: number[] = [];
    const n = 400;
    for (let k = 0; k < n; k++) {
      const ramp = k < n / 2 ? (vcc * k) / (n / 2) : vcc - (vcc * (k - n / 2)) / (n / 2);
      const vin = Math.max(0, ramp + 0.4 * Math.sin(k * 1.7));
      const out = solveStep(single('buf', vcc, vin), state, 1e-3);
      expect(out.result.converged).toBe(true);
      state = out.state;
      levels.push(logicY(out.result));
      volts.push(vin);
    }
    const edges = levels.flatMap((l, k) => (k > 0 && l !== levels[k - 1] ? [k] : []));
    expect(edges).toHaveLength(2);
    const [up, down] = edges;
    expect(volts[up]).toBeGreaterThan(GATE_VIH_FRACTION * vcc);
    expect(volts.slice(0, up).every((v) => v <= GATE_VIH_FRACTION * vcc)).toBe(true);
    expect(volts[down]).toBeLessThan(GATE_VIL_FRACTION * vcc);
    expect(state.logic?.[G]).toEqual({ a: false, b: false });
  });

  /** NOR latch: Qbar = NOR(S, Q) (id 5), Q = NOR(R, Qbar) (id 6); S, R switches from 5 V; 10 k loads. */
  function latch(s: boolean, r: boolean): SimInput {
    return {
      components: [
        { id: 1, model: { kind: 'ground' } }, { id: 2, model: bat(5) },
        { id: 3, model: { kind: 'switch', closed: s } }, { id: 4, model: { kind: 'switch', closed: r } },
        { id: 5, model: gate('nor') }, { id: 6, model: gate('nor') },
        { id: 7, model: { kind: 'resistor', ohms: LOAD } }, { id: 8, model: { kind: 'resistor', ohms: LOAD } },
      ],
      links: [
        [t(2, 'neg'), t(1, 'gnd')], [t(2, 'pos'), t(3, 'a')], [t(2, 'pos'), t(4, 'a')],
        [t(3, 'b'), t(5, 'a')], [t(4, 'b'), t(6, 'a')],
        [t(6, 'y'), t(5, 'b')], [t(5, 'y'), t(6, 'b')],
        [t(5, 'y'), t(7, 'a')], [t(6, 'y'), t(8, 'a')], [t(7, 'b'), t(1, 'gnd')], [t(8, 'b'), t(1, 'gnd')],
      ],
    };
  }
  const q = (r: SimResult): [number, number] => [logicY(r, 6), logicY(r, 5)]; // Q, Qbar

  it('SR latch: settles deterministically in DC (reset) and is set by S, reset by R in DC', () => {
    const a = solveCircuit(latch(false, false));
    expect(a.converged).toBe(true);
    expect(q(a)).toEqual([0, 1]);
    expect(solveCircuit(latch(false, false))).toEqual(a);
    expect(q(solveCircuit(latch(true, false)))).toEqual([1, 0]);
    expect(q(solveCircuit(latch(false, true)))).toEqual([0, 1]);
    expect(a.iterations).toBeLessThan(100);
  });

  function runLatch(): { r: SimResult; state: TransientState }[] {
    // Steps: 10 idle, 10 S held, 10 idle, 10 R held, 10 idle, 10 S held, 10 idle.
    const plan = ['', 's', '', 'r', '', 's', ''];
    let state: TransientState = { time: 0, stored: {} };
    const out: { r: SimResult; state: TransientState }[] = [];
    for (const p of plan) {
      for (let k = 0; k < 10; k++) {
        const step = solveStep(latch(p === 's', p === 'r'), state, 1e-3);
        state = step.state;
        out.push({ r: step.result, state });
      }
    }
    return out;
  }

  it('SR latch: holds its state across steps between set and reset events', () => {
    const run = runLatch();
    expect(run.every((s) => s.r.converged)).toBe(true);
    const expected = [[0, 1], [1, 0], [1, 0], [0, 1], [0, 1], [1, 0], [1, 0]];
    expected.forEach((e, block) => {
      for (let k = 0; k < 10; k++) expect(q(run[block * 10 + k].r), `step ${block * 10 + k}`).toEqual(e);
    });
    // Q and Qbar outputs stay complementary in volts too.
    const last = run[run.length - 1].r;
    expect(last.parts[6].volts!.y).toBeGreaterThan(4.9);
    expect(last.parts[5].volts!.y).toBeLessThan(0.01);
    const again = runLatch();
    expect(again.map((s) => s.r)).toEqual(run.map((s) => s.r));
  });

  function ring(): SimInput {
    return {
      components: [{ id: 1, model: { kind: 'ground' } }, { id: G, model: gate('not') }, { id: 4, model: { kind: 'resistor', ohms: LOAD } }],
      links: [[t(G, 'y'), t(G, 'a')], [t(G, 'y'), t(4, 'a')], [t(4, 'b'), t(1, 'gnd')]],
    };
  }

  it('an inverter feeding itself: bounded rounds, deterministic, flips once per time step', () => {
    const dc = solveCircuit(ring());
    expect(dc.converged).toBe(true);
    expect(solveCircuit(ring())).toEqual(dc);
    // At most MAX_LOGIC_ROUNDS + 1 per gate rounds plus the fallback solve, each a single linear solve here.
    expect(dc.iterations).toBeLessThanOrEqual(12);
    const run = (): number[] => {
      let state: TransientState = { time: 0, stored: {} };
      const ys: number[] = [];
      for (let k = 0; k < 12; k++) {
        const step = solveStep(ring(), state, 1e-6);
        expect(step.result.converged).toBe(true);
        expect(step.result.iterations).toBeLessThanOrEqual(12);
        state = step.state;
        ys.push(logicY(step.result));
      }
      return ys;
    };
    const ys = run();
    for (let k = 1; k < ys.length; k++) expect(ys[k]).toBe(1 - ys[k - 1]);
    expect(run()).toEqual(ys);
  });
});

describe('logic gates in projects', () => {
  it('round-trip the supply level through save and load', () => {
    const a = new Project();
    a.scene.add({ typeId: 'gate-nand', col: 0, row: 0, rotation: 0, state: { vcc: 3.3 } });
    a.scene.add({ typeId: 'gate-not', col: 8, row: 0, rotation: 90 });
    a.scene.add({ typeId: 'gate-xor', col: 16, row: 0, rotation: 180, mirrorY: true, state: { vcc: 12, burned: true, burnedBy: 'too much current' } });
    const first = a.serialize();
    expect(first.parts[1].state).toEqual({ vcc: 5 }); // the default is stored
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
    expect(b.scene.parts[2].mirrorY).toBe(true);
  });

  it('rejects a supply level that is not a choice, and vcc on other parts', () => {
    const doc = (typeId: string, state: object) => {
      const p = new Project();
      p.scene.add({ typeId, col: 0, row: 0, rotation: 0 });
      const file = p.serialize();
      return JSON.stringify({ ...file, parts: [{ ...file.parts[0], state }] });
    };
    expect(() => readProject(doc('gate-and', { vcc: 4 }))).toThrow(/vcc must be one of 1.8, 3.3, 5, 9, 12/);
    expect(() => readProject(doc('gate-and', { vcc: '5' }))).toThrow(/vcc must be a number/);
    expect(() => readProject(doc('resistor', { vcc: 5 }))).toThrow(/only allowed on logic gates/);
    for (const v of GATE_VCC_CHOICES) expect(() => readProject(doc('gate-and', { vcc: v }))).not.toThrow();
  });
});

describe('logic gate examples', () => {
  const load = (name: string): Scene => {
    const example = EXAMPLES.find((e) => e.name === name);
    expect(example, name).toBeDefined();
    const p = new Project();
    p.scene.insert(example!.state);
    expect(() => readProject(stringifyProject(p.serialize()))).not.toThrow();
    const scene = new Scene();
    scene.insert(example!.state);
    return scene;
  };
  const ids = (scene: Scene, typeId: string): number[] => scene.parts.filter((x) => x.typeId === typeId).map((x) => x.id);
  const press = (scene: Scene, id: number, closed: boolean): void => {
    scene.parts.find((x) => x.id === id)!.state = { closed };
  };

  it('Logic gates: the AND LED and the XOR LED light per the truth table', () => {
    const scene = load('Logic gates');
    const [sa, sb] = ids(scene, 'switch');
    const [ledAnd, ledXor] = ids(scene, 'led');
    const [and] = ids(scene, 'gate-and');
    const [xor] = ids(scene, 'gate-xor');
    for (const a of [false, true]) {
      for (const b of [false, true]) {
        press(scene, sa, a);
        press(scene, sb, b);
        const { input } = buildNetlist(scene);
        const r = solveCircuit(input);
        expect(r.converged).toBe(true);
        expect(r.nets[`${and}:a`]).toBe(r.nets[`${xor}:a`]);
        expect(r.nets[`${and}:b`]).toBe(r.nets[`${xor}:b`]);
        const lit = (id: number): boolean => r.parts[id].current > 0.005;
        expect(lit(ledAnd), `AND ${a} ${b}`).toBe(a && b);
        expect(lit(ledXor), `XOR ${a} ${b}`).toBe(a !== b);
        for (const id of [ledAnd, ledXor]) {
          expect(r.parts[id].current).toBeLessThan(0.03); // below the LED's warning
          expect(r.parts[id].current).toBeGreaterThan(-1e-9);
        }
        for (const g of [and, xor]) {
          expect(partWarning(getPart(scene.parts.find((x) => x.id === g)!.typeId)!, r.parts[g], { vcc: 9 })).toBeNull();
        }
      }
    }
  });

  it('SR latch from NOR gates: starts reset, S sets, R resets, the state holds after release', () => {
    const scene = load('SR latch from NOR gates');
    const [s, rBtn] = ids(scene, 'button');
    const [ledQ, ledNotQ] = (() => {
      const leds = ids(scene, 'led');
      return [leds[0], leds[1]]; // part 8 (on Q), part 11 (on Qbar)
    })();
    let state: TransientState = { time: 0, stored: {} };
    const step = (): SimResult => {
      const out = solveStep(buildNetlist(scene).input, state, 1e-3);
      state = out.state;
      expect(out.result.converged).toBe(true);
      return out.result;
    };
    const lit = (r: SimResult, id: number): boolean => r.parts[id].current > 0.005;
    let r = step();
    expect([lit(r, ledQ), lit(r, ledNotQ)]).toEqual([false, true]);
    press(scene, s, true);
    r = step();
    expect([lit(r, ledQ), lit(r, ledNotQ)]).toEqual([true, false]);
    press(scene, s, false);
    for (let k = 0; k < 5; k++) r = step();
    expect([lit(r, ledQ), lit(r, ledNotQ)]).toEqual([true, false]);
    press(scene, rBtn, true);
    r = step();
    expect([lit(r, ledQ), lit(r, ledNotQ)]).toEqual([false, true]);
    press(scene, rBtn, false);
    for (let k = 0; k < 5; k++) r = step();
    expect([lit(r, ledQ), lit(r, ledNotQ)]).toEqual([false, true]);
  });
});
