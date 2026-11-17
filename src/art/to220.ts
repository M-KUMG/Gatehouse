import { svgDoc, type PartArt } from './common';

// Power transistor in a TO-220 package seen from the front: tinned metal
// tab with its mounting hole on top, black epoxy body, three flat leads that
// are wide near the body and narrow further down.
// 4 x 7 cells; leads end at (20, 140), (40, 140) and (60, 140): G, D, S.

/** Tab outline with the mounting hole cut out (even-odd), so the grid shows through it. */
const TAB =
  'M5 3H75V30H77V46H3V30H5Z' +
  'M40 12A9 9 0 1 0 40 30A9 9 0 1 0 40 12Z';
const BODY = 'M3 46H77V98Q77 101 74 101H6Q3 101 3 98Z';

function lead(x: number): string {
  const d = `M${x - 3.2} 101H${x + 3.2}V112L${x + 1.5} 116V140H${x - 1.5}V116L${x - 3.2} 112Z`;
  return `<path d="${d}" fill="url(#lead)"/><path d="${d}" fill="none" stroke="#5b6168" stroke-width=".5"/>`;
}

const defs = `
<linearGradient id="tab" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#8e949b"/>
  <stop offset=".22" stop-color="#e4e7ea"/>
  <stop offset=".5" stop-color="#b3b8be"/>
  <stop offset=".8" stop-color="#d5d9dd"/>
  <stop offset="1" stop-color="#7c8289"/>
</linearGradient>
<linearGradient id="epoxy" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#1b1b1e"/>
  <stop offset=".15" stop-color="#2d2d32"/>
  <stop offset=".55" stop-color="#202024"/>
  <stop offset="1" stop-color="#101012"/>
</linearGradient>
<linearGradient id="lead" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#7d838b"/><stop offset=".42" stop-color="#f1f3f5"/><stop offset="1" stop-color="#666b72"/>
</linearGradient>`;

function to220(marking: string, code: string): string {
  const body = `
${lead(20)}${lead(40)}${lead(60)}
<path d="${TAB}" fill="url(#tab)" fill-rule="evenodd"/>
<path d="${TAB}" fill="none" stroke="#4d5359" stroke-width=".7"/>
<path d="M31.6 24A9 9 0 0 0 48.4 24" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>
<path d="${BODY}" fill="url(#epoxy)"/>
<path d="M3.4 46.6H76.6" stroke="#55555d" stroke-width="1"/>
<path d="M6 99.8H74" stroke="#000" stroke-opacity=".6" stroke-width="1"/>
<path d="${BODY}" fill="none" stroke="#000" stroke-opacity=".6" stroke-width=".7"/>
<g font-family="Arial, Helvetica, sans-serif" fill="#b4b7bd" text-anchor="middle">
  <text x="40" y="66" font-size="11" font-weight="bold">${marking}</text>
  <text x="40" y="78" font-size="6.5" fill-opacity=".8">${code}</text>
</g>
<circle cx="40" cy="90" r="3" fill="#000" fill-opacity=".3"/>`;
  return svgDoc(4, 7, defs, body);
}

/** Logic-level N-channel MOSFET. */
export const NMOS_ART: PartArt = { cols: 4, rows: 7, svg: to220('N-FET', 'LL 2318') };
/** P-channel MOSFET. */
export const PMOS_ART: PartArt = { cols: 4, rows: 7, svg: to220('P-FET', 'P 2318') };
