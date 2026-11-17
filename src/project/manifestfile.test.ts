import { describe, expect, it } from 'vitest';
import { createBoardFile } from './boardfiles';
import { manifestText } from './manifestfile';
import { Project } from './project';
import { toFileMap } from './storage';

describe('manifestText (the generated gatehouse.json)', () => {
  it('is exactly the text Save writes for gatehouse.json, pretty printed', () => {
    const p = new Project();
    const board = p.scene.add({ typeId: 'uno', col: 0, row: 0, rotation: 0 });
    createBoardFile(p, board.boardId!, 'lib/led.h', 'x');
    const text = manifestText(p);
    expect(text).toBe(toFileMap(p.serialize())['gatehouse.json']);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "format": "gatehouse-project"');
    expect(JSON.parse(text).boards).toEqual([{ boardId: 'uno-1', folders: [] }]);
    expect(JSON.parse(text).files).toBeUndefined(); // source files live in boards/, not here
  });

  it('follows the circuit', () => {
    const p = new Project();
    const before = manifestText(p);
    p.scene.add({ typeId: 'resistor', col: 0, row: 0, rotation: 0 });
    p.checkForChanges();
    expect(manifestText(p)).not.toBe(before);
    expect(JSON.parse(manifestText(p)).parts).toHaveLength(1);
  });
});
