// Part inspector entries of the 555 timer (model 'timer555', timer555.ts) and
// the dual op-amp (model 'opamp', opamp.ts). Everything comes from the chip's
// PartResult: its `volts` hold each pin against gnd and the logic flags
// ('logic.*', 0/1; an averaged result holds the fraction of the time, read as
// set from one half on).

import type { Quantity } from './inspect';
import { opampStress } from './opamp';
import { TIMER_RESET_VOLTS, timerStress } from './timer555';
import type { PartResult } from './types';

const num = (id: string, label: string, kind: Quantity['kind'], unit: string, value: number): Quantity => ({ id, label, kind, unit, value });
const text = (id: string, label: string, value: string): Quantity => ({ id, label, kind: 'text', unit: '', value: NaN, text: value });

export function timerQuantities(r: PartResult): Quantity[] {
  const v = r.volts ?? {};
  const high = (v['logic.q'] ?? 0) >= 0.5;
  const ctrl = v.ctrl ?? 0;
  const stress = timerStress(v.vcc ?? r.voltage, r.pins.out ?? 0);
  return [
    text('out', 'OUT', high ? 'high' : 'low'),
    text('reset', 'RESET', (v.reset ?? 0) < TIMER_RESET_VOLTS ? 'low (held in reset)' : 'high (running)'),
    num('vcc', 'VCC', 'voltage', 'V', v.vcc ?? r.voltage),
    num('vout', 'V OUT', 'voltage', 'V', v.out ?? 0),
    num('vthr', 'THR', 'voltage', 'V', v.thr ?? 0),
    num('vtrig', 'TRIG', 'voltage', 'V', v.trig ?? 0),
    num('vhigh', 'Upper threshold (CTRL)', 'voltage', 'V', ctrl),
    num('vlow', 'Lower threshold (CTRL / 2)', 'voltage', 'V', ctrl / 2),
    num('iout', 'I OUT (out)', 'current', 'A', -(r.pins.out ?? 0)),
    num('idis', 'I DISCH (in)', 'current', 'A', r.pins.disch ?? 0),
    num('icc', 'I VCC (in)', 'current', 'A', r.pins.vcc ?? 0),
    num('p', 'P', 'power', 'W', r.power),
    text('state', 'State', stress.level === 'ok' ? 'ok' : stress.short),
  ];
}

export function opampQuantities(r: PartResult): Quantity[] {
  const v = r.volts ?? {};
  const set = (key: string): boolean => (v[`logic.${key}`] ?? 0) >= 0.5;
  const mode = (n: 1 | 2): string => (set('off') ? 'off (supply too low)' : set(`hi${n}`) ? 'saturated high' : set(`lo${n}`) ? 'saturated low' : 'linear');
  const stress = opampStress(v.vcc ?? r.voltage, [r.pins.o1 ?? 0, r.pins.o2 ?? 0]);
  return [
    text('mode1', 'Amplifier 1', mode(1)),
    num('vo1', 'OUT1', 'voltage', 'V', v['abs.o1'] ?? v.o1 ?? 0),
    num('vd1', 'IN1+ - IN1-', 'voltage', 'V', (v.p1 ?? 0) - (v.n1 ?? 0)),
    text('mode2', 'Amplifier 2', mode(2)),
    num('vo2', 'OUT2', 'voltage', 'V', v['abs.o2'] ?? v.o2 ?? 0),
    num('vd2', 'IN2+ - IN2-', 'voltage', 'V', (v.p2 ?? 0) - (v.n2 ?? 0)),
    num('vcc', 'Supply (V+ - V-)', 'voltage', 'V', v.vcc ?? r.voltage),
    num('iout1', 'I OUT1 (out)', 'current', 'A', -(r.pins.o1 ?? 0)),
    num('iout2', 'I OUT2 (out)', 'current', 'A', -(r.pins.o2 ?? 0)),
    num('icc', 'I V+ (in)', 'current', 'A', r.pins.vcc ?? 0),
    num('p', 'P', 'power', 'W', r.power),
    text('state', 'State', stress.level === 'ok' ? 'ok' : stress.short),
  ];
}
