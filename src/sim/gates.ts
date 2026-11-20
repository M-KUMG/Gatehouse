// Ideal logic gates, model kind 'gate' (NOT, BUFFER, AND, NAND, OR, NOR,
// XOR, XNOR). Pins: a (and b for a 2-input gate) in, y out (MODEL_PINS in
// nets.ts; a 1-input gate has no b).
//
// The gate has NO supply or ground pin: it is an ideal logic element whose
// supply is implicit. Everything is measured against the circuit's global
// 0 V reference (net 0: the ground part / a board's gnd, else the first
// battery's negative pole, see nets.ts), and the supply current returns
// through that reference, so the gate's own pin currents do not add up to 0.
// (Gate chips with VCC / GND pins come later as separate parts.)
//
// As the solver sees it (linear for a given logic state):
//   - each input: 10 MOhm to the reference (about 1 uA at 10 V). It is also a
//     weak pull-down: an unconnected (floating) input reads LOW;
//   - the output y: a switched Thevenin source to the reference, `vcc`
//     through GATE_OUT_OHMS (25 ohm) when high, 0 V through 25 ohm when low.
//
// Logic levels (CMOS-like, from the selected supply level `vcc`):
//   an input goes high above VIH = 0.7 vcc and low below VIL = 0.3 vcc;
//   between the two it keeps its level (hysteresis, no chatter).
//
// Logic state, hysteresis and settling: the half-bridge driver's mechanism
// (driver.ts, solveSettled in solve.ts), shared. A gate's state is its input
// levels (GateLogic), decided after a solve with hysteresis against the last
// ACCEPTED state (TransientState.logic, so a time step decides against the
// previous step; a DC solve starts from everything low); the output follows
// from the inputs. Solves repeat while a state changes, bounded (see
// solveSettled): feedback loops (an SR latch) settle deterministically; a
// loop with no stable state (an inverter whose output feeds its own input)
// takes the state decided in the first round of the call, so it flips once
// per time step: a deterministic oscillator with one step of delay.
//
// Propagation delay: not modelled (0). The output changes in the same solve
// in which an input crossed its threshold; ns delays would force the adaptive
// stepper down to ns steps.
//
// Ratings: output current beyond 40 mA warns, beyond 100 mA burns (burned =
// open: the outputs are off); an input above vcc + 0.5 V or below -0.5 V
// warns (it does not burn).
//
// Result: voltage = V(y), current = the current the output delivers (out of
// y), power = what the gate's resistors dissipate, pins = current into each
// pin, volts = each pin against the reference, 'vcc' (the supply level) and
// the logic as 0/1 under 'logic.a', 'logic.b', 'logic.y'.

import { schmitt } from './driver';
import type { PartResult } from './types';

export type GateFn = 'not' | 'buf' | 'and' | 'nand' | 'or' | 'nor' | 'xor' | 'xnor';
export const GATE_FNS: readonly GateFn[] = ['not', 'buf', 'and', 'nand', 'or', 'nor', 'xor', 'xnor'];

/** Inputs of each function (NOT and BUFFER have one). */
export function gateInputs(fn: GateFn): 1 | 2 {
  return fn === 'not' || fn === 'buf' ? 1 : 2;
}

/** Selectable supply (logic high) levels, volts. */
export const GATE_VCC_CHOICES: readonly number[] = [1.8, 3.3, 5, 9, 12];
export const GATE_DEFAULT_VCC = 5;
export const GATE_OUT_OHMS = 25;
export const GATE_INPUT_OHMS = 10e6;
export const GATE_VIH_FRACTION = 0.7;
export const GATE_VIL_FRACTION = 0.3;
/** Output current: warned above, destroyed above (amps). */
export const GATE_WARN_AMPS = 0.04;
export const GATE_BURN_AMPS = 0.1;
/** Inputs may go this far above vcc or below 0 V before a warning. */
export const GATE_INPUT_MARGIN = 0.5;

/** True for one of the selectable supply levels. */
export function isGateVcc(v: unknown): v is number {
  return typeof v === 'number' && GATE_VCC_CHOICES.includes(v);
}

/** Logic state of one gate: the input levels (b is false for a 1-input gate). */
export interface GateLogic {
  a: boolean;
  b: boolean;
}

export const DEFAULT_GATE_LOGIC: GateLogic = { a: false, b: false };

/** True for a stored logic state of a gate (TransientState.logic holds drivers' states too). */
export function isGateLogic(l: unknown): l is GateLogic {
  return typeof l === 'object' && l !== null && Object.keys(l).length === 2 && 'a' in l && 'b' in l;
}

/** The output level for these input levels. */
export function gateOutput(fn: GateFn, l: GateLogic): boolean {
  const { a, b } = l;
  switch (fn) {
    case 'not': return !a;
    case 'buf': return a;
    case 'and': return a && b;
    case 'nand': return !(a && b);
    case 'or': return a || b;
    case 'nor': return !(a || b);
    case 'xor': return a !== b;
    case 'xnor': return a === b;
  }
}

/** Input levels for these input voltages (against the reference), with hysteresis against `prev`. */
export function decideGate(prev: GateLogic, va: number, vb: number, vcc: number, inputs: 1 | 2): GateLogic {
  const lo = GATE_VIL_FRACTION * vcc;
  const hi = GATE_VIH_FRACTION * vcc;
  return { a: schmitt(prev.a, va, lo, hi), b: inputs === 2 ? schmitt(prev.b, vb, lo, hi) : false };
}

export function sameGate(x: GateLogic, y: GateLogic): boolean {
  return x.a === y.a && x.b === y.b;
}

/** A gate in the solver: its nets (b is -1 for a 1-input gate) and the logic state it is solved with. */
export interface GateElement {
  part: number;
  fn: GateFn;
  inputs: 1 | 2;
  vcc: number;
  nodes: { a: number; b: number; y: number };
  logic: GateLogic;
}

/** The gate's result (see the top of the file). */
export function gateResult(g: GateElement, volt: (n: number) => number): PartResult {
  const va = volt(g.nodes.a);
  const vy = volt(g.nodes.y);
  const out = gateOutput(g.fn, g.logic);
  const iy = (vy - (out ? g.vcc : 0)) / GATE_OUT_OHMS; // into the part at y
  const ia = va / GATE_INPUT_OHMS;
  const pins: Record<string, number> = { a: ia, y: iy };
  const volts: Record<string, number> = { a: va, y: vy };
  let power = va * ia + iy * iy * GATE_OUT_OHMS;
  if (g.inputs === 2) {
    const vb = volt(g.nodes.b);
    const ib = vb / GATE_INPUT_OHMS;
    pins.b = ib;
    volts.b = vb;
    power += vb * ib;
  }
  volts.vcc = g.vcc;
  volts['logic.a'] = g.logic.a ? 1 : 0;
  if (g.inputs === 2) volts['logic.b'] = g.logic.b ? 1 : 0;
  volts['logic.y'] = out ? 1 : 0;
  return { voltage: vy, current: -iy, power, pins, volts };
}

/** Warning text for input voltages out of range, or null (inputs never burn the gate). */
export function gateInputWarning(volts: Readonly<Record<string, number>> | undefined, vcc: number): string | null {
  if (!volts) return null;
  for (const pin of ['a', 'b']) {
    const v = volts[pin];
    if (v === undefined || !Number.isFinite(v)) continue;
    if (v > vcc + GATE_INPUT_MARGIN) {
      return `Input ${pin.toUpperCase()} at ${+v.toFixed(2)} V is above the supply level (${vcc} V) + ${GATE_INPUT_MARGIN} V.`;
    }
    if (v < -GATE_INPUT_MARGIN) return `Input ${pin.toUpperCase()} at ${+v.toFixed(2)} V is below -${GATE_INPUT_MARGIN} V.`;
  }
  return null;
}
