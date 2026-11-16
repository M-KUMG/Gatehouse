// Ready-made circuits, stored exactly like a project would store them.

import type { PlacedPart, ProjectState, Rotation, Wire } from './model';
import type { PartState } from './parts';

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
      version: 1,
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
    },
  },
  {
    name: 'Transistor switch',
    hint: 'A push button drives a BC547 that switches the LED. Hold the button.',
    state: {
      version: 1,
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
    },
  },
];
