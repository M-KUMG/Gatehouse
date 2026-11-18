import { describe, expect, it } from 'vitest';
import {
  ActiveBoard, boardsInOrder, isOnReset, pickActiveBoard, runButtonView, selectedBoard, toolbarButtons,
} from './boardcontrols';
import type { BoardRunState } from './mcu/runtime';
import type { PlacedPart, Rotation } from './model';
import { getPart } from './parts';
import { rotatePoint } from './pins';

const idle: BoardRunState = { state: 'stopped', time: 0, speed: 0, firmwareName: null, messages: [], building: false };
const stateOf = (s: Partial<BoardRunState> = {}) => () => ({ ...idle, ...s });

const part = (id: number, typeId: string, extra: Partial<PlacedPart> = {}): PlacedPart => ({ id, typeId, col: 10, row: 20, rotation: 0, ...extra });
const uno = (id: number, boardId: string, extra: Partial<PlacedPart> = {}) => part(id, 'uno', { boardId, ...extra });

describe('which toolbar buttons show', () => {
  it('nothing selected: no buttons to speak of, no board buttons', () => {
    expect(toolbarButtons([], stateOf())).toEqual({ rotate: false, duplicate: false, edit: false, board: null });
  });

  it('a resistor: rotate, duplicate and edit, no board buttons', () => {
    expect(toolbarButtons([part(1, 'resistor')], stateOf())).toMatchObject({ rotate: true, duplicate: true, edit: true, board: null });
  });

  it('one board: rotate and duplicate plus the board buttons, no value to edit', () => {
    const b = toolbarButtons([uno(2, 'uno-1')], stateOf());
    expect(b).toMatchObject({ rotate: true, duplicate: true, edit: false });
    expect(b.board?.run).toMatchObject({ icon: 'run', title: 'Run', disabled: false, error: false });
    expect(b.board?.build).toEqual({ title: 'Build (compile only)', disabled: false, error: false });
    expect(b.board?.reset).toEqual({ title: 'Reset (rebuild from files)', disabled: false });
    expect(b.board?.console).toEqual({ title: 'Open serial console', disabled: false });
    expect(b.board?.rename).toEqual({ title: 'Rename board (display name only)', disabled: false });
  });

  it('one board among other parts still gets them; two boards do not', () => {
    expect(toolbarButtons([uno(2, 'uno-1'), part(3, 'resistor')], stateOf()).board).not.toBeNull();
    expect(toolbarButtons([uno(2, 'uno-1'), uno(4, 'uno-2')], stateOf())).toMatchObject({ rotate: true, duplicate: true, board: null });
  });

  it('asks the state of the selected board only', () => {
    const asked: number[] = [];
    toolbarButtons([part(1, 'resistor'), uno(7, 'uno-3')], (id) => (asked.push(id), idle));
    expect(asked).toEqual([7]);
  });

  it('selectedBoard is the single board or null', () => {
    expect(selectedBoard([uno(2, 'uno-1')])?.id).toBe(2);
    expect(selectedBoard([part(1, 'led')])).toBeNull();
    expect(selectedBoard([uno(2, 'uno-1'), uno(3, 'uno-2')])).toBeNull();
  });
});

describe('the Run button follows the board state', () => {
  const view = (s: Partial<BoardRunState>) => runButtonView({ ...idle, ...s });

  it('stopped and paused offer Run, running offers Pause', () => {
    expect(view({})).toEqual({ icon: 'run', title: 'Run', disabled: false, error: false });
    expect(view({ state: 'paused' })).toMatchObject({ icon: 'run', title: 'Run (continue)' });
    expect(view({ state: 'running' })).toEqual({ icon: 'pause', title: 'Pause', disabled: false, error: false });
  });

  it('is disabled while building, and so is Reset', () => {
    expect(view({ building: true })).toMatchObject({ disabled: true, title: 'Building…' });
    expect(toolbarButtons([uno(2, 'uno-1')], stateOf({ building: true })).board?.reset.disabled).toBe(true);
  });

  it('the Build button is disabled while building and carries the red marker after a failed build', () => {
    const build = (s: Partial<BoardRunState>, failed = false) => toolbarButtons([uno(2, 'uno-1')], stateOf(s), () => failed).board?.build;
    expect(build({ building: true })).toEqual({ title: 'Building…', disabled: true, error: false });
    expect(build({}, true)).toEqual({ title: 'Build (compile only)', disabled: false, error: true });
    expect(build({ building: true }, true)?.error).toBe(false);
    expect(build({})?.error).toBe(false);
  });

  it('asks the build log about the selected board only', () => {
    const asked: number[] = [];
    toolbarButtons([part(1, 'resistor'), uno(7, 'uno-3')], () => idle, (id) => (asked.push(id), false));
    expect(asked).toEqual([7]);
  });

  it('after an error it carries the red marker and the error in its tooltip', () => {
    const v = view({ state: 'error', error: 'No firmware: import a .hex into the board folder' });
    expect(v.error).toBe(true);
    expect(v.disabled).toBe(false);
    expect(v.icon).toBe('run');
    expect(v.title).toContain('No firmware: import a .hex into the board folder');
  });
});

describe('the reset button on the board', () => {
  const type = getPart('uno')!;
  const box = type.resetButton!;
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const rotations: Rotation[] = [0, 90, 180, 270];
  /** Where a point of the unrotated board is on the grid for a part. */
  const at = (p: PlacedPart, x: number, y: number) => {
    const r = rotatePoint(x, y, type, p.rotation);
    return { col: p.col + r.x, row: p.row + r.y };
  };

  it('is data on the board type, inside the board, away from the pins', () => {
    expect(box.w).toBeGreaterThan(0.5);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y + box.h).toBeLessThan(type.rows);
    expect(getPart('resistor')?.resetButton).toBeUndefined();
    const pinNear = type.pins.some((pin) => pin.x >= box.x && pin.x <= box.x + box.w && pin.y >= box.y && pin.y <= box.y + box.h);
    expect(pinNear).toBe(false);
  });

  it.each(rotations)('hits its centre and corners and misses just outside at rotation %i', (rotation) => {
    const p = uno(5, 'uno-1', { rotation });
    const c = at(p, centre.x, centre.y);
    expect(isOnReset(p, c.col, c.row)).toBe(true);
    for (const [x, y] of [[box.x + 0.05, box.y + 0.05], [box.x + box.w - 0.05, box.y + box.h - 0.05]]) {
      const q = at(p, x, y);
      expect(isOnReset(p, q.col, q.row)).toBe(true);
    }
    for (const [x, y] of [[box.x - 0.2, centre.y], [box.x + box.w + 0.2, centre.y], [centre.x, box.y - 0.2], [centre.x, box.y + box.h + 0.2]]) {
      const q = at(p, x, y);
      expect(isOnReset(p, q.col, q.row)).toBe(false);
    }
  });

  it('is not where the unrotated button would be once the board is turned', () => {
    const p = uno(5, 'uno-1', { rotation: 90 });
    expect(isOnReset(p, p.col + centre.x, p.row + centre.y)).toBe(false);
  });

  it('other parts have none', () => {
    expect(isOnReset(part(1, 'switch'), 11, 21)).toBe(false);
  });
});

describe('the active board', () => {
  it('is the selected board, else the last one that still exists, else the first', () => {
    expect(pickActiveBoard([4, 9], 9, 4)).toBe(9);
    expect(pickActiveBoard([4, 9], null, 9)).toBe(9);
    expect(pickActiveBoard([4, 9], null, 77)).toBe(4);
    expect(pickActiveBoard([4, 9], 77, null)).toBe(4);
    expect(pickActiveBoard([], 4, 9)).toBeNull();
  });

  it('boards come in natural boardId order whatever the draw order', () => {
    const parts = [uno(8, 'uno-10'), part(1, 'resistor'), uno(5, 'uno-2'), uno(6, 'uno-1')];
    expect(boardsInOrder(parts).map((p) => p.boardId)).toEqual(['uno-1', 'uno-2', 'uno-10']);
  });

  it('is remembered when the selection is not a board, and falls back to the first board in order', () => {
    let selected = new Set<number>();
    const parts = [uno(8, 'uno-2'), uno(5, 'uno-1'), part(1, 'resistor')];
    const active = new ActiveBoard(() => parts, () => selected);
    active.update();
    expect(active.partId).toBe(5); // uno-1 is first in order
    selected = new Set([8]);
    active.update();
    expect(active.partId).toBe(8);
    selected = new Set([1]);
    active.update();
    expect(active.partId).toBe(8);
    parts.splice(0, 1); // the board is deleted
    active.update();
    expect(active.partId).toBe(5);
  });
});
