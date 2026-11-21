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

import { SCHOTTKY_ART, SCHOTTKY_BURNED_SVG, ZENER_ART, ZENER_BURNED_SVG } from './art/axial';
import { BUZZER_ART, BUZZER_BURNED_SVG, drawBuzzerWaves } from './art/buzzer';
import { LDR_ART, LDR_BURNED_SVG } from './art/ldr';
import { SEVENSEG_ART, SEVENSEG_BURNED_SVG, drawSevensegGlow } from './art/sevenseg';
import { buzzerReadout, diodeReadout, sevensegReadout, zenerReadout } from './devicereadouts';
import { formatSI } from './format';
import type { PartType, PinDef } from './parts';
import type { ComponentModel, PartResult } from './sim';
import { ACTIVE_BUZZER, buzzerSounding } from './sim/buzzer';
import { markBuzzing } from './buzzsound';
import { VT } from './sim/devices';
import { ledBrightness } from './sim/inspect';
import { RED_SEVENSEG, SEVENSEG_SEGMENTS } from './sim/sevenseg';
import { ZENER_DEFAULT_VOLTS, ZENER_MAX_VOLTS, ZENER_MIN_VOLTS, zenerModel } from './sim/zener';

const AXIAL_DIODE_PINS: readonly PinDef[] = [
  { id: 'anode', name: 'Anode (+)', x: 0, y: 1 }, { id: 'cathode', name: 'Cathode (−, band)', x: 4, y: 1 },
];

/**
 * 1N5819 Schottky diode (1 A, 40 V): n 1 and rs fitted to the datasheet's
 * forward voltages at 25 C, Vf 0.34 V at 100 mA and 0.60 V at 3 A, which
 * gives 0.45 V at 1 A (datasheet 0.45 V): rs = (0.26 V - VT ln 30) / 2.9 A
 * = 59 mOhm, is = 0.1 A / exp((0.34 V - 0.1 A rs) / VT) = 0.24 uA, which is
 * also its reverse leakage (datasheet: below 1 mA at 40 V).
 */
const SCHOTTKY_RS = (0.26 - VT * Math.log(30)) / 2.9;
export const SCHOTTKY_1N5819: ComponentModel = {
  kind: 'diode', n: 1, rs: SCHOTTKY_RS, is: 0.1 / Math.exp((0.34 - 0.1 * SCHOTTKY_RS) / VT),
};

/** The Zener voltage of a placed part (the default when missing or out of range). */
export function zenerVolts(value: number | undefined): number {
  return value !== undefined && value >= ZENER_MIN_VOLTS && value <= ZENER_MAX_VOLTS ? value : ZENER_DEFAULT_VOLTS;
}

export const LDR_MIN_LUX = 0.1;
export const LDR_MAX_LUX = 100_000;
export const LDR_DEFAULT_LUX = 100;
export const LDR_MIN_OHMS = 100;
export const LDR_MAX_OHMS = 2e6;

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
export function ldrOhms(lux: number): number {
  const l = Math.min(LDR_MAX_LUX, Math.max(LDR_MIN_LUX, Number.isFinite(lux) ? lux : LDR_DEFAULT_LUX));
  return Math.min(LDR_MAX_OHMS, Math.max(LDR_MIN_OHMS, 10_000 * (10 / l) ** 0.7));
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
    pins: AXIAL_DIODE_PINS,
    defaults: { value: ZENER_DEFAULT_VOLTS },
    value: { label: 'Zener voltage', unit: 'V', min: ZENER_MIN_VOLTS, max: ZENER_MAX_VOLTS },
    readout: zenerReadout,
    variant: burnedLook(ZENER_BURNED_SVG),
    sim: (s) => zenerModel(zenerVolts(s.value)),
  },
  {
    id: 'schottky', name: 'Schottky diode (1N5819)', ...SCHOTTKY_ART,
    pins: AXIAL_DIODE_PINS,
    readout: diodeReadout,
    variant: burnedLook(SCHOTTKY_BURNED_SVG),
    sim: () => SCHOTTKY_1N5819,
  },
];

/** Photoresistor, buzzer and 7-segment display: placed after the LED. */
export const OUTPUT_SENSOR_PARTS: readonly PartType[] = [
  {
    // Through the plain resistor model: its ohms come from the light (ldrOhms), `lux` is data for the inspector.
    id: 'ldr', name: 'Photoresistor (LDR)', ...LDR_ART,
    pins: [{ id: 'a', name: '1', x: 0, y: 1 }, { id: 'b', name: '2', x: 4, y: 1 }],
    defaults: { lux: LDR_DEFAULT_LUX },
    value: { label: 'Light', unit: 'lx', min: LDR_MIN_LUX, max: LDR_MAX_LUX, key: 'lux' },
    readout: ldrReadout,
    variant: burnedLook(LDR_BURNED_SVG),
    sim: (s) => {
      const lux = s.lux ?? LDR_DEFAULT_LUX;
      return { kind: 'resistor', ohms: ldrOhms(lux), lux };
    },
  },
  {
    // Polarized: + must be the higher voltage to sound (reversed it only leaks through 1 MOhm).
    id: 'buzzer', name: 'Active buzzer (5 V)', ...BUZZER_ART,
    pins: [{ id: 'pos', name: 'Positive (+)', x: 0, y: 2 }, { id: 'neg', name: 'Negative (−)', x: 5, y: 2 }],
    readout: buzzerReadout,
    variant: burnedLook(BUZZER_BURNED_SVG),
    // Sound waves while it sounds (visual only). A sounding buzzer draws more than MIN_FLOW_AMPS
    // through its wires, so the grid keeps animating frames (needsAnimation) while it is on.
    overlay: (ctx, s, r, id) => {
      if (!s.burned && r && buzzerSounding(ACTIVE_BUZZER, r.voltage)) {
        drawBuzzerWaves(ctx, performance.now() / 1000);
        markBuzzing(id ?? -1); // and the sound itself (buzzsound.ts)
      }
    },
    sim: () => ACTIVE_BUZZER,
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
];
