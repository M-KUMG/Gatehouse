import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../examples';
import { BLINK_HEX } from '../mcu/programs/blink';
import { connect } from '../junctions';
import { PROJECT_VERSION, ProjectError, stringifyProject } from './format';
import { migrate, type Migration } from './migrate';
import { Project } from './project';
import { readProject } from './read';

/** A hand-written v1 file, as it would be on disk. */
const V1_FIXTURE = `{
  "format": "gatehouse-project",
  "version": 1,
  "name": "Fixture",
  "savedAt": "2026-11-17T12:00:00.000Z",
  "camera": { "x": -40, "y": 20, "zoom": 1.5 },
  "parts": [
    { "id": 1, "typeId": "battery9v", "col": 0, "row": 2, "rotation": 0 },
    { "id": 2, "typeId": "switch", "col": 7, "row": 2, "rotation": 0, "state": { "closed": true } },
    { "id": 3, "typeId": "resistor", "col": 13, "row": 2, "rotation": 0, "state": { "value": 330 } },
    { "id": 4, "typeId": "led", "col": 18, "row": 3, "rotation": 180 },
    { "id": 5, "typeId": "pot", "col": 2, "row": 8, "rotation": 90, "state": { "value": 10000, "position": 0.25 } }
  ],
  "wires": [
    { "id": 11, "from": { "partId": 1, "pinId": "pos" }, "to": { "partId": 2, "pinId": "a" }, "waypoints": [] },
    { "id": 12, "from": { "partId": 2, "pinId": "b" }, "to": { "partId": 3, "pinId": "a" }, "waypoints": [{ "col": 10, "row": 0 }] },
    { "id": 13, "from": { "partId": 3, "pinId": "b" }, "to": { "partId": 4, "pinId": "anode" }, "waypoints": [] }
  ]
}`;

/** The fixture as an object, changed by `edit`, back to text. */
function variant(edit: (doc: any) => void): string {
  const doc = JSON.parse(V1_FIXTURE);
  edit(doc);
  return JSON.stringify(doc);
}

function errorOf(text: string): string {
  try {
    readProject(text);
  } catch (e) {
    expect(e).toBeInstanceOf(ProjectError);
    return (e as Error).message;
  }
  throw new Error('expected the file to be rejected');
}

describe('project files', () => {
  it('round-trips: serialize -> load -> serialize is unchanged', () => {
    const a = new Project();
    a.scene.insert(EXAMPLES[1].state, 3, -2);
    a.camera.x = 12.5;
    a.camera.zoom = 2;
    const first = a.serialize();
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
    expect(stringifyProject(b.serialize())).toBe(stringifyProject(first));
  });

  it('loads a hand-written v1 file', () => {
    const p = new Project();
    p.load(readProject(V1_FIXTURE));
    expect(p.name).toBe('Fixture');
    expect(p.camera).toEqual({ x: -40, y: 20, zoom: 1.5 });
    expect(p.scene.parts.map((x) => x.typeId)).toEqual(['battery9v', 'switch', 'resistor', 'led', 'pot']);
    expect(p.scene.find(5)?.state).toEqual({ value: 10000, position: 0.25 });
    expect(p.scene.findWire(12)?.waypoints).toEqual([{ col: 10, row: 0 }]);
    expect(p.dirty).toBe(false);
    // New ids continue after the loaded ones.
    expect(p.scene.add({ typeId: 'ground', col: 0, row: 0, rotation: 0 }).id).toBe(14);
  });

  it('serializes only source data', () => {
    const p = new Project();
    p.load(readProject(V1_FIXTURE));
    const file = p.serialize();
    expect(Object.keys(file)).toEqual(['format', 'version', 'name', 'camera', 'parts', 'wires', 'junctions', 'files', 'boardCounters']);
    expect(Object.keys(file.wires[0])).toEqual(['id', 'from', 'to', 'waypoints']);
  });

  it('rejects files from a newer version with a clear message', () => {
    expect(errorOf(variant((d) => (d.version = PROJECT_VERSION + 1)))).toMatch(/newer version.*v5.*up to v4/);
  });

  it('rejects things that are not project files', () => {
    expect(errorOf('not json {')).toMatch(/not a Gatehouse project file.*not valid JSON/);
    expect(errorOf('[1, 2]')).toMatch(/not a Gatehouse project file/);
    expect(errorOf('{"parts": []}')).toMatch(/not a Gatehouse project file/);
    expect(errorOf('null')).toMatch(/not a Gatehouse project file/);
  });

  it('rejects missing and wrong fields', () => {
    expect(errorOf(variant((d) => delete d.parts))).toMatch(/parts must be a list/);
    expect(errorOf(variant((d) => delete d.name))).toMatch(/name must be text/);
    expect(errorOf(variant((d) => (d.parts[1].col = 'seven')))).toMatch(/parts\[1\]\.col must be a number/);
    expect(errorOf(variant((d) => (d.parts[1].row = 1.5)))).toMatch(/parts\[1\]\.row must be a whole number/);
    expect(errorOf(variant((d) => (d.parts[0].rotation = 45)))).toMatch(/rotation must be 0, 90, 180 or 270/);
    expect(errorOf(variant((d) => (d.parts[4].state.position = 2)))).toMatch(/position must be between 0 and 1/);
    expect(errorOf(variant((d) => (d.parts[2].state.color = 'red')))).toMatch(/unknown field "color"/);
    expect(errorOf(variant((d) => (d.parts[1].id = 1)))).toMatch(/id 1 is used more than once/);
    expect(errorOf(variant((d) => delete d.version))).toMatch(/no valid "version"/);
    expect(errorOf(variant((d) => (d.camera.zoom = 0)))).toMatch(/camera\.zoom/);
  });

  it('rejects unknown part types', () => {
    expect(errorOf(variant((d) => (d.parts[3].typeId = 'flux-capacitor')))).toMatch(
      /parts\[3\] uses an unknown part type "flux-capacitor"/,
    );
  });

  it('rejects dangling wire ends', () => {
    expect(errorOf(variant((d) => (d.wires[2].to.partId = 99)))).toMatch(/wires\[2\]\.to .*part 99, which is not in the project/);
    expect(errorOf(variant((d) => (d.wires[0].from.pinId = 'middle')))).toMatch(/pin "middle"/);
    expect(errorOf(variant((d) => d.parts.splice(3, 1)))).toMatch(/part 4, which is not in the project/);
  });

  it('a rejected file leaves the current project untouched', () => {
    const p = new Project();
    p.load(readProject(V1_FIXTURE));
    const before = p.serialize();
    expect(() => p.load(readProject(variant((d) => (d.wires[0].to.partId = 42))))).toThrow(ProjectError);
    expect(p.serialize()).toEqual(before);
  });

  it('round-trips a project with an Arduino Uno and its firmware file', () => {
    const a = new Project();
    a.scene.insert(EXAMPLES.find((e) => e.name === 'Uno blink')!.state, 2, 3);
    const text = stringifyProject(a.serialize());
    const b = new Project();
    b.load(readProject(text));
    expect(b.serialize()).toEqual(a.serialize());
    const uno = b.scene.parts.find((p) => p.typeId === 'uno')!;
    expect(uno.state).toBeUndefined(); // nothing about the program or running
    expect(b.scene.files[uno.boardId!].files['firmware.hex']).toBe(BLINK_HEX);
    expect(Object.keys(b.scene.files[uno.boardId!].files)).toEqual(['firmware.hex', 'main.ino']);
    expect(b.scene.wires.some((w) => [w.from, w.to].some((e) => 'pinId' in e && e.pinId === 'd13'))).toBe(true);
  });

  it('an old board program becomes firmware.hex; v4 parts may not hold one', () => {
    const hex = ':0400100001020304E3\n:00000001FF\n'; // not even valid: in v4 it is just a text file
    const old = variant((d) => d.parts.push({ id: 40, typeId: 'uno', col: 0, row: 20, rotation: 0, state: { program: { name: 'B', hex } } }));
    const p = new Project();
    p.load(readProject(old));
    expect(p.scene.find(40)?.state).toBeUndefined();
    expect(p.scene.files['uno-1'].files['firmware.hex']).toBe(hex);
    const v4 = JSON.parse(stringifyProject(p.serialize()));
    v4.parts.find((x: any) => x.id === 40).state = { program: { name: 'B', hex } };
    expect(errorOf(JSON.stringify(v4))).toMatch(/parts\[5\]\.state has an unknown field "program"/);
  });

  it('tracks unsaved changes', () => {
    const p = new Project();
    let changes = 0;
    p.onChange(() => changes++);
    p.load(readProject(V1_FIXTURE));
    expect(p.dirty).toBe(false);
    p.scene.parts[0].col += 1;
    p.checkForChanges();
    expect(p.dirty).toBe(true);
    p.camera.x += 100; // moving the view is not an edit
    p.checkForChanges();
    p.markSaved('Renamed');
    expect(p.dirty).toBe(false);
    expect(p.name).toBe('Renamed');
    expect(changes).toBe(3);
    p.load(readProject(V1_FIXTURE), true);
    expect(p.dirty).toBe(true);
  });
});

describe('migrations', () => {
  // A pretend old format: v0 called the parts "components" and had no wires.
  const v0to1: Migration = {
    from: 0,
    up: (doc) => {
      const { components, ...rest } = doc;
      return { ...rest, parts: components, wires: [] };
    },
  };

  it('runs the steps from the file version up to the current one', () => {
    const old = { format: 'gatehouse-project', version: 0, name: 'Old', components: [] };
    expect(migrate(old, 1, [v0to1])).toEqual({ format: 'gatehouse-project', version: 1, name: 'Old', parts: [], wires: [] });
    expect(old.version).toBe(0); // the input is not changed
  });

  it('chains several steps', () => {
    const v1to2: Migration = { from: 1, up: (doc) => ({ ...doc, boards: [] }) };
    const out = migrate({ version: 0, components: [] }, 2, [v0to1, v1to2]);
    expect(out).toEqual({ version: 2, parts: [], wires: [], boards: [] });
  });

  it('rejects versions it cannot upgrade', () => {
    expect(() => migrate({ version: 0 }, 1, [])).toThrow(/too old or unknown/);
    expect(() => migrate({ version: 3 }, 2, [v0to1])).toThrow(/newer version/);
  });

  it('leaves current files alone', () => {
    const doc = { ...JSON.parse(V1_FIXTURE), version: PROJECT_VERSION, junctions: [] };
    expect(migrate(doc)).toEqual(doc);
  });

  it('upgrades a v1 file (no boards) by adding an empty junction list and no board files', () => {
    const v1 = JSON.parse(V1_FIXTURE);
    const out = migrate(v1);
    expect(out).toEqual({ ...v1, version: PROJECT_VERSION, junctions: [], files: {}, boardCounters: {} });
    expect(v1.version).toBe(1);
    // The loaded v1 file saves as the current version with the same parts and wires.
    const p = new Project();
    p.load(readProject(V1_FIXTURE));
    const file = p.serialize();
    expect(file.version).toBe(PROJECT_VERSION);
    expect(file.junctions).toEqual([]);
    expect(file.wires).toEqual(v1.wires);
    expect(file.parts).toEqual(v1.parts);
  });
});

describe('junctions in project files (v2)', () => {
  /** A project with a resistor divider tapped in the middle of a wire: one junction. */
  function tapped(): Project {
    const p = new Project();
    const s = p.scene;
    const r1 = s.add({ typeId: 'resistor', col: 0, row: 0, rotation: 0 });
    const r2 = s.add({ typeId: 'resistor', col: 10, row: 0, rotation: 0 });
    const r3 = s.add({ typeId: 'resistor', col: 4, row: 6, rotation: 90 });
    const w = s.addWire({ partId: r1.id, pinId: 'b' }, { partId: r2.id, pinId: 'a' })!;
    // r3 (rotated) has pin a at its top; join it to the middle of w at (7, 1).
    expect(connect(s, { wireId: w.id, col: 7, row: 1 }, { partId: r3.id, pinId: 'a' }, [])).not.toBeNull();
    expect(s.junctions).toHaveLength(1);
    return p;
  }

  it('round-trips: serialize -> load -> serialize is unchanged', () => {
    const a = tapped();
    const first = a.serialize();
    expect(first.junctions).toEqual([{ id: a.scene.junctions[0].id, col: 7, row: 1 }]);
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
    expect(stringifyProject(b.serialize())).toBe(stringifyProject(first));
  });

  /** The tapped project as a document, changed by `edit`, back to text. */
  const edited = (edit: (doc: any) => void): string => {
    const doc = JSON.parse(stringifyProject(tapped().serialize()));
    edit(doc);
    return JSON.stringify(doc);
  };

  it('rejects dangling junction references', () => {
    expect(errorOf(edited((d) => (d.wires[0].to = { junctionId: 999 })))).toMatch(
      /wires\[0\]\.to is connected to junction 999, which is not in the project/,
    );
    expect(errorOf(edited((d) => (d.junctions = [])))).toMatch(/junction \d+, which is not in the project/);
    expect(errorOf(edited((d) => (d.wires[0].to = { junctionId: 'x' })))).toMatch(/junctionId must be a number/);
  });

  it('rejects junctions with too few wires, duplicates and loops', () => {
    expect(errorOf(edited((d) => d.wires.pop()))).toMatch(/junctions\[0\] \(id \d+\) has 2 wires; a junction joins 3 or more/);
    expect(errorOf(edited((d) => d.junctions.push({ ...d.junctions[0], id: 500 })))).toMatch(
      /junctions\[1\] is at the same point \(7,1\) as junctions\[0\]/,
    );
    expect(errorOf(edited((d) => (d.junctions[0].id = d.parts[0].id)))).toMatch(/is used more than once/);
    expect(errorOf(edited((d) => d.wires.push({ ...d.wires[2], id: 600 })))).toMatch(/duplicates another wire between the same two ends/);
    expect(errorOf(edited((d) => (d.wires[0].from = d.wires[0].to)))).toMatch(/connects a junction to itself/);
    expect(errorOf(edited((d) => (d.junctions[0].extra = 1)))).toMatch(/junctions\[0\] has an unknown field "extra"/);
  });

  it('a rejected v2 file leaves the current project untouched', () => {
    const p = tapped();
    const before = p.serialize();
    expect(() => p.load(readProject(edited((d) => (d.wires[1].from = { junctionId: 42 }))))).toThrow(ProjectError);
    expect(p.serialize()).toEqual(before);
  });
});
