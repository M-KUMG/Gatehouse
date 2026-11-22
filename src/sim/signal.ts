// Function generator model: a voltage source whose value depends on time.
//
//   v(t) = offset + amp * w(phase),  phase = frac(freq * t)   (starts at phase 0 at t = 0)
//   sine      w = sin(2 pi phase)
//   square    w = +1 for phase < duty, else -1
//   triangle  w = rises -1 -> +1 over the first half, falls back over the second half
//   sawtooth  w = rises -1 -> +1 over the whole period, then jumps back
// The source is Thevenin: v(t) behind `rOut` (50 ohm like a bench generator).
// The solver evaluates it at the END of each step (backward Euler), the DC
// solve at `input.time ?? 0`. Steps must stay short against the period:
// `signalMaxStep` is the limit the bridge applies.

import { acPeakAmps, acVolts } from './acsource';
import { motorMaxStep } from './motor';
import type { ComponentModel, SimInput } from './types';

export type SignalModel = Extract<ComponentModel, { kind: 'signal' }>;

export const SIGNAL_WAVES = ['sine', 'square', 'triangle', 'sawtooth'] as const;
export type SignalWave = (typeof SIGNAL_WAVES)[number];

/** Output resistance of the generator. */
export const SIGNAL_OUT_OHMS = 50;
/** Frequency range of the part (Hz): the solver's step cap (200 per millisecond) cannot follow much more than ~2 kHz well. */
export const SIGNAL_MIN_HZ = 0.01;
export const SIGNAL_MAX_HZ = 100_000;

/** The source voltage at time `t` seconds. */
export function signalVolts(m: SignalModel, t: number): number {
  const f = Number.isFinite(m.freq) && m.freq > 0 ? m.freq : 0;
  const x = f * t;
  const phase = x - Math.floor(x);
  let w: number;
  switch (m.wave) {
    case 'sine':
      w = Math.sin(2 * Math.PI * phase);
      break;
    case 'square':
      w = phase < Math.min(1, Math.max(0, m.duty)) ? 1 : -1;
      break;
    case 'triangle':
      w = phase < 0.5 ? -1 + 4 * phase : 3 - 4 * phase;
      break;
    default:
      w = -1 + 2 * phase;
  }
  return m.offset + m.amp * w;
}

/**
 * `input` with every signal source replaced by a battery at its value for time `t`, and every AC source by a
 * current-limited supply at its value (the same object when there is none).
 */
export function resolveSignals(input: SimInput, t: number): SimInput {
  if (!input.components.some((c) => c.model.kind === 'signal' || c.model.kind === 'acsource')) return input;
  return {
    ...input,
    components: input.components.map((c) => {
      const m = c.model;
      if (m.kind === 'signal') {
        return { ...c, model: { kind: 'battery' as const, volts: signalVolts(m, t), rInternal: Math.max(m.rOut, 1e-6) } };
      }
      if (m.kind === 'acsource') {
        return { ...c, model: { kind: 'supply' as const, volts: acVolts(m, t), limit: acPeakAmps(m), ac: { vrms: m.vrms, freq: m.freq } } };
      }
      return c;
    }),
  };
}

/** Longest step that follows the waveform: a hundredth of the period for edges (square, sawtooth), a fiftieth otherwise. Infinity when there is no signal. */
export function signalMaxStep(input: SimInput): number {
  let limit = motorMaxStep(input); // a motor's shaft speed also has to be followed
  for (const { model: m } of input.components) {
    if (m.kind === 'acsource') {
      if (m.freq > 0) limit = Math.min(limit, 1 / (m.freq * 50));
      continue;
    }
    if (m.kind !== 'signal' || !(m.freq > 0)) continue;
    const per = m.wave === 'square' || m.wave === 'sawtooth' ? 100 : 50;
    limit = Math.min(limit, 1 / (m.freq * per));
  }
  return limit;
}
