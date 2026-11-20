// The half-bridge gate driver (IR2104-like, model 'halfdriver', sim/driver.ts):
// registration and art, the logic table in DC, input hysteresis in time
// steps, bootstrap behaviour with two IGBTs, convergence, ratings, the
// inspector, save / load, and the 'Half-bridge with IGBTs' example.

import { describe, expect, it } from 'vitest';
import { ART_CELL } from './art/common';
import { EXAMPLES } from './examples';
import { MixedSignal } from './mcu/mixedsignal';
import { BoardRuntimes } from './mcu/runtime';
import { Scene } from './model';
import { PARTS, burnReason, canMirror, getPart, partWarning } from './parts';
import { stringifyProject } from './project/format';
import { Project } from './project/project';
import { readProject } from './project/read';
import {
  D1N4148, GENERIC_IGBT, modelPins, solveCircuit, solveStep, type ComponentModel, type PartResult, type SimInput,
  type SimResult, type Terminal, type TransientState,
} from './sim';
import { DRIVER_UVLO_ON, DRIVER_VIH, DRIVER_VIL } from './sim/driver';
import { inspect } from './sim/inspect';
import { solveSettled } from './sim/solve';
import { boardParts, buildInput, buildNetlist } from './simulation';

const DRV = 9;
const t = (part: number, pin: string): Terminal => ({ part, pin });

/** Driver with ideal-ish sources: VCC, IN, SD against ground, a floating VB-VS supply, 10 k loads on HO and LO. */
function logicCircuit(o: { vcc?: number; vin: number; sd?: number; vbs?: number }): SimInput {
  const bat = (volts: number): ComponentModel => ({ kind: 'battery', volts, rInternal: 0.01 });
  return {
    components: [
      { id: 1, model: bat(o.vcc ?? 12) },
      { id: 2, model: bat(o.vin) },
      { id: 3, model: bat(o.sd ?? 5) },
      { id: 4, model: bat(o.vbs ?? 12) },
      { id: 5, model: { kind: 'resistor', ohms: 10e3 } },
      { id: 6, model: { kind: 'resistor', ohms: 10e3 } },
      { id: 7, model: { kind: 'resistor', ohms: 1e3 } },
      { id: 8, model: { kind: 'ground' } },
      { id: DRV, model: { kind: 'halfdriver' } },
    ],
    links: [
      [t(1, 'pos'), t(DRV, 'vcc')], [t(1, 'neg'), t(8, 'gnd')],
      [t(2, 'pos'), t(DRV, 'in')], [t(2, 'neg'), t(8, 'gnd')],
      [t(3, 'pos'), t(DRV, 'sd')], [t(3, 'neg'), t(8, 'gnd')],
      [t(4, 'pos'), t(DRV, 'vb')], [t(4, 'neg'), t(DRV, 'vs')],
      [t(5, 'a'), t(DRV, 'ho')], [t(5, 'b'), t(DRV, 'vs')],
      [t(6, 'a'), t(DRV, 'lo')], [t(6, 'b'), t(8, 'gnd')],
      [t(7, 'a'), t(DRV, 'vs')], [t(7, 'b'), t(8, 'gnd')],
      [t(DRV, 'com'), t(8, 'gnd')],
    ],
  };
}

const flags = (r: SimResult) => {
  const v = r.parts[DRV].volts!;
  return { ho: v['logic.ho'], lo: v['logic.lo'], in: v['logic.in'], sd: v['logic.sd'], vcc: v['logic.vcc'], vbs: v['logic.vbs'] };
};

/** HO against VS and LO against COM. */
const outs = (r: SimResult) => ({ ho: r.parts[DRV].volts!.ho - r.parts[DRV].volts!.vs, lo: r.parts[DRV].volts!.lo });

describe('half-bridge driver part', () => {
  it('is registered: DIP-8 with the IR2104 pin order on grid points, not mirrorable, own model', () => {
    const type = getPart('halfdriver')!;
    expect(PARTS.filter((p) => p.id === 'halfdriver')).toHaveLength(1);
    expect(type.name).toBe('Half-bridge driver (IR2104-like)');
    expect(type.pins.map((p) => p.id)).toEqual(['vcc', 'in', 'sd', 'com', 'lo', 'vs', 'ho', 'vb']);
    for (const p of type.pins) {
      expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
      expect(p.y === 0 || p.y === type.rows).toBe(true);
      expect(p.x > 0 && p.x < type.cols).toBe(true);
    }
    expect(new Set(type.pins.map((p) => `${p.x},${p.y}`)).size).toBe(8);
    expect(type.pins.find((p) => p.id === 'sd')!.name).toMatch(/low = shutdown/);
    expect(type.svg).toContain(`viewBox="0 0 ${type.cols * ART_CELL} ${type.rows * ART_CELL}"`);
    expect(type.svg).toContain('GATE DRV');
    expect(type.svg).toContain('DRV2104');
    expect(canMirror(type)).toBe(false);
    expect(type.sim!({})).toEqual({ kind: 'halfdriver' });
    expect(modelPins(type.sim!({}))).toEqual(type.pins.map((p) => p.id));
    expect(type.sim!({ burned: true })).toEqual({ kind: 'open' });
    expect(type.variant!({ burned: true })?.key).toBe('burned');
  });

  it('warns above 16 V and burns above 20 V on VCC', () => {
    const type = getPart('halfdriver')!;
    const at = (vcc: number): PartResult => ({ voltage: vcc, current: 0, power: 0, pins: {}, volts: { vcc } });
    expect(partWarning(type, at(15), {})).toBeNull();
    expect(burnReason(type, at(15), {})).toBeNull();
    expect(partWarning(type, at(17), {})).toMatch(/16 V/);
    expect(burnReason(type, at(17), {})).toBeNull();
    expect(burnReason(type, at(20.5), {})).toMatch(/over-voltage/);
    expect(burnReason(type, at(20.5), { burned: true })).toBeNull();
  });

  it('round-trips through save and load', () => {
    const a = new Project();
    a.scene.add({ typeId: 'halfdriver', col: 3, row: 4, rotation: 180 });
    a.scene.add({ typeId: 'halfdriver', col: 20, row: 4, rotation: 90, state: { burned: true, burnedBy: 'supply over-voltage' } });
    const first = a.serialize();
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
  });
});

describe('half-bridge driver logic (DC)', () => {
  it('follows the IR2104 table: IN high -> HO high, IN low -> LO high, SD low or UVLO -> both low', () => {
    const cases: { o: Parameters<typeof logicCircuit>[0]; ho: boolean; lo: boolean }[] = [
      { o: { vin: 5 }, ho: true, lo: false },
      { o: { vin: 3.3 }, ho: true, lo: false }, // 3.3 V logic
      { o: { vin: 0 }, ho: false, lo: true },
      { o: { vin: 0.5 }, ho: false, lo: true },
      { o: { vin: 5, sd: 0 }, ho: false, lo: false }, // shutdown
      { o: { vin: 0, sd: 0 }, ho: false, lo: false },
      { o: { vin: 5, vcc: 6 }, ho: false, lo: false }, // VCC undervoltage
      { o: { vin: 0, vcc: 6 }, ho: false, lo: false },
      { o: { vin: 5, vbs: 6 }, ho: false, lo: false }, // VB-VS undervoltage blocks HO only
      { o: { vin: 0, vbs: 6 }, ho: false, lo: true },
      { o: { vin: 2.0 }, ho: false, lo: true }, // between the thresholds: a DC solve starts low
    ];
    for (const { o, ho, lo } of cases) {
      const r = solveCircuit(logicCircuit(o));
      expect(r.converged, JSON.stringify(o)).toBe(true);
      expect(flags(r).ho, JSON.stringify(o)).toBe(ho ? 1 : 0);
      expect(flags(r).lo, JSON.stringify(o)).toBe(lo ? 1 : 0);
      const v = outs(r);
      const vcc = o.vcc ?? 12;
      const vbs = o.vbs ?? 12;
      // High: the rail through 20 ohm into 10 k; low: the reference through 10 ohm.
      expect(v.ho).toBeCloseTo(ho ? (vbs * 10e3) / 10020 : 0, 2);
      expect(v.lo).toBeCloseTo(lo ? (vcc * 10e3) / 10020 : 0, 2);
    }
  });

  it('reports the flags, the supply currents and the voltages against COM', () => {
    const r = solveCircuit(logicCircuit({ vin: 0, vcc: 6 }));
    expect(flags(r)).toEqual({ ho: 0, lo: 0, in: 0, sd: 1, vcc: 0, vbs: 1 });
    const on = solveCircuit(logicCircuit({ vin: 5 })).parts[DRV];
    expect(on.voltage).toBeCloseTo(12, 2);
    expect(on.volts!.vbs).toBeCloseTo(12, 2);
    // VCC: 12 V over 150 k (quiescent) only; VB: the quiescent 500 k plus HO into 10 k.
    expect(on.pins.vcc).toBeCloseTo(12 / 150e3, 7);
    expect(on.pins.vb).toBeCloseTo(12 / 500e3 + 12 / 10020, 6);
    const sum = Object.values(on.pins).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum)).toBeLessThan(1e-12);
  });

  it('decides against the previous state: between the thresholds a high input stays high', () => {
    const high = { [DRV]: { in: true, sd: true, vcc: true, vbs: true } };
    const r = solveSettled(logicCircuit({ vin: 2.0 }), undefined, 0, undefined, high);
    expect(r.logic[DRV].in).toBe(true);
    expect(flags(r.result).ho).toBe(1);
    const low = solveSettled(logicCircuit({ vin: 0.7 }), undefined, 0, undefined, high);
    expect(low.logic[DRV].in).toBe(false);
  });

  it('shows logic state, outputs, lockouts and supplies in the inspector', () => {
    const model: ComponentModel = { kind: 'halfdriver' };
    const q = (r: SimResult) => new Map(inspect(model, r, { id: DRV, pins: getPart('halfdriver')!.pins }).map((x) => [x.id, x]));
    const run = q(solveCircuit(logicCircuit({ vin: 5 })));
    expect(run.get('in')?.text).toBe('high');
    expect(run.get('ho')?.text).toBe('high');
    expect(run.get('lo')?.text).toBe('low');
    expect(run.get('sd')?.text).toMatch(/running/);
    expect(run.get('uvlo')?.text).toBe('none');
    expect(run.get('vcc')?.value).toBeCloseTo(12, 2);
    expect(run.get('vbs')?.value).toBeCloseTo(12, 2);
    expect(run.get('icc')?.value).toBeCloseTo(12 / 150e3, 7);
    expect(run.get('ivb')?.value).toBeGreaterThan(0);
    expect(run.get('state')?.text).toBe('ok');
    expect(run.get('v:vb')?.group).toBe('pin');
    const locked = q(solveCircuit(logicCircuit({ vin: 5, vcc: 6, vbs: 5, sd: 0 })));
    expect(locked.get('uvlo')?.text).toBe('VCC, VB-VS undervoltage');
    expect(locked.get('sd')?.text).toMatch(/shut down/);
    expect(locked.get('ho')?.text).toBe('low');
  });
});

describe('half-bridge driver in time steps', () => {
  it('has input hysteresis: a slow noisy ramp switches once up (above VIH) and once down (below VIL)', () => {
    let state: TransientState = { time: 0, stored: {} };
    const levels: number[] = [];
    const volts: number[] = [];
    const n = 400;
    for (let k = 0; k < n; k++) {
      // Up from 0 to 5 V and back, with +-0.4 V ripple that would make a plain threshold chatter.
      const ramp = k < n / 2 ? (5 * k) / (n / 2) : 5 - (5 * (k - n / 2)) / (n / 2);
      const vin = Math.max(0, ramp + 0.4 * Math.sin(k * 1.7));
      const out = solveStep(logicCircuit({ vin }), state, 1e-3);
      expect(out.result.converged).toBe(true);
      state = out.state;
      levels.push(flags(out.result).in);
      volts.push(vin);
    }
    const edges = levels.flatMap((l, k) => (k > 0 && l !== levels[k - 1] ? [k] : []));
    expect(edges).toHaveLength(2);
    const [up, down] = edges;
    expect(levels[up]).toBe(1);
    expect(volts[up]).toBeGreaterThan(DRIVER_VIH);
    expect(volts.slice(0, up).every((v) => v <= DRIVER_VIH)).toBe(true);
    expect(volts[down]).toBeLessThan(DRIVER_VIL);
    expect(state.logic?.[DRV]).toEqual({ in: false, sd: true, vcc: true, vbs: true });
  });

  /** Bootstrap half bridge: two N-IGBTs on 12 V, 1N4148 + 10 uF bootstrap, 1 k load from the output to ground. */
  function bridge(vin: number): SimInput {
    return {
      components: [
        { id: 1, model: { kind: 'battery', volts: 12, rInternal: 0.05 } },
        { id: 2, model: { kind: 'battery', volts: vin, rInternal: 25 } },
        { id: 3, model: { kind: 'battery', volts: 5, rInternal: 0.05 } },
        { id: 4, model: D1N4148 },
        { id: 5, model: { kind: 'capacitor', farads: 10e-6, esr: 0.1, polarized: true, ratedVolts: 16 } },
        { id: 6, model: GENERIC_IGBT },
        { id: 7, model: GENERIC_IGBT },
        { id: 8, model: { kind: 'resistor', ohms: 1000 } },
        { id: 10, model: { kind: 'ground' } },
        { id: DRV, model: { kind: 'halfdriver' } },
      ],
      links: [
        [t(1, 'pos'), t(DRV, 'vcc')], [t(1, 'neg'), t(10, 'gnd')], [t(DRV, 'com'), t(10, 'gnd')],
        [t(2, 'pos'), t(DRV, 'in')], [t(2, 'neg'), t(10, 'gnd')],
        [t(3, 'pos'), t(DRV, 'sd')], [t(3, 'neg'), t(10, 'gnd')],
        [t(4, 'anode'), t(1, 'pos')], [t(4, 'cathode'), t(DRV, 'vb')],
        [t(5, 'pos'), t(DRV, 'vb')], [t(5, 'neg'), t(DRV, 'vs')],
        [t(6, 'g'), t(DRV, 'ho')], [t(6, 'c'), t(1, 'pos')], [t(6, 'e'), t(DRV, 'vs')],
        [t(7, 'g'), t(DRV, 'lo')], [t(7, 'c'), t(DRV, 'vs')], [t(7, 'e'), t(10, 'gnd')],
        [t(8, 'a'), t(DRV, 'vs')], [t(8, 'b'), t(10, 'gnd')],
      ],
    };
  }

  function runBridge(): { r: SimResult; state: TransientState }[] {
    let state: TransientState = { time: 0, stored: {} };
    const out: { r: SimResult; state: TransientState }[] = [];
    for (let k = 0; k < 200; k++) {
      const step = solveStep(bridge(k < 50 ? 0 : 5), state, 1e-4);
      state = step.state;
      out.push({ r: step.result, state });
    }
    return out;
  }

  it('charges the bootstrap capacitor while LO conducts, then HO turns the high IGBT on (200 steps, all converged)', () => {
    const run = runBridge();
    expect(run.every((s) => s.r.converged)).toBe(true);
    const low = run[49].r;
    expect(flags(low)).toMatchObject({ lo: 1, ho: 0 });
    expect(low.parts[DRV].volts!.vs).toBeLessThan(0.7); // the low IGBT holds the output down (its knee)
    expect(low.parts[DRV].volts!.vbs).toBeGreaterThan(10.5); // charged through the diode
    expect(low.parts[8].current).toBeLessThan(7e-4);
    const high = run[199].r;
    expect(flags(high)).toMatchObject({ lo: 0, ho: 1, vbs: 1 });
    const d = high.parts[DRV].volts!;
    expect(d.vs).toBeGreaterThan(10.5); // the high IGBT pulls the output up
    expect(d.vb).toBeGreaterThan(12 + 9); // floating above the rail: the diode blocks
    expect(d.ho - d.vs).toBeGreaterThan(9);
    expect(high.parts[8].current).toBeGreaterThan(0.0105);
    expect(high.parts[4].current).toBeLessThan(1e-6);
    // No overlap: no step has both outputs high.
    expect(run.every((s) => !(flags(s.r).ho === 1 && flags(s.r).lo === 1))).toBe(true);
  });

  it('is deterministic', () => {
    const a = runBridge();
    const b = runBridge();
    expect(b.map((s) => s.r)).toEqual(a.map((s) => s.r));
    expect(b.map((s) => s.state)).toEqual(a.map((s) => s.state));
  });

  it('settles deterministically in DC even where no consistent state exists (bootstrap with IN high)', () => {
    // DC: the capacitor is open, HO on lifts VS and collapses VB-VS, which locks HO out again.
    const a = solveCircuit(bridge(5));
    expect(a.converged).toBe(true);
    expect(flags(a).ho).toBe(0); // the safe side: flags that kept flipping end up off
    expect(flags(a).lo).toBe(0);
    expect(solveCircuit(bridge(5))).toEqual(a);
  });

  it('converges in every logic state (DC, with the IGBTs on a fixed bootstrap supply)', () => {
    for (const vin of [0, 5]) {
      for (const sd of [0, 5]) {
        for (const vcc of [5, 12]) {
          const input = bridge(vin);
          input.components = input.components.map((c) => {
            if (c.id === 1) return { id: 1, model: { kind: 'battery', volts: vcc, rInternal: 0.05 } };
            if (c.id === 3) return { id: 3, model: { kind: 'battery', volts: sd, rInternal: 0.05 } };
            if (c.id === 5) return { id: 5, model: { kind: 'battery', volts: 11, rInternal: 0.1 } };
            return c;
          });
          const r = solveCircuit(input);
          expect(r.converged, `in ${vin} sd ${sd} vcc ${vcc}`).toBe(true);
          const on = vcc > DRIVER_UVLO_ON && sd > 0;
          expect(flags(r).ho).toBe(on && vin > 0 ? 1 : 0);
          expect(flags(r).lo).toBe(on && vin === 0 ? 1 : 0);
        }
      }
    }
  });
});

describe('Half-bridge with IGBTs example', () => {
  const example = EXAMPLES.find((e) => e.name === 'Half-bridge with IGBTs')!;

  it('loads and validates, and its hint explains the bootstrap', () => {
    expect(example).toBeDefined();
    const p = new Project();
    p.scene.insert(example.state);
    expect(() => readProject(stringifyProject(p.serialize()))).not.toThrow();
    expect(example.hint).toMatch(/bootstrap/);
    expect(example.hint).toMatch(/low side/);
    const types = p.scene.parts.map((x) => x.typeId);
    for (const id of ['uno', 'halfdriver', 'battery9v', 'diode', 'ecap', 'led']) expect(types).toContain(id);
    expect(types.filter((x) => x === 'igbt')).toHaveLength(2);
  });

  it('is wired as a half bridge (no stray contacts)', () => {
    const scene = new Scene();
    scene.insert(example.state);
    const r = solveCircuit(buildNetlist(scene).input);
    const id = (typeId: string, n = 0) => scene.parts.filter((x) => x.typeId === typeId)[n].id;
    const net = (part: number, pin: string) => r.nets[`${part}:${pin}`];
    const drv = id('halfdriver');
    const [hi, lo] = [id('igbt', 0), id('igbt', 1)];
    expect(net(hi, 'c')).toBe(net(id('battery9v'), 'pos'));
    expect(net(drv, 'vcc')).toBe(net(id('battery9v'), 'pos'));
    expect(net(hi, 'g')).toBe(net(drv, 'ho'));
    expect(net(lo, 'g')).toBe(net(drv, 'lo'));
    expect(new Set([net(hi, 'e'), net(lo, 'c'), net(drv, 'vs'), net(id('ecap'), 'neg')]).size).toBe(1);
    expect(new Set([net(drv, 'vb'), net(id('ecap'), 'pos'), net(id('diode'), 'cathode')]).size).toBe(1);
    expect(net(lo, 'e')).toBe(0);
    expect(net(drv, 'com')).toBe(0);
    expect(net(id('led'), 'cathode')).toBe(0);
    expect(net(drv, 'in')).toBe(net(id('uno'), 'd13'));
    expect(net(drv, 'sd')).toBe(net(id('uno'), '5v'));
    const distinct = [net(drv, 'vb'), net(drv, 'vs'), net(drv, 'ho'), net(drv, 'lo'), net(drv, 'vcc'), net(drv, 'in'), net(drv, 'sd'), 0];
    expect(new Set(distinct).size).toBe(distinct.length);
  });

  async function blink(seconds: number, every: number): Promise<number[]> {
    const scene = new Scene();
    scene.insert(example.state);
    const runtimes = new BoardRuntimes((pid) => buildInput(scene, pid));
    const slots = runtimes.sync(boardParts(scene));
    const ms = new MixedSignal();
    ms.setCircuit(buildNetlist(scene).input, slots);
    await runtimes.runBoard(slots[0].partId);
    ms.setCircuit(buildNetlist(scene).input, slots);
    const led = scene.parts.find((x) => x.typeId === 'led')!.id;
    const out: number[] = [];
    for (let s = every; s <= seconds + 1e-9; s += every) {
      ms.advance(every);
      expect(ms.instant!.converged).toBe(true);
      out.push(ms.instant!.parts[led].current);
    }
    return out;
  }

  it('blinks the LED with Blink: on while pin 13 is high (from the first second), off while low', async () => {
    const i = await blink(4, 0.25);
    // Samples at 0.25 s steps; Blink: high from ~20 ms for 1 s, then low for 1 s, and so on.
    const on = [0, 1, 2, 8, 9, 10];
    const off = [4, 5, 6, 12, 13, 14];
    for (const k of on) {
      expect(i[k], `t = ${(k + 1) * 0.25}`).toBeGreaterThan(0.015);
      expect(i[k]).toBeLessThan(0.025); // 330 ohm keeps it below the LED's warning
    }
    for (const k of off) expect(Math.abs(i[k]), `t = ${(k + 1) * 0.25}`).toBeLessThan(1e-6);
  }, 60000);

  it('is deterministic over simulated seconds', async () => {
    const a = await blink(2.5, 0.1);
    const b = await blink(2.5, 0.1);
    expect(b).toEqual(a);
  }, 60000);
});
