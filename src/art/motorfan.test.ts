import { describe, expect, it } from 'vitest';
import { drawMotorFan, fanSpinning, setFansDriven } from './motor';

// Only the calls drawMotorFan makes; nothing is drawn.
const ctx = new Proxy({}, { get: () => () => {}, set: () => true }) as unknown as CanvasRenderingContext2D;

describe('motor fan', () => {
  it('winds up and coasts to a stop instead of freezing or stopping at once', () => {
    let t = 1000;
    drawMotorFan(ctx, 7, 800, t);
    for (let i = 0; i < 60; i++) drawMotorFan(ctx, 7, 800, (t += 50)); // powered for 3 s
    expect(fanSpinning(t)).toBe(true);
    drawMotorFan(ctx, 7, 0, (t += 50)); // power off: the shaft is at rest, the drawing still turns
    expect(fanSpinning(t)).toBe(true);
    for (let i = 0; i < 100; i++) drawMotorFan(ctx, 7, 0, (t += 50)); // 5 s later
    expect(fanSpinning(t)).toBe(false);
  });

  it('coasts to a stop when time is not running, although the shaft speed in the result stays frozen', () => {
    let t = 200_000;
    drawMotorFan(ctx, 5, 800, t);
    for (let i = 0; i < 60; i++) drawMotorFan(ctx, 5, 800, (t += 50));
    setFansDriven(false);
    for (let i = 0; i < 100; i++) drawMotorFan(ctx, 5, 800, (t += 50)); // still 800 rad/s in the result
    setFansDriven(true);
    expect(fanSpinning(t)).toBe(false);
  });

  it('forgets a fan that is no longer drawn', () => {
    let t = 50_000;
    drawMotorFan(ctx, 9, 800, t);
    drawMotorFan(ctx, 9, 800, (t += 50));
    expect(fanSpinning(t)).toBe(true);
    expect(fanSpinning(t + 5000)).toBe(false);
  });
});
