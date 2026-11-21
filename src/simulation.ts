// Glue between the editor and the simulation: turns the scene into a
// netlist, hands it to the simulation engine when it changed, and keeps the
// latest values for drawing and readouts. The engine (src/sim/worker/
// engine.ts: the mixed-signal bridge with the boards and the simulated clock,
// every solve, burned parts) runs in a Web Worker by default and in this
// thread for unit tests, `?sim=main`, or when no Worker can start (see
// src/sim/worker/client.ts and host.ts for the messages and what runs where).
// Either way it is the same engine with the same results; this class is the
// facade the UI uses in both modes:
// - in-process: it calls the engine directly; a BoardClock on animation
//   frames moves time (clock()).
// - Worker: it sends commands (circuit, run flags, reset, speed, serial
//   input, armed channels) and reads the newest snapshot the Worker posted;
//   the Worker runs its own clock and posts ~60 frames a second while time
//   runs; each frame redraws (clock()'s onTick). Until the first snapshot of
//   a changed circuit arrives (the engine solves it at once and answers) the
//   previous values stay shown, so nothing flickers.
//
// What stays on this thread in both modes: the scene, buildNetlist, the board
// run states (BoardRuntimes: builds through the compiler Worker, Run / Pause /
// Reset, build log, serial store), the global transport state, and the
// recorders the Scope and Logic analyzer windows read (fed by the engine).
// A part the engine burns is written into the scene here (part.state.burned
// and burnedBy, exactly as before), and acknowledged with the next circuit.
//
// The global transport (Start / Pause / Reset, see transportmodel.ts) lives
// here too, as UI-only state (not saved, not undoable): the circuit clock
// (`circuitRunning`) lets time advance without any running board, and the
// buttons drive every board through the same calls as its own buttons.

import { BoardClock, type SimClock } from './boardclock';
import type { BuildInput } from './build/compiler';
import { endTerminal, findContacts } from './contacts';
import type { Scene, WireEnd } from './model';
import type { IdleSkipMode, SerialBytes } from './mcu/board';
import { BoardRuntimes, type BoardPartInfo, type BoardRuntime } from './mcu/runtime';
import { getPart } from './parts';
import { boardClockHz } from './mcu/clock';
import { AnalogRecorder } from './scope/analog';
import { SignalRecorder } from './scope/recorder';
import { terminalKey, type PartResult, type SimInput, type SimResult } from './sim';
import { RemoteEmulator, type EngineLink } from './sim/worker/client';
import { CHUNK_SECONDS } from './sim/worker/host';
import { MAX_PASSES, SimEngine, type Burn, type EngineCircuit, type EngineOutput, type EnginePart } from './sim/worker/engine';
import type { BoardMsg, FromEngine, Snapshot, ToEngine } from './sim/worker/protocol';
import { transportState, type TransportState } from './transportmodel';

/** What the view needs from the simulation. */
export interface SimView {
  /** Bring the result up to date with the scene. Cheap when nothing changed. */
  update(): void;
  partResult(partId: number): PartResult | undefined;
  /** Volts at a pin or junction, or undefined before the first solve. */
  pinVoltage(end: WireEnd): number | undefined;
  /** Amps flowing along the wire from its `from` end to its `to` end (0 when unknown). */
  wireCurrent(wireId: number): number;
  /** Largest voltage magnitude in the circuit. */
  readonly maxVoltage: number;
  /** Simulated time is moving (a board runs, or the circuit clock with capacitors or inductors): the picture changes every frame. */
  readonly timeRunning: boolean;
}

/** Makes the netlist of a scene (replaceable in tests to feed raw circuits). */
export type NetlistBuilder = (scene: Scene) => { input: SimInput; wireIds: number[] };

/**
 * The scene's electrical content: parts, wires (links[i] is wireIds[i]),
 * junctions as `node` components, the parts' internal links, and the
 * contacts of touching pins and pins lying on wires (derived from positions).
 */
export function buildNetlist(scene: Scene): { input: SimInput; wireIds: number[] } {
  const input: SimInput = { components: [], links: [] };
  const wireIds: number[] = [];
  for (const wire of scene.wires) {
    input.links.push([endTerminal(wire.from), endTerminal(wire.to)]);
    wireIds.push(wire.id);
  }
  for (const part of scene.parts) {
    const type = getPart(part.typeId);
    if (!type?.sim) continue;
    input.components.push({ id: part.id, model: type.sim(part.state ?? {}) });
    for (const [a, b] of type.links ?? []) {
      input.links.push([{ part: part.id, pin: a }, { part: part.id, pin: b }]);
    }
  }
  for (const j of scene.junctions) input.components.push({ id: j.id, model: { kind: 'node' } });
  input.links.push(...findContacts(scene).links);
  return { input, wireIds };
}

/** The board parts of a scene, for BoardRuntimes.sync. */
export function boardParts(scene: Scene): BoardPartInfo[] {
  const out: BoardPartInfo[] = [];
  for (const part of scene.parts) {
    const spec = getPart(part.typeId)?.board;
    if (spec) out.push({ id: part.id, spec });
  }
  return out;
}

/** What a board is built from: its type and a copy of its files as they are now (null when it is not a board). */
export function buildInput(scene: Scene, partId: number): BuildInput | null {
  const part = scene.find(partId);
  if (!part?.boardId || !Object.hasOwn(scene.files, part.boardId)) return null;
  return { boardTypeId: part.typeId, files: { ...scene.files[part.boardId].files }, clockHz: boardClockHz(part) };
}

/** The parts as the engine needs them (type ids and states, scene order). */
function engineParts(scene: Scene): EnginePart[] {
  return scene.parts.map((p) => ({ id: p.id, typeId: p.typeId, state: p.state ?? {} }));
}

export interface SimulationOptions {
  /** Run the engine behind this link (a Worker, see openSimWorker); null or absent: in this thread. */
  link?: EngineLink | null;
}

export class Simulation implements SimView {
  readonly boards = new BoardRuntimes((partId) => buildInput(this.scene, partId));
  /** Pin edges of the channels the Logic analyzer window armed (fed by the engine, read-only towards it). */
  readonly recorder = new SignalRecorder();
  /** Values of the part the Scope window follows (fed by the engine per solved instant; cleared by reset()). */
  readonly analog = new AnalogRecorder();
  /** In-process engine; null while the engine runs in a Worker. */
  private engine: SimEngine | null = null;
  private link: EngineLink | null = null;
  /** Worker mode: the newest snapshot. */
  private snap: Snapshot | null = null;
  /** Worker mode: wire ids of the circuits sent, by circuit seq (until a snapshot of a newer one arrived). */
  private readonly wireIdsBySeq = new Map<number, number[]>();
  private wireIndex: { seq: number; index: Map<number, number> } | null = null;
  private seq = 0;
  /** Boards version of the last circuit sent to the Worker. */
  private sentVersion = -1;
  private runKey = '';
  private readonly sentKeys = new Map<number, number>();
  /** Reset epoch: Scope samples of an older one are dropped (Worker mode). */
  private epoch = 0;
  private idleSkip: IdleSkipMode | null = null;
  private onFrame: (() => void) | null = null;
  private signature = '';
  /** Highest burn sequence number written into the scene. */
  private burnAck = 0;
  /** The circuit clock runs (Start): time advances even when no board runs. UI-only state. */
  private clockRunning = false;
  /** Start was pressed since the last Reset (so a stopped clock reads as paused). */
  private clockStarted = false;

  constructor(
    private readonly scene: Scene,
    private readonly netlist: NetlistBuilder = buildNetlist,
    options: SimulationOptions = {},
  ) {
    if (options.link) this.useWorker(options.link);
    else this.useLocal();
  }

  /** Where the engine runs. */
  get mode(): 'main' | 'worker' {
    return this.link ? 'worker' : 'main';
  }

  private useLocal(): void {
    this.engine = new SimEngine({ observer: this.recorder, stepObserver: this.analog });
    this.engine.clockRunning = this.clockRunning;
    this.boards.createEmulator = (spec, flash, _partId, clockHz) => {
      const emu = spec.create(flash, { clockHz });
      if (this.idleSkip) emu.setIdleSkip?.(this.idleSkip);
      return emu;
    };
  }

  private useWorker(link: EngineLink): void {
    this.link = link;
    link.onmessage = (msg) => this.receive(msg);
    link.onfail = (why) => this.fallBack(why);
    this.boards.createEmulator = (spec, flash, partId, clockHz) =>
      new RemoteEmulator(spec, flash, (key, port, bytes) => this.sendSerialRemote(partId, key, port, bytes), clockHz);
    this.recorder.onArm = this.analog.onArm = () => this.sendArmed();
    // A board's Run / Pause reaches the Worker without waiting for the next
    // frame's update(); a new program goes with the circuit there (update()).
    let queued = false;
    this.boards.onChange(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (this.link && this.boards.version === this.sentVersion) this.syncRun();
      });
    });
  }

  /** The Worker failed: simulate in this thread from now on (boards restart from their program start). */
  private fallBack(why: string): void {
    const link = this.link;
    if (!link) return;
    console.warn(`The simulation Worker failed (${why}); simulating on the main thread.`);
    link.onmessage = null;
    link.onfail = null;
    link.terminate();
    this.link = null;
    this.snap = null;
    this.recorder.onArm = this.analog.onArm = null;
    this.useLocal();
    for (const rt of this.boards.runtimes()) {
      if (rt.emulator instanceof RemoteEmulator) rt.emulator = this.boards.createEmulator(rt.spec, rt.emulator.flash, rt.partId, rt.emulator.chosenClockHz);
    }
    this.boards.version++;
    this.signature = '';
    this.update();
    this.onFrame?.();
  }

  /**
   * The clock that moves simulated time, and the redraw hook: in-process a
   * BoardClock on animation frames (calls `onTick` after every frame that
   * ran); with the Worker, the Worker's clock (the multiplier is sent there,
   * the measured speed comes back) and `onTick` after every frame it posted.
   */
  clock(onTick: () => void): SimClock {
    this.onFrame = onTick;
    const local = new BoardClock(this, onTick);
    const sim = this;
    return {
      get multiplier() {
        return local.multiplier;
      },
      set multiplier(value: number) {
        local.multiplier = value;
        sim.post({ type: 'speed', multiplier: value });
      },
      get speed() {
        return sim.engine ? local.speed : sim.boards.speed;
      },
      wake: () => {
        if (this.engine) local.wake();
      },
    };
  }

  get result(): SimResult | null {
    return this.engine ? this.engine.result : (this.snap?.result ?? null);
  }

  /** The solution for the pins as they are now (in Worker mode only while time stands still; the Scope samples it then). */
  get instant(): SimResult | null {
    return this.engine ? this.engine.bridge.instant : (this.snap?.instant ?? null);
  }

  /** Simulated seconds on the global timeline (advances while a board or the circuit clock runs). */
  get time(): number {
    return this.engine ? this.engine.time : (this.snap?.time ?? 0);
  }

  /** Largest voltage magnitude in the circuit. */
  get maxVoltage(): number {
    return this.engine ? this.engine.maxVoltage : (this.snap?.maxVoltage ?? 0);
  }

  /** How long the last solve of a changed circuit took, for the status line only. */
  get solveMs(): number {
    return this.engine ? this.engine.solveMs : (this.snap?.solveMs ?? 0);
  }

  update(): void {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const slots = this.boards.sync(boardParts(this.scene));
      const { input, wireIds } = this.netlist(this.scene);
      const signature = `${this.boards.version}|${JSON.stringify(input)}`;
      if (signature === this.signature) break;
      this.signature = signature;
      const circuit: EngineCircuit = { input, wireIds, parts: engineParts(this.scene), boardsVersion: this.boards.version };
      // A part burned (in-process: at once): the scene changed, so the netlist is built again;
      // the engine already solved the burned circuit and does not solve the same one twice.
      if (!(this.engine ? this.take(this.engine.setCircuit(circuit, slots, this.burnAck)) : this.sendCircuit(circuit, slots))) break;
    }
    this.syncRun();
  }

  /**
   * Run the boards for `seconds` of simulated time (whole 1 ms slices; the
   * rest carries over). Serial output goes to the board runtimes. With the
   * Worker it is a deterministic step done there (tests); the Worker's own
   * clock moves time otherwise.
   */
  advance(seconds: number): void {
    this.update();
    if (!this.timeRunning) return;
    if (this.engine) {
      if (this.take(this.engine.advance(seconds))) this.update();
    } else this.post({ type: 'advance', seconds });
  }

  /**
   * Run until simulated time `until`, in steps of `chunk` (deterministic: the
   * same steps in both modes, whatever the wall clock does). For tests and
   * benchmarks; stops early when time stops running.
   */
  runTo(until: number, chunk = CHUNK_SECONDS): void {
    this.update();
    if (!this.timeRunning) return;
    if (this.engine) {
      if (this.take(this.engine.runTo(until, chunk))) this.update();
    } else this.post({ type: 'runTo', until, chunk });
  }

  partResult(partId: number): PartResult | undefined {
    return this.result?.parts[partId];
  }

  /** The circuit has capacitors or inductors (it changes over simulated time). */
  get hasReactiveParts(): boolean {
    return this.engine ? this.engine.bridge.reactive : (this.snap?.reactive ?? false);
  }

  /** Board parts in the circuit. */
  get boardCount(): number {
    return boardParts(this.scene).length;
  }

  /** The circuit clock was started (Start) and not paused since. */
  get circuitRunning(): boolean {
    return this.clockRunning;
  }

  /** Simulated time moves: a board runs, or the circuit clock runs on a circuit with capacitors or inductors. */
  get timeRunning(): boolean {
    return this.boards.anyRunning || (this.clockRunning && this.hasReactiveParts);
  }

  /** The global transport state, derived from the boards and the circuit clock. */
  transport(): TransportState {
    const ids = boardParts(this.scene).map((p) => p.id);
    return transportState({
      boards: ids.map((id) => this.boards.boardRunState(id).state),
      circuitRunning: this.clockRunning,
      circuitStarted: this.clockStarted,
    });
  }

  /**
   * Start: every board that can run runs (a paused one continues, a fresh one
   * builds first, exactly like its own Run button; boards in the error state
   * or still building are left as they are), and the circuit clock starts.
   */
  start(): void {
    this.update();
    this.clockRunning = true;
    this.clockStarted = true;
    for (const { id } of boardParts(this.scene)) {
      const s = this.boards.boardRunState(id);
      if (s.state === 'error' || s.building || s.state === 'running') continue;
      void this.boards.runBoard(id);
    }
    this.syncRun();
  }

  /** Pause: every running board pauses and the circuit clock stops (everything is kept). */
  pause(): void {
    this.clockRunning = false;
    for (const { id } of boardParts(this.scene)) this.boards.pauseBoard(id);
    this.syncRun();
  }

  /**
   * Reset: every board resets (rebuilds from its files, stopped, like its own
   * Reset button), the circuit clock stops, time goes back to 0 and the
   * capacitors and inductors lose their charge (the DC operating point is
   * shown until the next Start, which starts them empty).
   */
  reset(): void {
    this.clockRunning = false;
    this.clockStarted = false;
    for (const { id } of boardParts(this.scene)) void this.boards.resetBoard(id);
    this.update();
    if (this.engine) {
      const out = this.engine.reset();
      this.analog.clear();
      if (this.take(out)) this.update();
    } else {
      this.epoch++;
      this.analog.clear();
      this.post({ type: 'reset', epoch: this.epoch });
    }
  }

  /** Idle skipping of the boards that have it (see BoardEmulator.setIdleSkip): host speed only, never results. */
  setIdleSkip(mode: IdleSkipMode): void {
    this.idleSkip = mode;
    if (this.engine) for (const rt of this.boards.runtimes()) rt.emulator?.setIdleSkip?.(mode);
    else this.post({ type: 'idleSkip', mode });
  }

  pinVoltage(end: WireEnd): number | undefined {
    const r = this.result;
    if (!r || !r.converged) return undefined;
    const net = r.nets[terminalKey(endTerminal(end))];
    return net === undefined ? undefined : r.voltages[net];
  }

  wireCurrent(wireId: number): number {
    if (this.engine) return this.engine.wireCurrent(wireId);
    const snap = this.snap;
    if (!snap) return 0;
    if (this.wireIndex?.seq !== snap.circuit) {
      const ids = this.wireIdsBySeq.get(snap.circuit) ?? [];
      this.wireIndex = { seq: snap.circuit, index: new Map(ids.map((id, i) => [id, i])) };
    }
    const i = this.wireIndex.index.get(wireId);
    return i === undefined ? 0 : (snap.wireAmps[i] ?? 0);
  }

  /** One line for the status bar. */
  status(): string {
    const r = this.result;
    if (!r || r.reference === 'empty') return 'Drag parts onto the grid, then drag from pin to pin to wire them';
    if (!r.converged) return 'Simulation failed: the solver found no stable operating point';
    const clock = this.time > 0 || this.timeRunning ? `simulated ${this.time.toFixed(3)} s · ` : '';
    const nets = `${clock}${r.connectedNets} ${r.connectedNets === 1 ? 'net' : 'nets'}`;
    const time = `solved in ${this.solveMs < 0.05 ? '<0.1' : this.solveMs.toFixed(1)} ms`;
    if (r.reference === 'battery') return `No ground part: using battery − as reference · ${nets}, ${time}`;
    if (r.reference === 'floating') return `No ground or battery: using the first net as reference · ${nets}, ${time}`;
    return `Simulating: ${nets}, ${time}`;
  }

  // ---- Engine output ----

  /** Serial bytes into the board runtimes and burns into the scene. True when a part burned. */
  private take(out: EngineOutput): boolean {
    for (const [id, bytes] of out.serial) this.boards.addSerial(id, bytes);
    return this.applyBurns(out.burns);
  }

  /** Write burned parts into the scene (as a plain state change, like before). True when any. */
  private applyBurns(burns: readonly Burn[]): boolean {
    for (const b of burns) {
      const part = this.scene.find(b.partId);
      if (part && !part.state?.burned) part.state = { ...part.state, burned: true, burnedBy: b.reason };
      this.burnAck = Math.max(this.burnAck, b.seq);
    }
    return burns.length > 0;
  }

  // ---- Worker mode ----

  private post(msg: ToEngine): void {
    this.link?.post(msg);
  }

  /** Send a changed circuit with its boards (programs the Worker does not have yet included). Always false: burns come back in a frame. */
  private sendCircuit(circuit: EngineCircuit, slots: readonly BoardRuntime[]): boolean {
    const boards: BoardMsg[] = slots.map((rt) => {
      const emu = rt.emulator instanceof RemoteEmulator ? rt.emulator : null;
      const msg: BoardMsg = { partId: rt.partId, typeId: this.scene.find(rt.partId)?.typeId ?? '', key: emu?.key ?? 0, running: rt.running };
      if (emu?.chosenClockHz !== undefined) msg.clockHz = emu.chosenClockHz;
      if (emu && this.sentKeys.get(rt.partId) !== emu.key) {
        msg.flash = emu.flash;
        this.sentKeys.set(rt.partId, emu.key);
      }
      return msg;
    });
    const seq = ++this.seq;
    this.sentVersion = circuit.boardsVersion;
    this.wireIdsBySeq.set(seq, circuit.wireIds);
    // A new program is a new timeline for the Logic analyzer (in-process the bridge tells it).
    this.recorder.boards(slots);
    this.post({ type: 'circuit', seq, circuit, boards, burnAck: this.burnAck });
    this.runKey = '';
    return false;
  }

  /** Send the run flags (circuit clock, each board's Run / Pause) when one changed; in-process the engine shares them. */
  private syncRun(): void {
    if (this.engine) {
      this.engine.clockRunning = this.clockRunning;
      return;
    }
    const boards = boardParts(this.scene).map(({ id }) => ({ partId: id, running: this.boards.get(id)?.running ?? false }));
    const key = `${this.clockRunning}|${boards.map((b) => `${b.partId}:${b.running ? 1 : 0}`).join(',')}`;
    if (key === this.runKey) return;
    this.runKey = key;
    this.post({ type: 'run', clock: this.clockRunning, boards });
  }

  private sendSerialRemote(partId: number, key: number, port: string, bytes: readonly number[]): void {
    this.update(); // the Worker has the program and knows the board was started
    this.post({ type: 'serial', partId, key, port, bytes: [...bytes] });
  }

  private sendArmed(): void {
    this.post({ type: 'armed', logic: this.recorder.armedChannels(), analog: this.analog.armedParts() });
  }

  /** The emulator stand-in of a board when `key` is its current program and the board was started since. */
  private remote(partId: number, key: number): { rt: BoardRuntime; emu: RemoteEmulator } | null {
    const rt = this.boards.get(partId);
    const emu = rt?.emulator;
    return rt && emu instanceof RemoteEmulator && emu.key === key ? { rt, emu } : null;
  }

  private receive(msg: FromEngine): void {
    if (msg.type === 'fault') {
      console.error('Simulation Worker:', msg.message);
      return;
    }
    if (msg.type !== 'frame') return;
    this.applyBurns(msg.burns);
    for (const s of msg.serial) {
      const r = this.remote(s.partId, s.key);
      if (r?.rt.started) this.boards.addSerial(s.partId, s.bytes as SerialBytes);
    }
    for (const s of msg.slices) {
      const r = this.remote(s.partId, s.key);
      if (!r?.rt.started) continue;
      r.emu.clockHz = s.clockHz;
      this.recorder.slice(r.rt, { start: s.start, end: s.end, drives: s.drives, events: s.events, serial: {} });
    }
    if (msg.epoch === this.epoch) {
      for (const a of msg.analog) {
        const n = a.ids.length;
        a.times.forEach((t, i) => this.analog.ingest(t, a.part, a.ids, (j) => a.values[i * n + j] ?? undefined));
      }
    }
    const snap = msg.snapshot;
    this.snap = snap;
    for (const seq of this.wireIdsBySeq.keys()) if (seq < snap.circuit) this.wireIdsBySeq.delete(seq);
    this.boards.speed = snap.speed;
    for (const b of snap.boards) {
      const r = this.remote(b.partId, b.key);
      if (!r) continue;
      r.emu.cycles = b.cycles;
      if (b.clockHz > 0) r.emu.clockHz = b.clockHz;
      r.emu.bauds = b.bauds;
    }
    this.onFrame?.();
  }
}
