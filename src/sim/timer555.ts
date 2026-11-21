// 555 timer (NE555-like bipolar), model kind 'timer555'. Pins in the package's
// order: gnd (1), trig (2), out (3), reset (4), ctrl (5), thr (6), disch (7),
// vcc (8).
//
// The chip as the solver sees it (all linear for a given latch state):
//   - the reference divider: 5 kOhm from vcc to ctrl and two 5 kOhm from ctrl
//     to gnd, so ctrl sits at 2/3 of the supply; the tap between the two
//     lower resistors (1/3) only feeds the lower comparator, so the two are
//     stamped as one 10 kOhm. An external voltage on ctrl moves both
//     thresholds (the upper is ctrl, the lower is ctrl / 2);
//   - a quiescent load of 3.3 kOhm from vcc to gnd (about 2 mA at 5 V, 3 mA at
//     9 V on top of the divider: the datasheet says 3 to 6 mA);
//   - trig and thr: 33 MOhm to gnd (the comparators' input currents: they
//     pull an open input low); reset: 100 kOhm to gnd (the real pin sinks
//     0.1 mA: left open, the chip stays in reset, so tie it to vcc);
//   - out: vcc through 12 ohm when the latch is set, gnd through 10 ohm when
//     it is cleared (the other switch is 1 GOhm, off). The real output stage
//     loses about 1.7 V at 100 mA; this one loses 1.2 V at 100 mA and nothing
//     at no load (a little optimistic at light loads);
//   - disch: the open-collector discharge transistor, gnd through 15 ohm while
//     the latch is cleared (output low), off (1 GOhm) while it is set.
//
// Logic (the latch `q`, output high while set), by the NE555's rules:
//   reset below 0.7 V: cleared (overrides everything);
//   trig below ctrl / 2: set (trigger overrides threshold);
//   thr above ctrl: cleared;
//   otherwise it keeps its state.
//   Below 3 V of supply the chip does nothing: the latch is cleared.
//
// Settling: like the half-bridge driver's, around the whole solve (solveSettled
// in solve.ts), but the decision is made against the state of the CURRENT
// round, not the last accepted one: a latch must keep the state it just took
// while the comparators still read the old inputs a moment later, or it would
// flip back and forth inside one step. The accepted state is kept per chip
// in TransientState.logic. A DC solve starts cleared.
//
// No propagation delay and no supply glitch: the output switches in the solve
// in which a comparator trips, so an astable's period is right to within the
// accuracy of the adaptive time step (the step that crosses a threshold is
// rejected and shortened by the error control, see adaptive.ts).
//
// Result: voltage = vcc - gnd, current = the current into vcc, power = what
// the chip dissipates, pins = current into each pin, volts = each pin against
// gnd and the latch as 0/1 under 'logic.q'.

import type { PartResult } from './types';

export const TIMER_PINS = ['gnd', 'trig', 'out', 'reset', 'ctrl', 'thr', 'disch', 'vcc'] as const;
export type TimerPin = (typeof TIMER_PINS)[number];

export const TIMER_UPPER_DIVIDER_OHMS = 5e3;
export const TIMER_LOWER_DIVIDER_OHMS = 10e3;
export const TIMER_QUIESCENT_OHMS = 3.3e3;
export const TIMER_INPUT_OHMS = 33e6;
export const TIMER_RESET_OHMS = 100e3;
export const TIMER_HIGH_OHMS = 12;
export const TIMER_LOW_OHMS = 10;
export const TIMER_DISCHARGE_OHMS = 15;
export const TIMER_OFF_OHMS = 1e9;
/** Reset is active below this (volts above gnd). */
export const TIMER_RESET_VOLTS = 0.7;
/** Below this supply the chip does nothing. */
export const TIMER_MIN_SUPPLY = 3;
/** Supply ratings: warned above, destroyed above. */
export const TIMER_VCC_WARN = 16;
export const TIMER_VCC_BURN = 18;
/** Output current ratings (sink or source): warned above, destroyed above. */
export const TIMER_OUT_WARN_AMPS = 0.2;
export const TIMER_OUT_BURN_AMPS = 0.4;

/** Logic state of one 555: the latch (output high while set). */
export interface TimerLogic {
  q: boolean;
}

export const DEFAULT_TIMER_LOGIC: TimerLogic = { q: false };

/** True for a stored logic state of a 555 (TransientState.logic holds other parts' states too). */
export function isTimerLogic(l: unknown): l is TimerLogic {
  return typeof l === 'object' && l !== null && Object.keys(l).length === 1 && 'q' in l;
}

export function sameTimer(a: TimerLogic, b: TimerLogic): boolean {
  return a.q === b.q;
}

/** The latch for these pin voltages (absolute: against any common reference), starting from `cur`. */
export function decideTimer(cur: TimerLogic, v: (pin: TimerPin) => number): TimerLogic {
  const g = v('gnd');
  if (v('vcc') - g < TIMER_MIN_SUPPLY) return { q: false };
  const ctrl = v('ctrl') - g;
  if (v('reset') - g < TIMER_RESET_VOLTS) return { q: false };
  if (v('trig') - g < ctrl / 2) return { q: true };
  if (v('thr') - g > ctrl) return { q: false };
  return cur;
}

/** One internal resistor of the chip, between two of its pins. */
export interface TimerBranch {
  a: TimerPin;
  b: TimerPin;
  ohms: number;
}

/** The chip's internal resistors for a latch state (fixed during one solve). */
export function timerBranches(l: TimerLogic): TimerBranch[] {
  return [
    { a: 'vcc', b: 'ctrl', ohms: TIMER_UPPER_DIVIDER_OHMS },
    { a: 'ctrl', b: 'gnd', ohms: TIMER_LOWER_DIVIDER_OHMS },
    { a: 'vcc', b: 'gnd', ohms: TIMER_QUIESCENT_OHMS },
    { a: 'trig', b: 'gnd', ohms: TIMER_INPUT_OHMS },
    { a: 'thr', b: 'gnd', ohms: TIMER_INPUT_OHMS },
    { a: 'reset', b: 'gnd', ohms: TIMER_RESET_OHMS },
    { a: 'vcc', b: 'out', ohms: l.q ? TIMER_HIGH_OHMS : TIMER_OFF_OHMS },
    { a: 'out', b: 'gnd', ohms: l.q ? TIMER_OFF_OHMS : TIMER_LOW_OHMS },
    { a: 'disch', b: 'gnd', ohms: l.q ? TIMER_OFF_OHMS : TIMER_DISCHARGE_OHMS },
  ];
}

/** A 555 in the solver: its nets by pin and the latch state it is solved with. */
export interface TimerElement {
  part: number;
  nodes: Record<TimerPin, number>;
  logic: TimerLogic;
}

/** The chip's result (see the top of the file). */
export function timerResult(t: TimerElement, volt: (n: number) => number): PartResult {
  const pins: Record<string, number> = {};
  for (const p of TIMER_PINS) pins[p] = 0;
  let power = 0;
  for (const b of timerBranches(t.logic)) {
    const v = volt(t.nodes[b.a]) - volt(t.nodes[b.b]);
    const i = v / b.ohms;
    pins[b.a] += i;
    pins[b.b] -= i;
    power += v * i;
  }
  const g = volt(t.nodes.gnd);
  const volts: Record<string, number> = {};
  for (const p of TIMER_PINS) volts[p] = volt(t.nodes[p]) - g;
  volts['logic.q'] = t.logic.q ? 1 : 0;
  return { voltage: volts.vcc, current: pins.vcc, power, pins, volts };
}

/** Warning / burn text for the chip's supply and output current, or null. */
export function timerStress(
  vcc: number, outAmps: number,
): { level: 'ok' } | { level: 'warn' | 'burn'; short: string; reason: string } {
  const out = Math.abs(outAmps);
  if (vcc > TIMER_VCC_BURN) return { level: 'burn', short: 'over-voltage!', reason: `supply over-voltage (VCC above ${TIMER_VCC_BURN} V)` };
  if (out > TIMER_OUT_BURN_AMPS) {
    return { level: 'burn', short: 'output overload!', reason: `output overload (OUT above ${TIMER_OUT_BURN_AMPS * 1000} mA)` };
  }
  if (vcc > TIMER_VCC_WARN) {
    return { level: 'warn', short: 'over-voltage!', reason: `VCC above ${TIMER_VCC_WARN} V: near its limit (burns above ${TIMER_VCC_BURN} V).` };
  }
  if (out > TIMER_OUT_WARN_AMPS) {
    return { level: 'warn', short: 'output overload!', reason: `OUT above ${TIMER_OUT_WARN_AMPS * 1000} mA: over its rating (burns above ${TIMER_OUT_BURN_AMPS * 1000} mA).` };
  }
  return { level: 'ok' };
}
