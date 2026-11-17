// Glue between the editor and the headless simulator (src/sim): turns the
// scene into a netlist, re-solves when the netlist changes, and keeps the
// latest result for drawing and readouts. Boards (src/mcu) go through the
// mixed-signal bridge, which also owns the simulated clock; without boards
// a circuit is solved once, exactly as a plain DC circuit.

import type { PinRef, Scene } from './model';
import { MixedSignal } from './mcu/mixedsignal';
import { BoardRuntimes, type BoardPartInfo } from './mcu/runtime';
import { getPart } from './parts';
import { linkCurrents, terminalKey, type PartResult, type SimInput, type SimResult } from './sim';

const MAX_PASSES = 4; // a burned part changes the circuit, which is solved again

/** What the view needs from the simulation. */
export interface SimView {
  /** Bring the result up to date with the scene. Cheap when nothing changed. */
  update(): void;
  partResult(partId: number): PartResult | undefined;
  /** Volts at a pin, or undefined before the first solve. */
  pinVoltage(ref: PinRef): number | undefined;
  /** Amps flowing along the wire from its `from` pin to its `to` pin (0 when unknown). */
  wireCurrent(wireId: number): number;
  /** Largest voltage magnitude in the circuit. */
  readonly maxVoltage: number;
}

/** The scene's electrical content; positions and wire corners do not matter. */
export function buildNetlist(scene: Scene): { input: SimInput; wireIds: number[] } {
  const input: SimInput = { components: [], links: [] };
  const wireIds: number[] = [];
  for (const wire of scene.wires) {
    input.links.push([
      { part: wire.from.partId, pin: wire.from.pinId },
      { part: wire.to.partId, pin: wire.to.pinId },
    ]);
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
  return { input, wireIds };
}

/** The board parts of a scene, for BoardRuntimes.sync. */
export function boardParts(scene: Scene): BoardPartInfo[] {
  const out: BoardPartInfo[] = [];
  for (const part of scene.parts) {
    const spec = getPart(part.typeId)?.board;
    if (spec) out.push({ id: part.id, spec, program: part.state?.program });
  }
  return out;
}

export class Simulation implements SimView {
  readonly boards = new BoardRuntimes();
  readonly bridge = new MixedSignal();
  /** How long the last solve took, for the status line only. */
  solveMs = 0;
  maxVoltage = 0;
  private signature = '';
  private input: SimInput = { components: [], links: [] };
  private wireIds: number[] = [];
  private readonly wireAmps = new Map<number, number>();

  constructor(private readonly scene: Scene) {}

  get result(): SimResult | null {
    return this.bridge.result;
  }

  /** Simulated seconds on the global timeline (advances only while a board runs). */
  get time(): number {
    return this.bridge.time;
  }

  update(): void {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const slots = this.boards.sync(boardParts(this.scene));
      const { input, wireIds } = buildNetlist(this.scene);
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
    if (!this.boards.anyRunning) return;
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

  /** Destroy parts carrying far too much current. True when the circuit changed. */
  private burnParts(result: SimResult): boolean {
    let burned = false;
    for (const part of this.scene.parts) {
      const limit = getPart(part.typeId)?.burnAbove;
      const amps = Math.abs(result.parts[part.id]?.current ?? 0);
      if (limit === undefined || amps <= limit || part.state?.burned) continue;
      part.state = { ...part.state, burned: true };
      burned = true;
    }
    return burned;
  }

  partResult(partId: number): PartResult | undefined {
    return this.result?.parts[partId];
  }

  pinVoltage(ref: PinRef): number | undefined {
    const r = this.result;
    if (!r || !r.converged) return undefined;
    const net = r.nets[terminalKey({ part: ref.partId, pin: ref.pinId })];
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
    const clock = this.bridge.time > 0 ? `simulated ${this.bridge.time.toFixed(3)} s · ` : '';
    const nets = `${clock}${r.connectedNets} ${r.connectedNets === 1 ? 'net' : 'nets'}`;
    const time = `solved in ${this.solveMs < 0.05 ? '<0.1' : this.solveMs.toFixed(1)} ms`;
    if (r.reference === 'battery') return `No ground part: using battery − as reference · ${nets}, ${time}`;
    if (r.reference === 'floating') return `No ground or battery: using the first net as reference · ${nets}, ${time}`;
    return `Simulating: ${nets}, ${time}`;
  }
}
