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
