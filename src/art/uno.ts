import { ART_CELL, svgDoc, type PartArt } from './common';

// Arduino Uno style board seen from above, USB on the left. 20 x 15 cells.
// Pins sit on the board's top and bottom edges (grid points); short gold
// leads run from each header socket to its pin point.
//   Top    (y = 0):  AREF GND d13..d8 at x = 3..10, d7..d0 at x = 12..19
//   Bottom (y = 15): 3V3 5V GND GND VIN at x = 6..10, A0..A5 at x = 12..17

const COLS = 20;
const ROWS = 15;
const H = ROWS * ART_CELL;

export interface HeaderPin {
  id: string;
  label: string;
  /** Grid column of the pin. */
  x: number;
}

export const UNO_TOP: readonly HeaderPin[] = [
  { id: 'aref', label: 'AREF', x: 3 },
  { id: 'gnd3', label: 'GND', x: 4 },
  ...[13, 12, 11, 10, 9, 8].map((n, i) => ({ id: `d${n}`, label: `${[11, 10, 9].includes(n) ? '~' : ''}${n}`, x: 5 + i })),
  ...[7, 6, 5, 4, 3, 2, 1, 0].map((n, i) => ({
    id: `d${n}`, label: n === 1 ? 'TX→1' : n === 0 ? 'RX←0' : `${[6, 5, 3].includes(n) ? '~' : ''}${n}`, x: 12 + i,
  })),
];

export const UNO_BOTTOM: readonly HeaderPin[] = [
  { id: '3v3', label: '3.3V', x: 6 },
  { id: '5v', label: '5V', x: 7 },
  { id: 'gnd', label: 'GND', x: 8 },
  { id: 'gnd2', label: 'GND', x: 9 },
  { id: 'vin', label: 'VIN', x: 10 },
  ...[0, 1, 2, 3, 4, 5].map((n) => ({ id: `a${n}`, label: `A${n}`, x: 12 + n })),
];

/** The red reset button's housing, in art units (its hit area; see PartType.resetButton). */
export const UNO_RESET = { x: 20, y: 10, w: 24, h: 24 };

/** The on-board LEDs, in art units. */
export const UNO_L_LED = { x: 112, y: 52 };
export const UNO_ON_LED = { x: 336, y: 62 };

function header(pins: readonly HeaderPin[], top: boolean): string {
  const xs = pins.map((p) => p.x * ART_CELL);
  const y = top ? 14 : H - 14;
  const strip = `<rect x="${Math.min(...xs) - 10}" y="${y - 9}" width="${Math.max(...xs) - Math.min(...xs) + 20}" height="18" rx="1.5" fill="url(#socket)" stroke="#050505" stroke-width=".8"/>`;
  const holes = xs
    .map((x) => {
      const lead = top
        ? `<rect x="${x - 1.4}" y="0" width="2.8" height="${y - 2}" fill="url(#gold)"/>`
        : `<rect x="${x - 1.4}" y="${y + 2}" width="2.8" height="${H - y - 2}" fill="url(#gold)"/>`;
      return `${lead}<rect x="${x - 3.6}" y="${y - 3.6}" width="7.2" height="7.2" fill="#000"/><rect x="${x - 2.2}" y="${y - 2.2}" width="4.4" height="4.4" fill="#3a2f12"/>`;
    })
    .join('');
  const labelY = top ? 33 : H - 30;
  const labels = pins
    .map((p) => {
      const small = p.label.length > 3;
      return `<text x="${p.x * ART_CELL}" y="${labelY}" font-size="${small ? 5.2 : 6.5}" text-anchor="middle">${p.label}</text>`;
    })
    .join('');
  return `${strip}${holes}<g fill="#f2f5f7" font-family="Arial, sans-serif" font-weight="700">${labels}</g>`;
}

function chip(): string {
  const x0 = 190;
  const y0 = 198;
  const pitch = 12.4;
  const legs: string[] = [];
  for (let i = 0; i < 14; i++) {
    const x = x0 + 9 + i * pitch;
    legs.push(`<rect x="${x}" y="${y0 - 6}" width="5" height="7" fill="url(#gold)"/>`);
    legs.push(`<rect x="${x}" y="${y0 + 38}" width="5" height="7" fill="url(#gold)"/>`);
  }
  return `
${legs.join('')}
<rect x="${x0}" y="${y0}" width="182" height="40" rx="2" fill="url(#ic)"/>
<path d="M${x0} ${y0 + 13}a7 7 0 0 1 0 14z" fill="#0b0b0c"/>
<circle cx="${x0 + 14}" cy="${y0 + 31}" r="2.4" fill="#2b2b2f"/>
<text x="${x0 + 96}" y="${y0 + 18}" fill="#b9bcc2" font-family="Arial, sans-serif" font-size="9" text-anchor="middle">ATMEGA328P-PU</text>
<text x="${x0 + 96}" y="${y0 + 29}" fill="#8d9097" font-family="Arial, sans-serif" font-size="6" text-anchor="middle">1641  AVR</text>`;
}

function smdLed(x: number, y: number, label: string, color: string): string {
  return `<rect x="${x - 4}" y="${y - 2.6}" width="8" height="5.2" rx=".8" fill="#e9e3d0"/><rect x="${x - 2.4}" y="${y - 2}" width="4.8" height="4" fill="${color}"/>` +
    `<text x="${x + 7}" y="${y + 2.4}" fill="#f2f5f7" font-family="Arial, sans-serif" font-size="6.5" font-weight="700">${label}</text>`;
}

function unoSvg(): string {
  const defs = `
<linearGradient id="pcb" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#1a7fa3"/><stop offset=".55" stop-color="#11698c"/><stop offset="1" stop-color="#0b5677"/>
</linearGradient>
<linearGradient id="socket" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#2c2c2e"/><stop offset=".5" stop-color="#151516"/><stop offset="1" stop-color="#0a0a0b"/>
</linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#a57d24"/><stop offset=".45" stop-color="#f6dc8a"/><stop offset="1" stop-color="#8d6618"/>
</linearGradient>
<linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#f4f6f8"/><stop offset=".4" stop-color="#c3c8ce"/><stop offset="1" stop-color="#7f858c"/>
</linearGradient>
<linearGradient id="ic" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#2e2f33"/><stop offset=".5" stop-color="#1b1c1f"/><stop offset="1" stop-color="#111214"/>
</linearGradient>
<radialGradient id="cap" cx=".4" cy=".35" r=".7">
  <stop offset="0" stop-color="#f2f4f6"/><stop offset=".7" stop-color="#a9afb6"/><stop offset="1" stop-color="#6c727a"/>
</radialGradient>`;

  const body = `
<path d="M14 6Q14 0 20 0H372L386 12V40L400 54V246L386 260V288Q386 ${H} 374 ${H}H20Q14 ${H} 14 ${H - 6}Z" fill="url(#pcb)" stroke="#07384f" stroke-width="1.2"/>
<g fill="none" stroke="#5fb4d4" stroke-opacity=".28" stroke-width="1.6">
  <path d="M60 60H150L170 80V150"/><path d="M230 60V120L250 140H330"/><path d="M120 150H170L185 165V196"/>
  <path d="M300 150V196"/><path d="M90 260H150V276"/><path d="M260 245V276"/>
</g>
<g fill="#0e2f3d" stroke="#c9ced4" stroke-width="1.4">
  <circle cx="30" cy="268" r="6"/><circle cx="374" cy="276" r="6"/><circle cx="372" cy="28" r="6"/><circle cx="150" cy="30" r="5.5"/>
</g>
<rect x="0" y="40" width="66" height="58" rx="2" fill="url(#steel)" stroke="#5c6168" stroke-width="1"/>
<rect x="4" y="48" width="12" height="42" fill="#9aa0a7"/>
<rect x="18" y="45" width="44" height="48" fill="none" stroke="#8a9097" stroke-width="1"/>
<rect x="0" y="206" width="60" height="58" rx="3" fill="#141416" stroke="#000" stroke-width="1"/>
<rect x="4" y="214" width="48" height="42" rx="2" fill="#222326"/>
<circle cx="30" cy="235" r="9" fill="#0b0b0c"/><circle cx="30" cy="235" r="3" fill="#8f949a"/>
<rect x="20" y="10" width="24" height="24" rx="2" fill="url(#steel)" stroke="#5c6168" stroke-width=".8"/>
<circle cx="32" cy="22" r="7" fill="#c5463c" stroke="#7d221c" stroke-width="1"/>
<text x="32" y="44" fill="#f2f5f7" font-family="Arial, sans-serif" font-size="6" font-weight="700" text-anchor="middle">RESET</text>
<rect x="88" y="94" width="30" height="30" rx="1.5" fill="url(#ic)"/>
<circle cx="93" cy="99" r="1.6" fill="#3a3b40"/>
<circle cx="82" cy="236" r="12" fill="url(#cap)" stroke="#5c6168" stroke-width=".8"/>
<circle cx="110" cy="236" r="12" fill="url(#cap)" stroke="#5c6168" stroke-width=".8"/>
<path d="M76 236h12M104 236h12" stroke="#5a6068" stroke-width="1.2"/>
<rect x="72" y="176" width="30" height="20" rx="1" fill="url(#ic)"/><rect x="76" y="168" width="22" height="8" fill="#9aa0a7"/>
<rect x="150" y="204" width="30" height="13" rx="6.5" fill="url(#steel)" stroke="#6b7178" stroke-width=".8"/>
<text x="165" y="226" fill="#f2f5f7" font-family="Arial, sans-serif" font-size="5.5" text-anchor="middle">16.000</text>
<g fill="url(#gold)">
  <circle cx="378" cy="128" r="3.2"/><circle cx="390" cy="128" r="3.2"/><circle cx="378" cy="140" r="3.2"/>
  <circle cx="390" cy="140" r="3.2"/><circle cx="378" cy="152" r="3.2"/><circle cx="390" cy="152" r="3.2"/>
</g>
<text x="372" y="168" fill="#f2f5f7" font-family="Arial, sans-serif" font-size="5.5" font-weight="700">ICSP</text>
${chip()}
${smdLed(UNO_L_LED.x, UNO_L_LED.y, 'L', '#f0b23c')}
${smdLed(112, 66, 'TX', '#f0b23c')}
${smdLed(112, 80, 'RX', '#f0b23c')}
${smdLed(UNO_ON_LED.x, UNO_ON_LED.y, 'ON', '#3fbf55')}
<text x="270" y="120" fill="#f2f5f7" font-family="Arial, sans-serif" font-size="34" font-weight="700" font-style="italic" text-anchor="middle">UNO</text>
<g fill="none" stroke="#f2f5f7" stroke-width="3.4"><circle cx="196" cy="108" r="11"/><circle cx="218" cy="108" r="11"/></g>
<path d="M190 108h12M212 108h12M218 102v12" stroke="#f2f5f7" stroke-width="2.4"/>
<g fill="#f2f5f7" font-family="Arial, sans-serif" font-size="7" font-weight="700" text-anchor="middle">
  <text x="300" y="48">DIGITAL (PWM ~)</text><text x="160" y="258">POWER</text><text x="290" y="258">ANALOG IN</text>
</g>
${header(UNO_TOP.slice(0, 8), true)}
${header(UNO_TOP.slice(8), true)}
${header(UNO_BOTTOM.slice(0, 5), false)}
${header(UNO_BOTTOM.slice(5), false)}`;
  return svgDoc(COLS, ROWS, defs, body);
}

export const UNO_ART: PartArt = { cols: COLS, rows: ROWS, svg: unoSvg() };

export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, rgb: string, b: number): void {
  if (b <= 0) return;
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0.5, x, y, 6 + 10 * b);
  g.addColorStop(0, `rgba(255, 255, 230, ${0.95 * b})`);
  g.addColorStop(0.3, `rgba(${rgb}, ${0.8 * b})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - 18, y - 18, 36, 36);
  ctx.globalCompositeOperation = 'source-over';
}

/** The board's LEDs (canvas in art units): "L" follows pin 13, "ON" shows power. */
export function drawUnoLeds(ctx: CanvasRenderingContext2D, l: number, on: boolean): void {
  glow(ctx, UNO_L_LED.x, UNO_L_LED.y, '255, 170, 40', Math.min(1, Math.max(0, l)));
  if (on) glow(ctx, UNO_ON_LED.x, UNO_ON_LED.y, '60, 230, 90', 0.75);
}
