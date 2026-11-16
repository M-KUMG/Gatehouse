import { svgDoc, type PartArt } from './common';

// Small-signal transistor in a TO-92 package, flat face towards the viewer,
// round back visible from slightly above. The three legs leave the body
// close together and are formed out to a 1-cell pitch.
// 4 x 4 cells; legs end at (20, 80), (40, 80) and (60, 80).

const LEGS = ['M28 50V61L20 69V80', 'M40 50V80', 'M52 50V61L60 69V80'];

const defs = `
<linearGradient id="face" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#2c2c31"/>
  <stop offset=".12" stop-color="#3b3b42"/>
  <stop offset=".5" stop-color="#232327"/>
  <stop offset="1" stop-color="#141416"/>
</linearGradient>
<linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#2a2a2f"/>
  <stop offset="1" stop-color="#4d4d55"/>
</linearGradient>`;

const legs = LEGS.map(
  (d) =>
    `<path d="${d}" fill="none" stroke="#6f757c" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="#eef0f2" stroke-width="1" stroke-linejoin="round"/>`,
).join('');

const body = `
${legs}
<path d="M16 16A24 9 0 0 1 64 16Z" fill="url(#top)"/>
<path d="M16 16H64V51Q64 53.5 61.5 53.5H18.5Q16 53.5 16 51Z" fill="url(#face)"/>
<path d="M16.4 16.4H63.6" stroke="#6c6c75" stroke-width=".8"/>
<path d="M16 16A24 9 0 0 1 64 16" fill="none" stroke="#000" stroke-opacity=".5" stroke-width=".7"/>
<path d="M16 16H64V51Q64 53.5 61.5 53.5H18.5Q16 53.5 16 51Z" fill="none" stroke="#000" stroke-opacity=".5" stroke-width=".7"/>
<g font-family="Arial, Helvetica, sans-serif" fill="#b4b7bd" text-anchor="middle">
  <text x="40" y="30" font-size="7.5" font-weight="bold">BC547</text>
  <text x="40" y="39" font-size="5.5" fill-opacity=".8">B 331</text>
</g>
<circle cx="40" cy="46.5" r="2.2" fill="#000" fill-opacity=".25"/>`;

export const TRANSISTOR_ART: PartArt = { cols: 4, rows: 4, svg: svgDoc(4, 4, defs, body) };
