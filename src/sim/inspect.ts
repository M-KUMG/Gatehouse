// The internal values of one part, as named quantities with units, for the
// Scope window (the part inspector, src/layout/inspector.ts). Headless and
// pure: everything is derived from a solver result (SimResult) and the
// part's model parameters; nothing is solved again.
//
// Sign conventions: values are shown in the device's own frame, so that a
// part in normal operation reads positive:
//   - NPN: Vbe, Vbc, Vce as they are; Ic into the collector, Ib into the
//     base, Ie out of the emitter.
//   - PNP: the same quantities (same ids) with the signs turned round and
//     labelled that way: Veb, Vcb, Vec; Ic out of the collector, Ib out of
//     the base, Ie into the emitter.
//   - N-MOSFET: Vgs, Vds, Id (into the drain). P-MOSFET: Vsg, Vsd, Isd
//     (ids vgs, vds, id). A device run backwards (drain below source for an
//     N-channel) gives negative Vds / Id; its region is judged with source
//     and drain swapped, like the model does.
//   - Two-terminal parts: V = a - b (anode - cathode), I from a to b.
//   - Battery: terminal V = pos - neg, I and P delivered to the circuit.
//   - Board: pin voltages against the board's gnd; rail currents delivered
//     out of the pin, the gnd current returning into it.
//
// Regions (documented thresholds, not a second model):
//   - BJT: a junction counts as forward-biased at 0.5 V or more (device
//     frame). BE on, BC off: active; both on: saturation; BC only:
//     reverse-active; neither: cutoff. (Vbe 0.7 V and Vce 0.2 V gives
//     Vbc 0.5 V: saturation; Vce 0.3 V is still active.)
//   - MOSFET: the Level-1 regions of mosfet.ts: cutoff Vgs <= Vth, triode
//     Vds < Vgs - Vth, else saturation. Rds(on) estimate 1 / (kp (Vgs - Vth))
//     (the slope at Vds = 0), undefined (NaN) in cutoff.
//   - Diode / LED: forward with more than 1 uA forward current, reverse
//     below -10 mV, else off.
//   - IGBT (the MOSFET + bipolar equivalent of the `igbt` model): cutoff
//     Vge <= Vth; else the internal MOSFET decides, in IGBT terms:
//     'saturation' (fully on, low Vce) while the MOSFET is in triode,
//     'active' (the gate limits the current) while it is saturated. A
//     P-IGBT reads in its own frame (Veg, Vec, Ic out of the collector).
//     Imos is the MOSFET channel current (= the bipolar base current), Ibjt
//     the rest of the collector current.
//   - Polarized capacitor: ESR, rated voltage and a state text from the
//     rating rules of ratings.ts ('ok', 'reverse!', 'over-voltage!').
//   - Part types in the rating table (specs.ts, InspectPart.type): a
//     'rating' text, 'ok' or the warning text ("Ic 130 mA exceeds its
//     100 mA rating."). Potentiometer: the power of each half of the track.

import { acsourceQuantities, bridgeQuantities, bulbQuantities, changeoverQuantities, ledbulbQuantities, transformerQuantities } from './acinspect';
import { driverQuantities } from './driverinspect';
import { opampQuantities, timerQuantities } from './icinspect';
import { buzzerQuantities, rgbledQuantities, sevensegQuantities, zenerQuantities } from './partinspect';
import { gateQuantities } from './gateinspect';
import { level1 } from './mosfet';
import { modelPins, terminalKey } from './nets';
import { dielectricVolts, igbtStress, plainCapStress, polarizedCapStress } from './ratings';
import { partSpec, specStress } from './specs';
import type { ComponentModel, PartResult, SimResult } from './types';

export type QuantityKind =
  | 'voltage' | 'current' | 'power' | 'charge' | 'energy' | 'flux' | 'resistance' | 'ratio' | 'text';

export interface Quantity {
  /** Stable id within the part (e.g. 'vce', 'ic', 'v:d13'): the graph remembers choices by it. */
  id: string;
  /** Short label with the symbol: "Vce", "Ic", "β", "D13 (LED L)". */
  label: string;
  kind: QuantityKind;
  /** SI unit for formatting ('' for plain numbers, '%' for brightness). */
  unit: string;
  /** The value (NaN when undefined, e.g. β with no base current); NaN for text. */
  value: number;
  /** Text quantities only (region, switch state). */
  text?: string;
  /** 'pin' for the pin voltage list after the main values. */
  group?: 'pin';
}

/** What inspect() needs to know about the part beyond its model. */
export interface InspectPart {
  /** Part (component) id in the circuit. */
  id: number;
  /** Pins in the part definition's order, with their display names. */
  pins?: readonly { id: string; name: string }[];
  /** A diode drawn as an LED: adds the brightness. */
  led?: boolean;
  /** Part type id: a type with a row in the rating table (specs.ts) gets a 'rating' text quantity. */
  type?: string;
  /** Why a burned part (model `open`) burned, for its status text. */
  burnedBy?: string;
}

/** Forward junction voltage at which a BJT junction counts as conducting (device frame). */
export const BJT_ON_VOLTS = 0.5;
/** Forward current above which a diode counts as conducting. */
export const DIODE_ON_AMPS = 1e-6;
/** Reverse voltage beyond which a diode counts as reverse-biased. */
export const DIODE_REVERSE_VOLTS = 0.01;

/** 0..1 for an LED current: just visible near 0.3 mA, dim at 1 mA, full at 15 mA. */
export function ledBrightness(amps: number): number {
  if (!(amps > 0.0003)) return 0;
  return Math.min(1, Math.log(amps / 0.0003) / Math.log(0.015 / 0.0003));
}

export type BjtRegion = 'cutoff' | 'active' | 'saturation' | 'reverse-active';
export type MosfetRegion = 'cutoff' | 'triode' | 'saturation';
export type DiodeRegion = 'forward' | 'reverse' | 'off';
export type IgbtRegion = 'cutoff' | 'active' | 'saturation';

/** Region of a BJT from its junction voltages in the device frame (positive = forward for that type). */
export function bjtRegion(vbeF: number, vbcF: number): BjtRegion {
  const on = BJT_ON_VOLTS - 1e-9; // 0.7 - 0.2 is 0.49999... in floating point
  const be = vbeF >= on;
  const bc = vbcF >= on;
  if (be) return bc ? 'saturation' : 'active';
  return bc ? 'reverse-active' : 'cutoff';
}

/** Region of a MOSFET from Vgs, Vds and Vth in the N-channel frame (source and drain swapped when vds < 0). */
export function mosfetRegion(vgs: number, vds: number, vth: number): MosfetRegion {
  const vgsE = vds >= 0 ? vgs : vgs - vds;
  const vdsE = Math.abs(vds);
  const vov = vgsE - vth;
  if (vov <= 0) return 'cutoff';
  return vdsE < vov ? 'triode' : 'saturation';
}

/**
 * Region of an IGBT from Vge and the internal MOSFET's Vds (the base node
 * against the emitter), device frame, Vth positive.
 */
export function igbtRegion(vge: number, vdsMos: number, vth: number): IgbtRegion {
  const region = mosfetRegion(vge, vdsMos, vth);
  if (region === 'cutoff') return 'cutoff';
  return region === 'triode' ? 'saturation' : 'active';
}

export function diodeRegion(v: number, i: number): DiodeRegion {
  if (i > DIODE_ON_AMPS) return 'forward';
  if (v < -DIODE_REVERSE_VOLTS) return 'reverse';
  return 'off';
}

const num = (id: string, label: string, kind: QuantityKind, unit: string, value: number): Quantity => ({ id, label, kind, unit, value });
const volts = (id: string, label: string, value: number): Quantity => num(id, label, 'voltage', 'V', value);
const amps = (id: string, label: string, value: number): Quantity => num(id, label, 'current', 'A', value);
const watts = (id: string, label: string, value: number): Quantity => num(id, label, 'power', 'W', value);
const text = (id: string, label: string, value: string): Quantity => ({ id, label, kind: 'text', unit: '', value: NaN, text: value });

/** a / b, or NaN when b is (practically) zero. */
function ratio(a: number, b: number): number {
  return Math.abs(b) > 1e-15 ? a / b : NaN;
}

/**
 * The internal values of part `part` (model `model`) in `result`: the main
 * quantities first (ids stable per part type), then the voltage of every pin
 * against the circuit's reference (group 'pin', ids 'v:<pin>'), except for
 * boards, whose pin voltages (against the board's gnd) are the main list.
 * Empty for parts without values (ground, junction); a single text quantity
 * 'status' when the solve failed or the part is not in the result.
 */
export function inspect(model: ComponentModel, result: SimResult, part: InspectPart): Quantity[] {
  if (model.kind === 'ground' || model.kind === 'node') return [];
  if (model.kind === 'open') {
    return [text('status', 'State', part.burnedBy ? `Open (burned out by ${part.burnedBy})` : 'Open (burned out)')];
  }
  const r = result.parts[part.id];
  if (!r) return [text('status', 'State', 'Not simulated')];
  if (!result.converged) return [text('status', 'State', 'No solution (the solver did not converge)')];
  const node = (pin: string): number => {
    const net = result.nets[terminalKey({ part: part.id, pin })];
    return net === undefined ? NaN : (result.voltages[net] ?? NaN);
  };
  if (model.kind === 'board') return boardQuantities(model, r, part);
  const main = mainQuantities(model, r, part, node);
  if (part.type !== undefined && partSpec(part.type)) {
    // The rating table's verdict: 'ok' or the warning / burn text (specs.ts).
    const st = specStress(part.type, r, model);
    main.push(text('rating', 'Rating', st.level === 'ok' ? 'ok' : st.reason));
  }
  const names = new Map((part.pins ?? []).map((p) => [p.id, p.name]));
  const pins = modelPins(model);
  const order = part.pins?.length ? part.pins.map((p) => p.id).filter((id) => pins.includes(id)) : pins;
  for (const pin of order) {
    main.push({ ...volts(`v:${pin}`, `V(${names.get(pin) ?? pin})`, node(pin)), group: 'pin' });
  }
  return main;
}

type ModelOf<K extends ComponentModel['kind']> = Extract<ComponentModel, { kind: K }>;

function mainQuantities(
  model: Exclude<ComponentModel, { kind: 'ground' | 'node' | 'open' | 'board' }>,
  r: PartResult, part: InspectPart, node: (pin: string) => number,
): Quantity[] {
  switch (model.kind) {
    case 'resistor': {
      const out = [volts('v', 'V', r.voltage), amps('i', 'I', r.current), watts('p', 'P', r.power), num('r', 'R', 'resistance', 'Ω', model.ohms)];
      // An LDR: the light level its resistance comes from.
      if (model.lux !== undefined) out.push(num('lux', 'Light', 'ratio', 'lx', model.lux));
      // An NTC thermistor: the temperature its resistance comes from.
      if (model.temp !== undefined) out.push(num('temp', 'Temperature', 'ratio', '°C', model.temp));
      return out;
    }
    case 'capacitor':
      return capacitor(model, r);
    case 'inductor':
      return inductor(model, r);
    case 'limiter':
      return [volts('v', 'V', r.voltage), amps('i', 'I', r.current)];
    case 'supply':
      return [
        volts('v', 'V', r.voltage), amps('i', 'I', r.current), watts('p', 'P', r.power),
        volts('set', 'Set voltage', model.volts), amps('limit', 'Current limit', model.limit),
        text('mode', 'Mode', (r.volts?.cc ?? 0) >= 0.5 ? 'constant current (limiting)' : 'constant voltage'),
      ];
    case 'acsource':
      return acsourceQuantities(model, r);
    case 'bulb':
      return bulbQuantities(model, r);
    case 'ledbulb':
      return ledbulbQuantities(model, r);
    case 'transformer':
      return transformerQuantities(model, r);
    case 'bridge':
      return bridgeQuantities(model, r);
    case 'changeover':
      return changeoverQuantities(model, r);
    case 'motor': {
      const w = r.volts?.['mech.omega'] ?? 0;
      return [
        volts('v', 'V', r.voltage), amps('i', 'I', r.current), watts('p', 'P', r.power),
        num('rpm', 'Speed', 'ratio', 'rpm', (w * 60) / (2 * Math.PI)), num('omega', 'ω', 'ratio', 'rad/s', w),
        num('torque', 'Torque', 'ratio', 'N·m', r.volts?.['mech.torque'] ?? 0), volts('emf', 'Back-EMF', r.volts?.['mech.emf'] ?? 0),
        text('state', 'Shaft', Math.abs(w) < 1 ? 'stopped' : w > 0 ? 'turning forward' : 'turning backward'),
      ];
    }
    case 'relay': {
      const on = (r.volts?.['logic.on'] ?? 0) >= 0.5;
      return [
        volts('vcoil', 'Coil V', r.voltage), amps('icoil', 'Coil I', r.current), watts('p', 'P', r.power),
        text('state', 'Armature', on ? 'pulled in (COM-NO closed)' : 'released (COM-NC closed)'),
        amps('icom', 'Contact I', Math.abs(r.pins.com ?? 0)),
        num('pull', 'Pull-in at', 'current', 'A', model.pullAmps), num('drop', 'Drop-out at', 'current', 'A', model.dropAmps),
        volts('nominal', 'Coil rating', model.coilVolts),
      ];
    }
    case 'signal':
      return [volts('v', 'V', r.voltage), amps('i', 'I', r.current), watts('p', 'P', r.power), num('f', 'f', 'ratio', 'Hz', model.freq), volts('amp', 'Amplitude', model.amp), volts('off', 'Offset', model.offset)];
    case 'battery':
      return [
        volts('v', 'V', r.voltage), amps('i', 'I', r.current), watts('p', 'P', r.power),
        watts('ploss', 'P loss', r.current * r.current * model.rInternal), volts('emf', 'EMF', model.volts),
      ];
    case 'diode':
      return model.bv !== undefined ? zenerQuantities(model, r) : diode(r, part.led === true);
    case 'buzzer':
      return buzzerQuantities(model, r);
    case 'sevenseg':
      return sevensegQuantities(model, r);
    case 'rgbled':
      return rgbledQuantities(model, r);
    case 'npn':
    case 'pnp':
      return bjt(model, r, node);
    case 'mosfet':
      return mosfet(model, r, node);
    case 'igbt':
      return igbt(model, r, node);
    case 'halfdriver':
      return driverQuantities(r);
    case 'timer555':
      return timerQuantities(r);
    case 'opamp':
      return opampQuantities(r);
    case 'gate':
      return gateQuantities(model, r);
    case 'switch':
      return [text('state', 'State', model.closed ? 'closed' : 'open'), amps('i', 'I', r.current), volts('v', 'V', r.voltage), watts('p', 'P', r.power)];
    case 'pot':
      return pot(model, r, node);
  }
}

function capacitor(model: ModelOf<'capacitor'>, r: PartResult): Quantity[] {
  // The charge sits on the ideal capacitance behind the ESR.
  const vc = dielectricVolts(r.voltage, r.current, model.esr);
  const out = [
    volts('v', 'V', r.voltage), amps('i', 'I', r.current), watts('p', 'P', r.power),
    num('q', 'Q', 'charge', 'C', model.farads * vc), num('e', 'E', 'energy', 'J', 0.5 * model.farads * vc * vc),
  ];
  if (model.ratedVolts !== undefined) {
    const stress = model.polarized ? polarizedCapStress(vc, model.ratedVolts) : plainCapStress(vc, model.ratedVolts);
    out.push(num('esr', 'ESR', 'resistance', 'Ω', model.esr ?? 0), volts('rated', 'Rated V', model.ratedVolts), text('state', 'State', stress.short));
  }
  return out;
}

function inductor(model: ModelOf<'inductor'>, r: PartResult): Quantity[] {
  return [
    volts('v', 'V', r.voltage), amps('i', 'I', r.current), watts('p', 'P', r.power),
    num('flux', 'Φ', 'flux', 'Wb', model.henries * r.current), num('e', 'E', 'energy', 'J', 0.5 * model.henries * r.current * r.current),
  ];
}

function diode(r: PartResult, led: boolean): Quantity[] {
  const out = [volts('vf', 'Vf', r.voltage), amps('if', 'If', r.current), watts('p', 'P', r.power)];
  if (led) out.push(num('brightness', 'Brightness', 'ratio', '%', 100 * ledBrightness(r.current)));
  out.push(text('region', 'Region', diodeRegion(r.voltage, r.current)));
  return out;
}

function bjt(model: ModelOf<'npn' | 'pnp'>, r: PartResult, node: (pin: string) => number): Quantity[] {
  const p = model.kind === 'npn' ? 1 : -1;
  const vc = node('c');
  const vb = node('b');
  const ve = node('e');
  const vbe = p * (vb - ve);
  const vbc = p * (vb - vc);
  const vce = p * (vc - ve);
  const ic = p * (r.pins.c ?? 0);
  const ib = p * (r.pins.b ?? 0);
  const ie = -p * (r.pins.e ?? 0);
  const n = p > 0;
  return [
    volts('vbe', n ? 'Vbe' : 'Veb', vbe), volts('vbc', n ? 'Vbc' : 'Vcb', vbc), volts('vce', n ? 'Vce' : 'Vec', vce),
    amps('ib', 'Ib', ib), amps('ic', 'Ic', ic), amps('ie', 'Ie', ie),
    num('beta', 'β (Ic/Ib)', 'ratio', '', ratio(ic, ib)),
    watts('p', 'P', r.power),
    text('region', 'Region', bjtRegion(vbe, vbc)),
  ];
}

function mosfet(model: ModelOf<'mosfet'>, r: PartResult, node: (pin: string) => number): Quantity[] {
  const p = model.polarity;
  const vgs = p * (r.volts?.g ?? node('g') - node('s'));
  const vds = p * (r.volts?.d ?? r.voltage);
  const id = p * r.current;
  const vth = p * model.vth;
  const region = mosfetRegion(vgs, vds, vth);
  const vov = (vds >= 0 ? vgs : vgs - vds) - vth;
  const n = p > 0;
  return [
    volts('vgs', n ? 'Vgs' : 'Vsg', vgs), volts('vds', n ? 'Vds' : 'Vsd', vds), amps('id', n ? 'Id' : 'Isd', id),
    watts('p', 'P', r.power),
    num('rds', 'Rds(on)', 'resistance', 'Ω', region === 'cutoff' ? NaN : 1 / (model.kp * vov)),
    text('region', 'Region', region),
  ];
}

function igbt(model: ModelOf<'igbt'>, r: PartResult, node: (pin: string) => number): Quantity[] {
  const p = model.polarity;
  const vge = p * (r.volts?.g ?? node('g') - node('e'));
  const vce = p * (r.volts?.c ?? r.voltage);
  const vbase = p * (r.volts?.base ?? NaN);
  const ic = p * r.current;
  const vth = p * model.vth;
  // The MOSFET's channel: drain = the internal base node, source = the emitter (swapped when reversed).
  const imos = Number.isNaN(vbase)
    ? NaN
    : vbase >= 0
      ? level1(vge, vbase, vth, model.kp, model.lambda).id
      : -level1(vge - vbase, -vbase, vth, model.kp, model.lambda).id;
  const n = p > 0;
  return [
    volts('vge', n ? 'Vge' : 'Veg', vge), volts('vce', n ? 'Vce' : 'Vec', vce), amps('ic', 'Ic', ic),
    watts('p', 'Pd', r.power),
    amps('imos', 'Imos (MOSFET)', imos), amps('ibjt', n ? 'Ibjt (PNP)' : 'Ibjt (NPN)', ic - imos),
    text('region', 'Region', Number.isNaN(vbase) ? 'unknown' : igbtRegion(vge, vbase, vth)),
    text('state', 'State', igbtStress(vce, ic, vge).short),
  ];
}

function pot(model: ModelOf<'pot'>, r: PartResult, node: (pin: string) => number): Quantity[] {
  const vaw = node('a') - node('w');
  const vwb = node('w') - node('b');
  const iaw = r.pins.a ?? 0;
  const iwb = -(r.pins.b ?? 0);
  return [
    volts('vw', 'V wiper', node('w')), volts('vaw', 'V(1–wiper)', vaw), volts('vwb', 'V(wiper–3)', vwb),
    amps('iaw', 'I(1→wiper)', iaw), amps('iwb', 'I(wiper→3)', iwb), amps('iw', 'I wiper (in)', r.pins.w ?? 0),
    watts('p', 'P', r.power), num('pos', 'Position', 'ratio', '%', 100 * Math.min(1, Math.max(0, model.position))),
    // Dissipation of each half of the track (the rating applies to each, see specs.ts).
    watts('paw', 'P(1–wiper)', vaw * iaw), watts('pwb', 'P(wiper–3)', vwb * iwb),
  ];
}

function boardQuantities(model: ModelOf<'board'>, r: PartResult, part: InspectPart): Quantity[] {
  const out: Quantity[] = [];
  const pinVolts = r.volts ?? {};
  const names = new Map((part.pins ?? []).map((p) => [p.id, p.name]));
  const known = part.pins?.length ? part.pins.map((p) => p.id) : ['gnd', ...Object.keys(model.rails), ...Object.keys(model.io)];
  for (const pin of known) {
    if (pin in pinVolts) out.push(volts(`v:${pin}`, names.get(pin) ?? pin, pinVolts[pin]));
  }
  for (const rail of Object.keys(model.rails)) {
    out.push(amps(`i:${rail}`, `I ${names.get(rail) ?? rail} (out)`, -(r.pins[rail] ?? 0)));
  }
  out.push(amps('i:gnd', `I ${names.get('gnd') ?? 'GND'} (return)`, r.pins.gnd ?? 0));
  out.push(watts('p', 'P delivered', r.power));
  return out;
}

/**
 * The quantities graphed by default for a part (ids, 2-3 per type): the main
 * voltage and current. Boards: none (the user picks pins).
 */
export function defaultPlot(model: ComponentModel): string[] {
  switch (model.kind) {
    case 'npn':
    case 'pnp':
      return ['vce', 'ic'];
    case 'mosfet':
      return ['vgs', 'vds', 'id'];
    case 'igbt':
      return ['vge', 'vce', 'ic'];
    case 'halfdriver':
      return ['vcc', 'vbs'];
    case 'timer555':
      return ['vthr', 'vout'];
    case 'opamp':
      return ['vo1', 'vd1'];
    case 'gate':
      return ['va', 'vy'];
    case 'diode':
      return ['vf', 'if'];
    case 'buzzer':
      return ['v', 'i'];
    case 'sevenseg':
    case 'rgbled':
      return ['i'];
    case 'pot':
      return ['vw', 'iaw'];
    case 'switch':
      return ['i'];
    case 'resistor':
    case 'capacitor':
    case 'inductor':
    case 'battery':
    case 'signal':
      return ['v', 'i'];
    case 'relay':
      return ['vcoil', 'icoil'];
    case 'supply':
    case 'acsource':
    case 'bulb':
    case 'ledbulb':
      return ['v', 'i'];
    case 'transformer':
      return ['vp', 'vs'];
    case 'bridge':
      return ['v', 'i'];
    case 'changeover':
      return ['i', 'v'];
    case 'motor':
      return ['rpm', 'i'];
    default:
      return [];
  }
}

/** Numeric values by id (text quantities left out), for the recorder. */
export function quantityValues(quantities: readonly Quantity[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const q of quantities) if (q.kind !== 'text') out.set(q.id, q.value);
  return out;
}
