// Companion models of capacitors and inductors. Over one time step each
// ideal element becomes a conductance g in parallel with a constant current
// ieq, so the element current (a to b) is i = g * v + ieq. Both come from
// the element's state at the end of the previous step (plain data).

import type { Stamp } from './stamp';

/** How a step integrates the reactive parts. */
export type Integration = 'euler' | 'trapezoidal';

/** Stored state of one capacitor or inductor at the end of a step. */
export interface ReactiveState {
  /** Volts across the ideal element (a side, after any ESR/DCR, minus b). */
  volts: number;
  /** Amps through it from a to b. */
  amps: number;
}

/** What a time step passes to the solver; absent for the DC solve. */
export interface Companion {
  dt: number;
  method: Integration;
  /** Per component id; a missing entry is an uncharged (0 V, 0 A) part. */
  stored: Record<number, ReactiveState>;
}

/** An inductor in the DC solve: a near short. */
export const INDUCTOR_DC_OHMS = 1e-3;

export interface Reactive {
  part: number;
  a: number;
  b: number;
  /** Node between the series resistance and the ideal element (a itself when there is none). */
  inner: number;
  g: number;
  ieq: number;
}

type ReactiveModel = { kind: 'capacitor'; farads: number } | { kind: 'inductor'; henries: number };

/** Conductance and current source of one element for one step (or for DC when `step` is undefined). */
export function companionOf(model: ReactiveModel, step: Companion | undefined, prev: ReactiveState | undefined): { g: number; ieq: number } {
  const v0 = prev?.volts ?? 0;
  const i0 = prev?.amps ?? 0;
  if (model.kind === 'capacitor') {
    if (!step) return { g: 0, ieq: 0 }; // open
    const c = Math.max(model.farads, 0);
    if (step.method === 'trapezoidal') {
      const g = (2 * c) / step.dt;
      return { g, ieq: -g * v0 - i0 };
    }
    const g = c / step.dt;
    return { g, ieq: -g * v0 };
  }
  if (!step) return { g: 1 / INDUCTOR_DC_OHMS, ieq: 0 };
  const l = Math.max(model.henries, 1e-15);
  if (step.method === 'trapezoidal') {
    const g = step.dt / (2 * l);
    return { g, ieq: i0 + g * v0 };
  }
  return { g: step.dt / l, ieq: i0 };
}

export function stampReactive(r: Reactive, stamp: Stamp): void {
  if (r.g !== 0) stamp.addG(r.inner, r.b, r.g);
  if (r.ieq !== 0) stamp.addI(r.inner, r.b, r.ieq);
}
