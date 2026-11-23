// SPDT relay, model kind 'relay'. Pins: coil1, coil2 (the coil), com, no
// (normally open), nc (normally closed).
//
// How the solver sees it: before every solve `expandRelays` replaces the
// relay by plain parts with the same component id for the coil:
//   - the coil: an inductor (henries) with its winding resistance as dcr,
//     pins coil1 -> a, coil2 -> b, so the coil current rises with L/R like a
//     real coil (and a flyback diode across it works the way it does for real);
//   - two contacts as switches (com-no and com-nc, 10 mohm closed, 100 Gohm
//     open) whose state comes from the relay's logic state `on`.
// After the solve `relayResults` puts the pins back under the relay's own
// names (coil1, coil2, com, no, nc) and removes the helper parts.
//
// Logic state `on` (RelayLogic, kept like the gates' in TransientState.logic):
// the armature pulls in when the coil current reaches `pullAmps` and releases
// when it falls to `dropAmps` (by default 75 % and 10 % of nominal coil voltage).
// The decision uses the coil
// CURRENT (not the voltage), so the switching delay comes from L/R: about 4 ms
// to operate and 7 ms to release for the 5 V coil. A coil is not polarised
// (either direction pulls in), but the model has no diode: reverse current is
// allowed. No contact bounce, no contact welding, no arcing.
//
// Ratings: the coil above 1.3 x its nominal voltage warns, above 2 x burns;
// the contacts above 3 A warn, above 10 A burn (the burned relay is an open
// circuit and its contacts stay as they were... see parts.ts).

import type { ComponentModel, PartResult, SimInput, SimResult } from './types';

export type RelayModel = Extract<ComponentModel, { kind: 'relay' }>;

/** Nominal coil voltages and the winding resistance of a typical 10 A / 125-250 V cube relay (SRD series). */
export const RELAY_COILS: Readonly<Record<number, number>> = { 3: 25, 5: 70, 6: 100, 9: 225, 12: 400, 24: 1600 };
export const RELAY_COIL_VOLTS: readonly number[] = Object.keys(RELAY_COILS).map(Number);
export const RELAY_DEFAULT_VOLTS = 5;
/** Coil inductance (H): 0.2 H / 70 ohm = 2.9 ms (scaled with the resistance would be wrong: heavier windings are slower, use a fixed typical value). */
export const RELAY_HENRIES = 0.2;
export const RELAY_PULL_FRACTION = 0.75;
export const RELAY_DROP_FRACTION = 0.1;
export const RELAY_CONTACT_WARN_AMPS = 3;
export const RELAY_CONTACT_BURN_AMPS = 10;

export interface RelayCoilSettings {
  coilOhms?: number;
  pullVolts?: number;
  releaseVolts?: number;
}

/** The selected preset supplies defaults for any settings the user has left blank. */
export function relayCoilSettings(coilVolts: number, overrides: RelayCoilSettings = {}): Required<RelayCoilSettings> {
  const v = RELAY_COILS[coilVolts] !== undefined ? coilVolts : RELAY_DEFAULT_VOLTS;
  return {
    coilOhms: overrides.coilOhms ?? RELAY_COILS[v],
    pullVolts: overrides.pullVolts ?? RELAY_PULL_FRACTION * v,
    releaseVolts: overrides.releaseVolts ?? RELAY_DROP_FRACTION * v,
  };
}

/** Convert steady-state threshold voltages into the currents that move the armature. */
export function relayModel(coilVolts: number, overrides: RelayCoilSettings = {}): RelayModel {
  const v = RELAY_COILS[coilVolts] !== undefined ? coilVolts : RELAY_DEFAULT_VOLTS;
  const { coilOhms } = relayCoilSettings(v, overrides);
  const nominalAmps = v / coilOhms;
  return {
    kind: 'relay', coilVolts: v, coilOhms, coilHenries: RELAY_HENRIES,
    pullAmps: overrides.pullVolts === undefined ? RELAY_PULL_FRACTION * nominalAmps : overrides.pullVolts / coilOhms,
    dropAmps: overrides.releaseVolts === undefined ? RELAY_DROP_FRACTION * nominalAmps : overrides.releaseVolts / coilOhms,
  };
}

export interface RelayLogic {
  /** The armature is pulled in (NO closed, NC open). */
  on: boolean;
}
export const DEFAULT_RELAY_LOGIC: RelayLogic = { on: false };

export function isRelayLogic(l: unknown): l is RelayLogic {
  return typeof l === 'object' && l !== null && typeof (l as RelayLogic).on === 'boolean';
}

/** The new state from the coil current (hysteresis against the accepted state). */
export function decideRelay(prev: RelayLogic, coilAmps: number, m: RelayModel): RelayLogic {
  const i = Math.abs(coilAmps);
  if (i >= m.pullAmps) return { on: true };
  if (i <= m.dropAmps) return { on: false };
  return prev;
}

/** Id of the helper switch for contact `which` (0: com-no, 1: com-nc) of relay `id`; at most -2, clear of the solver's -1. */
export const contactId = (id: number, which: 0 | 1): number => -(id * 2 + 2 + which);

/** Switch ids are minus the relay ids, so a relay's helper parts never clash with another part. */
export function expandRelays(
  input: SimInput, logic: Readonly<Record<number, unknown>> | undefined,
): { input: SimInput; relays: { id: number; on: boolean }[] } {
  if (!input.components.some((c) => c.model.kind === 'relay')) return { input, relays: [] };
  const relays: { id: number; on: boolean }[] = [];
  const components: SimInput['components'] = [];
  const links: SimInput['links'] = [];
  const mapped = new Map<number, true>();
  for (const c of input.components) {
    if (c.model.kind !== 'relay') {
      components.push(c);
      continue;
    }
    const held = logic?.[c.id];
    const on = isRelayLogic(held) ? held.on : false;
    relays.push({ id: c.id, on });
    mapped.set(c.id, true);
    components.push({ id: c.id, model: { kind: 'inductor', henries: c.model.coilHenries, dcr: c.model.coilOhms } });
    components.push({ id: contactId(c.id, 0), model: { kind: 'switch', closed: on } });
    components.push({ id: contactId(c.id, 1), model: { kind: 'switch', closed: !on } });
    links.push([{ part: contactId(c.id, 0), pin: 'a' }, { part: contactId(c.id, 1), pin: 'a' }]);
  }
  const rename = (t: { part: number; pin: string }): { part: number; pin: string } => {
    if (!mapped.has(t.part)) return t;
    switch (t.pin) {
      case 'coil1': return { part: t.part, pin: 'a' };
      case 'coil2': return { part: t.part, pin: 'b' };
      case 'com': return { part: contactId(t.part, 0), pin: 'a' };
      case 'no': return { part: contactId(t.part, 0), pin: 'b' };
      case 'nc': return { part: contactId(t.part, 1), pin: 'b' };
      default: return t;
    }
  };
  for (const [a, b] of input.links) links.push([rename(a), rename(b)]);
  return { input: { ...input, components, links }, relays };
}

/**
 * Turns the solved helper parts back into the relay's own result: coil
 * voltage and current, pins coil1 coil2 com no nc (current into each), the
 * pin voltages and the armature state under 'logic.on' (0 or 1). The net
 * names of the relay's pins point to the helper parts' nets.
 */
export function relayResults(result: SimResult, relays: readonly { id: number; on: boolean }[]): void {
  for (const { id, on } of relays) {
    const coil = result.parts[id];
    const no = result.parts[contactId(id, 0)];
    const nc = result.parts[contactId(id, 1)];
    if (!coil || !no || !nc) continue;
    const volt = (n: number): number => result.voltages[n] ?? 0;
    const names: Record<string, string> = {
      coil1: `${id}:a`, coil2: `${id}:b`, com: `${contactId(id, 0)}:a`, no: `${contactId(id, 0)}:b`, nc: `${contactId(id, 1)}:b`,
    };
    const volts: Record<string, number> = { 'logic.on': on ? 1 : 0 };
    for (const [pin, key] of Object.entries(names)) {
      result.nets[`${id}:${pin}`] = result.nets[key] ?? 0;
      volts[pin] = volt(result.nets[key] ?? 0);
    }
    const out: PartResult = {
      voltage: coil.voltage,
      current: coil.current,
      power: coil.power + no.power + nc.power,
      pins: {
        coil1: coil.pins.a ?? 0, coil2: coil.pins.b ?? 0,
        com: (no.pins.a ?? 0) + (nc.pins.a ?? 0), no: no.pins.b ?? 0, nc: nc.pins.b ?? 0,
      },
      volts,
    };
    result.parts[id] = out;
    delete result.parts[contactId(id, 0)];
    delete result.parts[contactId(id, 1)];
    for (const key of Object.keys(result.nets)) {
      if (key.startsWith(`${contactId(id, 0)}:`) || key.startsWith(`${contactId(id, 1)}:`)) delete result.nets[key];
    }
  }
}

/** Current through the contacts (into com), for the rating and the readout. */
export function contactAmps(r: PartResult): number {
  return Math.abs(r.pins.com ?? 0);
}
