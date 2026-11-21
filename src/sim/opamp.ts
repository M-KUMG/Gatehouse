// Dual op-amp (LM358-like), model kind 'opamp': two amplifiers in the usual
// 8-pin package. Pins in the package's order: o1 (1), n1 (2, IN1 -), p1 (3,
// IN1 +), gnd (4, the negative supply), p2 (5, IN2 +), n2 (6, IN2 -), o2 (7),
// vcc (8).
//
// Each amplifier as the solver sees it (linear for a given mode):
//   - inputs: 10 MOhm to the circuit's 0 V reference (the real one draws
//     45 nA), so an open input reads about 0 V;
//   - linear mode: the output is a voltage source of GAIN x (V+ - V-), GAIN
//     100 000 (100 dB, the datasheet's typical), behind 50 ohm, referred to the
//     circuit's 0 V reference (a Norton source: a controlled current plus a
//     conductance, see stampLinear in solve.ts);
//   - saturated high: the output sits 1.5 V below vcc behind 50 ohm (the
//     LM358's Darlington pull-up: 3.5 V at 5 V supply);
//   - saturated low: 20 mV above gnd behind 50 ohm (it swings to the negative
//     supply, which is why it works from a single supply);
//   - off (supply under 3 V): the output is 1 MOhm to gnd.
//   The chip: a quiescent load of 10 kOhm from vcc to gnd (0.5 mA at 5 V).
//
// Mode (per amplifier), decided from the open-loop target T = GAIN x (V+ - V-)
// against the rails: above vcc - 1.5 V it saturates high, below gnd + 20 mV
// low, else it is linear. The chip is off when vcc - gnd is under 3 V.
// Settling: the same fixed-point rounds as the other logic parts (solveSettled
// in solve.ts); the mode is a function of the solution only, so the rounds
// settle in a step or two (a comparator: round 1 solves linear with the full
// gain, which saturates, round 2 solves saturated).
//
// Not modelled (honest limits): bandwidth and slew rate (the amplifier is
// instant: GBW 1 MHz and 0.3 V/us are ignored), input offset, bias and common-
// mode limits, output current limiting (the ratings warn and burn instead),
// crossover distortion.
//
// Result: voltage = vcc - gnd, current = the current into vcc, power = what the
// chip dissipates, pins = current into each pin (the input currents return
// through the circuit's reference, so the pins do not add up to 0), volts =
// each pin against gnd (the outputs also against the 0 V reference, 'abs.o1' and
// 'abs.o2') and the modes as 0/1 under 'logic.hi1', 'logic.lo1', 'logic.hi2',
// 'logic.lo2' and 'logic.off'.

import type { PartResult } from './types';

export const OPAMP_PINS = ['o1', 'n1', 'p1', 'gnd', 'p2', 'n2', 'o2', 'vcc'] as const;
export type OpampPin = (typeof OPAMP_PINS)[number];

export const OPAMP_GAIN = 1e5;
export const OPAMP_OUT_OHMS = 50;
export const OPAMP_INPUT_OHMS = 10e6;
export const OPAMP_QUIESCENT_OHMS = 10e3;
export const OPAMP_HIGH_DROP_VOLTS = 1.5;
export const OPAMP_LOW_VOLTS = 0.02;
export const OPAMP_MIN_SUPPLY = 3;
export const OPAMP_OFF_OHMS = 1e6;
/** Supply ratings: warned above, destroyed above (volts); output current: warned above, destroyed above (amps). */
export const OPAMP_VCC_WARN = 32;
export const OPAMP_VCC_BURN = 40;
export const OPAMP_OUT_WARN_AMPS = 0.03;
export const OPAMP_OUT_BURN_AMPS = 0.1;

/** How one amplifier is solved: 0 linear, 1 saturated high, 2 saturated low, 3 off (supply too low). */
export type OpampMode = 0 | 1 | 2 | 3;
export const MODE_LINEAR = 0;
export const MODE_HIGH = 1;
export const MODE_LOW = 2;
export const MODE_OFF = 3;

/** Logic state of one op-amp chip: the mode of each of its two amplifiers. */
export interface OpampLogic {
  c1: OpampMode;
  c2: OpampMode;
}

export const DEFAULT_OPAMP_LOGIC: OpampLogic = { c1: MODE_LINEAR, c2: MODE_LINEAR };

/** True for a stored logic state of an op-amp chip. */
export function isOpampLogic(l: unknown): l is OpampLogic {
  return typeof l === 'object' && l !== null && Object.keys(l).length === 2 && 'c1' in l && 'c2' in l;
}

export function sameOpamp(a: OpampLogic, b: OpampLogic): boolean {
  return a.c1 === b.c1 && a.c2 === b.c2;
}

/** The mode of one amplifier from its open-loop target and the rails (absolute volts). */
export function modeOf(vp: number, vn: number, vcc: number, gnd: number): OpampMode {
  if (vcc - gnd < OPAMP_MIN_SUPPLY) return MODE_OFF;
  const target = OPAMP_GAIN * (vp - vn);
  if (target > vcc - OPAMP_HIGH_DROP_VOLTS) return MODE_HIGH;
  if (target < gnd + OPAMP_LOW_VOLTS) return MODE_LOW;
  return MODE_LINEAR;
}

/** The modes for these pin voltages (absolute). */
export function decideOpamp(v: (pin: OpampPin) => number): OpampLogic {
  const vcc = v('vcc');
  const gnd = v('gnd');
  return { c1: modeOf(v('p1'), v('n1'), vcc, gnd), c2: modeOf(v('p2'), v('n2'), vcc, gnd) };
}

/** The pins of amplifier 1 and 2. */
export const OPAMP_CHANNELS = [
  { out: 'o1', n: 'n1', p: 'p1', key: 'c1' },
  { out: 'o2', n: 'n2', p: 'p2', key: 'c2' },
] as const;

/** An op-amp chip in the solver: its nets by pin and the modes it is solved with. */
export interface OpampElement {
  part: number;
  nodes: Record<OpampPin, number>;
  logic: OpampLogic;
}

/** The chip's result (see the top of the file). */
export function opampResult(o: OpampElement, volt: (n: number) => number): PartResult {
  const pins: Record<string, number> = {};
  for (const p of OPAMP_PINS) pins[p] = 0;
  const vcc = volt(o.nodes.vcc);
  const gnd = volt(o.nodes.gnd);
  // Quiescent supply current.
  const iq = (vcc - gnd) / OPAMP_QUIESCENT_OHMS;
  pins.vcc += iq;
  pins.gnd -= iq;
  const flags: Record<string, number> = { 'logic.off': 0 };
  OPAMP_CHANNELS.forEach((ch, k) => {
    const mode = o.logic[ch.key];
    const vp = volt(o.nodes[ch.p]);
    const vn = volt(o.nodes[ch.n]);
    const vo = volt(o.nodes[ch.out]);
    pins[ch.p] += vp / OPAMP_INPUT_OHMS;
    pins[ch.n] += vn / OPAMP_INPUT_OHMS;
    let target: number;
    let ohms = OPAMP_OUT_OHMS;
    if (mode === MODE_HIGH) target = vcc - OPAMP_HIGH_DROP_VOLTS;
    else if (mode === MODE_LOW) target = gnd + OPAMP_LOW_VOLTS;
    else if (mode === MODE_OFF) {
      target = gnd;
      ohms = OPAMP_OFF_OHMS;
    } else target = OPAMP_GAIN * (vp - vn);
    const iout = (vo - target) / ohms; // into the out pin
    pins[ch.out] += iout;
    // The current the output delivers or takes comes from vcc or goes to gnd.
    if (iout < 0) pins.vcc += -iout;
    else pins.gnd += -iout;
    flags[`logic.hi${k + 1}`] = mode === MODE_HIGH ? 1 : 0;
    flags[`logic.lo${k + 1}`] = mode === MODE_LOW ? 1 : 0;
    if (mode === MODE_OFF) flags['logic.off'] = 1;
  });
  let power = 0;
  for (const p of OPAMP_PINS) power += volt(o.nodes[p]) * pins[p];
  const volts: Record<string, number> = { ...flags };
  for (const p of OPAMP_PINS) volts[p] = volt(o.nodes[p]) - gnd;
  // The outputs against the circuit's 0 V reference too (what a meter on the output reads on a split supply).
  volts['abs.o1'] = volt(o.nodes.o1);
  volts['abs.o2'] = volt(o.nodes.o2);
  return { voltage: vcc - gnd, current: pins.vcc, power, pins, volts };
}

/** Warning / burn text for the chip's supply and output currents, or null. */
export function opampStress(
  supply: number, outAmps: readonly number[],
): { level: 'ok' } | { level: 'warn' | 'burn'; short: string; reason: string } {
  const out = Math.max(0, ...outAmps.map(Math.abs));
  if (supply > OPAMP_VCC_BURN) return { level: 'burn', short: 'over-voltage!', reason: `supply over-voltage (V+ above ${OPAMP_VCC_BURN} V)` };
  if (supply < -0.5) return { level: 'burn', short: 'reverse supply!', reason: 'supply connected the wrong way round' };
  if (out > OPAMP_OUT_BURN_AMPS) {
    return { level: 'burn', short: 'output overload!', reason: `output overload (OUT above ${OPAMP_OUT_BURN_AMPS * 1000} mA)` };
  }
  if (supply > OPAMP_VCC_WARN) {
    return { level: 'warn', short: 'over-voltage!', reason: `V+ above ${OPAMP_VCC_WARN} V: near its limit (burns above ${OPAMP_VCC_BURN} V).` };
  }
  if (out > OPAMP_OUT_WARN_AMPS) {
    return { level: 'warn', short: 'output overload!', reason: `OUT above ${OPAMP_OUT_WARN_AMPS * 1000} mA: over its rating (burns above ${OPAMP_OUT_BURN_AMPS * 1000} mA).` };
  }
  return { level: 'ok' };
}
