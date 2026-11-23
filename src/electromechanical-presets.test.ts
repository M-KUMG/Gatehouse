import { describe, expect, it } from 'vitest';
import { getPart, partWarning } from './parts';
import { ACTIVE_BUZZER, buzzerCurve } from './sim/buzzer';
import { MOTOR_DEFAULT } from './sim/motor';
import type { PartResult } from './sim/types';

const measurement = (voltage: number, current: number): PartResult => ({ voltage, current, power: voltage * current, pins: {} });

describe('electromechanical preset behavior', () => {
  it('fits stall current and steady no-load speed and current to the motor specifications', () => {
    const motor = getPart('motor')!;
    expect(motor.sim?.({})).toEqual(MOTOR_DEFAULT);
    const model = motor.sim?.({ value: 3, motorNoLoadRpm: 12300, motorNoLoadAmps: 0.15, motorStallAmps: 2.1 });
    if (model?.kind !== 'motor') throw new Error('Expected a motor model');
    const freeSpeed = 3 / (model.ke + model.ohms * model.friction / model.ke);
    expect(3 / model.ohms).toBeCloseTo(2.1, 10);
    expect(model.friction * freeSpeed / model.ke).toBeCloseTo(0.15, 10);
    expect(freeSpeed * 60 / (2 * Math.PI)).toBeCloseTo(12300, 8);
    expect(motor.variant?.({ value: 3 })?.svg).toContain('3 V');
  });

  it('uses the buzzer operating range for the load, sound readout, and forward over-voltage warning', () => {
    const buzzer = getPart('buzzer')!;
    expect(buzzer.sim?.({})).toEqual(ACTIVE_BUZZER);
    const state = { value: 12, buzzerMinVolts: 10, buzzerMaxVolts: 13, buzzerRatedAmps: 0.03 };
    const model = buzzer.sim?.(state);
    if (model?.kind !== 'buzzer') throw new Error('Expected a buzzer model');
    expect(buzzerCurve(model, 5).i).toBeCloseTo(5e-6, 10);
    expect(buzzerCurve(model, 12).i).toBeCloseTo(0.03, 10);
    expect(buzzer.readout?.(measurement(5, 5e-6), state)).toContain('silent');
    expect(buzzer.readout?.(measurement(12, 0.03), state)).toContain('sounding');
    expect(partWarning(buzzer, measurement(12, 0.03), state)).toBeNull();
    expect(partWarning(buzzer, measurement(14, 0.035), state)).toContain('13 V');
  });

  it('uses selected switch and transformer ratings in overload checks', () => {
    const toggle = getPart('switch')!;
    expect(partWarning(toggle, measurement(0, 2), { closed: true })).toContain('1 A');
    expect(partWarning(toggle, measurement(0, 2), { closed: true, contactAmps: 4 })).toBeNull();
    const changeover = getPart('changeover')!;
    expect(partWarning(changeover, measurement(0, 15), { closed: true })).toContain('10 A');
    expect(partWarning(changeover, measurement(0, 15), { closed: true, contactAmps: 16 })).toBeNull();
    expect(changeover.variant?.({ closed: true, contactAmps: 16 })?.svg).toContain('16 A');

    const transformer = getPart('transformer')!;
    const load = { ...measurement(0, 0), pins: { s1: 0.6 } };
    expect(partWarning(transformer, load, {})).toBeNull();
    expect(partWarning(transformer, load, { transformerVa: 2.8 })).toContain('2.8 VA');
  });
});
