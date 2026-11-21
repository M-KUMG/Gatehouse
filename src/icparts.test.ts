// The 555 timer and the dual op-amp as parts (icparts.ts) and the "Integrated
// circuits" menu section: registration, pins on grid points in the package's
// pin order, art, ratings through the part, burning, save / load, and the
// two examples (the 555 blinker blinks at the textbook rate, the op-amp night
// light lights its LED when the photoresistor is dark).

import { describe, expect, it } from 'vitest';
import { ART_CELL } from './art/common';
import { clickPart } from './controls';
import { opampReadout, timerReadout } from './devicereadouts';
import { EXAMPLES } from './examples';
import { isReactive } from './mcu/timestep';
import { Scene } from './model';
import { groupParts } from './partcategories';
import { PARTS, burnReason, canMirror, getPart, partWarning } from './parts';
import { stringifyProject } from './project/format';
import { Project } from './project/project';
import { readProject } from './project/read';
import { initialState, modelPins, solveCircuit, solveStep, type PartResult, type TransientState } from './sim';
import { inspect } from './sim/inspect';
import { Simulation, buildNetlist } from './simulation';

const result = (extra: Partial<PartResult>): PartResult => ({ voltage: 0, current: 0, power: 0, pins: {}, ...extra });

describe('IC parts: registration', () => {
  it('555: pins 1-8 in the package order on grid points, bottom row 1-4 left to right, top row 5-8 right to left', () => {
    const t = getPart('timer555')!;
    expect(PARTS.filter((p) => p.id === 'timer555')).toHaveLength(1);
    expect(t.name).toBe('555 timer (NE555)');
    expect(t.pins.map((p) => p.id)).toEqual(['gnd', 'trig', 'out', 'reset', 'ctrl', 'thr', 'disch', 'vcc']);
    const at = Object.fromEntries(t.pins.map((p) => [p.id, [p.x, p.y]]));
    expect([at.gnd, at.trig, at.out, at.reset]).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
    expect([at.ctrl, at.thr, at.disch, at.vcc]).toEqual([[4, 0], [3, 0], [2, 0], [1, 0]]);
    expect([t.cols, t.rows]).toEqual([5, 4]);
    expect(t.svg).toContain('NE555');
    expect(modelPins(t.sim!({}))).toEqual(t.pins.map((p) => p.id));
  });

  it('op-amp: pins 1-8 of the LM358 order on grid points', () => {
    const t = getPart('opamp')!;
    expect(PARTS.filter((p) => p.id === 'opamp')).toHaveLength(1);
    expect(t.pins.map((p) => p.id)).toEqual(['o1', 'n1', 'p1', 'gnd', 'p2', 'n2', 'o2', 'vcc']);
    const at = Object.fromEntries(t.pins.map((p) => [p.id, [p.x, p.y]]));
    expect([at.o1, at.n1, at.p1, at.gnd]).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
    expect([at.p2, at.n2, at.o2, at.vcc]).toEqual([[4, 0], [3, 0], [2, 0], [1, 0]]);
    expect(t.svg).toContain('LM358');
    expect(modelPins(t.sim!({}))).toEqual(['o1', 'n1', 'p1', 'gnd', 'p2', 'n2', 'o2', 'vcc']);
  });

  it('are DIP chips: the art fits the box, no pin repeats, not mirrorable, a burned one is open and drawn burned', () => {
    for (const id of ['timer555', 'opamp']) {
      const t = getPart(id)!;
      expect(new Set(t.pins.map((p) => `${p.x},${p.y}`)).size, id).toBe(8);
      for (const p of t.pins) {
        expect(Number.isInteger(p.x) && Number.isInteger(p.y), `${id}.${p.id}`).toBe(true);
        expect(p.name.length).toBeGreaterThan(0);
      }
      expect(t.svg).toContain(`viewBox="0 0 ${t.cols * ART_CELL} ${t.rows * ART_CELL}"`);
      expect(canMirror(t), id).toBe(false);
      expect(t.sim!({ burned: true })).toEqual({ kind: 'open' });
      expect(t.variant!({ burned: true })?.key).toBe('burned');
      expect(t.variant!({ burned: true })!.svg).not.toBe(t.svg);
      expect(t.variant!({})).toBeNull();
    }
  });

  it('have their own menu section, Integrated circuits, with the half-bridge driver (no longer under Transistors)', () => {
    const groups = groupParts(PARTS);
    const ics = groups.find((g) => g.id === 'ics')!;
    expect(ics.name).toBe('Integrated circuits');
    expect(ics.parts.map((p) => p.id)).toEqual(['halfdriver', 'timer555', 'opamp']);
    expect(groups.find((g) => g.id === 'transistors')!.parts.map((p) => p.id)).not.toContain('halfdriver');
    expect(groups.find((g) => g.id === 'other')).toBeUndefined();
  });

  it('a circuit with one needs time steps (latch and mode state)', () => {
    for (const id of ['timer555', 'opamp']) {
      expect(isReactive({ components: [{ id: 1, model: getPart(id)!.sim!({}) }], links: [] }), id).toBe(true);
    }
  });
});

describe('IC parts: ratings and readouts', () => {
  it('555 warns above 16 V and 200 mA, burns above 18 V and 400 mA (through the part)', () => {
    const t = getPart('timer555')!;
    expect(partWarning(t, result({ volts: { vcc: 9 }, pins: { out: -0.05 } }), {})).toBeNull();
    expect(partWarning(t, result({ volts: { vcc: 17 } }), {})).toMatch(/VCC above 16 V/);
    expect(partWarning(t, result({ volts: { vcc: 9 }, pins: { out: 0.25 } }), {})).toMatch(/OUT above 200 mA/);
    expect(burnReason(t, result({ volts: { vcc: 19 } }), {})).toMatch(/over-voltage/);
    expect(burnReason(t, result({ volts: { vcc: 9 }, pins: { out: -0.5 } }), {})).toMatch(/output overload/);
    expect(burnReason(t, result({ volts: { vcc: 15 } }), {})).toBeNull();
  });

  it('op-amp warns above 30 mA, burns above 100 mA, 40 V or a reversed supply (through the part)', () => {
    const t = getPart('opamp')!;
    expect(partWarning(t, result({ voltage: 9, pins: { o1: -0.01 } }), {})).toBeNull();
    expect(partWarning(t, result({ voltage: 9, pins: { o2: 0.05 } }), {})).toMatch(/OUT above 30 mA/);
    expect(burnReason(t, result({ voltage: 9, pins: { o1: -0.2 } }), {})).toMatch(/output overload/);
    expect(burnReason(t, result({ voltage: 45 }), {})).toMatch(/over-voltage/);
    expect(burnReason(t, result({ voltage: -9 }), {})).toMatch(/wrong way/);
  });

  it('the readouts say what the chip is doing', () => {
    expect(timerReadout(result({ voltage: 9, volts: { vcc: 9, out: 8.9, reset: 9, 'logic.q': 1 }, pins: { vcc: 0.004 } }))).toEqual([
      'OUT high · 8.9 V', 'VCC 9 V · 4 mA',
    ]);
    expect(timerReadout(result({ volts: { vcc: 9, out: 0.02, reset: 0, 'logic.q': 0 }, pins: { vcc: 0.004 } }))[0]).toBe('OUT low · 20 mV · RESET low');
    expect(opampReadout(result({ volts: { 'abs.o1': 7.5, 'abs.o2': 0.02, 'logic.hi1': 1, 'logic.lo2': 1 } }))).toEqual([
      'OUT1 7.5 V (high)', 'OUT2 20 mV (low)',
    ]);
    expect(opampReadout(result({ volts: { 'abs.o1': 3, 'abs.o2': 3 } }))).toEqual(['OUT1 3 V (linear)', 'OUT2 3 V (linear)']);
    expect(opampReadout(result({ volts: { 'abs.o1': 0, 'abs.o2': 0, 'logic.off': 1 } }))[0]).toBe('OUT1 0 V (off)');
  });

  it('shorting the output of a 555 burns it: it stays burned, persists, and a click replaces it', () => {
    const p = new Project();
    const sc = p.scene;
    const b = sc.add({ typeId: 'battery9v', col: 0, row: 0, rotation: 0 });
    const gnd = sc.add({ typeId: 'ground', col: 0, row: 10, rotation: 0 });
    const ic = sc.add({ typeId: 'timer555', col: 10, row: 0, rotation: 0 });
    const load = sc.add({ typeId: 'resistor', col: 20, row: 0, rotation: 0, state: { value: 5 } });
    const wire = (a: [number, string], c: [number, string]) =>
      expect(sc.addWire({ partId: a[0], pinId: a[1] }, { partId: c[0], pinId: c[1] })).not.toBeNull();
    wire([b.id, 'neg'], [gnd.id, 'gnd']);
    wire([b.id, 'pos'], [ic.id, 'vcc']);
    wire([b.id, 'pos'], [ic.id, 'reset']);
    wire([ic.id, 'gnd'], [gnd.id, 'gnd']);
    wire([ic.id, 'out'], [load.id, 'a']);
    wire([load.id, 'b'], [gnd.id, 'gnd']);
    // TRIG is open (pulled low): the output is set and drives 9 V into 5 ohm + 12 ohm, about 0.53 A.
    const sim = new Simulation(sc);
    sim.update();
    const chip = sc.find(ic.id)!;
    expect(chip.state?.burned).toBe(true);
    expect(chip.state?.burnedBy).toMatch(/^output overload \(OUT above 400 mA\)$/);
    expect(sim.partResult(ic.id)!.current).toBe(0);
    const reloaded = new Project();
    reloaded.load(readProject(stringifyProject(p.serialize())));
    const again = reloaded.scene.parts.find((x) => x.typeId === 'timer555')!;
    expect(again.state).toMatchObject({ burned: true });
    clickPart(again);
    expect(again.state?.burned).toBe(false);
  });
});

describe('IC examples', () => {
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
  const idOf = (scene: Scene, typeId: string): number => scene.parts.find((x) => x.typeId === typeId)!.id;

  it('every IC has an example: the half-bridge driver, the 555 and the op-amp (the gates have theirs too)', () => {
    const used = new Set<string>();
    for (const e of EXAMPLES) for (const part of e.state.parts) used.add(part.typeId);
    for (const id of ['halfdriver', 'timer555', 'opamp', 'gate-and', 'gate-nor']) expect(used.has(id), id).toBe(true);
  });

  it('555 blinker: the right nets (TRIG with THR and the capacitor, RESET with VCC), no warnings', () => {
    const scene = load('555 blinker');
    const chip = idOf(scene, 'timer555');
    const cap = idOf(scene, 'ecap');
    const { input } = buildNetlist(scene);
    expect(isReactive(input)).toBe(true);
    const r = solveCircuit(input);
    expect(r.converged).toBe(true);
    expect(r.nets[`${chip}:trig`]).toBe(r.nets[`${chip}:thr`]);
    expect(r.nets[`${chip}:thr`]).toBe(r.nets[`${cap}:pos`]);
    expect(r.nets[`${chip}:reset`]).toBe(r.nets[`${chip}:vcc`]);
    expect(r.nets[`${chip}:gnd`]).toBe(r.nets[`${cap}:neg`]);
    expect(r.nets[`${chip}:out`]).not.toBe(r.nets[`${chip}:vcc`]);
    expect(partWarning(getPart('timer555')!, r.parts[chip], {})).toBeNull();
  });

  it('555 blinker: the LED blinks about 1.5 times a second (1.44 / ((R1 + 2 R2) C)), within 6 %', () => {
    const scene = load('555 blinker');
    const led = idOf(scene, 'led');
    const { input } = buildNetlist(scene);
    let state: TransientState = initialState(input);
    const dt = 1e-3;
    let lit = false;
    const risings: number[] = [];
    let burnedAt = false;
    for (let time = dt; time <= 6; time += dt) {
      const out = solveStep(input, state, dt);
      state = out.state;
      expect(out.result.converged).toBe(true);
      const on = out.result.parts[led].current > 0.002;
      if (on && !lit) risings.push(time);
      lit = on;
      if (out.result.parts[led].current > 0.03) burnedAt = true;
    }
    expect(burnedAt).toBe(false);
    expect(risings.length).toBeGreaterThanOrEqual(5);
    const period = (risings[4] - risings[1]) / 3;
    const expected = 0.693 * (1000 + 47_000 + 47_000) * 10e-6; // high 0.693 (R1 + R2) C + low 0.693 R2 C
    expect(period / expected).toBeGreaterThan(0.94);
    expect(period / expected).toBeLessThan(1.06);
  });

  it('Op-amp night light: dark lights the LED (about 10 mA through 470 ohm), bright switches it off', () => {
    const scene = load('Op-amp night light');
    const chip = idOf(scene, 'opamp');
    const led = idOf(scene, 'led');
    const ldr = scene.parts.find((x) => x.typeId === 'ldr')!;
    const solve = (lux: number) => {
      ldr.state = { lux };
      const { input } = buildNetlist(scene);
      const r = solveCircuit(input);
      expect(r.converged).toBe(true);
      return r;
    };
    const bright = solve(1000);
    expect(bright.parts[led].current).toBeLessThan(1e-4);
    expect(bright.parts[chip].volts!['logic.lo1']).toBe(1);
    const dark = solve(5);
    expect(dark.parts[chip].volts!['logic.hi1']).toBe(1);
    expect(dark.parts[led].current).toBeGreaterThan(0.008);
    expect(dark.parts[led].current).toBeLessThan(0.02);
    expect(partWarning(getPart('opamp')!, dark.parts[chip], {})).toBeNull();
    // The threshold: the divider crosses the 1.5 V reference at R_ldr = 2 k, i.e. 100 lx.
    expect(solve(120).parts[led].current).toBeLessThan(1e-4);
    expect(solve(80).parts[led].current).toBeGreaterThan(0.008);
    // Inspector and readout of the chip.
    const q = new Map(inspect(getPart('opamp')!.sim!({}), dark, { id: chip, type: 'opamp' }).map((x) => [x.id, x]));
    expect(q.get('mode1')?.text).toBe('saturated high');
    expect(opampReadout(dark.parts[chip])[0]).toMatch(/^OUT1 [\d.]+ V \(high\)$/);
  });

  it('both examples save and load with the new parts', () => {
    for (const name of ['555 blinker', 'Op-amp night light']) {
      const p = new Project();
      p.scene.insert(EXAMPLES.find((e) => e.name === name)!.state);
      const first = p.serialize();
      const b = new Project();
      b.load(readProject(stringifyProject(first)));
      expect(b.serialize()).toEqual(first);
    }
  });

  it('a click does not burn or break anything: clicking a chip is harmless', () => {
    const scene = load('555 blinker');
    const chip = scene.parts.find((x) => x.typeId === 'timer555')!;
    expect(() => clickPart(chip)).not.toThrow();
  });
});
