import { describe, expect, it } from 'vitest';
import { clickPart, setKnob } from '../controls';
import { connect } from '../junctions';
import type { Circuit } from './format';
import { COALESCE_MS, History, copyCircuit, editKey } from './history';
import { Project } from './project';
import { UndoManager } from './undo';

const EMPTY: Circuit = { parts: [], wires: [], junctions: [], files: {} };

/** A circuit with one resistor at (col, 0). */
function resistorAt(col: number): Circuit {
  return { parts: [{ id: 1, typeId: 'resistor', col, row: 0, rotation: 0, state: { value: 220 } }], wires: [], junctions: [], files: {} };
}

/** Far enough apart that nothing is coalesced. */
const LATER = COALESCE_MS * 10;

describe('History', () => {
  it('pushes, undoes and redoes', () => {
    const h = new History(EMPTY);
    expect(h.canUndo).toBe(false);
    expect(h.record(resistorAt(0), 0)).toBe(true);
    expect(h.record(resistorAt(5), LATER)).toBe(true);
    expect(h.depth).toBe(2);
    expect(h.undo(resistorAt(5))).toEqual(resistorAt(0));
    expect(h.undo(resistorAt(0))).toEqual(EMPTY);
    expect(h.undo(EMPTY)).toBeNull();
    expect(h.canRedo).toBe(true);
    expect(h.redo(EMPTY)).toEqual(resistorAt(0));
    expect(h.redo(resistorAt(0))).toEqual(resistorAt(5));
    expect(h.redo(resistorAt(5))).toBeNull();
  });

  it('records no step for an identical circuit', () => {
    const h = new History(resistorAt(0));
    expect(h.record(resistorAt(0), 0)).toBe(false);
    expect(h.canUndo).toBe(false);
  });

  it('clears redo on a new edit', () => {
    const h = new History(EMPTY);
    h.record(resistorAt(0), 0);
    h.record(resistorAt(5), LATER);
    h.undo(resistorAt(5));
    expect(h.canRedo).toBe(true);
    h.record(resistorAt(9), 2 * LATER);
    expect(h.canRedo).toBe(false);
    expect(h.undo(resistorAt(9))).toEqual(resistorAt(0));
  });

  it('keeps at most `limit` steps', () => {
    const h = new History(EMPTY, 3);
    for (let i = 1; i <= 5; i++) h.record(resistorAt(i), i * LATER);
    expect(h.depth).toBe(3);
    expect(h.undo(resistorAt(5))).toEqual(resistorAt(4));
    expect(h.undo(resistorAt(4))).toEqual(resistorAt(3));
    expect(h.undo(resistorAt(3))).toEqual(resistorAt(2));
    expect(h.undo(resistorAt(2))).toBeNull();
  });

  it('keeps snapshots independent of later changes', () => {
    const circuit = resistorAt(0);
    const h = new History(EMPTY);
    h.record(circuit, 0);
    circuit.parts[0].col = 99; // the caller changes its object afterwards
    circuit.parts[0].state!.value = 1;
    h.record(resistorAt(5), LATER);
    const back = h.undo(resistorAt(5))!;
    expect(back).toEqual(resistorAt(0));
    back.parts[0].col = 42; // changing what undo returned does not change the history
    expect(h.redo(resistorAt(0))).toEqual(resistorAt(5));
    expect(h.undo(resistorAt(5))).toEqual(resistorAt(0));
  });

  it('coalesces quick repeats of the same edit, not different ones', () => {
    const h = new History(EMPTY);
    h.record(resistorAt(0), 0); // place
    h.record(resistorAt(1), LATER); // nudged three times in quick succession: one step
    h.record(resistorAt(2), LATER + 100);
    h.record(resistorAt(3), LATER + 200);
    expect(h.depth).toBe(2);
    expect(h.undo(resistorAt(3))).toEqual(resistorAt(0));
    // A quick change of a different kind (here: a part added) is its own step.
    const h2 = new History(EMPTY);
    h2.record(resistorAt(0), 0);
    h2.record(resistorAt(1), LATER);
    const two = resistorAt(1);
    two.parts.push({ id: 2, typeId: 'led', col: 5, row: 5, rotation: 0 });
    h2.record(two, LATER + 50);
    expect(h2.depth).toBe(3);
  });

  it('drops a coalesced step that ends where it started', () => {
    const h = new History(EMPTY);
    h.record(resistorAt(0), 0);
    h.record(resistorAt(1), LATER);
    h.record(resistorAt(0), LATER + 100); // and back again
    expect(h.depth).toBe(1);
  });

  it('ignores live interaction state but keeps it across undo', () => {
    const on = resistorAt(0);
    on.parts.push({ id: 2, typeId: 'switch', col: 4, row: 0, rotation: 0, state: { closed: true } });
    const off = copyCircuit(on);
    off.parts[1].state = { closed: false };
    expect(editKey(on)).toBe(editKey(off));
    const h = new History(off);
    expect(h.record(on, 0)).toBe(false); // flipping a switch is not a step
    const moved = copyCircuit(on);
    moved.parts[0].col = 7;
    h.record(moved, LATER);
    // Undo the move: the switch stays where it is now (closed).
    expect(h.undo(moved)).toEqual(on);
  });
});

/** A project with undo and stub editor hooks; `busy` stands for a gesture in progress. */
function setup(): { p: Project; undo: UndoManager; gesture: { busy: boolean }; tick: () => void } {
  const p = new Project();
  const gesture = { busy: false };
  let time = 0;
  const undo = new UndoManager(
    p,
    { busy: () => gesture.busy, beforeRestore: () => undefined, afterRestore: () => undefined },
    () => time,
  );
  // One frame: the project notices changes, then the history settles. Edits are far apart in time.
  const tick = (): void => {
    time += LATER;
    p.checkForChanges();
    undo.settle();
  };
  return { p, undo, gesture, tick };
}

describe('UndoManager with a project', () => {
  it('place -> move -> delete -> undo x3 -> redo x2', () => {
    const { p, undo, tick } = setup();
    const s = p.scene;
    const empty = p.circuit();
    s.add({ typeId: 'resistor', col: 2, row: 3, rotation: 0 }); // place
    tick();
    const placed = p.circuit();
    s.parts[0].col = 6; // move
    tick();
    const moved = p.circuit();
    s.removeMany([s.parts[0].id], []); // delete
    tick();
    expect(p.circuit()).toEqual(empty);

    expect(undo.undo()).toBe(true);
    expect(p.circuit()).toEqual(moved);
    expect(undo.undo()).toBe(true);
    expect(p.circuit()).toEqual(placed);
    expect(undo.undo()).toBe(true);
    expect(p.circuit()).toEqual(empty);
    expect(undo.undo()).toBe(false);

    expect(undo.redo()).toBe(true);
    expect(p.circuit()).toEqual(placed);
    expect(undo.redo()).toBe(true);
    expect(p.circuit()).toEqual(moved);
    expect(undo.canRedo).toBe(true);
    expect(s.parts[0]).toEqual({ id: 1, typeId: 'resistor', col: 6, row: 3, rotation: 0, state: { value: 220 } });
  });

  it('a drag is one step, recorded only when it ends', () => {
    const { p, undo, gesture, tick } = setup();
    const r = p.scene.add({ typeId: 'resistor', col: 0, row: 0, rotation: 0 });
    tick();
    gesture.busy = true;
    for (let col = 1; col <= 5; col++) {
      r.col = col; // many pointer moves, one frame each
      tick();
    }
    expect(undo.canUndo).toBe(true);
    gesture.busy = false;
    tick();
    undo.undo();
    expect(p.scene.parts[0].col).toBe(0);
    undo.undo();
    expect(p.scene.parts).toEqual([]);
  });

  it('a wire with a junction is one step, and undo removes both', () => {
    const { p, undo, tick } = setup();
    const s = p.scene;
    const r1 = s.add({ typeId: 'resistor', col: 0, row: 0, rotation: 0 });
    const r2 = s.add({ typeId: 'resistor', col: 10, row: 0, rotation: 0 });
    const r3 = s.add({ typeId: 'resistor', col: 4, row: 6, rotation: 90 });
    tick();
    const w = s.addWire({ partId: r1.id, pinId: 'b' }, { partId: r2.id, pinId: 'a' })!;
    tick();
    const oneWire = p.circuit();
    connect(s, { wireId: w.id, col: 7, row: 1 }, { partId: r3.id, pinId: 'a' }, []);
    tick();
    expect(s.junctions).toHaveLength(1);
    undo.undo();
    expect(p.circuit()).toEqual(oneWire);
    undo.redo();
    expect(s.junctions).toHaveLength(1);
    expect(s.wires).toHaveLength(3);
  });

  it('switch toggles and knob turns create no steps and are not undone', () => {
    const { p, undo, tick } = setup();
    const sw = p.scene.add({ typeId: 'switch', col: 0, row: 0, rotation: 0 });
    const pot = p.scene.add({ typeId: 'pot', col: 0, row: 6, rotation: 0 });
    tick();
    const placedSteps = undo.canUndo;
    clickPart(sw);
    setKnob(pot, 0.9);
    tick();
    expect(placedSteps).toBe(true);
    // Undo goes straight to before the placement, not to "switch open".
    undo.undo();
    expect(p.scene.parts).toEqual([]);
    undo.redo();
    expect(p.scene.find(sw.id)?.state?.closed).toBe(true);
    // Move, toggle back, undo the move: the switch stays as it is now.
    p.scene.find(pot.id)!.col = 5;
    tick();
    clickPart(p.scene.find(sw.id)!);
    tick();
    undo.undo();
    expect(p.scene.find(pot.id)?.col).toBe(0);
    expect(p.scene.find(sw.id)?.state?.closed).toBe(false);
    expect(p.scene.find(pot.id)?.state?.position).toBe(0.9);
  });

  it('undo back to the saved state is clean again', () => {
    const { p, undo, tick } = setup();
    p.scene.add({ typeId: 'resistor', col: 0, row: 0, rotation: 0 });
    tick();
    p.markSaved('Saved');
    tick();
    expect(p.dirty).toBe(false);
    p.scene.parts[0].rotation = 90;
    tick();
    expect(p.dirty).toBe(true);
    undo.undo();
    expect(p.dirty).toBe(false);
    undo.redo();
    expect(p.dirty).toBe(true);
  });

  it('loading resets the history', () => {
    const { p, undo, tick } = setup();
    p.scene.add({ typeId: 'resistor', col: 0, row: 0, rotation: 0 });
    tick();
    p.clear();
    undo.reset();
    tick();
    expect(undo.canUndo).toBe(false);
    expect(undo.canRedo).toBe(false);
  });

  it('a board program load is a step; undo brings back the old program', () => {
    const { p, undo, tick } = setup();
    const uno = p.scene.add({ typeId: 'uno', col: 0, row: 0, rotation: 0 });
    tick();
    uno.state = { ...uno.state, program: { name: 'One', hex: ':00000001FF\n' } };
    tick();
    uno.state = { ...uno.state, program: { name: 'Two', hex: ':00000001FF\n' } };
    tick();
    undo.undo();
    expect(p.scene.find(uno.id)?.state?.program?.name).toBe('One');
    // New ids never reuse an id that undo took away.
    undo.undo();
    undo.undo();
    expect(p.scene.add({ typeId: 'led', col: 0, row: 0, rotation: 0 }).id).toBeGreaterThan(uno.id);
  });
});
