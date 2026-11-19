import { describe, expect, it, vi } from 'vitest';
import { BoardClock, type FrameSource } from './boardclock';
import { EXAMPLES } from './examples';
import { Scene } from './model';
import type { ComponentModel, SimInput } from './sim';
import { Simulation, buildNetlist } from './simulation';
import { SPEEDS, formatSimTime, nearestSpeed, speedLabel, transportState, transportView } from './transportmodel';

const pin = (s: string) => ({ part: Number(s.split('.')[0]), pin: s.split('.')[1] });
const CAP = 3;

/** Battery 5 V -> R -> C -> battery, grounded. Ids 1..4. */
function rc(ohms: number, farads: number): SimInput {
  const models: ComponentModel[] = [
    { kind: 'battery', volts: 5, rInternal: 0 },
    { kind: 'resistor', ohms },
    { kind: 'capacitor', farads },
    { kind: 'ground' },
  ];
  return {
    components: models.map((model, i) => ({ id: i + 1, model })),
    links: [[pin('1.pos'), pin('2.a')], [pin('2.b'), pin('3.a')], [pin('3.b'), pin('1.neg')], [pin('1.neg'), pin('4.gnd')]],
  };
}

/** A Simulation of a raw circuit (no parts on the grid); `circuit.input` may be replaced to edit it. */
function rawSim(input: SimInput): { sim: Simulation; circuit: { input: SimInput } } {
  const circuit = { input };
  const sim = new Simulation(new Scene(), () => ({ input: circuit.input, wireIds: [] }));
  sim.update();
  return { sim, circuit };
}

/** Frames on a fake wall clock: `frame(ms)` moves it on and runs the pending frame. */
function fakeFrames(): FrameSource & { frame(ms: number): boolean } {
  let now = 0;
  let pending: ((now: number) => void) | null = null;
  return {
    request(cb) {
      pending = cb;
      return 1;
    },
    now: () => now,
    frame(ms) {
      now += ms;
      const cb = pending;
      pending = null;
      cb?.(now);
      return cb !== null;
    },
  };
}

const capVolts = (sim: Simulation): number => sim.partResult(CAP)!.voltage;

describe('circuit clock without boards (Start / Pause / Reset)', () => {
  // R = 100 kohm, C = 1 uF: RC = 100 ms, so frames of 16 ms show the curve.
  const R = 100_000;
  const C = 1e-6;
  const charge = (t: number): number => 5 * (1 - Math.exp(-t / (R * C)));

  /** Runs `frames` frames of `ms` wall milliseconds at `speed`; returns the cap volts by simulated ms. */
  function runAt(speed: number, frames: number, ms: number): { sim: Simulation; byTime: Map<number, number> } {
    const { sim } = rawSim(rc(R, C));
    const source = fakeFrames();
    const clock = new BoardClock(sim, () => {}, source);
    clock.multiplier = speed;
    sim.start();
    clock.wake();
    const byTime = new Map<number, number>();
    for (let i = 0; i < frames; i++) {
      source.frame(ms);
      byTime.set(Math.round(sim.time * 1000), capVolts(sim));
    }
    return { sim, byTime };
  }

  it('before Start: stopped, the DC point (capacitor full), time not moving', () => {
    const { sim } = rawSim(rc(R, C));
    expect(sim.transport()).toBe('stopped');
    expect(sim.hasReactiveParts).toBe(true);
    expect(sim.timeRunning).toBe(false);
    expect(capVolts(sim)).toBeCloseTo(5, 6);
    sim.advance(0.01);
    expect(sim.time).toBe(0);
  });

  it('charges along the RC curve within 2% at 1x and at 10x, with identical numbers at the same simulated time', () => {
    const one = runAt(1, 20, 16); // 320 ms simulated
    const ten = runAt(10, 2, 16); // 320 ms simulated in two frames
    expect(one.sim.time).toBeCloseTo(0.32, 9);
    expect(ten.sim.time).toBeCloseTo(0.32, 9);
    for (const [ms, v] of one.byTime) expect(Math.abs(v - charge(ms / 1000)) / charge(ms / 1000)).toBeLessThan(0.02);
    for (const [ms, v] of ten.byTime) expect(v).toBe(one.byTime.get(ms)); // speed only changes the pacing
    expect(ten.byTime.size).toBe(2);
  });

  it('measures the achieved speed and stops the frame loop when paused', () => {
    const { sim } = rawSim(rc(R, C));
    const source = fakeFrames();
    const clock = new BoardClock(sim, () => {}, source);
    clock.multiplier = 2;
    sim.start();
    clock.wake();
    source.frame(16);
    source.frame(16);
    expect(clock.speed).toBeCloseTo(2, 9);
    sim.pause();
    expect(sim.transport()).toBe('paused');
    const t = sim.time;
    expect(source.frame(16)).toBe(true); // the last frame notices the pause...
    expect(source.frame(16)).toBe(false); // ...and asks for no more
    expect(sim.time).toBe(t);
    expect(clock.speed).toBe(0);
  });

  it('an edit while running keeps the charge; Reset empties it and goes back to 0, stopped', () => {
    const { sim, circuit } = rawSim(rc(R, C));
    sim.start();
    sim.advance(0.1);
    const v = capVolts(sim);
    expect(v).toBeCloseTo(charge(0.1), 1);
    circuit.input = rc(R / 10, C); // a smaller resistor (same ids)
    sim.update();
    expect(capVolts(sim)).toBeCloseTo(v, 4);
    sim.advance(0.01);
    const want = 5 - (5 - v) * Math.exp(-0.01 / ((R / 10) * C));
    expect(Math.abs(capVolts(sim) - want) / want).toBeLessThan(0.02);

    sim.reset();
    expect(sim.transport()).toBe('stopped');
    expect(sim.time).toBe(0);
    expect(sim.timeRunning).toBe(false);
    expect(capVolts(sim)).toBeCloseTo(5, 6); // the DC point again
    sim.start();
    sim.advance(0.01);
    const fromEmpty = 5 * (1 - Math.exp(-0.01 / ((R / 10) * C))); // started empty (the edited circuit)
    expect(Math.abs(capVolts(sim) - fromEmpty) / fromEmpty).toBeLessThan(0.02);
  });

  it('a circuit without capacitors: Start shows running but time stands still (DC path unchanged)', () => {
    const plain = rc(R, C);
    plain.components = plain.components.filter((c) => c.id !== CAP);
    const { sim } = rawSim(plain);
    sim.start();
    expect(sim.transport()).toBe('running');
    expect(sim.timeRunning).toBe(false);
    sim.advance(0.01);
    expect(sim.time).toBe(0);
  });
});

describe('global transport with boards', () => {
  /** The "Uno blink" example (runs firmware.hex) plus a 1k + 1 uF from the Uno's 5 V to its gnd. */
  function blinkWithCap(): { sim: Simulation; uno: number } {
    const scene = new Scene();
    scene.insert(EXAMPLES.find((e) => e.name === 'Uno blink')!.state);
    const uno = scene.parts.find((p) => p.typeId === 'uno')!.id;
    const sim = new Simulation(scene, (s) => {
      const { input, wireIds } = buildNetlist(s);
      input.components.push({ id: 9001, model: { kind: 'resistor', ohms: 1000 } }, { id: 9002, model: { kind: 'capacitor', farads: 1e-6 } });
      input.links.push([pin(`${uno}.5v`), pin('9001.a')], [pin('9001.b'), pin('9002.a')], [pin('9002.b'), pin(`${uno}.gnd`)]);
      return { input, wireIds };
    });
    sim.update();
    return { sim, uno };
  }

  it('Start runs the boards and the clock, Pause pauses both, Reset resets both', async () => {
    const { sim, uno } = blinkWithCap();
    expect(sim.transport()).toBe('stopped');
    sim.start();
    await vi.waitFor(() => expect(sim.boards.boardRunState(uno).state).toBe('running'));
    expect(sim.transport()).toBe('running');
    sim.advance(0.002);
    expect(sim.time).toBeCloseTo(0.002, 9);
    expect(sim.boards.boardRunState(uno).time).toBeCloseTo(0.002, 4);
    expect(sim.partResult(9002)!.voltage).toBeGreaterThan(0.5);

    sim.pause();
    expect(sim.boards.boardRunState(uno).state).toBe('paused');
    expect(sim.transport()).toBe('paused');
    expect(sim.timeRunning).toBe(false);

    // The board's own Run while globally paused: global state follows (running).
    await sim.boards.runBoard(uno);
    expect(sim.transport()).toBe('running');
    sim.boards.pauseBoard(uno);
    expect(sim.transport()).toBe('paused');

    sim.reset();
    await vi.waitFor(() => expect(sim.boards.boardRunState(uno).building).toBe(false));
    expect(sim.boards.boardRunState(uno)).toMatchObject({ state: 'stopped', time: 0 });
    expect(sim.transport()).toBe('stopped');
    expect(sim.time).toBe(0);
    expect(sim.partResult(9002)!.voltage).toBeCloseTo(5, 3); // the DC point
  });

  it('Start skips a board in the error state and leaves its status as it is; the circuit clock still runs', async () => {
    const scene = new Scene();
    const part = scene.add({ typeId: 'uno', col: 0, row: 0, rotation: 0 }); // no firmware: cannot run
    const sim = new Simulation(scene);
    sim.update();
    await sim.boards.runBoard(part.id);
    const before = sim.boards.boardRunState(part.id);
    expect(before.state).toBe('error');
    const run = vi.spyOn(sim.boards, 'runBoard');
    sim.start();
    expect(run).not.toHaveBeenCalled();
    expect(sim.boards.boardRunState(part.id)).toEqual(before);
    expect(sim.transport()).toBe('running');
  });
});

describe('transport model', () => {
  it('derives the global state from the boards and the circuit clock', () => {
    const s = (boards: Parameters<typeof transportState>[0]['boards'], circuitRunning = false, circuitStarted = false) =>
      transportState({ boards, circuitRunning, circuitStarted });
    expect(s([])).toBe('stopped');
    expect(s(['stopped', 'error'])).toBe('stopped');
    expect(s(['stopped', 'running'])).toBe('running');
    expect(s(['paused', 'running'])).toBe('running');
    expect(s(['paused', 'stopped'])).toBe('paused');
    expect(s([], true, true)).toBe('running');
    expect(s(['paused'], true, true)).toBe('running');
    expect(s([], false, true)).toBe('paused');
    expect(s(['error'], false, true)).toBe('paused');
  });

  it('labels: speeds, time, nearest speed', () => {
    expect(SPEEDS.map(speedLabel)).toEqual(['0.01x', '0.1x', '0.25x', '0.5x', '1x', '2x', '5x', '10x']);
    expect(formatSimTime(0.25)).toBe('0.250 s');
    expect(formatSimTime(-1)).toBe('0.000 s');
    expect(nearestSpeed(0.3)).toBe(0.25);
    expect(nearestSpeed(100)).toBe(10);
  });

  it('view: Start or Pause, the time, and the achieved speed only when behind', () => {
    const base = { time: 0.25, speed: 1, achieved: 1, timeRunning: true, hasReactiveParts: true, boardCount: 0 };
    const running = transportView({ ...base, state: 'running' });
    expect(running).toMatchObject({ icon: 'pause', time: '0.250 s', behind: null });
    expect(running.toggleTitle).toMatch(/^Pause/);
    expect(transportView({ ...base, state: 'paused' }).toggleTitle).toMatch(/^Continue/);
    expect(transportView({ ...base, state: 'stopped' })).toMatchObject({ icon: 'run' });
    expect(transportView({ ...base, state: 'running', speed: 10, achieved: 4.2 }).behind).toBe('4.2x');
    expect(transportView({ ...base, state: 'running', speed: 10, achieved: 9.5 }).behind).toBeNull();
    expect(transportView({ ...base, state: 'running', timeRunning: false }).timeTitle).toMatch(/stands still/);
    expect(transportView({ ...base, state: 'stopped', boardCount: 2 }).resetTitle).toMatch(/every board/);
  });
});
