// Mirroring placed parts (PlacedPart.mirrorX / mirrorY): geometry, the
// screen flips of single parts and groups, contacts, undo, duplicate and
// the project file. No DOM.

import { describe, expect, it } from 'vitest';
import { findContacts } from './contacts';
import { isOnKnob } from './controls';
import { canFlip, flipGroup } from './flip';
import {
  Scene, boundsOf, flipOrientation, footprint, isMirrorable, type FlipAxis, type Orientation, type PlacedPart, type Rotation,
} from './model';
import { PARTS, canMirror, getPart } from './parts';
import { pinsOf, rotatePoint, unrotatePoint, wireRoute } from './pins';
import { stringifyProject } from './project/format';
import { History, COALESCE_MS } from './project/history';
import { Project } from './project/project';
import { readProject } from './project/read';

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const MIRRORS = [
  {}, { mirrorX: true }, { mirrorY: true }, { mirrorX: true, mirrorY: true },
] as const;
const ORIENTATIONS: Orientation[] = ROTATIONS.flatMap((rotation) => MIRRORS.map((m) => ({ rotation, ...m })));
const name = (o: Orientation): string => `${o.rotation}${o.mirrorX ? ' mx' : ''}${o.mirrorY ? ' my' : ''}`;

/** Pin positions by pin id, relative to the part's top-left cell. */
function pinMap(p: PlacedPart): Record<string, [number, number]> {
  return Object.fromEntries(pinsOf(p).map((pin) => [pin.ref.pinId, [pin.col - p.col, pin.row - p.row]]));
}

const placed = (typeId: string, o: Orientation, col = 10, row = 20): PlacedPart => ({ id: 1, typeId, col, row, ...o });

describe('mirror geometry (mirror in the part box first, then rotate)', () => {
  it('swaps the legs of an LED and a TO-92 transistor without rotating', () => {
    const led = getPart('led')!;
    const plain = pinMap(placed('led', { rotation: 0 }));
    const flipped = pinMap(placed('led', { rotation: 0, mirrorX: true }));
    expect(flipped.cathode).toEqual([led.cols - plain.cathode[0], plain.cathode[1]]);
    expect(flipped.cathode).toEqual(plain.anode); // the LED is symmetric: the legs trade places
    expect(flipped.anode).toEqual(plain.cathode);

    const bjt = pinMap(placed('bjt', { rotation: 0 }));
    const bjtFlipped = pinMap(placed('bjt', { rotation: 0, mirrorX: true }));
    expect(bjtFlipped.c).toEqual(bjt.e);
    expect(bjtFlipped.e).toEqual(bjt.c);
    expect(bjtFlipped.b).toEqual(bjt.b);
  });

  it('places pins as rotate(mirror(pin)) for all 16 orientations, inside the footprint', () => {
    const nonSquare = ['led', 'resistor', 'nmos', 'button'].filter((id) => getPart(id)!.cols !== getPart(id)!.rows);
    expect(nonSquare.length).toBeGreaterThanOrEqual(2);
    for (const typeId of ['bjt', 'led', 'resistor', 'nmos', 'button']) {
      const type = getPart(typeId)!;
      for (const o of ORIENTATIONS) {
        const p = placed(typeId, o);
        const box = footprint(p);
        // Mirroring never changes the box.
        expect([box.cols, box.rows], `${typeId} ${name(o)}`).toEqual(o.rotation % 180 === 0 ? [type.cols, type.rows] : [type.rows, type.cols]);
        const unmirrored = pinMap(placed(typeId, { rotation: 0 }));
        for (const pin of pinsOf(p)) {
          // Independent of rotatePoint: mirror by hand, then quarter turns clockwise in a box that turns too.
          let [x, y] = unmirrored[pin.ref.pinId];
          let w = type.cols;
          let h = type.rows;
          if (o.mirrorX) x = w - x;
          if (o.mirrorY) y = h - y;
          for (let r = 0; r < o.rotation; r += 90) {
            [x, y] = [h - y, x];
            [w, h] = [h, w];
          }
          expect([pin.col - p.col, pin.row - p.row], `${typeId}.${pin.ref.pinId} ${name(o)}`).toEqual([x, y]);
          expect(pin.col >= box.col && pin.col <= box.col + box.cols && pin.row >= box.row && pin.row <= box.row + box.rows).toBe(true);
          // The lead direction points out of the box at that pin.
          const out = { col: pin.col + pin.dir.col, row: pin.row + pin.dir.row };
          const inside = out.col > box.col && out.col < box.col + box.cols && out.row > box.row && out.row < box.row + box.rows;
          if (pin.dir.col !== 0 || pin.dir.row !== 0) expect(inside, `${typeId}.${pin.ref.pinId} ${name(o)} dir`).toBe(false);
        }
      }
    }
  });

  it('unrotatePoint inverts rotatePoint in every orientation', () => {
    const type = getPart('bjt')!;
    for (const o of ORIENTATIONS) {
      for (const [x, y] of [[0.25, 1.5], [3, 4], [1.75, 0]]) {
        const r = rotatePoint(x, y, type, o);
        const back = unrotatePoint(r.x, r.y, type, o);
        expect(back.x, name(o)).toBeCloseTo(x, 12);
        expect(back.y, name(o)).toBeCloseTo(y, 12);
      }
    }
  });

  it('hit tests the knob of a mirrored potentiometer where it is drawn', () => {
    const type = getPart('pot')!;
    const knob = type.knob!;
    for (const o of ORIENTATIONS) {
      const p = placed('pot', o);
      const at = rotatePoint(knob.x, knob.y, type, o);
      expect(isOnKnob(p, p.col + at.x, p.row + at.y), name(o)).toBe(true);
    }
  });
});

describe('flipOrientation (a flip on screen)', () => {
  it('mirrors every pin across the box centre on screen, and twice is the identity', () => {
    for (const typeId of ['bjt', 'led', 'resistor']) {
      for (const o of ORIENTATIONS) {
        for (const axis of ['h', 'v'] as FlipAxis[]) {
          const before = placed(typeId, o);
          const after = placed(typeId, flipOrientation(o, axis));
          const box = footprint(before);
          expect(footprint(after)).toEqual(box);
          const a = pinMap(before);
          const b = pinMap(after);
          for (const id of Object.keys(a)) {
            const want: [number, number] = axis === 'h' ? [box.cols - a[id][0], a[id][1]] : [a[id][0], box.rows - a[id][1]];
            expect(b[id], `${typeId}.${id} ${name(o)} ${axis}`).toEqual(want);
          }
          expect(pinMap(placed(typeId, flipOrientation(flipOrientation(o, axis), axis)))).toEqual(a);
        }
      }
    }
  });

  it('never stores both mirrors: H then V is a half turn', () => {
    const o = flipOrientation(flipOrientation({ rotation: 90 }, 'h'), 'v');
    expect(o).toEqual({ rotation: 270 });
    for (const start of ORIENTATIONS) {
      for (const axis of ['h', 'v'] as FlipAxis[]) {
        const f = flipOrientation(start, axis);
        expect(f.mirrorX && f.mirrorY).toBeFalsy();
      }
    }
  });
});

/** Pin positions (absolute) by pin id. */
const pinsAt = (p: PlacedPart): Record<string, [number, number]> =>
  Object.fromEntries(pinsOf(p).map((pin) => [pin.ref.pinId, [pin.col, pin.row]]));

/** The derived contact links as a sorted list of "part:pin=part:pin" texts. */
const linkTexts = (s: Scene): string[] =>
  findContacts(s).links.map((pair) => pair.map((t) => `${t.part}:${t.pin}`).sort().join('=')).sort();

describe('which parts are mirrorable', () => {
  it('is data on the part types: the asymmetric parts only, never a board', () => {
    expect(PARTS.filter(canMirror).map((t) => t.id).sort()).toEqual(['battery9v', 'bjt', 'led', 'nmos', 'pmos', 'pnp', 'pot']);
    for (const type of PARTS) if (type.board) expect(canMirror(type), type.id).toBe(false);
    expect(isMirrorable('uno')).toBe(false);
    expect(isMirrorable('resistor')).toBe(false);
  });

  it('a symmetric part mirrored on its own would equal itself or a half turn (pins by link group)', () => {
    for (const type of PARTS.filter((t) => !canMirror(t) && !t.board)) {
      const groups = new Map(type.pins.map((p) => [p.id, type.links?.find((l) => l.includes(p.id))?.[0] ?? p.id]));
      const places = (o: Orientation): string[] =>
        type.pins.map((pin) => {
          const p = rotatePoint(pin.x, pin.y, type, o);
          return `${groups.get(pin.id)}@${p.x},${p.y}`;
        }).sort();
      for (const m of [{ mirrorX: true }, { mirrorY: true }]) {
        const mirrored = places({ rotation: 0, ...m });
        const same = [places({ rotation: 0 }), places({ rotation: 180 })].some((p) => p.join() === mirrored.join());
        expect(same, `${type.id} ${JSON.stringify(m)}`).toBe(true);
      }
    }
  });

  it('the 9 V battery is not symmetric: a mirror puts + below -, which no turn does', () => {
    const type = getPart('battery9v')!;
    const pos = (o: Orientation) => rotatePoint(5, 1, type, o);
    const mirrored = pos({ rotation: 0, mirrorY: true });
    for (const rotation of ROTATIONS) expect(pos({ rotation })).not.toEqual(mirrored);
  });
});

describe('flipGroup', () => {
  it('flips one LED in place and only moves its pins; twice is the identity', () => {
    const s = new Scene();
    const led = s.add({ typeId: 'led', col: 3, row: 4, rotation: 90 });
    const box = footprint(led);
    expect(flipGroup(s, [led], 'h')).toBe(true);
    expect(footprint(led)).toEqual(box);
    expect(led).toMatchObject({ rotation: 90, mirrorY: true });
    expect(flipGroup(s, [led], 'h')).toBe(true);
    expect(led).toEqual({ id: led.id, typeId: 'led', col: 3, row: 4, rotation: 90 }); // no leftover false fields
  });

  it('does nothing for a selection without a mirrorable part', () => {
    const s = new Scene();
    const uno = s.add({ typeId: 'uno', col: 0, row: 0, rotation: 0, mirrorX: true });
    expect(uno.mirrorX).toBeUndefined(); // never stored on a part that cannot be mirrored
    const res = s.add({ typeId: 'resistor', col: 40, row: 0, rotation: 0 });
    const before = s.snapshot();
    expect(canFlip([uno])).toBe(false);
    expect(flipGroup(s, [uno], 'h')).toBe(false);
    expect(flipGroup(s, [res], 'h')).toBe(false);
    expect(flipGroup(s, [uno, res], 'v')).toBe(false);
    expect(s.snapshot()).toEqual(before);
  });

  it('mirrors LED + resistors + junction: every pin lands on its reflected place', () => {
    const s = new Scene();
    const led = s.add({ typeId: 'led', col: 0, row: 0, rotation: 0 });
    const r2 = s.add({ typeId: 'resistor', col: 10, row: 6, rotation: 90 });
    const r3 = s.add({ typeId: 'resistor', col: 0, row: 10, rotation: 0 });
    const j = s.addJunction(6, 5);
    s.addWire({ partId: led.id, pinId: 'anode' }, { junctionId: j.id }, [{ col: 6, row: 4 }]);
    s.addWire({ junctionId: j.id }, { partId: r2.id, pinId: 'a' });
    s.addWire({ junctionId: j.id }, { partId: r3.id, pinId: 'b' });
    const group = [led, r2, r3];
    const before = s.snapshot();
    for (const axis of ['h', 'v'] as FlipAxis[]) {
      const box = boundsOf(group)!;
      expect([box.col, box.row]).toEqual([0, 0]); // so the reflection of c is box.cols - c
      const old = group.map(pinsAt);
      expect(flipGroup(s, group, axis)).toBe(true);
      group.forEach((p, i) => {
        const want = Object.fromEntries(Object.entries(old[i]).map(([id, [c, r]]) => [id, axis === 'h' ? [box.cols - c, r] : [c, box.rows - r]]));
        expect(pinsAt(p), `${p.typeId} ${axis}`).toEqual(want);
      });
      expect(s.findJunction(j.id)).toMatchObject(axis === 'h' ? { col: box.cols - 6, row: 5 } : { col: 6, row: box.rows - 5 });
      expect(flipGroup(s, group, axis)).toBe(true);
      expect(s.snapshot()).toEqual(before);
    }
    // Across the mirror line a resistor turns by 180; along it, it keeps its rotation.
    flipGroup(s, group, 'h');
    expect([r2.rotation, r3.rotation]).toEqual([90, 180]);
    expect(r2.mirrorX ?? r2.mirrorY ?? r3.mirrorX ?? r3.mirrorY).toBeUndefined();
  });

  it('keeps a push button\'s linked pairs on their rows', () => {
    const s = new Scene();
    const led = s.add({ typeId: 'led', col: 10, row: 0, rotation: 0 });
    const button = s.add({ typeId: 'button', col: 0, row: 0, rotation: 0 });
    flipGroup(s, [led, button], 'h');
    expect(button.rotation).toBe(0); // a and a2 trade places: the same metal, the same row
    flipGroup(s, [led, button], 'v');
    expect(button.rotation).toBe(180); // the pairs trade rows
  });

  describe('a mixed selection: LED + resistor + wire between them + a board', () => {
    function mixed() {
      const p = new Project();
      const s = p.scene;
      const res = s.add({ typeId: 'resistor', col: 0, row: 0, rotation: 0 }); // a (0, 1), b (4, 1)
      const anode = pinsOf({ id: 0, typeId: 'led', col: 0, row: 0, rotation: 0 }).find((x) => x.ref.pinId === 'anode')!;
      const led = s.add({ typeId: 'led', col: 4 - anode.col, row: 1 - anode.row, rotation: 0 }); // anode touches res.b
      const uno = s.add({ typeId: 'uno', col: 12, row: 6, rotation: 0 });
      s.addWire({ partId: led.id, pinId: 'cathode' }, { partId: res.id, pinId: 'a' }, [{ col: -2, row: -5 }]);
      s.addWire({ partId: res.id, pinId: 'a' }, { partId: uno.id, pinId: 'gnd' }, [{ col: -1, row: 20 }]);
      return { p, s, res, led, uno, group: [res, led, uno] };
    }

    it('reflects all positions, mirrors only the LED, and keeps connectivity by pin id', () => {
      const { s, res, led, uno, group } = mixed();
      const box = boundsOf(group)!;
      const ref = (c: number): number => 2 * box.col + box.cols - c;
      const links = linkTexts(s);
      expect(links).toContain([`${res.id}:b`, `${led.id}:anode`].sort().join('='));
      const old = { res: pinsAt(res), led: pinsAt(led) };
      const unoBox = footprint(uno);
      expect(canFlip(group)).toBe(true);
      expect(flipGroup(s, group, 'h')).toBe(true);

      expect(led).toMatchObject({ rotation: 0, mirrorX: true });
      expect(res.rotation).toBe(180);
      expect(res.mirrorX ?? res.mirrorY).toBeUndefined();
      expect(uno.rotation).toBe(0);
      expect(uno.mirrorX ?? uno.mirrorY).toBeUndefined();
      expect(footprint(uno)).toEqual({ ...unoBox, col: ref(unoBox.col + unoBox.cols) });
      for (const [p, before] of [[res, old.res], [led, old.led]] as const) {
        expect(pinsAt(p)).toEqual(Object.fromEntries(Object.entries(before).map(([id, [c, r]]) => [id, [ref(c), r]])));
      }
      expect(s.wires.map((w) => w.waypoints)).toEqual([[{ col: ref(-2), row: -5 }], [{ col: ref(-1), row: 20 }]]);
      expect(linkTexts(s)).toEqual(links); // the LED still touches the resistor with its anode
      for (const w of s.wires) expect(wireRoute(s, w)).not.toBeNull();
    });

    it('flipping twice returns every part to its place and orientation', () => {
      const { s, group } = mixed();
      const before = s.snapshot();
      for (const axis of ['h', 'v'] as FlipAxis[]) {
        flipGroup(s, group, axis);
        expect(s.snapshot()).not.toEqual(before);
        flipGroup(s, group, axis);
        expect(s.snapshot()).toEqual(before);
      }
    });

    it('is one undo / redo step', () => {
      const { p, s, group } = mixed();
      const before = p.circuit();
      const h = new History(before);
      flipGroup(s, group, 'v');
      const after = p.circuit();
      expect(h.record(after, 0)).toBe(true);
      expect(h.depth).toBe(1);
      p.restore(h.undo(p.circuit())!);
      expect(p.circuit()).toEqual(before);
      p.restore(h.redo(p.circuit())!);
      expect(p.circuit()).toEqual(after);
    });
  });
});

describe('mirror in the project and duplicate', () => {
  function flippedProject(): { p: Project; led: PlacedPart } {
    const p = new Project();
    const led = p.scene.add({ typeId: 'led', col: 2, row: 3, rotation: 270 });
    p.scene.add({ typeId: 'bjt', col: 10, row: 3, rotation: 0 });
    flipGroup(p.scene, [led], 'v');
    return { p, led };
  }

  it('saves and loads the mirror fields', () => {
    const { p, led } = flippedProject();
    expect(led.mirrorX).toBe(true); // a vertical flip of a quarter-turned part is its local X mirror
    const first = p.serialize();
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
    expect(b.scene.parts[0]).toMatchObject({ rotation: 270, mirrorX: true });
    expect(b.scene.parts[1].mirrorX).toBeUndefined();
  });

  it('validates the fields: booleans only, no unknown keys; false and flags on non-mirrorable parts are dropped', () => {
    const { p } = flippedProject();
    p.scene.add({ typeId: 'uno', col: 0, row: 20, rotation: 0 });
    p.scene.add({ typeId: 'resistor', col: 0, row: 40, rotation: 0 });
    const text = stringifyProject(p.serialize());
    const edited = (change: (doc: { parts: Record<string, unknown>[] }) => void): string => {
      const doc = JSON.parse(text);
      change(doc);
      return JSON.stringify(doc);
    };
    expect(() => readProject(edited((d) => (d.parts[0].mirrorX = 'yes')))).toThrow(/mirrorX must be true or false/);
    expect(() => readProject(edited((d) => (d.parts[3].mirrorY = 1)))).toThrow(/mirrorY must be true or false/);
    expect(() => readProject(edited((d) => (d.parts[0].mirrorZ = true)))).toThrow(/unknown field "mirrorZ"/);
    // An older file may have mirrored a part that can no longer be: it still loads, without the flag.
    const old = readProject(edited((d) => {
      d.parts[1].mirrorY = false;
      d.parts[2].mirrorX = true; // the board
      d.parts[3].mirrorX = true; // the resistor
      d.parts[3].mirrorY = true;
    }));
    expect(old.version).toBe(4);
    expect(old.parts.map((x) => 'mirrorX' in x || 'mirrorY' in x)).toEqual([true, false, false, false]);
    const loaded = new Project();
    loaded.load(old);
    expect(loaded.scene.parts[3]).toEqual({ id: loaded.scene.parts[3].id, typeId: 'resistor', col: 0, row: 40, rotation: 0, state: { value: 220 } });
    // Both at once is a valid (if not canonical) orientation.
    expect(readProject(edited((d) => (d.parts[0].mirrorY = true))).parts[0]).toMatchObject({ mirrorX: true, mirrorY: true });
  });

  it('a later flip is its own undo step', () => {
    const p = new Project();
    const led = p.scene.add({ typeId: 'led', col: 2, row: 3, rotation: 0 });
    const h = new History(p.circuit());
    flipGroup(p.scene, [led], 'h');
    expect(h.record(p.circuit(), 0)).toBe(true);
    flipGroup(p.scene, [led], 'v');
    expect(h.record(p.circuit(), COALESCE_MS * 10)).toBe(true);
    expect(h.depth).toBe(2);
    p.restore(h.undo(p.circuit())!);
    expect(p.scene.parts[0]).toMatchObject({ rotation: 0, mirrorX: true });
  });

  it('duplicates keep the mirror', () => {
    const { p, led } = flippedProject();
    const copy = p.scene.insert(p.scene.snapshot(new Set([led.id])), 1, 1);
    expect(copy.parts[0]).toMatchObject({ typeId: 'led', col: led.col + 1, row: led.row + 1, rotation: 270, mirrorX: true });
  });

  it('a flipped LED touches with its other leg when only the LED flips', () => {
    const s = new Scene();
    const res = s.add({ typeId: 'resistor', col: 0, row: 0, rotation: 0 });
    const anode = pinsOf({ id: 0, typeId: 'led', col: 0, row: 0, rotation: 0 }).find((x) => x.ref.pinId === 'anode')!;
    const led = s.add({ typeId: 'led', col: 4 - anode.col, row: 1 - anode.row, rotation: 0 });
    const touching = (pin: string) => linkTexts(s).includes([`${res.id}:b`, `${led.id}:${pin}`].sort().join('='));
    expect(touching('anode')).toBe(true);
    flipGroup(s, [led], 'h');
    expect(touching('anode')).toBe(false);
    expect(touching('cathode')).toBe(true);
  });
});
