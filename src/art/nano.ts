import { ART_CELL, svgDoc, type PartArt } from './common';
import { glow } from './uno';

// Arduino Nano style board seen from above, mini-USB at the top. 8 x 18 cells.
// Two rows of 15 pins, 0.1" pitch (1 cell), 6 cells (0.6") apart, on grid
// points: left column x = 1, right column x = 7, pin n at y = 2 + n.
//   Left : D13(L) 3V3 AREF A0..A5 [A6 A7] 5V [RST] GND VIN
//   Right: D12..D2 GND [RST] RX0 TX1
// A6/A7 and the two RST pads are drawn but have no pin: the compiler pack has
// no "eightanaloginputs" variant, the bridge only knows port pins, and the
// reset is not a pin of the Uno either (use the board's reset button).

const COLS = 8;
const ROWS = 18;
const LEFT_X = 1;
const RIGHT_X = 7;
const Y0 = 2;

export interface NanoPin {
  /** Pin id; undefined for a pad that is drawn but not a pin. */
  id?: string;
  label: string;
  /** Grid column and row. */
  x: number;
  y: number;
}

const column = (x: number, items: readonly (readonly [string | undefined, string])[]): NanoPin[] =>
  items.map(([id, label], i) => ({ id, label, x, y: Y0 + i }));

export const NANO_LEFT: readonly NanoPin[] = column(LEFT_X, [
  ['d13', 'D13'], ['3v3', '3V3'], ['aref', 'REF'],
  ...[0, 1, 2, 3, 4, 5].map((n): [string, string] => [`a${n}`, `A${n}`]),
  [undefined, 'A6'], [undefined, 'A7'], ['5v', '5V'], [undefined, 'RST'], ['gnd2', 'GND'], ['vin', 'VIN'],
]);

export const NANO_RIGHT: readonly NanoPin[] = column(RIGHT_X, [
  ...[12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((n): [string, string] => [`d${n}`, `D${n}`]),
  ['gnd', 'GND'], [undefined, 'RST'], ['d0', 'RX0'], ['d1', 'TX1'],
]);

/** The reset button, in art units (its hit area; see PartType.resetButton). */
export const NANO_RESET = { x: 72, y: 62, w: 16, h: 16 };

/** The on-board LEDs, in art units. */
export const NANO_L_LED = { x: 110, y: 104 };
export const NANO_ON_LED = { x: 110, y: 118 };

function pads(pins: readonly NanoPin[], left: boolean): string {
  return pins
    .map((p) => {
      const x = p.x * ART_CELL;
      const y = p.y * ART_CELL;
      const ring = p.id !== undefined ? 'url(#gold)' : '#6b5a2a';
      const tx = left ? x + 9 : x - 9;
      return (
        `<circle cx="${x}" cy="${y}" r="5.2" fill="${ring}" stroke="#050505" stroke-width=".6"/>` +
        `<circle cx="${x}" cy="${y}" r="2.1" fill="#000"/>` +
        `<text x="${tx}" y="${y + 2.4}" font-size="6.5" text-anchor="${left ? 'start' : 'end'}">${p.label}</text>`
      );
    })
    .join('');
}

function smdLed(x: number, y: number, label: string, color: string): string {
  return `<rect x="${x - 4}" y="${y - 2.6}" width="8" height="5.2" rx=".8" fill="#e9e3d0"/><rect x="${x - 2.4}" y="${y - 2}" width="4.8" height="4" fill="${color}"/>` +
    `<text x="${x - 7}" y="${y + 2.2}" fill="#f2f5f7" font-family="Arial, sans-serif" font-size="6" font-weight="700" text-anchor="end">${label}</text>`;
}

function nanoSvg(): string {
  const defs = `
<linearGradient id="pcb" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#1b3f7a"/><stop offset=".6" stop-color="#12306b"/><stop offset="1" stop-color="#0b2252"/>
</linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#a57d24"/><stop offset=".45" stop-color="#f6dc8a"/><stop offset="1" stop-color="#8d6618"/>
</linearGradient>
<linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#f4f6f8"/><stop offset=".4" stop-color="#c3c8ce"/><stop offset="1" stop-color="#7f858c"/>
</linearGradient>
<linearGradient id="ic" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#2e2f33"/><stop offset=".5" stop-color="#1b1c1f"/><stop offset="1" stop-color="#111214"/>
</linearGradient>`;

  const legs: string[] = [];
  for (let i = 0; i < 8; i++) {
    const o = 64 + i * 5;
    legs.push(`<rect x="${o}" y="170" width="2" height="5" fill="url(#gold)"/><rect x="${o}" y="215" width="2" height="5" fill="url(#gold)"/>`);
    legs.push(`<rect x="57" y="${178 + i * 5}" width="5" height="2" fill="url(#gold)"/><rect x="102" y="${178 + i * 5}" width="5" height="2" fill="url(#gold)"/>`);
  }

  const bottom = ROWS * ART_CELL - 6;
  const body = `
<path d="M6 6Q6 0 12 0H148Q154 0 154 6V${bottom - 6}Q154 ${bottom} 148 ${bottom}H12Q6 ${bottom} 6 ${bottom - 6}Z" fill="url(#pcb)" stroke="#07173a" stroke-width="1.2"/>
<g fill="none" stroke="#6f95d6" stroke-opacity=".28" stroke-width="1.4">
  <path d="M40 90V140L60 160"/><path d="M120 90V140L104 160"/><path d="M60 230V290H100"/><path d="M104 230V270"/>
</g>
<rect x="46" y="-4" width="68" height="42" rx="2" fill="url(#steel)" stroke="#5c6168" stroke-width="1"/>
<rect x="56" y="-2" width="48" height="12" fill="#9aa0a7"/>
<rect x="52" y="14" width="56" height="18" fill="none" stroke="#8a9097" stroke-width=".8"/>
<rect x="72" y="62" width="16" height="16" rx="1.5" fill="url(#steel)" stroke="#5c6168" stroke-width=".8"/>
<circle cx="80" cy="70" r="4.6" fill="#c5463c" stroke="#7d221c" stroke-width=".8"/>
<text x="80" y="90" fill="#f2f5f7" font-family="Arial, sans-serif" font-size="5" font-weight="700" text-anchor="middle">RESET</text>
${legs.join('')}
<rect x="62" y="175" width="40" height="40" rx="1.5" fill="url(#ic)"/>
<circle cx="67" cy="180" r="1.6" fill="#3a3b40"/>
<text x="82" y="193" fill="#b9bcc2" font-family="Arial, sans-serif" font-size="5" text-anchor="middle">ATMEGA328P</text>
<text x="82" y="201" fill="#8d9097" font-family="Arial, sans-serif" font-size="4.5" text-anchor="middle">AU  AVR</text>
<rect x="68" y="228" width="26" height="9" rx="4.5" fill="url(#steel)" stroke="#6b7178" stroke-width=".6"/>
<text x="81" y="246" fill="#f2f5f7" font-family="Arial, sans-serif" font-size="4.5" text-anchor="middle">16.000</text>
${smdLed(NANO_L_LED.x, NANO_L_LED.y, 'L', '#f0b23c')}
${smdLed(NANO_ON_LED.x, NANO_ON_LED.y, 'ON', '#3fbf55')}
<text x="80" y="288" fill="#f2f5f7" font-family="Arial, sans-serif" font-size="13" font-weight="700" font-style="italic" text-anchor="middle">NANO</text>
<g fill="#f2f5f7" font-family="Arial, sans-serif" font-weight="700">${pads(NANO_LEFT, true)}${pads(NANO_RIGHT, false)}</g>`;
  return svgDoc(COLS, ROWS, defs, body);
}

export const NANO_ART: PartArt = { cols: COLS, rows: ROWS, svg: nanoSvg() };

/** The board's LEDs (canvas in art units): "L" follows pin 13, "ON" shows power. */
export function drawNanoLeds(ctx: CanvasRenderingContext2D, l: number, on: boolean): void {
  glow(ctx, NANO_L_LED.x, NANO_L_LED.y, '255, 170, 40', Math.min(1, Math.max(0, l)));
  if (on) glow(ctx, NANO_ON_LED.x, NANO_ON_LED.y, '60, 230, 90', 0.75);
}
