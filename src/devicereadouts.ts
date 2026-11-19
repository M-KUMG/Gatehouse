// Readout lines (hover text) of semiconductor parts whose values need
// naming or sign conventions beyond the generic "volts · amps" line.

import { formatSI } from './format';
import type { PartResult } from './sim';

/** Signal diode: forward drop and current, or the reverse voltage it blocks. */
export function diodeReadout(r: PartResult): string[] {
  const dissipated = formatSI(r.power, 'W');
  if (r.voltage >= 0) return [`Vf ${formatSI(r.voltage, 'V')} · If ${formatSI(r.current, 'A')}`, dissipated];
  return [`Blocking ${formatSI(-r.voltage, 'V')} reverse`, `leakage ${formatSI(-r.current, 'A')}`];
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
