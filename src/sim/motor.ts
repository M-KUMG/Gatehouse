// Brushed DC motor, model kind 'motor'. Pins: pos, neg.
//
//   electrical: V = R i + L di/dt + ke * omega
//   mechanical: J d omega / dt = kt i - b omega - load        (kt = ke in SI units)
//
// How the solver sees it: before every solve `expandMotors` replaces the
// motor by an inductor (henries, with the armature resistance as dcr; same
// component id; pos -> a) in series with a battery that plays the back-EMF
// ke * omega (helper id, its negative pole is the motor's neg pin), the same
// way relay.ts expands a relay. The shaft speed `omega` is the motor's logic
// state (MotorLogic, kept in TransientState.logic): after each solve it is
// decided again from the armature current with an implicit step
//   omega' = (omega + dt (kt i - load) / J) / (1 + dt b / J)
// starting from the last ACCEPTED speed, and the solve repeats while it
// changes (solveSettled); a DC solve has dt = 0, so the rotor stands still
// (the stall current flows). `dt` is the time-step length of the call.
//
// Defaults: a 6 V toy motor (RF-130 class): R 3 ohm, L 1.5 mH, no-load speed
// 8000 rpm at 6 V with 0.1 A, ke = kt = 6.8 mV s/rad, b = 8.1e-7 N m s,
// rotor inertia 1e-6 kg m^2 (mechanical time constant about 65 ms), stall
// current 2 A.
//
// Result under the motor's own pins: voltage across pos-neg, current into
// pos, power in, and under `volts` the shaft: 'mech.omega' (rad/s),
// 'mech.rpm', 'mech.torque' (N m), 'mech.emf' (V).

import { contactId } from './relay';
import type { ComponentModel, PartResult, SimInput, SimResult } from './types';

export type MotorModel = Extract<ComponentModel, { kind: 'motor' }>;

export const MOTOR_DEFAULT: MotorModel = {
  kind: 'motor', ohms: 3, henries: 1.5e-3, ke: 0.0068, friction: 8.1e-7, inertia: 1e-6, load: 0,
};
export const MOTOR_NOMINAL_VOLTS = 6;
export const MOTOR_WARN_AMPS = 1.5;
export const MOTOR_BURN_AMPS = 10;

export interface MotorLogic {
  /** Shaft speed in rad/s (positive when pos is the higher pole). */
  omega: number;
}
export const DEFAULT_MOTOR_LOGIC: MotorLogic = { omega: 0 };

export function isMotorLogic(l: unknown): l is MotorLogic {
  return typeof l === 'object' && l !== null && Number.isFinite((l as MotorLogic).omega);
}

/** The new speed after `dt` seconds from the armature current (implicit friction and torque). */
export function decideMotor(prev: MotorLogic, amps: number, dt: number, m: MotorModel): MotorLogic {
  if (!(dt > 0)) return prev;
  const j = Math.max(m.inertia, 1e-12);
  const torque = m.ke * amps - m.load * Math.sign(prev.omega || amps);
  const omega = (prev.omega + (dt * torque) / j) / (1 + (dt * m.friction) / j);
  return { omega };
}

export function sameMotor(a: MotorLogic, b: MotorLogic): boolean {
  return Math.abs(a.omega - b.omega) <= 1e-7 * Math.max(1, Math.abs(a.omega));
}

/** Longest time step that follows the mechanical time constant J R / ke^2 (a twentieth of it); Infinity without motors. */
export function motorMaxStep(input: SimInput): number {
  let limit = Infinity;
  for (const { model: m } of input.components) {
    if (m.kind !== 'motor' || !(m.ke > 0)) continue;
    const tau = (m.inertia * m.ohms) / (m.ke * m.ke);
    limit = Math.min(limit, tau / 20);
  }
  return limit;
}

/** Id of the helper source standing for the back-EMF of motor `id`. */
export const emfId = (id: number): number => contactId(id, 0);

export function expandMotors(
  input: SimInput, logic: Readonly<Record<number, unknown>> | undefined,
): { input: SimInput; motors: { id: number; omega: number; m: MotorModel }[] } {
  if (!input.components.some((c) => c.model.kind === 'motor')) return { input, motors: [] };
  const motors: { id: number; omega: number; m: MotorModel }[] = [];
  const components: SimInput['components'] = [];
  const links: SimInput['links'] = [];
  const mapped = new Set<number>();
  for (const c of input.components) {
    if (c.model.kind !== 'motor') {
      components.push(c);
      continue;
    }
    const held = logic?.[c.id];
    const omega = isMotorLogic(held) ? held.omega : 0;
    motors.push({ id: c.id, omega, m: c.model });
    mapped.add(c.id);
    components.push({ id: c.id, model: { kind: 'inductor', henries: c.model.henries, dcr: c.model.ohms } });
    components.push({ id: emfId(c.id), model: { kind: 'battery', volts: c.model.ke * omega, rInternal: 1e-6 } });
    links.push([{ part: c.id, pin: 'b' }, { part: emfId(c.id), pin: 'pos' }]);
  }
  const rename = (t: { part: number; pin: string }): { part: number; pin: string } => {
    if (!mapped.has(t.part)) return t;
    if (t.pin === 'pos') return { part: t.part, pin: 'a' };
    if (t.pin === 'neg') return { part: emfId(t.part), pin: 'neg' };
    return t;
  };
  for (const [a, b] of input.links) links.push([rename(a), rename(b)]);
  return { input: { ...input, components, links }, motors };
}

/** Puts the solved helper parts back into the motor's own result (see the top of the file). */
export function motorResults(result: SimResult, motors: readonly { id: number; omega: number; m: MotorModel }[]): void {
  for (const { id, omega, m } of motors) {
    const coil = result.parts[id];
    const emf = result.parts[emfId(id)];
    if (!coil || !emf) continue;
    const volt = (n: number): number => result.voltages[n] ?? 0;
    result.nets[`${id}:pos`] = result.nets[`${id}:a`] ?? 0;
    result.nets[`${id}:neg`] = result.nets[`${emfId(id)}:neg`] ?? 0;
    const v = volt(result.nets[`${id}:pos`]) - volt(result.nets[`${id}:neg`]);
    const i = coil.current;
    const out: PartResult = {
      voltage: v,
      current: i,
      power: v * i,
      pins: { pos: coil.pins.a ?? 0, neg: -(coil.pins.a ?? 0) },
      volts: {
        'mech.omega': omega,
        'mech.rpm': (omega * 60) / (2 * Math.PI),
        'mech.torque': m.ke * i,
        'mech.emf': m.ke * omega,
      },
    };
    result.parts[id] = out;
    delete result.parts[emfId(id)];
    for (const key of Object.keys(result.nets)) if (key.startsWith(`${emfId(id)}:`)) delete result.nets[key];
  }
}
