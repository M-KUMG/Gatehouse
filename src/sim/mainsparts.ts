// Two parts that are small circuits in themselves, model kinds 'bridge' and 'changeover'.
//
// Bridge rectifier ('bridge'). Pins: ac1, ac2 (the AC side), pos, neg (the DC side). Four diodes (1N4007-like, a
// series resistance that falls with the rated current): ac1 and ac2 each go up to pos and down from neg, so the
// output is the AC input with the negative half turned over, less two diode drops. Rated by the reverse voltage
// every diode can block (`volts`) and the average output current (`amps`, IF(AV)).
//
// Changeover switch ('changeover', SPDT). Pins: com, no, nc. The common pin is joined to `no` when `no` is true,
// else to `nc` (break before make: one contact opens as the other closes, in the same step).
//
// How the solver sees them: before every solve `expandMains` replaces each part by its helper parts (diodes or
// switches, negative ids, never clashing with the other helpers: see helperId) joined by links, and renames the
// part's pins to the helpers' pins. After the solve `mainsResults` puts the pins back under the part's own names,
// gives it a result of its own and removes the helpers.
//
// The bridge's logic state is the average of its output current (first order, 50 ms), which is what its thermal
// rating (IF(AV)) is judged on: a rectifier feeding a smoothing capacitor takes tall short pulses that the plain
// instantaneous value would call an overload (BridgeLogic, kept like the bulbs' in TransientState.logic).

import type { ComponentModel, PartResult, SimInput, SimResult } from './types';

export type BridgeModel = Extract<ComponentModel, { kind: 'bridge' }>;
export type ChangeoverModel = Extract<ComponentModel, { kind: 'changeover' }>;

export const BRIDGE_DEFAULT_VOLTS = 400;
export const BRIDGE_DEFAULT_AMPS = 2;
export const BRIDGE_MIN_VOLTS = 10;
export const BRIDGE_MAX_VOLTS = 2000;
export const BRIDGE_MIN_AMPS = 0.1;
export const BRIDGE_MAX_AMPS = 50;
/** Average current from which the bridge is warned about / burned (times its rating). */
export const BRIDGE_WARN_RATIO = 1;
export const BRIDGE_BURN_RATIO = 2;
/** Peak current (times the average rating) from which it is warned about / burned: the surge rating, IFSM. */
export const BRIDGE_SURGE_WARN_RATIO = 20;
export const BRIDGE_SURGE_BURN_RATIO = 30;
/** Reverse voltage above which a diode of the bridge burns (times its rating; the same margin as the 1N4148). */
export const BRIDGE_REVERSE_BURN_RATIO = 4 / 3;
/** Time constant (s) of the average current. */
const BRIDGE_AVERAGE_SECONDS = 0.05;

/** Contacts of the mains changeover switch: rated like the mains switch (specs.ts). */
export const CHANGEOVER_DEFAULT_NO = false;

// ---- Helper parts ------------------------------------------------------------------------------------------------

/** Helper ids: far below the relay-style helpers (relay.ts contactId, which stay above -1e6), and 4 per part. */
const helperId = (id: number, k: number): number => -(1e6 + id * 4 + k);

/** The 1N4007-like diode of a bridge rated `amps`: about 0.9 V at the rated current. */
export function bridgeDiode(amps: number): ComponentModel {
  return { kind: 'diode', is: 7e-9, n: 1.8, rs: 0.1 / Math.max(amps, BRIDGE_MIN_AMPS) };
}

// Diode k: 0: ac1 -> pos, 1: ac2 -> pos, 2: neg -> ac1, 3: neg -> ac2.

export interface MainsInfo {
  id: number;
  kind: 'bridge' | 'changeover';
  /** A changeover: the common pin is joined to `no` (else to `nc`). */
  no?: boolean;
}

export function expandMains(input: SimInput): { input: SimInput; parts: MainsInfo[] } {
  if (!input.components.some((c) => c.model.kind === 'bridge' || c.model.kind === 'changeover')) return { input, parts: [] };
  const parts: MainsInfo[] = [];
  const components: SimInput['components'] = [];
  const links: SimInput['links'] = [];
  /** part id -> the terminal each of its pins becomes. */
  const pinMap = new Map<number, Record<string, { part: number; pin: string }>>();
  for (const c of input.components) {
    const m = c.model;
    if (m.kind === 'bridge') {
      parts.push({ id: c.id, kind: 'bridge' });
      const diode = bridgeDiode(m.amps);
      for (let k = 0; k < 4; k++) components.push({ id: helperId(c.id, k), model: diode });
      // Joins: pos (D0, D1 cathodes), neg (D2, D3 anodes), ac1 (D0 anode, D2 cathode), ac2 (D1 anode, D3 cathode).
      links.push([{ part: helperId(c.id, 0), pin: 'cathode' }, { part: helperId(c.id, 1), pin: 'cathode' }]);
      links.push([{ part: helperId(c.id, 2), pin: 'anode' }, { part: helperId(c.id, 3), pin: 'anode' }]);
      links.push([{ part: helperId(c.id, 0), pin: 'anode' }, { part: helperId(c.id, 2), pin: 'cathode' }]);
      links.push([{ part: helperId(c.id, 1), pin: 'anode' }, { part: helperId(c.id, 3), pin: 'cathode' }]);
      pinMap.set(c.id, {
        ac1: { part: helperId(c.id, 0), pin: 'anode' }, ac2: { part: helperId(c.id, 1), pin: 'anode' },
        pos: { part: helperId(c.id, 0), pin: 'cathode' }, neg: { part: helperId(c.id, 2), pin: 'anode' },
      });
    } else if (m.kind === 'changeover') {
      parts.push({ id: c.id, kind: 'changeover', no: m.no });
      components.push({ id: helperId(c.id, 0), model: { kind: 'switch', closed: m.no } });
      components.push({ id: helperId(c.id, 1), model: { kind: 'switch', closed: !m.no } });
      links.push([{ part: helperId(c.id, 0), pin: 'a' }, { part: helperId(c.id, 1), pin: 'a' }]);
      pinMap.set(c.id, {
        com: { part: helperId(c.id, 0), pin: 'a' }, no: { part: helperId(c.id, 0), pin: 'b' }, nc: { part: helperId(c.id, 1), pin: 'b' },
      });
    } else {
      components.push(c);
    }
  }
  const rename = (t: { part: number; pin: string }): { part: number; pin: string } => pinMap.get(t.part)?.[t.pin] ?? t;
  for (const [a, b] of input.links) links.push([rename(a), rename(b)]);
  return { input: { ...input, components, links }, parts };
}

// ---- Bridge logic ------------------------------------------------------------------------------------------------

export interface BridgeLogic {
  /** Average output current in amps (first order, 50 ms). */
  avg: number;
}
export const DEFAULT_BRIDGE_LOGIC: BridgeLogic = { avg: 0 };

export function isBridgeLogic(l: unknown): l is BridgeLogic {
  return typeof l === 'object' && l !== null && Number.isFinite((l as BridgeLogic).avg);
}

/** The new average from the output current; a static solve (dt 0) takes the present value (steady state). */
export function decideBridge(prev: BridgeLogic, amps: number, dt: number): BridgeLogic {
  const now = Math.abs(amps);
  if (!(dt > 0)) return { avg: now };
  const k = dt / BRIDGE_AVERAGE_SECONDS;
  return { avg: (prev.avg + k * now) / (1 + k) };
}

export function sameBridge(a: BridgeLogic, b: BridgeLogic): boolean {
  return Math.abs(a.avg - b.avg) <= 1e-6 * Math.max(1e-3, Math.abs(b.avg));
}

// ---- Results -----------------------------------------------------------------------------------------------------

/**
 * Gives each expanded part a result under its own pin names and removes the helpers. A bridge: voltage and current
 * are those of its DC output (pos - neg, the current it delivers), power what the diodes dissipate, and under
 * `volts`: 'ac' (ac1 - ac2), 'i.avg' (the average output current), 'i.peak' (the largest diode current now) and
 * 'vr' (the largest reverse voltage across a diode now). A changeover: the current through com,
 * the voltage com to the closed throw, and under `volts` the pin voltages and 'pos' (1 when `no` is connected).
 */
export function mainsResults(
  result: SimResult, parts: readonly MainsInfo[], logic: Readonly<Record<number, unknown>> | undefined,
): void {
  for (const info of parts) {
    const { id, kind } = info;
    const helpers = [0, 1, 2, 3].map((k) => result.parts[helperId(id, k)]);
    const used = kind === 'bridge' ? helpers : helpers.slice(0, 2);
    if (used.some((h) => !h)) continue;
    const volt = (n: number): number => result.voltages[n] ?? 0;
    const names: Record<string, string> = kind === 'bridge'
      ? { ac1: `${helperId(id, 0)}:anode`, ac2: `${helperId(id, 1)}:anode`, pos: `${helperId(id, 0)}:cathode`, neg: `${helperId(id, 2)}:anode` }
      : { com: `${helperId(id, 0)}:a`, no: `${helperId(id, 0)}:b`, nc: `${helperId(id, 1)}:b` };
    const volts: Record<string, number> = {};
    for (const [pin, key] of Object.entries(names)) {
      result.nets[`${id}:${pin}`] = result.nets[key] ?? 0;
      volts[pin] = volt(result.nets[key] ?? 0);
    }
    const power = used.reduce((s, h) => s + (h?.power ?? 0), 0);
    let out: PartResult;
    if (kind === 'bridge') {
      const [d0, d1, d2, d3] = helpers as PartResult[];
      const pins = {
        ac1: (d0.pins.anode ?? 0) + (d2.pins.cathode ?? 0), ac2: (d1.pins.anode ?? 0) + (d3.pins.cathode ?? 0),
        pos: (d0.pins.cathode ?? 0) + (d1.pins.cathode ?? 0), neg: (d2.pins.anode ?? 0) + (d3.pins.anode ?? 0),
      };
      const held = logic?.[id];
      volts.ac = volts.ac1 - volts.ac2;
      volts['i.avg'] = isBridgeLogic(held) ? held.avg : 0;
      volts['i.peak'] = Math.max(...helpers.map((h) => Math.abs(h?.current ?? 0)));
      volts.vr = Math.max(0, ...helpers.map((h) => -(h?.voltage ?? 0)));
      out = { voltage: volts.pos - volts.neg, current: -pins.pos, power, pins, volts };
    } else {
      const [no, nc] = helpers as PartResult[];
      const throwPin = info.no ? 'no' : 'nc';
      volts.pos = info.no ? 1 : 0;
      const amps = (no.pins.a ?? 0) + (nc.pins.a ?? 0);
      out = { voltage: volts.com - (volts[throwPin] ?? 0), current: amps, power, pins: { com: amps, no: no.pins.b ?? 0, nc: nc.pins.b ?? 0 }, volts };
    }
    result.parts[id] = out;
    for (let k = 0; k < 4; k++) delete result.parts[helperId(id, k)];
    for (const key of Object.keys(result.nets)) {
      for (let k = 0; k < 4; k++) if (key.startsWith(`${helperId(id, k)}:`)) delete result.nets[key];
    }
  }
}

// ---- Ratings -----------------------------------------------------------------------------------------------------

type Stress = { level: 'ok' } | { level: 'warn' | 'burn'; short: string; reason: string };

/** A bridge against its three ratings: reverse voltage, average current (heat) and surge current. */
export function bridgeStress(m: BridgeModel, r: PartResult): Stress {
  const vr = r.volts?.vr ?? 0;
  const avg = r.volts?.['i.avg'] ?? 0;
  const peak = r.volts?.['i.peak'] ?? 0;
  if (vr > BRIDGE_REVERSE_BURN_RATIO * m.volts) {
    return { level: 'burn', short: 'reverse!', reason: `reverse breakdown (${Math.round(vr)} V across a diode, rated ${m.volts} V)` };
  }
  if (peak > BRIDGE_SURGE_BURN_RATIO * m.amps) {
    return { level: 'burn', short: 'surge!', reason: `surge current (${peak.toFixed(1)} A, rated ${m.amps} A average)` };
  }
  if (avg > BRIDGE_BURN_RATIO * m.amps) {
    return { level: 'burn', short: 'overheated!', reason: `overheated (${avg.toFixed(2)} A average, rated ${m.amps} A)` };
  }
  if (vr > m.volts) return { level: 'warn', short: 'over-voltage!', reason: `${Math.round(vr)} V across a diode is above its ${m.volts} V rating.` };
  if (avg > BRIDGE_WARN_RATIO * m.amps) return { level: 'warn', short: 'overloaded!', reason: `${avg.toFixed(2)} A average is above its ${m.amps} A rating.` };
  if (peak > BRIDGE_SURGE_WARN_RATIO * m.amps) return { level: 'warn', short: 'surge!', reason: `Surge of ${peak.toFixed(1)} A: far above its ${m.amps} A rating.` };
  return { level: 'ok' };
}
