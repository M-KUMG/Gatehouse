import { MOTOR_ART, drawMotorFan, motorSvg } from './art/motor';
import type { PartState, PartType } from './parts';
import { MOTOR_BURN_AMPS, MOTOR_DEFAULT, MOTOR_NOMINAL_VOLTS, MOTOR_WARN_AMPS, type MotorModel } from './sim/motor';

const RPM_TO_RADIANS_PER_SECOND = 2 * Math.PI / 60;
const DEFAULT_STALL_AMPS = MOTOR_NOMINAL_VOLTS / MOTOR_DEFAULT.ohms;
const DEFAULT_FREE_SPEED = MOTOR_NOMINAL_VOLTS
  / (MOTOR_DEFAULT.ke + MOTOR_DEFAULT.ohms * MOTOR_DEFAULT.friction / MOTOR_DEFAULT.ke);
const DEFAULT_FREE_RPM = DEFAULT_FREE_SPEED / RPM_TO_RADIANS_PER_SECOND;
const DEFAULT_FREE_AMPS = MOTOR_DEFAULT.friction * DEFAULT_FREE_SPEED / MOTOR_DEFAULT.ke;

/** Fit the three steady-state parameters. Inductance and inertia keep the generic motor's values. */
function motorModelOf(state: PartState): MotorModel {
  const volts = state.value ?? MOTOR_NOMINAL_VOLTS;
  if (volts === MOTOR_NOMINAL_VOLTS && state.motorNoLoadRpm === undefined
    && state.motorNoLoadAmps === undefined && state.motorStallAmps === undefined) return MOTOR_DEFAULT;
  const freeAmps = state.motorNoLoadAmps ?? DEFAULT_FREE_AMPS;
  const stallAmps = state.motorStallAmps ?? DEFAULT_STALL_AMPS;
  const omega = (state.motorNoLoadRpm ?? DEFAULT_FREE_RPM) * RPM_TO_RADIANS_PER_SECOND;
  const ohms = volts / stallAmps;
  const ke = (volts - ohms * freeAmps) / omega;
  return { ...MOTOR_DEFAULT, ohms, ke, friction: ke * freeAmps / omega };
}

export const MOTOR_PART: PartType = {
  id: 'motor', name: 'DC motor', ...MOTOR_ART, mirrorable: true,
  pins: [{ id: 'pos', name: '+', x: 0, y: 1 }, { id: 'neg', name: '−', x: 0, y: 2 }],
  defaults: { value: MOTOR_NOMINAL_VOLTS },
  catalog: { file: 'dc-motors.json', label: 'DC motor', keys: ['value', 'motorNoLoadRpm', 'motorNoLoadAmps', 'motorStallAmps'] },
  value: { label: 'Rated voltage', unit: 'V', min: 0.1, max: 100 },
  fields: [
    { key: 'motorNoLoadRpm', label: 'No-load speed', unit: 'rpm', min: 1, max: 100000, defaultValue: () => DEFAULT_FREE_RPM },
    { key: 'motorNoLoadAmps', label: 'No-load current', unit: 'A', min: 0.001, max: 10, defaultValue: () => DEFAULT_FREE_AMPS },
    { key: 'motorStallAmps', label: 'Stall current', unit: 'A', min: 0.001, max: 100, defaultValue: () => DEFAULT_STALL_AMPS },
  ],
  validateSettings: (state) => (state.motorNoLoadAmps ?? DEFAULT_FREE_AMPS) < (state.motorStallAmps ?? DEFAULT_STALL_AMPS)
    ? null : 'No-load current must be lower than stall current.',
  warnWhen: (r, s) => Math.abs(r.current) > MOTOR_WARN_AMPS * (s.motorStallAmps ?? DEFAULT_STALL_AMPS) / DEFAULT_STALL_AMPS
    ? 'Too much current: add a series resistor.' : null,
  burnWhen: (r, s) => Math.abs(r.current) > MOTOR_BURN_AMPS * (s.motorStallAmps ?? DEFAULT_STALL_AMPS) / DEFAULT_STALL_AMPS
    ? 'too much current' : null,
  variant: (s) => {
    const volts = s.value ?? MOTOR_NOMINAL_VOLTS;
    if (volts === MOTOR_NOMINAL_VOLTS) return s.burned ? { key: 'burned', svg: motorSvg(true) } : null;
    return { key: `${s.burned ? 'burned-' : ''}${volts}`, svg: motorSvg(s.burned, volts) };
  },
  overlay: (ctx, s, r, id) => {
    if (!s.burned && r) drawMotorFan(ctx, id ?? -1, r.volts?.['mech.omega'] ?? 0);
  },
  sim: (s) => (s.burned ? { kind: 'open' } : motorModelOf(s)),
};
