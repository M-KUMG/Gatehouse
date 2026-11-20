// Part type definitions: all data. Sizes are in grid cells; the artwork
// (SVG, see src/art) fills a (cols x rows) cell box and its leads end on
// grid points, which is where the pins are.
// To add a part: draw its art in src/art and add one entry below.

import { CAPACITOR_ART } from './art/capacitor';
import { ECAP_ART, ECAP_BURNED_SVG } from './art/ecap';
import { INDUCTOR_ART } from './art/inductor';
import { BATTERY_ART } from './art/battery';
import { BATTERY_9V_ART } from './art/battery9v';
import { DIODE_ART } from './art/diode';
import { GROUND_ART } from './art/ground';
import { LED_ART, LED_BURNED_SVG, drawLedGlow } from './art/led';
import { POT_ART, POT_KNOB, drawPotPointer } from './art/pot';
import { PUSH_BUTTON_ART, PUSH_BUTTON_PRESSED_SVG } from './art/pushbutton';
import { RESISTOR_ART, resistorArt } from './art/resistor';
import { TOGGLE_ART, TOGGLE_ON_SVG } from './art/toggle';
import { NMOS_ART, PMOS_ART } from './art/to220';
import { IGBT_ART, IGBT_BURNED_SVG, PIGBT_ART, PIGBT_BURNED_SVG } from './art/to247';
import { DRIVER_ART, DRIVER_BURNED_SVG, DRIVER_PIN_POINTS } from './art/driver';
import { driverReadout } from './devicereadouts';
import { driverStress } from './sim/driver';
import { GATE_PARTS } from './gateparts';
import { DIODE_FAMILY_PARTS, OUTPUT_SENSOR_PARTS } from './basicparts';
import { PNP_ART, TRANSISTOR_ART } from './art/transistor';
import { NANO_ART, NANO_LEFT, NANO_RESET, NANO_RIGHT, drawNanoLeds } from './art/nano';
import { UNO_ART, UNO_BOTTOM, UNO_RESET, UNO_TOP, drawUnoLeds, type HeaderPin } from './art/uno';
import { ART_CELL } from './art/common';
import { diodeReadout, ecapReadout, igbtReadout, mosfetReadout, pnpReadout, reactiveReadout } from './devicereadouts';
import type { BoardSpec } from './mcu/board';
import { NANO_SPEC, UNO_SPEC } from './mcu/avr/uno';
import { parseBoardId } from './project/boardidparse';
import { ledBrightness } from './sim/inspect';
import { dielectricVolts, igbtStress, polarizedCapStress, type Stress } from './sim/ratings';
import { partSpec, specStress } from './sim/specs';
import {
  BC547, BC557, D1N4148, GENERIC_IGBT, GENERIC_PIGBT, LOGIC_NMOS, POWER_PMOS, RED_LED, type ComponentModel, type PartResult,
} from './sim';

/** What a placed part remembers besides its position. Plain serializable data. */
export interface PartState {
  /** Switches and buttons: contact closed. */
  closed?: boolean;
  /** Potentiometer wiper, 0..1. */
  position?: number;
  /** Editable main value (ohms for resistors and potentiometers, farads for capacitors, henries for inductors). */
  value?: number;
  /** Destroyed (too much current, or a rating rule: see PartType.burnWhen). */
  burned?: boolean;
  /** Why it burned ("too much current", "reverse voltage ..."), set together with `burned`. */
  burnedBy?: string;
  /** Boards only: the user's display name (see project/boardname.ts); without it the board shows its default label. */
  name?: string;
  /** Logic gates only: the supply (logic high) level in volts, one of GATE_VCC_CHOICES (see gateparts.ts). */
  vcc?: number;
  /** LDR only: the light falling on it in lux, LDR_MIN_LUX..LDR_MAX_LUX (see ldrOhms in basicparts.ts). */
  lux?: number;
}

export interface PinDef {
  id: string;
  name: string;
  /** Grid point inside the unrotated cell box: 0..cols, 0..rows. */
  x: number;
  y: number;
}

export interface PartType {
  id: string;
  name: string;
  cols: number;
  rows: number;
  /** Standalone SVG document, viewBox (cols * ART_CELL) x (rows * ART_CELL). */
  svg: string;
  pins: readonly PinDef[];
  /** Pairs of pins that are the same piece of metal inside the part. */
  links?: readonly (readonly [string, string])[];
  /** State of a newly placed part. */
  defaults?: PartState;
  /**
   * The editable `state.value` (or `state[key]`). With `options` only those
   * values are allowed (the popup offers a choice list).
   */
  value?: { label: string; unit: string; min: number; max: number; key?: 'value' | 'vcc' | 'lux'; options?: readonly number[] };
  /** Mouse behavior: closed while held, flips on click, or has a knob to turn. */
  control?: 'momentary' | 'toggle' | 'knob';
  /** Knob circle in cells inside the unrotated cell box. */
  knob?: { x: number; y: number; r: number };
  /** Amps above which the part is warned about / destroyed. */
  warnAbove?: number;
  burnAbove?: number;
  /**
   * Rating rules beyond the current limits above (voltage, polarity, ...):
   * the warning text while the part is overstressed, or null. Shown in the
   * hover readout and as the red "!" (see partWarning).
   */
  warnWhen?(result: PartResult, state: PartState): string | null;
  /**
   * The reason the part is destroyed by this result, or null. A burned part
   * stays burned (state.burned, state.burnedBy) until it is clicked; its
   * `sim` and `variant` show it burned. See burnReason and Simulation.burnParts.
   */
  burnWhen?(result: PartResult, state: PartState): string | null;
  /** Different artwork for some states (key identifies the look), or null for `svg`. */
  variant?(state: PartState): { key: string; svg: string } | null;
  /** Live drawing on top of the artwork; the canvas is in art units, unrotated. */
  overlay?(ctx: CanvasRenderingContext2D, state: PartState, result: PartResult | undefined): void;
  /** Hover text lines for the simulated values (default: chosen from the pins, see src/readout.ts). */
  readout?(result: PartResult): string[];
  /** Electrical model; its pin names are this part's pin ids. */
  sim?(state: PartState): ComponentModel;
  /**
   * True for parts whose mirror image is a different layout (see "Which parts
   * can be mirrored" above PARTS). Absent means false. See canMirror and
   * PlacedPart.mirrorX.
   */
  mirrorable?: boolean;
  /** A microcontroller board: runs programs (see src/mcu). */
  board?: BoardSpec;
  /**
   * Boards: the reset button drawn on the art, as a box in cells inside the
   * unrotated cell box. A click on it (not a drag) resets the board; it
   * rotates with the part (see src/boardcontrols.ts).
   */
  resetButton?: { x: number; y: number; w: number; h: number };
  /**
   * Boards: file extensions (lower case, no dot) of the source files that can
   * be imported into this board's folder. A board type without any accepts no
   * imports. A future Raspberry Pi Pico type lists 'py' and friends here; the
   * explorer needs no change.
   */
  sourceExtensions?: readonly string[];
}

const DEFAULT_OHMS = 220;
const DEFAULT_POT_OHMS = 10_000;
const DEFAULT_FARADS = 100e-9;
const DEFAULT_HENRIES = 10e-3;
/** Series resistance that keeps an ideal reactive part from making a singular matrix. */
const REACTIVE_SERIES_OHMS = 0.01;
export const LED_WARN_AMPS = 0.03;
const DEFAULT_ECAP_FARADS = 100e-6;
/**
 * Rated voltage of the electrolytic capacitor. A constant of the part type
 * for now; it becomes data (and editable) in the component library (PLAN step 10).
 */
export const ECAP_RATED_VOLTS = 16;

/**
 * Typical ESR of a general-purpose aluminium electrolytic: 5 ohm / sqrt(C in
 * uF), i.e. 0.5 ohm at 100 uF, 5 ohm at 1 uF, 0.16 ohm at 1000 uF, kept
 * within 0.01..20 ohm at the ends of the value range.
 */
export function ecapEsr(farads: number): number {
  return Math.min(20, Math.max(0.01, 5 / Math.sqrt(farads / 1e-6)));
}

/** The electrolytic capacitor against its ratings (polarity and rated voltage, see sim/ratings.ts). */
function ecapStress(r: PartResult, s: PartState): Stress {
  const esr = ecapEsr(s.value ?? DEFAULT_ECAP_FARADS);
  return polarizedCapStress(dielectricVolts(r.voltage, r.current, esr), ECAP_RATED_VOLTS);
}

/** An IGBT against its ratings, in its own frame (a P-IGBT's values with the signs turned round). */
function igbtPartStress(r: PartResult, polarity: 1 | -1): Stress {
  return igbtStress(polarity * (r.volts?.c ?? r.voltage), polarity * r.current, polarity * (r.volts?.g ?? 0));
}

const warnText = (st: Stress): string | null => (st.level === 'ok' ? null : st.reason);
const burnText = (st: Stress): string | null => (st.level === 'burn' ? st.reason : null);

/** Why a part is overstressed now (the readout's warning and the red "!"), or null; never for a burned part. */
export function partWarning(type: PartType, r: PartResult, state: PartState): string | null {
  if (state.burned) return null;
  if (type.warnAbove !== undefined && Math.abs(r.current) > type.warnAbove) return 'Too much current: add a series resistor.';
  return type.warnWhen?.(r, state) ?? null;
}

/** Why a part is destroyed by this result (burnAbove first, then burnWhen), or null; never for a part already burned. */
export function burnReason(type: PartType, r: PartResult, state: PartState): string | null {
  if (state.burned) return null;
  if (type.burnAbove !== undefined && Math.abs(r.current) > type.burnAbove) return 'too much current';
  return type.burnWhen?.(r, state) ?? null;
}

/** 0..1 for an LED current (defined with the part inspector's values, src/sim/inspect.ts). */
export { ledBrightness };

/** Readout name of an Uno header pin, e.g. "D13 (LED L)", "D9 (PWM)". */
function unoPinName(p: HeaderPin): string {
  if (p.id.startsWith('d')) {
    const n = Number(p.id.slice(1));
    const extra = n === 13 ? ' (LED L)' : n === 0 ? ' (RX)' : n === 1 ? ' (TX)' : p.label.startsWith('~') ? ' (PWM)' : '';
    return `D${n}${extra}`;
  }
  return p.label;
}

const UNO_PINS = [
  ...UNO_TOP.map((p) => ({ id: p.id, name: unoPinName(p), x: p.x, y: 0 })),
  ...UNO_BOTTOM.map((p) => ({ id: p.id, name: unoPinName(p), x: p.x, y: UNO_ART.rows })),
];

/** Nano header pads that are real pins (A6, A7 and RST are drawn only, see art/nano.ts). */
const NANO_PINS = [...NANO_LEFT, ...NANO_RIGHT].flatMap((p) => {
  if (p.id === undefined) return [];
  const n = /^d\d+$/.test(p.id) ? Number(p.id.slice(1)) : -1;
  const extra = n === 13 ? ' (LED L)' : n === 0 ? ' (RX)' : n === 1 ? ' (TX)' : [3, 5, 6, 9, 10, 11].includes(n) ? ' (PWM)' : '';
  return [{ id: p.id, name: n >= 0 ? `D${n}${extra}` : p.label, x: p.x, y: p.y }];
});

/** TO-92 transistors (BC547, BC557): C B E, left to right, flat face to the front. */
const TO92_PINS: readonly PinDef[] = [
  { id: 'c', name: 'Collector', x: 1, y: 4 }, { id: 'b', name: 'Base', x: 2, y: 4 },
  { id: 'e', name: 'Emitter', x: 3, y: 4 },
];

/** TO-247 N-IGBT: G C E, left to right seen from the front. */
const TO247_N_PINS: readonly PinDef[] = [
  { id: 'g', name: 'Gate', x: 1, y: 8 }, { id: 'c', name: 'Collector', x: 2, y: 8 }, { id: 'e', name: 'Emitter', x: 3, y: 8 },
];

/**
 * TO-247 P-IGBT: G E C. The P part is the N part's complement, so its
 * positive side (the emitter) takes the middle lead where the N part has
 * its collector.
 */
const TO247_P_PINS: readonly PinDef[] = [
  { id: 'g', name: 'Gate', x: 1, y: 8 }, { id: 'e', name: 'Emitter', x: 2, y: 8 }, { id: 'c', name: 'Collector', x: 3, y: 8 },
];

/** TO-220 MOSFETs: G D S, left to right seen from the front (the tab is the drain too). */
const TO220_PINS: readonly PinDef[] = [
  { id: 'g', name: 'Gate', x: 1, y: 7 }, { id: 'd', name: 'Drain', x: 2, y: 7 }, { id: 's', name: 'Source', x: 3, y: 7 },
];

// Which parts can be mirrored (`mirrorable: true`): only those whose mirror
// image cannot be had by rotating, judged by where the pins are:
//   led, bjt, pnp, nmos, pmos, pot, - pins in a row along one edge; a mirror
//   igbt, pigbt                       swaps the outer legs (anode/cathode, C/E,
//                                     G/S, G/E or G/C, the pot's ends).
//   battery9v                       - both terminals on the right edge; a
//                                     mirror puts + below -, no turn does that.
// Not mirrorable: battery, ground, resistor, capacitor, ecap, inductor, diode,
// switch, button (pins on the box's centre line, or the button's linked
// pairs, so a mirror equals a 180-degree turn or nothing), the boards (a
// mirrored board does not exist) and ICs such as the DIP-8 halfdriver (its
// mirror image is the chip upside down, which nobody places).
//   gate-and, -nand, -or, -nor,     - inputs A, B above and below the centre
//   -xor, -xnor                       line: a vertical mirror swaps them, no
//                                     turn does (gateparts.ts). NOT / BUFFER
//                                     have theirs on the centre line: not mirrorable.
// Not mirrorable either: zener, schottky, ldr, buzzer (two pins on the centre
// line) and the 7-segment display (two pin rows like a DIP); see basicparts.ts.
// A new polarized part with an asymmetric pin
// layout sets `mirrorable: true`. In a mixed group flip the others only move
// (see flip.ts).
export const PARTS: readonly PartType[] = [
  {
    id: 'battery', name: 'Battery (AA)', ...BATTERY_ART,
    pins: [{ id: 'neg', name: '−', x: 0, y: 1 }, { id: 'pos', name: '+', x: 6, y: 1 }],
    sim: () => ({ kind: 'battery', volts: 1.5, rInternal: 0.2 }),
  },
  {
    id: 'battery9v', name: 'Battery (9 V)', ...BATTERY_9V_ART, mirrorable: true,
    pins: [{ id: 'pos', name: '+', x: 5, y: 1 }, { id: 'neg', name: '−', x: 5, y: 2 }],
    sim: () => ({ kind: 'battery', volts: 9, rInternal: 1.5 }),
  },
  {
    id: 'ground', name: 'Ground', ...GROUND_ART,
    pins: [{ id: 'gnd', name: 'GND', x: 1, y: 0 }],
    sim: () => ({ kind: 'ground' }),
  },
  {
    id: 'resistor', name: 'Resistor', ...RESISTOR_ART,
    pins: [{ id: 'a', name: '1', x: 0, y: 1 }, { id: 'b', name: '2', x: 4, y: 1 }],
    defaults: { value: DEFAULT_OHMS },
    value: { label: 'Resistance', unit: 'Ω', min: 1, max: 10e6 },
    variant: (s) => resistorArt(s.value ?? DEFAULT_OHMS),
    sim: (s) => ({ kind: 'resistor', ohms: s.value ?? DEFAULT_OHMS }),
  },
  {
    id: 'capacitor', name: 'Capacitor', ...CAPACITOR_ART,
    pins: [{ id: 'a', name: '1', x: 0, y: 1 }, { id: 'b', name: '2', x: 4, y: 1 }],
    defaults: { value: DEFAULT_FARADS },
    value: { label: 'Capacitance', unit: 'F', min: 1e-12, max: 1 },
    readout: reactiveReadout,
    sim: (s) => ({ kind: 'capacitor', farads: s.value ?? DEFAULT_FARADS, esr: REACTIVE_SERIES_OHMS }),
  },
  {
    // Polarized: pos (+) and neg (\u2212) on the centre line, so a 180-degree turn swaps them (not mirrorable).
    id: 'ecap', name: 'Electrolytic capacitor', ...ECAP_ART,
    pins: [{ id: 'pos', name: 'Positive (+)', x: 0, y: 1 }, { id: 'neg', name: 'Negative (\u2212, stripe)', x: 4, y: 1 }],
    defaults: { value: DEFAULT_ECAP_FARADS },
    value: { label: 'Capacitance', unit: 'F', min: 1e-12, max: 1 },
    readout: ecapReadout,
    warnWhen: (r, s) => warnText(ecapStress(r, s)),
    burnWhen: (r, s) => burnText(ecapStress(r, s)),
    // Burned: open (a vented can holds no charge and conducts nothing), like the LED.
    variant: (s) => (s.burned ? { key: 'burned', svg: ECAP_BURNED_SVG } : null),
    sim: (s) => {
      if (s.burned) return { kind: 'open' };
      const farads = s.value ?? DEFAULT_ECAP_FARADS;
      return { kind: 'capacitor', farads, esr: ecapEsr(farads), polarized: true, ratedVolts: ECAP_RATED_VOLTS };
    },
  },
  {
    id: 'inductor', name: 'Inductor', ...INDUCTOR_ART,
    pins: [{ id: 'a', name: '1', x: 0, y: 1 }, { id: 'b', name: '2', x: 4, y: 1 }],
    defaults: { value: DEFAULT_HENRIES },
    value: { label: 'Inductance', unit: 'H', min: 1e-9, max: 100 },
    readout: reactiveReadout,
    sim: (s) => ({ kind: 'inductor', henries: s.value ?? DEFAULT_HENRIES, dcr: REACTIVE_SERIES_OHMS }),
  },
  {
    id: 'led', name: 'LED', ...LED_ART, mirrorable: true,
    pins: [{ id: 'cathode', name: 'Cathode (−)', x: 1, y: 4 }, { id: 'anode', name: 'Anode (+)', x: 2, y: 4 }],
    warnAbove: LED_WARN_AMPS,
    burnAbove: 0.1,
    variant: (s) => (s.burned ? { key: 'burned', svg: LED_BURNED_SVG } : null),
    overlay: (ctx, s, r) => {
      if (!s.burned && r) drawLedGlow(ctx, ledBrightness(r.current));
    },
    sim: (s) => (s.burned ? { kind: 'open' } : RED_LED),
  },
  // Photoresistor, active buzzer, 7-segment display: see basicparts.ts.
  ...OUTPUT_SENSOR_PARTS,
  {
    id: 'switch', name: 'Toggle switch', ...TOGGLE_ART,
    pins: [{ id: 'a', name: '1', x: 0, y: 1 }, { id: 'b', name: '2', x: 4, y: 1 }],
    defaults: { closed: false },
    control: 'toggle',
    variant: (s) => (s.closed ? { key: 'on', svg: TOGGLE_ON_SVG } : null),
    sim: (s) => ({ kind: 'switch', closed: s.closed === true }),
  },
  {
    id: 'button', name: 'Push button', ...PUSH_BUTTON_ART,
    pins: [
      { id: 'a', name: '1a', x: 0, y: 1 }, { id: 'a2', name: '1b', x: 4, y: 1 },
      { id: 'b', name: '2a', x: 0, y: 2 }, { id: 'b2', name: '2b', x: 4, y: 2 },
    ],
    links: [['a', 'a2'], ['b', 'b2']],
    defaults: { closed: false },
    control: 'momentary',
    variant: (s) => (s.closed ? { key: 'down', svg: PUSH_BUTTON_PRESSED_SVG } : null),
    sim: (s) => ({ kind: 'switch', closed: s.closed === true }),
  },
  {
    id: 'pot', name: 'Potentiometer', ...POT_ART, mirrorable: true,
    pins: [{ id: 'a', name: '1', x: 1, y: 4 }, { id: 'w', name: 'Wiper', x: 2, y: 4 }, { id: 'b', name: '3', x: 3, y: 4 }],
    defaults: { value: DEFAULT_POT_OHMS, position: 0.5 },
    value: { label: 'Resistance', unit: 'Ω', min: 10, max: 10e6 },
    control: 'knob',
    knob: { x: POT_KNOB.x / ART_CELL, y: POT_KNOB.y / ART_CELL, r: POT_KNOB.r / ART_CELL },
    overlay: (ctx, s) => drawPotPointer(ctx, s.position ?? 0.5),
    sim: (s) => ({ kind: 'pot', ohms: s.value ?? DEFAULT_POT_OHMS, position: s.position ?? 0.5 }),
  },
  {
    // Pin ids are the diode model's, like the LED's; the band marks the cathode.
    id: 'diode', name: 'Diode (1N4148)', ...DIODE_ART,
    pins: [{ id: 'anode', name: 'Anode (+)', x: 0, y: 1 }, { id: 'cathode', name: 'Cathode (−, band)', x: 4, y: 1 }],
    readout: diodeReadout,
    sim: () => D1N4148,
  },
  {
    // The id stays 'bjt' (saved projects use it).
    id: 'bjt', name: 'NPN transistor (BC547)', ...TRANSISTOR_ART, mirrorable: true,
    pins: TO92_PINS,
    sim: () => BC547,
  },
  {
    id: 'pnp', name: 'PNP transistor (BC557)', ...PNP_ART, mirrorable: true,
    pins: TO92_PINS,
    readout: pnpReadout,
    sim: () => BC557,
  },
  {
    id: 'nmos', name: 'N-MOSFET (logic level)', ...NMOS_ART, mirrorable: true,
    pins: TO220_PINS,
    readout: (r) => mosfetReadout(r, 1),
    sim: () => LOGIC_NMOS,
  },
  {
    id: 'pmos', name: 'P-MOSFET', ...PMOS_ART, mirrorable: true,
    pins: TO220_PINS,
    readout: (r) => mosfetReadout(r, -1),
    sim: () => POWER_PMOS,
  },
  {
    // One part with its own model (MOSFET + PNP inside), so the legs cannot be swapped.
    id: 'igbt', name: 'IGBT (N-channel)', ...IGBT_ART, mirrorable: true,
    pins: TO247_N_PINS,
    readout: (r) => igbtReadout(r, 1),
    warnWhen: (r) => warnText(igbtPartStress(r, 1)),
    burnWhen: (r) => burnText(igbtPartStress(r, 1)),
    variant: (s) => (s.burned ? { key: 'burned', svg: IGBT_BURNED_SVG } : null),
    sim: (s) => (s.burned ? { kind: 'open' } : GENERIC_IGBT),
  },
  {
    id: 'pigbt', name: 'IGBT (P-channel)', ...PIGBT_ART, mirrorable: true,
    pins: TO247_P_PINS,
    readout: (r) => igbtReadout(r, -1),
    warnWhen: (r) => warnText(igbtPartStress(r, -1)),
    burnWhen: (r) => burnText(igbtPartStress(r, -1)),
    variant: (s) => (s.burned ? { key: 'burned', svg: PIGBT_BURNED_SVG } : null),
    sim: (s) => (s.burned ? { kind: 'open' } : GENERIC_PIGBT),
  },
  // Zener and Schottky diodes: see basicparts.ts.
  ...DIODE_FAMILY_PARTS,
  {
    // Behavioural model (sim/driver.ts). SD is active low: tie it high to run.
    // Not mirrorable: a mirrored DIP would be the chip upside down (turns cover every real placement).
    id: 'halfdriver', name: 'Half-bridge driver (IR2104-like)', ...DRIVER_ART,
    pins: DRIVER_PIN_POINTS,
    readout: driverReadout,
    warnWhen: (r) => {
      const st = driverStress(r.volts?.vcc ?? r.voltage);
      return st.level === 'ok' ? null : st.reason;
    },
    burnWhen: (r) => {
      const st = driverStress(r.volts?.vcc ?? r.voltage);
      return st.level === 'burn' ? st.reason : null;
    },
    variant: (s) => (s.burned ? { key: 'burned', svg: DRIVER_BURNED_SVG } : null),
    sim: (s) => (s.burned ? { kind: 'open' } : { kind: 'halfdriver' }),
  },
  // Ideal logic gates (no supply pins): gate-not ... gate-xnor, see gateparts.ts.
  ...GATE_PARTS,
  {
    id: 'uno', name: 'Arduino Uno', ...UNO_ART,
    pins: UNO_PINS,
    links: [['gnd', 'gnd2'], ['gnd', 'gnd3']],
    board: UNO_SPEC,
    resetButton: { x: UNO_RESET.x / ART_CELL, y: UNO_RESET.y / ART_CELL, w: UNO_RESET.w / ART_CELL, h: UNO_RESET.h / ART_CELL },
    // 'hex': compiled firmware (Intel HEX text), run by the board (see src/build/firmware.ts).
    sourceExtensions: ['ino', 'cpp', 'c', 'h', 'hpp', 'txt', 'md', 'hex'],
    // io pins are filled in by the mixed-signal bridge (src/mcu/mixedsignal.ts).
    sim: () => ({ kind: 'board', rails: { ...UNO_SPEC.electrical.rails }, io: {} }),
    overlay: (ctx, _s, r) => drawUnoLeds(ctx, (r?.volts?.d13 ?? 0) / UNO_SPEC.electrical.vcc, r !== undefined),
  },
  {
    id: 'nano', name: 'Arduino Nano', ...NANO_ART,
    pins: NANO_PINS,
    links: [['gnd', 'gnd2']],
    board: NANO_SPEC,
    resetButton: { x: NANO_RESET.x / ART_CELL, y: NANO_RESET.y / ART_CELL, w: NANO_RESET.w / ART_CELL, h: NANO_RESET.h / ART_CELL },
    sourceExtensions: ['ino', 'cpp', 'c', 'h', 'hpp', 'txt', 'md', 'hex'],
    sim: () => ({ kind: 'board', rails: { ...NANO_SPEC.electrical.rails }, io: {} }),
    overlay: (ctx, _s, r) => drawNanoLeds(ctx, (r?.volts?.d13 ?? 0) / NANO_SPEC.electrical.vcc, r !== undefined),
  },
];

/**
 * The rating table (sim/specs.ts) applied to every part type with a row:
 * warnWhen / burnWhen read it (after any rule of the type's own), and a
 * burned part is an open circuit, like the LED. So rating a part type needs
 * only its row in the table.
 */
function applySpecs(type: PartType): void {
  const sim = type.sim;
  if (!partSpec(type.id) || !sim) return;
  const own = { warn: type.warnWhen, burn: type.burnWhen };
  const stress = (r: PartResult, s: PartState): Stress => specStress(type.id, r, sim(s));
  type.warnWhen = (r, s) => own.warn?.(r, s) ?? warnText(stress(r, s));
  type.burnWhen = (r, s) => own.burn?.(r, s) ?? burnText(stress(r, s));
  type.sim = (s) => (s.burned ? { kind: 'open' } : sim(s));
}

for (const type of PARTS) applySpecs(type);

export function getPart(id: string): PartType | undefined {
  return PARTS.find((p) => p.id === id);
}

/** True when placed parts of this type can be mirrored (PartType.mirrorable, default false). */
export function canMirror(type: PartType): boolean {
  return type.mirrorable === true && type.board === undefined;
}

/** What the labels of a placed board are made from. */
interface BoardLike {
  typeId: string;
  boardId?: string;
  state?: PartState;
}

/**
 * Default name of a placed board, e.g. "Arduino Uno #2" for the board folder
 * "uno-2": the type name and the counter of its boardId, which never changes
 * (also across saving) and is what the board's folder is called.
 */
export function defaultBoardLabel(part: BoardLike): string {
  const name = getPart(part.typeId)?.name ?? 'Board';
  const parsed = part.boardId === undefined ? null : parseBoardId(part.boardId);
  return parsed ? `${name} #${parsed.n}` : name;
}

/** The user's name for a board, or undefined when it has none. */
export function customBoardName(part: BoardLike): string | undefined {
  const name = part.state?.name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/** Short name of a placed board: the user's name when set, else the default label. */
export function boardLabel(part: BoardLike): string {
  return customBoardName(part) ?? defaultBoardLabel(part);
}

/** Like boardLabel, plus the folder id when the name is the user's ("Blinker (uno-1)"), so equal names can be told apart. */
export function boardLabelWithId(part: BoardLike): string {
  const custom = customBoardName(part);
  return custom !== undefined && part.boardId !== undefined ? `${custom} (${part.boardId})` : boardLabel(part);
}
