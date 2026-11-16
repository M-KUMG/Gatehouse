// The whole interface between the editor and the simulator. Everything here
// is plain serializable data (no classes, no DOM), so the solver can later
// move into a Web Worker and be extended with digital parts (MCU pins).

/** One pin of one component, e.g. { part: 3, pin: 'anode' }. */
export interface Terminal {
  part: number;
  pin: string;
}

/**
 * Electrical model of one component. The pin names each model uses are
 * listed in MODEL_PINS (nets.ts).
 */
export type ComponentModel =
  /** EMF in series with an internal resistance. Pins: pos, neg. */
  | { kind: 'battery'; volts: number; rInternal: number }
  /** Pins: a, b. */
  | { kind: 'resistor'; ohms: number }
  /** Tiny resistance when closed, huge when open. Pins: a, b. */
  | { kind: 'switch'; closed: boolean }
  /** Track of `ohms` between a and b; the wiper w sits at `position` (0 = at a, 1 = at b). */
  | { kind: 'pot'; ohms: number; position: number }
  /** Shockley diode with series resistance. Pins: anode, cathode. */
  | { kind: 'diode'; is: number; n: number; rs: number }
  /** Ebers-Moll NPN transistor. Pins: c, b, e. */
  | { kind: 'npn'; is: number; bf: number; br: number }
  /** Reference node (0 V). Pin: gnd. */
  | { kind: 'ground' }
  /** Conducts nothing (e.g. a burned-out part). No pins of its own. */
  | { kind: 'open' };

export interface SimComponent {
  id: number;
  model: ComponentModel;
}

export interface SimInput {
  components: SimComponent[];
  /** Pairs of terminals joined by an ideal conductor (wires, internal links). */
  links: [Terminal, Terminal][];
}

/** Which node is 0 V. */
export type Reference = 'ground' | 'battery' | 'floating' | 'empty';

export interface PartResult {
  /** Volts across the part (battery: pos - neg, diode: anode - cathode, npn: Vce, others: a - b). */
  voltage: number;
  /** Amps through the part (battery: delivered, npn: collector current, pot: a to wiper). */
  current: number;
  /** Watts dissipated (battery: delivered to the circuit). */
  power: number;
  /** Amps flowing from the circuit into the part at each pin. */
  pins: Record<string, number>;
}

export interface SimResult {
  /** False when Newton's method ran out of iterations or the matrix was singular. */
  converged: boolean;
  iterations: number;
  reference: Reference;
  /** Nets that join two or more pins. */
  connectedNets: number;
  /** Net index of every terminal, keyed "part:pin" (see terminalKey). Net 0 is the reference. */
  nets: Record<string, number>;
  /** Volts of every net; voltages[0] is 0. */
  voltages: number[];
  /** Per component, keyed by component id. */
  parts: Record<number, PartResult>;
}
