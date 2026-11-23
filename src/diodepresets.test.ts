import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCHOTTKY_1N5819 } from './basicparts';
import { toolbarButtons } from './boardcontrols';
import { readPartCatalog } from './partpresets';
import { searchNamed } from './partsearch';
import { getPart, partWarning } from './parts';
import { decodeGth, encodeGth } from './project/gth';
import { Project } from './project/project';
import { fromFileMap, toFileMap } from './project/storage';
import { solveCircuit, type ComponentModel } from './sim';
import { D1N4148 } from './sim/devices';
import { zenerModel } from './sim/zener';

const raw = JSON.parse(readFileSync(new URL('../public/part-library/diodes.json', import.meta.url), 'utf8'));
const readDiodeCatalog = (data: unknown, family = 'diode') => readPartCatalog(data, getPart(family)!);
const catalog = (family: string) => readDiodeCatalog(
  JSON.parse(readFileSync(new URL(`../public/part-library/${getPart(family)!.catalog!.file}`, import.meta.url), 'utf8')), family,
);

function bias(model: ComponentModel, volts: number, ohms: number) {
  return solveCircuit({
    components: [
      { id: 1, model: { kind: 'battery', volts, rInternal: 0 } },
      { id: 2, model: { kind: 'resistor', ohms } },
      { id: 3, model },
    ],
    links: [
      [{ part: 1, pin: 'pos' }, { part: 2, pin: 'a' }],
      [{ part: 2, pin: 'b' }, { part: 3, pin: 'anode' }],
      [{ part: 3, pin: 'cathode' }, { part: 1, pin: 'neg' }],
    ],
  });
}

describe('diode presets', () => {
  it('validates the shipped catalog and preserves the original diode in old saves', () => {
    expect(readDiodeCatalog(raw).map((preset) => preset.name)).toContain('1N4007');
    expect(getPart('diode')!.sim!({})).toEqual(D1N4148);
    expect(getPart('schottky')!.sim!({})).toEqual(SCHOTTKY_1N5819);
    expect(getPart('zener')!.sim!({})).toEqual(zenerModel(5.1));
    expect(() => readDiodeCatalog([raw[0], raw[0]])).toThrow(/Duplicate/);
    expect(() => readDiodeCatalog([{ ...raw[0], settings: { ...raw[0].settings, diodeN: 0 } }])).toThrow(/diodeN/);
  });

  it('exposes the editor and saves the selected values and subsequent edits in the project', () => {
    const rectifier = readDiodeCatalog(raw).find((preset) => preset.name === '1N4007')!;
    const { name, settings } = rectifier;
    const state = { ...settings, diodePreset: name, diodeRs: 0.075 };
    const project = new Project();
    project.scene.add({ typeId: 'diode', col: 0, row: 0, rotation: 0, state });
    expect(toolbarButtons(project.scene.parts, () => { throw new Error('Diodes have no board state'); }).edit).toBe(true);
    const archived = encodeGth(project.name, toFileMap(project.serialize()));
    const stored = fromFileMap(decodeGth(archived).fileMap).parts[0].state!;
    expect(stored).toEqual(state);

    const diode = getPart('diode')!;
    expect(diode.sim!(stored)).toEqual({
      kind: 'diode', is: settings.diodeIs, n: settings.diodeN, rs: 0.075, ratedForwardAmps: 1, ratedReverseVolts: 1000,
    });
    const reverse = { voltage: -120, current: 0, power: 0, pins: {} };
    expect(partWarning(diode, reverse, {})).toMatch(/75 V/);
    expect(partWarning(diode, reverse, stored)).toBeNull();
    const overload = { voltage: 1, current: 1.1, power: 1.1, pins: {} };
    expect(partWarning(diode, overload, stored)).toMatch(/1 A rating/);
  });

  it('keeps the three searches separate and round-trips every preset as its own part type', () => {
    const project = new Project();
    const families = [
      { type: 'diode', presets: readDiodeCatalog(raw), partNumber: '1N4007' },
      { type: 'schottky', presets: catalog('schottky'), partNumber: 'SS34' },
      { type: 'zener', presets: catalog('zener'), partNumber: '1N4742A' },
    ] as const;
    for (const { type, presets, partNumber } of families) {
      for (const other of families) {
        const matches = searchNamed(presets, other.partNumber);
        expect(matches.map((preset) => preset.name)).toEqual(other.type === type ? [partNumber] : []);
      }
      for (const preset of presets) {
        project.scene.add({ typeId: type, col: 0, row: project.scene.parts.length * 3, rotation: 0,
          state: { diodePreset: preset.name, ...preset.settings } });
      }
    }
    const archive = encodeGth(project.name, toFileMap(project.serialize()));
    expect(fromFileMap(decodeGth(archive).fileMap).parts).toEqual(project.serialize().parts);
    expect(() => readDiodeCatalog(raw, 'zener')).toThrow(/settings/);
  });

  it('uses a lower forward drop for a Schottky preset and gives a Zener preset reverse breakdown', () => {
    const schottky = catalog('schottky').find((preset) => preset.name === 'SS14')!;
    const lowDrop = bias(getPart('schottky')!.sim!(schottky.settings), 5, 100);
    const silicon = bias(getPart('diode')!.sim!({}), 5, 100);
    expect(lowDrop.converged && silicon.converged).toBe(true);
    expect(lowDrop.parts[3].voltage).toBeLessThan(silicon.parts[3].voltage - 0.2);

    const zener = catalog('zener').find((preset) => preset.name === '1N4742A')!;
    const reverse = bias(getPart('zener')!.sim!(zener.settings), -24, 600);
    expect(reverse.converged).toBe(true);
    expect(reverse.parts[3].voltage).toBeCloseTo(-12, 1);
  });
});
