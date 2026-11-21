// Ready-made circuits, stored exactly like a project would store them.

import { FIRMWARE_FILE } from './build/firmware';
import { BLINK_HEX } from './mcu/programs/blink';
import type { PlacedPart, ProjectState, Rotation, Wire } from './model';
import type { PartState } from './parts';
import { defaultTree } from './project/filetree';

export interface Example {
  name: string;
  hint: string;
  state: ProjectState;
}

const part = (id: number, typeId: string, col: number, row: number, rotation: Rotation = 0, state?: PartState): PlacedPart =>
  state ? { id, typeId, col, row, rotation, state } : { id, typeId, col, row, rotation };

/** "1.pos" -> pin `pos` of part 1. */
const wire = (id: number, from: string, to: string, waypoints: [number, number][] = []): Wire => {
  const pin = (s: string) => ({ partId: Number(s.split('.')[0]), pinId: s.split('.')[1] });
  return { id, from: pin(from), to: pin(to), waypoints: waypoints.map(([col, row]) => ({ col, row })) };
};

/** Like `wire`, where "j60" is junction 60 and "1.pos" pin `pos` of part 1. */
const link = (id: number, from: string, to: string, waypoints: [number, number][] = []): Wire => {
  const end = (s: string) => (s.startsWith('j') ? { junctionId: Number(s.slice(1)) } : { partId: Number(s.split('.')[0]), pinId: s.split('.')[1] });
  return { id, from: end(from), to: end(to), waypoints: waypoints.map(([col, row]) => ({ col, row })) };
};

export const EXAMPLES: readonly Example[] = [
  {
    name: 'LED + switch',
    hint: '9 V battery, switch, 330 Ω resistor and LED. Click the switch.',
    state: {
      version: 2,
      parts: [
        part(1, 'battery9v', 0, 2),
        part(2, 'switch', 7, 2),
        part(3, 'resistor', 13, 2, 0, { value: 330 }),
        part(4, 'led', 18, 3, 180),
        part(5, 'ground', 5, 5),
        part(6, 'ground', 21, 5),
      ],
      wires: [
        wire(11, '1.pos', '2.a'),
        wire(12, '2.b', '3.a'),
        wire(13, '3.b', '4.anode'),
        wire(14, '4.cathode', '6.gnd'),
        wire(15, '1.neg', '5.gnd'),
      ],
      junctions: [],
    },
  },
  {
    name: 'Transistor switch',
    hint: 'A push button drives a BC547 that switches the LED. Hold the button.',
    state: {
      version: 2,
      parts: [
        part(1, 'battery9v', 0, 0),
        part(2, 'ground', 5, 3),
        part(3, 'button', 7, 0),
        part(4, 'resistor', 12, 1, 0, { value: 10_000 }),
        part(5, 'led', 7, -5, 180),
        part(6, 'resistor', 11, -6, 0, { value: 330 }),
        part(7, 'bjt', 18, 2, 90),
        part(8, 'ground', 16, 6),
      ],
      wires: [
        wire(11, '1.neg', '2.gnd'),
        wire(12, '1.pos', '3.a'),
        wire(13, '3.b2', '4.a'),
        wire(14, '4.b', '7.b', [[16, 4]]),
        wire(15, '1.pos', '5.anode', [[6, -5]]),
        wire(16, '5.cathode', '6.a'),
        wire(17, '6.b', '7.c', [[17, -5]]),
        wire(18, '7.e', '8.gnd'),
      ],
      junctions: [],
    },
  },
  {
    // The switch puts the battery's 9 V on the gate (10 k pulls it down when open);
    // the LED and 220 ohm hang from battery + to the collector, the emitter is grounded.
    name: 'IGBT low-side switch',
    hint: 'A toggle switch drives an IGBT that switches the LED. Click the switch. The gate needs about 9 V or more '
      + '(Vge(th) is about 4.5 V): 5 V from a board barely passes the threshold and gives at most about 0.5 A, '
      + 'too weak for a real load.',
    state: {
      version: 4,
      parts: [
        part(1, 'battery9v', 0, 0),
        part(2, 'ground', 5, 3),
        part(3, 'switch', 7, 0),
        part(4, 'resistor', 12, 3, 90, { value: 10_000 }),
        part(5, 'ground', 12, 9),
        part(6, 'igbt', 16, 2),
        part(7, 'ground', 20, 12),
        part(8, 'resistor', 22, -1, 90, { value: 220 }),
        part(9, 'led', 22, 4, 180),
      ],
      wires: [
        wire(11, '1.neg', '2.gnd'),
        wire(12, '1.pos', '3.a'),
        { id: 13, from: { partId: 3, pinId: 'b' }, to: { junctionId: 30 }, waypoints: [] },
        { id: 14, from: { junctionId: 30 }, to: { partId: 6, pinId: 'g' }, waypoints: [{ col: 15, row: 1 }, { col: 15, row: 12 }, { col: 17, row: 12 }] },
        { id: 15, from: { junctionId: 30 }, to: { partId: 4, pinId: 'a' }, waypoints: [] },
        wire(16, '4.b', '5.gnd'),
        wire(17, '6.e', '7.gnd', [[19, 11], [21, 11]]),
        wire(18, '1.pos', '8.a', [[5, -2], [23, -2]]),
        wire(19, '8.b', '9.anode'),
        wire(20, '9.cathode', '6.c', [[24, 2], [26, 2], [26, 14], [18, 14]]),
      ],
      junctions: [{ id: 30, col: 13, row: 1 }],
    },
  },
  {
    // Half bridge: high IGBT from +9 V to the output (VS), low IGBT from the output to ground,
    // load (330 ohm + LED) from the output to ground. The driver's HO floats on VS, powered by
    // the bootstrap capacitor (VB-VS) that the diode charges from +9 V while the low side conducts.
    name: 'Half-bridge with IGBTs',
    hint: 'An IR2104-like gate driver runs a half bridge of two N-IGBTs from the 9 V battery; pin 13 of the Uno '
      + '(the Blink program) drives IN, SD is tied to the Uno 5 V. Select the board and press Run. IN low: the low '
      + 'IGBT pulls the output to ground (LED off) and the bootstrap capacitor charges through the diode and 47 Ω '
      + 'from +9 V. IN high: HO lifts the high IGBT gate above its emitter with that charge (an N-IGBT needs its gate '
      + 'above the output, i.e. above +9 V) and the LED lights. The high side only works after the low side has '
      + 'charged the capacitor; Blink starts with pin 13 low for about 20 ms, which is enough.',
    state: {
      version: 4,
      parts: [
        { ...part(1, 'uno', 0, 22), boardId: 'uno-1' },
        part(2, 'halfdriver', 8, 6),
        part(3, 'battery9v', -8, -4),
        part(4, 'ground', -4, 0),
        part(5, 'resistor', 1, -2, 90, { value: 47 }),
        part(6, 'diode', 3, 2),
        part(7, 'ecap', 13, 2, 0, { value: 100e-6 }),
        part(8, 'igbt', 26, -2, 90),
        part(9, 'igbt', 26, 8, 90),
        part(10, 'ground', 25, 13),
        part(11, 'resistor', 23, 11, 90, { value: 330 }),
        part(12, 'led', 23, 16, 180),
        part(13, 'ground', 27, 16),
        part(14, 'ground', 13, 11),
      ],
      wires: [
        // +9 V: battery -> high IGBT collector, driver VCC, bootstrap resistor and diode.
        link(21, '3.pos', 'j60'),
        link(22, 'j60', 'j61'),
        link(23, 'j61', '8.c', [[25, -3], [25, 0]]),
        link(24, 'j60', '2.vcc', [[0, 12], [9, 12]]),
        link(25, 'j61', '5.a'),
        link(26, '5.b', '6.anode', [[2, 3]]),
        link(27, '6.cathode', 'j62'),
        link(28, 'j62', '2.vb'),
        link(29, 'j62', '7.pos'),
        // Gates.
        link(30, '2.ho', '8.g', [[10, -1]]),
        link(31, '2.lo', '9.g', [[12, 5], [15, 5], [15, 9]]),
        // Output (VS): high IGBT emitter, low IGBT collector, capacitor -, load.
        link(32, '2.vs', 'j63', [[11, 1]]),
        link(33, 'j63', '8.e'),
        link(34, 'j63', 'j64'),
        link(35, '7.neg', 'j64'),
        link(36, 'j64', 'j65'),
        link(37, 'j65', '9.c'),
        link(38, 'j65', '11.a'),
        link(39, '11.b', '12.anode'),
        link(40, '12.cathode', '13.gnd'),
        link(41, '9.e', '10.gnd'),
        // Battery - and the driver's COM to ground (the Uno's GND is ground too).
        link(42, '3.neg', '4.gnd'),
        link(43, '2.com', '14.gnd', [[12, 11]]),
        // Logic: pin 13 -> IN, the Uno's 5 V holds SD high (running).
        link(44, '1.d13', '2.in', [[5, 14], [10, 14]]),
        link(45, '2.sd', '1.5v', [[11, 21], [32, 21], [32, 39], [7, 39]]),
      ],
      junctions: [
        { id: 60, col: 0, row: -3 }, { id: 61, col: 2, row: -3 }, { id: 62, col: 9, row: 3 },
        { id: 63, col: 24, row: 1 }, { id: 64, col: 24, row: 3 }, { id: 65, col: 24, row: 10 },
      ],
      files: { 'uno-1': { files: { ...defaultTree().files, [FIRMWARE_FILE]: BLINK_HEX }, folders: [] } },
    },
  },
  {
    // Ideal gates (no supply pins) run at 9 V here, the battery's level, so a closed switch
    // (9 V) reads high and an open one low through the gate's own 10 Mohm pull-down.
    name: 'Logic gates',
    hint: 'Two toggle switches feed an AND gate and an XOR gate (both set to 9 V, the battery\'s level); '
      + 'each output lights an LED through 330 Ω. Click the switches: AND lights with both closed, '
      + 'XOR with exactly one. An open switch reads low (the gate inputs pull down). Double-click a gate '
      + 'to choose its supply level.',
    state: {
      version: 4,
      parts: [
        part(1, 'battery9v', 0, 0),
        part(2, 'ground', 8, 4),
        part(3, 'switch', 12, 0),
        part(4, 'switch', 12, 6),
        part(5, 'gate-and', 20, 0, 0, { vcc: 9 }),
        part(6, 'gate-xor', 20, 14, 0, { vcc: 9 }),
        part(7, 'resistor', 25, 2, 90, { value: 330 }),
        part(8, 'led', 25, 7, 180),
        part(9, 'ground', 29, 9),
        part(10, 'resistor', 25, 16, 90, { value: 330 }),
        part(11, 'led', 25, 21, 180),
        part(12, 'ground', 29, 23),
      ],
      wires: [
        wire(31, '1.neg', '2.gnd', [[9, 2]]),
        wire(32, '1.pos', '3.a'),
        wire(33, '3.a', '4.a', [[11, 1], [11, 7]]),
        // Switch A -> both A inputs, switch B -> both B inputs.
        wire(34, '3.b', '5.a'),
        wire(35, '3.b', '6.a', [[18, 1], [18, 15]]),
        wire(36, '4.b', '5.b', [[17, 7], [17, 3]]),
        wire(37, '4.b', '6.b', [[17, 7], [17, 17]]),
        // Outputs -> 330 ohm -> LED -> ground.
        wire(38, '5.y', '7.a'),
        wire(39, '7.b', '8.anode'),
        wire(40, '8.cathode', '9.gnd', [[27, 6], [30, 6]]),
        wire(41, '6.y', '10.a'),
        wire(42, '10.b', '11.anode'),
        wire(43, '11.cathode', '12.gnd', [[27, 20], [30, 20]]),
      ],
      junctions: [],
    },
  },
  {
    // Cross-coupled NOR gates: Qbar = NOR(S, Q) (part 5), Q = NOR(R, Qbar) (part 6). The solver
    // settles the loop deterministically; from power-up it reads Q low (reset).
    name: 'SR latch from NOR gates',
    hint: 'Two NOR gates (9 V) cross-coupled into a set-reset latch: hold S to set Q (top LED off, bottom LED on), '
      + 'hold R to reset it. Start the clock (Start) so the latch remembers between presses: it keeps its '
      + 'state when the button is released. It starts reset (Q low).',
    state: {
      version: 4,
      parts: [
        part(1, 'battery9v', 0, 0),
        part(2, 'ground', 8, 4),
        part(3, 'button', 12, 0),
        part(4, 'button', 12, 8),
        part(5, 'gate-nor', 20, 0, 0, { vcc: 9 }),
        part(6, 'gate-nor', 20, 8, 0, { vcc: 9 }),
        part(7, 'resistor', 27, 10, 90, { value: 330 }),
        part(8, 'led', 27, 15, 180),
        part(9, 'ground', 31, 17),
        part(10, 'resistor', 31, 2, 90, { value: 330 }),
        part(11, 'led', 31, 7, 180),
        part(12, 'ground', 35, 9),
      ],
      wires: [
        wire(31, '1.neg', '2.gnd', [[9, 2]]),
        wire(32, '1.pos', '3.a'),
        wire(33, '3.a', '4.a', [[11, 1], [11, 9]]),
        // S -> Qbar gate input A, R -> Q gate input A.
        wire(34, '3.b2', '5.a', [[18, 2], [18, 1]]),
        wire(35, '4.b2', '6.a', [[18, 10], [18, 9]]),
        // Cross-coupling: Q -> Qbar gate input B, Qbar -> Q gate input B.
        wire(36, '6.y', '5.b', [[25, 10], [25, 6], [19, 6], [19, 3]]),
        wire(37, '5.y', '6.b', [[26, 2], [26, 13], [19, 13], [19, 11]]),
        // Q -> 330 ohm -> LED (bottom), Qbar -> 330 ohm -> LED (top).
        wire(38, '6.y', '7.a'),
        wire(39, '7.b', '8.anode'),
        wire(40, '8.cathode', '9.gnd', [[29, 14], [32, 14]]),
        wire(41, '5.y', '10.a'),
        wire(42, '10.b', '11.anode'),
        wire(43, '11.cathode', '12.gnd', [[33, 6], [36, 6]]),
      ],
      junctions: [],
    },
  },
  {
    // Common cathode to ground; segments a, b, c each from battery + through a switch and 330 ohm
    // ((9 V - 1.95 V) / 330 = 21 mA, below the 30 mA per-segment warning; 220 ohm would give 32 mA).
    name: 'Seven-segment',
    hint: 'A common-cathode 7-segment display: three toggle switches light segments a, b and c from the 9 V battery '
      + 'through 330 Ω each (about 21 mA per segment). Close all three for a 7.',
    state: {
      version: 4,
      parts: [
        part(1, 'battery9v', 0, 0),
        part(2, 'ground', 4, 4),
        part(3, 'switch', 8, -10),
        part(4, 'resistor', 14, -10, 0, { value: 330 }),
        part(5, 'switch', 8, -8),
        part(6, 'resistor', 14, -8, 0, { value: 330 }),
        part(7, 'switch', 8, 7),
        part(8, 'resistor', 14, 7, 0, { value: 330 }),
        part(9, 'sevenseg', 24, -2),
        part(10, 'ground', 20, 2),
      ],
      wires: [
        wire(11, '1.neg', '2.gnd'),
        wire(12, '1.pos', '3.a', [[6, 1], [6, -9]]),
        wire(13, '1.pos', '5.a', [[7, 1], [7, -7]]),
        wire(14, '1.pos', '7.a', [[7, 1], [7, 8]]),
        wire(15, '3.b', '4.a'),
        wire(16, '5.b', '6.a'),
        wire(17, '7.b', '8.a'),
        wire(18, '4.b', '9.b', [[29, -9]]),
        wire(19, '6.b', '9.a', [[28, -7]]),
        wire(20, '8.b', '9.c', [[28, 8]]),
        wire(21, '9.com', '10.gnd', [[27, -5], [21, -5]]),
      ],
      junctions: [],
    },
  },
  {
    // Astable 555: R1 from +9 V to DISCH, R2 from DISCH to THR, C from THR to ground, TRIG tied to THR, RESET to +9 V.
    // High 0.693 (R1 + R2) C = 0.33 s, low 0.693 R2 C = 0.33 s: about 1.5 Hz. OUT drives 470 ohm + LED to ground.
    name: '555 blinker',
    hint: 'A 555 timer in astable mode blinks the LED about 1.5 times a second: R1 1 kΩ, R2 47 kΩ and C 10 µF set the '
      + 'rate (f = 1.44 / ((R1 + 2 R2) C)). The capacitor swings between 1/3 and 2/3 of the 9 V supply; TRIG is tied to '
      + 'THR so it watches the same capacitor, and RESET is tied to +9 V (an open RESET holds the chip off). '
      + 'Press Start (top right) and watch the LED; change R2 or C with a click on the part.',
    state: {
      version: 4,
      parts: [
        part(1, 'battery9v', 0, 6),
        part(2, 'ground', 4, 9),
        part(3, 'timer555', 12, 10),
        part(4, 'resistor', 13, 4, 90, { value: 1000 }),
        part(5, 'resistor', 14, 7, 0, { value: 47_000 }),
        part(6, 'ecap', 17, 8, 90, { value: 10e-6 }),
        part(7, 'ground', 17, 13),
        part(8, 'ground', 10, 15),
        part(9, 'resistor', 15, 15, 0, { value: 470 }),
        part(10, 'led', 18, 16, 180),
        part(11, 'ground', 21, 17),
      ],
      wires: [
        // +9 V: battery -> R1 top and the chip's VCC; RESET joins it around the right end.
        wire(21, '1.pos', '4.a', [[7, 7], [7, 4]]),
        wire(22, '1.pos', '3.vcc', [[7, 7], [7, 10]]),
        wire(23, '3.reset', '4.a', [[28, 14], [28, 3], [14, 3]]),
        // Timing network: R1 -> DISCH -> R2 -> THR / capacitor, TRIG tied to the same node.
        wire(24, '3.disch', '4.b'),
        wire(25, '3.thr', '5.b', [[15, 9], [18, 9]]),
        wire(26, '3.trig', '6.pos', [[14, 22], [26, 22], [26, 8]]),
        // Grounds.
        wire(27, '1.neg', '2.gnd'),
        wire(28, '6.neg', '7.gnd'),
        wire(29, '3.gnd', '8.gnd', [[13, 15]]),
        // Output: OUT -> 470 ohm -> LED (its anode touches the resistor) -> ground.
        wire(30, '3.out', '9.a'),
        wire(32, '10.cathode', '11.gnd', [[22, 16]]),
      ],
      junctions: [],
    },
  },
  {
    // LM358 as a comparator: IN1+ from a divider (10 k to +9 V, LDR to ground), IN1- from a 1.5 V cell.
    // IN1+ = 9 V R_ldr / (10 k + R_ldr) crosses 1.5 V at R_ldr = 2 kOhm = 100 lx. The LDR starts at 1000 lx (LED off).
    name: 'Op-amp night light',
    hint: 'An LM358 op-amp used as a comparator: a 10 kΩ resistor and the photoresistor make a divider that feeds IN+, '
      + 'a 1.5 V cell is the reference on IN−. When it gets darker than about 100 lx the divider rises above 1.5 V, '
      + 'the output swings to the top rail and the LED lights. Click the photoresistor and lower its Light value '
      + '(it starts at 1000 lx).',
    state: {
      version: 4,
      parts: [
        part(1, 'battery9v', 0, 2),
        part(2, 'ground', 4, 5),
        part(3, 'opamp', 12, 10, 180),
        part(4, 'battery', 14, 0, 90),
        part(5, 'ground', 17, 0),
        part(6, 'resistor', 6, 3, 90, { value: 10_000 }),
        part(7, 'ldr', 6, 7, 90, { lux: 1000 }),
        part(8, 'ground', 6, 12),
        part(9, 'ground', 12, 8),
        part(10, 'resistor', 22, 8, 0, { value: 470 }),
        part(11, 'led', 25, 9, 180),
        part(12, 'ground', 29, 10),
      ],
      wires: [
        // +9 V: battery -> divider top, and around to the chip's V+.
        wire(21, '1.pos', '6.a'),
        wire(22, '6.a', '3.vcc', [[9, 3], [9, 16], [16, 16]]),
        wire(23, '1.neg', '2.gnd'),
        // Divider: resistor -> node -> LDR -> ground; the node feeds IN1+.
        wire(24, '7.a', '3.p1', [[14, 7]]),
        wire(25, '7.b', '8.gnd'),
        // Reference: the 1.5 V cell's + to IN1-, its - to ground.
        wire(26, '4.pos', '3.n1'),
        wire(27, '4.neg', '5.gnd'),
        // The chip's ground pin.
        wire(28, '3.gnd', '9.gnd'),
        // Output: OUT1 -> 470 ohm -> LED -> ground.
        wire(29, '3.o1', '10.a', [[16, 9], [22, 9]]),
        wire(31, '11.cathode', '12.gnd', [[30, 9]]),
      ],
      junctions: [],
    },
  },
  {
    name: 'Uno blink',
    hint: 'Arduino Uno with the Blink program: pin 13 → 220 Ω → LED → GND. Select the board and press Run.',
    state: {
      version: 4,
      parts: [
        { ...part(1, 'uno', 0, 0), boardId: 'uno-1' },
        part(2, 'resistor', 4, -5, 90, { value: 220 }),
        part(3, 'led', 3, -10),
      ],
      wires: [
        wire(11, '1.d13', '2.b'),
        wire(12, '2.a', '3.anode'),
        wire(13, '3.cathode', '1.gnd3'),
      ],
      junctions: [],
      // The sketch next to the firmware it stands for (sketches are not compiled yet).
      files: { 'uno-1': { files: { ...defaultTree().files, [FIRMWARE_FILE]: BLINK_HEX }, folders: [] } },
    },
  },
];
