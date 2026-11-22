// Groups terminals into nets (electrical nodes) with union-find.

import { OPAMP_PINS } from './opamp';
import { TRANSFORMER_PINS } from './transformer';
import { TIMER_PINS } from './timer555';
import type { ComponentModel, Reference, SimInput, Terminal } from './types';

/** Pin names of each fixed-pin model, in a fixed order. */
export const MODEL_PINS: Record<Exclude<ComponentModel['kind'], 'board'>, readonly string[]> = {
  battery: ['pos', 'neg'],
  relay: ['coil1', 'coil2', 'com', 'no', 'nc'],
  motor: ['pos', 'neg'],
  supply: ['pos', 'neg'],
  acsource: ['pos', 'neg'],
  bulb: ['a', 'b'],
  ledbulb: ['a', 'b'],
  bridge: ['ac1', 'ac2', 'pos', 'neg'],
  changeover: ['com', 'no', 'nc'],
  transformer: TRANSFORMER_PINS,
  limiter: ['a', 'b'],
  signal: ['pos', 'neg'],
  resistor: ['a', 'b'],
  switch: ['a', 'b'],
  pot: ['a', 'w', 'b'],
  diode: ['anode', 'cathode'],
  buzzer: ['pos', 'neg'],
  sevenseg: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp', 'com'],
  rgbled: ['r', 'g', 'b', 'com'],
  npn: ['c', 'b', 'e'],
  pnp: ['c', 'b', 'e'],
  mosfet: ['g', 'd', 's'],
  igbt: ['g', 'c', 'e'],
  halfdriver: ['vcc', 'in', 'sd', 'com', 'lo', 'vs', 'ho', 'vb'],
  timer555: TIMER_PINS,
  opamp: OPAMP_PINS,
  gate: ['a', 'b', 'y'], // a 1-input gate: a, y (GATE1_PINS)
  capacitor: ['a', 'b'],
  inductor: ['a', 'b'],
  ground: ['gnd'],
  open: [],
  node: ['n'],
};

/** Pins of a polarized capacitor (an electrolytic), in place of a, b: pos is a, neg is b. */
export const POLARIZED_PINS: readonly string[] = ['pos', 'neg'];

/** Pins of a 1-input logic gate (NOT, BUFFER), in place of a, b, y. */
export const GATE1_PINS: readonly string[] = ['a', 'y'];

/** The one pin of a `node` model (a wire junction). */
export const NODE_PIN = 'n';

/** Pin names of a model, in a fixed order. */
export function modelPins(model: ComponentModel): readonly string[] {
  if (model.kind === 'board') return ['gnd', ...Object.keys(model.rails), ...Object.keys(model.io)];
  if (model.kind === 'capacitor' && model.polarized) return POLARIZED_PINS;
  if (model.kind === 'gate' && model.inputs === 1) return GATE1_PINS;
  return MODEL_PINS[model.kind];
}

/** Models whose `gnd` pin is a 0 V reference. */
function isReference(model: ComponentModel): boolean {
  return model.kind === 'ground' || model.kind === 'board';
}

export function terminalKey(t: Terminal): string {
  return `${t.part}:${t.pin}`;
}

export interface Nets {
  /** Net index per terminal key; 0 is the reference net. */
  index: Map<string, number>;
  count: number;
  reference: Reference;
  /** Nets with two or more terminals. */
  connected: number;
}

export function buildNets(input: SimInput): Nets {
  const ids = new Map<string, number>(); // terminal key -> dense id, in order of first appearance
  const parent: number[] = [];
  const idOf = (t: Terminal): number => {
    const key = terminalKey(t);
    let id = ids.get(key);
    if (id === undefined) {
      id = parent.length;
      ids.set(key, id);
      parent.push(id);
    }
    return id;
  };
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    // The lower id becomes the root, so the result does not depend on link order.
    if (ra < rb) parent[rb] = ra;
    else if (rb < ra) parent[ra] = rb;
  };

  const known = new Set<number>();
  let ground = -1; // a terminal on the reference net
  let reference: Reference = 'empty';
  for (const c of input.components) {
    known.add(c.id);
    for (const pin of modelPins(c.model)) idOf({ part: c.id, pin });
    if (isReference(c.model)) {
      const id = idOf({ part: c.id, pin: 'gnd' });
      if (ground >= 0) union(ground, id);
      else ground = id;
      reference = 'ground';
    }
  }
  for (const [a, b] of input.links) {
    if (known.has(a.part) && known.has(b.part)) union(idOf(a), idOf(b));
  }
  if (ground < 0) {
    const battery = input.components.find((c) => c.model.kind === 'battery');
    if (battery) {
      ground = idOf({ part: battery.id, pin: 'neg' });
      reference = 'battery';
    } else if (parent.length > 0) {
      ground = 0;
      reference = 'floating';
    }
  }

  const netOfRoot = new Map<number, number>();
  const sizes: number[] = [];
  if (ground >= 0) {
    netOfRoot.set(find(ground), 0);
    sizes.push(0);
  }
  const index = new Map<string, number>();
  for (const [key, id] of ids) {
    const root = find(id);
    let net = netOfRoot.get(root);
    if (net === undefined) {
      net = sizes.length;
      netOfRoot.set(root, net);
      sizes.push(0);
    }
    sizes[net]++;
    index.set(key, net);
  }
  return { index, count: sizes.length, reference, connected: sizes.filter((n) => n >= 2).length };
}
