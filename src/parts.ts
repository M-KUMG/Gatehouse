// Part type definitions. Sizes are in grid cells; the artwork (SVG, see
// src/art) fills a (cols x rows) cell box and its leads end on grid points
// so pins can be attached there later. No behavior yet: visuals only.
// To add a part: draw its art in src/art and add one entry below.

import { BATTERY_ART } from './art/battery';
import { LED_ART } from './art/led';
import { RESISTOR_ART } from './art/resistor';
import { TRANSISTOR_ART } from './art/transistor';

export interface PartType {
  id: string;
  name: string;
  cols: number;
  rows: number;
  /** Standalone SVG document, viewBox (cols * ART_CELL) x (rows * ART_CELL). */
  svg: string;
}

export const PARTS: readonly PartType[] = [
  { id: 'battery', name: 'Battery (AA)', ...BATTERY_ART },
  { id: 'bjt', name: 'BJT transistor', ...TRANSISTOR_ART },
  { id: 'resistor', name: 'Resistor', ...RESISTOR_ART },
  { id: 'led', name: 'LED', ...LED_ART },
];

export function getPart(id: string): PartType | undefined {
  return PARTS.find((p) => p.id === id);
}
