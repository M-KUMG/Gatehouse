// Part type definitions: all data. Sizes are in grid cells; the artwork
// (SVG, see src/art) fills a (cols x rows) cell box and its leads end on
// grid points, which is where the pins are.
// To add a part: draw its art in src/art and add one entry below.

import { BATTERY_ART } from './art/battery';
import { BATTERY_9V_ART } from './art/battery9v';
import { GROUND_ART } from './art/ground';
import { LED_ART, LED_BURNED_SVG, drawLedGlow } from './art/led';
import { POT_ART, POT_KNOB, drawPotPointer } from './art/pot';
import { PUSH_BUTTON_ART, PUSH_BUTTON_PRESSED_SVG } from './art/pushbutton';
import { RESISTOR_ART, resistorArt } from './art/resistor';
import { TOGGLE_ART, TOGGLE_ON_SVG } from './art/toggle';
import { TRANSISTOR_ART } from './art/transistor';
import { UNO_ART, UNO_BOTTOM, UNO_TOP, drawUnoLeds, type HeaderPin } from './art/uno';
import { ART_CELL } from './art/common';
import type { BoardProgram, BoardSpec } from './mcu/board';
import { UNO_SPEC } from './mcu/avr/uno';
import { BC547, RED_LED, type ComponentModel, type PartResult } from './sim';

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
  /** Boards: the loaded program. Whether it runs is not saved. */
  program?: BoardProgram;
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
  /** Electrical model; its pin names are this part's pin ids. */
  sim?(state: PartState): ComponentModel;
  /** A microcontroller board: runs programs (see src/mcu). */
  board?: BoardSpec;
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
    id: 'bjt', name: 'BJT transistor', ...TRANSISTOR_ART,
    pins: [
      { id: 'c', name: 'Collector', x: 1, y: 4 }, { id: 'b', name: 'Base', x: 2, y: 4 },
      { id: 'e', name: 'Emitter', x: 3, y: 4 },
    ],
    sim: () => BC547,
  },
  {
    id: 'uno', name: 'Arduino Uno', ...UNO_ART,
    pins: UNO_PINS,
    links: [['gnd', 'gnd2'], ['gnd', 'gnd3']],
    board: UNO_SPEC,
    // io pins are filled in by the mixed-signal bridge (src/mcu/mixedsignal.ts).
    sim: () => ({ kind: 'board', rails: { ...UNO_SPEC.electrical.rails }, io: {} }),
    overlay: (ctx, _s, r) => drawUnoLeds(ctx, (r?.volts?.d13 ?? 0) / UNO_SPEC.electrical.vcc, r !== undefined),
  },
];

export function getPart(id: string): PartType | undefined {
  return PARTS.find((p) => p.id === id);
}
