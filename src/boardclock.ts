// Moves simulated time forward on animation frames while a board runs.
// The wall clock only decides how much simulated time to ask for per frame
// (to approximate real time); inside the emulation time is CPU cycles only.
// When the browser cannot keep up, less is run and the speed drops below 1x.

import type { Simulation } from './simulation';

/** At most this much simulated time per frame (after a stall or a hidden tab). */
const MAX_FRAME_SECONDS = 0.1;
/** Wall time per frame the emulation may use, so the page stays responsive. */
const BUDGET_MS = 12;
/** Simulated time per advance() call inside a frame. */
const CHUNK_SECONDS = 0.004;

export class BoardClock {
  /** Simulated seconds per wall second, smoothed (0 while nothing runs). */
  speed = 0;
  private frame = 0;
  private last = 0;

  constructor(
    private readonly sim: Simulation,
    /** Called after every frame that ran (to redraw). */
    private readonly onTick: () => void,
  ) {}

  /** Start the frame loop if a board runs (call after Run). */
  wake(): void {
    if (this.frame || !this.sim.boards.anyRunning) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.frame = 0;
    if (!this.sim.boards.anyRunning) {
      this.speed = 0;
      this.onTick();
      return;
    }
    const wall = Math.min(Math.max(0, (now - this.last) / 1000), MAX_FRAME_SECONDS);
    this.last = now;
    const started = performance.now();
    let done = 0;
    while (done < wall - 1e-9 && performance.now() - started < BUDGET_MS && this.sim.boards.anyRunning) {
      const step = Math.min(CHUNK_SECONDS, wall - done);
      this.sim.advance(step);
      done += step;
    }
    if (wall > 0) {
      const ratio = done / wall;
      this.speed = this.speed > 0 ? this.speed + (ratio - this.speed) * 0.1 : ratio;
    }
    this.onTick();
    this.frame = requestAnimationFrame(this.tick);
  };
}
