// The rating table (sim/specs.ts) through the part types: every row warns
// and burns at its thresholds and not below, burned parts are open and stay
// burned, the LED's own current limits are unchanged, the burn switch, and
// the texts in the readout and the Scope inspector.

import { describe, expect, it } from 'vitest';
import { formatSI } from './format';
import type { PartState } from './model';
import { PARTS, burnReason, getPart, partWarning } from './parts';
import { Project } from './project/project';
import { readProject } from './project/read';
import { stringifyProject } from './project/format';
import { describePart } from './readout';
import type { ComponentModel, PartResult, SimResult } from './sim';
import { inspect } from './sim/inspect';
import { PART_SPECS, burnEnabled, setBurnEnabled, specStress } from './sim/specs';
import { Simulation } from './simulation';

const result = (extra: Partial<PartResult>): PartResult => ({ voltage: 0, current: 0, power: 0, pins: {}, ...extra });

/** A result that puts `v` on the limit `label` of part type `type` (in the part's own frame). */
const STRESS: Record<string, (v: number) => PartResult> = {
  'resistor:P': (v) => result({ power: v }),
  'led:Vr': (v) => result({ voltage: -v }),
  'diode:If': (v) => result({ current: v, voltage: 0.9 }),
  'diode:Vr': (v) => result({ voltage: -v }),
  'bjt:Vce': (v) => result({ voltage: v }),
  'bjt:Ic': (v) => result({ pins: { c: v } }),
  'bjt:Pd': (v) => result({ power: v }),
  'bjt:Veb': (v) => result({ volts: { b: -v } }),
  'pnp:Vce': (v) => result({ voltage: -v }),
  'pnp:Ic': (v) => result({ pins: { c: -v } }),
  'pnp:Pd': (v) => result({ power: v }),
  'pnp:Veb': (v) => result({ volts: { b: v } }),
  'nmos:Vds': (v) => result({ voltage: v }),
  'nmos:Id': (v) => result({ current: v }),
  'nmos:Vgs': (v) => result({ volts: { g: -v } }), // either sign
  'pmos:Vds': (v) => result({ voltage: -v }),
  'pmos:Id': (v) => result({ current: -v }),
  'pmos:Vgs': (v) => result({ volts: { g: -v } }),
  // The default pot (10 k, wiper at the middle): 5 k per half, P = I^2 5k.
  'pot:P': (v) => result({ pins: { a: Math.sqrt(v / 5000), w: -Math.sqrt(v / 5000) } }),
  'battery:I': (v) => result({ current: v }),
  'battery9v:I': (v) => result({ current: v }),
  'switch:I': (v) => result({ current: v }),
  'button:I': (v) => result({ current: -v }),
};

describe('rating table', () => {
  it('has a stress case for every limit of every row, and every row is a part type', () => {
    const limits = Object.entries(PART_SPECS).flatMap(([type, spec]) => spec.limits.map((l) => `${type}:${l.label}`));
    expect(limits.sort()).toEqual(Object.keys(STRESS).sort());
    for (const type of Object.keys(PART_SPECS)) expect(getPart(type), type).toBeDefined();
  });

  for (const [type, spec] of Object.entries(PART_SPECS)) {
    for (const l of spec.limits) {
      it(`${type} ${l.label}: warns above ${l.warnAbove}, burns ${l.burnAbove === undefined ? 'never' : `above ${l.burnAbove}`}`, () => {
        const t = getPart(type)!;
        const s: PartState = { ...t.defaults };
        const at = STRESS[`${type}:${l.label}`];
        expect(partWarning(t, at(0.99 * l.warnAbove), s)).toBeNull();
        expect(burnReason(t, at(0.99 * l.warnAbove), s)).toBeNull();
        const warn = partWarning(t, at(1.01 * l.warnAbove), s);
        expect(warn).toMatch(new RegExp(`^${l.label} .*(exceeds|is near) its .* rating\\.$`));
        expect(burnReason(t, at(1.01 * l.warnAbove), s)).toBeNull();
        if (l.burnAbove === undefined) {
          expect(burnReason(t, at(100 * l.rated), s)).toBeNull();
          expect(partWarning(t, at(100 * l.rated), s)).toMatch(/exceeds/);
        } else {
          expect(burnReason(t, at(0.99 * l.burnAbove), s)).toBeNull();
          expect(burnReason(t, at(1.01 * l.burnAbove), s)).toBe(`${l.what} (${l.label} ${formatSI(1.01 * l.burnAbove, l.unit)}, rated ${formatSI(l.rated, l.unit)})`);
        }
      });
    }
  }

  it('words the texts with the values: warning, near the rating, burn', () => {
    const bjt = getPart('bjt')!;
    expect(partWarning(bjt, result({ pins: { c: 0.13 } }), {})).toBe('Ic 130 mA exceeds its 100 mA rating.');
    expect(partWarning(bjt, result({ voltage: 40 }), {})).toBe('Vce 40 V is near its 45 V rating.');
    expect(burnReason(bjt, result({ pins: { c: 0.16 } }), {})).toBe('too much collector current (Ic 160 mA, rated 100 mA)');
    expect(burnReason(getPart('resistor')!, result({ power: 1.2 }), { value: 220 })).toBe('too much power (P 1.2 W, rated 250 mW)');
  });

  it('a burned rated part is an open circuit (also when it has a variant of its own)', () => {
    for (const type of Object.keys(PART_SPECS)) {
      const t = getPart(type)!;
      expect(t.sim!({ ...t.defaults, burned: true }), type).toEqual({ kind: 'open' });
      expect(t.sim!({ ...t.defaults }).kind, type).not.toBe('open');
    }
  });

  it('leaves the LED current limits as they were (30 mA warns, 100 mA burns)', () => {
    const led = getPart('led')!;
    expect(partWarning(led, result({ current: 0.025, voltage: 2 }), {})).toBeNull();
    expect(partWarning(led, result({ current: 0.031, voltage: 2 }), {})).toBe('Too much current: add a series resistor.');
    expect(burnReason(led, result({ current: 0.099, voltage: 2 }), {})).toBeNull();
    expect(burnReason(led, result({ current: 0.101, voltage: 2 }), {})).toBe('too much current');
  });

  it('does not touch the part types without a row (capacitor, ecap, IGBT, boards)', () => {
    for (const t of PARTS) {
      if (Object.hasOwn(PART_SPECS, t.id)) continue;
      expect(specStress(t.id, result({ voltage: 1e6, current: 1e6, power: 1e6 }), { kind: 'open' }).level).toBe('ok');
    }
    // The ecap's own rules still apply.
    expect(burnReason(getPart('ecap')!, result({ voltage: -2 }), { value: 100e-6 })).toMatch(/reverse/);
  });

  it('only warns while burning is switched off (the strict / forgiving hook)', () => {
    const r = getPart('resistor')!;
    expect(burnEnabled()).toBe(true);
    setBurnEnabled(false);
    try {
      expect(burnReason(r, result({ power: 5 }), { value: 10 })).toBeNull();
      expect(partWarning(r, result({ power: 5 }), { value: 10 })).toBe('P 5 W is far beyond its 250 mW rating.');
    } finally {
      setBurnEnabled(true);
    }
    expect(burnReason(r, result({ power: 5 }), { value: 10 })).toMatch(/too much power/);
  });
});

/** 9 V battery (1.5 ohm inside) straight across a part's two pins. */
function across(typeId: string, pins: [string, string], state: PartState = {}) {
  const p = new Project();
  const s = p.scene;
  const bat = s.add({ typeId: 'battery9v', col: 0, row: 0, rotation: 0 });
  const gnd = s.add({ typeId: 'ground', col: 0, row: 10, rotation: 0 });
  const part = s.add({ typeId, col: 20, row: 0, rotation: 0, state: { ...getPart(typeId)!.defaults, ...state } });
  s.addWire({ partId: bat.id, pinId: 'neg' }, { partId: gnd.id, pinId: 'gnd' });
  expect(s.addWire({ partId: bat.id, pinId: 'pos' }, { partId: part.id, pinId: pins[0] })).not.toBeNull();
  expect(s.addWire({ partId: bat.id, pinId: 'neg' }, { partId: part.id, pinId: pins[1] })).not.toBeNull();
  const sim = new Simulation(s);
  sim.update();
  return { p, sim, part: s.find(part.id)!, battery: s.find(bat.id)! };
}

describe('burning in the simulation', () => {
  it('a 47 ohm resistor on 9 V (1.6 W) burns open, stays burned and says why', () => {
    const { p, sim, part } = across('resistor', ['a', 'b'], { value: 47 });
    expect(part.state?.burned).toBe(true);
    expect(part.state?.burnedBy).toMatch(/^too much power \(P 1\.\d+ W, rated 250 mW\)$/);
    expect(sim.partResult(part.id)!.current).toBe(0);
    sim.update();
    expect(part.state?.burned).toBe(true);
    expect(describePart(part, sim)?.warning).toMatch(/^Burned out by too much power/);
    // Saved and loaded: still burned.
    const b = new Project();
    b.load(readProject(stringifyProject(p.serialize())));
    expect(b.scene.parts.find((x) => x.typeId === 'resistor')!.state).toMatchObject({ burned: true, burnedBy: part.state!.burnedBy });
  });

  it('a 220 ohm resistor on 9 V (0.36 W) only warns, in the readout too', () => {
    const { sim, part } = across('resistor', ['a', 'b'], { value: 220 });
    expect(part.state?.burned).toBeUndefined();
    expect(describePart(part, sim)?.warning).toMatch(/^P 3\d\d mW exceeds its 250 mW rating\.$/);
  });

  it('a closed switch shorting a 9 V battery (6 A) burns open; the battery only warns', () => {
    const { sim, part, battery } = across('switch', ['a', 'b'], { closed: true });
    expect(part.state?.burnedBy).toMatch(/^too much current through the contacts/);
    expect(battery.state?.burned).toBeUndefined();
    // After the switch burned nothing flows any more, so the battery is fine again.
    expect(partWarning(getPart('battery9v')!, sim.partResult(battery.id)!, {})).toBeNull();
  });

  it('a 1N4148 forward on 9 V without a resistor (about 4 A) burns', () => {
    const { part } = across('diode', ['anode', 'cathode']);
    expect(part.state?.burnedBy).toMatch(/^too much forward current \(If [\d.]+ A, rated 200 mA\)$/);
  });

  it('the LED still burns by its current, as before', () => {
    const { part } = across('led', ['anode', 'cathode']);
    expect(part.state).toMatchObject({ burned: true, burnedBy: 'too much current' });
  });
});

describe('the Scope inspector', () => {
  const resultFor = (id: number, r: PartResult, nets: Record<string, number> = {}, voltages: number[] = [0]): SimResult => ({
    time: 0, converged: true, iterations: 1, reference: 'ground', connectedNets: 0, nets, voltages, parts: { [id]: r },
  });

  it('shows the rating verdict of rated part types', () => {
    const model = getPart('bjt')!.sim!({});
    const q = inspect(model, resultFor(1, result({ pins: { c: 0.13, b: 0.001, e: -0.131 } })), { id: 1, type: 'bjt' });
    expect(q.find((x) => x.id === 'rating')?.text).toBe('Ic 130 mA exceeds its 100 mA rating.');
    const ok = inspect(model, resultFor(1, result({ pins: { c: 0.01, b: 0.0001, e: -0.0101 } })), { id: 1, type: 'bjt' });
    expect(ok.find((x) => x.id === 'rating')?.text).toBe('ok');
    // No type given (or a type without a row): no rating row.
    expect(inspect(model, resultFor(1, result({})), { id: 1 }).some((x) => x.id === 'rating')).toBe(false);
  });

  it('says why a burned part burned', () => {
    const open: ComponentModel = { kind: 'open' };
    expect(inspect(open, resultFor(1, result({})), { id: 1, burnedBy: 'too much power (P 2 W, rated 250 mW)' })[0].text)
      .toBe('Open (burned out by too much power (P 2 W, rated 250 mW))');
    expect(inspect(open, resultFor(1, result({})), { id: 1 })[0].text).toBe('Open (burned out)');
  });

  it('gives the power of each half of a potentiometer track', () => {
    // 10 k at the middle: a at 10 V, wiper at 5 V, b at 0 V: 1 mA through each half, 5 mW each.
    const model: ComponentModel = { kind: 'pot', ohms: 10_000, position: 0.5 };
    const r = resultFor(1, result({ pins: { a: 0.001, w: 0, b: -0.001 }, power: 0.01 }), { '1:a': 1, '1:w': 2, '1:b': 0 }, [0, 10, 5]);
    const q = new Map(inspect(model, r, { id: 1, type: 'pot' }).map((x) => [x.id, x]));
    expect(q.get('paw')?.value).toBeCloseTo(0.005, 12);
    expect(q.get('pwb')?.value).toBeCloseTo(0.005, 12);
    expect(q.get('rating')?.text).toBe('ok');
  });
});
