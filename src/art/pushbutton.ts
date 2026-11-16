import { hLead, svgDoc, type PartArt } from './common';

// 6 mm tactile push button seen from above: four legs, steel cover, round
// black cap. The two legs on the same row are one piece of metal inside.
// 4 x 3 cells; legs end at (0, 20), (80, 20), (0, 40) and (80, 40).

const defs = `
<linearGradient id="plate" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#e9ecef"/>
  <stop offset=".5" stop-color="#aab0b7"/>
  <stop offset="1" stop-color="#7c828a"/>
</linearGradient>
<radialGradient id="cap" cx=".38" cy=".32" r=".8">
  <stop offset="0" stop-color="#5a5c63"/>
  <stop offset=".55" stop-color="#26272b"/>
  <stop offset="1" stop-color="#0c0c0e"/>
</radialGradient>
<radialGradient id="capDown" cx=".5" cy=".5" r=".7">
  <stop offset="0" stop-color="#1b1c1f"/>
  <stop offset="1" stop-color="#060607"/>
</radialGradient>`;

const base = `
${hLead(0, 20, 20, 3.4)}
${hLead(60, 80, 20, 3.4)}
${hLead(0, 20, 40, 3.4)}
${hLead(60, 80, 40, 3.4)}
<rect x="17" y="7" width="46" height="46" rx="3.5" fill="#1d1e21"/>
<rect x="20" y="10" width="40" height="40" rx="2" fill="url(#plate)"/>
<g fill="#33353a">
  <circle cx="24.5" cy="14.5" r="1.9"/><circle cx="55.5" cy="14.5" r="1.9"/>
  <circle cx="24.5" cy="45.5" r="1.9"/><circle cx="55.5" cy="45.5" r="1.9"/>
</g>
<rect x="17" y="7" width="46" height="46" rx="3.5" fill="none" stroke="#000" stroke-opacity=".5" stroke-width=".7"/>
<circle cx="40" cy="30" r="13.2" fill="#0a0a0b" fill-opacity=".55"/>`;

const up = `
<circle cx="40" cy="30" r="12" fill="url(#cap)"/>
<circle cx="40" cy="30" r="12" fill="none" stroke="#000" stroke-opacity=".6" stroke-width=".7"/>
<path d="M32.5 26A9 9 0 0 1 41 21" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.6" stroke-linecap="round"/>`;

const down = `
<circle cx="40" cy="30" r="11" fill="url(#capDown)"/>
<circle cx="40" cy="30" r="11" fill="none" stroke="#4ea1ff" stroke-opacity=".9" stroke-width="1.2"/>`;

export const PUSH_BUTTON_ART: PartArt = { cols: 4, rows: 3, svg: svgDoc(4, 3, defs, base + up) };
export const PUSH_BUTTON_PRESSED_SVG = svgDoc(4, 3, defs, base + down);
