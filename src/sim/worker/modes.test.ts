// The simulation in both modes: the engine in this thread, and the engine
// behind the Worker message boundary (inProcessWorkerLink: the real
// EngineHost with structured-clone messages, no timer). The behavioural tests
// run against both; the scenarios at the end must give identical numbers.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { EXAMPLES } from '../../examples';
import { Scene } from '../../model';
import { getPart, type PartState } from '../../parts';
import { decodeGth } from '../../project/gth';
import { Project } from '../../project/project';
import { fromFileMap } from '../../project/storage';
import { Simulation, buildNetlist, type NetlistBuilder } from '../../simulation';
import { defaultPlot, inspect, quantityValues } from '../inspect';
import type { ComponentModel, SimInput } from '../types';
import { inProcessWorkerLink } from './client';
import { CHUNK_SECONDS, EngineHost, FRAME_MS, type HostTimer } from './host';
import type { FromEngine, Snapshot } from './protocol';

type Mode = 'main' | 'worker';
const MODES: Mode[] = ['main', 'worker'];

function makeSim(scene: Scene, mode: Mode, netlist?: NetlistBuilder): Simulation {
  const sim = new Simulation(scene, netlist, mode === 'worker' ? { link: inProcessWorkerLink() } : {});
  sim.update();
  return sim;
}

/** The emulator that really runs a board (in the Worker's host in Worker mode). */
function emulatorOf(sim: Simulation, id: number) {
  const link = (sim as unknown as { link: ReturnType<typeof inProcessWorkerLink> | null }).link;
  return link ? link.host.emulator(id) : sim.boards.get(id)!.emulator;
}

const pin = (s: string) => ({ part: Number(s.split('.')[0]), pin: s.split('.')[1] });

/** Battery 5 V -> R -> C -> battery, grounded. Ids 1..4 (3 is the capacitor). */
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

function example(name: string): Scene {
  const scene = new Scene();
  scene.insert(EXAMPLES.find((e) => e.name === name)!.state);
  return scene;
}

const idOf = (scene: Scene, typeId: string): number => scene.parts.find((p) => p.typeId === typeId)!.id;

describe.each(MODES)('simulation, engine in %s', (mode) => {
  it('circuit clock: an RC charges, an edit keeps the charge, Reset goes back to the DC point', () => {
    const R = 100_000;
    const C = 1e-6;
    const charge = (t: number) => 5 * (1 - Math.exp(-t / (R * C)));
    const circuit = { input: rc(R, C) };
    const sim = makeSim(new Scene(), mode, () => ({ input: circuit.input, wireIds: [] }));
    expect(sim.mode).toBe(mode);
    expect(sim.hasReactiveParts).toBe(true);
    expect(sim.partResult(3)!.voltage).toBeCloseTo(5, 6); // the DC point before Start
    sim.advance(0.01);
    expect(sim.time).toBe(0);
    sim.start();
    expect(sim.transport()).toBe('running');
    expect(sim.timeRunning).toBe(true);
    sim.runTo(0.1);
    expect(sim.time).toBeCloseTo(0.1, 9);
    const v = sim.partResult(3)!.voltage;
    expect(Math.abs(v - charge(0.1)) / charge(0.1)).toBeLessThan(0.02);
    circuit.input = rc(R / 10, C);
    sim.update();
    expect(sim.partResult(3)!.voltage).toBeCloseTo(v, 4);
    sim.reset();
    expect(sim.transport()).toBe('stopped');
    expect(sim.time).toBe(0);
    expect(sim.timeRunning).toBe(false);
    expect(sim.partResult(3)!.voltage).toBeCloseTo(5, 6);
  });

  it('boards and transport: Start runs, Pause pauses, the board\'s own Run, Reset stops at 0', async () => {
    const scene = example('Uno blink');
    const uno = idOf(scene, 'uno');
    const sim = makeSim(scene, mode, (s) => {
      const { input, wireIds } = buildNetlist(s);
      input.components.push({ id: 9001, model: { kind: 'resistor', ohms: 1000 } }, { id: 9002, model: { kind: 'capacitor', farads: 1e-6 } });
      input.links.push([pin(`${uno}.5v`), pin('9001.a')], [pin('9001.b'), pin('9002.a')], [pin('9002.b'), pin(`${uno}.gnd`)]);
      return { input, wireIds };
    });
    sim.start();
    await vi.waitFor(() => expect(sim.boards.boardRunState(uno).state).toBe('running'));
    expect(sim.transport()).toBe('running');
    sim.advance(0.002);
    expect(sim.time).toBeCloseTo(0.002, 9);
    expect(sim.boards.boardRunState(uno).time).toBeCloseTo(0.002, 4);
    expect(sim.partResult(9002)!.voltage).toBeGreaterThan(0.5);
    sim.pause();
    expect(sim.boards.boardRunState(uno).state).toBe('paused');
    expect(sim.timeRunning).toBe(false);
    sim.advance(0.01);
    expect(sim.time).toBeCloseTo(0.002, 9);
    await sim.boards.runBoard(uno);
    expect(sim.transport()).toBe('running');
    sim.advance(0.003);
    expect(sim.time).toBeCloseTo(0.005, 9);
    sim.reset();
    await vi.waitFor(() => expect(sim.boards.boardRunState(uno).building).toBe(false));
    sim.update();
    expect(sim.boards.boardRunState(uno)).toMatchObject({ state: 'stopped', time: 0 });
    expect(sim.time).toBe(0);
    expect(sim.partResult(9002)!.voltage).toBeCloseTo(5, 3);
  });

  it('serial output reaches the store, Reset clears it, input reaches the running emulator', async () => {
    const scene = example('Uno blink');
    const id = idOf(scene, 'uno');
    const sim = makeSim(scene, mode);
    await sim.boards.runBoard(id);
    for (let i = 0; i < 50; i++) sim.advance(0.05);
    expect(sim.boards.serial.get(id, 'usart0')?.text).toBe('Blink: LED on pin 13\nLED on\nLED off\nLED on\n');
    expect(sim.boards.get(id)!.emulator!.serialBaud('usart0')).toBe(9615);
    // Input: queued in the emulator that runs the board, one byte on the line at a time.
    expect(sim.boards.sendSerial(id, 'usart0', [0x41, 0x42])).toBe(true);
    expect((emulatorOf(sim, id) as unknown as { serialRxPending: number }).serialRxPending).toBe(1);
    await sim.boards.resetBoard(id);
    sim.update();
    expect(sim.boards.serial.get(id, 'usart0')).toBeUndefined();
    await sim.boards.runBoard(id);
    sim.advance(0.1);
    expect(sim.boards.serial.get(id, 'usart0')?.text).toBe('Blink: LED on pin 13\nLED on\n');
    scene.remove(id);
    sim.update();
    expect(sim.boards.serial.boardIds()).toEqual([]);
  });

  it('a part beyond its rating burns in the scene and the circuit is solved again', () => {
    const p = new Project();
    const s = p.scene;
    const bat = s.add({ typeId: 'battery9v', col: 0, row: 0, rotation: 0 });
    const gnd = s.add({ typeId: 'ground', col: 0, row: 10, rotation: 0 });
    const r = s.add({ typeId: 'resistor', col: 20, row: 0, rotation: 0, state: { ...getPart('resistor')!.defaults, value: 47 } });
    s.addWire({ partId: bat.id, pinId: 'neg' }, { partId: gnd.id, pinId: 'gnd' });
    s.addWire({ partId: bat.id, pinId: 'pos' }, { partId: r.id, pinId: 'a' });
    s.addWire({ partId: bat.id, pinId: 'neg' }, { partId: r.id, pinId: 'b' });
    const sim = makeSim(s, mode);
    const part = s.find(r.id)!;
    expect(part.state?.burned).toBe(true);
    expect(part.state?.burnedBy).toMatch(/^too much power/);
    expect(sim.partResult(r.id)!.current).toBe(0);
    sim.update();
    expect(part.state?.burned).toBe(true);
    expect(sim.partResult(r.id)!.current).toBe(0);
  });

  it('Logic analyzer: an armed pin records the Blink edges at their CPU cycles', async () => {
    const scene = example('Uno blink');
    const id = idOf(scene, 'uno');
    const sim = makeSim(scene, mode);
    sim.recorder.arm(id, 'd13');
    await sim.boards.runBoard(id);
    sim.runTo(2.1);
    const trace = sim.recorder.trace(id, 'd13')!;
    const levels = Array.from({ length: trace.length }, (_, i) => trace.level(i));
    expect(levels.slice(-4)).toEqual([0, 1, 0, 1]);
    expect(trace.end).toBeCloseTo(2.1, 3);
    sim.recorder.disarm(id, 'd13');
    expect(sim.recorder.trace(id, 'd13')).toBeUndefined();
  });

  it('Scope: armed quantities are recorded while time runs and cleared by Reset', async () => {
    const scene = example('Half-bridge with IGBTs');
    const uno = idOf(scene, 'uno');
    const led = scene.find(idOf(scene, 'led'))!;
    const sim = makeSim(scene, mode);
    const ids = armScope(sim, led.id, led.typeId, led.state ?? {});
    sim.start();
    await vi.waitFor(() => expect(sim.boards.boardRunState(uno).state).toBe('running'));
    sim.runTo(0.05);
    const trace = sim.analog.trace(led.id, ids[0])!;
    expect(trace.length).toBeGreaterThan(2);
    expect(trace.time(trace.length - 1)).toBeCloseTo(0.05, 6);
    sim.reset();
    expect(sim.analog.trace(led.id, ids[0])).toBeUndefined();
  });
});

/** Arm the Scope for a part as the window does (its default graphed quantities); returns their ids. */
function armScope(sim: Simulation, partId: number, typeId: string, state: PartState): string[] {
  const type = getPart(typeId)!;
  const model = type.sim!(state);
  const info = { id: partId, pins: type.pins, led: typeId === 'led', type: typeId, burnedBy: state.burnedBy };
  const ids = defaultPlot(model);
  sim.analog.arm(partId, ids, (r) => quantityValues(inspect(model, r, info)));
  return ids;
}

/** Everything observable after a scripted run: results at fixed simulated times, serial, recorders. */
async function scenario(scene: Scene, mode: Mode, times: number[]) {
  const sim = makeSim(scene, mode);
  const boards = scene.parts.filter((p) => getPart(p.typeId)?.board).map((p) => p.id);
  for (const b of boards) sim.recorder.arm(b, 'd13');
  const probe = scene.parts.find((p) => p.typeId === 'led') ?? scene.parts.find((p) => getPart(p.typeId)?.sim && !getPart(p.typeId)?.board)!;
  const ids = armScope(sim, probe.id, probe.typeId, probe.state ?? {});
  sim.start();
  for (const b of boards) await vi.waitFor(() => expect(sim.boards.boardRunState(b).building).toBe(false));
  const samples = [];
  for (const [k, t] of times.entries()) {
    if (k === 2) {
      // Pause and continue, and type into the console, in the middle.
      sim.pause();
      for (const b of boards) sim.boards.sendSerial(b, 'usart0', [0x68, 0x69]);
      sim.start();
    }
    sim.runTo(t);
    samples.push({
      time: sim.time,
      result: structuredClone(sim.result),
      wires: scene.wires.map((w) => sim.wireCurrent(w.id)),
      maxVoltage: sim.maxVoltage,
      boards: boards.map((b) => sim.boards.boardRunState(b)),
    });
  }
  const traces = boards.map((b) => {
    const tr = sim.recorder.trace(b, 'd13');
    return tr ? Array.from({ length: tr.length }, (_, i) => [tr.cycle(i), tr.level(i)]) : null;
  });
  const analog = ids.map((id) => {
    const tr = sim.analog.trace(probe.id, id);
    return tr ? Array.from({ length: tr.length }, (_, i) => [tr.time(i), tr.value(i)]) : null;
  });
  const serial = boards.map((b) => sim.boards.serial.get(b, 'usart0')?.text ?? '');
  const burned = scene.parts.filter((p) => p.state?.burned).map((p) => [p.id, p.state?.burnedBy]);
  return { samples, traces, analog, serial, burned };
}

describe('the same results in both modes', () => {
  it('half-bridge example (Uno, gate driver, IGBTs, bootstrap capacitor)', async () => {
    const times = [0.005, 0.02, 0.05, 0.3, 1.05, 1.2];
    const main = await scenario(example('Half-bridge with IGBTs'), 'main', times);
    const worker = await scenario(example('Half-bridge with IGBTs'), 'worker', times);
    expect(main.samples.at(-1)!.time).toBeCloseTo(1.2, 9);
    expect(main.traces[0]!.length).toBeGreaterThan(2);
    expect(main.analog.every((a) => a !== null && a.length > 10)).toBe(true);
    expect(main.serial[0]).toContain('LED on');
    expect(worker).toEqual(main);
  });

  it('inverter fixture', async () => {
    const load = () => {
      const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../fixtures/inverter.gth', import.meta.url))));
      const project = new Project();
      project.load(fromFileMap(decodeGth(bytes).fileMap));
      return project.scene;
    };
    const times = [0.004, 0.01, 0.03, 0.06];
    const main = await scenario(load(), 'main', times);
    const worker = await scenario(load(), 'worker', times);
    expect(main.samples.at(-1)!.result?.converged).toBe(true);
    expect(worker).toEqual(main);
  });
});

describe('the Worker clock (EngineHost)', () => {
  function fakeHost(step = 0) {
    let now = 0;
    const pending: { fn: () => void; ms: number }[] = [];
    const timer: HostTimer = {
      now: () => (now += step),
      schedule: (fn, ms) => void pending.push({ fn, ms }),
    };
    const frames: Snapshot[] = [];
    const host = new EngineHost((msg: FromEngine) => {
      if (msg.type === 'frame') frames.push(msg.snapshot);
    }, timer);
    host.handle({
      type: 'circuit', seq: 1, burnAck: 0, boards: [],
      circuit: { input: rc(100_000, 1e-6), wireIds: [], parts: [], boardsVersion: 0 },
    });
    return { host, pending, frames, wall: (ms: number) => (now += ms), last: () => frames[frames.length - 1] };
  }

  it('idle without a timer; runs wall time x speed per tick; one last frame with speed 0 after a pause', () => {
    const { host, pending, wall, last } = fakeHost();
    expect(pending).toHaveLength(0); // time does not run: no timer
    expect(last().instant).not.toBeNull();
    host.handle({ type: 'run', clock: true, boards: [] });
    expect(pending.map((p) => p.ms)).toEqual([FRAME_MS]);
    wall(16);
    pending.shift()!.fn();
    expect(last().time).toBeCloseTo(0.016, 9);
    expect(last().speed).toBeCloseTo(1, 9);
    expect(last().instant).toBeNull(); // only while time stands still
    expect(pending).toHaveLength(1);
    host.handle({ type: 'speed', multiplier: 2 });
    expect(pending).toHaveLength(1); // still one tick scheduled
    wall(16);
    pending.shift()!.fn();
    expect(last().time).toBeCloseTo(0.048, 9);
    host.handle({ type: 'run', clock: false, boards: [] });
    wall(16);
    pending.shift()!.fn();
    expect(last().speed).toBe(0);
    expect(last().time).toBeCloseTo(0.048, 9);
    expect(pending).toHaveLength(0);
  });

  it('behind (the budget ran out): the next tick at once, the measured speed drops', () => {
    const { host, pending, wall, last } = fakeHost(5); // every clock reading moves 5 ms on
    host.handle({ type: 'speed', multiplier: 10 });
    host.handle({ type: 'run', clock: true, boards: [] });
    wall(100);
    pending.shift()!.fn();
    expect(pending.map((p) => p.ms)).toEqual([0]);
    expect(last().time).toBeLessThan(10 * 0.1);
    expect(last().time).toBeGreaterThan(CHUNK_SECONDS);
    expect(last().speed).toBeLessThan(10);
  });
});
