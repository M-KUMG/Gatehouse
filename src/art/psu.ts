import { hLead, svgDoc, type PartArt } from './common';

// Programmable bench power supply: a small grey box with a display that
// shows the set voltage and a red (+) and a black (-) terminal on the right.
// 6 x 4 cells; the leads end at (120, 20) positive and (120, 60) negative.

export const PSU_COLS = 6;
export const PSU_ROWS = 4;

const defs = `
<linearGradient id="psuBody" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#6d737b"/><stop offset=".5" stop-color="#4b5058"/><stop offset="1" stop-color="#34383e"/>
</linearGradient>
<linearGradient id="psuGlass" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#10171a"/><stop offset="1" stop-color="#05090b"/>
</linearGradient>`;

/** The voltage as printed on the display: "5.00 V", "12.50 V", "100.0 V". */
export function psuLabel(volts: number): string {
  const v = Math.max(0, volts);
  return `${v < 100 ? v.toFixed(2) : v.toFixed(1)} V`;
}

/** The artwork with `volts` on its display. */
export function psuSvg(volts: number): string {
  const body = `
${hLead(100, 120, 20, 3)}
${hLead(100, 120, 60, 3)}
<rect x="3" y="5" width="98" height="70" rx="5" fill="url(#psuBody)"/>
<rect x="3" y="5" width="98" height="70" rx="5" fill="none" stroke="#000" stroke-opacity=".6" stroke-width=".8"/>
<rect x="10" y="12" width="60" height="26" rx="2.5" fill="url(#psuGlass)" stroke="#000" stroke-width=".8"/>
<text x="66" y="32" text-anchor="end" font-family="Consolas, 'Courier New', monospace" font-size="15" font-weight="bold" fill="#ff5a3c">${psuLabel(volts)}</text>
<circle cx="24" cy="57" r="9" fill="#2b2e33" stroke="#0b0c0e" stroke-width="1"/>
<path d="M24 57L29 50" stroke="#e8eaee" stroke-width="2" stroke-linecap="round"/>
<circle cx="86" cy="20" r="6" fill="#c0392b" stroke="#400" stroke-width="1"/>
<circle cx="86" cy="60" r="6" fill="#16181b" stroke="#000" stroke-width="1"/>
<g font-family="Arial, Helvetica, sans-serif" font-weight="bold" text-anchor="middle" fill="#e8eaee">
  <text x="86" y="40" font-size="11">+</text>
  <text x="86" y="52" font-size="11">−</text>
  <text x="46" y="68" font-size="6" fill-opacity=".7">DC POWER SUPPLY</text>
</g>`;
  return svgDoc(PSU_COLS, PSU_ROWS, defs, body);
}

export const PSU_ART: PartArt = { cols: PSU_COLS, rows: PSU_ROWS, svg: psuSvg(5) };
