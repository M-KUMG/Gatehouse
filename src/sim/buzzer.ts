// Active buzzer (5 V, about 30 mA, 2.3 kHz internal oscillator), model kind
// 'buzzer'. Electrically a load whose resistance depends on the voltage
// across it (pos - neg), smooth so Newton's method sees a continuous slope:
//
//   I(V) = V (1 / ohmsOff + s(V) / ohmsOn)
//   s(V) = 0 below vOff, 1 above vOn, the smoothstep 3t^2 - 2t^3 between
//          (t = (V - vOff) / (vOn - vOff)): continuous with its slope.
//
// Below 2.0 V the oscillator does not start: about 1 MOhm. Above 2.5 V it
// runs and draws V / 150 ohm (33 mA at 5 V). No hysteresis (a real one has
// a little; not needed for a load). Polarity: reversed, s stays 0, so only
// the 1 MOhm leaks (the series diode of a real buzzer blocks; the effect on
// the circuit is the same, about 0 A). The oscillator itself is not
// simulated (no 2.3 kHz ripple): `sounding` is the running state.
// The solver puts it in as a diode element with this curve (solve.ts).

import type { ComponentModel } from './types';

export type BuzzerModel = Extract<ComponentModel, { kind: 'buzzer' }>;

/** The active buzzer part: off below 2.0 V (1 MOhm), on above 2.5 V (150 ohm). */
export const ACTIVE_BUZZER: BuzzerModel = { kind: 'buzzer', vOff: 2.0, vOn: 2.5, ohmsOff: 1e6, ohmsOn: 150 };
export const BUZZER_DEFAULT_MAX_VOLTS = 6.5;

/** The oscillator runs (it sounds) from the middle of the turn-on range: 2.25 V. */
export function buzzerSounding(model: BuzzerModel, volts: number): boolean {
  return volts >= (model.vOff + model.vOn) / 2;
}

/** How far the oscillator is on, 0..1, and its slope d/dV. */
function onFraction(m: BuzzerModel, v: number): { s: number; ds: number } {
  const w = m.vOn - m.vOff;
  if (!(w > 0)) return v >= m.vOn ? { s: 1, ds: 0 } : { s: 0, ds: 0 };
  const t = (v - m.vOff) / w;
  if (t <= 0) return { s: 0, ds: 0 };
  if (t >= 1) return { s: 1, ds: 0 };
  return { s: t * t * (3 - 2 * t), ds: (6 * t * (1 - t)) / w };
}

/** Current (pos to neg) and its slope dI/dV at `v` volts across the buzzer. */
export function buzzerCurve(m: BuzzerModel, v: number): { i: number; g: number } {
  const gOff = 1 / m.ohmsOff;
  const gOn = 1 / m.ohmsOn;
  const { s, ds } = onFraction(m, v);
  return { i: v * (gOff + gOn * s), g: gOff + gOn * s + v * gOn * ds };
}
