import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../examples';
import { BLINK_HEX } from '../mcu/programs/blink';
import { projectFromBytes, projectToGth } from './diskfile';
import { DEFAULT_SKETCH } from './filetree';
import { PROJECT_VERSION, stringifyProject } from './format';
import { migrate } from './migrate';
import { MAX_FILE_BYTES, byteLength } from './paths';
import { Project } from './project';
import { readProject } from './read';
import { fromFileMap, toFileMap } from './storage';

const OLD_HEX = ':0400100001020304E2\n:00000001FF\n';

/** A hand-written v3 file: two boards with programs (one already has firmware.hex), one without. */
const V3_FIXTURE = `{
  "format": "gatehouse-project",
  "version": 3,
  "name": "Programs",
  "parts": [
    { "id": 1, "typeId": "uno", "boardId": "uno-1", "col": 0, "row": 0, "rotation": 0,
      "state": { "program": { "name": "Blink", "hex": ${JSON.stringify(BLINK_HEX)} } } },
    { "id": 2, "typeId": "resistor", "col": 0, "row": 20, "rotation": 0, "state": { "value": 220 } },
    { "id": 3, "typeId": "uno", "boardId": "uno-2", "col": 30, "row": 0, "rotation": 0,
      "state": { "program": { "name": "Other", "hex": ${JSON.stringify(OLD_HEX)} } } },
    { "id": 4, "typeId": "uno", "boardId": "uno-3", "col": 60, "row": 0, "rotation": 0 }
  ],
  "wires": [],
  "junctions": [],
  "files": {
    "uno-1": { "files": { "main.ino": ${JSON.stringify(DEFAULT_SKETCH)} }, "folders": [] },
    "uno-2": { "files": { "firmware.hex": "keep me", "main.ino": "" }, "folders": ["lib"] },
    "uno-3": { "files": { "main.ino": "" }, "folders": [] }
  },
  "boardCounters": { "uno": 3 }
}`;

describe('format v4: firmware in the board folder', () => {
  it('migrates v3: each program becomes firmware.hex, the program field goes', () => {
    const v3 = JSON.parse(V3_FIXTURE);
    const out = migrate(v3) as any;
    expect(out.version).toBe(4);
    expect(PROJECT_VERSION).toBe(4);
    expect(out.parts.map((p: any) => p.state)).toEqual([undefined, { value: 220 }, undefined, undefined]);
    expect(out.parts[0]).not.toHaveProperty('state');
    expect(out.files['uno-1'].files).toEqual({ 'main.ino': DEFAULT_SKETCH, 'firmware.hex': BLINK_HEX });
    // An existing firmware.hex is kept; the old program goes next to it.
    expect(out.files['uno-2']).toEqual({ files: { 'firmware.hex': 'keep me', 'main.ino': '', 'firmware-old.hex': OLD_HEX }, folders: ['lib'] });
    expect(out.files['uno-3'].files).toEqual({ 'main.ino': '' });
    expect(v3.parts[0].state.program.name).toBe('Blink'); // the input is not changed

    const p = new Project();
    p.load(readProject(V3_FIXTURE));
    expect(Object.keys(p.scene.files['uno-1'].files)).toEqual(['firmware.hex', 'main.ino']);
    expect(p.serialize().version).toBe(4);
  });

  it('skips an old program identical to the firmware.hex already there', () => {
    const v3 = JSON.parse(V3_FIXTURE);
    v3.files['uno-2'].files['firmware.hex'] = OLD_HEX;
    const out = migrate(v3) as any;
    expect(out.files['uno-2'].files).toEqual({ 'firmware.hex': OLD_HEX, 'main.ino': '' });
  });

  it('the built-in Blink hex is far below the file size limit', () => {
    expect(byteLength(BLINK_HEX)).toBeLessThan(4 * 1024);
    expect(byteLength(BLINK_HEX)).toBeLessThan(MAX_FILE_BYTES);
  });

  it('round-trips v4 with a firmware.hex through JSON and .gth', () => {
    const a = new Project();
    a.scene.insert(EXAMPLES.find((e) => e.name === 'Uno blink')!.state);
    const file = { ...a.serialize(), name: 'Blinky' };
    expect(file.files['uno-1'].files['firmware.hex']).toBe(BLINK_HEX);
    expect(readProject(stringifyProject(file))).toEqual(file);

    const map = toFileMap(file);
    expect(map['boards/uno-1/firmware.hex']).toBe(BLINK_HEX);
    expect(fromFileMap(map)).toEqual(file);
    const read = projectFromBytes('Blinky.gth', projectToGth(file));
    expect(read.file).toEqual(file);
  });

  it('a v3 .gth (program in the manifest) opens as v4', () => {
    const v3 = JSON.parse(V3_FIXTURE);
    // As a v3 app wrote it: manifest with board folders listed, files beside it.
    const map = {
      'gatehouse.json': stringifyProject({ ...v3, files: undefined, boards: Object.entries(v3.files).map(([boardId, t]: [string, any]) => ({ boardId, folders: t.folders })) }),
      ...Object.fromEntries(
        Object.entries(v3.files).flatMap(([id, t]: [string, any]) => Object.entries(t.files).map(([path, text]) => [`boards/${id}/${path}`, text])),
      ),
    } as Record<string, string>;
    const file = fromFileMap(map);
    expect(file.version).toBe(4);
    expect(file.files['uno-1'].files['firmware.hex']).toBe(BLINK_HEX);
    expect(file.parts[0].state).toBeUndefined();
  });
});
