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
