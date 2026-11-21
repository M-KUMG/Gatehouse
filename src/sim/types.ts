// The whole interface between the editor and the simulator. Everything here
// is plain serializable data (no classes, no DOM), so the solver can later
// move into a Web Worker and be extended with digital parts (MCU pins).

import type { GateFn } from './gates';

/** One pin of one component, e.g. { part: 3, pin: 'anode' }. */
export interface Terminal {
  part: number;
  pin: string;
}

/** The diode parameters of one LED die (Shockley with a series resistance). */
export interface LedJunction {
  is: number;
  n: number;
  rs: number;
}

/**
 * Electrical model of one component. The pin names each model uses are
 * listed in MODEL_PINS (nets.ts).
 */
export type ComponentModel =
  /** EMF in series with an internal resistance. Pins: pos, neg. */
  | { kind: 'battery'; volts: number; rInternal: number }
  /** SPDT relay (src/sim/relay.ts): a coil that pulls in at `pullAmps` and drops out at `dropAmps`. Pins: coil1, coil2, com, no, nc. */
  /** Brushed DC motor (src/sim/motor.ts): armature R and L, back-EMF constant ke (V s/rad, also the torque constant), friction b, rotor inertia, constant load torque. Pins: pos, neg. */
  | { kind: 'motor'; ohms: number; henries: number; ke: number; friction: number; inertia: number; load: number }
  /** Bench power supply with a current limit (src/sim/supply.ts): the set voltage up to `limit` amps, then constant current. Pins: pos, neg. */
  | { kind: 'supply'; volts: number; limit: number }
  /** Two-terminal current limiter, i = amps * tanh(v / (0.05 ohm * amps)) from a to b; part of a supply's expansion. Pins: a, b. */
  | { kind: 'limiter'; amps: number }
  | { kind: 'relay'; coilVolts: number; coilOhms: number; coilHenries: number; pullAmps: number; dropAmps: number }
  /** Function generator: a voltage source whose value follows `wave` over time (src/sim/signal.ts). Pins: pos, neg. */
  | { kind: 'signal'; wave: 'sine' | 'square' | 'triangle' | 'sawtooth'; freq: number; amp: number; offset: number; duty: number; rOut: number }
  /**
   * Pins: a, b. `lux` / `temp`: data only, the light level (an LDR) or the
   * temperature in degrees Celsius (an NTC thermistor) the ohms were computed
   * from (the part inspector shows it).
   */
  | { kind: 'resistor'; ohms: number; lux?: number; temp?: number }
  /** Tiny resistance when closed, huge when open. Pins: a, b. */
  | { kind: 'switch'; closed: boolean }
  /** Track of `ohms` between a and b; the wiper w sits at `position` (0 = at a, 1 = at b). */
  | { kind: 'pot'; ohms: number; position: number }
  /**
   * Shockley diode with series resistance. Pins: anode, cathode. Optional
   * reverse breakdown (a Zener, see zener.ts): the junction conducts
   * ibv * exp(-(v + bv) / (nbv VT)) backwards, i.e. `ibv` amps at a junction
   * voltage of -`bv` (nbv default 1). Without `bv` there is no breakdown.
   */
  | { kind: 'diode'; is: number; n: number; rs: number; bv?: number; ibv?: number; nbv?: number }
  /**
   * Active buzzer (see buzzer.ts): a smooth voltage-controlled resistance,
   * `ohmsOff` below `vOff`, `ohmsOn` (parallel to ohmsOff) above `vOn`,
   * smoothstep in between; reverse voltage sees ohmsOff only. Pins: pos, neg.
   */
  | { kind: 'buzzer'; vOff: number; vOn: number; ohmsOff: number; ohmsOn: number }
  /**
   * Common-cathode 7-segment display: eight LEDs (diode parameters is, n,
   * rs), one from each segment pin to com. Pins: a, b, c, d, e, f, g, dp, com.
   */
  | { kind: 'sevenseg'; is: number; n: number; rs: number }
  /**
   * Common-cathode RGB LED (see rgbled.ts): three LEDs with their own diode
   * parameters (a red one needs about 2 V, green and blue about 3 V), one
   * from each of r, g, b to com. Pins: r, g, b, com.
   */
  | { kind: 'rgbled'; r: LedJunction; g: LedJunction; b: LedJunction }
  /**
   * Ebers-Moll NPN transistor. Pins: c, b, e. Optional non-idealities (see
   * bjt.ts; absent = ideal, exactly the plain model): rb / rc / re series
   * resistances of the base, collector and emitter (ohms, the solver puts
   * internal nodes behind them), vaf the forward Early voltage (volts) and
   * rleak a collector-base leakage resistance (ohms: ICBO, amplified to
   * ICEO = (1 + beta) ICBO with an open base).
   */
  | { kind: 'npn'; is: number; bf: number; br: number } & BjtExtras
  /** Ebers-Moll PNP transistor: an NPN with every junction voltage and current reversed. Pins: c, b, e. */
  | { kind: 'pnp'; is: number; bf: number; br: number } & BjtExtras
  /**
   * Level-1 (square-law) enhancement MOSFET. polarity 1 is N-channel, -1 is
   * P-channel (then vth is negative). kp in A/V^2. Optional rd / rs: drain
   * and source lead resistances (ohms, internal nodes like a diode's rs).
   * Pins: g, d, s.
   */
  | { kind: 'mosfet'; polarity: 1 | -1; vth: number; kp: number; lambda: number; rd?: number; rs?: number }
  /**
   * Insulated-gate bipolar transistor, expanded by the solver into the usual
   * equivalent circuit (no device physics of its own; see solve.ts): a
   * Level-1 MOSFET (polarity, vth, kp, lambda as in `mosfet`) whose drain
   * drives the base of a bipolar transistor of the opposite type (is, bf, br
   * as in `npn` / `pnp`) at an internal node. N-channel (polarity 1): the
   * PNP's emitter is the IGBT collector, its collector the IGBT emitter, the
   * MOSFET's source the IGBT emitter. P-channel (polarity -1, vth negative):
   * the complement (P-MOSFET + NPN). Optional `rc`: series resistance of the
   * collector (drift region, ohms); optional `rleak`: resistance from the
   * internal base node to the emitter (off-state leakage, keeps the node
   * from floating). Pins: g, c, e.
   */
  | {
    kind: 'igbt'; polarity: 1 | -1; vth: number; kp: number; lambda: number;
    is: number; bf: number; br: number; rc?: number; rleak?: number;
  }
  /**
   * Capacitor of `farads` with an optional equivalent series resistance
   * (ohms, default 0). The DC solve sees it as open; the transient solver
   * (transient.ts) integrates it. Pins: a, b; a `polarized` one (an
   * electrolytic) has pos and neg instead (pos in the place of a), otherwise
   * it is the same element. `ratedVolts` is rating data only: the part
   * inspector and the burn rules read it (see ratings.ts).
   */
  | { kind: 'capacitor'; farads: number; esr?: number; polarized?: boolean; ratedVolts?: number }
  /**
   * Inductor of `henries` with an optional winding resistance (ohms,
   * default 0). The DC solve sees it as a near short (1 mOhm); the
   * transient solver integrates it. Pins: a, b.
   */
  | { kind: 'inductor'; henries: number; dcr?: number }
  /**
   * Half-bridge gate driver (IR2104-like), a behavioural model expanded by
   * the solver into resistors switched by a logic state (see driver.ts).
   * Pins: vcc, in, sd, com, lo, vs, ho, vb.
   */
  | { kind: 'halfdriver' }
  /**
   * 555 timer (NE555-like): the reference divider, two comparators and a
   * latch, expanded by the solver into resistors switched by the latch (see
   * timer555.ts). Pins: gnd, trig, out, reset, ctrl, thr, disch, vcc.
   */
  | { kind: 'timer555' }
  /**
   * Dual op-amp (LM358-like): two amplifiers, each a gain-limited controlled
   * source that saturates at the rails (see opamp.ts). Pins: o1, n1, p1, gnd,
   * p2, n2, o2, vcc.
   */
  | { kind: 'opamp' }
  /**
   * Ideal logic gate without supply pins (see gates.ts): inputs against the
   * circuit's 0 V reference, the output a switched source of `vcc` or 0 V
   * behind 25 ohm to that reference. Pins: a, b (2 inputs only), y.
   */
  | { kind: 'gate'; fn: GateFn; inputs: 1 | 2; vcc: number }
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

/** Optional non-idealities of a bipolar transistor model (see the `npn` model). */
export interface BjtExtras {
  rb?: number;
  rc?: number;
  re?: number;
  vaf?: number;
  rleak?: number;
}

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
  /** False when Newton's method (and the convergence aids) ran out of iterations or the matrix was singular. */
  converged: boolean;
  /** Newton iterations (linear solves) spent in total, convergence aids included. */
  iterations: number;
  /**
   * How the solve got there (diagnostics): plain Newton, or after it failed
   * gmin stepping or source stepping (the last one tried when none worked).
   * Absent for an empty circuit.
   */
  method?: 'newton' | 'gmin' | 'source';
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
