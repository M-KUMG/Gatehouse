import { describe, expect, it } from 'vitest';
import { isBuzzerMuted, markBuzzing, setBuzzerMuted } from './buzzsound';

describe('buzzer sound', () => {
  it('is safe without any audio support (tests, old browsers)', () => {
    expect(() => markBuzzing(3)).not.toThrow();
    setBuzzerMuted(true);
    expect(isBuzzerMuted()).toBe(true);
    setBuzzerMuted(false);
    expect(isBuzzerMuted()).toBe(false);
  });
});
