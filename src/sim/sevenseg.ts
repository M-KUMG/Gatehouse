// Common-cathode 7-segment display (0.56 in, red), model kind 'sevenseg':
// eight red LEDs (the RED_LED parameters: 2.0 V at 20 mA, about 1.9 V at
// 10 mA), one from each segment pin to com. The solver puts in one diode
// element per segment (each behind its own rs) and adds their currents up
// in the part's result: pins[seg] is the current into that segment,
// pins.com the sum flowing out, current the sum, voltage the highest
// segment-to-com voltage.

import { RED_LED } from './devices';
import type { ComponentModel } from './types';

/** Segment pins in the model's order (then com). */
export const SEVENSEG_SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] as const;
export type Segment = (typeof SEVENSEG_SEGMENTS)[number];

const led = RED_LED as Extract<ComponentModel, { kind: 'diode' }>;

/** The red common-cathode display. */
export const RED_SEVENSEG: ComponentModel = { kind: 'sevenseg', is: led.is, n: led.n, rs: led.rs };
