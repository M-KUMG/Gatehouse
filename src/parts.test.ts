import { describe, expect, it } from 'vitest';
import type { Rotation } from './model';
import { PARTS, getPart } from './parts';
import { rotatePoint } from './pins';
import { stringifyProject } from './project/format';
import { Project } from './project/project';
import { readProject } from './project/read';
import { modelPins } from './sim';

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

describe('part types', () => {
  it('has the semiconductor parts, in menu order after the potentiometer', () => {
    const ids = PARTS.map((p) => p.id);
    const at = ids.indexOf('pot');
    expect(ids.slice(at + 1, at + 6)).toEqual(['diode', 'bjt', 'pnp', 'nmos', 'pmos']);
    expect(getPart('bjt')?.name).toBe('NPN transistor (BC547)');
    expect(getPart('pnp')?.name).toBe('PNP transistor (BC557)');
    expect(getPart('diode')?.name).toBe('Diode (1N4148)');
    expect(getPart('nmos')?.name).toBe('N-MOSFET (logic level)');
    expect(getPart('pmos')?.name).toBe('P-MOSFET');
  });

  it('puts every pin of every part on a grid point of its box, in every rotation', () => {
    for (const type of PARTS) {
      for (const pin of type.pins) {
        expect(Number.isInteger(pin.x) && Number.isInteger(pin.y), `${type.id}.${pin.id}`).toBe(true);
        expect(pin.x >= 0 && pin.x <= type.cols && pin.y >= 0 && pin.y <= type.rows, `${type.id}.${pin.id}`).toBe(true);
        for (const r of ROTATIONS) {
          const p = rotatePoint(pin.x, pin.y, type, r);
          expect(Number.isInteger(p.x) && Number.isInteger(p.y), `${type.id}.${pin.id} at ${r}`).toBe(true);
        }
      }
    }
  });

  it('gives every simulated part all the pins of its model', () => {
    for (const type of PARTS) {
      if (!type.sim || type.board) continue;
      const ids = type.pins.map((p) => p.id);
      for (const pin of modelPins(type.sim(type.defaults ?? {}))) expect(ids, type.id).toContain(pin);
    }
  });

  it('keeps the NPN and the PNP on the same footprint and pins', () => {
    const npn = getPart('bjt');
    const pnp = getPart('pnp');
    expect(pnp?.pins).toEqual(npn?.pins);
    expect([pnp?.cols, pnp?.rows]).toEqual([npn?.cols, npn?.rows]);
  });

  it('round-trips a project with the new parts through save and load', () => {
    const a = new Project();
    const diode = a.scene.add({ typeId: 'diode', col: 0, row: 0, rotation: 0 });
    const pnp = a.scene.add({ typeId: 'pnp', col: 6, row: 0, rotation: 90 });
    const nmos = a.scene.add({ typeId: 'nmos', col: 0, row: 6, rotation: 180 });
    const pmos = a.scene.add({ typeId: 'pmos', col: 8, row: 6, rotation: 270 });
    a.scene.add({ typeId: 'bjt', col: 16, row: 0, rotation: 0 });
    expect(a.scene.addWire({ partId: diode.id, pinId: 'cathode' }, { partId: pnp.id, pinId: 'b' })).not.toBeNull();
    expect(a.scene.addWire({ partId: nmos.id, pinId: 'd' }, { partId: pmos.id, pinId: 'g' })).not.toBeNull();
    const first = a.serialize();
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
    expect(b.scene.parts.map((p) => p.typeId)).toEqual(['diode', 'pnp', 'nmos', 'pmos', 'bjt']);
  });
});
