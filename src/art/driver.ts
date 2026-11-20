import { svgDoc, type PartArt } from './common';

// Half-bridge gate driver in an 8-pin DIP seen from above: black epoxy body
// lying horizontally, the notch on the left end, pin 1 marked with a dot.
// Pins 1-4 (VCC IN SD COM) along the bottom edge left to right, pins 5-8
// (LO VS HO VB) along the top edge right to left, as on the real package.
// Plain printed marks ("GATE DRV", "DRV2104"), no vendor logo.
// 5 x 4 cells; leads end at x = 20, 40, 60, 80 on y = 0 and y = 80.

const BOTTOM = ['VCC', 'IN', 'SD', 'COM'];
const TOP = ['VB', 'HO', 'VS', 'LO']; // left to right: pins 8, 7, 6, 5

function lead(x: number, top: boolean): string {
  // A flat DIP leg: wide shoulder at the body, narrow pin to the grid point.
  const d = top
    ? `M${x - 3.5} 22H${x + 3.5}V16L${x + 1.6} 12V0H${x - 1.6}V12L${x - 3.5} 16Z`
    : `M${x - 3.5} 58H${x + 3.5}V64L${x + 1.6} 68V80H${x - 1.6}V68L${x - 3.5} 64Z`;
  return `<path d="${d}" fill="url(#dipLead)"/><path d="${d}" fill="none" stroke="#5b6168" stroke-width=".5"/>`;
}

const defs = `
<linearGradient id="dipLead" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#7d838b"/><stop offset=".42" stop-color="#f1f3f5"/><stop offset="1" stop-color="#666b72"/>
</linearGradient>
<linearGradient id="dipBody" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#2d2d33"/><stop offset=".5" stop-color="#1d1d21"/><stop offset="1" stop-color="#121215"/>
</linearGradient>`;

const BODY = 'M6 20H94Q96 20 96 22V58Q96 60 94 60H6Q4 60 4 58V22Q4 20 6 20Z';

const BURN = `
<ellipse cx="50" cy="40" rx="22" ry="12" fill="#6b3a1c" fill-opacity=".45"/>
<path d="M36 30L45 38L41 44L54 50" fill="none" stroke="#000" stroke-width="1.3"/>
<path d="M45 38L56 34" fill="none" stroke="#000" stroke-width=".9"/>`;

function dip(burned: boolean): string {
  const xs = [20, 40, 60, 80];
  const labels = (names: string[], y: number): string =>
    names.map((n, i) => `<text x="${xs[i]}" y="${y}" font-size="4.6">${n}</text>`).join('');
  const body = `
${xs.map((x) => lead(x, true)).join('')}${xs.map((x) => lead(x, false)).join('')}
<path d="${BODY}" fill="url(#dipBody)"/>
<path d="${BODY}" fill="none" stroke="#000" stroke-opacity=".7" stroke-width=".7"/>
<path d="M4 34A6 6 0 0 1 4 46" fill="#0b0b0d" stroke="#000" stroke-opacity=".6" stroke-width=".6"/>
<circle cx="12" cy="53" r="2" fill="#000" fill-opacity=".45"/>
<g font-family="Arial, Helvetica, sans-serif" fill="#b4b7bd" text-anchor="middle">
  <text x="52" y="39" font-size="9" font-weight="bold">GATE DRV</text>
  <text x="52" y="47" font-size="5.5" fill-opacity=".8">DRV2104</text>
  <g fill-opacity=".7">${labels(TOP, 27)}${labels(BOTTOM, 57)}</g>
</g>
${burned ? BURN : ''}`;
  return svgDoc(5, 4, defs, body);
}

/** Pin positions (grid points inside the 5 x 4 box) by model pin id, in the package's pin order 1..8. */
export const DRIVER_PIN_POINTS: readonly { id: string; name: string; x: number; y: number }[] = [
  { id: 'vcc', name: 'VCC (1, supply)', x: 1, y: 4 },
  { id: 'in', name: 'IN (2, logic input)', x: 2, y: 4 },
  { id: 'sd', name: 'SD (3, low = shutdown)', x: 3, y: 4 },
  { id: 'com', name: 'COM (4, ground)', x: 4, y: 4 },
  { id: 'lo', name: 'LO (5, low-side gate)', x: 4, y: 0 },
  { id: 'vs', name: 'VS (6, high-side return)', x: 3, y: 0 },
  { id: 'ho', name: 'HO (7, high-side gate)', x: 2, y: 0 },
  { id: 'vb', name: 'VB (8, bootstrap supply)', x: 1, y: 0 },
];

export const DRIVER_ART: PartArt = { cols: 5, rows: 4, svg: dip(false) };
export const DRIVER_BURNED_SVG = dip(true);
