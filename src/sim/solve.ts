// DC operating point: Modified Nodal Analysis solved with Newton-Raphson.
// Unknowns are the node voltages (all nets but the reference, plus internal
// device nodes) followed by one branch current per voltage source.
// Pure and deterministic: same input, same output; no clock, no randomness.
// Capacitors are open and inductors near shorts here; with a `Companion`
// (one time step, see transient.ts) they become their companion models and
// the same Newton loop (convergence aids included) solves the step.

import { bjtResult, makeBjt, stampBjt, updateBjt, type Bjt } from './bjt';
import {
  GMIN, POT_END_OHMS, SWITCH_CLOSED_OHMS, SWITCH_OPEN_OHMS, VT,
  criticalVoltage, junction, limitJunction,
} from './devices';
import { solveLinear } from './linear';
import { makeMosfet, mosfetResult, stampMosfet, updateMosfet, type Mosfet } from './mosfet';
import { buildNets } from './nets';
import { companionOf, stampReactive, type Companion, type Reactive, type ReactiveState } from './reactive';
import { stampInto } from './stamp';
import type { PartResult, SimInput, SimResult } from './types';

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
interface Diode {
  part: number; anode: number; cathode: number;
  /** Node between the series resistance and the junction (the anode itself when rs is 0). */
  inner: number;
  is: number; nvt: number; vCrit: number;
  v: number; // junction voltage the model is linearized at
}
interface Elements {
  resistors: Resistor[];
  sources: Source[];
  diodes: Diode[];
  bjts: Bjt[];
  mosfets: Mosfet[];
  reactives: (Reactive & { kind: 'capacitor' | 'inductor' })[];
  drives: Drive[];
  nodes: number; // including the reference and internal nodes
}

function buildElements(
  input: SimInput, netOf: (part: number, pin: string) => number, netCount: number, step: Companion | undefined,
): Elements {
  const el: Elements = {
    resistors: [], sources: [], diodes: [], bjts: [], mosfets: [], reactives: [], drives: [], nodes: netCount,
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
          is: m.is, nvt, vCrit: criticalVoltage(m.is, nvt), v: 0,
        });
        if (m.rs > 0) el.resistors.push({ part: -1, a: anode, b: inner, g: 1 / m.rs, pinA: '', pinB: '' });
        break;
      }
      case 'npn':
      case 'pnp': {
        const nodes = { c: netOf(id, 'c'), b: netOf(id, 'b'), e: netOf(id, 'e') };
        el.bjts.push(makeBjt(id, nodes, m.kind === 'npn' ? 1 : -1, m.is, m.bf, m.br));
        break;
      }
      case 'mosfet': {
        const nodes = { d: netOf(id, 'd'), g: netOf(id, 'g'), s: netOf(id, 's') };
        el.mosfets.push(makeMosfet(id, nodes, m.polarity, m.vth, m.kp, m.lambda));
        break;
      }
      case 'capacitor':
      case 'inductor': {
        const a = netOf(id, 'a');
        const series = (m.kind === 'capacitor' ? m.esr : m.dcr) ?? 0;
        const inner = series > 0 ? el.nodes++ : a;
        if (series > 0) el.resistors.push({ part: -1, a, b: inner, g: 1 / series, pinA: '', pinB: '' });
        el.reactives.push({
          kind: m.kind, part: id, a, b: netOf(id, 'b'), inner, ...companionOf(m, step, step?.stored[id]),
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

/** One linearized system at the devices' current operating points. */
function assemble(el: Elements, size: number, ease: Easing): { a: Float64Array[]; z: Float64Array } {
  const a: Float64Array[] = [];
  for (let i = 0; i < size; i++) a.push(new Float64Array(size));
  const z = new Float64Array(size);

  const stamp = stampInto(a, z);
  const { addG, addI } = stamp;
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

  for (const d of el.diodes) {
    const { i, g } = junction(d.v, d.is, d.nvt);
    addG(d.inner, d.cathode, g + GMIN);
    addI(d.inner, d.cathode, i - g * d.v);
  }

  for (const q of el.bjts) stampBjt(q, stamp);
  for (const q of el.mosfets) stampMosfet(q, stamp);
  for (const r of el.reactives) stampReactive(scale === 1 ? r : { ...r, ieq: r.ieq * scale }, stamp);
  return { a, z };
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

interface NewtonRun { x: Float64Array; converged: boolean; iterations: number }

/**
 * Newton-Raphson with junction limiting from `x` and the devices' current
 * linearization points (which it moves along), at most `maxIterations` steps.
 *
 * Settled when no unknown moves by more than ABS_TOL + REL_TOL of itself.
 * With `relaxed` (the convergence aids only) an unknown that still moves is
 * accepted too when the step leaves its equation balanced: the residual of
 * its row, (A dx)_i, is within CURRENT_TOL (a node) or ABS_TOL (a source
 * branch) plus REL_TOL of the row's terms. That is a node held only by GMIN
 * and reverse-biased junctions (a floating base): its voltage is pinned by
 * currents of ~1e-14 A and wanders by microvolts from rounding alone, so the
 * plain test can never pass, yet nothing in the circuit depends on it.
 */
function newton(
  el: Elements, size: number, start: Float64Array, ease: Easing, maxIterations: number, relaxed = false,
): NewtonRun {
  let x = start;
  const volt = (n: number): number => (n > 0 ? x[n - 1] : 0);
  const nonlinear = el.diodes.length + el.bjts.length + el.mosfets.length > 0;
  const nodeRows = Math.max(0, el.nodes - 1);
  let iterations = 0;
  for (let iter = 1; iter <= maxIterations; iter++) {
    const { a, z } = assemble(el, size, ease);
    const rows = relaxed ? a.map((row) => row.slice()) : null; // solveLinear overwrites `a`
    const next = solveLinear(a, z);
    if (!next) break;
    let settled = true;
    if (nonlinear) {
      for (let i = 0; i < size && settled; i++) {
        if (Math.abs(next[i] - x[i]) <= ABS_TOL + REL_TOL * Math.abs(next[i])) continue;
        if (!rows) {
          settled = false;
          break;
        }
        let residual = 0;
        let scale = 0;
        const row = rows[i];
        for (let j = 0; j < size; j++) {
          residual += row[j] * (next[j] - x[j]);
          scale += Math.abs(row[j] * next[j]);
        }
        if (Math.abs(residual) > (i < nodeRows ? CURRENT_TOL : ABS_TOL) + REL_TOL * scale) settled = false;
      }
    }
    x = next;
    iterations = iter;
    // Move each junction to its new voltage, but never too far up the exponential.
    const step = (raw: number, old: number, nvt: number, vCrit: number): number => {
      const limited = limitJunction(raw, old, nvt, vCrit);
      if (Math.abs(limited - raw) > ABS_TOL) settled = false;
      return limited;
    };
    for (const d of el.diodes) d.v = step(volt(d.inner) - volt(d.cathode), d.v, d.nvt, d.vCrit);
    for (const q of el.bjts) updateBjt(q, volt, (raw, old, vCrit) => step(raw, old, VT, vCrit));
    for (const q of el.mosfets) if (updateMosfet(q, volt, ABS_TOL)) settled = false;
    if (settled) return { x, converged: true, iterations };
  }
  return { x, converged: false, iterations };
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
  el: Elements, size: number, budget: number, first: Easing,
  next: (good: Easing | null, ok: boolean) => Easing | null,
): NewtonRun {
  setDeviceState(el, null);
  let good: { ease: Easing; x: Float64Array; devices: number[] } | null = null;
  let iterations = 0;
  let ease: Easing | null = first;
  while (ease && iterations < budget) {
    const run = newton(el, size, good?.x ?? new Float64Array(size), ease, Math.min(STAGE_ITERATIONS, budget - iterations), true);
    // A singular matrix makes no Newton step at all: count it anyway so the budget bounds the loop.
    iterations += Math.max(1, run.iterations);    if (run.converged) {
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
function gminStepping(el: Elements, size: number): NewtonRun {
  let factor = 10;
  return continuation(el, size, GMIN_BUDGET, { gshunt: GMIN_STEP_START, scale: 1 }, (good, ok) => {
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
function sourceStepping(el: Elements, size: number): NewtonRun {
  let increment = SOURCE_FIRST_STEP;
  return continuation(el, size, SOURCE_BUDGET, { gshunt: 0, scale: 0 }, (good, ok) => {
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
  return solveWith(input, undefined, input.time ?? 0).result;
}

/**
 * One solve: the DC operating point without `step`, else one time step
 * ending at `time`. `stored` is the state of every capacitor and inductor
 * at the solution (null when Newton's method did not converge).
 */
export function solveWith(
  input: SimInput, step: Companion | undefined, time: number,
): { result: SimResult; stored: Record<number, ReactiveState> | null } {
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
  const el = buildElements(input, netOf, nets.count, step);
  const size = Math.max(0, el.nodes - 1) + el.sources.length;

  let x: Float64Array = new Float64Array(size);
  const volt = (n: number): number => (n > 0 ? x[n - 1] : 0);
  const nonlinear = el.diodes.length + el.bjts.length + el.mosfets.length > 0;

  if (size > 0) {
    // Plain Newton first, exactly as without the aids; they run only when it fails.
    let run = newton(el, size, x, PLAIN, MAX_ITERATIONS);
    let iterations = run.iterations;
    result.method = 'newton';
    if (!run.converged && nonlinear) {
      for (const [method, aid] of [['gmin', gminStepping], ['source', sourceStepping]] as const) {
        run = aid(el, size);
        iterations += run.iterations;
        result.method = method;
        if (run.converged) break;
      }
    }
    result.converged = run.converged;
    result.iterations = iterations;
    // No trustworthy answer: report zeros.
    x = run.converged ? run.x : new Float64Array(size);
  }

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
  }
  return { result, stored };
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
  for (const d of el.diodes) {
    const vj = volt(d.inner) - volt(d.cathode);
    const i = junction(vj, d.is, d.nvt).i + GMIN * vj;
    const v = volt(d.anode) - volt(d.cathode);
    parts[d.part] = { voltage: v, current: i, power: v * i, pins: { anode: i, cathode: -i } };
  }
  for (const q of el.bjts) parts[q.part] = bjtResult(q, volt);
  for (const q of el.mosfets) parts[q.part] = mosfetResult(q, volt);
  for (const r of el.reactives) {
    const i = r.g * (volt(r.inner) - volt(r.b)) + r.ieq;
    const v = volt(r.a) - volt(r.b);
    parts[r.part] = { voltage: v, current: i, power: v * i, pins: { a: i, b: -i } };
  }
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
