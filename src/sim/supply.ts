// Programmable bench power supply with a current limit, model kind 'supply'.
// Pins: pos, neg.
//
// It behaves like a lab supply: constant VOLTAGE up to the current limit, then
// constant CURRENT (the output voltage falls until the load is met). How the
// solver sees it: before every solve `expandSupplies` replaces the supply by
//   - a battery (the set voltage behind 1 mohm), and
//   - a current limiter, model kind 'limiter', between that battery and the
//     supply's + pin: a two-terminal element with the smooth curve
//         i(v) = limit * tanh(v / vk),   vk = 0.05 ohm * limit
//     (v = the voltage across it, i from a to b). For currents far below the
//     limit it is a resistor of 50 mohm (the supply's output resistance); as
//     the current nears the limit the curve saturates, so the supply cannot
//     deliver more than `limit` into any load, a short circuit included.
//     It is odd in v, so the limit also holds for a source forcing current
//     back into the supply.
// The limiter is an ordinary curve element (solve.ts, like the buzzer's).
//
// Result under the supply's own pins: voltage across pos-neg, current out of
// pos, and under `volts` 'cc' (1 while the supply is in current limit: the
// current is at 95 % of the limit or more) and 'setpoint' (the set voltage).

import { contactId } from './relay';
import type { ComponentModel, PartResult, SimInput, SimResult } from './types';

export type SupplyModel = Extract<ComponentModel, { kind: 'supply' }>;
export type LimiterModel = Extract<ComponentModel, { kind: 'limiter' }>;

/** Output resistance below the limit (ohms): the limiter's slope at 0. */
export const SUPPLY_OHMS = 0.05;
/** Where the limit counts as reached (the "CC" lamp). */
export const SUPPLY_CC_FRACTION = 0.95;

/** Current (a to b) and slope of the limiter at `v` volts across it. */
export function limiterCurve(m: LimiterModel, v: number): { i: number; g: number } {
  const vk = Math.max(SUPPLY_OHMS * m.amps, 1e-9);
  const x = v / vk;
  if (Math.abs(x) > 40) return { i: Math.sign(x) * m.amps, g: 0 };
  const t = Math.tanh(x);
  return { i: m.amps * t, g: (m.amps * (1 - t * t)) / vk };
}

const batteryId = (id: number): number => contactId(id, 0);
const limiterId = (id: number): number => contactId(id, 1);

export function expandSupplies(input: SimInput): { input: SimInput; supplies: { id: number; m: SupplyModel }[] } {
  if (!input.components.some((c) => c.model.kind === 'supply')) return { input, supplies: [] };
  const supplies: { id: number; m: SupplyModel }[] = [];
  const components: SimInput['components'] = [];
  const links: SimInput['links'] = [];
  const mapped = new Set<number>();
  for (const c of input.components) {
    if (c.model.kind !== 'supply') {
      components.push(c);
      continue;
    }
    supplies.push({ id: c.id, m: c.model });
    mapped.add(c.id);
    components.push({ id: batteryId(c.id), model: { kind: 'battery', volts: c.model.volts, rInternal: 1e-3 } });
    components.push({ id: limiterId(c.id), model: { kind: 'limiter', amps: Math.max(c.model.limit, 1e-6) } });
    links.push([{ part: batteryId(c.id), pin: 'pos' }, { part: limiterId(c.id), pin: 'a' }]);
  }
  const rename = (t: { part: number; pin: string }): { part: number; pin: string } => {
    if (!mapped.has(t.part)) return t;
    if (t.pin === 'pos') return { part: limiterId(t.part), pin: 'b' };
    if (t.pin === 'neg') return { part: batteryId(t.part), pin: 'neg' };
    return t;
  };
  for (const [a, b] of input.links) links.push([rename(a), rename(b)]);
  return { input: { ...input, components, links }, supplies };
}

export function supplyResults(result: SimResult, supplies: readonly { id: number; m: SupplyModel }[]): void {
  for (const { id, m } of supplies) {
    const lim = result.parts[limiterId(id)];
    if (!lim) continue;
    result.nets[`${id}:pos`] = result.nets[`${limiterId(id)}:b`] ?? 0;
    result.nets[`${id}:neg`] = result.nets[`${batteryId(id)}:neg`] ?? 0;
    const v = (result.voltages[result.nets[`${id}:pos`]] ?? 0) - (result.voltages[result.nets[`${id}:neg`]] ?? 0);
    const i = lim.current; // out of the supply's + pin
    const out: PartResult = {
      voltage: v,
      current: i,
      power: v * i,
      pins: { pos: -i, neg: i },
      volts: {
        cc: Math.abs(i) >= SUPPLY_CC_FRACTION * m.limit ? 1 : 0, setpoint: m.volts,
        // An AC source (acsource.ts) carries its settings along for the readout.
        ...(m.ac ? { 'ac.vrms': m.ac.vrms, 'ac.freq': m.ac.freq } : {}),
      },
    };
    result.parts[id] = out;
    delete result.parts[limiterId(id)];
    delete result.parts[batteryId(id)];
    for (const key of Object.keys(result.nets)) {
      if (key.startsWith(`${limiterId(id)}:`) || key.startsWith(`${batteryId(id)}:`)) delete result.nets[key];
    }
  }
}
