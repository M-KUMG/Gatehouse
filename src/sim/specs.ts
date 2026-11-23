// Absolute maximum ratings as data, one row per part type (PLAN step 7c),
// and the one generic rule that reads them. A part type with a row here
// warns and burns by it (parts.ts attaches warnWhen / burnWhen and makes a
// burned part an open circuit), the hover readout and the red "!" show the
// warning text, and the Scope inspector shows it as the part's State.
// Adding ratings to a part type needs only a row below.
//
// Every limit is one stressed quantity (a measure of the solver's result,
// positive in the direction that stresses the part), with:
//   rated      the datasheet's absolute maximum (shown in the texts),
//   warnAbove  above this the part is warned about (the red "!"),
//   burnAbove  above this it is destroyed (absent: a warning only).
// Semiconductors: warned above 80 % of the rating, burned above 1.5 x (2 x
// for power dissipation), so a short overload warns and a gross one burns;
// a BJT's reverse base-emitter voltage only warns (see bjtLimits).
// Instantaneous values only: no heating or time constant yet (step 7c later).
// The electrolytic capacitor and the IGBTs keep their own rules (ratings.ts).
//
// Strict vs forgiving: burnEnabled() is consulted by every burn decision; a
// user setting (out of scope for now) only has to change what it returns.
// With burning off, a limit beyond burnAbove is reported as a warning.

import { formatSI } from '../format';
import { BUZZER_DEFAULT_MAX_VOLTS } from './buzzer';
import { POT_END_OHMS } from './devices';
import type { Stress } from './ratings';
import type { ComponentModel, PartResult } from './types';

export interface Limit {
  /** Symbol in the texts: 'Ic', 'P', 'Vr'. */
  label: string;
  /** The cause as a noun phrase, read after "Burned out by": 'too much collector current'. */
  what: string;
  unit: 'A' | 'V' | 'W';
  /** Datasheet absolute maximum. */
  rated: number;
  warnAbove: number;
  burnAbove?: number;
  /** The stressed quantity from the result and the part's model (positive = stressing). */
  measure(r: PartResult, model: ComponentModel): number;
}

export interface PartSpec {
  /** Where the numbers come from. */
  source: string;
  limits: readonly Limit[];
}

let burning = true;

/** True when overstressed parts are destroyed (strict, the default); false: they are only warned about. */
export function burnEnabled(): boolean {
  return burning;
}

/** Switches burning on or off for every part type (for a future strict / forgiving setting, and tests). */
export function setBurnEnabled(on: boolean): void {
  burning = on;
}

/** Warn fraction and burn factor of semiconductor ratings (see the header). */
const SEMI_WARN = 0.8;
const SEMI_BURN = 1.5;
const SEMI_BURN_POWER = 2;

/** A semiconductor limit: warned above 80 % of `rated`, burned above `burn` x (null: a warning only). */
const semi = (
  label: string, what: string, unit: Limit['unit'], rated: number, measure: Limit['measure'], burn: number | null = SEMI_BURN,
): Limit => ({
  label, what, unit, rated, warnAbove: SEMI_WARN * rated, ...(burn === null ? {} : { burnAbove: burn * rated }), measure,
});

const pos = (v: number | undefined): number => v ?? 0;

/** A BJT's limits in its own frame (an NPN's values; a PNP's with the signs turned round). */
function bjtLimits(p: 1 | -1, vceo: number, icMax: number, pd: number, vebo: number): Limit[] {
  return [
    semi('Vce', 'collector-emitter over-voltage', 'V', vceo, (r) => p * r.voltage),
    semi('Ic', 'too much collector current', 'A', icMax, (r) => Math.abs(pos(r.pins.c))),
    semi('Pd', 'too much power', 'W', pd, (r) => r.power, SEMI_BURN_POWER),
    // Reverse base-emitter voltage (the base below the emitter of an NPN): a warning only. Beyond
    // VEBO the junction breaks down like a Zener (not modelled) and loses gain, but survives
    // when the current is limited, as in a base driven through a resistor.
    semi('Veb', 'reverse base-emitter voltage', 'V', vebo, (r) => -p * pos(r.volts?.b), null),
  ];
}

/** A MOSFET's limits in its own frame (an N-channel's values; a P-channel's with the signs turned round). */
function mosfetLimits(p: 1 | -1, vds: number, id: number, vgs: number): Limit[] {
  return [
    semi('Vds', 'drain-source over-voltage', 'V', vds, (r) => p * r.voltage),
    semi('Id', 'too much drain current', 'A', id, (r) => Math.abs(r.current)),
    semi('Vgs', 'gate over-voltage (the gate oxide broke down)', 'V', vgs, (r) => Math.abs(pos(r.volts?.g))),
  ];
}

/** Power in each half of a potentiometer's track (from the currents: a to wiper, wiper to b). */
function potSectionWatts(r: PartResult, model: ComponentModel): number {
  if (model.kind !== 'pot') return 0;
  const p = Math.min(1, Math.max(0, model.position));
  const raw = Math.max(model.ohms * p, POT_END_OHMS);
  const rwb = Math.max(model.ohms * (1 - p), POT_END_OHMS);
  const iaw = pos(r.pins.a);
  const iwb = pos(r.pins.b);
  return Math.max(iaw * iaw * raw, iwb * iwb * rwb);
}

/** Contact rating of the toggle switch and the push button (small PCB parts). */
const CONTACT: PartSpec = {
  source: 'small PCB toggle switch / 6 mm tactile button: contacts rated about 1 A; welded or burned at a few amps',
  limits: [{ label: 'I', what: 'too much current through the contacts', unit: 'A', rated: 1, warnAbove: 1, burnAbove: 3, measure: (r) => Math.abs(r.current) }],
};

/** The rating table, keyed by part type id (parts.ts). */
export const PART_SPECS: Readonly<Record<string, PartSpec>> = {
  resistor: {
    source: '1/4 W carbon film resistor: 0.25 W rated; burns (smokes) at about 4 x that',
    limits: [{ label: 'P', what: 'too much power', unit: 'W', rated: 0.25, warnAbove: 0.25, burnAbove: 1, measure: (r) => Math.abs(r.power) }],
  },
  led: {
    // Forward current: the LED part's warnAbove / burnAbove (30 mA / 100 mA), unchanged.
    source: '5 mm red LED: VR 5 V (reverse breakdown a few volts beyond)',
    limits: [{ label: 'Vr', what: 'reverse voltage', unit: 'V', rated: 5, warnAbove: 5, burnAbove: 8, measure: (r) => -r.voltage }],
  },
  diode: {
    source: '1N4148: IF 200 mA (IFRM 450 mA), VR 75 V, VRRM 100 V',
    limits: [
      { label: 'If', what: 'too much forward current', unit: 'A', rated: 0.2, warnAbove: 0.2, burnAbove: 0.5, measure: (r) => r.current },
      { label: 'Vr', what: 'reverse over-voltage', unit: 'V', rated: 75, warnAbove: 75, burnAbove: 100, measure: (r) => -r.voltage },
    ],
  },
  bjt: { source: 'BC547B: VCEO 45 V, IC 100 mA, Ptot 500 mW, VEBO 6 V', limits: bjtLimits(1, 45, 0.1, 0.5, 6) },
  pnp: { source: 'BC557B: VCEO -45 V, IC -100 mA, Ptot 500 mW, VEBO -5 V', limits: bjtLimits(-1, 45, 0.1, 0.5, 5) },
  nmos: { source: 'IRLZ44N: VDS 55 V, ID 47 A, VGS +-16 V', limits: mosfetLimits(1, 55, 47, 16) },
  pmos: { source: 'IRF9540N: VDS -100 V, ID -23 A, VGS +-20 V', limits: mosfetLimits(-1, 100, 23, 20) },
  pot: {
    source: 'carbon potentiometer: 0.25 W, taken per half of the track (the wiper sees the current of the smaller half)',
    limits: [{ label: 'P', what: 'too much power in the track', unit: 'W', rated: 0.25, warnAbove: 0.25, burnAbove: 1, measure: potSectionWatts }],
  },
  battery: {
    source: 'alkaline AA cell: about 1 A continuous at most (a warning only: it heats, it does not burn here)',
    limits: [{ label: 'I', what: 'too much current', unit: 'A', rated: 1, warnAbove: 1, measure: (r) => Math.abs(r.current) }],
  },
  battery9v: {
    source: 'alkaline 9 V block: about 0.5 A continuous at most (a warning only)',
    limits: [{ label: 'I', what: 'too much current', unit: 'A', rated: 0.5, warnAbove: 0.5, measure: (r) => Math.abs(r.current) }],
  },
  switch: CONTACT,
  button: CONTACT,
  mainsswitch: {
    source: 'wall light switch: 10 A at 230 V; contacts welded or burned at 16 A (instantaneous values, so a lamp\'s switch-on surge counts)',
    limits: [{ label: 'I', what: 'too much current through the contacts', unit: 'A', rated: 10, warnAbove: 10, burnAbove: 16, measure: (r) => Math.abs(r.current) }],
  },
  changeover: {
    source: 'wall changeover (two-way) switch: 10 A at 230 V; contacts welded or burned at 16 A (instantaneous values)',
    limits: [{ label: 'I', what: 'too much current through the contacts', unit: 'A', rated: 10, warnAbove: 10, burnAbove: 16, measure: (r) => Math.abs(r.current) }],
  },
  zener: {
    // Breakdown is its normal use: no reverse-voltage limit, the power limits it.
    source: '1N4733A: Pd 1 W (warned above 80 %, burned at 2 x); forward current about 200 mA (Vf 1.2 V max there)',
    limits: [
      semi('P', 'too much power', 'W', 1, (r) => Math.abs(r.power), SEMI_BURN_POWER),
      semi('If', 'too much forward current', 'A', 0.2, (r) => r.current),
    ],
  },
  schottky: {
    source: '1N5819: IF(AV) 1 A (IFSM 25 A surge), VRRM 40 V',
    limits: [
      { label: 'If', what: 'too much forward current', unit: 'A', rated: 1, warnAbove: 1, burnAbove: 3, measure: (r) => r.current },
      { label: 'Vr', what: 'reverse over-voltage', unit: 'V', rated: 40, warnAbove: 40, burnAbove: 60, measure: (r) => -r.voltage },
    ],
  },
  ldr: {
    source: 'GL55-series CdS photoresistor: 100 mW; burns at about 2 x that',
    limits: [{ label: 'P', what: 'too much power', unit: 'W', rated: 0.1, warnAbove: 0.1, burnAbove: 0.2, measure: (r) => Math.abs(r.power) }],
  },
  ntc: {
    source: '10 k NTC thermistor (MF52-type, B 3950): 0.5 W maximum power; burns at about 2 x that',
    limits: [{ label: 'P', what: 'too much power', unit: 'W', rated: 0.5, warnAbove: 0.5, burnAbove: 1, measure: (r) => Math.abs(r.power) }],
  },
  rgbled: {
    // Per colour, like the single red LED (30 mA warns, 100 mA burns).
    source: '5 mm RGB LED: IF 20..30 mA per colour (IFP 100 mA)',
    limits: [{
      label: 'If', what: 'too much colour current', unit: 'A', rated: 0.03, warnAbove: 0.03, burnAbove: 0.1,
      measure: (r) => Math.max(0, ...['r', 'g', 'b'].map((c) => r.pins[c] ?? 0)),
    }],
  },
  buzzer: {
    source: '5 V active buzzer: operating 3..6.5 V (warned above), destroyed above 15 V, or above 12 V reversed',
    limits: [
      { label: 'V', what: 'over-voltage', unit: 'V', rated: BUZZER_DEFAULT_MAX_VOLTS, warnAbove: BUZZER_DEFAULT_MAX_VOLTS, burnAbove: 15, measure: (r) => r.voltage },
      { label: 'Vr', what: 'reverse voltage', unit: 'V', rated: 12, warnAbove: 0.8 * 12, burnAbove: 12, measure: (r) => -r.voltage },
    ],
  },
  sevenseg: {
    // Per segment, like the single red LED (30 mA warns, 100 mA burns).
    source: '0.56 in red 7-segment display: IF 25..30 mA per segment (IFP 100 mA)',
    limits: [{
      label: 'If', what: 'too much segment current', unit: 'A', rated: 0.03, warnAbove: 0.03, burnAbove: 0.1,
      measure: (r) => Math.max(0, ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((s) => r.pins[s] ?? 0)),
    }],
  },
};

/** The ratings of a part type, or undefined when it has none in the table. */
export function partSpec(typeId: string): PartSpec | undefined {
  return Object.hasOwn(PART_SPECS, typeId) ? PART_SPECS[typeId] : undefined;
}

const fmt = (v: number, unit: string): string => formatSI(v, unit);

/**
 * How a part of type `typeId` with model `model` stands against its ratings
 * in result `r`: burned when a limit's burnAbove is exceeded (and burning is
 * enabled), else warned when a warnAbove is; ok otherwise (also for a type
 * without a row). Texts: warn "Ic 130 mA exceeds its 100 mA rating.",
 * burn "too much collector current (Ic 160 mA, rated 100 mA)".
 */
export function specStress(typeId: string, r: PartResult, model: ComponentModel): Stress {
  const spec = partSpec(typeId);
  if (!spec) return { level: 'ok', short: 'ok' };
  const values = spec.limits.map((limit) => {
    let rated: number | undefined;
    if ((typeId === 'diode' || typeId === 'schottky') && model.kind === 'diode') {
      rated = limit.label === 'If' ? model.ratedForwardAmps : model.ratedReverseVolts;
    } else if (limit.label === 'P' && (model.kind === 'resistor' || model.kind === 'pot')) {
      rated = model.ratedWatts;
    } else if (limit.label === 'I' && (model.kind === 'switch' || model.kind === 'changeover')) {
      rated = model.ratedContactAmps;
    } else if (limit.label === 'V' && model.kind === 'buzzer') {
      rated = model.ratedMaxVolts;
    }
    if (rated === undefined) return { l: limit, v: limit.measure(r, model) };
    const scale = rated / limit.rated;
    const l = { ...limit, rated, warnAbove: limit.warnAbove * scale,
      burnAbove: limit.burnAbove === undefined ? undefined : limit.burnAbove * scale };
    return { l, v: l.measure(r, model) };
  });
  for (const { l, v } of values) {
    if (l.burnAbove === undefined || !(v > l.burnAbove)) continue;
    const short = `${l.label} too high!`;
    if (burnEnabled()) return { level: 'burn', short, reason: `${l.what} (${l.label} ${fmt(v, l.unit)}, rated ${fmt(l.rated, l.unit)})` };
    return { level: 'warn', short, reason: `${l.label} ${fmt(v, l.unit)} is far beyond its ${fmt(l.rated, l.unit)} rating.` };
  }
  for (const { l, v } of values) {
    if (!(v > l.warnAbove)) continue;
    const reason = v > l.rated
      ? `${l.label} ${fmt(v, l.unit)} exceeds its ${fmt(l.rated, l.unit)} rating.`
      : `${l.label} ${fmt(v, l.unit)} is near its ${fmt(l.rated, l.unit)} rating.`;
    return { level: 'warn', short: `${l.label} high!`, reason };
  }
  return { level: 'ok', short: 'ok' };
}
