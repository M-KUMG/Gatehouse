// Glue between the editor and the headless simulator (src/sim): turns the
// scene into a netlist, re-solves when the netlist changes, and keeps the
// latest result for drawing and readouts. Boards (src/mcu) go through the
// mixed-signal bridge, which also owns the simulated clock; without boards
// a circuit is solved once, exactly as a plain DC circuit. Circuits with
// capacitors or inductors are stepped in time by the bridge (see
// mixedsignal.ts) while the clock runs.
//
// The global transport (Start / Pause / Reset, see transportmodel.ts) lives
// here too, as UI-only state (not saved, not undoable): the circuit clock
// (`circuitRunning`) lets time advance without any running board, and the
// buttons drive every board through the same calls as its own buttons.

import type { BuildInput } from './build/compiler';
import { endTerminal, findContacts } from './contacts';
import type { Scene, WireEnd } from './model';
import { MixedSignal } from './mcu/mixedsignal';
import { BoardRuntimes, type BoardPartInfo } from './mcu/runtime';
import { burnReason, getPart } from './parts';
import { AnalogRecorder } from './scope/analog';
import { SignalRecorder } from './scope/recorder';
import { linkCurrents, terminalKey, type PartResult, type SimInput, type SimResult } from './sim';
import { transportState, type TransportState } from './transportmodel';

const MAX_PASSES = 4; // a burned part changes the circuit, which is solved again

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
  return { boardTypeId: part.typeId, files: { ...scene.files[part.boardId].files } };
}

export class Simulation implements SimView {
  readonly boards = new BoardRuntimes((partId) => buildInput(this.scene, partId));
  readonly bridge = new MixedSignal();
  /** Pin edges of the channels the Logic analyzer window armed (fed by the bridge, read-only towards it). */
  readonly recorder = new SignalRecorder();
  /** Values of the part the Scope window follows (fed by the bridge per solved instant, read-only towards it; cleared by reset()). */
  readonly analog = new AnalogRecorder();
  /** How long the last solve took, for the status line only. */
  solveMs = 0;
  maxVoltage = 0;
  private signature = '';
  private input: SimInput = { components: [], links: [] };
  private wireIds: number[] = [];
  private readonly wireAmps = new Map<number, number>();
  /** The circuit clock runs (Start): time advances even when no board runs. UI-only state. */
  private clockRunning = false;
  /** Start was pressed since the last Reset (so a stopped clock reads as paused). */
  private clockStarted = false;

  constructor(
    private readonly scene: Scene,
    private readonly netlist: NetlistBuilder = buildNetlist,
  ) {
    this.bridge.observer = this.recorder;
    this.bridge.stepObserver = this.analog;
  }

  get result(): SimResult | null {
    return this.bridge.result;
  }

  /** Simulated seconds on the global timeline (advances while a board or the circuit clock runs). */
  get time(): number {
    return this.bridge.time;
  }

  update(): void {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const slots = this.boards.sync(boardParts(this.scene));
      const { input, wireIds } = this.netlist(this.scene);
      const signature = `${this.boards.version}|${JSON.stringify(input)}`;
      if (signature === this.signature) break;
      this.signature = signature;
      this.input = input;
      this.wireIds = wireIds;

      const started = performance.now();
      this.bridge.setCircuit(input, slots);
      this.solveMs = performance.now() - started;
      if (!this.afterSolve()) break;
    }
  }

  /**
   * Run the boards for `seconds` of simulated time (whole 1 ms slices; the
   * rest carries over). Serial output goes to the board runtimes.
   */
  advance(seconds: number): void {
    this.update();
    if (!this.timeRunning) return;
    const serial = this.bridge.advance(seconds);
    for (const [id, bytes] of serial) this.boards.addSerial(id, bytes);
    if (this.afterSolve()) this.update();
  }

  /** Derived values after a new result. True when a part burned (the circuit changed). */
  private afterSolve(): boolean {
    const result = this.bridge.result;
    if (!result) return false;
    this.maxVoltage = result.voltages.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
    this.wireAmps.clear();
    const flows = linkCurrents(this.input, result);
    this.wireIds.forEach((id, i) => this.wireAmps.set(id, flows[i]));
    return this.burnParts(result);
  }

  /**
   * Destroy parts beyond their limits: too much current (PartType.burnAbove)
   * or a rating rule (PartType.burnWhen, e.g. a reversed electrolytic). The
   * reason is kept in state.burnedBy. Only a converged result counts (a
   * failed solve reports zeros). True when the circuit changed.
   */
  private burnParts(result: SimResult): boolean {
    if (!result.converged) return false;
    let burned = false;
    for (const part of this.scene.parts) {
      const type = getPart(part.typeId);
      const r = result.parts[part.id];
      if (!type || !r) continue;
      const reason = burnReason(type, r, part.state ?? {});
      if (reason === null) continue;
      part.state = { ...part.state, burned: true, burnedBy: reason };
      burned = true;
    }
    return burned;
  }

  partResult(partId: number): PartResult | undefined {
    return this.result?.parts[partId];
  }

  /** The circuit has capacitors or inductors (it changes over simulated time). */
  get hasReactiveParts(): boolean {
    return this.bridge.reactive;
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
    return this.boards.anyRunning || (this.clockRunning && this.bridge.reactive);
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
  }

  /** Pause: every running board pauses and the circuit clock stops (everything is kept). */
  pause(): void {
    this.clockRunning = false;
    for (const { id } of boardParts(this.scene)) this.boards.pauseBoard(id);
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
    this.bridge.reset();
    this.analog.clear();
    this.afterSolve();
  }

  pinVoltage(end: WireEnd): number | undefined {
    const r = this.result;
    if (!r || !r.converged) return undefined;
    const net = r.nets[terminalKey(endTerminal(end))];
    return net === undefined ? undefined : r.voltages[net];
  }

  wireCurrent(wireId: number): number {
    return this.wireAmps.get(wireId) ?? 0;
  }

  /** One line for the status bar. */
  status(): string {
    const r = this.result;
    if (!r || r.reference === 'empty') return 'Drag parts onto the grid, then drag from pin to pin to wire them';
    if (!r.converged) return 'Simulation failed: the solver found no stable operating point';
    const clock = this.bridge.time > 0 || this.timeRunning ? `simulated ${this.bridge.time.toFixed(3)} s · ` : '';
    const nets = `${clock}${r.connectedNets} ${r.connectedNets === 1 ? 'net' : 'nets'}`;
    const time = `solved in ${this.solveMs < 0.05 ? '<0.1' : this.solveMs.toFixed(1)} ms`;
    if (r.reference === 'battery') return `No ground part: using battery − as reference · ${nets}, ${time}`;
    if (r.reference === 'floating') return `No ground or battery: using the first net as reference · ${nets}, ${time}`;
    return `Simulating: ${nets}, ${time}`;
  }
}
