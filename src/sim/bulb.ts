// Two mains light bulbs, model kinds 'bulb' (incandescent) and 'ledbulb'. Pins: a, b.
//
// Incandescent bulb. A tungsten filament: its resistance rises with its
// temperature (resistivity ~ T^1.2), and its temperature follows the power it
// receives against the heat it radiates:
//     R(T) = R_hot (T / T_rated)^1.2            R_hot = volts^2 / watts
//     C dT/dt = P - K (T^4 - T_amb^4)           K from P(T_rated) = watts
// so a cold bulb draws about 14 times its rated current (the switch-on surge)
// and settles within tens of milliseconds, and a bulb on a lower or higher
// voltage finds its own temperature: dim and orange, or bright and white (and
// burns when the filament would melt). The temperature is the bulb's logic
// state (BulbLogic, kept in TransientState.logic, decided after each solve by an
// implicit step from the last accepted one, like the motor's shaft speed); a DC
// solve has dt = 0, so the filament starts cold. How the solver sees it:
// `expandBulbs` replaces the bulb by a resistor of R(T) (same id and pins).
//
// LED bulb. A mains LED lamp is a rectifier and a driver in front of an LED
// string: nothing flows while the mains is below a threshold, then the current
// rises with the voltage. The model is a symmetric curve between a and b,
//     i(v) = sign(v) s(|v| - vth) / rs,     s(x) = (x + sqrt(x^2 + 1)) / 2,
// with vth 15 % of the rated peak and rs chosen so that the rated sine
// (volts RMS) dissipates exactly `watts` (ledBulbParams). Its light follows the
// average power (LedBulbLogic, a first-order average over 20 ms, so the 100 Hz
// pulsing does not show), so it dims on a lower voltage and a dimmer-less
// lamp is steady on the rated one.
//
// Result under the bulb's own pins: voltage, current and power as for any
// two-terminal part, and under `volts`: 'light' (1 at the rated power, above 1
// brighter than rated), and for the incandescent bulb 'filament.temp' (kelvin),
// for the LED bulb 'power.avg' (watts).

import type { ComponentModel, PartResult, SimInput, SimResult } from './types';

export type BulbModel = Extract<ComponentModel, { kind: 'bulb' }>;
export type LedBulbModel = Extract<ComponentModel, { kind: 'ledbulb' }>;

export const BULB_DEFAULT_VOLTS = 230;
export const BULB_DEFAULT_WATTS = 60;
export const LEDBULB_DEFAULT_WATTS = 9;
export const BULB_MIN_VOLTS = 3;
export const BULB_MAX_VOLTS = 500;
export const BULB_MAX_WATTS = 1000;

export const T_AMBIENT = 293;
export const T_RATED = 2700;
const RESISTIVITY_EXPONENT = 1.2;
/** Filament temperature from which the bulb is warned about / burned (the filament nears its 3695 K melting point). */
export const FILAMENT_WARN_K = 3000;
export const FILAMENT_BURN_K = 3300;
/** Average power over which an LED bulb's driver is warned about / burned (times its rating). */
export const LEDBULB_WARN_RATIO = 1.5;
export const LEDBULB_BURN_RATIO = 3;
/** Time constant (s) of the LED bulb's drawn light: the average over the mains pulses. */
const LED_AVERAGE_SECONDS = 0.02;

// ---- Incandescent -------------------------------------------------------------------------------------------------

export interface BulbLogic {
  /** Filament temperature in kelvin. */
  temp: number;
}
export const DEFAULT_BULB_LOGIC: BulbLogic = { temp: T_AMBIENT };

export function isBulbLogic(l: unknown): l is BulbLogic {
  return typeof l === 'object' && l !== null && Number.isFinite((l as BulbLogic).temp);
}

/** Resistance (ohms) of the hot filament at the rated temperature. */
export const bulbHotOhms = (m: BulbModel): number => (m.volts * m.volts) / Math.max(m.watts, 1e-3);

/** Resistance at filament temperature `temp`. */
export function bulbOhms(m: BulbModel, temp: number): number {
  return bulbHotOhms(m) * Math.pow(Math.max(temp, 1) / T_RATED, RESISTIVITY_EXPONENT);
}

/** Radiated power (W) at filament temperature `temp`. */
function radiated(m: BulbModel, temp: number): number {
  return (m.watts * (Math.pow(temp, 4) - Math.pow(T_AMBIENT, 4))) / (Math.pow(T_RATED, 4) - Math.pow(T_AMBIENT, 4));
}

/** Heat capacity (J/K): the filament settles in about 40 ms at 60 W, slower for a heavier one. */
function heatCapacity(m: BulbModel): number {
  const tau = 0.04 * Math.sqrt(Math.max(m.watts, 1) / 60);
  const slope = (4 * m.watts * Math.pow(T_RATED, 3)) / (Math.pow(T_RATED, 4) - Math.pow(T_AMBIENT, 4)); // d(radiated)/dT at the rated point
  return tau * slope;
}

/** The new filament temperature after `dt` seconds receiving `watts` (a linearized implicit step). */
export function decideBulb(prev: BulbLogic, watts: number, dt: number, m: BulbModel): BulbLogic {
  if (!(dt > 0)) return prev;
  const slope = (4 * m.watts * Math.pow(prev.temp, 3)) / (Math.pow(T_RATED, 4) - Math.pow(T_AMBIENT, 4));
  const next = prev.temp + (dt * (Math.max(watts, 0) - radiated(m, prev.temp))) / (heatCapacity(m) + dt * slope);
  return { temp: Math.min(6000, Math.max(T_AMBIENT, next)) };
}

export function sameBulb(a: BulbLogic, b: BulbLogic): boolean {
  return Math.abs(a.temp - b.temp) <= 1e-5 * Math.max(1, b.temp);
}

/** 0 for a cold filament, 1 at the rated temperature, above 1 when over-driven (visible light rises steeply with temperature). */
export function bulbLight(temp: number): number {
  const x = (temp - 900) / (T_RATED - 900);
  return x <= 0 ? 0 : Math.min(1.6, Math.pow(x, 3));
}

/** `input` with every incandescent bulb replaced by a resistor of its present resistance (same id and pins). */
export function expandBulbs(input: SimInput, logic: Readonly<Record<number, unknown>> | undefined): { input: SimInput; bulbs: { id: number; m: BulbModel; temp: number }[] } {
  if (!input.components.some((c) => c.model.kind === 'bulb')) return { input, bulbs: [] };
  const bulbs: { id: number; m: BulbModel; temp: number }[] = [];
  const components = input.components.map((c) => {
    if (c.model.kind !== 'bulb') return c;
    const held = logic?.[c.id];
    const temp = isBulbLogic(held) ? held.temp : T_AMBIENT;
    bulbs.push({ id: c.id, m: c.model, temp });
    return { ...c, model: { kind: 'resistor' as const, ohms: bulbOhms(c.model, temp) } };
  });
  return { input: { ...input, components }, bulbs };
}

// ---- LED bulb -----------------------------------------------------------------------------------------------------

export interface LedBulbLogic {
  /** Average power in watts (first-order, 20 ms). */
  avg: number;
}
export const DEFAULT_LEDBULB_LOGIC: LedBulbLogic = { avg: 0 };

export function isLedBulbLogic(l: unknown): l is LedBulbLogic {
  return typeof l === 'object' && l !== null && Number.isFinite((l as LedBulbLogic).avg);
}

export function decideLedBulb(prev: LedBulbLogic, watts: number, dt: number): LedBulbLogic {
  if (!(dt > 0)) return prev;
  const k = dt / LED_AVERAGE_SECONDS;
  return { avg: (prev.avg + k * Math.max(watts, 0)) / (1 + k) };
}

export function sameLedBulb(a: LedBulbLogic, b: LedBulbLogic): boolean {
  return Math.abs(a.avg - b.avg) <= 1e-6 * Math.max(1, Math.abs(b.avg));
}

export interface LedBulbParams {
  /** Conduction threshold in volts. */
  vth: number;
  /** Series resistance in ohms. */
  rs: number;
}

const ramp = (x: number): number => 0.5 * (x + Math.sqrt(x * x + 1));

/** The ramp past the threshold, shifted so that it is exactly 0 at 0 V: the curve is odd and continuous there (a bulb alone, with nothing to pin its voltage, must settle at 0 V). */
const lifted = (v: number, vth: number): number => ramp(v - vth) - ramp(-vth);

const params = new Map<string, LedBulbParams>();

/** Threshold and series resistance for which a sine of `volts` RMS dissipates `watts` (computed once per pair). */
export function ledBulbParams(m: LedBulbModel): LedBulbParams {
  const key = `${m.volts}/${m.watts}`;
  const known = params.get(key);
  if (known) return known;
  const peak = m.volts * Math.SQRT2;
  const vth = 0.15 * peak;
  // Mean of v * s(|v| - vth) over one period, by the midpoint rule; P = mean / rs.
  const steps = 720;
  let sum = 0;
  for (let k = 0; k < steps; k++) {
    const v = Math.abs(peak * Math.sin((2 * Math.PI * (k + 0.5)) / steps));
    sum += v * lifted(v, vth);
  }
  const made = { vth, rs: sum / steps / Math.max(m.watts, 1e-3) };
  params.set(key, made);
  return made;
}

/** Current (a to b) and slope of the LED bulb at `v` volts across it. */
export function ledBulbCurve(p: LedBulbParams, v: number): { i: number; g: number } {
  const x = Math.abs(v) - p.vth;
  const sign = v < 0 ? -1 : 1;
  return { i: (sign * lifted(Math.abs(v), p.vth)) / p.rs, g: (0.5 * (1 + x / Math.sqrt(x * x + 1))) / p.rs };
}

// ---- Results ------------------------------------------------------------------------------------------------------

/** Adds `light` (and the filament temperature or the average power) to the bulbs' results. */
export function bulbResults(result: SimResult, input: SimInput, logic: Readonly<Record<number, unknown>> | undefined): void {
  for (const { id, model: m } of input.components) {
    const out: PartResult | undefined = result.parts[id];
    if (!out) continue;
    if (m.kind === 'bulb') {
      const held = logic?.[id];
      const temp = isBulbLogic(held) ? held.temp : T_AMBIENT;
      out.volts = { ...out.volts, 'filament.temp': temp, light: bulbLight(temp) };
    } else if (m.kind === 'ledbulb') {
      const held = logic?.[id];
      const avg = isLedBulbLogic(held) ? held.avg : 0;
      out.volts = { ...out.volts, 'power.avg': avg, light: Math.min(1.6, avg / Math.max(m.watts, 1e-3)) };
    }
  }
}

/** Warning / burn text for a bulb's state from its result, or ok. */
export function bulbStress(
  m: BulbModel | LedBulbModel, r: PartResult,
): { level: 'ok' } | { level: 'warn' | 'burn'; short: string; reason: string } {
  if (m.kind === 'bulb') {
    const t = r.volts?.['filament.temp'] ?? T_AMBIENT;
    if (t > FILAMENT_BURN_K) return { level: 'burn', short: 'filament burned!', reason: `filament burned out (${Math.round(t)} K, over-voltage: rated ${m.volts} V)` };
    if (t > FILAMENT_WARN_K) return { level: 'warn', short: 'over-voltage!', reason: `Filament at ${Math.round(t)} K: far above its rated ${m.volts} V, it will burn out.` };
    return { level: 'ok' };
  }
  const avg = r.volts?.['power.avg'] ?? 0;
  if (avg > LEDBULB_BURN_RATIO * m.watts) return { level: 'burn', short: 'driver burned!', reason: `driver burned out (${avg.toFixed(1)} W, rated ${m.watts} W)` };
  if (avg > LEDBULB_WARN_RATIO * m.watts) return { level: 'warn', short: 'over-voltage!', reason: `${avg.toFixed(1)} W is far above its rated ${m.watts} W.` };
  return { level: 'ok' };
}
