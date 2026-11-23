// Part types of the basic parts added together: the Zener and Schottky
// diodes (inserted in PARTS after the IGBTs) and the LDR, the active buzzer
// and the 7-segment display (after the LED). Ratings: their rows in
// sim/specs.ts (parts.ts makes a burned one an open circuit).
//
// Mirroring (PartType.mirrorable), all false:
//   zener, schottky - two pins on the centre line: a mirror equals a half turn.
//   ldr             - symmetric two-pin part (a mirror equals itself or a half turn).
//   buzzer          - + and - on the centre line: a mirror equals a half turn.
//   sevenseg        - a mirrored display would be the part upside down
//                     (pins on two rows like a DIP; turns cover every real placement).
//   ntc             - symmetric two-pin part, like the LDR.
//   rgbled (true)   - four legs in a row: a mirror swaps red and blue, which no turn does.

import { SCHOTTKY_ART, SCHOTTKY_BURNED_SVG, ZENER_ART, ZENER_BURNED_SVG } from './art/axial';
import { BUZZER_ART, BUZZER_BURNED_SVG, drawBuzzerWaves } from './art/buzzer';
import { LDR_ART, LDR_BURNED_SVG } from './art/ldr';
import { NTC_ART, NTC_BURNED_SVG } from './art/ntc';
import { RGBLED_ART, RGBLED_BURNED_SVG, drawRgbGlow } from './art/rgbled';
import { SEVENSEG_ART, SEVENSEG_BURNED_SVG, drawSevensegGlow } from './art/sevenseg';
import { DEFAULT_SCHOTTKY_SETTINGS, DIODE_CATALOGS, DIODE_FIELDS, diodeModel } from './diodepresets';
import { buzzerReadout, diodeReadout, rgbledReadout, sevensegReadout, zenerReadout } from './devicereadouts';
import { formatSI } from './format';
import type { PartState, PartType, PinDef } from './parts';
import type { PartResult } from './sim';
import { ACTIVE_BUZZER, BUZZER_DEFAULT_MAX_VOLTS, buzzerSounding, type BuzzerModel } from './sim/buzzer';
import { markBuzzing } from './buzzsound';
import { ledBrightness } from './sim/inspect';
import { RGB_LED } from './sim/rgbled';
import { RED_SEVENSEG, SEVENSEG_SEGMENTS } from './sim/sevenseg';
import { ZENER_DEFAULT_VOLTS, ZENER_MAX_VOLTS, ZENER_MIN_VOLTS, zenerModel } from './sim/zener';

const AXIAL_DIODE_PINS: readonly PinDef[] = [
  { id: 'anode', name: 'Anode (+)', x: 0, y: 1 }, { id: 'cathode', name: 'Cathode (−, band)', x: 4, y: 1 },
];

export const SCHOTTKY_1N5819 = diodeModel({}, DEFAULT_SCHOTTKY_SETTINGS);

const BUZZER_DEFAULT_VOLTS = 5;
const BUZZER_DEFAULT_AMPS = BUZZER_DEFAULT_VOLTS / ACTIVE_BUZZER.ohmsOn + BUZZER_DEFAULT_VOLTS / ACTIVE_BUZZER.ohmsOff;

function buzzerModelOf(state: PartState): BuzzerModel {
  const volts = state.value ?? BUZZER_DEFAULT_VOLTS;
  const vOn = state.buzzerMinVolts ?? ACTIVE_BUZZER.vOn;
  const vOff = state.buzzerMinVolts === undefined ? ACTIVE_BUZZER.vOff : 0.8 * vOn;
  const ohmsOn = state.buzzerRatedAmps === undefined && volts === BUZZER_DEFAULT_VOLTS
    ? ACTIVE_BUZZER.ohmsOn : 1 / ((state.buzzerRatedAmps ?? BUZZER_DEFAULT_AMPS) / volts - 1 / ACTIVE_BUZZER.ohmsOff);
  return {
    ...ACTIVE_BUZZER, vOff, vOn, ohmsOn,
    ...(state.buzzerMaxVolts === undefined ? {} : { ratedMaxVolts: state.buzzerMaxVolts }),
  };
}

/** The Zener voltage of a placed part (the default when missing or out of range). */
export function zenerVolts(value: number | undefined): number {
  return value !== undefined && value >= ZENER_MIN_VOLTS && value <= ZENER_MAX_VOLTS ? value : ZENER_DEFAULT_VOLTS;
}

export const LDR_MIN_LUX = 0.1;
export const LDR_MAX_LUX = 100_000;
export const LDR_DEFAULT_LUX = 100;
export const LDR_MIN_OHMS = 100;
export const LDR_MAX_OHMS = 2e6;
const LDR_DEFAULT_OHMS_AT_10_LUX = 10_000;
const LDR_DEFAULT_GAMMA = 0.7;

/**
 * Resistance of the CdS photoresistor (a GL5528-like cell) at `lux`:
 * R = 10 kOhm * (10 / lux)^0.7 (10 kOhm at 10 lx, the usual gamma 0.7),
 * kept within 100 Ohm .. 2 MOhm. Light to dark:
 *   100 000 lx (sun) 100 Ohm (clamped) | 10 000 lx 79 -> 100 Ohm (clamped)
 *   1000 lx 398 Ohm | 100 lx (room) 2.0 kOhm | 10 lx 10 kOhm
 *   1 lx 50 kOhm | 0.1 lx (dark) 251 kOhm
 * Steady state only: the real cell's slow response (tens of ms, seconds to
 * reach its dark resistance of 1 MOhm and more) is not modelled.
 */
export function ldrOhms(lux: number, ohmsAt10Lux = LDR_DEFAULT_OHMS_AT_10_LUX, gamma = LDR_DEFAULT_GAMMA): number {
  const l = Math.min(LDR_MAX_LUX, Math.max(LDR_MIN_LUX, Number.isFinite(lux) ? lux : LDR_DEFAULT_LUX));
  return Math.min(LDR_MAX_OHMS, Math.max(LDR_MIN_OHMS, ohmsAt10Lux * (10 / l) ** gamma));
}

export const NTC_MIN_C = -40;
export const NTC_MAX_C = 125;
export const NTC_DEFAULT_C = 25;
/** The 10 k NTC thermistor: 10 kOhm at 25 C, beta 3950 K (the common MF52 type). */
const NTC_R25 = 10_000;
const NTC_BETA = 3950;
const KELVIN = 273.15;

/**
 * Resistance of the NTC thermistor at `celsius`, by the beta equation
 * R = R25 exp(B (1/T - 1/T25)) (T in kelvin), kept to its -40..125 C range.
 *   -40 C 402 kOhm | 0 C 33.6 kOhm | 25 C 10 kOhm | 50 C 3.6 kOhm
 *   100 C 697 Ohm | 125 C 359 Ohm
 * Steady state only: the real bead's thermal time constant (seconds) and its
 * self-heating are not modelled.
 */
export function ntcOhms(celsius: number, ohmsAt25C = NTC_R25, beta = NTC_BETA): number {
  const c = Math.min(NTC_MAX_C, Math.max(NTC_MIN_C, Number.isFinite(celsius) ? celsius : NTC_DEFAULT_C));
  return ohmsAt25C * Math.exp(beta * (1 / (c + KELVIN) - 1 / (NTC_DEFAULT_C + KELVIN)));
}

function ldrReadout(r: PartResult): string[] {
  const ohms = Math.abs(r.current) > 1e-15 ? r.voltage / r.current : NaN;
  const lines = [`${formatSI(Math.abs(r.voltage), 'V')} · ${formatSI(Math.abs(r.current), 'A')}`, formatSI(r.power, 'W')];
  if (Number.isFinite(ohms)) lines.unshift(`R ${formatSI(ohms, 'Ω')}`);
  return lines;
}

const burnedLook = (svg: string) => (s: { burned?: boolean }) => (s.burned ? { key: 'burned', svg } : null);

/** Zener and Schottky diodes: placed after the IGBTs. */
export const DIODE_FAMILY_PARTS: readonly PartType[] = [
  {
    // One part for the whole family: the Zener voltage is its value (2.4..75 V, default 5.1 V).
    id: 'zener', name: 'Zener diode (1 W)', ...ZENER_ART,
    catalog: DIODE_CATALOGS.zener,
    pins: AXIAL_DIODE_PINS,
    defaults: { value: ZENER_DEFAULT_VOLTS },
    value: { label: 'Zener voltage', unit: 'V', min: ZENER_MIN_VOLTS, max: ZENER_MAX_VOLTS },
    readout: zenerReadout,
    variant: burnedLook(ZENER_BURNED_SVG),
    sim: (s) => zenerModel(zenerVolts(s.value)),
  },
  {
    id: 'schottky', name: 'Schottky diode (1N5819)', ...SCHOTTKY_ART,
    catalog: DIODE_CATALOGS.schottky,
    pins: AXIAL_DIODE_PINS,
    fields: DIODE_FIELDS,
    readout: diodeReadout,
    variant: burnedLook(SCHOTTKY_BURNED_SVG),
    sim: (s) => diodeModel(s, DEFAULT_SCHOTTKY_SETTINGS),
  },
];

/** Photoresistor, buzzer and 7-segment display: placed after the LED. */
export const OUTPUT_SENSOR_PARTS: readonly PartType[] = [
  {
    // Through the plain resistor model: its ohms come from the light (ldrOhms), `lux` is data for the inspector.
    id: 'ldr', name: 'Photoresistor (LDR)', ...LDR_ART,
    catalog: { file: 'photoresistors.json', label: 'photoresistor', keys: ['ldrOhmsAt10Lux', 'ldrGamma', 'ratedWatts'] },
    pins: [{ id: 'a', name: '1', x: 0, y: 1 }, { id: 'b', name: '2', x: 4, y: 1 }],
    defaults: { lux: LDR_DEFAULT_LUX },
    value: { label: 'Light', unit: 'lx', min: LDR_MIN_LUX, max: LDR_MAX_LUX, key: 'lux' },
    fields: [
      { key: 'ldrOhmsAt10Lux', label: 'Resistance at 10 lx', unit: 'Ω', min: LDR_MIN_OHMS, max: LDR_MAX_OHMS, defaultValue: () => LDR_DEFAULT_OHMS_AT_10_LUX },
      { key: 'ldrGamma', label: 'Gamma', unit: '', min: 0.1, max: 2, defaultValue: () => LDR_DEFAULT_GAMMA },
      { key: 'ratedWatts', label: 'Rated power', unit: 'W', min: 0.001, max: 100, defaultValue: () => 0.1 },
    ],
    readout: ldrReadout,
    variant: burnedLook(LDR_BURNED_SVG),
    sim: (s) => {
      const lux = s.lux ?? LDR_DEFAULT_LUX;
      return { kind: 'resistor', ohms: ldrOhms(lux, s.ldrOhmsAt10Lux, s.ldrGamma), lux, ratedWatts: s.ratedWatts };
    },
  },
  {
    // Polarized: + must be the higher voltage to sound (reversed it only leaks through 1 MOhm).
    id: 'buzzer', name: 'Active buzzer', ...BUZZER_ART,
    pins: [{ id: 'pos', name: 'Positive (+)', x: 0, y: 2 }, { id: 'neg', name: 'Negative (−)', x: 5, y: 2 }],
    defaults: { value: BUZZER_DEFAULT_VOLTS },
    catalog: { file: 'active-buzzers.json', label: 'active buzzer', keys: ['value', 'buzzerMinVolts', 'buzzerMaxVolts', 'buzzerRatedAmps'] },
    value: { label: 'Rated voltage', unit: 'V', min: 0.1, max: 50 },
    fields: [
      { key: 'buzzerMinVolts', label: 'Minimum operating voltage', unit: 'V', min: 0.1, max: 50, defaultValue: () => ACTIVE_BUZZER.vOn },
      { key: 'buzzerMaxVolts', label: 'Maximum operating voltage', unit: 'V', min: 0.1, max: 50, defaultValue: () => BUZZER_DEFAULT_MAX_VOLTS },
      { key: 'buzzerRatedAmps', label: 'Current at rated voltage', unit: 'A', min: 0.001, max: 1, defaultValue: () => BUZZER_DEFAULT_AMPS },
    ],
    validateSettings: (s) => {
      const rated = s.value ?? BUZZER_DEFAULT_VOLTS;
      return (s.buzzerMinVolts ?? ACTIVE_BUZZER.vOn) <= rated && rated <= (s.buzzerMaxVolts ?? BUZZER_DEFAULT_MAX_VOLTS)
        ? null : 'Rated voltage must be within the operating voltage range.';
    },
    readout: (r, s = {}) => buzzerReadout(r, buzzerModelOf(s)),
    variant: burnedLook(BUZZER_BURNED_SVG),
    // Sound waves while it sounds (visual only). A sounding buzzer draws more than MIN_FLOW_AMPS
    // through its wires, so the grid keeps animating frames (needsAnimation) while it is on.
    overlay: (ctx, s, r, id) => {
      if (!s.burned && r && buzzerSounding(buzzerModelOf(s), r.voltage)) {
        drawBuzzerWaves(ctx, performance.now() / 1000);
        markBuzzing(id ?? -1); // and the sound itself (buzzsound.ts)
      }
    },
    sim: buzzerModelOf,
  },
  {
    id: 'sevenseg', name: '7-segment display (common cathode)', ...SEVENSEG_ART,
    pins: [
      { id: 'g', name: 'Segment g', x: 1, y: 0 }, { id: 'f', name: 'Segment f', x: 2, y: 0 },
      { id: 'com', name: 'Common cathode (−)', x: 3, y: 0 },
      { id: 'a', name: 'Segment a', x: 4, y: 0 }, { id: 'b', name: 'Segment b', x: 5, y: 0 },
      { id: 'e', name: 'Segment e', x: 1, y: 8 }, { id: 'd', name: 'Segment d', x: 2, y: 8 },
      { id: 'c', name: 'Segment c', x: 4, y: 8 }, { id: 'dp', name: 'Decimal point', x: 5, y: 8 },
    ],
    readout: sevensegReadout,
    variant: burnedLook(SEVENSEG_BURNED_SVG),
    overlay: (ctx, s, r) => {
      if (s.burned || !r) return;
      drawSevensegGlow(ctx, Object.fromEntries(SEVENSEG_SEGMENTS.map((seg) => [seg, ledBrightness(r.pins[seg] ?? 0)])));
    },
    sim: () => RED_SEVENSEG,
  },
  {
    // Through the plain resistor model like the LDR: its ohms come from the temperature (ntcOhms), `temp` is data for the inspector.
    id: 'ntc', name: 'Thermistor (NTC 10 kΩ)', ...NTC_ART,
    catalog: { file: 'thermistors.json', label: 'thermistor', keys: ['thermistorOhms', 'thermistorBeta', 'ratedWatts'] },
    pins: [{ id: 'a', name: '1', x: 0, y: 1 }, { id: 'b', name: '2', x: 4, y: 1 }],
    defaults: { temp: NTC_DEFAULT_C },
    value: { label: 'Temperature', unit: '°C', min: NTC_MIN_C, max: NTC_MAX_C, key: 'temp' },
    fields: [
      { key: 'thermistorOhms', label: 'Resistance at 25 °C', unit: 'Ω', min: 1, max: 10e6, defaultValue: () => NTC_R25 },
      { key: 'thermistorBeta', label: 'Beta', unit: 'K', min: 500, max: 10000, defaultValue: () => NTC_BETA },
      { key: 'ratedWatts', label: 'Rated power', unit: 'W', min: 0.001, max: 100, defaultValue: () => 0.5 },
    ],
    readout: ldrReadout,
    variant: burnedLook(NTC_BURNED_SVG),
    sim: (s) => {
      const temp = s.temp ?? NTC_DEFAULT_C;
      return { kind: 'resistor', ohms: ntcOhms(temp, s.thermistorOhms, s.thermistorBeta), temp, ratedWatts: s.ratedWatts };
    },
  },
  {
    // Common cathode: r, g, b are the three anodes. Red needs about 2 V, green and blue about 3 V.
    id: 'rgbled', name: 'RGB LED (common cathode)', ...RGBLED_ART, mirrorable: true,
    pins: [
      { id: 'r', name: 'Red (anode)', x: 1, y: 4 }, { id: 'com', name: 'Common cathode (−)', x: 2, y: 4 },
      { id: 'g', name: 'Green (anode)', x: 3, y: 4 }, { id: 'b', name: 'Blue (anode)', x: 4, y: 4 },
    ],
    readout: rgbledReadout,
    variant: burnedLook(RGBLED_BURNED_SVG),
    overlay: (ctx, s, r) => {
      if (s.burned || !r) return;
      drawRgbGlow(ctx, { r: ledBrightness(r.pins.r ?? 0), g: ledBrightness(r.pins.g ?? 0), b: ledBrightness(r.pins.b ?? 0) });
    },
    sim: () => RGB_LED,
  },
];
