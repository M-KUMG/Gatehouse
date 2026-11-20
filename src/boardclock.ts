// Moves simulated time forward on animation frames while simulated time
// runs: a board runs, or the circuit clock (global Start) runs on a circuit
// with capacitors or inductors. Idle otherwise (no frame loop).
// The wall clock only decides how much simulated time to ask for per frame:
// wall time since the last frame times the speed multiplier (0.01x .. 10x);
// inside the emulation time is CPU cycles and fixed slices only, so the
// speed changes the pacing, never the results. When the browser cannot keep
// up, less is run and the measured speed drops below the asked one.

// With the simulation in a Worker (src/sim/worker/host.ts) the same rule runs
// there; this clock is then idle and Simulation.clock() only redraws when a
// snapshot arrived (see Simulation.clock).

/** What the transport bar needs of a clock (this one, or the Worker's through Simulation.clock()). */
export interface SimClock {
  /** Asked speed multiplier (simulated seconds per wall second). UI-only. */
  multiplier: number;
  /** Measured simulated seconds per wall second, smoothed (0 while nothing runs). */
  readonly speed: number;
  /** Start the frame loop if simulated time runs (call after Run / Start and after edits). */
  wake(): void;
}

/** What the clock drives (the Simulation). */
export interface ClockTarget {
  /** Simulated time should move now. */
  readonly timeRunning: boolean;
  /** Run `seconds` of simulated time. */
  advance(seconds: number): void;
  /** Where the measured speed is published (the board chips read it). */
  readonly boards: { speed: number };
}

/** Frame scheduling and time source (the browser's by default; tests pass their own). */
export interface FrameSource {
  request(cb: (now: number) => void): number;
  /** Milliseconds, for the per-frame work budget. */
  now(): number;
}

const browserFrames: FrameSource = {
  request: (cb) => requestAnimationFrame(cb),
  now: () => performance.now(),
};

/** At most this much wall time counts per frame (after a stall or a hidden tab). */
const MAX_FRAME_SECONDS = 0.1;
/** Wall time per frame the simulation may use, so the page stays responsive. */
const BUDGET_MS = 12;
/** Simulated time per advance() call inside a frame. */
const CHUNK_SECONDS = 0.004;

export class BoardClock implements SimClock {
  /** Simulated seconds per wall second, smoothed (0 while nothing runs). */
  speed = 0;
  /** Asked speed multiplier (simulated seconds per wall second). UI-only. */
  multiplier = 1;
  private frame = 0;
  private last = 0;

  constructor(
    private readonly sim: ClockTarget,
    /** Called after every frame that ran (to redraw). */
    private readonly onTick: () => void,
    private readonly frames: FrameSource = browserFrames,
  ) {}

  /** Start the frame loop if simulated time runs (call after Run / Start and after edits). */
  wake(): void {
    if (this.frame || !this.sim.timeRunning) return;
    this.last = this.frames.now();
    this.frame = this.frames.request(this.tick);
  }

  private tick = (now: number): void => {
    this.frame = 0;
    if (!this.sim.timeRunning) {
      this.speed = 0;
      this.sim.boards.speed = 0;
      this.onTick();
      return;
    }
    const wall = Math.min(Math.max(0, (now - this.last) / 1000), MAX_FRAME_SECONDS);
    this.last = now;
    const wanted = wall * this.multiplier;
    const started = this.frames.now();
    let done = 0;
    while (done < wanted - 1e-12 && this.frames.now() - started < BUDGET_MS && this.sim.timeRunning) {
      const step = Math.min(CHUNK_SECONDS, wanted - done);
      this.sim.advance(step);
      done += step;
    }
    if (wall > 0) {
      const ratio = done / wall;
      this.speed = this.speed > 0 ? this.speed + (ratio - this.speed) * 0.1 : ratio;
      this.sim.boards.speed = this.speed; // for boardRunState
    }
    this.onTick();
    this.frame = this.frames.request(this.tick);
  };
}
