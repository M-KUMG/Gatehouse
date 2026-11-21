import { describe, expect, it } from 'vitest';
import { PALETTE, VOLTAGE_HIGH, VOLTAGE_LOW, voltageColor } from './canvaspalette';

describe('PALETTE', () => {
  const isColour = (s: string): boolean =>
    /^#[0-9a-f]{3,8}$/i.test(s) || /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/.test(s);

  it('holds only valid colours (a typo would silently draw nothing)', () => {
    for (const [name, value] of Object.entries(PALETTE)) expect(isColour(value), `${name}: ${value}`).toBe(true);
  });

  it('uses the same blue as the interface accent', () => {
    expect(PALETTE.accent).toBe('#4ea1ff');
  });
});

describe('voltageColor', () => {
  const rgb = (s: string): number[] => (s.match(/\d+/g) ?? []).map(Number);

  it('is the cool colour at 0 V and the warm one at the top voltage', () => {
    expect(rgb(voltageColor(0, 5))).toEqual([...VOLTAGE_LOW]);
    expect(rgb(voltageColor(5, 5))).toEqual([...VOLTAGE_HIGH]);
  });

  it('blends in between', () => {
    const mid = rgb(voltageColor(2.5, 5));
    expect(mid[0]).toBe(Math.round((VOLTAGE_LOW[0] + VOLTAGE_HIGH[0]) / 2));
    expect(mid[2]).toBe(Math.round((VOLTAGE_LOW[2] + VOLTAGE_HIGH[2]) / 2));
  });

  it('clamps voltages outside 0..max', () => {
    expect(rgb(voltageColor(-3, 5))).toEqual([...VOLTAGE_LOW]);
    expect(rgb(voltageColor(99, 5))).toEqual([...VOLTAGE_HIGH]);
  });

  it('is the cool colour when the voltage is unknown or the circuit has none', () => {
    expect(rgb(voltageColor(undefined, 5))).toEqual([...VOLTAGE_LOW]);
    expect(rgb(voltageColor(3, 0))).toEqual([...VOLTAGE_LOW]);
    expect(rgb(voltageColor(NaN, 5))).toEqual([...VOLTAGE_LOW]);
    expect(rgb(voltageColor(3, NaN))).toEqual([...VOLTAGE_LOW]);
  });
});
