// DC operating point: Modified Nodal Analysis solved with Newton-Raphson.
// Unknowns are the node voltages (all nets but the reference, plus internal
// device nodes) followed by one branch current per voltage source.
// Pure and deterministic: same input, same output; no clock, no randomness.

import {
  GMIN, POT_END_OHMS, SWITCH_CLOSED_OHMS, SWITCH_OPEN_OHMS, VT,
  criticalVoltage, junction, limitJunction,
} from './devices';
import { solveLinear } from './linear';
import { buildNets } from './nets';
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
interface Npn {
  part: number; c: number; b: number; e: number;
  is: number; bf: number; br: number; vCrit: number;
  vbe: number; vbc: number;
}

interface Elements {
  resistors: Resistor[];
  sources: Source[];
  diodes: Diode[];
  npns: Npn[];
  drives: Drive[];
  nodes: number; // including the reference and internal nodes
}

function buildElements(input: SimInput, netOf: (part: number, pin: string) => number, netCount: number): Elements {
  const el: Elements = {
    resistors: [], sources: [], diodes: [], npns: [], drives: [], nodes: netCount,
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
        el.npns.push({
          part: id, c: netOf(id, 'c'), b: netOf(id, 'b'), e: netOf(id, 'e'),
          is: m.is, bf: m.bf, br: m.br, vCrit: criticalVoltage(m.is, VT), vbe: 0, vbc: 0,
        });
        break;
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
        break;
    }
  }
  el.sources.forEach((s, i) => (s.branch = el.nodes - 1 + i));
  return el;
}

/** Terminal currents of an NPN (Ebers-Moll, transport form) and their derivatives. */
function npnCurrents(q: Npn, vbe: number, vbc: number) {
  const f = junction(vbe, q.is, VT);
  const r = junction(vbc, q.is, VT);
  return {
    ic: f.i - r.i * (1 + 1 / q.br),
    ib: f.i / q.bf + r.i / q.br,
    gf: f.g,
    gr: r.g,
  };
}

/** One linearized system at the devices' current operating points. */
function assemble(el: Elements, size: number): { a: Float64Array[]; z: Float64Array } {
  const a: Float64Array[] = [];
  for (let i = 0; i < size; i++) a.push(new Float64Array(size));
  const z = new Float64Array(size);

  /** Conductance g between two nodes. */
  const addG = (n1: number, n2: number, g: number): void => {
    if (n1 > 0) a[n1 - 1][n1 - 1] += g;
    if (n2 > 0) a[n2 - 1][n2 - 1] += g;
    if (n1 > 0 && n2 > 0) {
      a[n1 - 1][n2 - 1] -= g;
      a[n2 - 1][n1 - 1] -= g;
    }
  };
  /** Constant current i flowing from one node to the other through the element. */
  const addI = (from: number, to: number, i: number): void => {
    if (from > 0) z[from - 1] -= i;
    if (to > 0) z[to - 1] += i;
  };
  /** Current g * (v[cp] - v[cm]) flowing from one node to the other. */
  const addGm = (from: number, to: number, cp: number, cm: number, g: number): void => {
    if (from > 0) {
      if (cp > 0) a[from - 1][cp - 1] += g;
      if (cm > 0) a[from - 1][cm - 1] -= g;
    }
    if (to > 0) {
      if (cp > 0) a[to - 1][cp - 1] -= g;
      if (cm > 0) a[to - 1][cm - 1] += g;
    }
  };

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

  for (const q of el.npns) {
    const { ic, ib, gf, gr } = npnCurrents(q, q.vbe, q.vbc);
    const gcr = gr * (1 + 1 / q.br);
    // Collector current flows c -> e, base current b -> e.
    addGm(q.c, q.e, q.b, q.e, gf);
    addGm(q.c, q.e, q.b, q.c, -gcr);
    addI(q.c, q.e, ic - gf * q.vbe + gcr * q.vbc);
    addGm(q.b, q.e, q.b, q.e, gf / q.bf);
    addGm(q.b, q.e, q.b, q.c, gr / q.br);
    addI(q.b, q.e, ib - (gf / q.bf) * q.vbe - (gr / q.br) * q.vbc);
    addG(q.b, q.e, GMIN);
    addG(q.b, q.c, GMIN);
  }
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
  const nonlinear = el.diodes.length + el.npns.length > 0;

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
      for (const q of el.npns) {
        q.vbe = step(volt(q.b) - volt(q.e), q.vbe, VT, q.vCrit);
        q.vbc = step(volt(q.b) - volt(q.c), q.vbc, VT, q.vCrit);
      }
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
  for (const q of el.npns) {
    const vbe = volt(q.b) - volt(q.e);
    const vbc = volt(q.b) - volt(q.c);
    const m = npnCurrents(q, vbe, vbc);
    const ic = m.ic - GMIN * vbc;
    const ib = m.ib + GMIN * (vbe + vbc);
    const vce = volt(q.c) - volt(q.e);
    parts[q.part] = { voltage: vce, current: ic, power: vce * ic + vbe * ib, pins: { c: ic, b: ib, e: -(ic + ib) } };
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
