import { describe, expect, it } from 'vitest';
import type { ComponentModel, SimInput } from '../sim';
import { UNO_ELECTRICAL, UNO_IO } from './avr/uno';
import type { BoardEmulator, BoardInputs, SliceResult } from './board';
import { MixedSignal, SLICE_SECONDS, meanDrive, type BoardSlot } from './mixedsignal';
import { MAX_STEPS_PER_SLICE, MIN_STEP_SECONDS, isReactive, smallestTimeConstant, stepSeconds } from './timestep';

const pin = (s: string) => ({ part: Number(s.split('.')[0]), pin: s.split('.')[1] });

const RES = 2;
const CAP = 3;

/** Battery -> R -> C -> battery, grounded at the battery's minus. */
function rc(volts: number, ohms: number, farads: number): SimInput {
  const models: ComponentModel[] = [
    { kind: 'battery', volts, rInternal: 0 },
    { kind: 'resistor', ohms },
    { kind: 'capacitor', farads },
    { kind: 'ground' },
  ];
  return {
    components: models.map((model, i) => ({ id: i + 1, model })),
    links: [[pin('1.pos'), pin('2.a')], [pin('2.b'), pin('3.a')], [pin('3.b'), pin('1.neg')], [pin('1.neg'), pin('4.gnd')]],
  };
}

const capVolts = (ms: MixedSignal): number => ms.result!.parts[CAP].voltage;

describe('time-step rule', () => {
  it('a fiftieth of the smallest R*C, clamped to 1 us .. one slice', () => {
    expect(isReactive(rc(5, 1000, 1e-6))).toBe(true);
    expect(isReactive({ components: [{ id: 1, model: { kind: 'resistor', ohms: 1 } }], links: [] })).toBe(false);
    expect(smallestTimeConstant(rc(5, 1000, 1e-6))).toBeCloseTo(1e-3, 12);
    expect(stepSeconds(rc(5, 1000, 1e-6), [], SLICE_SECONDS)).toBeCloseTo(20e-6, 12);
    expect(stepSeconds(rc(5, 1e6, 1e-3), [], SLICE_SECONDS)).toBe(SLICE_SECONDS);
    expect(stepSeconds(rc(5, 1, 1e-9), [], SLICE_SECONDS)).toBe(MIN_STEP_SECONDS);
    expect(stepSeconds({ components: [], links: [] }, [], SLICE_SECONDS)).toBe(SLICE_SECONDS);
  });

  it('inductors use L / R_hi', () => {
    const input: SimInput = {
      components: [
        { id: 1, model: { kind: 'inductor', henries: 1 } },
        { id: 2, model: { kind: 'resistor', ohms: 100 } },
        { id: 3, model: { kind: 'resistor', ohms: 1000 } },
      ],
      links: [],
    };
    expect(smallestTimeConstant(input)).toBeCloseTo(1e-3, 12);
  });

  it('Norton mean of pin setups: half H, half L behind the same resistance is vcc/2 behind it', () => {
    const d = meanDrive([{ drive: { volts: 5, ohms: 25 }, weight: 1 }, { drive: { volts: 0, ohms: 25 }, weight: 1 }]);
    expect(d.volts).toBeCloseTo(2.5, 12);
    expect(d.ohms).toBeCloseTo(25, 12);
  });
});

describe('mixed-signal bridge with capacitors (time steps)', () => {
  const V = 5;
  const R = 1000;
  const C = 1e-6;
  const tau = R * C;

  it('shows the DC operating point before the first step', () => {
    const ms = new MixedSignal();
    ms.setCircuit(rc(V, R, C), []);
    expect(ms.reactive).toBe(true);
    expect(ms.transient).toBeNull();
    expect(capVolts(ms)).toBeCloseTo(V, 6);
  });

  it('charges from empty along V(1 - e^(-t/RC)) within 2%', () => {
    const ms = new MixedSignal();
    ms.setCircuit(rc(V, R, C), []);
    for (const ms_ of [1, 2, 3, 5]) {
      ms.advance(SLICE_SECONDS * (ms_ - Math.round(ms.time / SLICE_SECONDS)));
      const t = ms.time;
      expect(t).toBeCloseTo(ms_ * 1e-3, 9);
      const want = V * (1 - Math.exp(-t / tau));
      expect(Math.abs(capVolts(ms) - want) / want).toBeLessThan(0.02);
    }
    expect(ms.lastSlice).toEqual({ steps: 50, averaged: false });
  });

  it('is deterministic: the same steps give identical numbers, however time is asked for', () => {
    const a = new MixedSignal();
    const b = new MixedSignal();
    a.setCircuit(rc(V, R, C), []);
    b.setCircuit(rc(V, R, C), []);
    a.advance(0.004);
    for (let i = 0; i < 40; i++) b.advance(0.0001);
    expect(b.time).toBeCloseTo(a.time, 12);
    expect(b.result).toEqual(a.result);
    expect(b.transient).toEqual(a.transient);
  });

  it('an edit keeps the charge of the parts that still exist; a new capacitor starts empty', () => {
    const ms = new MixedSignal();
    ms.setCircuit(rc(V, R, C), []);
    ms.advance(0.001);
    const charged = capVolts(ms);
    expect(charged).toBeGreaterThan(2.5);
    expect(charged).toBeLessThan(4);
    // Larger resistor, plus a second capacitor (id 9) across the first.
    const edited = rc(V, 10 * R, C);
    edited.components.push({ id: 9, model: { kind: 'capacitor', farads: 1e-9 } });
    edited.links.push([pin('9.a'), pin('3.a')], [pin('9.b'), pin('3.b')]);
    ms.setCircuit(edited, []);
    expect(ms.transient!.stored[CAP].volts).toBeCloseTo(charged, 9);
    expect(ms.transient!.stored[9]).toBeUndefined();
    // Shown with the charge held (not the DC point of 5 V); the empty 1 nF part takes its share.
    const shared = (charged * C) / (C + 1e-9);
    expect(capVolts(ms)).toBeCloseTo(shared, 6);
    ms.advance(0.001);
    const want = V - (V - shared) * Math.exp(-0.001 / (10 * R * (C + 1e-9)));
    expect(Math.abs(capVolts(ms) - want) / want).toBeLessThan(0.02);
    // Removing the capacitors entirely drops the stepping.
    ms.setCircuit({ components: edited.components.filter((c) => c.model.kind !== 'capacitor'), links: edited.links }, []);
    expect(ms.reactive).toBe(false);
    expect(ms.transient).toBeNull();
  });

  it('reset() goes back to time 0 and the DC point; the next step starts empty again', () => {
    const ms = new MixedSignal();
    ms.setCircuit(rc(V, R, C), []);
    ms.advance(0.003);
    ms.reset();
    expect(ms.time).toBe(0);
    expect(ms.transient).toBeNull();
    expect(capVolts(ms)).toBeCloseTo(V, 6);
    ms.advance(0.001);
    const want = V * (1 - Math.exp(-0.001 / tau));
    expect(Math.abs(capVolts(ms) - want) / want).toBeLessThan(0.02);
  });

  it('a circuit without capacitors keeps the DC path (no time steps)', () => {
    let steps = 0;
    const ms = new MixedSignal(undefined, () => {
      steps++;
      throw new Error('no time steps expected');
    });
    ms.setCircuit({ components: rc(V, R, C).components.filter((c) => c.id !== CAP), links: rc(V, R, C).links }, []);
    ms.advance(0.005);
    expect(steps).toBe(0);
    expect(ms.reactive).toBe(false);
  });
});

// ---- a board driving an RC low-pass ----------------------------------------------

const UNO = 1;

/** A board whose pins follow a script: `pattern(cycle)` gives the drive codes. */
class ScriptedBoard implements BoardEmulator {
  readonly clockHz = 1_000_000;
  readonly io = UNO_IO;
  readonly electrical = UNO_ELECTRICAL;
  cycles = 0;
  inputs: BoardInputs | null = null;
  constructor(private readonly pattern: (cycle: number) => string) {}
  drives(): string {
    return this.pattern(this.cycles);
  }
  run(cycles: number): SliceResult {
    const start = this.cycles;
    const result: SliceResult = { start, end: start + cycles, drives: this.drives(), events: [], serial: {} };
    let last = result.drives;
    for (let c = start + 1; c <= start + cycles; c++) {
      this.cycles = c;
      const now = this.drives();
      if (now !== last) result.events.push({ cycle: c, drives: (last = now) });
    }
    return result;
  }
  setInputs(inputs: BoardInputs): void {
    this.inputs = inputs;
  }
  serialBaud(): number | null {
    return null;
  }
  sendSerial(): void {}
}

const D9 = UNO_IO.findIndex((p) => p.id === 'd9');
const withPin = (code: string): string => 'Z'.repeat(D9) + code + 'Z'.repeat(UNO_IO.length - D9 - 1);

/** Uno d9 -> R -> C -> Uno gnd. */
function lowPass(ohms: number, farads: number): SimInput {
  return {
    components: [
      { id: UNO, model: { kind: 'board', rails: { ...UNO_ELECTRICAL.rails }, io: {} } },
      { id: RES, model: { kind: 'resistor', ohms } },
      { id: CAP, model: { kind: 'capacitor', farads } },
    ],
    links: [[pin('1.d9'), pin('2.a')], [pin('2.b'), pin('3.a')], [pin('3.b'), pin('1.gnd')]],
  };
}

function slot(emulator: BoardEmulator): BoardSlot {
  return { partId: UNO, io: UNO_IO, electrical: UNO_ELECTRICAL, emulator, running: true };
}

describe('a board pin driving an RC low-pass', () => {
  it('a pin set high at 2 ms gives an RC ramp from that moment', () => {
    const board = new ScriptedBoard((c) => withPin(c >= 2000 ? 'H' : 'L'));
    const ms = new MixedSignal();
    const R = 1000;
    const C = 1e-6;
    ms.setCircuit(lowPass(R, C), [slot(board)]);
    const tau = (R + UNO_ELECTRICAL.outputOhms) * C;
    let last = -1;
    for (let k = 1; k <= 8; k++) {
      ms.advance(SLICE_SECONDS);
      const v = ms.instant!.parts[CAP].voltage;
      const t = ms.time - 0.002;
      const want = t <= 0 ? 0 : UNO_ELECTRICAL.vcc * (1 - Math.exp(-t / tau));
      if (t <= 0) expect(Math.abs(v)).toBeLessThan(1e-6);
      else {
        expect(Math.abs(v - want) / want).toBeLessThan(0.02);
        expect(v).toBeGreaterThan(last);
      }
      last = v;
    }
    // The board reads its own pin's voltage back (high level).
    expect(board.inputs!.digital[D9]).toBe(true);
  });

  it('an edge inside a slice acts at its own time (not at the slice end)', () => {
    const board = new ScriptedBoard((c) => withPin(c >= 500 ? 'H' : 'L')); // high from 0.5 ms
    const ms = new MixedSignal();
    ms.setCircuit(lowPass(1000, 1e-6), [slot(board)]);
    ms.advance(SLICE_SECONDS);
    const tau = 1025e-6;
    const want = 5 * (1 - Math.exp(-0.0005 / tau));
    expect(Math.abs(ms.instant!.parts[CAP].voltage - want) / want).toBeLessThan(0.02);
  });

  it('fast PWM beyond the step cap is averaged: the capacitor ramps towards the mean, deterministically', () => {
    const pwm = (c: number): string => withPin(c % 4 < 2 ? 'H' : 'L'); // 250 kHz, 50%
    const run = (): MixedSignal => {
      const ms = new MixedSignal();
      ms.setCircuit(lowPass(1000, 10e-6), [slot(new ScriptedBoard(pwm))]);
      ms.advance(0.05);
      return ms;
    };
    const ms = run();
    expect(ms.lastSlice.averaged).toBe(true);
    expect(ms.lastSlice.steps).toBeLessThanOrEqual(MAX_STEPS_PER_SLICE);
    const tau = 1025 * 10e-6;
    const want = 2.5 * (1 - Math.exp(-0.05 / tau));
    expect(Math.abs(ms.transient!.stored[CAP].volts - want) / want).toBeLessThan(0.03);
    expect(run().transient).toEqual(ms.transient);
  });
});
