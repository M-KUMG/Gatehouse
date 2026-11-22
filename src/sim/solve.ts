// DC operating point: Modified Nodal Analysis solved with Newton-Raphson.
// Unknowns are the node voltages (all nets but the reference, plus internal
// device nodes) followed by one branch current per voltage source.
// Pure and deterministic: same input, same output; no clock, no randomness.
// Capacitors are open and inductors near shorts here; with a `Companion`
// (one time step, see transient.ts) they become their companion models and
// the same Newton loop (convergence aids included) solves the step.

import { bjtResult, makeBjt, stampBjt, updateBjt, type Bjt } from './bjt';
import {
  DEFAULT_BULB_LOGIC, DEFAULT_LEDBULB_LOGIC, bulbResults, decideBulb, decideLedBulb, expandBulbs, isBulbLogic, isLedBulbLogic,
  ledBulbCurve, ledBulbParams, sameBulb, sameLedBulb, type BulbLogic, type LedBulbLogic,
} from './bulb';
import {
  GMIN, POT_END_OHMS, SWITCH_CLOSED_OHMS, SWITCH_OPEN_OHMS, VT,
  criticalVoltage, limitJunction,
} from './devices';
import {
  DEFAULT_LOGIC, DRIVER_PINS, MAX_LOGIC_ROUNDS, commonLogic, decideLogic, driverBranches, driverResult, isDriverLogic, sameLogic,
  sensePins, type DriverElement, type DriverLogic,
} from './driver';
import {
  DEFAULT_GATE_LOGIC, GATE_INPUT_OHMS, GATE_OUT_OHMS, decideGate, gateOutput, gateResult, isGateLogic, sameGate,
  type GateElement, type GateLogic,
} from './gates';
import {
  DEFAULT_OPAMP_LOGIC, MODE_HIGH, MODE_LINEAR, MODE_LOW, MODE_OFF, OPAMP_CHANNELS, OPAMP_GAIN, OPAMP_HIGH_DROP_VOLTS, OPAMP_INPUT_OHMS,
  OPAMP_LOW_VOLTS, OPAMP_OFF_OHMS, OPAMP_OUT_OHMS, OPAMP_PINS, OPAMP_QUIESCENT_OHMS, decideOpamp, isOpampLogic, opampResult, sameOpamp,
  type OpampElement, type OpampLogic,
} from './opamp';
import { solveLinear } from './linear';
import { makeMosfet, mosfetResult, stampMosfet, updateMosfet, type Mosfet } from './mosfet';
import { buildNets, modelPins } from './nets';
import {
  DEFAULT_TIMER_LOGIC, TIMER_PINS, decideTimer, isTimerLogic, sameTimer, timerBranches, timerResult, type TimerElement, type TimerLogic,
} from './timer555';
import { companionOf, stampReactive, type Companion, type Reactive, type ReactiveState } from './reactive';
import { stampInto, type Stamp } from './stamp';
import type { PartResult, SimInput, SimResult } from './types';
import { buzzerCurve } from './buzzer';
import { RGB_CHANNELS } from './rgbled';
import { SEVENSEG_SEGMENTS } from './sevenseg';
import { resolveSignals } from './signal';
import { expandSupplies, limiterCurve, supplyResults } from './supply';
import { DEFAULT_MOTOR_LOGIC, decideMotor, expandMotors, isMotorLogic, motorResults, sameMotor, type MotorLogic } from './motor';
import {
  DEFAULT_BRIDGE_LOGIC, decideBridge, expandMains, isBridgeLogic, mainsResults, sameBridge, type BridgeLogic,
} from './mainsparts';
import { DEFAULT_RELAY_LOGIC, decideRelay, expandRelays, isRelayLogic, relayResults, type RelayLogic } from './relay';
import { breakdownOf, diodeCurrent, diodeStep, type DiodeCurve } from './zener';
import {
  coupledCompanion, secondaryId, transformerParams, transformerResult, type TransformerModel, type TransformerParams,
} from './transformer';

const MAX_ITERATIONS = 200;
/** Output resistance of a board's supply rails (USB 5 V, 3.3 V regulator). */
const RAIL_OHMS = 0.05;
const ABS_TOL = 1e-7;
const REL_TOL = 1e-6;

// Convergence aids (SPICE style), tried only after plain Newton has failed,
// so circuits that converge today get bit-for-bit the same answer and cost.
// Each is a continuation: a sequence of easier problems, every one started
// from the previous one's solution (node voltages and the devices' limited
// junction voltages, which is all the Newton loop carries).
//  1. gmin stepping: an extra conductance from every node to ground and
//     across every junction, GMIN_STEP_START at first, divided by up to 10
//     per stage (the divisor shrinks after a failed stage), finally 0.
//  2. source stepping: every independent source (batteries, board rails and
//     pin drives, and the stored charge of capacitors / inductors in a time
//     step) scaled from 0 to 100 %, the increment growing after a success and
//     shrinking after a failure.
// Every stage, the last one (the real circuit) included, uses Newton's
// relaxed test (see newton()): what usually defeats plain Newton here is a
// node held only by GMIN-sized conductances whose voltage jitters from
// rounding, not a real lack of convergence.
// Worst case per solve: MAX_ITERATIONS plain + GMIN_BUDGET + SOURCE_BUDGET
// Newton iterations (200 + 250 + 250 = 700 linear solves); deterministic.
// A warm-started time step (see WarmStart / solveWith) tries at most
// WARM_ITERATIONS before the aids (50 + 250 + 250), and when the last step
// needed an aid it skips the plain attempt that failed then.
const STAGE_ITERATIONS = 50;
const GMIN_STEP_START = 1e-3;
/** Below this the extra conductance is dropped altogether (it is then at most 1000 x GMIN). */
const GMIN_STEP_END = 1e-9;
const GMIN_BUDGET = 250;
const SOURCE_BUDGET = 250;
const SOURCE_FIRST_STEP = 0.1;
const SOURCE_MIN_STEP = 1e-3;
/** Residual current a node may keep in the aids' relaxed convergence test (SPICE's ABSTOL). */
const CURRENT_TOL = 1e-12;

/** How a Newton run eases the circuit: extra shunt conductance and the scale of every source. */
interface Easing { gshunt: number; scale: number }
const PLAIN: Easing = { gshunt: 0, scale: 1 };

// Primitive elements. Node numbers: 0 is the reference, k > 0 is unknown k - 1.
interface Resistor { part: number; a: number; b: number; g: number; pinA: string; pinB: string }
interface Source {
  part: number; pos: number; neg: number; volts: number; r: number; branch: number;
  /** Set for a board's supply rail: the board pin it drives. */
  pin?: string;
}
/** Norton form of a Thevenin source: conductance g from `node` to `ref`, pushing g * volts into `node`. */
interface Drive { part: number; node: number; ref: number; g: number; volts: number }
/** A junction (diode, LED, Zener, one 7-segment LED) or a curve of its own (the buzzer); see zener.ts. */
interface Diode extends DiodeCurve {
  part: number; anode: number; cathode: number;
  /** Node between the series resistance and the junction (the anode itself when rs is 0). */
  inner: number;
  v: number; // junction voltage the model is linearized at
  /** The part's pin names for anode and cathode (default 'anode', 'cathode'); several elements of one part add up. */
  pins?: readonly [string, string];
}
/**
 * An IGBT expanded into its equivalent circuit: `mos` and `bjt` are ordinary
 * elements (in `mosfets` / `bjts`, with part -1 so they report nothing of
 * their own) joined at the internal node `base`; the IGBT's result is made
 * from theirs (igbtResult).
 */
interface Igbt {
  part: number; g: number; c: number; e: number; base: number;
  polarity: 1 | -1;
  mos: Mosfet; bjt: Bjt;
}
/**
 * A transformer's two windings as coupled inductors (transformer.ts): winding k runs from `ak` through its copper
 * resistance to `innerK` and on the ideal winding to `bk`; the companion currents are i = ieq + G v.
 */
interface Coupled {
  part: number; model: TransformerModel; p: TransformerParams;
  a1: number; b1: number; inner1: number; a2: number; b2: number; inner2: number;
  g11: number; g12: number; g22: number; ieq1: number; ieq2: number;
}
interface Elements {
  resistors: Resistor[];
  sources: Source[];
  diodes: Diode[];
  bjts: Bjt[];
  mosfets: Mosfet[];
  igbts: Igbt[];
  /** Half-bridge drivers: their resistors are in `resistors` (part -1), switched by `logic` (driver.ts). */
  drivers: DriverElement[];
  /** Logic gates: input resistors in `resistors`, the output a Thevenin source in `drives` (both part -1; gates.ts). */
  gates: GateElement[];
  /** 555 timers: resistors in `resistors` (part -1), switched by the latch (timer555.ts). */
  timers: TimerElement[];
  /** Op-amp chips: resistors, pin drives and controlled sources (`vccs`) set by each amplifier's mode (opamp.ts). */
  opamps: OpampElement[];
  /** Controlled current sources into `out` from the reference: gm (v[p] - v[n]), with a conductance g from `out` to the reference. */
  vccs: { out: number; p: number; n: number; gm: number; g: number }[];
  /** Transformers: their windings (see Coupled). */
  coupled: Coupled[];
  /** `pins`: the model's two pin names (a, b; pos, neg for a polarized capacitor). */
  reactives: (Reactive & { kind: 'capacitor' | 'inductor'; pins: readonly string[] })[];
  drives: Drive[];
  nodes: number; // including the reference and internal nodes
}

/**
 * A series resistance of `ohms` from `node` to a new internal node, which is
 * returned (an unnamed resistor: it reports nothing of its own); `node`
 * itself when there is none.
 */
function seriesNode(el: Elements, node: number, ohms: number | undefined): number {
  if (ohms === undefined || !(ohms > 0)) return node;
  const inner = el.nodes++;
  el.resistors.push({ part: -1, a: node, b: inner, g: 1 / ohms, pinA: '', pinB: '' });
  return inner;
}

function buildElements(
  input: SimInput, netOf: (part: number, pin: string) => number, netCount: number, step: Companion | undefined,
  logic?: Readonly<LogicState>,
): Elements {
  const el: Elements = {
    resistors: [], sources: [], diodes: [], bjts: [], mosfets: [], igbts: [], drivers: [], gates: [], timers: [], opamps: [], vccs: [], coupled: [], reactives: [], drives: [],
    nodes: netCount,
  };
  const resistor = (part: number, pinA: string, pinB: string, ohms: number): void => {
    el.resistors.push({ part, a: netOf(part, pinA), b: netOf(part, pinB), g: 1 / ohms, pinA, pinB });
  };
  for (const { id, model: m } of input.components) {
    switch (m.kind) {
      case 'battery':
        el.sources.push({ part: id, pos: netOf(id, 'pos'), neg: netOf(id, 'neg'), volts: m.volts, r: m.rInternal, branch: 0 });
        break;
      case 'resistor':
        resistor(id, 'a', 'b', Math.max(m.ohms, 1e-6));
        break;
      case 'switch':
        resistor(id, 'a', 'b', m.closed ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS);
        break;
      case 'pot': {
        const p = Math.min(1, Math.max(0, m.position));
        resistor(id, 'a', 'w', Math.max(m.ohms * p, POT_END_OHMS));
        resistor(id, 'w', 'b', Math.max(m.ohms * (1 - p), POT_END_OHMS));
        break;
      }
      case 'diode': {
        const anode = netOf(id, 'anode');
        const nvt = m.n * VT;
        const inner = m.rs > 0 ? el.nodes++ : anode;
        el.diodes.push({
          part: id, anode, cathode: netOf(id, 'cathode'), inner,
          is: m.is, nvt, vCrit: criticalVoltage(m.is, nvt), v: 0, ...breakdownOf(m),
        });
        if (m.rs > 0) el.resistors.push({ part: -1, a: anode, b: inner, g: 1 / m.rs, pinA: '', pinB: '' });
        break;
      }
      case 'sevenseg': {
        // Eight LEDs, segment pin -> com, each behind its own rs.
        const nvt = m.n * VT;
        const com = netOf(id, 'com');
        for (const seg of SEVENSEG_SEGMENTS) {
          const anode = netOf(id, seg);
          const inner = seriesNode(el, anode, m.rs);
          el.diodes.push({ part: id, anode, cathode: com, inner, is: m.is, nvt, vCrit: criticalVoltage(m.is, nvt), v: 0, pins: [seg, 'com'] });
        }
        break;
      }
      case 'rgbled': {
        // Three LEDs, colour pin -> com, each with its own curve and behind its own rs.
        const com = netOf(id, 'com');
        for (const ch of RGB_CHANNELS) {
          const die = m[ch];
          const nvt = die.n * VT;
          const anode = netOf(id, ch);
          const inner = seriesNode(el, anode, die.rs);
          el.diodes.push({ part: id, anode, cathode: com, inner, is: die.is, nvt, vCrit: criticalVoltage(die.is, nvt), v: 0, pins: [ch, 'com'] });
        }
        break;
      }
      case 'limiter':
        // A diode element with the limiter's own curve (supply.ts); no junction step limiting (tanh saturates by itself).
        el.diodes.push({
          part: id, anode: netOf(id, 'a'), cathode: netOf(id, 'b'), inner: netOf(id, 'a'),
          is: 0, nvt: VT, vCrit: Infinity, v: 0, curve: (v) => limiterCurve(m, v), pins: ['a', 'b'],
        });
        break;
      case 'buzzer':
        // A diode element with the buzzer's own curve (buzzer.ts).
        el.diodes.push({
          part: id, anode: netOf(id, 'pos'), cathode: netOf(id, 'neg'), inner: netOf(id, 'pos'),
          is: 0, nvt: VT, vCrit: 0, v: 0, curve: (v) => buzzerCurve(m, v), pins: ['pos', 'neg'],
        });
        break;
      case 'npn':
      case 'pnp': {
        // Series resistances (bjt.ts): the model sits on internal nodes behind them.
        const ext = { c: netOf(id, 'c'), b: netOf(id, 'b'), e: netOf(id, 'e') };
        const nodes = { c: seriesNode(el, ext.c, m.rc), b: seriesNode(el, ext.b, m.rb), e: seriesNode(el, ext.e, m.re) };
        const gleak = m.rleak !== undefined && m.rleak > 0 ? 1 / m.rleak : 0;
        el.bjts.push(makeBjt(id, nodes, m.kind === 'npn' ? 1 : -1, m.is, m.bf, m.br, { vaf: m.vaf, gleak, ext }));
        break;
      }
      case 'mosfet': {
        // Drain and source lead resistances: the channel sits on internal nodes behind them.
        const ext = { d: netOf(id, 'd'), g: netOf(id, 'g'), s: netOf(id, 's') };
        const nodes = { d: seriesNode(el, ext.d, m.rd), g: ext.g, s: seriesNode(el, ext.s, m.rs) };
        el.mosfets.push(makeMosfet(id, nodes, m.polarity, m.vth, m.kp, m.lambda, ext));
        break;
      }
      case 'igbt': {
        // N: MOSFET d = base, s = e; PNP e = c (behind rc), b = base, c = e.
        // P: the complement (P-MOSFET, NPN), same wiring.
        const g = netOf(id, 'g');
        const c = netOf(id, 'c');
        const e = netOf(id, 'e');
        const base = el.nodes++;
        const rc = m.rc ?? 0;
        const cInner = rc > 0 ? el.nodes++ : c;
        if (rc > 0) el.resistors.push({ part: -1, a: c, b: cInner, g: 1 / rc, pinA: '', pinB: '' });
        if (m.rleak !== undefined && m.rleak > 0) {
          el.resistors.push({ part: -1, a: base, b: e, g: 1 / m.rleak, pinA: '', pinB: '' });
        }
        const mos = makeMosfet(-1, { d: base, g, s: e }, m.polarity, m.vth, m.kp, m.lambda);
        const bjt = makeBjt(-1, { c: e, b: base, e: cInner }, m.polarity === 1 ? -1 : 1, m.is, m.bf, m.br);
        el.mosfets.push(mos);
        el.bjts.push(bjt);
        el.igbts.push({ part: id, g, c, e, base, polarity: m.polarity, mos, bjt });
        break;
      }
      case 'halfdriver': {
        // Resistors only, switched by the logic state this solve uses (see driver.ts and solveSettled).
        const nodes = Object.fromEntries(DRIVER_PINS.map((p) => [p, netOf(id, p)])) as DriverElement['nodes'];
        const held = logic?.[id];
        const d: DriverElement = { part: id, nodes, logic: isDriverLogic(held) ? held : DEFAULT_LOGIC };
        for (const b of driverBranches(d.logic)) {
          el.resistors.push({ part: -1, a: nodes[b.a], b: nodes[b.b], g: 1 / b.ohms, pinA: '', pinB: '' });
        }
        el.drivers.push(d);
        break;
      }
      case 'timer555': {
        // Resistors only, switched by the latch this solve uses (see timer555.ts and solveSettled).
        const nodes = Object.fromEntries(TIMER_PINS.map((p) => [p, netOf(id, p)])) as TimerElement['nodes'];
        const held = logic?.[id];
        const t: TimerElement = { part: id, nodes, logic: isTimerLogic(held) ? held : DEFAULT_TIMER_LOGIC };
        for (const b of timerBranches(t.logic)) {
          el.resistors.push({ part: -1, a: nodes[b.a], b: nodes[b.b], g: 1 / b.ohms, pinA: '', pinB: '' });
        }
        el.timers.push(t);
        break;
      }
      case 'opamp': {
        // Per amplifier by its mode: a gain-limited source, or the output held at a rail (see opamp.ts and solveSettled).
        const nodes = Object.fromEntries(OPAMP_PINS.map((p) => [p, netOf(id, p)])) as OpampElement['nodes'];
        const held = logic?.[id];
        const o: OpampElement = { part: id, nodes, logic: isOpampLogic(held) ? held : DEFAULT_OPAMP_LOGIC };
        el.resistors.push({ part: -1, a: nodes.vcc, b: nodes.gnd, g: 1 / OPAMP_QUIESCENT_OHMS, pinA: '', pinB: '' });
        for (const ch of OPAMP_CHANNELS) {
          el.resistors.push({ part: -1, a: nodes[ch.p], b: 0, g: 1 / OPAMP_INPUT_OHMS, pinA: '', pinB: '' });
          el.resistors.push({ part: -1, a: nodes[ch.n], b: 0, g: 1 / OPAMP_INPUT_OHMS, pinA: '', pinB: '' });
          const out = nodes[ch.out];
          const mode = o.logic[ch.key];
          if (mode === MODE_LINEAR) {
            el.vccs.push({ out, p: nodes[ch.p], n: nodes[ch.n], gm: OPAMP_GAIN / OPAMP_OUT_OHMS, g: 1 / OPAMP_OUT_OHMS });
          } else if (mode === MODE_HIGH) {
            el.drives.push({ part: -1, node: out, ref: nodes.vcc, g: 1 / OPAMP_OUT_OHMS, volts: -OPAMP_HIGH_DROP_VOLTS });
          } else if (mode === MODE_LOW) {
            el.drives.push({ part: -1, node: out, ref: nodes.gnd, g: 1 / OPAMP_OUT_OHMS, volts: OPAMP_LOW_VOLTS });
          } else if (mode === MODE_OFF) {
            el.resistors.push({ part: -1, a: out, b: nodes.gnd, g: 1 / OPAMP_OFF_OHMS, pinA: '', pinB: '' });
          }
        }
        el.opamps.push(o);
        break;
      }
      case 'gate': {
        // Inputs: 10 MOhm to the reference; output: vcc or 0 V behind 25 ohm to the reference (gates.ts).
        const held = logic?.[id];
        const nodes = { a: netOf(id, 'a'), b: m.inputs === 2 ? netOf(id, 'b') : -1, y: netOf(id, 'y') };
        const g: GateElement = {
          part: id, fn: m.fn, inputs: m.inputs, vcc: m.vcc, nodes, logic: isGateLogic(held) ? held : DEFAULT_GATE_LOGIC,
        };
        el.resistors.push({ part: -1, a: nodes.a, b: 0, g: 1 / GATE_INPUT_OHMS, pinA: '', pinB: '' });
        if (m.inputs === 2) el.resistors.push({ part: -1, a: nodes.b, b: 0, g: 1 / GATE_INPUT_OHMS, pinA: '', pinB: '' });
        el.drives.push({ part: -1, node: nodes.y, ref: 0, g: 1 / GATE_OUT_OHMS, volts: gateOutput(m.fn, g.logic) ? m.vcc : 0 });
        el.gates.push(g);
        break;
      }
      case 'capacitor':
      case 'inductor': {
        const pins = modelPins(m);
        const a = netOf(id, pins[0]);
        const series = (m.kind === 'capacitor' ? m.esr : m.dcr) ?? 0;
        const inner = series > 0 ? el.nodes++ : a;
        if (series > 0) el.resistors.push({ part: -1, a, b: inner, g: 1 / series, pinA: '', pinB: '' });
        el.reactives.push({
          kind: m.kind, part: id, pins, a, b: netOf(id, pins[1]), inner, ...companionOf(m, step, step?.stored[id]),
        });
        break;
      }
      case 'ledbulb': {
        // A symmetric curve between a and b (bulb.ts), like the buzzer's.
        const curve = ledBulbParams(m);
        el.diodes.push({
          part: id, anode: netOf(id, 'a'), cathode: netOf(id, 'b'), inner: netOf(id, 'a'),
          is: 0, nvt: VT, vCrit: Infinity, v: 0, curve: (v) => ledBulbCurve(curve, v), pins: ['a', 'b'],
        });
        break;
      }
      case 'transformer': {
        // Two coupled inductors, each behind its own copper resistance (transformer.ts).
        const p = transformerParams(m);
        const a1 = netOf(id, 'p1');
        const a2 = netOf(id, 's1');
        el.coupled.push({
          part: id, model: m, p, a1, b1: netOf(id, 'p2'), inner1: seriesNode(el, a1, p.r1),
          a2, b2: netOf(id, 's2'), inner2: seriesNode(el, a2, p.r2),
          ...coupledCompanion(p, step, step?.stored[id], step?.stored[secondaryId(id)]),
        });
        break;
      }
      case 'board': {
        const gnd = netOf(id, 'gnd');
        for (const [pin, volts] of Object.entries(m.rails)) {
          el.sources.push({ part: id, pos: netOf(id, pin), neg: gnd, volts, r: RAIL_OHMS, branch: 0, pin });
        }
        for (const [pin, d] of Object.entries(m.io)) {
          el.drives.push({ part: id, node: netOf(id, pin), ref: gnd, g: 1 / Math.max(d.ohms, 1e-3), volts: d.volts });
        }
        break;
      }
      case 'ground':
      case 'open':
      case 'node': // only joins the wires on its net
        break;
    }
  }
  el.sources.forEach((s, i) => (s.branch = el.nodes - 1 + i));
  return el;
}

/**
 * The buffers of one solve's linear systems, allocated once per solve and
 * reused by every Newton iteration (no allocation per iteration).
 * The matrix is a flat row-major array with one view per row (`rows`;
 * solveLinear swaps the views, every assembly puts them back in order).
 * The part of the system that does not depend on the devices' operating
 * points (GMIN, the aids' shunts, resistors, pin drives, sources) is stamped
 * once per easing into `base` and copied in; only the junctions and the
 * reactive companions (in the original order, so every sum is the same as
 * when everything was stamped afresh) are restamped each iteration.
 */
class Workspace {
  private readonly base: Float64Array;
  private readonly baseZ: Float64Array;
  private readonly flat: Float64Array;
  readonly z: Float64Array;
  private readonly views: Float64Array[] = [];
  readonly rows: Float64Array[] = [];
  /** The assembled matrix before elimination (only the relaxed test needs it: made on first use). */
  private saved: Float64Array | null = null;
  savedRows: Float64Array[] = [];
  /** Newton's iterates alternate between these two. */
  readonly xs: [Float64Array, Float64Array];
  private readonly stamp: Stamp;
  private baseEase: Easing | null = null;

  constructor(readonly el: Elements, readonly size: number) {
    this.base = new Float64Array(size * size);
    this.baseZ = new Float64Array(size);
    this.flat = new Float64Array(size * size);
    this.z = new Float64Array(size);
    for (let i = 0; i < size; i++) this.views.push(this.flat.subarray(i * size, (i + 1) * size));
    this.rows = this.views.slice();
    this.xs = [new Float64Array(size), new Float64Array(size)];
    this.stamp = stampInto(this.rows, this.z);
  }

  /** The linearized system at the devices' current operating points, in `rows` and `z`. */
  assemble(ease: Easing): void {
    this.restoreRows();
    if (!this.baseEase || this.baseEase.gshunt !== ease.gshunt || this.baseEase.scale !== ease.scale) {
      this.flat.fill(0);
      this.z.fill(0);
      stampLinear(this.el, this.rows, this.z, this.stamp, ease);
      this.base.set(this.flat);
      this.baseZ.set(this.z);
      this.baseEase = { ...ease };
    } else {
      this.flat.set(this.base);
      this.z.set(this.baseZ);
    }
    stampDevices(this.el, this.stamp, ease.scale);
  }

  /** Keeps the assembled matrix in `savedRows` (solveLinear overwrites it). */
  save(): void {
    if (!this.saved) {
      const saved = new Float64Array(this.size * this.size);
      for (let i = 0; i < this.size; i++) this.savedRows.push(saved.subarray(i * this.size, (i + 1) * this.size));
      this.saved = saved;
    }
    this.saved.set(this.flat);
  }

  private restoreRows(): void {
    for (let i = 0; i < this.size; i++) this.rows[i] = this.views[i];
  }
}

/** The part of the system that stays the same for one easing. */
function stampLinear(el: Elements, a: Float64Array[], z: Float64Array, stamp: Stamp, ease: Easing): void {
  const { addG, addI, addGm } = stamp;
  const { gshunt, scale } = ease;

  for (let n = 1; n < el.nodes; n++) a[n - 1][n - 1] += GMIN;
  if (gshunt > 0) {
    for (let n = 1; n < el.nodes; n++) a[n - 1][n - 1] += gshunt;
    for (const d of el.diodes) addG(d.inner, d.cathode, gshunt);
    for (const q of el.bjts) {
      addG(q.b, q.e, gshunt);
      addG(q.b, q.c, gshunt);
    }
    for (const q of el.mosfets) {
      addG(q.d, q.s, gshunt);
      addG(q.g, q.s, gshunt);
    }
  }
  for (const r of el.resistors) addG(r.a, r.b, r.g);
  for (const d of el.drives) {
    addG(d.node, d.ref, d.g);
    addI(d.ref, d.node, d.g * d.volts * scale);
  }
  for (const v of el.vccs) {
    // out = gain x (p - n) behind g: a conductance to the reference and a current gm (v[p] - v[n]) into out.
    addG(v.out, 0, v.g);
    addGm(0, v.out, v.p, v.n, v.gm);
  }

  for (const s of el.sources) {
    // Branch current I flows into the positive terminal: v+ - v- - r I = volts.
    const k = s.branch;
    if (s.pos > 0) {
      a[s.pos - 1][k] += 1;
      a[k][s.pos - 1] += 1;
    }
    if (s.neg > 0) {
      a[s.neg - 1][k] -= 1;
      a[k][s.neg - 1] -= 1;
    }
    a[k][k] -= s.r;
    z[k] = s.volts * scale;
  }
}

/** The junctions at their operating points, then the reactive companions (their sources scaled by `scale`). */
function stampDevices(el: Elements, stamp: Stamp, scale: number): void {
  const { addG, addI } = stamp;
  for (const d of el.diodes) {
    const { i, g } = diodeCurrent(d, d.v);
    addG(d.inner, d.cathode, g + GMIN);
    addI(d.inner, d.cathode, i - g * d.v);
  }
  for (const q of el.bjts) stampBjt(q, stamp);
  for (const q of el.mosfets) stampMosfet(q, stamp);
  for (const r of el.reactives) stampReactive(scale === 1 ? r : { ...r, ieq: r.ieq * scale }, stamp);
  const { addGm } = stamp;
  for (const c of el.coupled) {
    addG(c.inner1, c.b1, c.g11);
    addG(c.inner2, c.b2, c.g22);
    addGm(c.inner1, c.b1, c.inner2, c.b2, c.g12);
    addGm(c.inner2, c.b2, c.inner1, c.b1, c.g12);
    addI(c.inner1, c.b1, c.ieq1 * scale);
    addI(c.inner2, c.b2, c.ieq2 * scale);
  }
}

/** The devices' linearization points (all the state Newton's method carries besides the node voltages). */
function deviceState(el: Elements): number[] {
  const s: number[] = [];
  for (const d of el.diodes) s.push(d.v);
  for (const q of el.bjts) s.push(q.vbe, q.vbc);
  for (const q of el.mosfets) s.push(q.vgs, q.vds);
  return s;
}

/** Puts back a deviceState() snapshot; without one every device goes back to 0 V (the cold start). */
function setDeviceState(el: Elements, s: readonly number[] | null): void {
  let k = 0;
  const next = (): number => (s ? s[k++] : 0);
  for (const d of el.diodes) d.v = next();
  for (const q of el.bjts) {
    q.vbe = next();
    q.vbc = next();
  }
  for (const q of el.mosfets) {
    q.vgs = next();
    q.vds = next();
  }
}

interface NewtonRun {
  x: Float64Array;
  converged: boolean;
  iterations: number;
  /** Converged by the plain test alone (no unknown needed the relaxed residual check). */
  strict?: boolean;
}

/**
 * Newton-Raphson with junction limiting from `x` and the devices' current
 * linearization points (which it moves along), at most `maxIterations` steps.
 *
 * Settled when no unknown moves by more than ABS_TOL + REL_TOL of itself.
 * With `relaxed` (the convergence aids only) an unknown that still moves is
 * accepted too when the step leaves its equation balanced: the residual of
 * its row, (A dx)_i, is within CURRENT_TOL (a node) or ABS_TOL (a source
 * branch) plus REL_TOL of the row's terms (for a node: of its branch currents). That is a node held only by GMIN
 * and reverse-biased junctions (a floating base): its voltage is pinned by
 * currents of ~1e-14 A and wanders by microvolts from rounding alone, so the
 * plain test can never pass, yet nothing in the circuit depends on it.
 */
function newton(
  ws: Workspace, start: Float64Array, ease: Easing, maxIterations: number, relaxed = false,
): NewtonRun {
  const { el, size } = ws;
  let x = start;
  const volt = (n: number): number => (n > 0 ? x[n - 1] : 0);
  const nonlinear = el.diodes.length + el.bjts.length + el.mosfets.length > 0;
  const nodeRows = Math.max(0, el.nodes - 1);
  let iterations = 0;
  let settled = true;
  // Move each junction to its new voltage, but never too far up the exponential.
  const step = (raw: number, old: number, nvt: number, vCrit: number): number => {
    const limited = limitJunction(raw, old, nvt, vCrit);
    if (Math.abs(limited - raw) > ABS_TOL) settled = false;
    return limited;
  };
  const bjtStep = (raw: number, old: number, vCrit: number): number => step(raw, old, VT, vCrit);
  // The answer must outlive the workspace's buffers.
  const own = (v: Float64Array): Float64Array => (v === ws.xs[0] || v === ws.xs[1] ? v.slice() : v);
  for (let iter = 1; iter <= maxIterations; iter++) {
    ws.assemble(ease);
    if (relaxed) ws.save(); // solveLinear overwrites the matrix
    const next = solveLinear(ws.rows, ws.z, x === ws.xs[0] ? ws.xs[1] : ws.xs[0]);
    if (!next) break;
    settled = true;
    let strict = true;
    if (nonlinear) {
      for (let i = 0; i < size && settled; i++) {
        if (Math.abs(next[i] - x[i]) <= ABS_TOL + REL_TOL * Math.abs(next[i])) continue;
        strict = false;
        if (!relaxed) {
          settled = false;
          break;
        }
        let residual = 0;
        let scale = 0;
        const row = ws.savedRows[i];
        // A node row's scale is the sum of its branch currents' magnitudes:
        // conductance to node j times the voltage across it, the rest of the
        // diagonal (to the reference) times the node's own voltage. (Row
        // terms times node voltages instead would let a floating node behind
        // a small series resistance, e.g. a transistor's re, pass with a
        // residual of microamps.) A source branch row: its terms as they are.
        let toRef = 0;
        for (let j = 0; j < size; j++) {
          residual += row[j] * (next[j] - x[j]);
          if (i < nodeRows && j < nodeRows) {
            toRef += row[j];
            if (j !== i) scale += Math.abs(row[j] * (next[j] - next[i]));
          } else {
            scale += Math.abs(row[j] * next[j]);
          }
        }
        if (i < nodeRows) scale += Math.abs(toRef * next[i]);
        if (Math.abs(residual) > (i < nodeRows ? CURRENT_TOL : ABS_TOL) + REL_TOL * scale) settled = false;
      }
    }
    x = next;
    iterations = iter;
    for (const d of el.diodes) d.v = diodeStep(d, volt(d.inner) - volt(d.cathode), d.v, step);
    for (const q of el.bjts) updateBjt(q, volt, bjtStep);
    for (const q of el.mosfets) if (updateMosfet(q, volt, ABS_TOL)) settled = false;
    if (settled) return { x: own(x), converged: true, iterations, strict };
  }
  return { x: own(x), converged: false, iterations };
}

/**
 * A continuation from the cold start through easier circuits to the real
 * one. `next(good, ok)` gives the easing of the following stage, knowing the
 * last converged easing (`good`, null before the first) and whether the
 * stage just run converged; null stops. A failed stage puts the devices back
 * where the last converged stage left them. Converged only when the real
 * circuit (no shunt, full sources) did, within `budget` Newton iterations.
 */
function continuation(
  ws: Workspace, budget: number, first: Easing,
  next: (good: Easing | null, ok: boolean) => Easing | null,
): NewtonRun {
  const { el, size } = ws;
  setDeviceState(el, null);
  let good: { ease: Easing; x: Float64Array; devices: number[] } | null = null;
  let iterations = 0;
  let ease: Easing | null = first;
  while (ease && iterations < budget) {
    const run = newton(ws, good?.x ?? new Float64Array(size), ease, Math.min(STAGE_ITERATIONS, budget - iterations), true);
    // A singular matrix makes no Newton step at all: count it anyway so the budget bounds the loop.
    iterations += Math.max(1, run.iterations);
    if (run.converged) {
      if (ease.gshunt === 0 && ease.scale === 1) return { x: run.x, converged: true, iterations };
      good = { ease, x: run.x, devices: deviceState(el) };
    } else {
      setDeviceState(el, good?.devices ?? null);
    }
    ease = next(good?.ease ?? null, run.converged);
  }
  return { x: new Float64Array(size), converged: false, iterations };
}

/** Gmin stepping: the extra shunt starts at GMIN_STEP_START and goes down by up to a decade per stage, then to 0. */
function gminStepping(ws: Workspace): NewtonRun {
  let factor = 10;
  return continuation(ws, GMIN_BUDGET, { gshunt: GMIN_STEP_START, scale: 1 }, (good, ok) => {
    if (!good) return null; // not even the most eased circuit converges
    if (!ok) {
      factor = Math.sqrt(factor);
      if (factor < 1.01) return null;
    }
    const lower = good.gshunt / factor;
    return { gshunt: lower < GMIN_STEP_END ? 0 : lower, scale: 1 };
  });
}

/** Source stepping: every source ramps from 0 to 100 % in adaptive increments. */
function sourceStepping(ws: Workspace): NewtonRun {
  let increment = SOURCE_FIRST_STEP;
  return continuation(ws, SOURCE_BUDGET, { gshunt: 0, scale: 0 }, (good, ok) => {
    if (!good) return null;
    if (ok) {
      increment = Math.min(increment * 2, 0.5);
    } else {
      increment /= 4;
      if (increment < SOURCE_MIN_STEP) return null;
    }
    return { gshunt: 0, scale: Math.min(1, good.scale + increment) };
  });
}

export function solveCircuit(input: SimInput): SimResult {
  return solveSettled(input, undefined, input.time ?? 0).result;
}

/** Which convergence aid a solve needed (and the next warm-started one should go to). */
export type AidHint = 'gmin' | 'source';

/**
 * Where the previous solve of the same netlist ended (plain data): the
 * starting point of the next one (a warm start).
 * - `shape` identifies the layout of the unknowns: the nets by component id
 *   and pin, the internal nodes and the parts in order. A warm start whose
 *   shape differs from the circuit being solved (a wire or part was added,
 *   removed or changed kind) is ignored: that solve starts from zero.
 * - `x`: every unknown (node voltages, then source branch currents).
 * - `devices`: the junction voltages the diodes, BJTs and MOSFETs were
 *   linearized at (deviceState()).
 * - `aid`: set when that solve needed gmin or source stepping. See solveWith().
 */
export interface WarmStart {
  shape: string;
  x: number[];
  devices: number[];
  aid?: AidHint;
}

/**
 * Newton budget of a warm-started solve before it escalates to the aids.
 * The previous step is close, so a good start converges in a few iterations;
 * one that needs more is better served by the aids than by 200 plain ones.
 */
const WARM_ITERATIONS = 50;

/** The layout signature a WarmStart must match (see WarmStart.shape). */
function shapeOf(input: SimInput, nets: ReturnType<typeof buildNets>, el: Elements, size: number): string {
  let s = `${nets.count}/${el.nodes}/${size}`;
  for (const c of input.components) s += `|${c.id}${c.model.kind}`;
  for (const [key, n] of nets.index) s += `|${key}=${n}`;
  return s;
}

/**
 * One solve: the DC operating point without `step`, else one time step
 * ending at `time`. `stored` is the state of every capacitor and inductor
 * at the solution (null when Newton's method did not converge), `warm` where
 * it ended (null when not converged), to pass to the next solve.
 *
 * Without a usable `warm` (none, or another shape): plain Newton from zero
 * (MAX_ITERATIONS), then gmin stepping, then source stepping (as always).
 * With one, Newton starts from its unknowns and device voltages:
 * - no `aid` hint: plain Newton, at most WARM_ITERATIONS, then the aids
 *   (each from zero, as above) if it fails;
 * - `aid` hint (the last solve needed an aid): the 200 plain iterations that
 *   failed then are skipped. Newton runs from the warm start with the aids'
 *   relaxed test (the warm start plays the part of the continuation's last
 *   eased stage), at most WARM_ITERATIONS, reported as that aid; if it fails,
 *   the hinted aid runs from zero, then the other one.
 * The hint is set whenever an aid gave the answer and cleared as soon as a
 * solve converges by the plain test (a hinted run checks this every time,
 * so no separate re-probe is needed). No convergence: no warm start at all.
 */
export function solveWith(
  rawInput: SimInput, step: Companion | undefined, time: number, warm?: WarmStart,
  logic?: Readonly<LogicState>,
): { result: SimResult; stored: Record<number, ReactiveState> | null; warm: WarmStart | null } {
  // Function generators are time-dependent sources: fix their value for this solve.
  // A relay becomes its coil (an inductor) and two contact switches set by the logic state (relay.ts).
  const supplied = expandSupplies(resolveSignals(rawInput, time));
  const expanded = expandRelays(supplied.input, logic);
  const motored = expandMotors(expanded.input, logic);
  // An incandescent bulb becomes a resistor at its filament's present temperature (bulb.ts).
  const lit = expandBulbs(motored.input, logic);
  // A bridge rectifier becomes four diodes, a changeover switch two switches (mainsparts.ts).
  const mains = expandMains(lit.input);
  const out = solveCore(mains.input, step, time, warm, logic);
  if (mains.parts.length > 0) mainsResults(out.result, mains.parts, logic);
  bulbResults(out.result, rawInput, logic);
  if (motored.motors.length > 0) motorResults(out.result, motored.motors);
  if (expanded.relays.length > 0) relayResults(out.result, expanded.relays);
  if (supplied.supplies.length > 0) supplyResults(out.result, supplied.supplies);
  return out;
}

function solveCore(
  input: SimInput, step: Companion | undefined, time: number, warm?: WarmStart,
  logic?: Readonly<LogicState>,
): { result: SimResult; stored: Record<number, ReactiveState> | null; warm: WarmStart | null } {
  const nets = buildNets(input);
  const result: SimResult = {
    time,
    converged: true,
    iterations: 0,
    reference: nets.reference,
    connectedNets: nets.connected,
    nets: Object.fromEntries(nets.index),
    voltages: new Array<number>(nets.count).fill(0),
    parts: {},
  };
  const netOf = (part: number, pin: string): number => nets.index.get(`${part}:${pin}`) ?? 0;
  const el = buildElements(input, netOf, nets.count, step, logic);
  const size = Math.max(0, el.nodes - 1) + el.sources.length;

  let x: Float64Array = new Float64Array(size);
  const volt = (n: number): number => (n > 0 ? x[n - 1] : 0);
  const nonlinear = el.diodes.length + el.bjts.length + el.mosfets.length > 0;

  const shape = shapeOf(input, nets, el, size);
  const devices = el.diodes.length + 2 * (el.bjts.length + el.mosfets.length);
  const start = warm && warm.shape === shape && warm.x.length === size && warm.devices.length === devices ? warm : null;
  let aidUsed: AidHint | undefined;
  if (size > 0) {
    const ws = new Workspace(el, size);
    let run: NewtonRun;
    let order: readonly AidHint[] = ['gmin', 'source'];
    if (start) {
      x = Float64Array.from(start.x);
      setDeviceState(el, start.devices);
      const hint = nonlinear ? start.aid : undefined;
      run = newton(ws, x, PLAIN, WARM_ITERATIONS, hint !== undefined);
      result.method = 'newton';
      if (hint) {
        // Settled by the plain test: the aid is no longer needed (the hint is cleared).
        if (!(run.converged && run.strict)) {
          aidUsed = hint;
          result.method = hint;
        }
        order = hint === 'gmin' ? ['gmin', 'source'] : ['source', 'gmin'];
      }
    } else {
      // Plain Newton first, exactly as without the aids; they run only when it fails.
      run = newton(ws, x, PLAIN, MAX_ITERATIONS);
      result.method = 'newton';
    }
    let iterations = run.iterations;
    if (!run.converged && nonlinear) {
      for (const method of order) {
        run = method === 'gmin' ? gminStepping(ws) : sourceStepping(ws);
        iterations += run.iterations;
        result.method = method;
        aidUsed = method;
        if (run.converged) break;
      }
    }
    result.converged = run.converged;
    result.iterations = iterations;
    // No trustworthy answer: report zeros.
    x = run.converged ? run.x : new Float64Array(size);
  }
  const next: WarmStart | null = result.converged
    ? { shape, x: Array.from(x), devices: deviceState(el), ...(aidUsed ? { aid: aidUsed } : {}) }
    : null;

  for (let n = 1; n < nets.count; n++) result.voltages[n] = volt(n);
  collectResults(input, el, volt, x, result);
  collectBoards(input, el, netOf, volt, x, result);
  let stored: Record<number, ReactiveState> | null = null;
  if (result.converged) {
    stored = {};
    for (const r of el.reactives) {
      const v = volt(r.inner) - volt(r.b);
      // In DC an ideal inductor has 0 V across it (the 1 mOhm is only there to keep the matrix regular).
      stored[r.part] = { volts: !step && r.kind === 'inductor' ? 0 : v, amps: r.g * v + r.ieq };
    }
    for (const c of el.coupled) {
      const v1 = volt(c.inner1) - volt(c.b1);
      const v2 = volt(c.inner2) - volt(c.b2);
      stored[c.part] = { volts: step ? v1 : 0, amps: c.g11 * v1 + c.g12 * v2 + c.ieq1 };
      stored[secondaryId(c.part)] = { volts: step ? v2 : 0, amps: c.g12 * v1 + c.g22 * v2 + c.ieq2 };
    }
  }
  return { result, stored, warm: next };
}

/** Logic state of one part with one: a half-bridge driver (driver.ts) or a logic gate (gates.ts). */
export type PartLogic = DriverLogic | GateLogic | RelayLogic | MotorLogic | TimerLogic | OpampLogic | BulbLogic | LedBulbLogic | BridgeLogic;

/** Logic state of every logic part by component id (kept in TransientState.logic). */
export type LogicState = Record<number, PartLogic>;

/**
 * How solveSettled treats one logic part: its starting state from the stored
 * one (`initial`, ignoring a state of another kind), the decision from pin
 * voltages with hysteresis against the accepted state, equality, and the
 * state to take when the rounds run out (`fallback`, from the state of the
 * last round, the one decided from it and the one decided in round 1).
 */
interface LogicRule {
  id: number;
  gate: boolean;
  /** Decide against the state of the current round (a latch keeps what it just took) instead of the last accepted one. */
  current?: boolean;
  initial(stored: unknown): PartLogic;
  decide(prev: PartLogic, volts: (pin: string) => number, result: SimResult, dt: number): PartLogic;
  same(a: PartLogic, b: PartLogic): boolean;
  fallback(last: PartLogic, next: PartLogic, first: PartLogic): PartLogic;
}

function logicRules(input: SimInput): LogicRule[] {
  const rules: LogicRule[] = [];
  for (const { id, model: m } of input.components) {
    if (m.kind === 'halfdriver') {
      rules.push({
        id, gate: false,
        initial: (s) => (isDriverLogic(s) ? s : DEFAULT_LOGIC),
        decide: (p, v) => decideLogic(p as DriverLogic, sensePins(v)),
        same: (a, b) => sameLogic(a as DriverLogic, b as DriverLogic),
        // Flags that kept flipping end up off (outputs low): the safe side.
        fallback: (last, next) => commonLogic(last as DriverLogic, next as DriverLogic),
      });
    } else if (m.kind === 'motor') {
      // The shaft speed follows the armature current (implicit step); the rounds repeat until it stops changing.
      rules.push({
        id, gate: false,
        initial: (s) => (isMotorLogic(s) ? s : DEFAULT_MOTOR_LOGIC),
        decide: (p, _v, r, dt) => decideMotor(p as MotorLogic, r.parts[id]?.current ?? 0, dt, m),
        same: (a, b) => sameMotor(a as MotorLogic, b as MotorLogic),
        fallback: (_last, next) => next,
      });
    } else if (m.kind === 'bulb') {
      // The filament temperature follows the power it receives (implicit step); the rounds repeat until it settles.
      rules.push({
        id, gate: false,
        initial: (s) => (isBulbLogic(s) ? s : DEFAULT_BULB_LOGIC),
        decide: (p, _v, r, dt) => decideBulb(p as BulbLogic, r.parts[id]?.power ?? 0, dt, m),
        same: (a, b) => sameBulb(a as BulbLogic, b as BulbLogic),
        fallback: (_last, next) => next,
      });
    } else if (m.kind === 'ledbulb') {
      // The average power the light follows (a first-order average of the instantaneous power).
      rules.push({
        id, gate: false,
        initial: (s) => (isLedBulbLogic(s) ? s : DEFAULT_LEDBULB_LOGIC),
        decide: (p, _v, r, dt) => decideLedBulb(p as LedBulbLogic, r.parts[id]?.power ?? 0, dt),
        same: (a, b) => sameLedBulb(a as LedBulbLogic, b as LedBulbLogic),
        fallback: (_last, next) => next,
      });
    } else if (m.kind === 'bridge') {
      // The average output current its heating follows (a first-order average; a static solve takes the present value).
      rules.push({
        id, gate: false,
        initial: (s) => (isBridgeLogic(s) ? s : DEFAULT_BRIDGE_LOGIC),
        decide: (p, _v, r, dt) => decideBridge(p as BridgeLogic, r.parts[id]?.current ?? 0, dt),
        same: (a, b) => sameBridge(a as BridgeLogic, b as BridgeLogic),
        fallback: (_last, next) => next,
      });
    } else if (m.kind === 'relay') {
      // The armature follows the coil current with hysteresis; a relay never oscillates by itself, so no special fallback.
      rules.push({
        id, gate: false,
        initial: (s) => (isRelayLogic(s) ? s : DEFAULT_RELAY_LOGIC),
        decide: (p, _v, r) => decideRelay(p as RelayLogic, r.parts[id]?.current ?? 0, m),
        same: (a, b) => (a as RelayLogic).on === (b as RelayLogic).on,
        fallback: (_last, next) => next,
      });
    } else if (m.kind === 'timer555') {
      // The latch decides against its current round's state (see timer555.ts), so a flip does not flip back inside one step.
      rules.push({
        id, gate: false, current: true,
        initial: (s) => (isTimerLogic(s) ? s : DEFAULT_TIMER_LOGIC),
        decide: (p, v) => decideTimer(p as TimerLogic, (pin) => v(pin)),
        same: (a, b) => sameTimer(a as TimerLogic, b as TimerLogic),
        fallback: (_last, next) => next,
      });
    } else if (m.kind === 'opamp') {
      // The modes follow from the solution alone (no memory), so the rounds settle by themselves.
      rules.push({
        id, gate: false, current: true,
        initial: (s) => (isOpampLogic(s) ? s : DEFAULT_OPAMP_LOGIC),
        decide: (_p, v) => decideOpamp((pin) => v(pin)),
        same: (a, b) => sameOpamp(a as OpampLogic, b as OpampLogic),
        fallback: (_last, next) => next,
      });
    } else if (m.kind === 'gate') {
      const same = (a: PartLogic, b: PartLogic): boolean => sameGate(a as GateLogic, b as GateLogic);
      rules.push({
        id, gate: true,
        initial: (s) => (isGateLogic(s) ? s : DEFAULT_GATE_LOGIC),
        decide: (p, v) => decideGate(p as GateLogic, v('a'), v('b'), m.vcc, m.inputs),
        same,
        // A gate with no stable state (a loop that inverts itself) takes its
        // round-1 decision: it flips once per call, i.e. once per time step.
        fallback: (last, next, first) => (same(last, next) ? next : first),
      });
    }
  }
  return rules;
}

/** Extra rounds per gate on top of MAX_LOGIC_ROUNDS (a chain of n gates needs up to n rounds). */
const ROUNDS_PER_GATE = 1;

/**
 * solveWith plus the fixed point over the logic parts' states (half-bridge
 * drivers, driver.ts; logic gates, gates.ts): starts from `prev` (the last
 * accepted state; everything low/off for a part without one), re-decides
 * every part's logic from the solution with hysteresis against `prev`, and
 * solves again (warm-started from the round before) until nothing changes,
 * at most MAX_LOGIC_ROUNDS + ROUNDS_PER_GATE x (gates) solves plus one.
 * All parts update together each round; once a gate goes back to a state it
 * already had in this call (a feedback loop swinging, e.g. a NOR latch
 * starting from both outputs high) only the first changed gate (component
 * order) updates per round, which breaks the symmetry deterministically.
 * When the rounds run out each part takes its rule's fallback (drivers: the
 * flags common to the last two rounds; gates: see logicRules) and that state
 * is solved once more. Without logic parts this is exactly one solveWith
 * call; with drivers only it is the driver's original loop. `logic` is the
 * state the returned result was solved with (`prev`'s when it did not
 * converge); result.iterations counts every round.
 */
export function solveSettled(
  input: SimInput, step: Companion | undefined, time: number, warm?: WarmStart, prev: Readonly<LogicState> = {},
): ReturnType<typeof solveWith> & { logic: LogicState } {
  const rules = logicRules(input);
  if (rules.length === 0) return { ...solveWith(input, step, time, warm), logic: {} };
  const maxRounds = MAX_LOGIC_ROUNDS + ROUNDS_PER_GATE * rules.filter((p) => p.gate).length;
  const prevOf = (p: LogicRule): PartLogic => p.initial(prev[p.id]);
  let logic: LogicState = Object.fromEntries(rules.map((p) => [p.id, prevOf(p)]));
  const tried = new Map(rules.filter((p) => p.gate).map((p) => [p.id, [logic[p.id]]]));
  let first: LogicState | null = null;
  let serial = false;
  let out = solveWith(input, step, time, warm, logic);
  let iterations = out.result.iterations;
  for (let round = 1; out.result.converged; round++) {
    const r = out.result;
    const next: LogicState = {};
    const changed: LogicRule[] = [];
    for (const p of rules) {
      next[p.id] = p.decide(p.current ? logic[p.id] : prevOf(p), (pin) => r.voltages[r.nets[`${p.id}:${pin}`] ?? 0] ?? 0, r, step?.dt ?? 0);
      if (!p.same(next[p.id], logic[p.id])) changed.push(p);
    }
    first ??= { ...next };
    if (changed.length === 0) break;
    for (const p of changed) {
      const seen = tried.get(p.id);
      if (!seen) continue;
      if (seen.some((s) => p.same(s, next[p.id]))) serial = true;
      seen.push(next[p.id]);
    }
    if (serial) {
      // Only the first changed gate moves this round (drivers always do).
      let moved = false;
      for (const p of changed) {
        if (!p.gate) continue;
        if (moved) next[p.id] = logic[p.id];
        moved = true;
      }
    }
    if (round >= maxRounds) {
      for (const p of rules) next[p.id] = p.fallback(logic[p.id], next[p.id], first[p.id]);
    }
    logic = next;
    out = solveWith(input, step, time, out.warm ?? warm, logic);
    iterations += out.result.iterations;
    if (round >= maxRounds) break;
  }
  out.result.iterations = iterations;
  return { ...out, logic: out.result.converged ? logic : Object.fromEntries(rules.map((p) => [p.id, prevOf(p)])) };
}

function collectResults(
  input: SimInput, el: Elements, volt: (n: number) => number, x: Float64Array, result: SimResult,
): void {
  const parts = result.parts;
  for (const c of input.components) parts[c.id] = { voltage: 0, current: 0, power: 0, pins: {} };
  const addPin = (p: PartResult, pin: string, amps: number): void => {
    p.pins[pin] = (p.pins[pin] ?? 0) + amps;
  };
  if (!result.converged) return;

  for (const r of el.resistors) {
    const p = parts[r.part];
    if (!p) continue; // a diode's series resistance
    const v = volt(r.a) - volt(r.b);
    const i = v * r.g;
    addPin(p, r.pinA, i);
    addPin(p, r.pinB, -i);
    p.power += v * i;
    if (r.pinA === 'a') {
      // First (or only) section of the part: a pot reports a -> wiper current and a - b voltage.
      p.current = i;
      p.voltage = v;
    } else {
      p.voltage += v;
    }
  }
  for (const s of el.sources) {
    if (s.pin !== undefined) continue; // a board rail: reported per board
    const into = x[s.branch];
    const v = volt(s.pos) - volt(s.neg);
    parts[s.part] = { voltage: v, current: -into, power: -into * v, pins: { pos: into, neg: -into } };
  }
  const multi = new Set<number>(); // parts with a diode element reported already (a 7-segment display's LEDs add up)
  for (const d of el.diodes) {
    const vj = volt(d.inner) - volt(d.cathode);
    const i = diodeCurrent(d, vj).i + GMIN * vj;
    const v = volt(d.anode) - volt(d.cathode);
    const [pa, pk] = d.pins ?? ['anode', 'cathode'];
    const p = parts[d.part];
    if (!multi.has(d.part) || !p) {
      multi.add(d.part);
      parts[d.part] = { voltage: v, current: i, power: v * i, pins: { [pa]: i, [pk]: -i } };
    } else {
      addPin(p, pa, i);
      addPin(p, pk, -i);
      p.current += i;
      p.power += v * i;
      p.voltage = Math.max(p.voltage, v);
    }
  }
  for (const q of el.bjts) if (q.part >= 0) parts[q.part] = bjtResult(q, volt);
  for (const q of el.mosfets) if (q.part >= 0) parts[q.part] = mosfetResult(q, volt);
  for (const q of el.igbts) parts[q.part] = igbtResult(q, volt);
  for (const d of el.drivers) parts[d.part] = driverResult(d, volt);
  for (const g of el.gates) parts[g.part] = gateResult(g, volt);
  for (const t of el.timers) parts[t.part] = timerResult(t, volt);
  for (const o of el.opamps) parts[o.part] = opampResult(o, volt);
  for (const r of el.reactives) {
    const i = r.g * (volt(r.inner) - volt(r.b)) + r.ieq;
    const v = volt(r.a) - volt(r.b);
    parts[r.part] = { voltage: v, current: i, power: v * i, pins: { [r.pins[0]]: i, [r.pins[1]]: -i } };
  }
  for (const c of el.coupled) {
    const v1 = volt(c.inner1) - volt(c.b1);
    const v2 = volt(c.inner2) - volt(c.b2);
    const i1 = c.g11 * v1 + c.g12 * v2 + c.ieq1;
    const i2 = c.g12 * v1 + c.g22 * v2 + c.ieq2;
    parts[c.part] = transformerResult(c.model, volt(c.a1) - volt(c.b1), volt(c.a2) - volt(c.b2), i1, i2);
  }
}

/**
 * An IGBT's result from its MOSFET and bipolar halves: voltage Vce, current
 * the collector current into the part (negative for a conducting P-IGBT),
 * pins g, c, e; volts holds every pin against the emitter plus `base`, the
 * internal node (the MOSFET's drain), for the part inspector.
 */
function igbtResult(q: Igbt, volt: (n: number) => number): PartResult {
  const m = mosfetResult(q.mos, volt);
  const b = bjtResult(q.bjt, volt);
  const ig = m.pins.g;
  const ic = b.pins.e; // into the bipolar emitter = into the IGBT collector (rc is in series)
  const ve = volt(q.e);
  const vce = volt(q.c) - ve;
  const vge = volt(q.g) - ve;
  return {
    voltage: vce,
    current: ic,
    power: vce * ic + vge * ig,
    pins: { g: ig, c: ic, e: -(ic + ig) },
    volts: { g: vge, c: vce, e: 0, base: volt(q.base) - ve },
  };
}

/** Per board: volts and current at every pin, and what it delivers to the circuit. */
function collectBoards(
  input: SimInput, el: Elements, netOf: (part: number, pin: string) => number,
  volt: (n: number) => number, x: Float64Array, result: SimResult,
): void {
  for (const { id, model: m } of input.components) {
    if (m.kind !== 'board') continue;
    const volts: Record<string, number> = {};
    const p = result.parts[id];
    p.volts = volts;
    if (!result.converged) continue;
    const gnd = volt(netOf(id, 'gnd'));
    const pinVolts = (pin: string): number => volt(netOf(id, pin)) - gnd;
    let delivered = 0;
    let power = 0;
    const add = (pin: string, into: number): void => {
      const v = pinVolts(pin);
      p.pins[pin] = into;
      volts[pin] = v;
      delivered -= into;
      power -= into * v;
    };
    for (const s of el.sources) {
      if (s.part === id && s.pin !== undefined) add(s.pin, x[s.branch]);
    }
    for (const [pin, d] of Object.entries(m.io)) {
      add(pin, (pinVolts(pin) - d.volts) / Math.max(d.ohms, 1e-3));
    }
    p.pins.gnd = delivered;
    volts.gnd = 0;
    p.current = delivered;
    p.power = power;
    p.voltage = Math.max(0, ...Object.values(m.rails)); // the main supply
  }
}
