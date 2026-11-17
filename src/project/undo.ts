// Undo / redo for the project: decides when an edit is finished and puts
// snapshots back. No DOM here (the editor plugs in through UndoHooks).
//
// How steps are found: the project already notices every circuit change
// (Project.checkForChanges after each frame). That marks the history as
// "pending"; after the frame, settle() records a snapshot once no gesture
// is in progress (no drag, no wire being drawn, no part being placed). So a
// whole drag is one step, a click that moved nothing is none, and the
// history itself drops changes of live state only (switches, knobs).

import { History } from './history';
import type { Project } from './project';

/** What the editor does around undo / redo. */
export interface UndoHooks {
  /** True while a gesture is half done: its changes are not a step yet. */
  busy(): boolean;
  /** Before a restore: drop any gesture (putting back what it moved) and bring board runtimes in step with the scene. */
  beforeRestore(): void;
  /** After: keep the selection that still exists, re-solve, redraw. */
  afterRestore(): void;
}

export class UndoManager {
  private readonly history: History;
  private pending = false;
  private readonly listeners: (() => void)[] = [];

  constructor(
    private readonly project: Project,
    private readonly hooks: UndoHooks,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.history = new History(project.circuit());
    project.onChange(() => {
      this.pending = true;
    });
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** Call `listener` whenever canUndo / canRedo may have changed. */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** Call after every frame (after Project.checkForChanges): records a finished edit. */
  settle(): void {
    if (!this.pending || this.hooks.busy()) return;
    this.pending = false;
    if (this.history.record(this.project.circuit(), this.now())) this.notify();
  }

  /** Start over from the current circuit (after New, Open or a restored autosave). */
  reset(): void {
    this.history.reset(this.project.circuit());
    this.pending = false;
    this.notify();
  }

  undo(): boolean {
    return this.step('undo');
  }

  redo(): boolean {
    return this.step('redo');
  }

  private step(direction: 'undo' | 'redo'): boolean {
    this.hooks.beforeRestore();
    this.project.checkForChanges();
    const live = this.project.circuit();
    const target = direction === 'undo' ? this.history.undo(live) : this.history.redo(live);
    if (target) this.project.restore(target);
    this.pending = false;
    this.hooks.afterRestore();
    this.notify();
    return target !== null;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
