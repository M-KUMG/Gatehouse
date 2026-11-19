// Absolute maximum ratings: when a part is stressed (a warning first) and
// when it is destroyed (it burns). Pure functions of values the solver
// reports, shared by the part types (parts.ts: warnWhen / burnWhen, which
// Simulation.burnParts and the readouts call) and the part inspector
// (inspect.ts), so the hover text, the inspector and the burn rule agree.
// Strict (PLAN step 7c's default): a part burns as soon as a limit is
// crossed; a forgiving setting, heating and time constants come later.
// The ratings are constants per part type for now; they become data in the
// component library (PLAN step 10).

/** How a part stands against its ratings. `short` is the inspector's state text. */
export type Stress =
  | { level: 'ok'; short: 'ok' }
  | { level: 'warn' | 'burn'; short: string; reason: string };

const OK: Stress = { level: 'ok', short: 'ok' };

/** Reverse voltage (+ below -) at which a polarized capacitor is warned about. */
export const ECAP_REVERSE_WARN_VOLTS = 0.3;
/** Reverse voltage beyond which a polarized capacitor is destroyed. */
export const ECAP_REVERSE_BURN_VOLTS = 1.0;
/** Fraction of a rated voltage above which a part is warned about. */
export const RATED_WARN_FRACTION = 0.9;

/** Volts across the ideal capacitance (the dielectric), i.e. the terminal voltage minus the ESR drop. */
export function dielectricVolts(terminalVolts: number, amps: number, esr = 0): number {
  return terminalVolts - amps * esr;
}

/**
 * A polarized (electrolytic) capacitor at `volts` (+ minus -, across the
 * dielectric) with a rated voltage `rated`: burns below -1.0 V or above the
 * rating, warned below -0.3 V or above 90 % of the rating.
 */
export function polarizedCapStress(volts: number, rated: number): Stress {
  if (volts < -ECAP_REVERSE_BURN_VOLTS) {
    return { level: 'burn', short: 'reverse!', reason: 'reverse voltage (+ lead below the − lead)' };
  }
  if (volts > rated) return { level: 'burn', short: 'over-voltage!', reason: `over-voltage (above its ${rated} V rating)` };
  if (volts < -ECAP_REVERSE_WARN_VOLTS) {
    return { level: 'warn', short: 'reverse!', reason: 'Reversed! The + lead must be on the higher voltage.' };
  }
  if (volts > RATED_WARN_FRACTION * rated) {
    return { level: 'warn', short: 'over-voltage!', reason: `Near its ${rated} V rating: use a capacitor rated higher.` };
  }
  return OK;
}

/** IGBT limits: collector-emitter breakdown, pulsed and continuous collector current, gate-emitter voltage. */
export interface IgbtRatings {
  vceMax: number;
  icPulse: number;
  icCont: number;
  vgeMax: number;
}

/** Generic 600 V / 20 A TO-247 IGBT: burns above 650 V (avalanche) or 60 A (the pulsed rating). */
export const IGBT_RATINGS: IgbtRatings = { vceMax: 650, icPulse: 60, icCont: 20, vgeMax: 20 };

/**
 * An IGBT at Vce, Ic and Vge in its own frame (positive when an N-IGBT
 * conducts; a P-IGBT's values with the signs turned round): burns above
 * vceMax or with |Ic| above icPulse; warned above 600 V (90 % of 650 V,
 * roughly the 600 V rating), above the continuous current or with |Vge|
 * above vgeMax (the gate oxide; warning only for now).
 */
export function igbtStress(vce: number, ic: number, vge: number, r: IgbtRatings = IGBT_RATINGS): Stress {
  if (Math.abs(ic) > r.icPulse) return { level: 'burn', short: 'over-current!', reason: `too much collector current (above ${r.icPulse} A)` };
  if (vce > r.vceMax) return { level: 'burn', short: 'over-voltage!', reason: `collector-emitter over-voltage (above ${r.vceMax} V)` };
  if (Math.abs(ic) > r.icCont) {
    return { level: 'warn', short: 'over-current!', reason: `Above its ${r.icCont} A continuous rating (burns above ${r.icPulse} A).` };
  }
  if (vce > RATED_WARN_FRACTION * r.vceMax) {
    return { level: 'warn', short: 'over-voltage!', reason: `Near its collector-emitter limit (burns above ${r.vceMax} V).` };
  }
  if (Math.abs(vge) > r.vgeMax) return { level: 'warn', short: 'gate over-voltage!', reason: `Gate voltage beyond ±${r.vgeMax} V.` };
  return OK;
}
