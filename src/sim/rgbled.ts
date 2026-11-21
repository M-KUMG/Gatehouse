// Common-cathode RGB LED (5 mm, diffused), model kind 'rgbled': three LED dies,
// one from each colour pin (r, g, b) to com, each with its own diode curve.
// The forward voltages at 20 mA are the typical ones of the colours: red 2.0 V
// (AlGaInP, the RED_LED parameters), green 3.1 V and blue 3.2 V (InGaN). So on
// a 3.3 V supply the red die lights well and green/blue only just do; on 5 V
// through a resistor all three do. The solver puts in one diode element per
// colour (each behind its own rs), like the 7-segment display: pins[ch] of the
// part result is the current into that colour, pins.com the sum flowing out.

import { RED_LED, VT } from './devices';
import type { ComponentModel, LedJunction } from './types';

/** The colour pins in the model's order (then com). */
export const RGB_CHANNELS = ['r', 'g', 'b'] as const;
export type RgbChannel = (typeof RGB_CHANNELS)[number];

const N = 2;
const RS = 4;
const AMPS = 0.02;

/** An LED die that has `volts` across it at 20 mA. */
function die(volts: number): LedJunction {
  return { n: N, rs: RS, is: AMPS / Math.exp((volts - AMPS * RS) / (N * VT)) };
}

const red = RED_LED as Extract<ComponentModel, { kind: 'diode' }>;

/** The common-cathode RGB LED. */
export const RGB_LED: ComponentModel = {
  kind: 'rgbled',
  r: { is: red.is, n: red.n, rs: red.rs },
  g: die(3.1),
  b: die(3.2),
};
