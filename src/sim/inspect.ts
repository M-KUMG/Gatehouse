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

import { level1 } from './mosfet';
import { modelPins, terminalKey } from './nets';
import { dielectricVolts, igbtStress, polarizedCapStress } from './ratings';
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
  if (model.kind === 'open') return [text('status', 'State', 'Open (burned out)')];
  const r = result.parts[part.id];
  if (!r) return [text('status', 'State', 'Not simulated')];
  if (!result.converged) return [text('status', 'State', 'No solution (the solver did not converge)')];
  const node = (pin: string): number => {
    const net = result.nets[terminalKey({ part: part.id, pin })];
    return net === undefined ? NaN : (result.voltages[net] ?? NaN);
  };
  if (model.kind === 'board') return boardQuantities(model, r, part);
  const main = mainQuantities(model, r, part, node);
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
    case 'resistor':
      return [volts('v', 'V', r.voltage), amps('i', 'I', r.current), watts('p', 'P', r.power), num('r', 'R', 'resistance', 'Ω', model.ohms)];
    case 'capacitor':
      return capacitor(model, r);
    case 'inductor':
      return inductor(model, r);
    case 'battery':
      return [
        volts('v', 'V', r.voltage), amps('i', 'I', r.current), watts('p', 'P', r.power),
        watts('ploss', 'P loss', r.current * r.current * model.rInternal), volts('emf', 'EMF', model.volts),
      ];
    case 'diode':
      return diode(r, part.led === true);
    case 'npn':
    case 'pnp':
      return bjt(model, r, node);
    case 'mosfet':
      return mosfet(model, r, node);
    case 'igbt':
      return igbt(model, r, node);
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
  if (model.polarized && model.ratedVolts !== undefined) {
    out.push(
      num('esr', 'ESR', 'resistance', 'Ω', model.esr ?? 0), volts('rated', 'Rated V', model.ratedVolts),
      text('state', 'State', polarizedCapStress(vc, model.ratedVolts).short),
    );
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
  return [
    volts('vw', 'V wiper', node('w')), volts('vaw', 'V(1–wiper)', node('a') - node('w')), volts('vwb', 'V(wiper–3)', node('w') - node('b')),
    amps('iaw', 'I(1→wiper)', r.pins.a ?? 0), amps('iwb', 'I(wiper→3)', -(r.pins.b ?? 0)), amps('iw', 'I wiper (in)', r.pins.w ?? 0),
    watts('p', 'P', r.power), num('pos', 'Position', 'ratio', '%', 100 * Math.min(1, Math.max(0, model.position))),
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
    case 'diode':
      return ['vf', 'if'];
    case 'pot':
      return ['vw', 'iaw'];
    case 'switch':
      return ['i'];
    case 'resistor':
    case 'capacitor':
    case 'inductor':
    case 'battery':
      return ['v', 'i'];
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
