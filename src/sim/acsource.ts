// AC voltage source with a current limit, model kind 'acsource'. Pins: pos, neg.
// It is the mains outlet (230 V, 50 Hz) and the variable AC supply.
//
//   v(t) = vrms * sqrt(2) * sin(2 pi f t)             (phase 0 at t = 0)
//
// The voltage is set by its RMS value, the way mains and bench AC supplies are
// labelled, and `limit` is the RMS current it may deliver. How the solver sees
// it: resolveSignals (signal.ts) replaces it before every solve by a 'supply'
// at the voltage of that instant, with the PEAK of the limit (limit x sqrt 2),
// so supply.ts gives the output resistance, the smooth current limit and the
// result; the supply result also carries `ac.vrms` and `ac.freq` under `volts`.
//
// Like the function generator it is a time-dependent source: the solver's step
// stays a fiftieth of the period or shorter (signalMaxStep).

import type { ComponentModel } from './types';

export type AcSourceModel = Extract<ComponentModel, { kind: 'acsource' }>;

/** The mains outlet: 230 V, 50 Hz, a 16 A breaker. */
export const OUTLET = { vrms: 230, freq: 50, limit: 16 } as const;

/** Settings of the variable AC supply. */
export const AC_DEFAULT_VOLTS = 12;
export const AC_MAX_VOLTS = 500;
export const AC_DEFAULT_HZ = 50;
export const AC_MIN_HZ = 1;
export const AC_MAX_HZ = 1000;
export const AC_DEFAULT_AMPS = 2;
export const AC_MIN_AMPS = 0.001;
export const AC_MAX_AMPS = 50;

/** The source voltage at time `t` seconds. */
export function acVolts(m: AcSourceModel, t: number): number {
  const f = Number.isFinite(m.freq) && m.freq > 0 ? m.freq : 0;
  const x = f * t;
  return m.vrms * Math.SQRT2 * Math.sin(2 * Math.PI * (x - Math.floor(x)));
}

/** The peak current the limiter allows (the RMS limit of a sine, times sqrt 2). */
export function acPeakAmps(m: AcSourceModel): number {
  return Math.max(m.limit, 1e-6) * Math.SQRT2;
}
