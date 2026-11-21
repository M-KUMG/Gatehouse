// Readout lines (hover text) of semiconductor parts whose values need
// naming or sign conventions beyond the generic "volts · amps" line.

import { formatSI } from './format';
import type { PartResult } from './sim';
import { ACTIVE_BUZZER } from './sim/buzzer';
import { ledBrightness } from './sim/inspect';
import { buzzerState, zenerRegion } from './sim/partinspect';
import { RGB_CHANNELS } from './sim/rgbled';
import { TIMER_RESET_VOLTS } from './sim/timer555';
import { SEVENSEG_SEGMENTS } from './sim/sevenseg';

/** Signal diode: forward drop and current, or the reverse voltage it blocks. */
export function diodeReadout(r: PartResult): string[] {
  const dissipated = formatSI(r.power, 'W');
  if (r.voltage >= 0) return [`Vf ${formatSI(r.voltage, 'V')} · If ${formatSI(r.current, 'A')}`, dissipated];
  return [`Blocking ${formatSI(-r.voltage, 'V')} reverse`, `leakage ${formatSI(-r.current, 'A')}`];
}

/** Zener diode: forward like a diode, in breakdown the Zener voltage and current, else the reverse voltage it blocks. */
export function zenerReadout(r: PartResult): string[] {
  const region = zenerRegion(r.voltage, r.current);
  if (region === 'breakdown') return [`Vz ${formatSI(-r.voltage, 'V')} · Iz ${formatSI(-r.current, 'A')} (breakdown)`, formatSI(r.power, 'W')];
  return diodeReadout(r);
}

/** Active buzzer: voltage, current and whether it sounds. */
export function buzzerReadout(r: PartResult): string[] {
  return [`${formatSI(r.voltage, 'V')} · ${formatSI(r.current, 'A')}`, buzzerState(ACTIVE_BUZZER, r.voltage)];
}

/** 7-segment display: which segments are lit, and the common current. */
export function sevensegReadout(r: PartResult): string[] {
  const lit = SEVENSEG_SEGMENTS.filter((s) => ledBrightness(r.pins[s] ?? 0) > 0);
  return [`Lit: ${lit.length ? lit.join(' ') : 'none'}`, `I com ${formatSI(-(r.pins.com ?? 0), 'A')} out · ${formatSI(r.power, 'W')}`];
}

/** RGB LED: which colours are lit, and the common current. */
export function rgbledReadout(r: PartResult): string[] {
  const names = { r: 'red', g: 'green', b: 'blue' } as const;
  const lit = RGB_CHANNELS.filter((c) => ledBrightness(r.pins[c] ?? 0) > 0).map((c) => names[c]);
  return [`Lit: ${lit.length ? lit.join(' + ') : 'none'}`, `I com ${formatSI(-(r.pins.com ?? 0), 'A')} out · ${formatSI(r.power, 'W')}`];
}

/** 555 timer: the output level and voltage, the supply and its current (a held reset is called out). */
export function timerReadout(r: PartResult): string[] {
  const v = r.volts ?? {};
  const out = (v['logic.q'] ?? 0) >= 0.5 ? 'high' : 'low';
  const held = (v.reset ?? 0) < TIMER_RESET_VOLTS ? ' · RESET low' : '';
  return [`OUT ${out} · ${formatSI(v.out ?? 0, 'V')}${held}`, `VCC ${formatSI(v.vcc ?? r.voltage, 'V')} · ${formatSI(r.pins.vcc ?? 0, 'A')}`];
}

/** Dual op-amp: each output (against the circuit's 0 V) and what the amplifier is doing. */
export function opampReadout(r: PartResult): string[] {
  const v = r.volts ?? {};
  const off = (v['logic.off'] ?? 0) >= 0.5;
  const word = (n: 1 | 2): string => (off ? 'off' : (v[`logic.hi${n}`] ?? 0) >= 0.5 ? 'high' : (v[`logic.lo${n}`] ?? 0) >= 0.5 ? 'low' : 'linear');
  return [
    `OUT1 ${formatSI(v['abs.o1'] ?? 0, 'V')} (${word(1)})`,
    `OUT2 ${formatSI(v['abs.o2'] ?? 0, 'V')} (${word(2)})`,
  ];
}

/** PNP: conventional currents flow out of the collector and base, so they are shown as positive outflows. */
export function pnpReadout(r: PartResult): string[] {
  return [
    `Ic ${formatSI(-(r.pins.c ?? 0), 'A')} out · Ib ${formatSI(-(r.pins.b ?? 0), 'A')} out`,
    `Vec ${formatSI(-r.voltage, 'V')}`,
  ];
}

/** MOSFET: drain current, Vgs, Vds and dissipation. A P-channel device conducts from source to drain. */
export function mosfetReadout(r: PartResult, polarity: 1 | -1): string[] {
  const vgs = r.volts?.g ?? 0;
  const id = polarity > 0 ? `Id ${formatSI(r.current, 'A')}` : `Id ${formatSI(-r.current, 'A')} (S→D)`;
  return [`${id} · Vgs ${formatSI(vgs, 'V')}`, `Vds ${formatSI(r.voltage, 'V')} · ${formatSI(r.power, 'W')}`];
}

/** Capacitor / inductor: signed voltage across (a - b) and current a to b. */
export function reactiveReadout(r: PartResult): string[] {
  return [`V ${formatSI(r.voltage, 'V')} · I ${formatSI(r.current, 'A')} (a→b)`, formatSI(r.power, 'W')];
}

/** Electrolytic capacitor: signed voltage + to − and current into +. */
export function ecapReadout(r: PartResult): string[] {
  return [`V ${formatSI(r.voltage, 'V')} (+ to −) · I ${formatSI(r.current, 'A')} (into +)`, formatSI(r.power, 'W')];
}

/** IGBT: collector current, Vge, Vce and dissipation. A P-IGBT conducts from emitter to collector (shown positive). */
export function igbtReadout(r: PartResult, polarity: 1 | -1): string[] {
  const vge = r.volts?.g ?? 0;
  const vce = r.volts?.c ?? r.voltage;
  if (polarity > 0) {
    return [`Ic ${formatSI(r.current, 'A')} · Vge ${formatSI(vge, 'V')}`, `Vce ${formatSI(vce, 'V')} · ${formatSI(r.power, 'W')}`];
  }
  return [`Ic ${formatSI(-r.current, 'A')} (E→C) · Veg ${formatSI(-vge, 'V')}`, `Vec ${formatSI(-vce, 'V')} · ${formatSI(r.power, 'W')}`];
}

/** Half-bridge driver: output states and the two supplies (see sim/driver.ts for the `volts` keys). */
export function driverReadout(r: PartResult): string[] {
  const v = r.volts ?? {};
  const on = (key: string): string => ((v[`logic.${key}`] ?? 0) >= 0.5 ? 'high' : 'low');
  const lock = [(v['logic.sd'] ?? 0) < 0.5 ? 'SD' : '', (v['logic.vcc'] ?? 0) < 0.5 ? 'UVLO' : ''].filter((s) => s !== '');
  return [
    `HO ${on('ho')} · LO ${on('lo')}${lock.length ? ` (${lock.join(', ')})` : ''}`,
    `VCC ${formatSI(v.vcc ?? r.voltage, 'V')} · VB-VS ${formatSI(v.vbs ?? 0, 'V')}`,
  ];
}
