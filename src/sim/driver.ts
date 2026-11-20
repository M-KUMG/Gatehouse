// Behavioural half-bridge gate driver (IR2104-like), model kind 'halfdriver'.
// Pins: vcc, in, sd, com, lo, vs, ho, vb (MODEL_PINS in nets.ts).
//
// The chip as the solver sees it (all linear for a given logic state):
//   - quiescent loads, so no pin floats: vcc-com 150 kOhm (100 uA at 15 V),
//     vb-vs 500 kOhm (30 uA at 15 V), in-com and sd-com 5 MOhm (1 uA at
//     5 V; they also act as the chip's pull-downs: an open IN reads low, an
//     open SD shuts the outputs off);
//   - LO, referenced to com and powered from vcc: high = vcc through 20 ohm,
//     low = com through 10 ohm (the other switch is 1 GOhm, off);
//   - HO, referenced to vs and powered from vb (the floating supply: the
//     bootstrap diode and capacitor are external parts, as with the real
//     chip): high = vb through 20 ohm, low = vs through 10 ohm.
//
// Logic (inputs against com, supplies against their own reference):
//   IN:  high above VIH 2.7 V, low below VIL 0.8 V, between them it keeps its
//        level (hysteresis); works from 3.3 V and 5 V logic.
//   SD:  the same thresholds, active low: SD low shuts both outputs off, so it
//        must be pulled (or tied) high for the chip to run.
//   UVLO: VCC-COM releases above 7.5 V and trips below 7.0 V; VB-VS likewise
//        (it only blocks HO). Any lockout or shutdown pulls the output(s) low.
//   IN high: HO high, LO low. IN low: LO high, HO low. (IR2104 semantics.)
//
// Deadtime: none. The outputs switch together in one solve, and a logic
// state holds for a whole time step (the steps are adaptive), so HO and LO
// are never both high: there is no overlap to protect against, and a fixed
// deadtime would only add an interval the stepper would have to hit.
//
// Logic state and hysteresis without chatter: the levels are discrete and
// never change inside Newton's method (the outputs are fixed resistors during
// a solve, so Newton sees a linear part). Around the whole solve runs a
// fixed-point loop (solveSettled in solve.ts): solve with a logic state,
// read the pin voltages, decide the new state with decideLogic(prev, volts)
// (hysteresis against `prev`, the last ACCEPTED state, never against the
// previous round), and solve again only if the state changed; at most
// MAX_LOGIC_ROUNDS rounds. If the rounds do not settle (a real oscillation,
// e.g. HO collapsing its own bootstrap supply in a DC solve), every flag that
// differed between the last two rounds is taken as off (outputs low) and that
// state is solved once more: deterministic and on the safe side. The
// accepted state is kept per driver in TransientState.logic, so a time step
// decides against the previous step; a DC solve has no previous state and
// starts from DEFAULT_LOGIC (everything low/off).
//
// Result: voltage = VCC-COM, current = the current into vcc, power = what the
// chip dissipates, pins = current into each pin, volts = each pin against com
// plus VB-VS ('vbs') and the logic as 0/1 values under 'logic.*' keys
// (averaged results show the fraction of time the flag was set).

import type { PartResult } from './types';

export const DRIVER_VIH = 2.7;
export const DRIVER_VIL = 0.8;
/** VCC (against COM) and VB-VS undervoltage lockout: trips below the first, releases above the second. */
export const DRIVER_UVLO_OFF = 7.0;
export const DRIVER_UVLO_ON = 7.5;
export const DRIVER_HIGH_OHMS = 20;
export const DRIVER_LOW_OHMS = 10;
export const DRIVER_OFF_OHMS = 1e9;
export const DRIVER_VCC_QUIESCENT_OHMS = 150e3;
export const DRIVER_VB_QUIESCENT_OHMS = 500e3;
export const DRIVER_INPUT_OHMS = 5e6;
/** Bound of the fixed-point loop over the logic state (solves per call at most). */
export const MAX_LOGIC_ROUNDS = 8;
/** VCC ratings: warned above, destroyed above. */
export const DRIVER_VCC_WARN = 16;
export const DRIVER_VCC_BURN = 20;

/** Logic state of one driver: input levels and supply-good flags. */
export interface DriverLogic {
  /** IN reads high. */
  in: boolean;
  /** SD reads high (running). */
  sd: boolean;
  /** VCC above its undervoltage lockout. */
  vcc: boolean;
  /** VB-VS above its undervoltage lockout. */
  vbs: boolean;
}

export const DEFAULT_LOGIC: DriverLogic = { in: false, sd: false, vcc: false, vbs: false };

export interface DriverOutputs {
  ho: boolean;
  lo: boolean;
}

export function driverOutputs(l: DriverLogic): DriverOutputs {
  const run = l.vcc && l.sd;
  return { ho: run && l.in && l.vbs, lo: run && !l.in };
}

/** Pin voltages the logic reads. */
export interface DriverSense {
  in: number; // IN - COM
  sd: number; // SD - COM
  vcc: number; // VCC - COM
  vbs: number; // VB - VS
}

/** A Schmitt input: a high level stays high until below VIL, a low one goes high only above VIH. */
function schmitt(prev: boolean, v: number, low: number, high: number): boolean {
  return prev ? !(v < low) : v > high;
}

/** The logic state for these voltages, with hysteresis against the last accepted state `prev`. */
export function decideLogic(prev: DriverLogic, v: DriverSense): DriverLogic {
  return {
    in: schmitt(prev.in, v.in, DRIVER_VIL, DRIVER_VIH),
    sd: schmitt(prev.sd, v.sd, DRIVER_VIL, DRIVER_VIH),
    vcc: schmitt(prev.vcc, v.vcc, DRIVER_UVLO_OFF, DRIVER_UVLO_ON),
    vbs: schmitt(prev.vbs, v.vbs, DRIVER_UVLO_OFF, DRIVER_UVLO_ON),
  };
}

export function sameLogic(a: DriverLogic, b: DriverLogic): boolean {
  return a.in === b.in && a.sd === b.sd && a.vcc === b.vcc && a.vbs === b.vbs;
}

/** Flags set in both states (the safe choice when the fixed point does not settle). */
export function commonLogic(a: DriverLogic, b: DriverLogic): DriverLogic {
  return { in: a.in && b.in, sd: a.sd && b.sd, vcc: a.vcc && b.vcc, vbs: a.vbs && b.vbs };
}

export const DRIVER_PINS = ['vcc', 'in', 'sd', 'com', 'lo', 'vs', 'ho', 'vb'] as const;
export type DriverPin = (typeof DRIVER_PINS)[number];

/** One internal resistor of a driver, between two of its pins. */
export interface DriverBranch {
  a: DriverPin;
  b: DriverPin;
  ohms: number;
}

/** The driver's internal resistors for a logic state (fixed during one solve). */
export function driverBranches(l: DriverLogic): DriverBranch[] {
  const out = driverOutputs(l);
  return [
    { a: 'vcc', b: 'com', ohms: DRIVER_VCC_QUIESCENT_OHMS },
    { a: 'vb', b: 'vs', ohms: DRIVER_VB_QUIESCENT_OHMS },
    { a: 'in', b: 'com', ohms: DRIVER_INPUT_OHMS },
    { a: 'sd', b: 'com', ohms: DRIVER_INPUT_OHMS },
    { a: 'vcc', b: 'lo', ohms: out.lo ? DRIVER_HIGH_OHMS : DRIVER_OFF_OHMS },
    { a: 'lo', b: 'com', ohms: out.lo ? DRIVER_OFF_OHMS : DRIVER_LOW_OHMS },
    { a: 'vb', b: 'ho', ohms: out.ho ? DRIVER_HIGH_OHMS : DRIVER_OFF_OHMS },
    { a: 'ho', b: 'vs', ohms: out.ho ? DRIVER_OFF_OHMS : DRIVER_LOW_OHMS },
  ];
}

/** A driver in the solver: its nets by pin and the logic state it is solved with. */
export interface DriverElement {
  part: number;
  nodes: Record<DriverPin, number>;
  logic: DriverLogic;
}

/** What the logic reads, from the voltage of each pin (against any common reference). */
export function sensePins(v: (pin: DriverPin) => number): DriverSense {
  const com = v('com');
  return { in: v('in') - com, sd: v('sd') - com, vcc: v('vcc') - com, vbs: v('vb') - v('vs') };
}

/** The driver's result (see the top of the file). */
export function driverResult(d: DriverElement, volt: (n: number) => number): PartResult {
  const pins: Record<string, number> = {};
  for (const p of DRIVER_PINS) pins[p] = 0;
  let power = 0;
  for (const b of driverBranches(d.logic)) {
    const v = volt(d.nodes[b.a]) - volt(d.nodes[b.b]);
    const i = v / b.ohms;
    pins[b.a] += i;
    pins[b.b] -= i;
    power += v * i;
  }
  const com = volt(d.nodes.com);
  const volts: Record<string, number> = {};
  for (const p of DRIVER_PINS) volts[p] = volt(d.nodes[p]) - com;
  volts.vbs = volt(d.nodes.vb) - volt(d.nodes.vs);
  const out = driverOutputs(d.logic);
  const flag = (b: boolean): number => (b ? 1 : 0);
  volts['logic.in'] = flag(d.logic.in);
  volts['logic.sd'] = flag(d.logic.sd);
  volts['logic.vcc'] = flag(d.logic.vcc);
  volts['logic.vbs'] = flag(d.logic.vbs);
  volts['logic.ho'] = flag(out.ho);
  volts['logic.lo'] = flag(out.lo);
  return { voltage: volts.vcc, current: pins.vcc, power, pins, volts };
}

/** Warning / burn text for the driver's supply (VCC against COM), or null. */
export function driverStress(vcc: number): { level: 'ok' } | { level: 'warn' | 'burn'; short: string; reason: string } {
  if (vcc > DRIVER_VCC_BURN) return { level: 'burn', short: 'over-voltage!', reason: `supply over-voltage (VCC above ${DRIVER_VCC_BURN} V)` };
  if (vcc > DRIVER_VCC_WARN) {
    return { level: 'warn', short: 'over-voltage!', reason: `VCC above ${DRIVER_VCC_WARN} V: near its limit (burns above ${DRIVER_VCC_BURN} V).` };
  }
  return { level: 'ok' };
}
