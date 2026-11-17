import { describe, expect, it } from 'vitest';
import { endTerminal, findContacts } from './contacts';
import { Scene, type PinRef, type PlacedPart, type Rotation, type WireEnd } from './model';
import type { PartState } from './parts';
import { pinsOf } from './pins';
import { solveCircuit, terminalKey, type SimResult } from './sim';
import { buildNetlist } from './simulation';

/** Add a part placed so that its pin `pinId` lands on (col, row). */
function placeAt(scene: Scene, typeId: string, pinId: string, col: number, row: number, rotation: Rotation = 0, state?: PartState): PlacedPart {
  const pin = pinsOf({ id: 0, typeId, col: 0, row: 0, rotation }).find((p) => p.ref.pinId === pinId);
  if (!pin) throw new Error(`${typeId} has no pin ${pinId}`);
  return scene.add({ typeId, col: col - pin.col, row: row - pin.row, rotation, ...(state ? { state } : {}) });
}

const pin = (part: PlacedPart, pinId: string): PinRef => ({ partId: part.id, pinId });

function solve(scene: Scene): SimResult {
  const r = solveCircuit(buildNetlist(scene).input);
  expect(r.converged).toBe(true);
  return r;
}

const netOf = (r: SimResult, end: WireEnd): number => r.nets[terminalKey(endTerminal(end))];
const voltsAt = (r: SimResult, end: WireEnd): number => r.voltages[netOf(r, end)];

// 9 V battery part: 9 V behind 1.5 ohm.
const EMF = 9;
const R_INTERNAL = 1.5;

describe('touching pins', () => {
  it('joins pins of two parts on the same grid point, with no wires: resistor + resistor + battery', () => {
    const s = new Scene();
    const bat = placeAt(s, 'battery9v', 'pos', 5, 1);
    const r1 = placeAt(s, 'resistor', 'a', 5, 1, 0, { value: 1000 }); // a on battery +, b at (9, 1)
    const r2 = placeAt(s, 'resistor', 'a', 9, 1, 0, { value: 2000 }); // a on r1.b, b at (13, 1)
    placeAt(s, 'ground', 'gnd', 13, 1); // r2.b to ground
    const negAt = pinsOf(bat).find((p) => p.ref.pinId === 'neg')!;
    placeAt(s, 'ground', 'gnd', negAt.col, negAt.row); // battery - to ground
    expect(s.wires).toHaveLength(0);

    const r = solve(s);
    const amps = EMF / (R_INTERNAL + 1000 + 2000);
    expect(r.parts[r1.id].current).toBeCloseTo(amps, 9);
    expect(voltsAt(r, pin(r1, 'b'))).toBeCloseTo(amps * 2000, 6);
    expect(netOf(r, pin(r1, 'b'))).toBe(netOf(r, pin(r2, 'a')));
    expect(netOf(r, pin(r1, 'a'))).not.toBe(netOf(r, pin(r1, 'b'))); // same part: never joined
  });

  it('gives the hand-calculated current for a tight battery + resistor + LED layout', () => {
    const s = new Scene();
    const bat = placeAt(s, 'battery9v', 'pos', 5, 1);
    const res = placeAt(s, 'resistor', 'a', 5, 1, 0, { value: 330 });
    const led = placeAt(s, 'led', 'anode', 9, 1); // anode on the resistor's b; cathode lands at (8, 1)
    const cathode = pinsOf(led).find((p) => p.ref.pinId === 'cathode')!;
    placeAt(s, 'ground', 'gnd', cathode.col, cathode.row);
    const neg = pinsOf(bat).find((p) => p.ref.pinId === 'neg')!;
    placeAt(s, 'ground', 'gnd', neg.col, neg.row);

    const r = solve(s);
    const vLed = r.parts[led.id].voltage;
    expect(vLed).toBeGreaterThan(1.6);
    expect(vLed).toBeLessThan(2.2);
    // Series loop: I = (EMF - V_led) / (R + R_internal).
    const amps = (EMF - vLed) / (330 + R_INTERNAL);
    expect(r.parts[res.id].current).toBeCloseTo(amps, 7);
    expect(r.parts[led.id].current).toBeCloseTo(amps, 7);
    expect(amps).toBeGreaterThan(0.02);

    // The same circuit drawn apart and joined with wires solves the same.
    const w = new Scene();
    const bat2 = w.add({ typeId: 'battery9v', col: 0, row: 0, rotation: 0 });
    const res2 = w.add({ typeId: 'resistor', col: 20, row: 0, rotation: 0, state: { value: 330 } });
    const led2 = w.add({ typeId: 'led', col: 40, row: 0, rotation: 0 });
    const g1 = w.add({ typeId: 'ground', col: 0, row: 20, rotation: 0 });
    const g2 = w.add({ typeId: 'ground', col: 40, row: 20, rotation: 0 });
    w.addWire(pin(bat2, 'pos'), pin(res2, 'a'));
    w.addWire(pin(res2, 'b'), pin(led2, 'anode'));
    w.addWire(pin(led2, 'cathode'), pin(g2, 'gnd'));
    w.addWire(pin(bat2, 'neg'), pin(g1, 'gnd'));
    expect(solve(w).parts[led2.id].current).toBeCloseTo(amps, 9);
  });

  it('follows the parts: moving one apart disconnects it at once', () => {
    const s = new Scene();
    const r1 = placeAt(s, 'resistor', 'b', 4, 1);
    const r2 = placeAt(s, 'resistor', 'a', 4, 1);
    expect(findContacts(s).links).toEqual([[{ part: r1.id, pin: 'b' }, { part: r2.id, pin: 'a' }]]);
    expect(findContacts(s).points).toEqual([{ col: 4, row: 1, end: pin(r1, 'b') }]);
    r2.col += 1;
    expect(findContacts(s).links).toEqual([]);
    s.rotate(r2); // rotation counts too: nothing lands on r1.b
    expect(findContacts(s).links).toEqual([]);
    r2.col -= 1;
    s.remove(r2.id);
    expect(findContacts(s).links).toEqual([]);
  });
});

describe('pins on wires', () => {
  /** Battery + to a far resistor along a wire with a corner at (5, -4); ground on battery -. */
  function wired(): { s: Scene; bat: PlacedPart } {
    const s = new Scene();
    const bat = s.add({ typeId: 'battery9v', col: 0, row: 0, rotation: 0 }); // + at (5, 1)
    const neg = pinsOf(bat).find((p) => p.ref.pinId === 'neg')!;
    placeAt(s, 'ground', 'gnd', neg.col, neg.row);
    const far = placeAt(s, 'resistor', 'a', 20, -4, 0, { value: 1000 });
    placeAt(s, 'ground', 'gnd', 24, -4); // far.b
    s.addWire(pin(bat, 'pos'), pin(far, 'a'), [{ col: 5, row: -4 }]);
    return { s, bat };
  }

  it('joins a pin lying on a segment between grid points of the path', () => {
    const { s, bat } = wired();
    // A 2 kohm resistor standing on the wire: its a lead at (12, -4), b to ground.
    const probe = placeAt(s, 'resistor', 'a', 12, -4, 90, { value: 2000 });
    const b = pinsOf(probe).find((p) => p.ref.pinId === 'b')!;
    placeAt(s, 'ground', 'gnd', b.col, b.row);
    const r = solve(s);
    expect(netOf(r, pin(probe, 'a'))).toBe(netOf(r, pin(bat, 'pos')));
    // Battery loaded by 1k || 2k.
    const load = (1000 * 2000) / 3000;
    expect(voltsAt(r, pin(probe, 'a'))).toBeCloseTo((EMF * load) / (load + R_INTERNAL), 6);
    expect(findContacts(s).points).toContainEqual({ col: 12, row: -4, end: pin(probe, 'a') });
  });

  it('joins a pin lying on a waypoint', () => {
    const { s, bat } = wired();
    const probe = placeAt(s, 'resistor', 'b', 5, -4, 0, { value: 2000 });
    const r = solve(s);
    expect(netOf(r, pin(probe, 'b'))).toBe(netOf(r, pin(bat, 'pos')));
    expect(netOf(r, pin(probe, 'a'))).not.toBe(netOf(r, pin(bat, 'pos')));
  });

  it('never joins a pin to a wire of its own part, nor two leads of one part on one wire', () => {
    const s = new Scene();
    const res = s.add({ typeId: 'resistor', col: 0, row: 0, rotation: 0 }); // a (0, 1), b (4, 1)
    const other = s.add({ typeId: 'resistor', col: 20, row: 0, rotation: 0 });
    // From res.a out to the left, back over res.b and on to the other resistor.
    s.addWire(pin(res, 'a'), pin(other, 'a'), [{ col: -2, row: 1 }, { col: -2, row: 3 }, { col: 4, row: 3 }, { col: 4, row: 1 }, { col: 10, row: 1 }]);
    expect(findContacts(s).links).toEqual([]);
    // A third resistor lying along the wire with both leads on it is not shorted either.
    s.add({ typeId: 'resistor', col: 12, row: 0, rotation: 0 }); // leads at (12, 1) and (16, 1)
    expect(findContacts(s).links).toEqual([]);
  });
});
