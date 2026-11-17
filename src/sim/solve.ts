// DC operating point: Modified Nodal Analysis solved with Newton-Raphson.
// Unknowns are the node voltages (all nets but the reference, plus internal
// device nodes) followed by one branch current per voltage source.
// Pure and deterministic: same input, same output; no clock, no randomness.

import { bjtResult, makeBjt, stampBjt, updateBjt, type Bjt } from './bjt';
import {
  GMIN, POT_END_OHMS, SWITCH_CLOSED_OHMS, SWITCH_OPEN_OHMS, VT,
  criticalVoltage, junction, limitJunction,
} from './devices';
import { solveLinear } from './linear';
import { makeMosfet, mosfetResult, stampMosfet, updateMosfet, type Mosfet } from './mosfet';
import { buildNets } from './nets';
import { stampInto } from './stamp';
import type { PartResult, SimInput, SimResult } from './types';

const MAX_ITERATIONS = 200;
/** Output resistance of a board's supply rails (USB 5 V, 3.3 V regulator). */
const RAIL_OHMS = 0.05;
const ABS_TOL = 1e-7;
const REL_TOL = 1e-6;

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
  drives: Drive[];
  nodes: number; // including the reference and internal nodes
}

function buildElements(input: SimInput, netOf: (part: number, pin: string) => number, netCount: number): Elements {
  const el: Elements = {
    resistors: [], sources: [], diodes: [], bjts: [], mosfets: [], drives: [], nodes: netCount,
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
function assemble(el: Elements, size: number): { a: Float64Array[]; z: Float64Array } {
  const a: Float64Array[] = [];
  for (let i = 0; i < size; i++) a.push(new Float64Array(size));
  const z = new Float64Array(size);

  const stamp = stampInto(a, z);
  const { addG, addI } = stamp;

  for (let n = 1; n < el.nodes; n++) a[n - 1][n - 1] += GMIN;
  for (const r of el.resistors) addG(r.a, r.b, r.g);
  for (const d of el.drives) {
    addG(d.node, d.ref, d.g);
    addI(d.ref, d.node, d.g * d.volts);
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
    z[k] = s.volts;
  }

  for (const d of el.diodes) {
    const { i, g } = junction(d.v, d.is, d.nvt);
    addG(d.inner, d.cathode, g + GMIN);
    addI(d.inner, d.cathode, i - g * d.v);
  }

  for (const q of el.bjts) stampBjt(q, stamp);
  for (const q of el.mosfets) stampMosfet(q, stamp);
  return { a, z };
}

export function solveCircuit(input: SimInput): SimResult {
  const nets = buildNets(input);
  const result: SimResult = {
    time: input.time ?? 0,
    converged: true,
    iterations: 0,
    reference: nets.reference,
    connectedNets: nets.connected,
    nets: Object.fromEntries(nets.index),
    voltages: new Array<number>(nets.count).fill(0),
    parts: {},
  };
  const netOf = (part: number, pin: string): number => nets.index.get(`${part}:${pin}`) ?? 0;
  const el = buildElements(input, netOf, nets.count);
  const size = Math.max(0, el.nodes - 1) + el.sources.length;

  let x: Float64Array = new Float64Array(size);
  const volt = (n: number): number => (n > 0 ? x[n - 1] : 0);
  const nonlinear = el.diodes.length + el.bjts.length + el.mosfets.length > 0;

  if (size > 0) {
    result.converged = false;
    for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
      const { a, z } = assemble(el, size);
      const next = solveLinear(a, z);
      if (!next) break;
      let settled = true;
      if (nonlinear) {
        for (let i = 0; i < size; i++) {
          if (Math.abs(next[i] - x[i]) > ABS_TOL + REL_TOL * Math.abs(next[i])) settled = false;
        }
      }
      x = next;
      result.iterations = iter;
      // Move each junction to its new voltage, but never too far up the exponential.
      const step = (raw: number, old: number, nvt: number, vCrit: number): number => {
        const limited = limitJunction(raw, old, nvt, vCrit);
        if (Math.abs(limited - raw) > ABS_TOL) settled = false;
        return limited;
      };
      for (const d of el.diodes) d.v = step(volt(d.inner) - volt(d.cathode), d.v, d.nvt, d.vCrit);
      for (const q of el.bjts) updateBjt(q, volt, (raw, old, vCrit) => step(raw, old, VT, vCrit));
      for (const q of el.mosfets) if (updateMosfet(q, volt, ABS_TOL)) settled = false;
      if (settled) {
        result.converged = true;
        break;
      }
    }
    if (!result.converged) x = new Float64Array(size); // no trustworthy answer: report zeros
  }

  for (let n = 1; n < nets.count; n++) result.voltages[n] = volt(n);
  collectResults(input, el, volt, x, result);
  collectBoards(input, el, netOf, volt, x, result);
  return result;
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
