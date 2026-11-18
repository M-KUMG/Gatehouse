// When to open the Build output window by itself: once per failed build.
// A failure is identified by the board and the build's start and finish times.
// Whether the window was open or closed when the failure arrived, the
// failure counts as seen, so closing the window never brings it back for the
// same failure. No DOM.

import type { BoardBuildState } from '../build/buildlog';

export class AutoOpen {
  private readonly seen = new Map<number, string>();

  /** Call after every change of a board's build state. True: open the window now. */
  shouldOpen(partId: number, state: BoardBuildState, windowOpen: boolean): boolean {
    if (state.status !== 'failed' || state.finishedAt === undefined) return false;
    const key = `${state.startedAt ?? 0}:${state.finishedAt}`;
    if (this.seen.get(partId) === key) return false;
    this.seen.set(partId, key);
    return !windowOpen;
  }

  /** A board was deleted, or another project loaded (board ids start again). */
  forget(partId: number | null): void {
    if (partId === null) this.seen.clear();
    else this.seen.delete(partId);
  }
}
