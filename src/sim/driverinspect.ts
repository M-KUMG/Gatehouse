// Part inspector entries of the half-bridge driver (model 'halfdriver', see
// driver.ts): the logic state as text, the supplies and their currents.
// Everything comes from the driver's PartResult: its `volts` hold each pin
// against COM, VB-VS ('vbs') and the logic flags ('logic.*', 0/1; an averaged
// result holds the fraction of the time, read as set from one half on).

import { driverStress } from './driver';
import type { Quantity } from './inspect';
import type { PartResult } from './types';

const num = (id: string, label: string, kind: Quantity['kind'], unit: string, value: number): Quantity => ({ id, label, kind, unit, value });
const text = (id: string, label: string, value: string): Quantity => ({ id, label, kind: 'text', unit: '', value: NaN, text: value });

export function driverQuantities(r: PartResult): Quantity[] {
  const v = r.volts ?? {};
  const set = (key: string): boolean => (v[`logic.${key}`] ?? 0) >= 0.5;
  const level = (key: string): string => (set(key) ? 'high' : 'low');
  const lockouts = [!set('vcc') ? 'VCC' : '', !set('vbs') ? 'VB-VS' : ''].filter((s) => s !== '');
  const stress = driverStress(v.vcc ?? r.voltage);
  return [
    text('in', 'IN (logic)', level('in')),
    text('sd', 'SD', set('sd') ? 'high (running)' : 'low (shut down)'),
    text('ho', 'HO', level('ho')),
    text('lo', 'LO', level('lo')),
    text('uvlo', 'UVLO', lockouts.length ? `${lockouts.join(', ')} undervoltage` : 'none'),
    num('vcc', 'VCC', 'voltage', 'V', v.vcc ?? r.voltage),
    num('vbs', 'VB-VS', 'voltage', 'V', v.vbs ?? NaN),
    num('icc', 'I VCC (in)', 'current', 'A', r.pins.vcc ?? 0),
    num('ivb', 'I VB (in)', 'current', 'A', r.pins.vb ?? 0),
    num('p', 'P', 'power', 'W', r.power),
    text('state', 'State', stress.level === 'ok' ? 'ok' : stress.short),
  ];
}
