// Part type definitions: all data. Sizes are in grid cells; the artwork
// (SVG, see src/art) fills a (cols x rows) cell box and its leads end on
// grid points, which is where the pins are.
// To add a part: draw its art in src/art and add one entry below.

import { BATTERY_ART } from './art/battery';
import { BATTERY_9V_ART } from './art/battery9v';
import { DIODE_ART } from './art/diode';
import { GROUND_ART } from './art/ground';
import { LED_ART, LED_BURNED_SVG, drawLedGlow } from './art/led';
import { POT_ART, POT_KNOB, drawPotPointer } from './art/pot';
import { PUSH_BUTTON_ART, PUSH_BUTTON_PRESSED_SVG } from './art/pushbutton';
import { RESISTOR_ART, resistorArt } from './art/resistor';
import { TOGGLE_ART, TOGGLE_ON_SVG } from './art/toggle';
import { NMOS_ART, PMOS_ART } from './art/to220';
import { PNP_ART, TRANSISTOR_ART } from './art/transistor';
import { UNO_ART, UNO_BOTTOM, UNO_RESET, UNO_TOP, drawUnoLeds, type HeaderPin } from './art/uno';
import { ART_CELL } from './art/common';
import { diodeReadout, mosfetReadout, pnpReadout } from './devicereadouts';
import type { BoardSpec } from './mcu/board';
import { UNO_SPEC } from './mcu/avr/uno';
import { parseBoardId } from './project/boardidparse';
import {
  BC547, BC557, D1N4148, LOGIC_NMOS, POWER_PMOS, RED_LED, type ComponentModel, type PartResult,
} from './sim';

/** What a placed part remembers besides its position. Plain serializable data. */
export interface PartState {
  /** Switches and buttons: contact closed. */
  closed?: boolean;
  /** Potentiometer wiper, 0..1. */
  position?: number;
  /** Editable main value (ohms for resistors and potentiometers). */
  value?: number;
  /** Destroyed by too much current. */
  burned?: boolean;
  /** Boards only: the user's display name (see project/boardname.ts); without it the board shows its default label. */
  name?: string;
}

export interface PinDef {
  id: string;
  name: string;
  /** Grid point inside the unrotated cell box: 0..cols, 0..rows. */
  x: number;
  y: number;
}

export interface PartType {
  id: string;
  name: string;
  cols: number;
  rows: number;
  /** Standalone SVG document, viewBox (cols * ART_CELL) x (rows * ART_CELL). */
  svg: string;
  pins: readonly PinDef[];
  /** Pairs of pins that are the same piece of metal inside the part. */
  links?: readonly (readonly [string, string])[];
  /** State of a newly placed part. */
  defaults?: PartState;
  /** The editable `state.value`. */
  value?: { label: string; unit: string; min: number; max: number };
  /** Mouse behavior: closed while held, flips on click, or has a knob to turn. */
  control?: 'momentary' | 'toggle' | 'knob';
  /** Knob circle in cells inside the unrotated cell box. */
  knob?: { x: number; y: number; r: number };
  /** Amps above which the part is warned about / destroyed. */
  warnAbove?: number;
  burnAbove?: number;
  /** Different artwork for some states (key identifies the look), or null for `svg`. */
  variant?(state: PartState): { key: string; svg: string } | null;
  /** Live drawing on top of the artwork; the canvas is in art units, unrotated. */
  overlay?(ctx: CanvasRenderingContext2D, state: PartState, result: PartResult | undefined): void;
  /** Hover text lines for the simulated values (default: chosen from the pins, see src/readout.ts). */
  readout?(result: PartResult): string[];
  /** Electrical model; its pin names are this part's pin ids. */
  sim?(state: PartState): ComponentModel;
  /** A microcontroller board: runs programs (see src/mcu). */
  board?: BoardSpec;
  /**
   * Boards: the reset button drawn on the art, as a box in cells inside the
   * unrotated cell box. A click on it (not a drag) resets the board; it
   * rotates with the part (see src/boardcontrols.ts).
   */
  resetButton?: { x: number; y: number; w: number; h: number };
  /**
   * Boards: file extensions (lower case, no dot) of the source files that can
   * be imported into this board's folder. A board type without any accepts no
   * imports. A future Raspberry Pi Pico type lists 'py' and friends here; the
   * explorer needs no change.
   */
  sourceExtensions?: readonly string[];
}

const DEFAULT_OHMS = 220;
const DEFAULT_POT_OHMS = 10_000;
export const LED_WARN_AMPS = 0.03;

/** 0..1 for an LED current: just visible near 0.3 mA, dim at 1 mA, full at 15 mA. */
export function ledBrightness(amps: number): number {
  if (!(amps > 0.0003)) return 0;
  return Math.min(1, Math.log(amps / 0.0003) / Math.log(0.015 / 0.0003));
}

/** Readout name of an Uno header pin, e.g. "D13 (LED L)", "D9 (PWM)". */
function unoPinName(p: HeaderPin): string {
  if (p.id.startsWith('d')) {
    const n = Number(p.id.slice(1));
    const extra = n === 13 ? ' (LED L)' : n === 0 ? ' (RX)' : n === 1 ? ' (TX)' : p.label.startsWith('~') ? ' (PWM)' : '';
    return `D${n}${extra}`;
  }
  return p.label;
}

const UNO_PINS = [
  ...UNO_TOP.map((p) => ({ id: p.id, name: unoPinName(p), x: p.x, y: 0 })),
  ...UNO_BOTTOM.map((p) => ({ id: p.id, name: unoPinName(p), x: p.x, y: UNO_ART.rows })),
];

/** TO-92 transistors (BC547, BC557): C B E, left to right, flat face to the front. */
const TO92_PINS: readonly PinDef[] = [
  { id: 'c', name: 'Collector', x: 1, y: 4 }, { id: 'b', name: 'Base', x: 2, y: 4 },
  { id: 'e', name: 'Emitter', x: 3, y: 4 },
];

/** TO-220 MOSFETs: G D S, left to right seen from the front (the tab is the drain too). */
const TO220_PINS: readonly PinDef[] = [
  { id: 'g', name: 'Gate', x: 1, y: 7 }, { id: 'd', name: 'Drain', x: 2, y: 7 }, { id: 's', name: 'Source', x: 3, y: 7 },
];

export const PARTS: readonly PartType[] = [
  {
    id: 'battery', name: 'Battery (AA)', ...BATTERY_ART,
    pins: [{ id: 'neg', name: '−', x: 0, y: 1 }, { id: 'pos', name: '+', x: 6, y: 1 }],
    sim: () => ({ kind: 'battery', volts: 1.5, rInternal: 0.2 }),
  },
  {
    id: 'battery9v', name: 'Battery (9 V)', ...BATTERY_9V_ART,
    pins: [{ id: 'pos', name: '+', x: 5, y: 1 }, { id: 'neg', name: '−', x: 5, y: 2 }],
    sim: () => ({ kind: 'battery', volts: 9, rInternal: 1.5 }),
  },
  {
    id: 'ground', name: 'Ground', ...GROUND_ART,
    pins: [{ id: 'gnd', name: 'GND', x: 1, y: 0 }],
    sim: () => ({ kind: 'ground' }),
  },
  {
    id: 'resistor', name: 'Resistor', ...RESISTOR_ART,
    pins: [{ id: 'a', name: '1', x: 0, y: 1 }, { id: 'b', name: '2', x: 4, y: 1 }],
    defaults: { value: DEFAULT_OHMS },
    value: { label: 'Resistance', unit: 'Ω', min: 1, max: 10e6 },
    variant: (s) => resistorArt(s.value ?? DEFAULT_OHMS),
    sim: (s) => ({ kind: 'resistor', ohms: s.value ?? DEFAULT_OHMS }),
  },
  {
    id: 'led', name: 'LED', ...LED_ART,
    pins: [{ id: 'cathode', name: 'Cathode (−)', x: 1, y: 4 }, { id: 'anode', name: 'Anode (+)', x: 2, y: 4 }],
    warnAbove: LED_WARN_AMPS,
    burnAbove: 0.1,
    variant: (s) => (s.burned ? { key: 'burned', svg: LED_BURNED_SVG } : null),
    overlay: (ctx, s, r) => {
      if (!s.burned && r) drawLedGlow(ctx, ledBrightness(r.current));
    },
    sim: (s) => (s.burned ? { kind: 'open' } : RED_LED),
  },
  {
    id: 'switch', name: 'Toggle switch', ...TOGGLE_ART,
    pins: [{ id: 'a', name: '1', x: 0, y: 1 }, { id: 'b', name: '2', x: 4, y: 1 }],
    defaults: { closed: false },
    control: 'toggle',
    variant: (s) => (s.closed ? { key: 'on', svg: TOGGLE_ON_SVG } : null),
    sim: (s) => ({ kind: 'switch', closed: s.closed === true }),
  },
  {
    id: 'button', name: 'Push button', ...PUSH_BUTTON_ART,
    pins: [
      { id: 'a', name: '1a', x: 0, y: 1 }, { id: 'a2', name: '1b', x: 4, y: 1 },
      { id: 'b', name: '2a', x: 0, y: 2 }, { id: 'b2', name: '2b', x: 4, y: 2 },
    ],
    links: [['a', 'a2'], ['b', 'b2']],
    defaults: { closed: false },
    control: 'momentary',
    variant: (s) => (s.closed ? { key: 'down', svg: PUSH_BUTTON_PRESSED_SVG } : null),
    sim: (s) => ({ kind: 'switch', closed: s.closed === true }),
  },
  {
    id: 'pot', name: 'Potentiometer', ...POT_ART,
    pins: [{ id: 'a', name: '1', x: 1, y: 4 }, { id: 'w', name: 'Wiper', x: 2, y: 4 }, { id: 'b', name: '3', x: 3, y: 4 }],
    defaults: { value: DEFAULT_POT_OHMS, position: 0.5 },
    value: { label: 'Resistance', unit: 'Ω', min: 10, max: 10e6 },
    control: 'knob',
    knob: { x: POT_KNOB.x / ART_CELL, y: POT_KNOB.y / ART_CELL, r: POT_KNOB.r / ART_CELL },
    overlay: (ctx, s) => drawPotPointer(ctx, s.position ?? 0.5),
    sim: (s) => ({ kind: 'pot', ohms: s.value ?? DEFAULT_POT_OHMS, position: s.position ?? 0.5 }),
  },
  {
    // Pin ids are the diode model's, like the LED's; the band marks the cathode.
    id: 'diode', name: 'Diode (1N4148)', ...DIODE_ART,
    pins: [{ id: 'anode', name: 'Anode (+)', x: 0, y: 1 }, { id: 'cathode', name: 'Cathode (−, band)', x: 4, y: 1 }],
    readout: diodeReadout,
    sim: () => D1N4148,
  },
  {
    // The id stays 'bjt' (saved projects use it).
    id: 'bjt', name: 'NPN transistor (BC547)', ...TRANSISTOR_ART,
    pins: TO92_PINS,
    sim: () => BC547,
  },
  {
    id: 'pnp', name: 'PNP transistor (BC557)', ...PNP_ART,
    pins: TO92_PINS,
    readout: pnpReadout,
    sim: () => BC557,
  },
  {
    id: 'nmos', name: 'N-MOSFET (logic level)', ...NMOS_ART,
    pins: TO220_PINS,
    readout: (r) => mosfetReadout(r, 1),
    sim: () => LOGIC_NMOS,
  },
  {
    id: 'pmos', name: 'P-MOSFET', ...PMOS_ART,
    pins: TO220_PINS,
    readout: (r) => mosfetReadout(r, -1),
    sim: () => POWER_PMOS,
  },
  {
    id: 'uno', name: 'Arduino Uno', ...UNO_ART,
    pins: UNO_PINS,
    links: [['gnd', 'gnd2'], ['gnd', 'gnd3']],
    board: UNO_SPEC,
    resetButton: { x: UNO_RESET.x / ART_CELL, y: UNO_RESET.y / ART_CELL, w: UNO_RESET.w / ART_CELL, h: UNO_RESET.h / ART_CELL },
    // 'hex': compiled firmware (Intel HEX text), run by the board (see src/build/firmware.ts).
    sourceExtensions: ['ino', 'cpp', 'c', 'h', 'hpp', 'txt', 'md', 'hex'],
    // io pins are filled in by the mixed-signal bridge (src/mcu/mixedsignal.ts).
    sim: () => ({ kind: 'board', rails: { ...UNO_SPEC.electrical.rails }, io: {} }),
    overlay: (ctx, _s, r) => drawUnoLeds(ctx, (r?.volts?.d13 ?? 0) / UNO_SPEC.electrical.vcc, r !== undefined),
  },
];

export function getPart(id: string): PartType | undefined {
  return PARTS.find((p) => p.id === id);
}

/** What the labels of a placed board are made from. */
interface BoardLike {
  typeId: string;
  boardId?: string;
  state?: PartState;
}

/**
 * Default name of a placed board, e.g. "Arduino Uno #2" for the board folder
 * "uno-2": the type name and the counter of its boardId, which never changes
 * (also across saving) and is what the board's folder is called.
 */
export function defaultBoardLabel(part: BoardLike): string {
  const name = getPart(part.typeId)?.name ?? 'Board';
  const parsed = part.boardId === undefined ? null : parseBoardId(part.boardId);
  return parsed ? `${name} #${parsed.n}` : name;
}

/** The user's name for a board, or undefined when it has none. */
export function customBoardName(part: BoardLike): string | undefined {
  const name = part.state?.name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/** Short name of a placed board: the user's name when set, else the default label. */
export function boardLabel(part: BoardLike): string {
  return customBoardName(part) ?? defaultBoardLabel(part);
}

/** Like boardLabel, plus the folder id when the name is the user's ("Blinker (uno-1)"), so equal names can be told apart. */
export function boardLabelWithId(part: BoardLike): string {
  const custom = customBoardName(part);
  return custom !== undefined && part.boardId !== undefined ? `${custom} (${part.boardId})` : boardLabel(part);
}
