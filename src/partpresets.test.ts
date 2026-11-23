import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPartCatalog } from './partpresets';
import { getPart, hasPartSettings, PARTS, placedPartName } from './parts';
import { decodeGth, encodeGth } from './project/gth';
import { Project } from './project/project';
import { fromFileMap, toFileMap } from './project/storage';

const library = new URL('../public/part-library/', import.meta.url);

describe('part presets', () => {
  it('registers, validates, and round-trips every bundled catalog entry', () => {
    const project = new Project();
    const files = [];
    for (const type of PARTS) {
      if (!type.catalog) continue;
      files.push(type.catalog.file);
      expect(hasPartSettings(type)).toBe(true);
      const data: unknown = JSON.parse(readFileSync(new URL(type.catalog.file, library), 'utf8'));
      const presets = readPartCatalog(data, type);
      expect(presets.length).toBeGreaterThan(0);
      for (const preset of presets) {
        const state = { ...type.defaults, ...preset.settings, [type.catalog.nameKey ?? 'partPreset']: preset.name };
        expect(placedPartName(type, state)).toContain(preset.name);
        project.scene.add({ typeId: type.id, col: 0, row: project.scene.parts.length * 4, rotation: 0, state });
      }
    }
    expect(files.sort()).toEqual(readdirSync(library).filter((filename) => filename.endsWith('.json')).sort());
    const snapshot = project.serialize();
    const archive = encodeGth(project.name, toFileMap(snapshot));
    expect(fromFileMap(decodeGth(archive).fileMap).parts).toEqual(snapshot.parts);
  });

  it('validates catalog field choices and relationships before applying a preset', () => {
    const relay = getPart('relay')!;
    const valid = { name: 'Relay 5V', hint: 'Example', settings: { value: 5, coilOhms: 70, pullVolts: 3.75, releaseVolts: 0.5 } };
    expect(readPartCatalog([valid], relay)).toEqual([valid]);
    expect(() => readPartCatalog([{ ...valid, settings: { ...valid.settings, value: 4 } }], relay)).toThrow(/value/);
    expect(() => readPartCatalog([{ ...valid, settings: { ...valid.settings, releaseVolts: 4 } }], relay)).toThrow(/Release voltage/);
    expect(() => readPartCatalog([valid], getPart('led')!)).toThrow(/catalog/);
  });

  it('preserves manual overrides and rejects preset state on unrelated parts', () => {
    const project = new Project();
    const state = { partPreset: 'G5LE-1 DC5', value: 5, coilOhms: 91, pullVolts: 3.7, releaseVolts: 0.6 };
    project.scene.add({ typeId: 'relay', col: 0, row: 0, rotation: 0, state });
    const snapshot = project.serialize();
    expect(fromFileMap(toFileMap(snapshot)).parts[0].state).toEqual(state);
    snapshot.parts[0].typeId = 'led';
    expect(() => fromFileMap(toFileMap(snapshot))).toThrow(/partPreset.*valid part number/);
  });
});
