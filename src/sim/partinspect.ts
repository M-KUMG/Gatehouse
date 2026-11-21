// Part inspector entries of the Zener diode, the active buzzer and the
// 7-segment display (inspect.ts calls these). Same conventions as there.
//   - Zener: V and I anode to cathode (vf, if, as for every diode), the same
//     reversed as Vz / Iz, the nominal Vz of the part, and the region:
//     forward (more than 1 uA forward), breakdown (more than 1 uA reverse),
//     reverse (blocking, below -10 mV), else off.
//   - Buzzer: V (pos - neg), I, P and its state: sounding from 2.25 V
//     (buzzer.ts), reversed below -10 mV, else silent.
//   - 7-segment: the current into every segment (i:a .. i:dp), the total out
//     of com, P, and the lit segments (ledBrightness > 0).

import { VT } from './devices';
import { buzzerSounding, type BuzzerModel } from './buzzer';
import { DIODE_ON_AMPS, DIODE_REVERSE_VOLTS, ledBrightness, type Quantity } from './inspect';
import { RGB_CHANNELS } from './rgbled';
import { SEVENSEG_SEGMENTS } from './sevenseg';
import type { ComponentModel, PartResult } from './types';
import { ZENER_REF_AMPS, type DiodeModel } from './zener';

const num = (id: string, label: string, kind: Quantity['kind'], unit: string, value: number): Quantity => ({ id, label, kind, unit, value });
const text = (id: string, label: string, value: string): Quantity => ({ id, label, kind: 'text', unit: '', value: NaN, text: value });

export type ZenerRegion = 'forward' | 'breakdown' | 'reverse' | 'off';

export function zenerRegion(v: number, i: number): ZenerRegion {
  if (i > DIODE_ON_AMPS) return 'forward';
  if (-i > DIODE_ON_AMPS) return 'breakdown';
  if (v < -DIODE_REVERSE_VOLTS) return 'reverse';
  return 'off';
}

/** The voltage across a breakdown diode model at ZENER_REF_AMPS (the part's Vz), NaN without breakdown. */
export function zenerNominal(m: DiodeModel): number {
  if (m.bv === undefined) return NaN;
  const ibv = m.ibv ?? 1e-3;
  return m.bv + (m.nbv ?? 1) * VT * Math.log(ZENER_REF_AMPS / ibv) + ZENER_REF_AMPS * m.rs;
}

export function zenerQuantities(m: DiodeModel, r: PartResult): Quantity[] {
  return [
    num('vf', 'V (A–K)', 'voltage', 'V', r.voltage), num('if', 'I (A→K)', 'current', 'A', r.current),
    num('vz', 'Vz (K–A)', 'voltage', 'V', -r.voltage), num('iz', 'Iz (K→A)', 'current', 'A', -r.current),
    num('p', 'P', 'power', 'W', r.power),
    num('vznom', 'Vz nominal', 'voltage', 'V', zenerNominal(m)),
    text('region', 'Region', zenerRegion(r.voltage, r.current)),
  ];
}

export function buzzerState(m: BuzzerModel, v: number): string {
  if (buzzerSounding(m, v)) return 'sounding';
  return v < -DIODE_REVERSE_VOLTS ? 'reversed (silent)' : 'silent';
}

export function buzzerQuantities(m: BuzzerModel, r: PartResult): Quantity[] {
  return [
    num('v', 'V', 'voltage', 'V', r.voltage), num('i', 'I', 'current', 'A', r.current), num('p', 'P', 'power', 'W', r.power),
    text('state', 'State', buzzerState(m, r.voltage)),
  ];
}

/** The common-cathode RGB LED: the current into each colour, the total out of com, P, and which colours are lit. */
export function rgbledQuantities(_m: Extract<ComponentModel, { kind: 'rgbled' }>, r: PartResult): Quantity[] {
  const out = RGB_CHANNELS.map((c) => num(`i:${c}`, `I ${c}`, 'current', 'A', r.pins[c] ?? 0));
  const lit = RGB_CHANNELS.filter((c) => ledBrightness(r.pins[c] ?? 0) > 0);
  out.push(
    num('i', 'I com (out)', 'current', 'A', -(r.pins.com ?? 0)),
    num('p', 'P', 'power', 'W', r.power),
    text('lit', 'Lit', lit.length ? lit.join(' ') : 'none'),
  );
  return out;
}

export function sevensegQuantities(_m: Extract<ComponentModel, { kind: 'sevenseg' }>, r: PartResult): Quantity[] {
  const out = SEVENSEG_SEGMENTS.map((s) => num(`i:${s}`, `I ${s}`, 'current', 'A', r.pins[s] ?? 0));
  const lit = SEVENSEG_SEGMENTS.filter((s) => ledBrightness(r.pins[s] ?? 0) > 0);
  out.push(
    num('i', 'I com (out)', 'current', 'A', -(r.pins.com ?? 0)),
    num('p', 'P', 'power', 'W', r.power),
    text('lit', 'Lit', lit.length ? lit.join(' ') : 'none'),
  );
  return out;
}
