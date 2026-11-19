// Timing of purely visual animation: the current dashes drifting along wires.
// It runs on frame timestamps (the wall clock) and never feeds back into the
// simulation, which keeps its own time from CPU cycles. Pure, no DOM.

/** Below this many amps a wire shows no moving current. */
export const MIN_FLOW_AMPS = 1e-5;
/** Longest step one frame may take (after a stall, or when a hidden tab comes back). */
export const MAX_FRAME_SECONDS = 0.1;

/** Dash cycles per second at MIN_FLOW_AMPS, and how much faster per tenfold current. */
const BASE_RATE = 0.85;
const RATE_PER_DECADE = 1;

export interface AnimationNeeds {
  /** Largest wire current (amps, any sign) in the latest result. */
  maxWireAmps: number;
  /** Simulated time runs (a board, or the circuit clock with capacitors/inductors): pins, LEDs and readouts change every frame. */
  boardRunning: boolean;
}

/** Whether the grid needs another frame although nothing else asked for one. */
export function needsAnimation(n: AnimationNeeds): boolean {
  return n.boardRunning || Math.abs(n.maxWireAmps) >= MIN_FLOW_AMPS;
}

/** Seconds between two frame timestamps in ms: 0 for the first frame of a run, never above MAX_FRAME_SECONDS. */
export function frameSeconds(previousMs: number | null, nowMs: number): number {
  if (previousMs === null) return 0;
  return Math.min(MAX_FRAME_SECONDS, Math.max(0, (nowMs - previousMs) / 1000));
}

/** Dash cycles per second for a current: faster for more current, 0 below MIN_FLOW_AMPS. */
export function flowRate(amps: number): number {
  const a = Math.abs(amps);
  return a < MIN_FLOW_AMPS ? 0 : BASE_RATE + RATE_PER_DECADE * Math.log10(a / MIN_FLOW_AMPS);
}

/** Phase (0..1, in dash cycles) after `seconds` at `rate` cycles per second. */
export function advancePhase(phase: number, rate: number, seconds: number): number {
  const p = (phase + rate * seconds) % 1;
  return p < 0 ? p + 1 : p;
}

/**
 * Dash phase of every wire with current. Each wire advances by its own rate
 * times the frame's duration, so the speed does not depend on the frame
 * rate and a change of current never makes the dashes jump.
 */
export class FlowPhases {
  private readonly phases = new Map<number, number>();
  private readonly drawn = new Set<number>();
  private seconds = 0;

  /** Start a frame `seconds` after the previous one (0 when nothing animated before). */
  begin(seconds: number): void {
    this.seconds = seconds;
    this.drawn.clear();
  }

  /** The wire's phase for this frame; advanced on the first call per frame only. */
  phase(wireId: number, amps: number): number {
    const before = this.phases.get(wireId) ?? 0;
    if (this.drawn.has(wireId)) return before;
    this.drawn.add(wireId);
    const now = advancePhase(before, flowRate(amps), this.seconds);
    this.phases.set(wireId, now);
    return now;
  }

  /** Forget wires that were not drawn with current this frame. */
  end(): void {
    for (const id of this.phases.keys()) {
      if (!this.drawn.has(id)) this.phases.delete(id);
    }
  }
}
