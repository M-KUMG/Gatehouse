// The AC and mains parts (acparts.ts): registration, menu section, saved settings, readouts and ratings.

import { describe, expect, it } from 'vitest';
import { bulbReadout, ledbulbReadout, transformerReadout } from './devicereadouts';
import { groupParts } from './partcategories';
import { PARTS, burnReason, getPart, partWarning } from './parts';
import { stringifyProject } from './project/format';
import { Project } from './project/project';
import { readProject } from './project/read';
import type { PartResult } from './sim';

const IDS = ['acsource', 'outlet', 'mainsswitch', 'transformer', 'bulb', 'ledbulb'];

describe('AC and mains parts', () => {
  it('are in their own menu section, in this order', () => {
    const section = groupParts(PARTS).find((g) => g.id === 'ac');
    expect(section?.name).toBe('AC & mains');
    expect(section?.parts.map((p) => p.id)).toEqual(IDS);
  });

  it('give each part its model from its settings', () => {
    expect(getPart('acsource')!.sim!({ value: 24, freq: 60, limit: 3 })).toEqual({ kind: 'acsource', vrms: 24, freq: 60, limit: 3 });
    expect(getPart('outlet')!.sim!({})).toEqual({ kind: 'acsource', vrms: 230, freq: 50, limit: 16 });
    expect(getPart('bulb')!.sim!({ value: 100, volts: 230 })).toEqual({ kind: 'bulb', volts: 230, watts: 100 });
    expect(getPart('ledbulb')!.sim!({ value: 5, volts: 230 })).toEqual({ kind: 'ledbulb', volts: 230, watts: 5 });
    expect(getPart('transformer')!.sim!({ value: 6, volts: 230 })).toEqual({ kind: 'transformer', primaryVolts: 230, secondaryVolts: 6, va: 50 });
    expect(getPart('bulb')!.sim!({ burned: true })).toEqual({ kind: 'open' });
  });

  it('show the settings on the artwork and keep the default look for the defaults', () => {
    const ac = getPart('acsource')!;
    expect(ac.variant!({})).toBeNull();
    expect(ac.variant!({ value: 24, freq: 60 })!.svg).toContain('24.0 V');
    expect(ac.variant!({ value: 24, freq: 60 })!.svg).toContain('60 Hz');
    const tr = getPart('transformer')!;
    expect(tr.variant!({})).toBeNull();
    expect(tr.variant!({ value: 6, volts: 230 })!.svg).toContain('6 V');
  });

  it('save and load their settings, and refuse values out of range or on other parts', () => {
    const p = new Project();
    p.scene.add({ typeId: 'acsource', col: 0, row: 0, rotation: 0, state: { value: 24, freq: 60, limit: 3 } });
    p.scene.add({ typeId: 'bulb', col: 10, row: 0, rotation: 0, state: { value: 40, volts: 120 } });
    const first = p.serialize();
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
    expect(b.scene.parts[0].state).toEqual({ value: 24, freq: 60, limit: 3 });
    expect(b.scene.parts[1].state).toEqual({ value: 40, volts: 120 });
    const bad = (index: number, state: object) => {
      const doc = JSON.parse(stringifyProject(first));
      doc.parts[index].state = state;
      return () => readProject(JSON.stringify(doc));
    };
    expect(bad(0, { freq: 5000 })).toThrow(/freq/);
    expect(bad(0, { freq: 60 })).not.toThrow();
    expect(bad(1, { volts: 1 })).toThrow(/volts/);
    expect(bad(1, { freq: 50 })).toThrow(/freq/); // a bulb has no frequency
  });

  it('read out the lamp and transformer values in words', () => {
    const lamp: PartResult = { voltage: 100, current: 0.1, power: 10, pins: {}, volts: { light: 0.97, 'filament.temp': 2700 } };
    expect(bulbReadout(lamp)[1]).toMatch(/Light 97 %.*filament 2427 °C/);
    expect(ledbulbReadout({ ...lamp, volts: { light: 1, 'power.avg': 9 } })[1]).toMatch(/9.* average.*light 100 %/);
    const tr: PartResult = { voltage: 325, current: 0.02, power: 1, pins: { p1: 0.02, s1: 1 }, volts: { sec: 17 } };
    expect(transformerReadout(tr)[0]).toMatch(/Primary 325/);
    expect(transformerReadout(tr)[1]).toMatch(/Secondary 17/);
  });

  it('warn and burn by their ratings', () => {
    const bulb = getPart('bulb')!;
    const hot = (kelvin: number): PartResult => ({ voltage: 0, current: 0, power: 0, pins: {}, volts: { 'filament.temp': kelvin, light: 1 } });
    expect(partWarning(bulb, hot(2700), { value: 60 })).toBeNull();
    expect(partWarning(bulb, hot(3100), { value: 60 })).toMatch(/Filament/);
    expect(burnReason(bulb, hot(3500), { value: 60 })).toMatch(/filament burned out/);
    const tr = getPart('transformer')!;
    const amps = (i1: number): PartResult => ({ voltage: 0, current: 0, power: 0, pins: { p1: i1, s1: 0 } });
    expect(burnReason(tr, amps(0.1), {})).toBeNull();
    expect(burnReason(tr, amps(5), {})).toMatch(/burned out/);
  });
});
