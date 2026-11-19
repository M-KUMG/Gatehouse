// The global simulation transport (Start / Pause / Reset, speed) as plain
// data, no DOM. Its state is never stored: it is derived from the boards and
// the circuit clock, so the per-board buttons and the global ones always
// agree. UI-only (not saved with the project, not an undo step).

import type { BoardRunStatus } from './mcu/runtime';

export type TransportState = 'stopped' | 'running' | 'paused';

export interface TransportInputs {
  /** Run state of every board in the circuit. */
  boards: readonly BoardRunStatus[];
  /** The circuit clock runs (Start pressed, not paused since). */
  circuitRunning: boolean;
  /** Start was pressed since the last Reset. */
  circuitStarted: boolean;
}

/**
 * running: a board runs or the circuit clock runs;
 * paused: else, a board is paused or the circuit clock was started since the last Reset;
 * stopped: otherwise (boards in the error state count as stopped).
 */
export function transportState(i: TransportInputs): TransportState {
  if (i.circuitRunning || i.boards.includes('running')) return 'running';
  if (i.circuitStarted || i.boards.includes('paused')) return 'paused';
  return 'stopped';
}

/** Speed multipliers offered (simulated seconds per wall second). */
export const SPEEDS: readonly number[] = [0.01, 0.1, 0.25, 0.5, 1, 2, 5, 10];
export const DEFAULT_SPEED = 1;

/** "0.25x", "1x", "10x". */
export function speedLabel(speed: number): string {
  return `${Number(speed.toPrecision(3))}x`;
}

/** Simulated time as shown in the bar: "0.250 s" (ms resolution, minutes past 1000 s are still seconds). */
export function formatSimTime(seconds: number): string {
  return `${Math.max(0, seconds).toFixed(3)} s`;
}

/** The nearest offered speed to `x` (for a value from elsewhere). */
export function nearestSpeed(x: number): number {
  let best = DEFAULT_SPEED;
  for (const s of SPEEDS) if (Math.abs(Math.log(s / x)) < Math.abs(Math.log(best / x))) best = s;
  return best;
}

export interface TransportView {
  /** 'run' shows a play triangle (Start), 'pause' two bars. */
  icon: 'run' | 'pause';
  toggleTitle: string;
  resetTitle: string;
  /** Simulated time, e.g. "0.250 s". */
  time: string;
  /** Tooltip of the time readout: what moves the clock, and the achieved speed when it is behind. */
  timeTitle: string;
  /** Set while running slower than asked: e.g. "0.42x" (shown next to the time). */
  behind: string | null;
}

export interface TransportViewInputs {
  state: TransportState;
  time: number;
  /** Asked speed multiplier. */
  speed: number;
  /** Measured simulated seconds per wall second (0 when the clock is idle). */
  achieved: number;
  /** Simulated time is actually moving. */
  timeRunning: boolean;
  hasReactiveParts: boolean;
  boardCount: number;
}

/** Below this share of the asked speed the bar shows the achieved speed. */
const BEHIND_RATIO = 0.9;

export function transportView(i: TransportViewInputs): TransportView {
  const running = i.state === 'running';
  const toggleTitle = running
    ? 'Pause the simulation (Space)'
    : i.state === 'paused'
      ? 'Continue the simulation (Space)'
      : 'Start the simulation: run every board and the circuit clock (Space)';
  let timeTitle = 'Simulated time';
  if (running && !i.timeRunning) timeTitle += '\nNothing in this circuit changes over time (no capacitor, inductor or running board), so the clock stands still';
  else if (!running && i.hasReactiveParts && i.time === 0) timeTitle += '\nCapacitors and inductors show their settled (DC) values until Start; Start begins with them empty';
  const behind = running && i.timeRunning && i.achieved > 0 && i.achieved < i.speed * BEHIND_RATIO ? speedLabel(Number(i.achieved.toFixed(2)) || 0.01) : null;
  if (behind) timeTitle += `\nRunning at ${behind} of the asked ${speedLabel(i.speed)}: the computer cannot keep up`;
  return {
    icon: running ? 'pause' : 'run',
    toggleTitle,
    resetTitle: i.boardCount > 0
      ? 'Reset: every board rebuilds from its files, capacitors and inductors empty, time back to 0'
      : 'Reset: capacitors and inductors empty, time back to 0',
    time: formatSimTime(i.time),
    timeTitle,
    behind,
  };
}
