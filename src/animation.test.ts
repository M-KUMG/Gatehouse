import { describe, expect, it } from 'vitest';
import { FlowPhases, MAX_FRAME_SECONDS, MIN_FLOW_AMPS, advancePhase, flowRate, frameSeconds, needsAnimation } from './animation';

describe('current flow animation', () => {
  it('runs only while current flows or a board runs', () => {
    expect(needsAnimation({ maxWireAmps: 0, boardRunning: false })).toBe(false);
    expect(needsAnimation({ maxWireAmps: MIN_FLOW_AMPS / 2, boardRunning: false })).toBe(false);
    expect(needsAnimation({ maxWireAmps: 0.02, boardRunning: false })).toBe(true);
    expect(needsAnimation({ maxWireAmps: 0, boardRunning: true })).toBe(true);
  });

  it('measures frames from the previous one, starting from 0 and capped after a stall', () => {
    expect(frameSeconds(null, 5000)).toBe(0);
    expect(frameSeconds(1000, 1016)).toBeCloseTo(0.016, 9);
    expect(frameSeconds(1000, 61_000)).toBe(MAX_FRAME_SECONDS); // a hidden tab came back
    expect(frameSeconds(1000, 900)).toBe(0);
  });

  it('moves faster for more current and not at all below the threshold', () => {
    expect(flowRate(0)).toBe(0);
    expect(flowRate(0.001)).toBeGreaterThan(flowRate(0.0001));
    expect(flowRate(-0.001)).toBe(flowRate(0.001));
    expect(advancePhase(0.9, 1, 0.25)).toBeCloseTo(0.15, 9);
  });

  it('does not depend on the frame rate', () => {
    const at60 = new FlowPhases();
    const at30 = new FlowPhases();
    let a = 0;
    let b = 0;
    for (let i = 0; i < 60; i++) {
      at60.begin(1 / 60);
      a = at60.phase(7, 0.02);
      at60.phase(7, 0.02); // drawn twice in one frame: advances once
      at60.end();
    }
    for (let i = 0; i < 30; i++) {
      at30.begin(1 / 30);
      b = at30.phase(7, 0.02);
      at30.end();
    }
    expect(a).toBeCloseTo(b, 9);
    expect(a).toBeCloseTo(advancePhase(0, flowRate(0.02), 1), 9);
  });

  it('forgets wires that stopped carrying current', () => {
    const flow = new FlowPhases();
    flow.begin(0.1);
    expect(flow.phase(1, 0.01)).toBeGreaterThan(0);
    flow.end();
    flow.begin(0.1);
    flow.end(); // wire 1 not drawn with current
    flow.begin(0);
    expect(flow.phase(1, 0.01)).toBe(0);
  });
});
