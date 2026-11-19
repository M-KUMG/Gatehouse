import { hLead, svgDoc, type PartArt } from './common';

// Axial inductor: a dark-green ferrite core wound with enamelled copper
// wire, with a light ring at each end.
// 4 x 2 cells; leads end at (0, 20) and (80, 20).

const BODY = 'M24 13H56Q58 13 58 15V25Q58 27 56 27H24Q22 27 22 25V15Q22 13 24 13Z';

const defs = `
<linearGradient id="shade" gradientUnits="userSpaceOnUse" x1="0" y1="13" x2="0" y2="27">
  <stop offset="0" stop-color="#fff" stop-opacity=".1"/>
  <stop offset=".25" stop-color="#fff" stop-opacity=".5"/>
  <stop offset=".6" stop-color="#fff" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity=".5"/>
</linearGradient>
<clipPath id="body"><path d="${BODY}"/></clipPath>`;

const turns = Array.from({ length: 8 }, (_, i) => {
  const x = 28 + i * 3.5;
  return `<path d="M${x} 13.5L${x + 2} 26.5" stroke="#c8782f" stroke-width="2.2"/>` +
    `<path d="M${x} 13.5L${x + 2} 26.5" stroke="#f0b070" stroke-width=".7" stroke-opacity=".8" transform="translate(-.5 0)"/>`;
}).join('');

const body = `
${hLead(0, 24, 20)}
${hLead(56, 80, 20)}
<path d="${BODY}" fill="#2f5a45"/>
<g clip-path="url(#body)">
  ${turns}
  <rect x="22" y="13" width="4" height="14" fill="#d9d5c4"/>
  <rect x="54" y="13" width="4" height="14" fill="#d9d5c4"/>
</g>
<path d="${BODY}" fill="url(#shade)"/>
<path d="${BODY}" fill="none" stroke="#17301f" stroke-opacity=".65" stroke-width=".7"/>`;

export const INDUCTOR_ART: PartArt = { cols: 4, rows: 2, svg: svgDoc(4, 2, defs, body) };
