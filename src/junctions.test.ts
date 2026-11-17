import { describe, expect, it } from 'vitest';
import { endTerminal } from './contacts';
import { connect, splitWire } from './junctions';
import { Scene, type PinRef, type PlacedPart, type WireEnd } from './model';
import { pathPoints, wireRoute } from './pins';
import { solveCircuit, terminalKey, type SimResult } from './sim';
import { buildNetlist } from './simulation';

const pin = (part: PlacedPart, pinId: string): PinRef => ({ partId: part.id, pinId });

function solve(scene: Scene): SimResult {
  const r = solveCircuit(buildNetlist(scene).input);
  expect(r.converged).toBe(true);
  return r;
}

const voltsAt = (r: SimResult, end: WireEnd): number => r.voltages[r.nets[terminalKey(endTerminal(end))]];

/**
 * 9 V battery (1.5 ohm inside) -> R1 1k -> long wire -> R2 2k -> ground.
 * The long wire runs from R1.b at (14, 1) to R2.a at (30, 1).
 */
function divider() {
  const s = new Scene();
  const bat = s.add({ typeId: 'battery9v', col: 0, row: 0, rotation: 0 });
  const g1 = s.add({ typeId: 'ground', col: 0, row: 6, rotation: 0 });
  const r1 = s.add({ typeId: 'resistor', col: 10, row: 0, rotation: 0, state: { value: 1000 } });
  const r2 = s.add({ typeId: 'resistor', col: 30, row: 0, rotation: 0, state: { value: 2000 } });
  const g2 = s.add({ typeId: 'ground', col: 40, row: 6, rotation: 0 });
  const r3 = s.add({ typeId: 'resistor', col: 20, row: 8, rotation: 0, state: { value: 2000 } });
  const g3 = s.add({ typeId: 'ground', col: 30, row: 12, rotation: 0 });
  s.addWire(pin(bat, 'pos'), pin(r1, 'a'));
  s.addWire(pin(bat, 'neg'), pin(g1, 'gnd'));
  const mid = s.addWire(pin(r1, 'b'), pin(r2, 'a'))!;
  s.addWire(pin(r2, 'b'), pin(g2, 'gnd'));
  s.addWire(pin(r3, 'b'), pin(g3, 'gnd'));
  return { s, r1, r2, r3, mid };
}

describe('wire to wire', () => {
  it('a wire ending in the middle of another wire joins the nets (loaded divider)', () => {
    const { s, r3, mid } = divider();
    const before = solve(s);
    expect(voltsAt(before, pin(r3, 'a'))).not.toBeCloseTo(6, 1); // r3 hangs loose

    const wire = connect(s, pin(r3, 'a'), { wireId: mid.id, col: 22, row: 1 }, []);
    expect(wire).not.toBeNull();
    expect(s.junctions).toEqual([{ id: expect.any(Number), col: 22, row: 1 }]);
    const j = s.junctions[0];
    expect(s.wiresAt(j.id)).toHaveLength(3);

    // 9 V into 1k + 1.5 ohm, then 2k || 2k = 1k to ground.
    const r = solve(s);
    const expected = (9 * 1000) / (1000 + 1000 + 1.5);
    expect(voltsAt(r, { junctionId: j.id })).toBeCloseTo(expected, 6);
    expect(voltsAt(r, pin(r3, 'a'))).toBeCloseTo(expected, 6);
    // The junction is an ideal node: both halves of the old wire and the new wire carry the right currents.
    const amps = 9 / (1000 + 1000 + 1.5);
    expect(r.parts[r3.id].current).toBeCloseTo(amps / 2, 9);
  });

  it('splitting keeps the drawn path and reuses ends, corners and existing junctions', () => {
    const s = new Scene();
    const a = s.add({ typeId: 'resistor', col: 0, row: 0, rotation: 0 }); // b at (4, 1)
    const b = s.add({ typeId: 'resistor', col: 20, row: 10, rotation: 0 }); // a at (20, 11)
    const w = s.addWire(pin(a, 'b'), pin(b, 'a'), [{ col: 10, row: 5 }])!;
    const path = pathPoints(wireRoute(s, w)!);
    expect(splitWire(s, w, { col: 4, row: 1 })).toEqual(pin(a, 'b')); // an end: nothing to split
    expect(splitWire(s, w, { col: 3, row: 3 })).toBeNull(); // not on the wire
    const end = splitWire(s, w, { col: 10, row: 3 });
    expect(end).toEqual({ junctionId: s.junctions[0].id });
    const halves = s.wires.map((x) => pathPoints(wireRoute(s, x)!));
    expect([...halves[0], ...halves[1].slice(1)]).toEqual(path);
  });

  it('deleting the branch merges the two halves back into one wire with the same path', () => {
    const { s, r3, mid } = divider();
    const path = wireRoute(s, mid)!;
    const count = s.wires.length;
    const branch = connect(s, { wireId: mid.id, col: 22, row: 1 }, pin(r3, 'a'), [{ col: 22, row: 9 }])!;
    expect(s.wires).toHaveLength(count + 2);
    s.removeWire(branch.id);
    expect(s.junctions).toHaveLength(0);
    expect(s.wires).toHaveLength(count);
    expect(pathPoints(wireRoute(s, s.findWire(mid.id)!)!)).toEqual(pathPoints(path));
  });

  it('deleting one half keeps the other wires: the junction merges the rest', () => {
    const { s, r1, r3, mid } = divider();
    connect(s, pin(r3, 'a'), { wireId: mid.id, col: 22, row: 1 }, []);
    const firstHalf = s.findWire(mid.id)!; // r1.b -> junction
    s.removeWire(firstHalf.id);
    expect(s.junctions).toHaveLength(0);
    // r2.a and r3.a are still joined by one wire through the old junction point; r1 is cut off.
    const joined = s.wires.find((w) => [w.from, w.to].some((e) => 'pinId' in e && e.partId === r3.id && e.pinId === 'a'))!;
    expect(joined.waypoints).toContainEqual({ col: 22, row: 1 });
    expect(s.wires.some((w) => [w.from, w.to].some((e) => 'partId' in e && e.partId === r1.id && e.pinId === 'b'))).toBe(false);
  });

  it('deleting a part removes its wires and tidies the junction; deleting everything leaves nothing', () => {
    const { s, r2, r3, mid } = divider();
    connect(s, pin(r3, 'a'), { wireId: mid.id, col: 22, row: 1 }, []);
    s.remove(r2.id);
    expect(s.junctions).toHaveLength(0);
    s.removeMany(s.parts.map((p) => p.id), s.wires.map((w) => w.id));
    expect([s.parts, s.wires, s.junctions]).toEqual([[], [], []]);
  });

  it('starting on a wire and ending on another wire', () => {
    const { s, mid } = divider();
    const other = s.wires.find((w) => w.id !== mid.id && 'pinId' in w.from && w.from.pinId === 'b')!; // r2.b -> ground
    const otherPath = wireRoute(s, other)!;
    const p = otherPath[1];
    const made = connect(s, { wireId: mid.id, col: 25, row: 1 }, { wireId: other.id, col: p.col, row: p.row }, []);
    expect(made).not.toBeNull();
    expect(s.junctions).toHaveLength(2);
    expect(made && [made.from, made.to].every((e) => 'junctionId' in e)).toBe(true);
  });

  it('refuses a wire that only repeats a connection, and undoes the split', () => {
    const { s, r2, mid } = divider();
    const wires = JSON.stringify(s.wires);
    // From a point on `mid` to r2.a, which `mid` already reaches the same way.
    expect(connect(s, { wireId: mid.id, col: 22, row: 1 }, pin(r2, 'a'), [])).toBeNull();
    expect(s.junctions).toHaveLength(0);
    expect(JSON.stringify(s.wires)).toBe(wires);
  });

  it('refuses a wire between two points of one wire (it would repeat that wire)', () => {
    const { s, mid } = divider();
    const wires = JSON.stringify(s.wires);
    expect(connect(s, { wireId: mid.id, col: 18, row: 1 }, { wireId: mid.id, col: 26, row: 1 }, [{ col: 18, row: 4 }])).toBeNull();
    expect(s.junctions).toHaveLength(0);
    expect(JSON.stringify(s.wires)).toBe(wires);
  });

  it('moving, rotating and duplicating a selection takes the junctions only its wires use', () => {
    const { s, r1, r2, r3, mid } = divider();
    connect(s, pin(r3, 'a'), { wireId: mid.id, col: 22, row: 1 }, []);
    const all = new Set([r1.id, r2.id, r3.id]);
    expect(s.within(all).junctions).toHaveLength(1);
    expect(s.within(new Set([r1.id, r2.id])).junctions).toHaveLength(0); // r3's wire leaves the set
    const copy = s.insert(s.snapshot(all), 0, 20);
    expect(copy.junctions).toEqual([{ id: expect.any(Number), col: 22, row: 21 }]);
    expect(copy.wires).toHaveLength(3);
    expect(s.wiresAt(copy.junctions[0].id)).toHaveLength(3);
    s.rotateGroup([r1, r2, r3]);
    expect(s.junctions[0]).not.toMatchObject({ col: 22, row: 1 }); // it turned with the parts
    expect(wireRoute(s, s.wiresAt(s.junctions[0].id)[0])).not.toBeNull();
  });
});
