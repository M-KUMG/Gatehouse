// Part inspector entries of a logic gate (model 'gate', see gates.ts): the
// input and output levels as text and volts, the output current and the
// supply level. Everything comes from the gate's PartResult: `volts` holds
// each pin against the reference, 'vcc' and the logic flags ('logic.*', 0/1;
// an averaged result holds the fraction of the time, read as set from one
// half on).

import { GATE_BURN_AMPS, GATE_WARN_AMPS, gateInputWarning } from './gates';
import type { Quantity } from './inspect';
import type { ComponentModel, PartResult } from './types';

type GateModel = Extract<ComponentModel, { kind: 'gate' }>;

const num = (id: string, label: string, kind: Quantity['kind'], unit: string, value: number): Quantity => ({ id, label, kind, unit, value });
const text = (id: string, label: string, value: string): Quantity => ({ id, label, kind: 'text', unit: '', value: NaN, text: value });

/** 'high' / 'low' for a logic flag of a gate result. */
export function gateLevel(r: PartResult, key: 'a' | 'b' | 'y'): string {
  return (r.volts?.[`logic.${key}`] ?? 0) >= 0.5 ? 'high' : 'low';
}

/** The rating state: 'ok', or the output current / input voltage warning. */
export function gateState(r: PartResult, vcc: number): string {
  const i = Math.abs(r.current);
  if (i > GATE_BURN_AMPS) return 'output over-current!';
  if (i > GATE_WARN_AMPS) return `output current above ${GATE_WARN_AMPS * 1000} mA`;
  return gateInputWarning(r.volts, vcc) ?? 'ok';
}

export function gateQuantities(model: GateModel, r: PartResult): Quantity[] {
  const v = r.volts ?? {};
  const out: Quantity[] = [text('a', 'A (logic)', gateLevel(r, 'a'))];
  if (model.inputs === 2) out.push(text('b', 'B (logic)', gateLevel(r, 'b')));
  out.push(text('y', 'Y (output)', gateLevel(r, 'y')), num('va', 'V A', 'voltage', 'V', v.a ?? NaN));
  if (model.inputs === 2) out.push(num('vb', 'V B', 'voltage', 'V', v.b ?? NaN));
  out.push(
    num('vy', 'V Y', 'voltage', 'V', v.y ?? r.voltage),
    num('iy', 'I Y (out)', 'current', 'A', r.current),
    num('vcc', 'Supply level', 'voltage', 'V', model.vcc),
    num('p', 'P', 'power', 'W', r.power),
    text('region', 'Region', gateLevel(r, 'y')),
    text('state', 'State', gateState(r, model.vcc)),
  );
  return out;
}
