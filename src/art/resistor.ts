import { hLead, svgDoc, type PartArt } from './common';

// Through-hole carbon film resistor, 220 ohm 5% (red red brown gold).
// 4 x 2 cells; leads end at (0, 20) and (80, 20).

// Dog-bone body: wider end caps, slimmer middle.
const BODY =
  'M22 12H27Q30 12 31.5 14.2H48.5Q50 12 53 12H58C62.6 12 62.6 28 58 28H53Q50 28 48.5 25.8' +
  'H31.5Q30 28 27 28H22C17.4 28 17.4 12 22 12Z';

const BANDS: [number, string][] = [
  [23.5, '#c62a22'], // red
  [32.5, '#c62a22'], // red
  [38.5, '#6b3a1c'], // brown
  [53, '#c9a640'], // gold
];

const defs = `
<linearGradient id="shade" gradientUnits="userSpaceOnUse" x1="0" y1="12" x2="0" y2="28">
  <stop offset="0" stop-color="#fff" stop-opacity=".05"/>
  <stop offset=".28" stop-color="#fff" stop-opacity=".5"/>
  <stop offset=".55" stop-color="#fff" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity=".5"/>
</linearGradient>
<clipPath id="body"><path d="${BODY}"/></clipPath>`;

const body = `
${hLead(0, 80, 20)}
<path d="${BODY}" fill="#d9c39b"/>
<g clip-path="url(#body)">
  ${BANDS.map(([x, c]) => `<rect x="${x}" y="10" width="3.6" height="20" fill="${c}"/>`).join('')}
</g>
<path d="${BODY}" fill="url(#shade)"/>
<path d="${BODY}" fill="none" stroke="#3b2f1e" stroke-opacity=".55" stroke-width=".7"/>`;

export const RESISTOR_ART: PartArt = { cols: 4, rows: 2, svg: svgDoc(4, 2, defs, body) };
