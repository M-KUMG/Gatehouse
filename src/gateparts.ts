// Part types of the ideal logic gates (model 'gate', see sim/gates.ts):
// NOT, BUFFER, AND, NAND, OR, NOR, XOR, XNOR. A small square chip without
// supply pins (gate chips with VCC / GND pins come later as separate parts):
// inputs A (B) on the left, output Y on the right, 4 x 4 cells. The supply
// (logic high) level is the part state `vcc`, one of GATE_VCC_CHOICES
// (default 5 V), chosen in the value popup.
// Mirroring: the 2-input gates are mirrorable (A and B sit off the centre
// line, so a vertical mirror swaps them, which no turn does); the 1-input
// gates are not (their pins are on the centre line: a mirror equals a turn).

import { GATE_COLS, GATE_ROWS, drawGateOutput, gateSvg, vccLabel } from './art/gates';
import { formatSI } from './format';
import type { PartState, PartType, PinDef } from './parts';
import {
  GATE_BURN_AMPS, GATE_DEFAULT_VCC, GATE_VCC_CHOICES, GATE_WARN_AMPS, gateInputWarning, gateInputs, isGateVcc, type GateFn,
} from './sim/gates';
import { gateLevel } from './sim/gateinspect';
import type { PartResult } from './sim';

const NAMES: Record<GateFn, string> = {
  not: 'NOT gate', buf: 'BUFFER gate', and: 'AND gate', nand: 'NAND gate',
  or: 'OR gate', nor: 'NOR gate', xor: 'XOR gate', xnor: 'XNOR gate',
};

const PINS_2: readonly PinDef[] = [
  { id: 'a', name: 'A (input)', x: 0, y: 1 },
  { id: 'b', name: 'B (input)', x: 0, y: 3 },
  { id: 'y', name: 'Y (output)', x: 4, y: 2 },
];
const PINS_1: readonly PinDef[] = [
  { id: 'a', name: 'A (input)', x: 0, y: 2 },
  { id: 'y', name: 'Y (output)', x: 4, y: 2 },
];

/** The supply level of a placed gate (an invalid or missing one reads as the default). */
export function gateVcc(s: PartState): number {
  return isGateVcc(s.vcc) ? s.vcc : GATE_DEFAULT_VCC;
}

/** Hover text: the levels and the output. */
export function gateReadout(r: PartResult, inputs: 1 | 2): string[] {
  const ins = inputs === 2 ? `A ${gateLevel(r, 'a')} · B ${gateLevel(r, 'b')}` : `A ${gateLevel(r, 'a')}`;
  return [`${ins} → Y ${gateLevel(r, 'y')}`, `Y ${formatSI(r.volts?.y ?? r.voltage, 'V')} · ${formatSI(r.current, 'A')} out`];
}

function gatePart(fn: GateFn): PartType {
  const inputs = gateInputs(fn);
  return {
    id: `gate-${fn}`, name: NAMES[fn], cols: GATE_COLS, rows: GATE_ROWS, svg: gateSvg(fn, GATE_DEFAULT_VCC),
    pins: inputs === 2 ? PINS_2 : PINS_1,
    mirrorable: inputs === 2,
    defaults: { vcc: GATE_DEFAULT_VCC },
    value: { label: 'Supply level', unit: 'V', min: GATE_VCC_CHOICES[0], max: GATE_VCC_CHOICES[GATE_VCC_CHOICES.length - 1], key: 'vcc', options: GATE_VCC_CHOICES },
    readout: (r) => gateReadout(r, inputs),
    warnAbove: GATE_WARN_AMPS,
    burnAbove: GATE_BURN_AMPS,
    warnWhen: (r, s) => gateInputWarning(r.volts, gateVcc(s)),
    variant: (s) => {
      const vcc = gateVcc(s);
      if (s.burned) return { key: `burned-${vcc}`, svg: gateSvg(fn, vcc, true) };
      return vcc === GATE_DEFAULT_VCC ? null : { key: vccLabel(vcc), svg: gateSvg(fn, vcc) };
    },
    overlay: (ctx, s, r) => {
      if (!s.burned && r) drawGateOutput(ctx, (r.volts?.['logic.y'] ?? 0) >= 0.5);
    },
    sim: (s) => (s.burned ? { kind: 'open' } : { kind: 'gate', fn, inputs, vcc: gateVcc(s) }),
  };
}

/** NOT, BUFFER, AND, NAND, OR, NOR, XOR, XNOR, in menu order. */
export const GATE_PARTS: readonly PartType[] = (['not', 'buf', 'and', 'nand', 'or', 'nor', 'xor', 'xnor'] as const).map(gatePart);
