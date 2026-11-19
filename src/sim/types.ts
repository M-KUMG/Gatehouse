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
  /** Ebers-Moll PNP transistor: an NPN with every junction voltage and current reversed. Pins: c, b, e. */
  | { kind: 'pnp'; is: number; bf: number; br: number }
  /**
   * Level-1 (square-law) enhancement MOSFET. polarity 1 is N-channel, -1 is
   * P-channel (then vth is negative). kp in A/V^2. Pins: g, d, s.
   */
  | { kind: 'mosfet'; polarity: 1 | -1; vth: number; kp: number; lambda: number }
  /**
   * Capacitor of `farads` with an optional equivalent series resistance
   * (ohms, default 0). The DC solve sees it as open; the transient solver
   * (transient.ts) integrates it. Pins: a, b.
   */
  | { kind: 'capacitor'; farads: number; esr?: number }
  /**
   * Inductor of `henries` with an optional winding resistance (ohms,
   * default 0). The DC solve sees it as a near short (1 mOhm); the
   * transient solver integrates it. Pins: a, b.
   */
  | { kind: 'inductor'; henries: number; dcr?: number }
  /** Reference node (0 V). Pin: gnd. */
  | { kind: 'ground' }
  /** Conducts nothing (e.g. a burned-out part). No pins of its own. */
  | { kind: 'open' }
  /** A point where wires meet (a wire junction): no resistance, it only joins nets. Pin: n. */
  | { kind: 'node' }
  /**
   * A microcontroller board. Its `gnd` pin is a reference like a ground
   * part (a USB-powered board shares the computer's ground). Each rail pin
   * is a stiff supply against gnd; each io pin is driven as set by the
   * mixed-signal bridge (src/mcu/mixedsignal.ts). Pins: gnd, rails, io.
   */
  | { kind: 'board'; rails: Record<string, number>; io: Record<string, PinDrive> };

/**
 * How a microcontroller pin acts on the circuit: a Thevenin source of
 * `volts` behind `ohms` to the board's gnd (outputs, pull-ups, and a very
 * large resistance for a high-impedance input).
 */
export interface PinDrive {
  volts: number;
  ohms: number;
}

export interface SimComponent {
  id: number;
  model: ComponentModel;
}

export interface SimInput {
  components: SimComponent[];
  /** Pairs of terminals joined by an ideal conductor (wires, internal links). */
  links: [Terminal, Terminal][];
  /**
   * Simulated time in seconds this solve belongs to (default 0), echoed in
   * SimResult.time by the DC solve. `solveStep` (transient.ts) ignores it:
   * there the time comes from the TransientState plus the step.
   */
  time?: number;
}

/** Which node is 0 V. */
export type Reference = 'ground' | 'battery' | 'floating' | 'empty';

export interface PartResult {
  /** Volts across the part (battery: pos - neg, diode: anode - cathode, npn/pnp: Vce, mosfet: Vds, others: a - b). */
  voltage: number;
  /** Amps through the part (battery: delivered, npn/pnp: into the collector, mosfet: into the drain, pot: a to wiper). */
  current: number;
  /** Watts dissipated (battery: delivered to the circuit). */
  power: number;
  /** Amps flowing from the circuit into the part at each pin. */
  pins: Record<string, number>;
  /** Volts of each pin: boards against the board's gnd, MOSFETs against the source. */
  volts?: Record<string, number>;
}

export interface SimResult {
  /** Simulated time of the solve in seconds (SimInput.time). */
  time: number;
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
